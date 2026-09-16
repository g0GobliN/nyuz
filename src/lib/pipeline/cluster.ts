import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SecretBag } from "@/lib/ai/config";
import type { ConfidenceVerdict } from "./confidence";
import { LIVE_LANE_DENOMINATOR, LIVE_LANE_NUMERATOR, LIVE_QUEUE_HOURS } from "./freshness";
import { isVcsRef, shortlist } from "./shortlist";
import { sameHeadline } from "./news-signals";
type Db = SupabaseClient<Database>;
type Unclustered = { id: string; title: string; published_at: string | null };
const BATCH = 100;
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

async function selectArticles(db: Db, options: ClusterOptions): Promise<Unclustered[]> {
  const ids = options.articleIds;
  if (!ids || ids.length === 0) {
    const { data, error } = await db.rpc("priority_articles_to_cluster", {
      p_limit: options.limit ?? BATCH,
      p_live_hours: LIVE_QUEUE_HOURS,
      p_live_share: LIVE_LANE_NUMERATOR / LIVE_LANE_DENOMINATOR,
      p_deadline_minutes: 120,
    });
    if (!error) return data ?? [];
    console.warn(`demand-aware article selection: ${error.message} — using legacy selector`);
  }

  const sevenDaysAgo = new Date(
    (options.now ?? new Date()).getTime() - 7 * 24 * 60 * 60_000,
  ).toISOString();
  let query = db
    .from("articles")
    .select("id, title, published_at")
    .is("event_id", null)
    .order("published_at", { ascending: false })
    .limit(options.limit ?? BATCH);

  if (ids && ids.length > 0) query = query.in("id", ids);
  else query = query.gt("published_at", sevenDaysAgo);

  const { data, error } = await query;
  if (error) throw new Error(`selecting unclustered articles: ${error.message}`);
  return data ?? [];
}

export async function cluster(db: Db, options: ClusterOptions = {}): Promise<ClusterReport> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const articles = await selectArticles(db, options);
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
      const matches = candidates.filter(
        (c) =>
          c.event_id &&
          sameHeadline(article.title, c.title) &&
          article.published_at &&
          c.published_at &&
          Math.abs(Date.parse(article.published_at) - Date.parse(c.published_at)) <= 48 * 3_600_000,
      );
      const ids = [
        ...new Set(matches.map((c) => c.event_id).filter((id): id is string => id !== null)),
      ];
      const target = ids.length === 1 ? ids[0]! : null;
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
        detail: target ? "Near-identical reporting" : "Conservative separate event",
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
