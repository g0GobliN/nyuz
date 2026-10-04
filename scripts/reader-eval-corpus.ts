/**
 * The evaluation corpus: one window of real events, measured.
 *
 *   npm run eval:corpus                     -- the default 30-day window
 *   npm run eval:corpus -- --days 7         -- a narrower window
 *   npm run eval:corpus -- --out /tmp/eval.json
 *                                           -- also write the rows, as labels
 *                                              are added to them by hand
 *
 * Why this exists. Every audit so far measured a *defect*: a duplicated card, a
 * corrupted sentence, an evidence unit that never reached a page. Those are
 * questions about the output, and the answer is either "fixed" or "still
 * present". This script answers the question that has no such answer: of the
 * stories the pipeline considered, which reached a reader, which did not, and
 * which of the withheld ones carried a signal that says they should have.
 *
 * It is a census, not a verdict. It prints the counts, the two duplicate rates
 * with their denominators, and the notable withheld stories *with the signals
 * that fired on them* — never a single "quality score", because a score would
 * invite a threshold that nobody could argue with and this corpus exists to be
 * argued with.
 *
 * Three deliberate choices, each measured on the live project before it was
 * made:
 *
 * - **Importance is a union of six observables, not one proxy.** The obvious
 *   mechanical signal is cross-outlet corroboration, and it is unusable here:
 *   `publisher_count` is 1 for 446 of 446 recent events, so it would call every
 *   story unimportant. The report prints which signals fired instead.
 * - **A row with no enriched evidence is `unevaluable`, not `unimportant`.**
 *   Counting an ingestion gap as a ranking outcome blames the reader-facing
 *   layer for a fetch that never happened.
 * - **PostgREST is read in pages of 1000, and ids are chunked before `.in()`.**
 *   An `.in()` over 400 ids silently returns no rows, which is how an earlier
 *   audit mislabelled every empty event as "no articles".
 *
 * SELECT only, service-role client, same as `db:status`. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import {
  distinctSources,
  formatRate,
  importanceSignals,
  isResearch,
  measure,
  WITHHELD_REASONS,
  withheldSignalStrength,
  type DuplicatePair,
  type EvalRow,
  type WithheldReason,
} from "@/lib/evaluation-corpus";
import { suppressDeliveredTwins, suppressStoryTwins } from "@/lib/pipeline/duplicates";
import { sameIncident } from "@/lib/pipeline/news-signals";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

/** The window's default length. A month is long enough to contain a cycle. */
const DEFAULT_DAYS = 30;
/** How many events the window is capped at, so a run stays a couple of minutes. */
const WINDOW_LIMIT = 1500;
/** PostgREST page size; a page of 1000 is the largest that reliably returns. */
const PAGE = 1000;
/** How many notable withheld stories the report prints in full. */
const NOTABLE_SHOWN = 25;
/** Duplicate pairs are only considered within this many hours of each other. */
const PAIR_WINDOW_HOURS = 48;
/** How many events may be compared pairwise. Quadratic, so this is the budget. */
const PAIR_LIMIT = 400;

type EventRow = {
  id: string;
  title: string;
  what_happened: string;
  importance: number;
  publisher_count: number;
  status: string;
  first_seen_at: string;
  material_revision: number;
};

type ArticleRow = {
  id: string;
  event_id: string | null;
  source_id: string | null;
  published_at: string | null;
};

type EvidenceRow = { article_id: string; evidence: unknown };

/**
 * Every event id any digest ever carried.
 *
 * Paged, because PostgREST caps a response at 1000 rows: a single un-paged read
 * of a table this size returns a prefix and reports no error, which is exactly
 * how "delivered" becomes a lie about the newest third of the corpus.
 */
async function deliveredEventIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const client = db();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("digest_items")
      .select("event_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`digest_items: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) ids.add(item.event_id);
    if (data.length < PAGE) break;
  }
  return ids;
}

main(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const days = Number(flag("--days") ?? DEFAULT_DAYS);
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const client = db();

  heading(`The window — the newest completed events, last ${days} days`);
  const { data: eventRows, error: eventError } = await client
    .from("events")
    .select(
      "id, title, what_happened, importance, publisher_count, status, first_seen_at, material_revision",
    )
    .eq("status", "complete")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(WINDOW_LIMIT);
  if (eventError) throw new Error(`events: ${eventError.message}`);
  const window = (eventRows ?? []) as EventRow[];
  const ids = window.map((event) => event.id);
  say(rowLine("complete events in window", window.length));
  if (window.length === 0) {
    say("nothing to measure: no completed event in this window");
    return;
  }

  /** Articles for the window, read by id in chunks — never one `.in()` over all. */
  const articles: ArticleRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, source_id, published_at")
      .in("event_id", ids.slice(i, i + 200));
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as ArticleRow[]));
  }
  say(rowLine("articles attached", articles.length));

  const articleIds = articles.map((article) => article.id);
  const evidenceByArticle = new Map<string, number>();
  for (let i = 0; i < articleIds.length; i += 200) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", articleIds.slice(i, i + 200))
      .eq("status", "enriched");
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const item of (data ?? []) as EvidenceRow[]) {
      const units = Array.isArray(item.evidence) ? item.evidence.length : 0;
      evidenceByArticle.set(item.article_id, units);
    }
  }
  say(rowLine("articles with enriched evidence", evidenceByArticle.size));

  const sourceIds = [
    ...new Set(articles.map((article) => article.source_id).filter((id): id is string => !!id)),
  ];
  const nameById = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const { data, error } = await client
      .from("sources")
      .select("id, name")
      .in("id", sourceIds.slice(i, i + 200));
    if (error) throw new Error(`sources: ${error.message}`);
    for (const source of data ?? []) nameById.set(source.id, source.name);
  }

  /** Everything ever delivered, so "never delivered" is a fact, not an inference. */
  const deliveredIds = await deliveredEventIds();

  /** Who the event was matched to, and whether that match was ever briefed. */
  const audienceById = new Map<string, number>();
  const expiredIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("user_events")
      .select("event_id, expired_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const match of data) {
      audienceById.set(match.event_id, (audienceById.get(match.event_id) ?? 0) + 1);
      if (match.expired_at) expiredIds.add(match.event_id);
    }
    if (data.length < PAGE) break;
  }

  /**
   * Topic labels for the window's events.
   *
   * Read as two flat queries rather than an embedded `topics (label)` join: the
   * generated database types do not carry that relation, and a cast to make the
   * join typecheck would be a claim about the schema that the compiler cannot
   * verify.
   */
  const topicsById = new Map<string, string[]>();
  const labelById = new Map<string, string>();
  {
    const { data, error } = await client.from("topics").select("id, label");
    if (error) throw new Error(`topics: ${error.message}`);
    for (const topic of data ?? []) labelById.set(topic.id, topic.label);
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client
      .from("event_topics")
      .select("event_id, topic_id")
      .in("event_id", ids.slice(i, i + 200));
    if (error) throw new Error(`event_topics: ${error.message}`);
    for (const item of data ?? []) {
      const label = labelById.get(item.topic_id);
      if (!label) continue;
      topicsById.set(item.event_id, [...(topicsById.get(item.event_id) ?? []), label]);
    }
  }

  /**
   * Why a story is missing.
   *
   * Four reasons, and they are repaired by four different changes, which is the
   * whole point of separating them:
   *
   *   no_evidence       an ingestion gap — enrichment never produced anything.
   *   matched_not_sent  a delivery gap — a reader was matched and never told.
   *   expired           a retirement, by design, on the match window.
   *   never_matched     a ranking judgement: no profile wanted it.
   *
   * `no_evidence` is checked first because a story with nothing to compose
   * cannot be delivered whatever the ranker decided, and `expired` before
   * `matched_not_sent` because a retired match is not a pending one.
   */
  const reasonFor = (id: string, enriched: boolean): WithheldReason => {
    if (deliveredIds.has(id)) return "delivered";
    if (!enriched) return "no_evidence";
    if (expiredIds.has(id)) return "expired";
    if ((audienceById.get(id) ?? 0) > 0) return "matched_not_sent";
    return "never_matched";
  };

  const rows: EvalRow[] = window.map((event) => {
    const coverage = articles.filter((article) => article.event_id === event.id);
    const evidenceUnits = coverage.reduce(
      (total, article) => total + (evidenceByArticle.get(article.id) ?? 0),
      0,
    );
    const enriched = evidenceUnits > 0;
    return {
      id: event.id,
      title: event.title,
      what: event.what_happened,
      importance: event.importance ?? 0,
      publisherCount: event.publisher_count ?? 0,
      status: event.status,
      sourceNames: [
        ...new Set(
          coverage
            .map((article) => nameById.get(article.source_id ?? "") ?? "")
            .filter((name) => name !== ""),
        ),
      ],
      sourceTimes: coverage
        .map((article) => article.published_at ?? "")
        .filter((value) => value !== ""),
      enriched,
      evidenceUnits,
      materialRevision: event.material_revision ?? 0,
      topics: topicsById.get(event.id) ?? [],
      audience: audienceById.get(event.id) ?? 0,
      delivered: deliveredIds.has(event.id),
      withheldReason: reasonFor(event.id, enriched),
      firstSeenAt: event.first_seen_at,
    };
  });

  const census = measure(rows);

  heading("Delivery — did the briefing carry it?");
  say(rowLine("measured events", census.measured));
  say(rowLine("delivered", census.delivered));
  say(rowLine("withheld", census.withheld));
  say(rowLine("delivery rate", formatRate(census.deliveryRate)));
  say(rowLine("no enriched evidence", formatRate(census.unevaluableRate)));

  heading("Withheld — by the reason the pipeline recorded");
  for (const bucket of census.withheldByReason) {
    if (bucket.events === 0) continue;
    say(
      rowLine(
        bucket.reason,
        `${String(bucket.events).padStart(5)}  (${bucket.withSignal} with a signal)`,
      ),
    );
  }

  heading("Notable withheld — a signal fired and no reader saw it");
  say(rowLine("withheld with a signal", census.withheldWithSignal));
  for (const entry of census.withheldNotable.slice(0, NOTABLE_SHOWN)) {
    say(
      `  [${withheldSignalStrength(entry).join(",")}] imp=${entry.importance.toFixed(0)} ` +
        `src=${distinctSources(entry)} ev=${entry.evidenceUnits} ${entry.title.slice(0, 78)}`,
    );
  }
  if (census.withheldNotable.length > NOTABLE_SHOWN) {
    say(`  … and ${census.withheldNotable.length - NOTABLE_SHOWN} more (--out writes them all)`);
  }

  heading("Research papers — did the filter earn its keep?");
  say(rowLine("papers in window", census.research.events));
  say(rowLine("delivered", census.research.delivered));
  say(rowLine("withheld with a signal", census.research.withheldWithSignal));

  heading("Revised — the story moved after it was sent");
  say(rowLine("events with material movement", census.revised.events));
  say(rowLine("of those delivered", census.revised.delivered));

  heading("Duplicates — one incident, two cards");
  const pairRows = rows.slice(0, PAIR_LIMIT);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < pairRows.length; i += 1) {
    for (let j = i + 1; j < pairRows.length; j += 1) {
      const left = pairRows[i]!;
      const right = pairRows[j]!;
      const leftAt = Date.parse(left.firstSeenAt);
      const rightAt = Date.parse(right.firstSeenAt);
      if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) continue;
      if (Math.abs(leftAt - rightAt) > PAIR_WINDOW_HOURS * 3_600_000) continue;
      if (!sameIncident(left.title, right.title)) continue;
      const sharedSources = left.sourceNames.filter((name) =>
        right.sourceNames.some((other) => other.toLowerCase() === name.toLowerCase()),
      );
      pairs.push({
        leftId: left.id,
        rightId: right.id,
        leftTitle: left.title,
        rightTitle: right.title,
        sharedSources,
        sharedEntities: [],
        sharedFigures: [],
        bothDelivered: left.delivered && right.delivered,
      });
    }
  }
  const entangled = new Set(pairs.flatMap((pair) => [pair.leftId, pair.rightId]));
  say(rowLine("events compared", pairRows.length));
  say(rowLine("pairs compared", (pairRows.length * (pairRows.length - 1)) / 2));
  say(rowLine("duplicate pairs (predicate)", pairs.length));
  say(rowLine("events entangled", entangled.size));
  say(
    rowLine(
      "event duplicate rate",
      formatRate({
        numerator: entangled.size,
        denominator: pairRows.length,
        value: entangled.size / pairRows.length,
      }),
    ),
  );

  /**
   * What the reader actually receives: the predicate's pairs, minus the ones the
   * delivery-time twin backstop collapses.
   *
   * This is the number the audit is judged on. The raw predicate count says how
   * often one incident arrives as two events; it does not say how often the
   * reader is shown two cards, because `suppressStoryTwins` and
   * `suppressDeliveredTwins` run afterwards, per briefing, and are free to drop
   * the second telling. A census that stops at the predicate would report a
   * defect the delivery path already prevents — and would keep reporting it
   * after the repair, which is how a measurement stops being evidence.
   *
   * The simulation is the real one, and it is the same two passes the digest
   * runs, in the same order: the window is cut into consecutive days, each day is
   * treated as one briefing's list in rank order, `suppressStoryTwins` collapses
   * within the day, and `suppressDeliveredTwins` then runs against the titles
   * already delivered in the preceding 48 hours. Only pairs that survive *both*
   * as two cards are counted as reader-visible.
   */
  const byDay = new Map<string, EvalRow[]>();
  for (const entry of pairRows) {
    const day = entry.firstSeenAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  const deliveredTitles: { title: string; whatHappened: string }[] = [];
  const shown: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayRows = byDay.get(day) ?? [];
    const kept = suppressDeliveredTwins(
      suppressStoryTwins(
        dayRows.map((entry) => ({
          eventId: entry.id,
          title: entry.title,
          whatHappened: entry.what,
        })),
      ),
      deliveredTitles,
    );
    const keptIds = new Set(kept.map((entry) => entry.eventId));
    for (const entry of dayRows) {
      if (keptIds.has(entry.id)) {
        shown.push(entry.id);
        deliveredTitles.push({ title: entry.title, whatHappened: entry.what });
      }
    }
  }
  const shownIds = new Set(shown);
  const visiblePairs = pairs.filter(
    (pair) => shownIds.has(pair.leftId) && shownIds.has(pair.rightId),
  );
  const visibleEntangled = new Set(visiblePairs.flatMap((pair) => [pair.leftId, pair.rightId]));
  say(rowLine("… dropped by the twin backstop", pairs.length - visiblePairs.length));
  say(rowLine("reader-visible pairs", visiblePairs.length));
  say(
    rowLine(
      "reader-visible duplicate rate",
      formatRate({
        numerator: visibleEntangled.size,
        denominator: pairRows.length,
        value: visibleEntangled.size / pairRows.length,
      }),
    ),
  );
  for (const pair of pairs.slice(0, 12)) {
    const tag = visiblePairs.includes(pair)
      ? pair.bothDelivered
        ? "BOTH SENT"
        : "VISIBLE "
      : "COLLAPSED";
    say(`  ${tag} ${pair.leftTitle.slice(0, 46)} ↔ ${pair.rightTitle.slice(0, 46)}`);
  }

  const out = flag("--out");
  if (out) {
    writeFileSync(out, `${JSON.stringify({ windowDays: days, since, census, rows }, null, 1)}\n`);
    say();
    say(`${rows.length} rows written to ${out}`);
  }

  say();
  say(`reasons counted: ${WITHHELD_REASONS.join(", ")}`);
  say(
    `signals available: ${[...new Set(rows.flatMap((entry) => importanceSignals(entry)))].sort().join(", ")}`,
  );
  say(`research recognised by the pipeline's own source family: ${rows.filter(isResearch).length}`);
});
