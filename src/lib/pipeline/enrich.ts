import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { fetchArticlePage, type FetchFailureKind } from "./article-fetch";
import { checkRobotsPermission } from "./robots";
import { extractMainText } from "./html-text";
import { selectEvidenceUnits } from "./evidence-extract";
import type { EvidenceUnit } from "@/lib/understand";
import { activeCutoff } from "./freshness";

type Db = SupabaseClient<Database>;

/**
 * Deterministic article-page enrichment: fetch an article's own public page
 * once, extract short structured facts, discard the page. See the 0090
 * migration for why this exists and what it does not do (no paywall bypass,
 * no crawling beyond URLs the pipeline already collected, no AI call).
 *
 * This is a dedicated pipeline stage, not something Read triggers -- see
 * `cron.ts`'s minute-0 slot. Opening Read never performs a network fetch.
 *
 * ---------------------------------------------------------------------------
 * Worst-case subrequest accounting (Workers free plan: 50/invocation)
 * ---------------------------------------------------------------------------
 *
 * Setup: 3 DB calls (flag check, candidate articles, existing-evidence check)
 * -- or just 1 if the flag is off, since the function returns immediately.
 *
 * Per article, worst case (a source never checked before, both robots.txt and
 * the article page redirecting the maximum allowed number of times, and the
 * fetch ultimately failing):
 *   DB:      insert claim (1) + robots-cache write (1) + finish (1)
 *            + source-failure-count write (1)                    = 4
 *   Network: robots.txt: 1 + MAX_REDIRECTS(2)                     = 3
 *            article page: 1 + MAX_REDIRECTS(2)                   = 3
 *   Subtotal per article                                          = 10
 *
 * At ENRICH_LIMIT articles per tick, all from distinct never-seen sources
 * (the same-run robots cache only helps when articles share a source, so this
 * is the true ceiling, not softened by it):
 *
 *   ENRICH_LIMIT * 10 + 3 setup  <=  50
 *
 * With ENRICH_LIMIT = 3: 3*10 + 3 = 33, leaving 17 (34%) of margin under the
 * free-plan ceiling even in this pessimal case. Raising ENRICH_LIMIT requires
 * re-doing this arithmetic, not just editing the constant.
 */

export type EnrichOptions = {
  limit?: number;
  dryRun?: boolean;
  /** Force one specific article, bypassing the feature flag -- for the CLI. */
  articleId?: string;
  now?: Date;
};

export type OutcomeReason =
  | "success"
  | "no_url_or_source"
  | "already_claimed"
  | "source_backoff"
  | "robots_blocked"
  | "robots_unknown"
  | FetchFailureKind
  | "thin_content"
  | "extraction_error";

export type ArticleOutcome = {
  articleId: string;
  decision: "enriched" | "unavailable" | "blocked" | "failed" | "skipped";
  reason: OutcomeReason;
  evidenceUnits: number;
  detail: string;
};

export type EnrichReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  enriched: number;
  blocked: number;
  unavailable: number;
  failed: number;
  skipped: number;
  evidenceUnits: number;
  /** Per-reason tally across every outcome -- the breakdown a go/no-go review needs. */
  reasons: Partial<Record<OutcomeReason, number>>;
  outcomes: ArticleOutcome[];
};

/**
 * Articles enriched per tick. See the worst-case accounting above -- this
 * number is load-bearing, not a rough guess.
 */
const ENRICH_LIMIT = 3;
/** Below this many words of extracted body text, treat the page like a paywall/thin page: fall back rather than enrich from noise. */
const MIN_USABLE_WORDS = 60;
/**
 * Consecutive enrichment failures (fetch/extraction, not robots) before a
 * source's remaining articles are skipped for the rest of this run and future
 * ones, until a success resets it. Mirrors `ingest.ts`'s `failure_count`
 * backoff in spirit -- a source that is currently broken should not have every
 * new article it publishes cost a fetch -- but as a simple threshold rather
 * than a time-based table, since each article is only ever attempted once
 * regardless of outcome (there is no retry loop to space out).
 */
const ENRICHMENT_FAILURE_THRESHOLD = 5;

type CandidateSource = {
  id: string;
  homepage: string | null;
  enrichment_allowed: boolean | null;
  enrichment_failure_count: number;
};

type Candidate = {
  id: string;
  title: string;
  url: string | null;
  sources: CandidateSource | null;
};

async function enrichmentEnabled(db: Db): Promise<boolean> {
  const { data } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "article_enrichment_enabled")
    .maybeSingle();
  return data?.enabled === true;
}

function emptyReport(now: Date): EnrichReport {
  const at = now.toISOString();
  return {
    startedAt: at,
    finishedAt: at,
    considered: 0,
    enriched: 0,
    blocked: 0,
    unavailable: 0,
    failed: 0,
    skipped: 0,
    evidenceUnits: 0,
    reasons: {},
    outcomes: [],
  };
}

export async function enrich(db: Db, options: EnrichOptions = {}): Promise<EnrichReport> {
  const now = options.now ?? new Date();
  if (!options.articleId && !(await enrichmentEnabled(db))) return emptyReport(now);

  const limit = options.limit ?? ENRICH_LIMIT;
  let query = db
    .from("articles")
    .select(
      "id, title, url, sources ( id, homepage, enrichment_allowed, enrichment_failure_count )",
    )
    .not("event_id", "is", null)
    .not("url", "is", null)
    .order("published_at", { ascending: false });
  query = options.articleId
    ? query.eq("id", options.articleId)
    : query.gte("published_at", activeCutoff(now).toISOString()).limit(limit * 4);
  const { data: candidates, error } = await query;
  if (error) throw new Error(`reading enrichment candidates: ${error.message}`);

  const rows = (candidates ?? []) as unknown as Candidate[];
  const ids = rows.map((a) => a.id);
  const existing = ids.length
    ? await db.from("article_evidence").select("article_id").in("article_id", ids)
    : { data: [] as { article_id: string }[], error: null };
  if (existing.error) throw new Error(`reading article_evidence: ${existing.error.message}`);
  const done = new Set((existing.data ?? []).map((r) => r.article_id));

  const notDone = rows.filter((a) => !done.has(a.id));
  const backedOff: Candidate[] = [];
  const eligible: Candidate[] = [];
  for (const article of notDone) {
    const failures = article.sources?.enrichment_failure_count ?? 0;
    if (!options.articleId && failures >= ENRICHMENT_FAILURE_THRESHOLD) backedOff.push(article);
    else eligible.push(article);
  }
  const todo = eligible.slice(0, limit);

  // Bounds every source's robots.txt to at most one check per run, even when
  // several of this run's articles share a domain -- without it, each would
  // independently see the same stale `enrichment_allowed: null` snapshot from
  // the query above and re-fetch robots.txt for itself.
  const robotsCache = new Map<string, RobotsCheck>();

  const outcomes: ArticleOutcome[] = backedOff.map((article) => ({
    articleId: article.id,
    decision: "skipped",
    reason: "source_backoff",
    evidenceUnits: 0,
    detail: "Source has repeated recent enrichment failures; skipping until it succeeds again",
  }));
  for (const article of todo) {
    outcomes.push(await enrichOne(db, article, options.dryRun === true, robotsCache));
  }

  const reasons: Partial<Record<OutcomeReason, number>> = {};
  for (const outcome of outcomes) reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;

  return {
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    considered: todo.length + backedOff.length,
    enriched: outcomes.filter((o) => o.decision === "enriched").length,
    blocked: outcomes.filter((o) => o.decision === "blocked").length,
    unavailable: outcomes.filter((o) => o.decision === "unavailable").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    evidenceUnits: outcomes.reduce((n, o) => n + o.evidenceUnits, 0),
    reasons,
    outcomes,
  };
}

async function enrichOne(
  db: Db,
  article: Candidate,
  dryRun: boolean,
  robotsCache: Map<string, RobotsCheck>,
): Promise<ArticleOutcome> {
  const source = article.sources;
  if (!article.url || !source) {
    return {
      articleId: article.id,
      decision: "skipped",
      reason: "no_url_or_source",
      evidenceUnits: 0,
      detail: "No URL or source",
    };
  }

  try {
    if (!dryRun) {
      // The primary key is the lock: a concurrent worker racing this article
      // loses the insert (a real Postgres unique-violation error) and the
      // article is left for a later tick, exactly as `event_understanding`
      // (0078) already does this. FakeDb cannot simulate the conflict itself
      // -- see enrich.test.ts -- but the guarantee is Postgres's, not this
      // code's, the same guarantee 0078 already relies on in production.
      const claim = await db
        .from("article_evidence")
        .insert({ article_id: article.id, status: "pending" });
      if (claim.error) {
        return {
          articleId: article.id,
          decision: "skipped",
          reason: "already_claimed",
          evidenceUnits: 0,
          detail: "Already claimed",
        };
      }
    }

    const robots = await sourceAllowed(db, source, article.url, dryRun, robotsCache);
    if (!robots.allowed) {
      if (!dryRun) await finish(db, article.id, "blocked", [], 0);
      return {
        articleId: article.id,
        decision: "blocked",
        reason: robots.reason,
        evidenceUnits: 0,
        detail:
          robots.reason === "robots_blocked"
            ? "robots.txt disallows this path"
            : "robots.txt permission could not be determined safely; not fetching",
      };
    }

    const fetched = await fetchArticlePage(article.url);
    if (!fetched.ok) {
      if (!dryRun) {
        await finish(db, article.id, "unavailable", [], 0);
        await recordSourceOutcome(db, source, false);
      }
      return {
        articleId: article.id,
        decision: "unavailable",
        reason: fetched.kind,
        evidenceUnits: 0,
        detail: fetched.reason,
      };
    }

    const mainText = extractMainText(fetched.html);
    const wordCount = mainText.trim() === "" ? 0 : mainText.trim().split(/\s+/).length;
    if (wordCount < MIN_USABLE_WORDS) {
      if (!dryRun) {
        await finish(db, article.id, "unavailable", [], wordCount);
        await recordSourceOutcome(db, source, false);
      }
      return {
        articleId: article.id,
        decision: "unavailable",
        reason: "thin_content",
        evidenceUnits: 0,
        detail: `Only ${wordCount} words of extractable text (paywall or non-article page)`,
      };
    }

    const units = selectEvidenceUnits(mainText, undefined, article.title);
    if (!dryRun) {
      await finish(db, article.id, "enriched", units, wordCount);
      await recordSourceOutcome(db, source, true);
    }
    return {
      articleId: article.id,
      decision: "enriched",
      reason: "success",
      evidenceUnits: units.length,
      detail: `${units.length} evidence units from ${wordCount} words`,
    };
  } catch (error) {
    if (!dryRun) {
      await finish(db, article.id, "failed", [], 0).catch(() => undefined);
      await recordSourceOutcome(db, source, false).catch(() => undefined);
    }
    return {
      articleId: article.id,
      decision: "failed",
      reason: "extraction_error",
      evidenceUnits: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

type RobotsCheck =
  { allowed: true } | { allowed: false; reason: "robots_blocked" | "robots_unknown" };

async function sourceAllowed(
  db: Db,
  source: CandidateSource,
  articleUrl: string,
  dryRun: boolean,
  robotsCache: Map<string, RobotsCheck>,
): Promise<RobotsCheck> {
  const cached = robotsCache.get(source.id);
  if (cached !== undefined) return cached;

  if (source.enrichment_allowed !== null) {
    const result: RobotsCheck = source.enrichment_allowed
      ? { allowed: true }
      : { allowed: false, reason: "robots_blocked" };
    robotsCache.set(source.id, result);
    return result;
  }

  let origin: string;
  let path: string;
  try {
    const url = new URL(articleUrl);
    origin = url.origin;
    path = url.pathname + url.search;
  } catch {
    const result: RobotsCheck = { allowed: false, reason: "robots_unknown" };
    robotsCache.set(source.id, result);
    return result;
  }

  const { decision, definitive } = await checkRobotsPermission(origin, path);
  const allowed = decision === "allowed";
  const result: RobotsCheck = allowed
    ? { allowed: true }
    : { allowed: false, reason: decision === "blocked" ? "robots_blocked" : "robots_unknown" };
  // Cached for the rest of THIS run regardless of definitiveness, so a batch
  // with several articles from one still-ambiguous domain does not re-fetch
  // its robots.txt for each one. Only a definitive answer is persisted to the
  // database, so an ambiguous result gets a fresh chance next run.
  robotsCache.set(source.id, result);
  if (!dryRun && definitive) {
    await db
      .from("sources")
      .update({ enrichment_allowed: allowed, robots_checked_at: new Date().toISOString() })
      .eq("id", source.id);
  }
  return result;
}

async function recordSourceOutcome(
  db: Db,
  source: CandidateSource,
  success: boolean,
): Promise<void> {
  if (success) {
    if (source.enrichment_failure_count === 0) return;
    await db.from("sources").update({ enrichment_failure_count: 0 }).eq("id", source.id);
    return;
  }
  await db
    .from("sources")
    .update({ enrichment_failure_count: source.enrichment_failure_count + 1 })
    .eq("id", source.id);
}

async function finish(
  db: Db,
  articleId: string,
  status: "enriched" | "unavailable" | "blocked" | "failed",
  evidence: EvidenceUnit[],
  wordCount: number,
): Promise<void> {
  await db
    .from("article_evidence")
    .update({
      status,
      evidence: evidence as unknown as Json,
      source_word_count: wordCount,
      extracted_at: new Date().toISOString(),
      attempts: 1,
    })
    .eq("article_id", articleId);
}

export function describeEnrich(report: EnrichReport): string {
  const reasonSummary = Object.entries(report.reasons)
    .filter(([reason]) => reason !== "success")
    .map(([reason, count]) => `${String(reason)}=${count}`)
    .join(" ");
  return (
    `enrich: ${report.enriched} enriched, ${report.blocked} blocked, ${report.unavailable} unavailable, ` +
    `${report.failed} failed, ${report.skipped} skipped, ${report.considered} considered ` +
    `(${report.evidenceUnits} evidence units)` +
    (reasonSummary ? ` [${reasonSummary}]` : "")
  );
}
