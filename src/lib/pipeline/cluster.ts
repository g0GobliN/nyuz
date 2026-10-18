import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SecretBag } from "@/lib/ai/config";
import type { ConfidenceVerdict } from "./confidence";
import { ACTIVE_WORK_HORIZON_HOURS, activeCutoff } from "./freshness";
import { isVcsRef, shortlist } from "./shortlist";
import { publisherKeyFor, sameHeadline, sameStory, type Publisher } from "./news-signals";
type Db = SupabaseClient<Database>;
type Unclustered = {
  id: string;
  title: string;
  published_at: string | null;
  source_id: string | null;
};
const BATCH = 100;

/** How far apart two accounts of one event may be published and still be one event. */
const MATCH_WINDOW_MS = 48 * 3_600_000;
export type ClusterOptions = {
  limit?: number | undefined;

  articleIds?: string[] | undefined;

  dryRun?: boolean | undefined;
  windowDays?: number | undefined;
  shortlistSize?: number | undefined;

  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

export type ArticleOutcome = {
  articleId: string;
  title: string;
  decision:
    | "attached" // joined an event that already existed
    | "created" // started a new event, possibly with matched siblings
    | "alone" // no shortlist or no match: its own event
    | "ignored" // a CI ref: stored, attached to a failed event, never analysed
    | "skipped" // dry run
    | "deferred" // temporary AI capacity; retry time is persisted
    | "failed";
  eventId: string | null;
  detail: string;

  candidates: number;

  siblings: number;
  promptTokens: number;
  completionTokens: number;

  shadowVerdict: ConfidenceVerdict | null;

  shadowAgreed: boolean | null;
};

export type ClusterReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  attached: number;
  created: number;
  alone: number;
  ignored: number;
  failed: number;
  deferred: number;

  modelCalls: number;
  promptTokens: number;
  completionTokens: number;

  shadowDecidable: number;

  shadowAgreed: number;

  aiSkipped: number;
  outcomes: ArticleOutcome[];
};

/**
 * The queue RPC returns `(id, title, published_at)` and nothing else, but a
 * paraphrase can only be judged across outlets, so clustering needs to know who
 * published each row. One indexed fetch for the batch, and a `null` per row on
 * failure — which costs only the paraphrase path, never the exact-match one.
 */
async function withSourceIds(
  db: Db,
  rows: { id: string; title: string; published_at: string | null }[],
): Promise<Unclustered[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("articles")
    .select("id, source_id")
    .in(
      "id",
      rows.map((row) => row.id),
    );
  if (error) {
    console.warn(`article sources: ${error.message} — paraphrase matching disabled`);
    return rows.map((row) => ({ ...row, source_id: null }));
  }
  const sourceOf = new Map((data ?? []).map((row) => [row.id, row.source_id]));
  return rows.map((row) => ({ ...row, source_id: sourceOf.get(row.id) ?? null }));
}

/**
 * The share of each clustering batch kept for the live lane; the rest drains the
 * backlog.
 *
 * `1` was passed here until 2026-10-18, and it is the reason 25,340 articles had
 * no event: the queue's backlog lane gets `batch - live_slots`, so a share of 1
 * left it exactly zero slots, and an article older than
 * `ACTIVE_WORK_HORIZON_HOURS` was never considered by any run -- not late, never.
 * Measured on the live queue the day this changed: three consecutive
 * `cluster --limit 400` runs considered 100, 38, then 0 articles, because the
 * live lane is bounded and shrinks as it drains, and the backlog (which had
 * 55 of the last six hours' news articles waiting) got no slot at all.
 *
 * The batch size is unchanged, so the stage's cost per run is unchanged -- the
 * same 100 rows are selected, only the mix moves: roughly six live rows for every
 * backlog row, which keeps breaking news ahead of old material while making the
 * backlog reachable at all. The value is the queue function's own default
 * (`5.0 / 6.0` in `priority_articles_to_cluster`), so the two agree by
 * construction rather than by coincidence.
 */
const LIVE_LANE_SHARE = 5 / 6;

async function selectArticles(db: Db, options: ClusterOptions): Promise<Unclustered[]> {
  const ids = options.articleIds;
  if (!ids || ids.length === 0) {
    const { data, error } = await db.rpc("priority_articles_to_cluster", {
      p_limit: options.limit ?? BATCH,
      p_live_hours: ACTIVE_WORK_HORIZON_HOURS,
      p_live_share: LIVE_LANE_SHARE,
      p_deadline_minutes: 120,
    });
    if (!error) return withSourceIds(db, data ?? []);
    console.warn(`demand-aware article selection: ${error.message} — using legacy selector`);
  }

  const activeSince = activeCutoff(options.now ?? new Date()).toISOString();
  let query = db
    .from("articles")
    .select("id, title, published_at, source_id")
    .is("event_id", null)
    .order("published_at", { ascending: false })
    .limit(options.limit ?? BATCH);

  if (ids && ids.length > 0) query = query.in("id", ids);
  else query = query.gte("published_at", activeSince);

  const { data, error } = await query;
  if (error) throw new Error(`selecting unclustered articles: ${error.message}`);
  return data ?? [];
}

/**
 * Publisher keys for every source, fetched once per run.
 *
 * The only thing clustering needs them for is deciding whether two articles are
 * by *different* outlets, which is the condition on which a paraphrase may merge
 * events at all. A failure leaves the map empty and `publisherOf` below then
 * answers "unknown" for every source: no paraphrase merges and the stage behaves
 * exactly as it did before this predicate existed. The asymmetry is deliberate —
 * a sources outage must cost recall, never correctness.
 */
async function loadPublishers(db: Db): Promise<Map<string, Publisher>> {
  const { data, error } = await db.from("sources").select("id,name,homepage,kind");
  if (error) {
    console.warn(`publisher lookup: ${error.message} — paraphrase matching disabled`);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.id, row as Publisher]));
}

export async function cluster(db: Db, options: ClusterOptions = {}): Promise<ClusterReport> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const [articles, publishers] = await Promise.all([
    selectArticles(db, options),
    loadPublishers(db),
  ]);

  /** Null for an unknown source, which never counts as a second outlet. */
  const publisherOf = (sourceId: string | null): string | null =>
    sourceId !== null && publishers.has(sourceId) ? publisherKeyFor(sourceId, publishers) : null;
  const crossOutlet = (left: string | null, right: string | null): boolean => {
    const a = publisherOf(left);
    const b = publisherOf(right);
    return a !== null && b !== null && a !== b;
  };
  const outcomes: ArticleOutcome[] = [];
  for (const article of articles) {
    const owner = crypto.randomUUID();
    const base: ArticleOutcome = {
      articleId: article.id,
      title: article.title,
      eventId: null,
      decision: "failed",
      candidates: 0,
      siblings: 0,
      promptTokens: 0,
      completionTokens: 0,
      shadowVerdict: null,
      shadowAgreed: null,
      detail: "",
    };
    try {
      if (!options.dryRun) {
        const claim = await db.rpc("claim_article_cluster", {
          p_article_id: article.id,
          p_owner: owner,
        });
        if (claim.error) throw new Error(claim.error.message);
        if (!claim.data) {
          outcomes.push({ ...base, decision: "deferred", detail: "Claim held" });
          continue;
        }
      }
      const candidates = isVcsRef(article.title)
        ? []
        : await shortlist(db, article, {
            size: options.shortlistSize ?? 30,
            windowDays: options.windowDays,
          });
      const matches = candidates.filter((c) => {
        if (!c.event_id) return false;
        if (!article.published_at || !c.published_at) return false;
        if (
          Math.abs(Date.parse(article.published_at) - Date.parse(c.published_at)) > MATCH_WINDOW_MS
        )
          return false;
        if (sameHeadline(article.title, c.title)) return true;
        // A paraphrase only counts when it comes from a *different* publisher.
        // Same publisher is the next take rather than a second source, and the
        // templated feeds that pair off with themselves — advisory listings,
        // paper feeds, a wire's own rewrites — are the corpus's most reliable
        // false merge. Two outlets that share a homepage are the same publisher.
        return crossOutlet(article.source_id, c.source_id) && sameStory(article.title, c.title);
      });
      const nearIdentical = matches.some((c) => sameHeadline(article.title, c.title));
      const matchedEvents = new Set(
        matches.map((c) => c.event_id).filter((id): id is string => id !== null),
      );
      // An article that matches two events is evidence that those events are one
      // story, and a third row is the one outcome that is certainly wrong. This
      // corpus printed one arrest three times exactly that way: the first account
      // landed alone, the second's wording matched nothing, and the third then
      // matched both existing events and -- under the old `=== 1` rule -- created
      // a third event. Attaching to the best-ranked match keeps the briefing to
      // one card per story; collapsing the event rows themselves is the merge
      // backfill's job, not something to invent here.
      const target = matches[0]?.event_id ?? null;
      const ignored = isVcsRef(article.title);
      if (options.dryRun) {
        outcomes.push({
          ...base,
          decision: "skipped",
          candidates: candidates.length,
          detail: target ? "Would attach" : "Would create separate event",
        });
        continue;
      }
      const result = await db.rpc("finish_article_cluster", {
        p_article_id: article.id,
        p_owner: owner,
        p_event_id: target,
        p_ignored: ignored,
      });
      if (result.error) throw new Error(result.error.message);
      outcomes.push({
        ...base,
        decision: result.data ? (ignored ? "ignored" : target ? "attached" : "alone") : "deferred",
        eventId: result.data,
        candidates: candidates.length,
        detail: target
          ? nearIdentical
            ? "Near-identical reporting"
            : matchedEvents.size > 1
              ? `Cross-outlet paraphrase; ${matchedEvents.size} events matched`
              : "Cross-outlet paraphrase"
          : "Conservative separate event",
      });
    } catch (error) {
      outcomes.push({ ...base, detail: error instanceof Error ? error.message : String(error) });
      if (!options.dryRun)
        await db.rpc("release_article_cluster", { p_article_id: article.id, p_owner: owner });
    }
  }
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: outcomes.length,
    attached: outcomes.filter((o) => o.decision === "attached").length,
    created: 0,
    alone: outcomes.filter((o) => o.decision === "alone").length,
    ignored: outcomes.filter((o) => o.decision === "ignored").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    deferred: outcomes.filter((o) => o.decision === "deferred").length,
    modelCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    shadowDecidable: 0,
    shadowAgreed: 0,
    aiSkipped: outcomes.length,
    outcomes,
  };
}
export function describeCluster(report: ClusterReport): string {
  return `cluster: ${report.attached} attached, ${report.alone} separate, ${report.failed} failed; 0 AI calls`;
}
