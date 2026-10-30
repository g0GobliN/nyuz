/**
 * The Leg A funnel audit: where a delivered "Why it matters" line dies.
 *
 *   npm run audit:significance-leg-a [--editions N] [--out FILE]
 *
 * Task t_27cc9ccb (Significance Leg A) step 1: for the last delivered
 * editions, classify EVERY item into where the line died, and print counts —
 * not prose. The classification itself lives beside the ladder it reads
 * (`src/lib/pipeline/significance-leg-a.ts`); what lives here is only the
 * reading of the database and the printing of the table.
 *
 * Population: the newest delivered briefings (`kind = 'briefing'`,
 * `status = 'sent'`, at least one item — the same shape the
 * significance-window audit reads) and every `digest_items` row in them.
 * One edition per scheduled slot: the same edition reaching several readers
 * is one edition read ahead, not a second measurement, but every item row in
 * it is classified.
 *
 * The four buckets, mutually exclusive, deepest-death-first:
 *
 *   composed        a rung other than coverage justified a line from the
 *                   event's stored facts
 *   rung-refused    a shape exists in stored evidence but the ladder's own
 *                   guards refused it (fragment, short clause, prose gates,
 *                   standalone guards, relative clause, why-vs-what gate)
 *   no-shape        stored material exists but nothing in it carries a shape
 *                   the ladder may print (money with nothing saying what it
 *                   does is here — ruling #10 removed that rung)
 *   no-evidence     nothing is stored at all: zero enriched evidence units,
 *                   no stored impact, no before/after state
 *
 * A coverage-count line ("Four publishers reported this.") is recorded as
 * `coverage eligible`, never as a composed line — the ruling of 2026-10-23: a
 * source count dressed as significance is not a significance line, and on the
 * audited edition it sat directly above the card's own "Based on N sources".
 *
 * Read-only: writes no database row and calls no model. `--out` (default
 * `docs/audits/significance-leg-a.json`, git-tracked on purpose — the decision
 * note's appendix) holds the per-item evidence.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifySignificanceItem } from "../src/lib/pipeline/significance-leg-a";
import { db, fail, heading, main, row, say } from "./lib/db";

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

const CHUNK = 100;

function chunks<T>(values: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
};

const EDITIONS = Math.max(1, Number.parseInt(flag("--editions") ?? "3", 10) || 3);
const DEFAULT_OUT = "docs/audits/significance-leg-a.json";
const STAGES = ["composed", "rung-refused", "no-shape", "no-evidence"] as const;

main(async () => {
  const client = db();

  // ------------------------------------------------------------ the editions
  const { data: digestData, error: digestError } = await client
    .from("digests")
    .select("digest_id, user_id, status, scheduled_for, generated_at, item_count")
    .eq("kind", "briefing")
    .eq("status", "sent")
    .gte("item_count", 1)
    .order("generated_at", { ascending: false })
    .limit(EDITIONS * 8);
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  const digests = (digestData ?? []) as DigestRow[];
  if (digests.length === 0) fail("no delivered briefing with items found to audit");

  // One edition per scheduled slot, newest first: rows already arrive
  // generated_at-desc, so the first distinct EDITIONS slots are the newest,
  // and the population below is the digests of those slots only.
  const bySlot = new Map<string, DigestRow[]>();
  const slotOrder: string[] = [];
  for (const digest of digests) {
    if (!slotOrder.includes(digest.scheduled_for)) slotOrder.push(digest.scheduled_for);
    if (slotOrder.indexOf(digest.scheduled_for) < EDITIONS)
      bySlot.set(digest.scheduled_for, [...(bySlot.get(digest.scheduled_for) ?? []), digest]);
  }
  for (const slot of slotOrder.slice(0, EDITIONS)) if (!bySlot.has(slot)) bySlot.set(slot, []);
  const slots = slotOrder.slice(0, EDITIONS);
  const scoped = slots.flatMap((slot) => bySlot.get(slot) ?? []);
  const digestOf = new Map(scoped.map((digest) => [digest.digest_id, digest] as const));

  // --------------------------------------------------------------- items
  const digestIds = [...digestOf.keys()];
  const items: ItemRow[] = [];
  for (const batch of chunks(digestIds)) {
    const { data, error } = await client
      .from("digest_items")
      .select("digest_id, event_id, position, why_it_matters")
      .in("digest_id", batch)
      .order("position", { ascending: true });
    if (error) throw new Error(`digest_items: ${error.message}`);
    items.push(...((data ?? []) as ItemRow[]));
  }

  // --------------------------------------------------------------- events
  const eventIds = [...new Set(items.map((item) => item.event_id))];
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
    for (const impact of (data ?? []) as { event_id: string; text: string | null }[])
      impacts.set(impact.event_id, impact.text ?? null);
  }

  const articles: { id: string; event_id: string | null; url: string | null }[] = [];
  for (const batch of chunks(eventIds)) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, url")
      .in("event_id", batch);
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(
      ...((data ?? []) as { id: string; event_id: string | null; url: string | null }[]),
    );
  }

  const unitsByArticle = new Map<string, string[]>();
  for (const batch of chunks(articles.map((article) => article.id))) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", batch)
      .eq("status", "enriched");
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const unit of (data ?? []) as { article_id: string; evidence: unknown }[]) {
      const rows = Array.isArray(unit.evidence)
        ? (unit.evidence as unknown as { text?: unknown }[])
        : [];
      const texts = rows
        .map((item) => item?.text)
        .filter((text): text is string => typeof text === "string" && text.trim() !== "");
      if (texts.length > 0) unitsByArticle.set(unit.article_id, texts);
    }
  }

  const storyEvidence = new Map<string, string[]>();
  for (const article of articles) {
    if (!article.event_id) continue;
    const texts = unitsByArticle.get(article.id);
    if (texts !== undefined)
      storyEvidence.set(article.event_id, [
        ...(storyEvidence.get(article.event_id) ?? []),
        ...texts,
      ]);
  }

  // The enrich-stage attribution, event-level: why a delivered event carries
  // no evidence at all — no article, a URL-less article, an article never
  // attempted, an attempt that ended blocked/unavailable/failed, or rows that
  // enriched to zero units. The digest build reads only `status='enriched'`
  // rows with texts; this section asks what the stage did with the same
  // event's articles, so the table below can name the input that is missing.
  const attempts = new Map<string, { article_id: string; status: string | null }[]>();
  for (const batch of chunks(articles.map((article) => article.id))) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status")
      .in("article_id", batch);
    if (error) throw new Error(`article_evidence statuses: ${error.message}`);
    for (const attempt of (data ?? []) as { article_id: string; status: string | null }[])
      attempts.set(attempt.article_id, [...(attempts.get(attempt.article_id) ?? []), attempt]);
  }
  const articleOf = new Map(articles.map((article) => [article.id, article] as const));

  // ------------------------------------------------- one classification per item
  type Classified = ReturnType<typeof classifySignificanceItem> & {
    digestId: string;
    scheduledFor: string;
    position: number;
    eventId: string;
    title: string;
    /** The stored units the ladder read — the appendix needs the prose. */
    units: string[];
    /** The event's own paragraph — the why-vs-what gate's other side. */
    whatHappened: string | null;
  };
  const classified: Classified[] = [];
  for (const item of items) {
    const event = events.get(item.event_id);
    if (event === undefined) continue;
    const digest = digestOf.get(item.digest_id);
    classified.push({
      ...classifySignificanceItem({
        storedImpact: impacts.get(item.event_id) ?? null,
        beforeState: event.before_state,
        afterState: event.after_state,
        evidence: storyEvidence.get(item.event_id) ?? [],
        sourceCount: event.publisher_count ?? 0,
        title: event.title,
        whatHappened: event.what_happened ?? null,
        deliveredLine: item.why_it_matters,
      }),
      digestId: item.digest_id,
      scheduledFor: digest?.scheduled_for ?? "unknown",
      position: item.position,
      eventId: item.event_id,
      title: event.title,
      units: storyEvidence.get(item.event_id) ?? [],
      whatHappened: event.what_happened,
    });
  }

  // ------------------------------------------------------------ the table
  heading(`Leg A funnel — the last ${slots.length} delivered edition(s)`);
  say(`slots read                   ${slots.join(" · ")}`);
  say(`briefings                    ${digestIds.length}`);
  say(`events                       ${eventIds.length}`);
  say(`items classified             ${classified.length}`);

  const ofItems = new Map<string, number>();
  for (const item of classified) {
    ofItems.set(`stage ${item.stage}`, (ofItems.get(`stage ${item.stage}`) ?? 0) + 1);
    ofItems.set(
      item.deliveredCarried ? "carried a line" : "delivered silent",
      (ofItems.get(item.deliveredCarried ? "carried a line" : "delivered silent") ?? 0) + 1,
    );
    if (item.justified)
      ofItems.set(
        item.deliveredCarried ? "carried and justified" : "justified but not carried",
        (ofItems.get(
          item.deliveredCarried ? "carried and justified" : "justified but not carried",
        ) ?? 0) + 1,
      );
    if (item.coverageEligible)
      ofItems.set("coverage eligible", (ofItems.get("coverage eligible") ?? 0) + 1);
    if (item.rung === "coverage")
      ofItems.set("ladder says coverage only", (ofItems.get("ladder says coverage only") ?? 0) + 1);
  }
  say("");
  heading("Per edition (all rows counted, one classification per item)");
  for (const slot of slots) {
    const rows = classified.filter((item) => item.scheduledFor === slot);
    const counts = STAGES.map(
      (stage) => `${stage} ${rows.filter((r) => r.stage === stage).length}`,
    );
    say(`${slot}  items ${rows.length}  ${counts.join(" · ")}`);
  }
  say("");
  heading("The funnel, all editions");
  for (const stage of STAGES) say(row(`stage ${stage}`, ofItems.get(`stage ${stage}`) ?? 0));
  say("");
  say(row("coverage eligible", ofItems.get("coverage eligible") ?? 0));
  say(row("ladder says coverage only", ofItems.get("ladder says coverage only") ?? 0));
  say(row("carried a line", ofItems.get("carried a line") ?? 0));
  say(row("delivered silent", ofItems.get("delivered silent") ?? 0));
  say(row("carried and justified", ofItems.get("carried and justified") ?? 0));
  say(row("justified but not carried", ofItems.get("justified but not carried") ?? 0));

  // ------------------------------------------------ refusal reasons, event-level
  // One refusal per event (an event delivered twice died the same way twice).
  const eventClassified = new Map<string, Classified>();
  for (const item of classified)
    if (!eventClassified.has(item.eventId)) eventClassified.set(item.eventId, item);
  const refusals = new Map<string, number>();
  for (const item of eventClassified.values())
    for (const candidate of item.candidates) {
      if (candidate.refusal === null) continue;
      const key = `${candidate.rung}:${candidate.refusal}`;
      refusals.set(key, (refusals.get(key) ?? 0) + 1);
    }
  say("");
  heading("Where a refused shape died (events, losing refusal of the first candidate)");
  if (refusals.size === 0) say("(none — no event died inside a guard)");
  for (const [key, count] of [...refusals.entries()].sort((a, b) => b[1] - a[1]))
    say(`${key.padEnd(40)} ${count}`);

  // ------------------------------------------- no-evidence attribution, event-level
  // For every event the funnel put in `no-evidence`, what the enrich stage
  // actually has on its articles: no article at all, a URL-less article,
  // never attempted, non-enriched attempts (blocked/unavailable/failed), or
  // an `enriched` row whose extraction wrote zero units.
  const noEvidenceEvents = [...eventClassified.values()].filter(
    (item) => item.stage === "no-evidence",
  );
  const causes = new Map<string, number>();
  for (const item of noEvidenceEvents) {
    const eventArticles = articles.filter((article) => article.event_id === item.eventId);
    if (eventArticles.length === 0) {
      causes.set("events with no articles", (causes.get("events with no articles") ?? 0) + 1);
      continue;
    }
    const withUrl = eventArticles.filter((article) => (article.url ?? "").trim() !== "");
    if (withUrl.length === 0) {
      causes.set(
        "articles but none has a URL",
        (causes.get("articles but none has a URL") ?? 0) + 1,
      );
      continue;
    }
    const evidenceRows = withUrl.flatMap((article) => attempts.get(article.id) ?? []);
    if (evidenceRows.length === 0) {
      causes.set(
        "URL present, never attempted",
        (causes.get("URL present, never attempted") ?? 0) + 1,
      );
      continue;
    }
    const enriched = evidenceRows.filter((row) => row.status === "enriched");
    if (enriched.length > 0) {
      causes.set(
        "enriched rows extracted zero units",
        (causes.get("enriched rows extracted zero units") ?? 0) + 1,
      );
      continue;
    }
    const byStatus = new Map<string, number>();
    for (const row of evidenceRows)
      byStatus.set(row.status ?? "none", (byStatus.get(row.status ?? "none") ?? 0) + 1);
    for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1]))
      causes.set(
        `attempted, not enriched: ${status}`,
        (causes.get(`attempted, not enriched: ${status}`) ?? 0) + count,
      );
  }
  say("");
  heading("Why no-evidence events carry no evidence (enrich-stage attribution, event-level)");
  if (causes.size === 0) say("(no no-evidence events)");
  for (const [key, count] of [...causes.entries()].sort((a, b) => b[1] - a[1]))
    say(`${key.padEnd(46)} ${count}`);
  const evidenceBearing = [...eventClassified.values()].filter((item) => item.evidenceUnits > 0);
  say(
    `${"events with stored evidence".padEnd(46)} ${evidenceBearing.length}` +
      ` (of ${eventClassified.size} = ${(100 * evidenceBearing.length) / Math.max(1, eventClassified.size)}%)`,
  );

  // ------------------------------------------------------------ the ledger
  const out = flag("--out") ?? DEFAULT_OUT;
  const dir = path.dirname(out);
  if (dir !== ".") mkdirSync(dir, { recursive: true });
  const stages = Object.fromEntries(
    STAGES.map((stage) => [stage, ofItems.get(`stage ${stage}`) ?? 0]),
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    editionsRequested: EDITIONS,
    slots,
    population: { briefings: digestIds.length, events: eventIds.length, items: classified.length },
    perEdition: Object.fromEntries(
      slots.map((slot) => {
        const rows = classified.filter((item) => item.scheduledFor === slot);
        return [
          slot,
          Object.fromEntries(
            STAGES.map((stage) => [stage, rows.filter((r) => r.stage === stage).length]),
          ),
        ];
      }),
    ),
    stages,
    totals: Object.fromEntries(ofItems),
    refusalReasons: Object.fromEntries(refusals),
    items: classified,
  };
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  say("");
  say(`ledger ${out}`);
});
