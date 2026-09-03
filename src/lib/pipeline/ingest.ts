/**
 * One ingestion run: fetch the active feeds, store the articles that are new.
 *
 * ---------------------------------------------------------------------------
 * The properties this run has to hold
 * ---------------------------------------------------------------------------
 *
 * **One dead feed does not stall a run.** Every source is fetched, parsed and
 * written independently, and a failure of any kind is recorded against that
 * source and nothing else. No exception from one feed can reach the loop.
 *
 * **A second run over an unchanged feed writes nothing.** `articles.url` is
 * unique, so the insert is an upsert that ignores duplicates and Postgres decides
 * what is new — this never asks first. Re-running is free and idempotent, which
 * matters because it is the only way to be sure a scheduled run that half
 * finished can simply be run again.
 *
 * **A feed that keeps failing gets left alone for longer, then switched off.**
 * `sources.failure_count` and `sources.last_fetched_at` already exist for this;
 * see BACKOFF below. Nothing about this needed a new column.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does not do
 * ---------------------------------------------------------------------------
 *
 * It does not fetch article pages. A feed's own excerpt is what gets stored, and
 * it is enough for clustering and scoring — following every link would multiply
 * the request count by fifty and make the run a crawler, with all the robots.txt
 * and rate-limit obligations that implies.
 *
 * It does not cluster, score or match. Those are separate stages with separate
 * costs, and keeping ingestion free of model calls is what makes it safe to run
 * often.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalUrl, contentHash } from "./canonical";
import { parseFeed, type FeedItem } from "./feed";
import { fetchFeed, mapLimit } from "./fetch";
import { isVcsRef } from "./shortlist";
import type { Database, Source } from "@/lib/supabase/types";

export type Db = SupabaseClient<Database>;

/**
 * How long to wait after each consecutive failure, in minutes.
 *
 * The index is `failure_count`, so the first failure buys a quarter of an hour
 * and the fifth buys a day. Capped rather than exponential forever: a feed that
 * has been down a fortnight is still worth one request a day, because publishers
 * do fix things, and a run that has already fetched sixty other feeds is not
 * inconvenienced by one more.
 */
const BACKOFF = [0, 15, 60, 240, 720, 1440] as const;

/**
 * Consecutive failures before a source is switched off automatically.
 *
 * With the schedule above, eight failures is a bit over five days of trying. An
 * operator sees it in the console with its failure count and reason attached, and
 * re-enabling from there clears the count — `setSourceActive` in
 * src/lib/server/sources.ts does that deliberately, so a fixed feed starts clean.
 */
const DISABLE_AFTER = 8;

/**
 * Do not re-fetch a healthy feed more often than this.
 *
 * The cron runs hourly, which is the real interval; this exists so that running
 * the pipeline by hand four times while developing does not hammer sixty
 * publishers, and so the schedule can be tightened later without changing
 * anything else. `--force` bypasses it.
 */
const MIN_INTERVAL_MINUTES = 30;

/**
 * Articles older than this are read and thrown away.
 *
 * Feeds are not consistent about how much history they serve: OpenAI's returns
 * over a thousand items going back years, Hugging Face's over eight hundred. All
 * of it would be stored on the first run and every one of those rows would then
 * arrive at stage 3 as a clustering candidate — which is the one place in this
 * pipeline that costs money per article.
 *
 * A month is the window because it is comfortably longer than the 72 hours stage
 * 6 needs for a day-one backfill, and long enough that late coverage of a
 * three-week-old story still finds its event to attach to. It is not longer
 * because nobody's morning briefing is improved by a post from 2019.
 *
 * Items with no date at all are kept: a feed that omits `pubDate` is common, and
 * refusing those would silently drop whole sources.
 */
const MAX_AGE_DAYS = 30;

/** Feeds fetched at once. Same reasoning as `check:feeds`: fast, and not a burst. */
const CONCURRENCY = 8;

/**
 * How long a source keeps being collected after its last reader stops wanting
 * it (docs/plan2.md §10).
 *
 * Three days, because the failure this prevents is thrash, not waste. A reader
 * muting a topic on Friday and unmuting it on Monday must not produce a
 * weekend-shaped hole in that source's coverage — and re-collecting a paused
 * source cannot recover what it published while nobody was reading, because a
 * feed only serves its current window.
 *
 * Erring long is cheap (a few fetches of something nobody reads); erring short
 * is a coverage gap that looks exactly like a bug.
 */
const DEMAND_GRACE_HOURS = 72;

/**
 * A database call failed, as opposed to a feed failing.
 *
 * The distinction is not academic. `sources.failure_count` is a claim about a
 * publisher — that their feed did not work — and eight of them switches the source
 * off. A PostgREST request that failed says nothing about the feed, and charging it
 * to the source would eventually disable a working publisher over a fault of ours.
 *
 * This exists because of a real one. Rock Paper Shotgun failed on the second run
 * with `Reading stored hashes: TypeError: fetch failed` against a feed that had
 * just been fetched and parsed perfectly — see `byUrlLength` for what it turned out
 * to be. Two runs had already charged it to the feed before anyone looked.
 *
 * So storage errors are reported, and the source's count is left alone.
 */
class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Runs a database call, once more if it fails.
 *
 * One retry, not a policy, and deliberately not a backoff: this is for a dropped
 * connection, which succeeds immediately on a second attempt. Anything that fails
 * twice is a real problem and should surface as one.
 *
 * Note what it cannot do. A request that is malformed, too large, or forbidden
 * fails identically both times, and the retry buys nothing but a second failure —
 * `TypeError: fetch failed` reads the same either way. So a repeat failure here is
 * worth reading as a bug in the caller before it is read as a bad network.
 */
async function storage<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await run();
    } catch {
      throw new StorageError(`${label}: ${first instanceof Error ? first.message : String(first)}`);
    }
  }
}

export type IngestOptions = {
  /** Restrict the run to specific sources. Empty or absent means all active ones. */
  sourceIds?: string[] | undefined;
  /** Ignore both the backoff and the minimum interval. For operators, not for cron. */
  force?: boolean | undefined;
  /** Fetch and parse, write nothing. */
  dryRun?: boolean | undefined;
  /** Stop after this many sources. Absent means no limit. */
  limit?: number | undefined;
  concurrency?: number | undefined;
  maxAgeDays?: number | undefined;
  /** How long a source keeps being collected after its last reader leaves. */
  graceHours?: number | undefined;
  /** Injected so tests and reports agree on one instant. */
  now?: Date | undefined;
};

export type SourceOutcome = {
  sourceId: string;
  name: string;
  feedUrl: string;
  state:
    | "ingested" // fetched, parsed, and something was new
    | "unchanged" // fetched and parsed, nothing new
    | "waiting" // not fetched: backoff or minimum interval
    | "no_demand" // gate on, nobody has wanted this for the grace period
    | "failed" // could not fetch or could not parse
    | "quiet"; // valid feed, no entries, and it said today would be like that
  detail: string;
  /** Items the feed offered. */
  seen: number;
  /** Items with no usable URL or title, or older than the window. */
  dropped: number;
  inserted: number;
  /** Already stored, and the publisher has since changed the headline. */
  retitled: number;
  failureCount: number;
  disabled: boolean;
};

export type IngestReport = {
  startedAt: string;
  finishedAt: string;
  /** Active sources considered before backoff. */
  considered: number;
  attempted: number;
  inserted: number;
  retitled: number;
  failed: number;
  disabled: number;
  /** Sources skipped because nobody currently wants them. Zero when the gate is off. */
  skippedNoDemand: number;
  outcomes: SourceOutcome[];
};

export async function ingest(db: Db, options: IngestOptions = {}): Promise<IngestReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();

  const all = await selectSources(db, options);
  const { wanted, reasons } = await applyDemandGate(db, all, options);
  const cadence = await loadCadence(db, options);

  const due =
    options.force === true
      ? wanted
      : wanted.filter((s) => isDue(s, now, cadence.get(s.polling_tier)));
  const window = due.slice(0, options.limit ?? due.length);
  const attempted = new Set(window);
  const backedOff = new Set(due);
  const skipped = all.filter((source) => !wanted.includes(source));

  const outcomes = await mapLimit(window, options.concurrency ?? CONCURRENCY, (source) =>
    runOne(db, source, now, options),
  );

  const waiting: SourceOutcome[] = wanted
    .filter((source) => !attempted.has(source))
    .map((source) => ({
      sourceId: source.id,
      name: source.name,
      feedUrl: source.feed_url,
      state: "waiting",
      detail: backedOff.has(source) ? "over the limit for this run" : waitingReason(source, now),
      seen: 0,
      dropped: 0,
      inserted: 0,
      retitled: 0,
      failureCount: source.failure_count,
      disabled: false,
    }));

  const unwanted: SourceOutcome[] = skipped.map((source) => ({
    sourceId: source.id,
    name: source.name,
    feedUrl: source.feed_url,
    state: "no_demand",
    // The reason comes from SQL rather than being reconstructed here, so what
    // the report says is what the query actually decided (plan2 §20:
    // selection must be observable, not just deterministic).
    detail: reasons.get(source.id) ?? "no demand",
    seen: 0,
    dropped: 0,
    inserted: 0,
    retitled: 0,
    failureCount: source.failure_count,
    disabled: false,
  }));

  const reported = [...outcomes, ...waiting, ...unwanted];

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: all.length,
    attempted: outcomes.length,
    inserted: sum(reported, (o) => o.inserted),
    retitled: sum(reported, (o) => o.retitled),
    failed: reported.filter((o) => o.state === "failed").length,
    disabled: reported.filter((o) => o.disabled).length,
    skippedNoDemand: unwanted.length,
    outcomes: reported,
  };
}

/**
 * Narrows a run to sources somebody currently wants.
 *
 * Two things happen here, in this order, and the order matters. The demand
 * timestamps are refreshed FIRST, so the gate reads current interest rather
 * than whatever the last run left behind — a reader who added a topic an hour
 * ago should not wait a cycle for their source to become eligible.
 *
 * The refresh runs even when the gate is off: `last_demand_at` fills either
 * way, so the numbers can be inspected in the console before any behaviour
 * depends on them. That is the same sequencing phases 4 and 8 used, and it is
 * what makes turning the flag on a decision rather than a gamble.
 *
 * Fails open. If the RPCs are missing (0031 not applied) or error, the run
 * collects everything, exactly as it did before this existed. A collection
 * pipeline that silently stops collecting is a far worse failure than one
 * that ignores an optimisation.
 */
/**
 * Per-tier fetch intervals, in minutes, or an empty map.
 *
 * Empty means "one interval for everything", which is what `isDue` falls back
 * to and what this pipeline did before phase 6. So a missing flag, a missing
 * 0032, or a failed read all degrade to the previous uniform behaviour rather
 * than to no collection.
 *
 * The tiers are recomputed first, for the same reason demand is: a source that
 * published an hour ago should be read on its new cadence now, not next run.
 */
async function loadCadence(db: Db, options: IngestOptions): Promise<Map<string, number>> {
  const uniform = new Map<string, number>();
  if (options.force === true) return uniform;

  const { error: recomputeError } = await db.rpc("recompute_polling_tiers");
  if (recomputeError) {
    console.warn(`recomputing polling tiers: ${recomputeError.message} — uniform cadence`);
    return uniform;
  }

  const { data: flag } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "adaptive_polling")
    .maybeSingle();
  if (flag?.enabled !== true) return uniform;

  const { data, error } = await db.from("polling_tiers").select("tier, interval_minutes");
  if (error) {
    console.warn(`reading polling tiers: ${error.message} — uniform cadence`);
    return uniform;
  }

  return new Map((data ?? []).map((row) => [row.tier, row.interval_minutes]));
}

async function applyDemandGate(
  db: Db,
  sources: Source[],
  options: IngestOptions,
): Promise<{ wanted: Source[]; reasons: Map<string, string> }> {
  const open = { wanted: sources, reasons: new Map<string, string>() };

  // `--source` names specific feeds; an operator asking for one by name has
  // supplied the demand themselves. Same reasoning as `--event` bypassing
  // the analysis claim gate.
  if (options.sourceIds && options.sourceIds.length > 0) return open;
  if (options.force === true) return open;

  const { error: refreshError } = await db.rpc("refresh_source_demand");
  if (refreshError) {
    console.warn(`refreshing source demand: ${refreshError.message} — collecting everything`);
    return open;
  }

  const { data: flag } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "demand_driven_sources")
    .maybeSingle();
  if (flag?.enabled !== true) return open;

  const { data, error } = await db.rpc("sources_to_collect", {
    p_grace_hours: options.graceHours ?? DEMAND_GRACE_HOURS,
  });
  if (error) {
    console.warn(`selecting sources by demand: ${error.message} — collecting everything`);
    return open;
  }

  const eligible = new Set<string>();
  const reasons = new Map<string, string>();
  for (const row of data ?? []) {
    reasons.set(row.source_id, row.reason);
    if (row.eligible) eligible.add(row.source_id);
  }

  return { wanted: sources.filter((s) => eligible.has(s.id)), reasons };
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

async function selectSources(db: Db, options: IngestOptions): Promise<Source[]> {
  let query = db.from("sources").select("*").eq("active", true);

  const ids = options.sourceIds;
  if (ids && ids.length > 0) query = query.in("id", ids);

  // Most-neglected first. If a run is cut short — a Worker hitting its CPU limit,
  // an operator pressing ctrl-c — the feeds that have waited longest are the ones
  // that got served, and `last_fetched_at` makes the next run pick up where this
  // one stopped without any state of its own.
  const { data, error } = await query
    .order("last_fetched_at", { ascending: true, nullsFirst: true })
    .order("name");

  if (error) throw new Error(`Reading sources: ${error.message}`);
  return data ?? [];
}

/**
 * Whether this source is allowed a request yet.
 *
 * A source that has never been fetched is always due, which is what makes the
 * first run fetch everything.
 *
 * `cadence` is the per-source interval when adaptive polling is on (phase 6),
 * and absent when it is off — in which case every source shares
 * `MIN_INTERVAL_MINUTES`, exactly as before. Backoff always wins: a failing
 * feed waits its backoff even if its tier says `hot`, because the tier is a
 * statement about how often the source *publishes* and the backoff is a
 * statement about whether it currently *answers*.
 */
export function isDue(source: Source, now: Date, cadence?: number | undefined): boolean {
  if (source.last_fetched_at === null) return true;

  const last = Date.parse(source.last_fetched_at);
  if (Number.isNaN(last)) return true;

  const index = Math.min(source.failure_count, BACKOFF.length - 1);
  const wait = Math.max(BACKOFF[index] ?? 0, cadence ?? MIN_INTERVAL_MINUTES);
  return now.getTime() - last >= wait * 60_000;
}

function waitingReason(source: Source, now: Date): string {
  if (source.last_fetched_at === null) return "never fetched";

  const minutes = Math.round((now.getTime() - Date.parse(source.last_fetched_at)) / 60_000);
  if (source.failure_count === 0) return `fetched ${minutes} minutes ago`;
  return `fetched ${minutes} minutes ago, backing off after ${source.failure_count} failures`;
}

/* ---------------------------------------------------------------------- */
/* One source                                                             */
/* ---------------------------------------------------------------------- */

async function runOne(
  db: Db,
  source: Source,
  now: Date,
  options: IngestOptions,
): Promise<SourceOutcome> {
  const base = {
    sourceId: source.id,
    name: source.name,
    feedUrl: source.feed_url,
    seen: 0,
    dropped: 0,
    inserted: 0,
    retitled: 0,
    failureCount: source.failure_count,
    disabled: false,
  };

  // Nothing in here is allowed to throw past this point. A single feed that
  // returns something pathological must cost this source its turn and no more.
  try {
    const response = await fetchFeed(source.feed_url);

    if (!response.ok) {
      const failure = await recordFailure(db, source, response.reason, now, options);
      return { ...base, ...failure, state: "failed", detail: response.reason };
    }

    const feed = parseFeed(response.body);

    if (feed.items.length === 0) {
      // A publisher that told us it does not publish today is not failing. All
      // five arXiv feeds do this at the weekend, and counting it as a failure
      // would back them off and eventually switch them off for being correct.
      const today = WEEKDAYS[now.getUTCDay()];
      if (today !== undefined && feed.skipDays.includes(today)) {
        const note = await recordSuccess(db, source, now, options);
        return {
          ...base,
          failureCount: 0,
          state: "quiet",
          detail: note ?? `no entries, skipDays: ${today}`,
        };
      }

      // Otherwise it is a failure, and the distinction matters: HTML served with
      // a feed's content type is a moved URL, and a genuinely empty channel is a
      // feed nobody has posted to. Both should back off; only the first is worth
      // an operator's attention, so the reason says which.
      const reason = /<html[\s>]/i.test(response.body.slice(0, 2000))
        ? "HTML served in place of a feed"
        : `${feed.format} feed with no entries${feed.dropped > 0 ? `, ${feed.dropped} unusable` : ""}`;

      const failure = await recordFailure(db, source, reason, now, options);
      return { ...base, ...failure, state: "failed", detail: reason, dropped: feed.dropped };
    }

    const rows = await toRows(feed.items, source.id, now, options.maxAgeDays ?? MAX_AGE_DAYS);
    const dropped = feed.dropped + (feed.items.length - rows.length);

    if (options.dryRun === true) {
      // `inserted` carries what *would* be written. It is the only number worth
      // having from a dry run, and reporting zero here while the detail line said
      // "11 storable" read as a contradiction. The caller is responsible for
      // saying it was a dry run; `ingest` is not going to lie about the count.
      return {
        ...base,
        failureCount: 0,
        state: rows.length > 0 ? "ingested" : "unchanged",
        seen: feed.items.length,
        dropped,
        inserted: rows.length,
        detail: `${feed.format}, ${feed.items.length} items`,
      };
    }

    const written = await store(db, rows);
    // Only a genuinely new article counts as new content. A re-read that
    // inserts nothing means the source has not published since last time,
    // which is exactly the signal the cadence decay in
    // `recompute_polling_tiers` reads.
    const note = await recordSuccess(db, source, now, options, written.inserted > 0);

    return {
      ...base,
      failureCount: 0,
      state: written.inserted > 0 || written.retitled > 0 ? "ingested" : "unchanged",
      seen: feed.items.length,
      dropped,
      inserted: written.inserted,
      retitled: written.retitled,
      detail: note ?? `${feed.format}, ${feed.items.length} items`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    // A storage failure is ours, not the publisher's. Reported as a failed source
    // for this run, but the failure count and the backoff are untouched — the feed
    // did nothing wrong and must not be switched off for our network.
    if (error instanceof StorageError) {
      return { ...base, state: "failed", detail: reason };
    }

    const failure = await recordFailure(db, source, reason, now, options).catch(() => ({
      failureCount: source.failure_count + 1,
      disabled: false,
    }));
    return { ...base, ...failure, state: "failed", detail: reason };
  }
}

/** `getUTCDay()` order, matching the names RSS uses in `<skipDays>`. */
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/* ---------------------------------------------------------------------- */
/* Rows                                                                   */
/* ---------------------------------------------------------------------- */

type ArticleRow = {
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  published_at: string | null;
  content_hash: string;
};

/**
 * Feed items to article rows, canonicalised, hashed, and deduplicated against
 * each other.
 *
 * The within-batch deduplication is not optional. A feed listing the same story
 * twice — once under a category path and once under the front page — is common,
 * and two rows with the same canonical URL in one upsert payload is a conflict
 * Postgres has to resolve inside a single statement.
 */
async function toRows(
  items: FeedItem[],
  sourceId: string,
  now: Date,
  maxAgeDays: number,
): Promise<ArticleRow[]> {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const byUrl = new Map<string, ArticleRow>();

  for (const item of items) {
    const url = canonicalUrl(item.link);
    if (url === null) continue;

    // CI branch tags are not news. They have already cost a fifth of the analysis
    // bill; dropping them here means they never become an event. Version tags
    // (`v8.2.2`) are kept — those are releases.
    if (isVcsRef(item.title)) continue;

    // No date is kept; a date outside the window is not. `toIso` has already
    // refused anything implausibly far in the future.
    if (item.publishedAt !== null && Date.parse(item.publishedAt) < cutoff) continue;

    if (byUrl.has(url)) continue;

    byUrl.set(url, {
      source_id: sourceId,
      url,
      title: item.title,
      author: item.author,
      excerpt: item.excerpt,
      published_at: item.publishedAt,
      content_hash: await contentHash(url, item.title),
    });
  }

  return [...byUrl.values()];
}

/** Rows written at once. Comfortably under any statement or payload limit. */
const BATCH = 200;

async function store(db: Db, rows: ArticleRow[]): Promise<{ inserted: number; retitled: number }> {
  let inserted = 0;
  let retitled = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    // `ignoreDuplicates` is `on conflict (url) do nothing`, and with a select it
    // returns only the rows Postgres actually inserted. So the count is exact and
    // no query had to ask what was already there — which is the whole point of
    // the unique constraint.
    const data = await storage("Writing articles", async () => {
      const result = await db
        .from("articles")
        .upsert(batch, { onConflict: "url", ignoreDuplicates: true })
        .select("url");

      if (result.error) throw new Error(result.error.message);
      return result.data;
    });

    const newUrls = new Set((data ?? []).map((row) => row.url));
    inserted += newUrls.size;

    const existing = batch.filter((row) => !newUrls.has(row.url));
    retitled += await updateRetitled(db, existing);
  }

  return { inserted, retitled };
}

/**
 * Articles already stored whose headline the publisher has since changed.
 *
 * This is the one thing `content_hash` does that the unique URL does not: it says
 * whether a row that already exists still matches what the feed is serving. A
 * corrected headline, or a live story whose title keeps being sharpened, arrives
 * this way.
 *
 * Restricted to articles not yet attached to an event, deliberately. Rewriting
 * the title of an article an event was built from would leave the event's own
 * analysis describing text that is no longer there, and re-analysing to fix that
 * would break the property the whole product is priced on: an event is understood
 * once. Before clustering, a better title is a better input; after it, the event
 * is the record and the article is history.
 */
async function updateRetitled(db: Db, rows: ArticleRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let changed = 0;

  // Chunked by count rather than by encoded length: these travel in a POST body,
  // so the request-line limit that `byUrlLength` exists to dodge does not apply.
  // The cap is only to keep one payload from becoming unreasonably large.
  for (let i = 0; i < rows.length; i += RETITLE_BATCH) {
    const batch = rows.slice(i, i + RETITLE_BATCH).map((row) => ({
      url: row.url,
      title: row.title,
      excerpt: row.excerpt,
      author: row.author,
      content_hash: row.content_hash,
    }));

    changed += await storage("Applying retitles", async () => {
      const result = await db.rpc("update_retitled_articles", { p_rows: batch });
      if (result.error) throw new Error(result.error.message);
      return Number(result.data ?? 0);
    });
  }

  return changed;
}

/**
 * The maximum encoded length of one `url=in.(…)` filter, in characters.
 *
 * A PostgREST filter travels in the request URL, and a request URL has a size
 * limit — 16KB at Supabase, and as little as 8KB at any nginx in front of
 * something. Exceeding it does not return an HTTP error a caller can read: the
 * server gives up on the request line and the client reports
 * `TypeError: fetch failed`, cause `UND_ERR_HEADERS_OVERFLOW`.
 *
 * 4000 leaves room for the rest of the URL and for a stricter proxy than the one
 * we happen to talk to today. It is not tuned to the limit, because being close
 * to the limit is what caused this.
 */
export const URL_FILTER_BUDGET = 4000;

/**
 * Retitled articles sent to `update_retitled_articles` in one call.
 *
 * Unrelated to `URL_FILTER_BUDGET`: these go in a POST body, which has no
 * request-line limit, so this bounds payload size rather than avoiding an
 * overflow. Retitles per run are normally in the single digits, so this is only
 * reached during a burst.
 */
const RETITLE_BATCH = 500;

/**
 * Article URLs grouped so that no single `in.(…)` filter can overflow.
 *
 * Grouped by encoded length rather than by count, because feed URLs are not
 * remotely uniform and a count that is safe for one publisher is not safe for
 * another. Rock Paper Shotgun serves 100 items per fetch with slugs up to 201
 * characters — the whole plot of the game in the URL — which came to a 17,082
 * character request and failed every time. Most feeds would fit ten times over.
 *
 * A single URL longer than the budget still gets its own group: a filter that
 * cannot be split is better attempted than silently dropped, and at 4000 the
 * request still has 12KB of headroom before Supabase's own limit.
 *
 * Exported for the test. The invariants are worth locking because getting them
 * wrong is not visible from the outside: a dropped group means headline updates
 * silently stop happening, and an oversized group means the failure this exists
 * to prevent, charged to whichever publisher happens to write long slugs.
 */
export function byUrlLength(urls: string[]): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  let length = 0;

  for (const url of urls) {
    // Quoted and comma-separated inside `in.(…)`, then percent-encoded.
    const cost = encodeURIComponent(url).length + 3;

    if (group.length > 0 && length + cost > URL_FILTER_BUDGET) {
      groups.push(group);
      group = [];
      length = 0;
    }

    group.push(url);
    length += cost;
  }

  if (group.length > 0) groups.push(group);
  return groups;
}

/* ---------------------------------------------------------------------- */
/* Source bookkeeping                                                     */
/* ---------------------------------------------------------------------- */

async function recordSuccess(
  db: Db,
  source: Source,
  now: Date,
  options: IngestOptions,
  foundNewContent = false,
): Promise<string | null> {
  if (options.dryRun === true) return null;

  try {
    const { error } = await db
      .from("sources")
      .update({
        last_fetched_at: now.toISOString(),
        failure_count: 0,
        // Left alone when nothing new arrived, deliberately: this column is
        // "when did this source last publish", not "when did we last look".
        // Stamping it on every successful fetch would make every source look
        // permanently fresh and the cadence would never decay.
        ...(foundNewContent ? { last_new_content_at: now.toISOString() } : {}),
      })
      .eq("id", source.id);

    // Returned rather than thrown. The articles are already stored; treating a
    // failed bookkeeping write as a feed failure would count a failure against a
    // feed that worked perfectly, and back it off for it. The only real cost of
    // this going wrong is the source being re-fetched sooner than it needed to be,
    // so it is reported and the run carries on.
    return error ? `stored, but could not update the source row: ${error.message}` : null;
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return `stored, but could not update the source row: ${message}`;
  }
}

/**
 * Counts a failure, backs the source off, and switches it off once it is clear
 * the address itself is wrong.
 *
 * `last_fetched_at` is written on a failure too. It means "last attempted" in
 * practice, and the backoff needs a reference point — without it a permanently
 * broken feed would be retried on every single run forever.
 */
async function recordFailure(
  db: Db,
  source: Source,
  reason: string,
  now: Date,
  options: IngestOptions,
): Promise<{ failureCount: number; disabled: boolean }> {
  const failureCount = source.failure_count + 1;
  const disabled = failureCount >= DISABLE_AFTER;

  if (options.dryRun === true) return { failureCount, disabled: false };

  const { error } = await db
    .from("sources")
    .update({
      last_fetched_at: now.toISOString(),
      failure_count: failureCount,
      ...(disabled ? { active: false } : {}),
    })
    .eq("id", source.id);

  if (error) throw new Error(`Recording failure for ${source.name}: ${error.message}`);

  if (disabled) {
    // The console's own actions all leave an audit row; a scheduled run that
    // removes a source from the pipeline is held to the same standard. Without
    // this, a feed would simply stop appearing with nothing to explain why.
    await db.from("admin_audit_log").insert({
      actor_id: null,
      actor_email: "pipeline:ingest",
      action: "source.disable",
      target_type: "source",
      target_id: source.id,
      meta: { reason, failure_count: failureCount, feed_url: source.feed_url },
    });
  }

  return { failureCount, disabled };
}
