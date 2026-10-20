/**
 * Gate 2's evidence ledger: the significance window opened by ruling #12c.
 *
 *   npm run audit:significance-window [--out FILE] [--now ISO]
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 * Gate 2 of the 10/10 bar is item 2 of docs/reader-quality-10-of-10.md:
 *
 *   "Every delivered item either carries a line a stored fact justifies, or is
 *    not delivered."
 *
 * Its verdict is a calendar fact, not labour: the route is ruling #12c's 30-day
 * source experiment, whose window opened 2026-10-19T06:46Z and closes
 * 2026-11-18T06:46Z. Before that date no verdict exists, and this command says
 * so with `PENDING` and the close date rather than a green read.
 *
 * What can be mechanical is mechanical. The window is read from
 * `source_exemptions` -- the row the gate itself honours, not a literal copied
 * from a document -- every briefing generated inside it is enumerated, and for
 * every delivered item the ladder is re-derived with `reasonFor` on the same
 * inputs `briefing:checkpoint` reads (stored impact, before/after state,
 * publisher count, the event's own evidence, title and paragraph). Nothing here
 * guesses at a fact it could read.
 *
 * The per-event evidence is written to a JSON ledger so the record survives a
 * redeploy: once per event, never per reader (docs/database.md's cost model),
 * with delivery rows referencing event ids. The event block carries the title,
 * paragraph, states, publisher count, evidence sentences and outlets the ladder
 * actually saw, so a later change to `articles` or `article_evidence` cannot
 * silently rewrite what the verdict was taken on.
 *
 * ---------------------------------------------------------------------------
 * Why the verdict line refuses to choose, until the docs choose
 * ---------------------------------------------------------------------------
 * Two documents state the bar, and they are not the same measurement:
 *
 *   docs/reader-quality-10-of-10.md:12-14   EVERY delivered item carries a
 *                                           justified line, or is not delivered
 *   docs/decisions/reader-delivery.md:3391  AT LEAST ONE future delivered item
 *                                           carries a story-specific line from a
 *                                           rung other than coverage
 *
 * The first is a universal bar, the second an existence bar, and on the same
 * rows the difference is the verdict itself rather than a rounding. The
 * checklist's "or is not delivered" also contradicts ruling #12's standing
 * instruction not to withhold publishable stories for a missing line
 * (docs/reader-quality-10-of-10.md:66-67), so the universal bar cannot be met
 * by the product as ruled today either. The task that asked for this file says
 * plainly that a wrong instrument is worse than a pending gate, so this command
 * measures both bars and prints neither as the verdict:
 *
 *   before the close   gate 2  PENDING    <close date>             exit 0
 *   after the close    gate 2  UNDEFINED  <both doc lines>         exit 2
 *
 * `UNDEFINED` exits 2, never 0: a gate with no single definition must not read
 * green. The ruling that closes the gap is recorded in
 * docs/decisions/significance-window-instrument.md, and the moment it lands the
 * numbers below are the ones it needs -- no second measurement pass.
 *
 * `--now` exists so both branches can be verified against real rows instead of
 * waiting for the calendar (the ledger records the clock it was taken with).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InclusionReason } from "../src/lib/pipeline/inclusion";
import {
  hasStorySpecificLine,
  normalizeForCompare,
  reasonFor,
} from "../src/lib/pipeline/inclusion";
import { db, fail, heading, main, row, say } from "./lib/db";

const EXPERIMENT = "12c-30d";
const DEFAULT_OUT = "docs/audits/significance-window-12c-30d.json";

/**
 * Ruling #12c's before-record, taken with the clock stopped on 2026-10-19.
 * Provenance: docs/decisions/reader-delivery.md ("Status", 2026-10-19).
 */
const BASELINE_MULTI_PUBLISHER = 169;
const BASELINE_PROVENANCE =
  "docs/decisions/reader-delivery.md:3484 — complete events 12,733; events with >=2 publishers 169; " +
  "taken with the experiment's clock stopped, 2026-10-19";

const CHUNK = 100;

type Rung = InclusionReason["source"];

const RUNGS: Rung[] = [
  "stored",
  "change",
  "after-state",
  "consequence",
  "binding",
  "coverage",
  "none",
];

type ExemptionRow = {
  source_id: string;
  experiment: string;
  reason: string;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type DigestRow = {
  digest_id: string;
  user_id: string;
  status: string;
  scheduled_for: string;
  generated_at: string | null;
  item_count: number | null;
};

type ItemRow = {
  digest_id: string;
  event_id: string;
  position: number;
  why_it_matters: string | null;
};

type EventRow = {
  id: string;
  title: string;
  what_happened: string | null;
  before_state: string | null;
  after_state: string | null;
  publisher_count: number | null;
};

type ArticleRow = {
  id: string;
  event_id: string | null;
  source_id: string | null;
  fetched_at: string | null;
  sources: { name?: string; kind?: string } | null;
};

type EvidenceRow = { article_id: string; evidence: unknown };

/** One event's material, as the ladder saw it, and the rung it produced. */
type EventEvidence = {
  title: string;
  whatHappened: string | null;
  publisherCount: number;
  distinctOutlets: number;
  beforeState: boolean;
  afterState: boolean;
  storedImpact: boolean;
  evidence: string[];
  outlets: { id: string | null; name: string; kind: string | null; fetchedAt: string | null }[];
  ladder: { source: Rung; text: string; storySpecific: boolean };
  /** Where the ladder's line came from in the recorded material. */
  trace: { via: "evidence" | "field" | "none"; sources: string[] };
};

type Delivery = {
  digestId: string;
  readerId: string;
  generatedAt: string | null;
  digestStatus: string;
  position: number;
  eventId: string;
  stored: string;
  /** `empty`, `equals` the ladder now, or `differs` from it. */
  storedState: "empty" | "equals" | "differs";
  rung: Rung;
};

/** The counts the documented bars are read against, printed and persisted. */
type Measurements = {
  briefings: number;
  briefingsWithItems: number;
  briefingsSent: number;
  briefingsSkipped: number;
  readers: number;
  items: number;
  events: number;
  rungs: Record<Rung, number>;
  carried: number;
  storedEqualsLadder: number;
  ladderNonNone: number;
  silent: number;
  nonCoverageRungs: number;
  nonCoverageCarried: number;
  carriedByRung: Record<Rung, number>;
  qualifying: { position: number; eventId: string; title: string; rung: Rung; line: string }[];
  qualifyingTraced: number;
  itemsOnExemptSource: number;
  multiPublisherEvents: number | null;
  multiPublisherError: string | null;
};

const args = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
};

const resolveNow = (): Date => {
  const raw = flag("--now");
  if (raw === undefined) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) fail(`--now is not a date: ${raw}`);
  return parsed;
};

/** Splits ids into PostgREST-sized batches; `.in()` with 1,000 ids is a URL nobody wants. */
function chunks<T>(values: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
}

const iso = (value: string | Date): string => new Date(value).toISOString();
const short = (value: string): string => value.slice(0, 19).replace("T", " ");
const days = (from: Date, to: Date): string => {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const whole = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${whole}d ${hours}h`;
};

main(async () => {
  const client = db();
  const now = resolveNow();
  const out = flag("--out") ?? DEFAULT_OUT;

  // ---------------------------------------------------------------- window
  const { data: exemptionData, error: exemptionError } = await client
    .from("source_exemptions")
    .select("source_id, experiment, reason, enabled, starts_at, ends_at")
    .eq("experiment", EXPERIMENT);
  if (exemptionError) {
    fail(
      `reading source_exemptions: ${exemptionError.message}\n` +
        "Migration 0120 is not applied on this database, so there is no window to audit.",
    );
  }
  const exemptions = (exemptionData ?? []) as ExemptionRow[];
  if (exemptions.length === 0) fail(`no ${EXPERIMENT} rows: nothing to audit`);
  const running = exemptions.filter((entry) => entry.enabled);
  if (running.length === 0) {
    fail(
      `the ${EXPERIMENT} experiment is present and off (${exemptions.length} rows). ` +
        "Start it with `npm run experiment:sources -- --on` before auditing a window.",
    );
  }
  const windows = new Map<string, number>();
  for (const entry of running) {
    const key = `${entry.starts_at ?? "null"} -> ${entry.ends_at ?? "null"}`;
    windows.set(key, (windows.get(key) ?? 0) + 1);
  }
  if (windows.size !== 1) {
    fail(
      `the ${running.length} enabled rows disagree about the window, so there is no single ` +
        `boundary to measure:\n${[...windows.entries()].map(([key, n]) => `  ${key} (${n})`).join("\n")}`,
    );
  }
  const windowKey = [...windows.keys()][0] ?? "";
  const [startsRaw = "", endsRaw = ""] = windowKey.split(" -> ");
  if (startsRaw === "null" || endsRaw === "null") {
    fail(`the enabled ${EXPERIMENT} rows carry no window: ${windowKey}`);
  }
  const startsAt = new Date(startsRaw);
  const endsAt = new Date(endsRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    fail(`the ${EXPERIMENT} window is not a pair of dates: ${windowKey}`);
  }
  const exemptIds = new Set(running.map((entry) => entry.source_id));

  // ------------------------------------------------------------- briefings
  const { data: digestData, error: digestError } = await client
    .from("digests")
    .select("digest_id, user_id, status, scheduled_for, generated_at, item_count")
    .eq("kind", "briefing")
    .gte("generated_at", startsAt.toISOString())
    .lt("generated_at", endsAt.toISOString())
    .order("generated_at", { ascending: true });
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  const digests = (digestData ?? []) as DigestRow[];

  const items: ItemRow[] = [];
  for (const batch of chunks(digests.map((digest) => digest.digest_id))) {
    const { data, error } = await client
      .from("digest_items")
      .select("digest_id, event_id, position, why_it_matters")
      .in("digest_id", batch)
      .order("position", { ascending: true });
    if (error) throw new Error(`digest_items: ${error.message}`);
    items.push(...((data ?? []) as ItemRow[]));
  }

  const eventIds = [...new Set(items.map((item) => item.event_id))];
  const digestOf = new Map(digests.map((digest) => [digest.digest_id, digest] as const));

  // ------------------------------------------------------- the event facts
  const events = new Map<string, EventRow>();
  for (const batch of chunks(eventIds)) {
    const { data, error } = await client
      .from("events")
      .select("id, title, what_happened, before_state, after_state, publisher_count")
      .in("id", batch);
    if (error) throw new Error(`events: ${error.message}`);
    for (const event of (data ?? []) as EventRow[]) events.set(event.id, event);
  }

  const impacts = new Map<string, string | null>();
  for (const batch of chunks(eventIds)) {
    const { data, error } = await client
      .from("event_impacts")
      .select("event_id, text")
      .in("event_id", batch)
      .eq("status", "complete");
    if (error) throw new Error(`event_impacts: ${error.message}`);
    for (const impact of (data ?? []) as { event_id: string; text: string | null }[]) {
      impacts.set(impact.event_id, impact.text ?? null);
    }
  }

  const articles: ArticleRow[] = [];
  for (const batch of chunks(eventIds)) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, source_id, fetched_at, sources ( name, kind )")
      .in("event_id", batch);
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as unknown as ArticleRow[]));
  }

  const unitByArticle = new Map<string, string[]>();
  for (const batch of chunks(articles.map((article) => article.id))) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", batch)
      .eq("status", "enriched");
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const unit of (data ?? []) as EvidenceRow[]) {
      const texts = (Array.isArray(unit.evidence) ? unit.evidence : [])
        .map((entry) => (entry as { text?: unknown }).text)
        .filter((text): text is string => typeof text === "string" && text.trim() !== "");
      if (texts.length > 0) unitByArticle.set(unit.article_id, texts);
    }
  }

  // ------------------------------------------------------- per-event ledger
  const evidence = new Map<string, EventEvidence>();
  for (const eventId of eventIds) {
    const event = events.get(eventId);
    if (event === undefined) continue;
    const eventArticles = articles.filter((article) => article.event_id === eventId);
    const units = eventArticles.flatMap((article) => unitByArticle.get(article.id) ?? []);
    const outlets = eventArticles.map((article) => ({
      id: article.source_id,
      name: article.sources?.name ?? article.source_id ?? "unknown",
      kind: article.sources?.kind ?? null,
      fetchedAt: article.fetched_at,
    }));
    const ladder = reasonFor({
      storedImpact: impacts.get(eventId) ?? null,
      beforeState: event.before_state,
      afterState: event.after_state,
      sourceCount: event.publisher_count ?? 0,
      evidence: units,
      title: event.title,
      whatHappened: event.what_happened ?? "",
    });
    evidence.set(eventId, {
      title: event.title,
      whatHappened: event.what_happened,
      publisherCount: event.publisher_count ?? 0,
      distinctOutlets: new Set(eventArticles.map((article) => article.source_id ?? "unknown")).size,
      beforeState: (event.before_state ?? "").trim() !== "",
      afterState: (event.after_state ?? "").trim() !== "",
      storedImpact: (impacts.get(eventId) ?? "").trim() !== "",
      evidence: units,
      outlets,
      ladder: {
        source: ladder.source,
        text: ladder.text,
        storySpecific: hasStorySpecificLine(ladder.text),
      },
      trace: traceOf(ladder, eventArticles, unitByArticle),
    });
  }

  // ---------------------------------------------------------- per delivery
  const deliveries: Delivery[] = items.map((item) => {
    const digest = digestOf.get(item.digest_id);
    const stored = (item.why_it_matters ?? "").trim();
    const ladder = evidence.get(item.event_id)?.ladder;
    return {
      digestId: item.digest_id,
      readerId: digest?.user_id ?? "unknown",
      generatedAt: digest?.generated_at ?? null,
      digestStatus: digest?.status ?? "unknown",
      position: item.position,
      eventId: item.event_id,
      stored,
      storedState:
        stored === ""
          ? "empty"
          : ladder !== undefined && stored === ladder.text.trim()
            ? "equals"
            : "differs",
      rung: ladder?.source ?? "none",
    };
  });
  // Stable reading order: the build's own order across digests, then the card.
  deliveries.sort(
    (left, right) =>
      (left.generatedAt ?? "").localeCompare(right.generatedAt ?? "") ||
      left.position - right.position,
  );

  // ------------------------------------------------------------ measurements
  const rungs = Object.fromEntries(RUNGS.map((rung) => [rung, 0])) as Record<Rung, number>;
  for (const delivery of deliveries) rungs[delivery.rung] += 1;
  const carriedByRung = Object.fromEntries(RUNGS.map((rung) => [rung, 0])) as Record<Rung, number>;
  for (const delivery of deliveries) {
    const ladder = evidence.get(delivery.eventId)?.ladder;
    if (delivery.stored !== "" && ladder !== undefined && delivery.stored === ladder.text.trim()) {
      carriedByRung[delivery.rung] += 1;
    }
  }
  const carried = deliveries.filter((delivery) => delivery.stored !== "").length;
  const storedEqualsLadder = deliveries.filter(
    (delivery) => delivery.storedState === "equals",
  ).length;
  const ladderNonNone = deliveries.filter((delivery) => delivery.rung !== "none").length;
  const silent = deliveries.length - ladderNonNone;
  const nonCoverageRungs = deliveries.filter(
    (delivery) => delivery.rung !== "none" && delivery.rung !== "coverage",
  ).length;
  const nonCoverageCarried = deliveries.filter(
    (delivery) =>
      delivery.rung !== "none" &&
      delivery.rung !== "coverage" &&
      delivery.stored !== "" &&
      delivery.stored === (evidence.get(delivery.eventId)?.ladder.text ?? "").trim(),
  ).length;
  const qualifying = deliveries
    .filter(
      (delivery) =>
        delivery.storedState === "equals" &&
        delivery.rung !== "none" &&
        delivery.rung !== "coverage" &&
        hasStorySpecificLine(delivery.stored),
    )
    .map((delivery) => ({
      position: delivery.position,
      eventId: delivery.eventId,
      title: evidence.get(delivery.eventId)?.title ?? "",
      rung: delivery.rung,
      line: delivery.stored,
    }));
  const qualifyingTraced = qualifying.filter((entry) => {
    const trace = evidence.get(entry.eventId)?.trace;
    return trace !== undefined && trace.via !== "none";
  }).length;
  const itemsOnExemptSource = deliveries.filter((delivery) =>
    (evidence.get(delivery.eventId)?.outlets ?? []).some(
      (outlet) =>
        outlet.id !== null &&
        exemptIds.has(outlet.id) &&
        outlet.fetchedAt !== null &&
        new Date(outlet.fetchedAt) >= startsAt,
    ),
  ).length;

  const multiPublisher = await countMultiPublisher(client);

  const measurements: Measurements = {
    briefings: digests.length,
    briefingsWithItems: digests.filter((digest) => (digest.item_count ?? 0) > 0).length,
    briefingsSent: digests.filter((digest) => digest.status === "sent").length,
    briefingsSkipped: digests.filter((digest) => digest.status === "skipped").length,
    readers: new Set(digests.map((digest) => digest.user_id)).size,
    items: deliveries.length,
    events: eventIds.length,
    rungs,
    carried,
    storedEqualsLadder,
    ladderNonNone,
    silent,
    nonCoverageRungs,
    nonCoverageCarried,
    carriedByRung,
    qualifying,
    qualifyingTraced,
    itemsOnExemptSource,
    multiPublisherEvents: multiPublisher.value,
    multiPublisherError: multiPublisher.error,
  };

  // --------------------------------------------------------------- the ledger
  const ledger = {
    generatedAt: now.toISOString(),
    experiment: EXPERIMENT,
    window: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      source: "source_exemptions.enabled rows (all agree)",
      sources: [...exemptIds].sort(),
    },
    baseline: {
      multiPublisherEvents: BASELINE_MULTI_PUBLISHER,
      provenance: BASELINE_PROVENANCE,
    },
    population: {
      briefings: measurements.briefings,
      briefingsWithItems: measurements.briefingsWithItems,
      briefingsSent: measurements.briefingsSent,
      briefingsSkipped: measurements.briefingsSkipped,
      readers: measurements.readers,
      items: measurements.items,
      events: measurements.events,
    },
    briefings: digests.map((digest) => ({
      digestId: digest.digest_id,
      readerId: digest.user_id,
      status: digest.status,
      scheduledFor: digest.scheduled_for,
      generatedAt: digest.generated_at,
      itemCount: digest.item_count,
    })),
    events: Object.fromEntries(evidence.entries()),
    deliveries,
    measurements,
    verdict: now < endsAt ? "PENDING" : "UNDEFINED",
  };
  writeLedger(out, ledger);

  // ------------------------------------------------------------------ print
  heading(`Gate 2 — ${EXPERIMENT}'s significance window`);
  say(
    `window (source_exemptions)   ${short(startsAt.toISOString())}Z -> ${short(endsAt.toISOString())}Z`,
  );
  say(`enabled rows                 ${running.length} of ${exemptions.length}`);
  say(
    `clock                        ${short(now.toISOString())}Z  ` +
      (now < startsAt
        ? "before the window opens"
        : now < endsAt
          ? `${days(now, endsAt)} to close`
          : "closed"),
  );
  say(`ledger                       ${out}`);

  heading("Delivered in the window");
  say(row("briefings generated", measurements.briefings));
  say(row("  with items", measurements.briefingsWithItems));
  say(
    row(
      "  status sent / skipped",
      `${measurements.briefingsSent} / ${measurements.briefingsSkipped}`,
    ),
  );
  say(row("readers", measurements.readers));
  say(row("items", measurements.items));
  say(row("distinct events", measurements.events));

  heading("Per item, the ladder re-derived on briefing:checkpoint's inputs");
  if (deliveries.length === 0) {
    say("no item was delivered in this window, so there is nothing to re-derive");
  }
  const shown = deliveries.slice(0, 80);
  for (const delivery of shown) {
    const fact = evidence.get(delivery.eventId);
    const carries = delivery.stored === "" ? "carry —" : "carry +";
    say(
      `#${String(delivery.position).padStart(2, "0")}  ${delivery.rung.padEnd(11)} ${carries}  ` +
        `p${String(fact?.publisherCount ?? 0).padEnd(2)} u${String(fact?.evidence.length ?? 0).padEnd(3)} ` +
        `${(fact?.title ?? delivery.eventId).slice(0, 78)}`,
    );
    if (delivery.stored !== "" || delivery.rung !== "none") {
      say(`     stored  ${JSON.stringify(delivery.stored.slice(0, 92))}`);
      say(
        `     ladder  ${JSON.stringify((fact?.ladder.text ?? "").slice(0, 92))}  (${delivery.storedState})`,
      );
    }
  }
  if (deliveries.length > shown.length)
    say(`  … and ${deliveries.length - shown.length} more in the ledger`);

  heading("The numbers each documented bar is read against");
  showRungs(measurements);
  say("");
  say(`(a) docs/reader-quality-10-of-10.md:12   every delivered item carries a justified line`);
  say(
    `    measured: ${measurements.storedEqualsLadder} / ${measurements.items}` +
      `   (stored non-empty and equal to the ladder now; a PASS needs all ${measurements.items})`,
  );
  say(`(b) docs/reader-quality-10-of-10.md:13   ladder now non-zero, every none withheld`);
  say(
    `    measured: ${measurements.ladderNonNone} / ${measurements.items} on a rung; ` +
      `${measurements.silent} / ${measurements.items} none and delivered`,
  );
  say(
    "    nothing withholds a story for a missing line (ruling #12 option 1), so the second leg " +
      "is measured on delivered rows only",
  );
  say(`(c) docs/decisions/reader-delivery.md:3391   one delivered item on a non-coverage rung`);
  say(
    `    measured: ${measurements.qualifying.length} / ${measurements.items} carried, ` +
      `story-specific, non-coverage   (${measurements.nonCoverageRungs} on such a rung, ` +
      `${measurements.nonCoverageCarried} of them carried)`,
  );
  for (const entry of measurements.qualifying) {
    say(
      `      #${String(entry.position).padStart(2, "0")} ${entry.rung.padEnd(10)} ${entry.title.slice(0, 66)}`,
    );
    say(`         ${JSON.stringify(entry.line.slice(0, 88))}`);
  }
  say(`(d) docs/reader-quality-10-of-10.md:14   stored equals the ladder now (drift check)`);
  say(
    `    measured: ${measurements.storedEqualsLadder} / ${measurements.items}   ` +
      "(the document gives no passing threshold for this line)",
  );
  say(`(e) docs/decisions/reader-delivery.md:3392   the qualifying line traces to stored evidence`);
  say(
    `    measured: ${measurements.qualifyingTraced} / ${measurements.qualifying.length} qualifying line(s) traced`,
  );
  say(
    `(f) docs/decisions/reader-delivery.md:3390   events with >=2 publishers exceed the baseline`,
  );
  say(
    `    measured: ${measurements.multiPublisherEvents ?? "unreadable"} now vs ${BASELINE_MULTI_PUBLISHER} baseline` +
      (measurements.multiPublisherError === null ? "" : `   (${measurements.multiPublisherError})`),
  );
  say(
    `(g) docs/handoff-2026-10-19-afternoon.md:35   the qualifying line came from the eight released sources`,
  );
  say(
    `    measured: ${measurements.itemsOnExemptSource} / ${measurements.items} delivered item(s) sit on an ` +
      "event with an article from one of the eight, fetched inside the window",
  );

  // ------------------------------------------------------------- the verdict
  say("");
  const verdict =
    now < startsAt
      ? `gate 2  PENDING  window opens ${short(startsAt.toISOString())}Z; nothing is delivered ` +
        "inside it yet"
      : now < endsAt
        ? `gate 2  PENDING  window closes ${short(endsAt.toISOString())}Z (${days(now, endsAt)} away); ` +
          `${measurements.items} delivered item(s) recorded, no verdict before the close`
        : "gate 2  UNDEFINED  two documented bars disagree (docs/reader-quality-10-of-10.md:12-14 " +
          "is universal, docs/decisions/reader-delivery.md:3391 is existence); no verdict computed — " +
          "see docs/decisions/significance-window-instrument.md";
  say(verdict);
  process.exitCode = now < endsAt ? 0 : 2;
});

/**
 * The rung census, plus the drift line `briefing:checkpoint` prints.
 *
 * The carried column is the number the checkpoint calls "stored equals the
 * ladder now": the item carries a line and that line is what the ladder
 * produces today. Splitting it out is what keeps "the ladder would say
 * something" (a count of the corpus) from reading as "the reader was told
 * something" (a count of the delivered rows).
 */
function showRungs(measurements: Measurements): void {
  say(
    `  ladder now: ${RUNGS.filter((rung) => measurements.rungs[rung] > 0)
      .map((rung) => `${rung} ${measurements.rungs[rung]}`)
      .join(", ")}`,
  );
  say(`  delivered items                  ${measurements.items}`);
  say(`  carried any line at all          ${measurements.carried} / ${measurements.items}`);
  say(
    `  stored equals the ladder now     ${measurements.storedEqualsLadder} / ${measurements.items}`,
  );
  say(`  ladder now yields a line         ${measurements.ladderNonNone} / ${measurements.items}`);
  say(`  silent (nothing carried)         ${measurements.silent} / ${measurements.items}`);
  for (const rung of RUNGS) {
    if (rung === "none" || measurements.rungs[rung] === 0) continue;
    say(
      `    ${rung.padEnd(12)} ${String(measurements.rungs[rung]).padStart(3)} on the rung, ` +
        `${String(measurements.carriedByRung[rung]).padStart(3)} carried`,
    );
  }
}

/**
 * `events.publisher_count >= 2`, the number ruling #12c's coverage condition
 * compares against 169. A failed read is reported rather than thrown: the
 * ledger's other numbers are still the record of the run.
 */
async function countMultiPublisher(
  client: ReturnType<typeof db>,
): Promise<{ value: number | null; error: string | null }> {
  const { count, error } = await client
    .from("events")
    .select("id", { count: "exact" })
    .gte("publisher_count", 2)
    .limit(1);
  if (error) return { value: null, error: `events: ${error.message}` };
  return { value: count, error: null };
}

/**
 * Where the ladder's line came from, so ruling #12c's "traces to stored
 * evidence" condition is a recorded fact rather than an assertion.
 *
 * The evidence rungs slice a sentence out of `article_evidence`, so the line is
 * found by containment; the stored/change/after-state rungs print an event
 * column, which is still stored data and is named as such. A coverage line is
 * built from the publisher count, and `none` has no source at all.
 */
function traceOf(
  ladder: InclusionReason,
  articles: ArticleRow[],
  unitByArticle: Map<string, string[]>,
): EventEvidence["trace"] {
  if (ladder.source === "none") return { via: "none", sources: [] };
  if (ladder.source === "coverage") return { via: "field", sources: [] };
  if (ladder.source === "stored" || ladder.source === "change" || ladder.source === "after-state") {
    return { via: "field", sources: [] };
  }
  const needle = normalizeForCompare(ladder.text);
  const sources = articles
    .filter((article) =>
      (unitByArticle.get(article.id) ?? []).some((unit) =>
        normalizeForCompare(unit).includes(needle),
      ),
    )
    .map((article) => article.sources?.name ?? article.source_id ?? "unknown");
  return { via: sources.length > 0 ? "evidence" : "none", sources: [...new Set(sources)] };
}

/** Writes the ledger, creating the directory a first run would not find. */
function writeLedger(out: string, ledger: unknown): void {
  const resolved = path.resolve(out);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(ledger, null, 2)}\n`);
}
