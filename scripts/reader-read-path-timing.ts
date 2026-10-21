/**
 * Where a briefing build's CPU goes — per phase, and per brief inside the gate.
 *
 *   npm run timing:read-path -- --user <id>                 # live pool, 3 runs
 *   npm run timing:read-path -- --user <id> --runs 5
 *   npm run timing:read-path -- --user <id> --freeze pool.json
 *   npm run timing:read-path -- --replay pool.json          # no database read
 *
 * **Why this exists.** `scripts/reader-composition-diagnostic.ts` answers *what a
 * reader would receive*; this answers *what it costs to decide*. They are
 * separate questions and the CPU budget (docs/decisions/cpu-killed-invocations.md)
 * needs the second one measured after every rule change, on the same pool, in
 * the same units, so a regression is a number rather than an opinion.
 *
 * **What it measures.** `process.cpuUsage()` around each phase of the build the
 * Worker runs (`src/lib/pipeline/digest.ts`: `selectStage`, `screenStage`,
 * `gateStage`, `writeStage`), in ms — user plus system, the whole Node process.
 * That is an **upper bound** relative to a single-threaded V8 isolate and is not
 * the Worker's own `cpuTimeUs`; the recorded Worker figures stay authoritative
 * for the budget itself. Wall clock is printed beside it because a query's wait
 * is not CPU and should not be read as spend.
 *
 * **Replay is how two trees are compared.** `--freeze` writes the exact inputs
 * the screen/gate/write phases consume (the considered briefs, the delivered
 * twin titles, the cap), and `--replay` runs those phases from the file with no
 * database read at all. The same file on two worktrees is therefore a code-only
 * comparison: no pool drift, no query noise, no ordering luck.
 *
 * **What it does not measure.** The write's network leg: an upsert against
 * production is not something a read-only instrument may do, so the write phase
 * here is the payload it builds (`reasonFor` + `composedSummaryArtifact` +
 * `JSON.stringify`). The insert's round trip is unchanged code and is not
 * claimed by these numbers.
 *
 * Reads only: every statement is a `select`. Nothing is written, nothing is
 * delivered, and `--freeze` writes one local JSON file.
 */

import { readFile, writeFile } from "node:fs/promises";

import { capFor } from "../src/lib/density";
import {
  suppressDeliveredDuplicates,
  suppressDeliveredTwins,
  suppressStoryTwins,
} from "../src/lib/pipeline/duplicates";
import { selectItems, type MatchRow } from "../src/lib/pipeline/digest";
import { reasonFor } from "../src/lib/pipeline/inclusion";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import type { ReaderSource } from "../src/lib/reader-evidence";
import { selectReaderEvidence } from "../src/lib/reader-evidence";
import { composedSummaryArtifact } from "../src/lib/reader-summary";
import { db, heading, main, say } from "./lib/db.ts";

/** The build's own brief shape (`EventBrief`, digest.ts:698), reduced to what these phases read. */
type Brief = {
  eventId: string;
  title: string;
  whatHappened: string | null;
  beforeState: string | null;
  afterState: string | null;
  sourceCount: number;
  sources: ReaderSource[];
  evidence: string[];
  sourceKinds: string[];
  publishedAt: string | null;
};

type DeliveredTwin = { title: string; whatHappened: string | null };

/** What `--freeze` writes and `--replay` reads: the screen/gate/write inputs, nothing else. */
type FrozenPool = {
  frozenAt: string;
  user: string;
  cap: number;
  matches: number;
  considered: Brief[];
  deliveredTwins: DeliveredTwin[];
};

type PhaseRow = { phase: string; cpuMs: number; wallMs: number; note?: string };

/** One repeated measurement, as `--json` writes it. */
type RunRecord = {
  run: number;
  phases: PhaseRow[];
  perBrief: { eventId: string; cpuMs: number }[];
  counts: { matches?: number; considered: number; afterTwins: number; shipped: number };
};

const phases: PhaseRow[] = [];

function cpuMsOf(delta: NodeJS.CpuUsage): number {
  return (delta.user + delta.system) / 1000;
}

/** One phase, in CPU and wall, appended to the table this run prints. */
async function timed<T>(phase: string, fn: () => Promise<T> | T, note?: string): Promise<T> {
  const before = process.cpuUsage();
  const start = performance.now();
  const value = await fn();
  const delta = process.cpuUsage(before);
  phases.push({
    phase,
    cpuMs: cpuMsOf(delta),
    wallMs: performance.now() - start,
    ...(note ? { note } : {}),
  });
  return value;
}

function arg(name: string, fallback: string | undefined): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  return process.argv[at + 1] ?? fallback;
}

function numeric(name: string, fallback: number): number {
  const value = Number(arg(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Nearest-rank percentile over an unsorted list. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

function median(values: readonly number[]): number {
  return percentile(values, 50);
}

const ms = (n: number): string => `${n.toFixed(1)}ms`;

// ---------------------------------------------------------------------------
// The loaders, mirrored from digest.ts where they are module-private. Each is
// cited so drift is checkable, exactly as the composition diagnostic does.
// ---------------------------------------------------------------------------

/** `loadMatches`, digest.ts:2127. */
async function loadMatches(userId: string): Promise<MatchRow[]> {
  const { data, error } = await db()
    .from("user_events")
    .select(
      "event_id, relevance, matched_at, delivered_revision, events ( title, first_seen_at, material_occurrence_at, material_revision, importance, novelty )",
    )
    .eq("user_id", userId)
    .is("briefed_at", null)
    .is("expired_at", null)
    .order("relevance", { ascending: false });
  if (error) throw new Error(`reading user_events: ${error.message}`);
  return (data ?? []).map((row) => {
    const event = row.events as {
      title?: string;
      first_seen_at?: string;
      material_occurrence_at?: string | null;
      material_revision?: number;
      importance?: number;
      novelty?: number;
    } | null;
    return {
      eventId: row.event_id,
      relevance: row.relevance,
      matchedAt: row.matched_at,
      eventAt: event?.material_occurrence_at ?? event?.first_seen_at ?? null,
      importance: event?.importance ?? 0,
      novelty: event?.novelty ?? 0,
      materialRevision: event?.material_revision ?? 0,
      deliveredRevision: row.delivered_revision ?? 0,
      matchedTitle: event?.title ?? "",
    };
  });
}

/** `alreadyBriefed`, digest.ts:2179. */
async function alreadyBriefed(userId: string): Promise<Map<string, number>> {
  const { data, error } = await db()
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .in("status", ["ready", "sent", "generating"]);
  if (error) throw new Error(`reading prior digests: ${error.message}`);
  const ids = (data ?? []).map((digest) => digest.digest_id);
  const found = new Map<string, number>();
  if (ids.length === 0) return found;
  const { data: items, error: itemError } = await db()
    .from("digest_items")
    .select("event_id, delivered_revision")
    .in("digest_id", ids);
  if (itemError) throw new Error(`reading prior digest_items: ${itemError.message}`);
  for (const item of items ?? []) {
    found.set(item.event_id, Math.max(found.get(item.event_id) ?? 0, item.delivered_revision ?? 0));
  }
  return found;
}

/** `deliveredTwinTitles`, digest.ts:1940. */
async function deliveredTwinTitles(userId: string): Promise<DeliveredTwin[]> {
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data, error } = await db()
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .gte("generated_at", since);
  if (error) return [];
  const digestIds = (data ?? []).map((digest) => digest.digest_id);
  if (digestIds.length === 0) return [];
  const { data: items, error: itemsError } = await db()
    .from("digest_items")
    .select("events ( title, what_happened )")
    .in("digest_id", digestIds);
  if (itemsError) return [];
  return (items ?? []).flatMap((row) => {
    const event = row.events as { title?: string; what_happened?: string | null } | null;
    return event?.title ? [{ title: event.title, whatHappened: event.what_happened ?? null }] : [];
  });
}

/** `loadBriefs`, digest.ts:2214 — the same selects, in the same shape. */
async function loadBriefs(picked: MatchRow[]): Promise<Brief[]> {
  const ids = picked.map((match) => match.eventId);
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("events")
    .select(
      "id, title, what_happened, before_state, after_state, importance, novelty, publisher_count, tags, first_seen_at, material_occurrence_at",
    )
    .in("id", ids);
  if (error) throw new Error(`reading events: ${error.message}`);

  const { data: coverage, error: coverageError } = await db()
    .from("articles")
    .select("id, event_id, source_id, title, excerpt, url, sources ( name, kind )")
    .in("event_id", ids);
  if (coverageError) throw new Error(`reading coverage: ${coverageError.message}`);

  const outlets = new Map<string, Set<string>>();
  const evidence = new Map<string, ReaderSource[]>();
  const kinds = new Map<string, Set<string>>();
  const unitEvidence = new Map<string, ReaderSource["enrichedEvidence"]>();
  const articleIds = (coverage ?? []).flatMap((row) => (row.id ? [row.id] : []));
  const chunk = 200;
  for (let from = 0; from < articleIds.length; from += chunk) {
    const { data: units, error: evidenceError } = await db()
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", articleIds.slice(from, from + chunk))
      .eq("status", "enriched");
    if (evidenceError) throw new Error(`reading article evidence: ${evidenceError.message}`);
    for (const unit of units ?? []) {
      const rows = Array.isArray(unit.evidence)
        ? (unit.evidence as unknown as NonNullable<ReaderSource["enrichedEvidence"]>)
        : [];
      if (rows.some((item) => typeof item?.text === "string" && item.text.trim() !== "")) {
        unitEvidence.set(unit.article_id, rows);
      }
    }
  }
  const storyEvidence = new Map<string, string[]>();
  for (const row of coverage ?? []) {
    if (!row.event_id) continue;
    const units = unitEvidence.get(row.id ?? "");
    if (units !== undefined) {
      const texts = units
        .map((item) => item.text)
        .filter((text): text is string => typeof text === "string" && text.trim() !== "");
      storyEvidence.set(row.event_id, [...(storyEvidence.get(row.event_id) ?? []), ...texts]);
    }
    const seen = outlets.get(row.event_id) ?? new Set<string>();
    seen.add(row.source_id ?? "unknown");
    outlets.set(row.event_id, seen);

    const kind = (row.sources as { kind?: string } | null)?.kind;
    if (kind) {
      const here = kinds.get(row.event_id) ?? new Set<string>();
      here.add(kind);
      kinds.set(row.event_id, here);
    }

    const list = evidence.get(row.event_id) ?? [];
    list.push({
      name: (row.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(row.title ? { headline: row.title } : {}),
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
      ...(row.url ? { url: row.url } : {}),
      ...(units !== undefined ? { enrichedEvidence: units } : {}),
    });
    evidence.set(row.event_id, list);
  }

  const byId = new Map((data ?? []).map((event) => [event.id, event] as const));
  return picked.flatMap((match) => {
    const event = byId.get(match.eventId);
    if (!event) return [];
    return [
      {
        eventId: match.eventId,
        title: event.title,
        whatHappened: event.what_happened,
        beforeState: event.before_state,
        afterState: event.after_state,
        sourceCount: event.publisher_count || outlets.get(match.eventId)?.size || 0,
        sources: evidence.get(match.eventId) ?? [],
        evidence: storyEvidence.get(match.eventId) ?? [],
        sourceKinds: [...(kinds.get(match.eventId) ?? [])],
        publishedAt: event.material_occurrence_at ?? event.first_seen_at ?? null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// The three phases this instrument exists for — screen, gate, write payload.
// ---------------------------------------------------------------------------

/**
 * `screenStage`, digest.ts:1374, in the same order: the twin passes over the
 * considered set, each timed separately so a widening in either is visible.
 */
async function screen(
  considered: readonly Brief[],
  deliveredTwins: readonly DeliveredTwin[],
): Promise<Brief[]> {
  const deduped = await timed("screen · suppressStoryTwins", () => suppressStoryTwins(considered));
  return timed("screen · suppressDeliveredTwins", () =>
    suppressDeliveredTwins(deduped, deliveredTwins),
  );
}

/** `gateStage`, digest.ts:1415 — `assessReadiness` per brief, timed individually. */
async function gate(briefs: readonly Brief[]): Promise<{
  ready: Brief[];
  cpu: number[];
  perBrief: { eventId: string; cpuMs: number }[];
  openings: Map<string, string>;
}> {
  const ready: Brief[] = [];
  const cpu: number[] = [];
  const perBrief: { eventId: string; cpuMs: number }[] = [];
  const openings = new Map<string, string>();
  for (const brief of briefs) {
    const before = process.cpuUsage();
    const verdict = assessReadiness({
      title: brief.title,
      whatHappened: brief.whatHappened,
      sourceCount: brief.sourceCount,
      sources: brief.sources,
      sourceKinds: brief.sourceKinds,
      publishedAt: brief.publishedAt,
    });
    const delta = process.cpuUsage(before);
    cpu.push(cpuMsOf(delta));
    perBrief.push({ eventId: brief.eventId, cpuMs: cpuMsOf(delta) });
    if (verdict.ready) {
      ready.push(brief);
      // `writeStage` reads the gate's own opening back (digest.ts:1489), so the
      // payload below must use it too or it pays a recovery composition the
      // production write never pays.
      if (verdict.opening !== undefined && verdict.opening !== "") {
        openings.set(brief.eventId, verdict.opening);
      }
    }
  }
  const total = cpu.reduce((sum, value) => sum + value, 0);
  phases.push({
    phase: "gate · assessReadiness",
    cpuMs: total,
    wallMs: total,
    note: `${briefs.length} briefs, median ${ms(median(cpu))}`,
  });
  // The gate pays `selectReaderEvidence` twice per brief — once at
  // readiness.ts:641 for the fact count and again inside the composer at
  // editorial.ts:3031 — so measuring one pass names the share a dedupe could
  // return. It is measured after the verdicts, not inside them, so the gate
  // figure above stays the number the build actually spends.
  let selection = 0;
  for (const brief of briefs) {
    const before = process.cpuUsage();
    selectReaderEvidence(brief.title, brief.sources);
    selection += cpuMsOf(process.cpuUsage(before));
  }
  phases.push({
    phase: "compose · selectReaderEvidence (×1)",
    cpuMs: selection,
    wallMs: selection,
    note: `${briefs.length} briefs — the gate runs this twice`,
  });
  return { ready, cpu, perBrief, openings };
}

/**
 * `writeStage`'s payload, digest.ts:1597-1755: the inclusion line per shipped
 * brief, the stored artifact beside it, and the row array serialized. The
 * upsert's network leg is deliberately absent (see the header).
 */
function writePayload(shipping: readonly Brief[], openings: ReadonlyMap<string, string>): string {
  const rows = shipping.map((brief, position) => ({
    position,
    why_it_matters: reasonFor({
      storedImpact: null,
      beforeState: brief.beforeState,
      afterState: brief.afterState,
      sourceCount: brief.sourceCount,
      evidence: brief.evidence,
      title: brief.title,
      whatHappened: brief.whatHappened,
    }).text,
    summary: composedSummaryArtifact({
      title: brief.title,
      sources: brief.sources,
      publishedAt: brief.publishedAt,
      whatHappened: brief.whatHappened,
      opening: openings.get(brief.eventId) ?? "",
    }),
  }));
  return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------

function printRun(label: string, extra: readonly string[]): void {
  heading(label);
  say(["phase".padEnd(34), "cpu".padStart(10), "wall".padStart(10), "note"].join("  "));
  let cpuTotal = 0;
  for (const row of phases) {
    cpuTotal += row.cpuMs;
    say(
      [
        row.phase.padEnd(34),
        ms(row.cpuMs).padStart(10),
        ms(row.wallMs).padStart(10),
        row.note ?? "",
      ].join("  "),
    );
  }
  say();
  say(`total CPU on the read path: ${ms(cpuTotal)}`);
  for (const line of extra) say(line);
}

function gateSummary(cpu: readonly number[]): string[] {
  if (cpu.length === 0) return ["per brief: no briefs gated"];
  return [
    `per brief: n=${cpu.length}  median ${ms(median(cpu))}  p95 ${ms(percentile(cpu, 95))}  ` +
      `worst ${ms(Math.max(...cpu))}  total ${ms(cpu.reduce((sum, v) => sum + v, 0))}`,
  ];
}

main(async () => {
  const replayPath = arg("replay", undefined);
  const freezePath = arg("freeze", undefined);
  const userArg = arg("user", undefined);
  const runs = Math.max(1, Math.round(numeric("runs", 3)));

  const jsonPath = arg("json", undefined);
  const records: RunRecord[] = [];

  if (replayPath !== undefined) {
    const frozen = JSON.parse(await readFile(replayPath, "utf8")) as FrozenPool;
    for (let run = 0; run < runs; run += 1) {
      phases.length = 0;
      const briefs = await screen(frozen.considered, frozen.deliveredTwins);
      const gated = await gate(briefs);
      const shipping = gated.ready.slice(0, frozen.cap);
      const payload = await timed("write · payload", () => writePayload(shipping, gated.openings));
      records.push({
        run: run + 1,
        phases: [...phases],
        perBrief: gated.perBrief,
        counts: {
          considered: frozen.considered.length,
          afterTwins: briefs.length,
          shipped: shipping.length,
        },
      });
      printRun(`Replay ${replayPath} — reader ${frozen.user.slice(0, 8)}, run ${run + 1}/${runs}`, [
        `${frozen.matches} live matches → ${frozen.considered.length} considered → ` +
          `${briefs.length} after twins → ${shipping.length} shipped (cap ${frozen.cap})`,
        ...gateSummary(gated.cpu),
        `write payload: ${payload.length} bytes`,
      ]);
    }
    if (jsonPath !== undefined) {
      await writeFile(
        jsonPath,
        JSON.stringify({ mode: "replay", pool: replayPath, runs: records }, null, 2),
        "utf8",
      );
      say(`wrote ${jsonPath}`);
    }
    return;
  }

  if (userArg === undefined) throw new Error("--user <id> is required unless --replay is given");

  // Resolve a prefix the way the composition diagnostic does, so a short id is
  // enough and a mistyped one fails rather than measuring a different reader.
  const { data: recent, error: recentError } = await db()
    .from("digests")
    .select("user_id,item_count")
    .eq("kind", "briefing")
    .order("scheduled_for", { ascending: false })
    .limit(200);
  if (recentError) throw new Error(recentError.message);
  const userId = (recent ?? []).find((digest) => digest.user_id.startsWith(userArg))?.user_id;
  if (userId === undefined) throw new Error(`no briefing reader starts with ${userArg}`);

  const [{ data: pref }, { data: sub }] = await Promise.all([
    db().from("notification_preferences").select("density").eq("user_id", userId).maybeSingle(),
    db().from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
  ]);
  const cap = capFor(pref?.density ?? 3, sub?.plan ?? "uno");

  // The live load happens once: the pool is the corpus, and re-reading it per
  // run would measure the database's cache rather than this code's cost. The
  // phases that are code are then repeated `--runs` times over the same input.
  const now = new Date();
  const matches = await timed("select · loadMatches", () => loadMatches(userId));
  const already = await timed("select · alreadyBriefed", () => alreadyBriefed(userId));
  const ranked = await timed("select · selectItems", () =>
    selectItems(matches, already, matches.length, now, "daily"),
  );
  const distinct = await timed("select · suppressDeliveredDuplicates", () =>
    suppressDeliveredDuplicates(
      db(),
      userId,
      ranked.map((row) => row.eventId),
      now,
      "briefing",
      new Map(ranked.map((row) => [row.eventId, row.materialRevision] as const)),
    ),
  );
  const consideredRows = ranked.filter((row) => distinct.has(row.eventId)).slice(0, cap + 12);
  const considered = await timed("screen · loadBriefs", () => loadBriefs(consideredRows));
  const deliveredTwins = await timed("screen · deliveredTwinTitles", () =>
    deliveredTwinTitles(userId),
  );

  const frozen: FrozenPool = {
    frozenAt: new Date().toISOString(),
    user: userId,
    cap,
    matches: matches.length,
    considered,
    deliveredTwins,
  };
  if (freezePath !== undefined) {
    await writeFile(freezePath, JSON.stringify(frozen), "utf8");
    say(`froze the screen/gate/write inputs to ${freezePath}`);
  }

  // The select/screen-load rows are the one live pass; each run below measures
  // only the code phases over that same loaded pool.
  const loadPhases = [...phases];
  phases.length = 0;
  for (let run = 0; run < runs; run += 1) {
    phases.length = 0;
    const briefs = await screen(frozen.considered, frozen.deliveredTwins);
    const gated = await gate(briefs);
    const shipping = gated.ready.slice(0, cap);
    const payload = await timed("write · payload", () => writePayload(shipping, gated.openings));
    records.push({
      run: run + 1,
      phases: [...phases],
      perBrief: gated.perBrief,
      counts: {
        matches: matches.length,
        considered: considered.length,
        afterTwins: briefs.length,
        shipped: shipping.length,
      },
    });
    say(
      [
        `run ${run + 1}/${runs}: ${matches.length} matches → ${ranked.length} eligible → ` +
          `${distinct.size} distinct → ${considered.length} considered → ${briefs.length} after twins → ` +
          `${shipping.length} shipped (cap ${cap})`,
        ...gateSummary(gated.cpu),
        `write payload: ${payload.length} bytes`,
      ].join("\n"),
    );
  }

  for (const row of loadPhases) phases.push(row);
  printRun(`Read path — reader ${userId.slice(0, 8)}, ${runs} run(s)`, [
    "screen/gate/write rows above are per run; the select rows are the one live load.",
    "The gate prints its own per-brief distribution on the run lines.",
  ]);
  if (jsonPath !== undefined) {
    await writeFile(
      jsonPath,
      JSON.stringify({ mode: "live", user: userId, load: loadPhases, runs: records }, null, 2),
      "utf8",
    );
    say(`wrote ${jsonPath}`);
  }
});
