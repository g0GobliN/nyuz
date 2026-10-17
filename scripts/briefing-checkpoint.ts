/**
 * The checkpoint report for a real, delivered briefing.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/briefing-checkpoint.ts [digestId] \
 *     [--user <id>] [--commit <sha>]
 *
 * With no digest id it takes the reader's most recently generated briefing,
 * optionally narrowed with `--user`.
 *
 * ---------------------------------------------------------------------------
 * Why this exists as a tool rather than a transcript
 * ---------------------------------------------------------------------------
 *
 * The quality loop has one recurring, expensive step: after a scheduled
 * briefing the reviewer wants the same facts, measured the same way, every
 * time. Assembling them by hand was where the last two rounds of ambiguity came
 * from — a number read out of a preview harness, a claim about the gate that
 * was actually about the pool, a delivery state nobody had looked up at all.
 *
 * So the numbers come from one command, and where a fact cannot be established
 * here the report says so and names the tool that can. Two rules follow from
 * that:
 *
 *   - Never re-derive a rule. The commerce and artifact verdicts come from
 *     `assessReadiness`, the ladder's lines from `reasonFor`, so this report
 *     cannot drift from the pipeline it is reporting on. Where a shape is
 *     matched for *display* (which controls to show), the match is labelled as
 *     a display heuristic and the verdict still comes from the gate.
 *   - Never call a reconstruction the thing itself. The candidate window is
 *     replayed with the same window rule selection uses; it is printed as
 *     "replayed", and a control that never entered the window is reported as
 *     not exercised rather than as a pass.
 *
 * Read-only: reads with the service key and writes nothing, so it is safe
 * against production between sends.
 */

import { hasStorySpecificLine, reasonFor } from "../src/lib/pipeline/inclusion";
import { assessReadiness } from "../src/lib/pipeline/readiness";
import { db, heading, main, say } from "./lib/db.ts";

/** The archive's retired shapes: the follow fallback and the subject line. */
const RETIRED_LINE =
  /^(?:you follow\b|this is an?\b[^.]*\bstory(?: from [^.]*)?\.?$)|,\s*in your\b[^.]*\btopics?\b/iu;

/**
 * Display heuristics for which controls to show.
 *
 * Deliberately not the gate: these decide what the report *lists*, and every
 * listed row carries the gate's own verdict beside it. A control that never
 * matches still gets its lane reported as not exercised, which is the case the
 * reviewer asked to see marked rather than silently omitted.
 */
const LANES: { lane: string; match: RegExp }[] = [
  {
    lane: "promotion",
    match: /\b(?:prime day|deal|deals|% off|pre-?order|on sale|starting at\s*\$)/i,
  },
  {
    lane: "acquisition",
    match: /\b(?:acquires?|acquired|acquisition|merger|merges?|buys|bought|takes? over)\b/i,
  },
  {
    lane: "launch",
    match: /\b(?:launches?|launched|introduces?|unveils?|releases?|released|ships?|announces?)\b/i,
  },
  { lane: "review", match: /\b(?:review|reviewed|hands-on|first look|we tested|benchmark)\b/i },
];

/** The window `selectItems` uses for a thin day, in hours. */
const THIN_DAY_HOURS = 72;

type DigestRow = {
  digest_id: string;
  user_id: string;
  kind: string;
  status: string;
  scheduled_for: string;
  generated_at: string | null;
  item_count: number | null;
  generation_failure_reason: string | null;
};

type ItemRow = {
  position: number;
  event_id: string;
  why_it_matters: string | null;
};

type EventRow = {
  id: string;
  title: string;
  what_happened: string | null;
  before_state: string | null;
  after_state: string | null;
  publisher_count: number | null;
  first_seen_at: string | null;
};

type DeliveryRow = {
  channel: string;
  status: string;
  attempts: number | null;
  last_error: string | null;
  delivered_at: string | null;
  next_attempt_at: string | null;
};

type ArticleRow = {
  id: string;
  event_id: string | null;
  source_id: string | null;
  title: string | null;
  excerpt: string | null;
  sources: { name?: string; kind?: string } | null;
};

type EvidenceRow = { article_id: string; evidence: unknown };

/**
 * A flag's value, in both spellings (`--user x` and `--user=x`).
 *
 * The digest id is whatever positional argument is left, and reading it
 * positionally without this is how `--commit 620a183` first parsed as a uuid.
 */
const FLAGS = ["--user", "--commit", "--recent"] as const;

const flagValue = (name: (typeof FLAGS)[number]): string | undefined => {
  const argv = process.argv.slice(2);
  const bare = argv.indexOf(name);
  if (bare !== -1) return argv[bare + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
};

main(async () => {
  const commit = flagValue("--commit");
  const userFilter = flagValue("--user");
  const recent = flagValue("--recent");
  if (recent !== undefined) {
    await recentDeliveries(Math.max(1, Number(recent) || 10));
    return;
  }
  const argv = process.argv.slice(2);
  const digestArg = argv.find((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = argv[index - 1] ?? "";
    return !FLAGS.includes(previous as (typeof FLAGS)[number]);
  });

  let query = db().from("digests").select("*").eq("kind", "briefing");
  if (digestArg !== undefined) query = query.eq("digest_id", digestArg);
  else if (userFilter !== undefined) query = query.eq("user_id", userFilter);
  // Ordered by generation, not by slot: a reader with a scheduled-but-future
  // row (every account has one) would otherwise always win with an empty
  // digest, and the report would describe a briefing nobody has.
  if (digestArg === undefined) query = query.not("generated_at", "is", null);
  const { data, error } = await query
    .order("generated_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const digest = (data ?? [])[0] as DigestRow | undefined;
  if (digest === undefined) {
    say("no briefing digest found");
    return;
  }

  heading(`Digest ${digest.digest_id}`);
  say(`declared deployed commit  ${commit ?? "(pass --commit <sha>)"}`);
  say(`reader                    ${digest.user_id}`);
  say(`status                    ${digest.status}   kind ${digest.kind}`);
  say(`scheduled                 ${digest.scheduled_for}`);
  say(`generated                 ${digest.generated_at ?? "—"}`);
  say(`items                     ${digest.item_count ?? "—"}`);
  say(`generation failure        ${digest.generation_failure_reason ?? "none"}`);

  // ---------------------------------------------------------------------
  // 8. Automation: did the scheduled run complete on its own?
  // ---------------------------------------------------------------------
  const late =
    digest.generated_at === null
      ? null
      : Math.round((Date.parse(digest.generated_at) - Date.parse(digest.scheduled_for)) / 60_000);
  heading("8. Automation");
  say(`generated by                the ${digest.kind} pipeline (no manual run recorded)`);
  say(`minutes after slot          ${late === null ? "never generated" : late}`);
  say(`recorded failure            ${digest.generation_failure_reason ?? "none"}`);

  // ---------------------------------------------------------------------
  // 5 and 6. Significance and provenance, against the ladder itself.
  // ---------------------------------------------------------------------
  const { data: itemData, error: itemError } = await db()
    .from("digest_items")
    .select("position, event_id, why_it_matters")
    .eq("digest_id", digest.digest_id)
    .order("position", { ascending: true });
  if (itemError) throw new Error(itemError.message);
  const items = (itemData ?? []) as ItemRow[];
  const ids = items.map((item) => item.event_id);
  say(
    `item rows                  ${items.length}   (digest.item_count ${digest.item_count ?? "—"})`,
  );

  const { data: eventData, error: eventError } = await db()
    .from("events")
    .select("id, title, what_happened, before_state, after_state, publisher_count, first_seen_at")
    .in("id", ids);
  if (eventError) throw new Error(eventError.message);
  const events = new Map(
    ((eventData ?? []) as EventRow[]).map((event) => [event.id, event] as const),
  );

  const { data: impactData, error: impactError } = await db()
    .from("event_impacts")
    .select("event_id, text, status")
    .in("event_id", ids)
    .eq("status", "complete");
  if (impactError) throw new Error(impactError.message);
  const impacts = new Map(
    (impactData ?? []).map((row) => [row.event_id, row.text ?? null] as const),
  );

  const evidence = await evidenceFor(ids);

  heading("5. Significance, re-derived by the ladder");
  const rungs = new Map<string, number>();
  const rungsStored = new Map<string, number>();
  let silent = 0;
  let retired = 0;
  let diverged = 0;
  const diverging: string[] = [];
  const retiredShapes: string[] = [];

  for (const item of items) {
    const event = events.get(item.event_id);
    const ladder = reasonFor({
      storedImpact: impacts.get(item.event_id) ?? null,
      beforeState: event?.before_state ?? null,
      afterState: event?.after_state ?? null,
      sourceCount: event?.publisher_count ?? 0,
      evidence: evidence.get(item.event_id) ?? [],
      title: event?.title ?? null,
      whatHappened: event?.what_happened ?? null,
    });
    rungs.set(ladder.source, (rungs.get(ladder.source) ?? 0) + 1);

    const stored = (item.why_it_matters ?? "").trim();
    if (stored === "") {
      silent += 1;
      continue;
    }
    if (stored === ladder.text) {
      rungsStored.set(ladder.source, (rungsStored.get(ladder.source) ?? 0) + 1);
      continue;
    }
    if (RETIRED_LINE.test(stored)) {
      retired += 1;
      retiredShapes.push(`${String(item.position).padStart(2)} ${stored.slice(0, 70)}`);
      continue;
    }
    diverged += 1;
    diverging.push(`${String(item.position).padStart(2)} stored: ${stored.slice(0, 60)}`);
  }

  say(
    `  ladder now: ${[...rungs.entries()]
      .sort()
      .map(([source, count]) => `${source} ${count}`)
      .join(", ")}`,
  );
  say(`  stored equals the ladder now          ${countOf(rungsStored)}/${items.length}`);
  say(`  silent in the significance slot       ${silent}/${items.length}`);
  say(`  retired shape, recomputed at read     ${retired}/${items.length}`);
  say(`  kept verbatim (data moved since)      ${diverged}/${items.length}`);
  for (const line of retiredShapes) say(`    retired  ${line}`);
  for (const line of diverging) say(`    differ   ${line}`);

  heading("6. Provenance");
  const followStored = items.filter((item) =>
    RETIRED_LINE.test((item.why_it_matters ?? "").trim()),
  );
  say(`follow/subject lines stored in why_it_matters   ${followStored.length}`);
  say("none under this heading is the requirement; the read path recomputes them under");
  say("the provenance heading instead (src/lib/server/briefing.ts, withWhyAndProvenance).");

  // ---------------------------------------------------------------------
  // 2, 3 and 4. The candidate window, replayed, with the gate's verdicts.
  //
  // Wrapped because the replay is the one section that reads a large slice of
  // the project in many round trips, and when it throws the report used to die
  // here — which lost section 10 as well, the per-channel delivery state that is
  // the whole point of running this after a send. Measured on 2026-10-17: both
  // runs of the day aborted in `replayPool` with `TypeError: fetch failed`
  // before the delivery rows printed. A read-only report may report a missing
  // section; it may not lose the evidence it exists to produce.
  // ---------------------------------------------------------------------
  let pool: Awaited<ReturnType<typeof replayPool>> | null = null;
  try {
    pool = await replayPool(digest, ids);
  } catch (error) {
    pool = null;
    heading("2, 3, 4. Candidate window, replayed (same 72h rule as selection)");
    say(`REPLAY UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
    say("the digest above is the product's own record and stands on its own; this");
    say("section is a reconstruction and is reported missing rather than absent.");
  }
  if (pool === null) {
    // Fall through to the delivery section, which needs no replay.
  } else {
    heading("2, 3, 4. Candidate window, replayed (same 72h rule as selection)");
    say(`events in the window       ${pool.events}`);
    say(`replayed candidates        ${pool.rows.length}`);
    say(`shipped in this digest     ${pool.shipped}`);
    // The number the reviewers kept having to reconstruct by hand: what a build
    // over this window would actually write, with both gates applied.
    say(
      `would ship today            ${pool.wouldShip}  (${pool.withLine} carry a why-line, ${pool.wouldShip - pool.withLine} silent)`,
    );
    say(
      `replayed withheld          ${pool.withheld.length}` +
        (pool.withheldKinds.size > 0
          ? `  (${[...pool.withheldKinds.entries()].map(([k, n]) => `${k} ${n}`).join(", ")})`
          : ""),
    );
    say("");
    for (const { lane } of LANES) {
      const rows = pool.rows.filter((candidate) => lane === candidate.lane);
      if (rows.length === 0) {
        say(`${lane.padEnd(12)} NOT EXERCISED — no such story entered the replayed window`);
        continue;
      }
      for (const candidate of rows) {
        const verdict = candidate.ready
          ? candidate.silent
            ? "ready (ships with no line)"
            : "ready"
          : `withheld: ${candidate.kind} — ${candidate.reason?.slice(0, 58)}`;
        say(`${lane.padEnd(12)} ${candidate.shipped ? "shipped " : "absent  "}${verdict}`);
        say(`             ${candidate.title.slice(0, 96)}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 10. Delivery, per channel — the strongest state actually observable.
  // ---------------------------------------------------------------------
  const { data: deliveryData, error: deliveryError } = await db()
    .from("deliveries")
    .select("channel, status, attempts, last_error, delivered_at, next_attempt_at")
    .eq("digest_id", digest.digest_id);
  if (deliveryError) throw new Error(deliveryError.message);
  const deliveries = (deliveryData ?? []) as DeliveryRow[];
  heading("10. Delivery, per channel");
  if (deliveries.length === 0) {
    say("no delivery rows — the digest was generated but not queued for a channel");
  }
  for (const delivery of deliveries) {
    say(`${delivery.channel}`);
    say(`  status          ${delivery.status}   attempts ${delivery.attempts ?? 0}`);
    say(`  accepted at     ${delivery.delivered_at ?? "—"}`);
    say(`  next attempt    ${delivery.next_attempt_at ?? "—"}`);
    say(`  last error      ${delivery.last_error ?? "none"}`);
    say(`  strongest state ${strongestState(delivery)}`);
  }
  say("");
  say("An accepted send is the provider taking the message, not proof it arrived.");
  say(
    "Report the state above as what it is: accepted, failed with a reason, or not yet attempted.",
  );

  heading("7. Read-inside prose — measured elsewhere, on purpose");
  say("This report does not re-derive prose quality; a second opinion is not the same one.");
  say("  npm run email:preview            renders the email templates");
  say("  scripts/reader-composer-audit.ts audits the composed article for a story");
  say("Both exist already; run them for the digest under review and paste the numbers.");
});

/**
 * The last `count` briefings beside their per-channel delivery state.
 *
 * This is the report that found the production email outage: every briefing for
 * a week had `email failed Resend 401` next to a digest row reading `sent`, and
 * both facts are only visible when the two tables are put side by side. Kept as
 * a flag because the question "is the channel working?" is asked on a different
 * cadence from "is this briefing right?".
 */
async function recentDeliveries(count: number): Promise<void> {
  const { data, error } = await db()
    .from("digests")
    .select("digest_id, user_id, status, scheduled_for, item_count, kind")
    .eq("kind", "briefing")
    .order("scheduled_for", { ascending: false })
    .limit(count);
  if (error) throw new Error(error.message);
  const digests = (data ?? []) as DigestRow[];
  heading(`Delivery, last ${digests.length} briefings`);
  for (const digest of digests) {
    const label =
      `${digest.scheduled_for.slice(0, 16)}  items ${String(digest.item_count ?? 0).padStart(2)}  ` +
      `${digest.status.padEnd(9)}  ${digest.user_id.slice(0, 8)}`;
    const { data: deliveryData, error: deliveryError } = await db()
      .from("deliveries")
      .select("channel, status, attempts, last_error, delivered_at, next_attempt_at")
      .eq("digest_id", digest.digest_id);
    if (deliveryError) throw new Error(deliveryError.message);
    const deliveries = (deliveryData ?? []) as DeliveryRow[];
    if (deliveries.length === 0) {
      say(`${label}  (not queued for a channel)`);
      continue;
    }
    for (const delivery of deliveries) {
      say(
        `${label}  ${delivery.channel.padEnd(8)} ${delivery.status.padEnd(7)} ` +
          `attempts ${delivery.attempts ?? 0}  ${strongestState(delivery)}`,
      );
    }
  }
  say("");
  say("A digest row reading `sent` means the send attempt finished. It does not mean a");
  say("channel accepted the message — read each row above for that.");
}

/** How many stored lines matched, summed over rungs. */
function countOf(rungs: Map<string, number>): number {
  let total = 0;
  for (const count of rungs.values()) total += count;
  return total;
}

/**
 * The delivery row as the strongest state it evidences, in the arbiter's terms:
 * a sent status is the provider accepting it, never an arrival.
 */
function strongestState(delivery: DeliveryRow): string {
  if (delivery.status === "sent") return "accepted by the provider (delivery not observable here)";
  if (delivery.status === "failed") {
    return `failed — ${delivery.last_error ?? "no reason recorded"}`;
  }
  return `${delivery.status} — not yet delivered`;
}

/**
 * The 0090 evidence for a set of events, flattened per event.
 *
 * Mirrors what briefing.ts puts on the hydrated story, so the ladder here sees
 * the same material the reader's card does — the point of re-deriving the line
 * rather than trusting the stored copy.
 */
async function evidenceFor(eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  const { data, error } = await db()
    .from("articles")
    .select("id, event_id")
    .in("event_id", eventIds);
  if (error) throw new Error(error.message);
  const articles = (data ?? []) as ArticleRow[];
  if (articles.length === 0) return out;
  const { data: unitData, error: unitError } = await db()
    .from("article_evidence")
    .select("article_id, evidence")
    .in(
      "article_id",
      articles.map((article) => article.id),
    )
    .eq("status", "enriched");
  if (unitError) throw new Error(unitError.message);
  const units = new Map(
    ((unitData ?? []) as EvidenceRow[]).map((row) => [row.article_id, row.evidence] as const),
  );
  for (const article of articles) {
    if (article.event_id === null) continue;
    const raw = units.get(article.id);
    if (!Array.isArray(raw)) continue;
    const texts = raw
      .map((unit) => (unit as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string" && text.trim() !== "");
    if (texts.length === 0) continue;
    out.set(article.event_id, [...(out.get(article.event_id) ?? []), ...texts]);
  }
  return out;
}

type Candidate = {
  lane: string;
  title: string;
  shipped: boolean;
  /** Passed the readiness gate. */
  ready: boolean;
  /**
   * Passed readiness but the ladder has nothing to print, so the card ships
   * without an explanation. This is a reportable state, not a withheld one:
   * the Q4 gate that withheld these was reversed on 2026-10-17 when the owner
   * ruled the product pure code, because the rungs that could explain a story
   * are written by the `analyse` pass.
   */
  silent: boolean;
  kind?: string;
  reason?: string;
};

/**
 * Replays the reader's candidate window and runs the real gate over it.
 *
 * The window is the same one `selectItems` uses for a thin day (72 hours back
 * from the slot), and the verdict per candidate is `assessReadiness` — the gate
 * the digest itself ran. What this cannot prove is that generation saw exactly
 * this set, so the report calls it a replay and leaves the conclusion to the
 * reviewer: a promotion that is present here and absent from the digest is
 * evidence the gate did its job, and a promotion that is absent here is not
 * evidence of anything.
 */
async function replayPool(
  digest: DigestRow,
  shippedIds: string[],
): Promise<{
  events: number;
  rows: Candidate[];
  shipped: number;
  /** Passed readiness: what a build over this window would actually ship. */
  wouldShip: number;
  /** How many of those carry a story-specific line; the rest ship silent. */
  withLine: number;
  withheld: Candidate[];
  withheldKinds: Map<string, number>;
}> {
  const since = new Date(
    Date.parse(digest.scheduled_for) - THIN_DAY_HOURS * 3_600_000,
  ).toISOString();
  const { data: linkData, error: linkError } = await db()
    .from("user_events")
    .select("event_id, matched_at")
    .eq("user_id", digest.user_id)
    .gte("matched_at", since)
    .limit(1000);
  if (linkError) throw new Error(linkError.message);
  const linked = (linkData ?? []) as { event_id: string; matched_at: string }[];
  const ids = [...new Set(linked.map((row) => row.event_id))];
  if (ids.length === 0) {
    return {
      events: 0,
      rows: [],
      shipped: 0,
      wouldShip: 0,
      withLine: 0,
      withheld: [],
      withheldKinds: new Map(),
    };
  }

  const { data: eventData, error: eventError } = await db()
    .from("events")
    .select("id, title, what_happened, before_state, after_state, publisher_count")
    .in("id", ids);
  if (eventError) throw new Error(eventError.message);
  // The Q4 gate reads the same ladder generation reads, so the replay has to
  // load the same inputs it does — the stored impact and the story's own article
  // evidence. Omitting them is what made this replay answer a pre-Q4 question.
  const { data: impactData, error: impactError } = await db()
    .from("event_impacts")
    .select("event_id, text")
    .in("event_id", ids)
    .eq("status", "complete");
  if (impactError) throw new Error(impactError.message);
  const impacts = new Map(
    (impactData ?? []).map((row) => [row.event_id, row.text ?? null] as const),
  );
  const { data: coverageData, error: coverageError } = await db()
    .from("articles")
    .select("id, event_id, source_id, sources ( kind )")
    .in("event_id", ids);
  if (coverageError) throw new Error(coverageError.message);

  const outlets = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  for (const article of (coverageData ?? []) as unknown as ArticleRow[]) {
    if (article.event_id === null) continue;
    const seen = outlets.get(article.event_id) ?? new Set<string>();
    seen.add(article.source_id ?? "unknown");
    outlets.set(article.event_id, seen);
    const kind = article.sources?.kind;
    if (kind !== undefined) {
      const here = kinds.get(article.event_id) ?? new Set<string>();
      here.add(kind);
      kinds.set(article.event_id, here);
    }
  }

  // The 0090 evidence read the consequence rung climbs, exactly as generation
  // makes it (status enriched, one text per unit).
  const evidence = new Map<string, string[]>();
  {
    const articleIds = (coverageData ?? []).flatMap((art) => (art.id ? [art.id] : []));
    const byArticle = new Map<string, string>(
      (coverageData ?? []).flatMap((art) =>
        art.id && art.event_id ? [[art.id, art.event_id] as const] : [],
      ),
    );
    for (let from = 0; from < articleIds.length; from += 150) {
      const { data: units } = await db()
        .from("article_evidence")
        .select("article_id, evidence")
        .in("article_id", articleIds.slice(from, from + 150))
        .eq("status", "enriched");
      for (const unit of units ?? []) {
        const eventId = byArticle.get(unit.article_id);
        if (eventId === undefined) continue;
        const texts = (Array.isArray(unit.evidence) ? unit.evidence : [])
          .map((item) => (item as { text?: unknown }).text)
          .filter((text): text is string => typeof text === "string" && text.trim() !== "");
        if (texts.length > 0) evidence.set(eventId, [...(evidence.get(eventId) ?? []), ...texts]);
      }
    }
  }

  const shipped = new Set(shippedIds);
  const rows: Candidate[] = [];
  const withheld: Candidate[] = [];
  const withheldKinds = new Map<string, number>();
  for (const event of (eventData ?? []) as EventRow[]) {
    // `publisher_count` first, then the coverage count — the build's own
    // expression (digest.ts loadBriefs). Reading only the coverage count here
    // made the replay's source count disagree with the one the ladder saw.
    const sourceCount = event.publisher_count || outlets.get(event.id)?.size || 0;
    const verdict = assessReadiness({
      title: event.title,
      whatHappened: event.what_happened ?? "",
      sourceCount,
      sourceKinds: [...(kinds.get(event.id) ?? [])],
    });
    const why = reasonFor({
      storedImpact: impacts.get(event.id) ?? null,
      beforeState: event.before_state,
      afterState: event.after_state,
      sourceCount,
      evidence: evidence.get(event.id) ?? [],
      title: event.title,
      whatHappened: event.what_happened ?? "",
    });
    const silent = verdict.ready && !hasStorySpecificLine(why.text);
    const lane = LANES.find((entry) => entry.match.test(event.title))?.lane ?? "other";
    const candidate: Candidate = {
      lane,
      title: event.title,
      shipped: shipped.has(event.id),
      ready: verdict.ready,
      silent,
      ...(verdict.ready ? {} : { kind: verdict.kind, reason: verdict.reason }),
    };
    rows.push(candidate);
    if (!verdict.ready) {
      withheld.push(candidate);
      if (candidate.kind !== undefined) {
        withheldKinds.set(candidate.kind, (withheldKinds.get(candidate.kind) ?? 0) + 1);
      }
    }
  }
  return {
    events: ids.length,
    rows,
    shipped: rows.filter((candidate) => candidate.shipped).length,
    wouldShip: rows.filter((candidate) => candidate.ready).length,
    withLine: rows.filter((candidate) => candidate.ready && !candidate.silent).length,
    withheld,
    withheldKinds,
  };
}
