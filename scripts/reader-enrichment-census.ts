/**
 * Why 89.9% of the evaluation window has no enriched evidence.
 *
 *   npm run audit:enrichment                  -- the default 30-day window
 *   npm run audit:enrichment -- --days 7      -- a narrower window
 *   npm run audit:enrichment -- --out /tmp/enrichment.json
 *
 * The evaluation corpus reports the alarm; this script produces the diagnosis.
 * The number alone cannot distinguish four mechanisms that are repaired by four
 * different changes — or by none at all — so this reads every article in the
 * window and attributes it to exactly one family:
 *
 *   never_attempted   no `article_evidence` row: enrichment never reached it
 *   pending           claimed and never finished: a run died mid-flight
 *   blocked           robots.txt disallows the path — correct, not a defect
 *   unreachable       the page never fetched
 *   thin_content      fetched, but under the usable-words floor (paywall, video)
 *   extraction_empty  enough words, zero units — the family that is real loss
 *   failed            the pass threw
 *   covered           usable evidence reached the reader
 *
 * `blocked` is a boundary this project keeps on purpose and `thin_content` is a
 * property of the source, so a report that lumps them in with the others would
 * send the next change to the wrong file.
 *
 * `never_attempted`, `extraction_empty`, `pending` and `failed` are the families
 * *worth attributing* -- not four families of fixable stories. The arbiter ruled
 * on 2026-10-11 (D6) that this distinction has to survive into the report: on the
 * 30-day window of that date, 267 of the 285 `never_attempted` events were
 * `never_matched`, i.e. outside both dispatch arms by design, so the honest
 * estimate of the dispatchable remainder was nearer 198 than 465 -- and even that
 * is an estimate, because eligibility for a retry does not prove a retry recovers
 * usable evidence. Run `npm run audit:enrichment:cause` for the attribution.
 *
 * It writes nothing to the database: SELECT only, service-role client, same as
 * `db:status`. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import {
  census,
  formatPercent,
  type ArticleRow,
  type EnrichmentStatus,
  type EventRow,
} from "@/lib/enrichment-census";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

/** The window's default length, matching the evaluation corpus. */
const DEFAULT_DAYS = 30;
/** How many events the window is capped at, so a run stays a couple of minutes. */
const WINDOW_LIMIT = 1000;
/** PostgREST page size. */
const PAGE = 1000;
/** Ids per `.in()`; over 400 PostgREST silently returns nothing. */
const CHUNK = 200;

type EventDbRow = {
  id: string;
  title: string;
  importance: number;
  first_seen_at: string;
};

type ArticleDbRow = {
  id: string;
  event_id: string | null;
};

type EvidenceDbRow = {
  article_id: string;
  status: string;
  evidence: unknown;
  source_word_count: number | null;
};

/** Reads a whole table in pages, because PostgREST caps a response at 1000 rows. */
async function pageAll<T>(table: "digest_items" | "user_events", columns: string): Promise<T[]> {
  const client = db();
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
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

  heading(`The window — completed events from the last ${days} days`);
  const { data: eventRows, error: eventError } = await client
    .from("events")
    .select("id, title, importance, first_seen_at")
    .eq("status", "complete")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(WINDOW_LIMIT);
  if (eventError) throw new Error(`events: ${eventError.message}`);
  const events = (eventRows ?? []) as EventDbRow[];
  const ids = events.map((event) => event.id);
  say(rowLine("complete events in window", events.length));
  if (events.length === 0) {
    say("nothing to measure: no completed event in this window");
    return;
  }

  /** Articles for the window, read by id in chunks. */
  const articles: ArticleDbRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as ArticleDbRow[]));
  }
  say(rowLine("articles attached", articles.length));

  /**
   * Evidence rows, including the ones that do not exist.
   *
   * A left join in PostgREST terms: every article is looked up, and an article
   * with no row is recorded as `status: null`. Reading only existing rows is the
   * mistake this script exists to avoid — the missing rows are the
   * `never_attempted` family, and they are the largest one.
   */
  const evidenceByArticle = new Map<string, EvidenceDbRow>();
  const articleIds = articles.map((article) => article.id);
  for (let i = 0; i < articleIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status, evidence, source_word_count")
      .in("article_id", articleIds.slice(i, i + CHUNK));
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const item of (data ?? []) as EvidenceDbRow[])
      evidenceByArticle.set(item.article_id, item);
  }
  say(rowLine("evidence rows present", evidenceByArticle.size));

  /** Events ever delivered, and events matched to a reader. */
  const delivered = new Set(
    (await pageAll<{ event_id: string }>("digest_items", "event_id")).map((r) => r.event_id),
  );
  const matched = new Set(
    (await pageAll<{ event_id: string }>("user_events", "event_id")).map((r) => r.event_id),
  );

  const rows: EventRow[] = events.map((event) => ({
    eventId: event.id,
    articles: articles
      .filter((article) => article.event_id === event.id)
      .map((article): ArticleRow => {
        const evidence = evidenceByArticle.get(article.id);
        return {
          articleId: article.id,
          status: (evidence?.status as EnrichmentStatus | undefined) ?? null,
          evidenceUnits: Array.isArray(evidence?.evidence) ? evidence.evidence.length : 0,
          wordCount: evidence?.source_word_count ?? 0,
        };
      }),
  }));

  /** The importance signal that matters here: the pipeline's own high band. */
  const notable = new Set(events.filter((event) => (event.importance ?? 0) >= 7).map((e) => e.id));
  const result = census(rows, notable);

  heading("Coverage");
  say(rowLine("events measured", result.events));
  say(rowLine("with usable evidence", result.covered));
  say(rowLine("with none", result.uncovered));
  say(rowLine("no articles at all", result.noArticles));
  say(
    rowLine(
      "covered rate",
      `${formatPercent(result.coveredRate)} (${result.coveredRate.numerator}/${result.coveredRate.denominator})`,
    ),
  );

  heading("Why the uncovered events have none — by event");
  for (const bucket of result.buckets) {
    if (bucket.events === 0) continue;
    say(rowLine(bucket.absence, bucket.events));
  }

  heading("Why the articles have none — by article");
  for (const entry of result.articlesByAbsence) {
    if (entry.articles === 0) continue;
    say(rowLine(entry.absence, entry.articles));
  }

  heading("How much of this is fixable");
  const fixable = result.buckets
    .filter((bucket) =>
      ["never_attempted", "extraction_empty", "pending", "failed"].includes(bucket.absence),
    )
    .reduce((sum, bucket) => sum + bucket.events, 0);
  const boundary = result.buckets
    .filter((bucket) => ["blocked", "thin_content", "unreachable"].includes(bucket.absence))
    .reduce((sum, bucket) => sum + bucket.events, 0);
  // Called "families worth attributing" and not "fixable", per the arbiter's
  // ruling of 2026-10-11 on D6. The earlier label read as "this many stories can
  // be recovered", and it is not that: the largest family inside it,
  // `never_attempted`, is dominated by events nobody was ever matched to and
  // whose articles are older than the 72-hour fallback arm -- permanently outside
  // the enrich stage's dispatch arms by design. Running more ticks cannot reach
  // them, and the deliberate cost boundary is the point rather than the loss.
  // The attribution is the second stage's job (`audit:enrichment:cause`), so this
  // report names it instead of guessing which share is really dispatchable.
  say(rowLine("families worth attributing", fixable));
  say(rowLine("boundaries, not defects", boundary));
  say(rowLine("uncovered carrying importance>=7", result.uncoveredNotable));
  say(
    "  Not a count of recoverable stories: eligibility for a retry does not prove that retrying\n" +
      "  recovers usable evidence, and `never_attempted` includes events no dispatch rule targets.\n" +
      "  Attribute that family with `npm run audit:enrichment:cause` before reading any of it as loss.",
  );

  heading("The uncovered events, by importance");
  const uncoveredIds = new Set(
    rows
      .filter(
        (entry) => !entry.articles.some((a) => a.status === "enriched" && a.evidenceUnits > 0),
      )
      .map((entry) => entry.eventId),
  );
  for (const event of events
    .filter((entry) => uncoveredIds.has(entry.id))
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 20)) {
    const family = rows.find((entry) => entry.eventId === event.id)?.articles.length
      ? ""
      : "no-articles";
    say(
      `  imp=${(event.importance ?? 0).toFixed(0)} ` +
        `${delivered.has(event.id) ? "DELIVERED" : matched.has(event.id) ? "matched" : "         "} ` +
        `${family} ${event.title.slice(0, 74)}`,
    );
  }

  const out = flag("--out");
  if (out) {
    writeFileSync(out, `${JSON.stringify({ windowDays: days, since, result, rows }, null, 1)}\n`);
    say();
    say(`${rows.length} rows written to ${out}`);
  }
});
