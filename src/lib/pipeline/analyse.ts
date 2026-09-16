import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SecretBag } from "@/lib/ai/config";
import { finalizeMetadata, type NewsArticle, type Publisher } from "./news-signals";
import { topicsFor, type TopicRow } from "./classify";
import { assignTags } from "./topic-assign";
import { isVcsRef } from "./shortlist";
import { LIVE_QUEUE_HOURS, liveLaneSize } from "./freshness";
type Db = SupabaseClient<Database>;
export type AnalyseOptions = {
  limit?: number | undefined;

  eventIds?: string[] | undefined;

  dryRun?: boolean | undefined;

  retryFailed?: boolean | undefined;
  articleLimit?: number | undefined;

  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

export type EventOutcome = {
  eventId: string;
  title: string;
  decision:
    | "analysed"
    | "skipped"
    | "claimed"
    | "empty"
    | "ignored"
    | "no_demand"
    | "demand_check_failed"
    | "deferred"
    | "failed"
    | "enriched";
  articles: number;
  importance: number | null;
  novelty: number | null;
  topics: string[];

  unknownTopics: string[];
  promptTokens: number;
  completionTokens: number;
  detail: string;
};

export type AnalysisReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  analysed: number;
  failed: number;
  skipped: number;
  claimed: number;
  ignored: number;
  noDemand: number;
  demandCheckFailed: number;
  deferred: number;

  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  outcomes: EventOutcome[];
};

export async function analyse(db: Db, options: AnalyseOptions = {}): Promise<AnalysisReport> {
  const now = options.now ?? new Date();
  const base = () =>
    db
      .from("events")
      .select("id,title,first_seen_at,coverage_revision,analysed_at")
      .or(
        `metadata_dirty.eq.true,status.eq.pending,status.eq.analysing${options.retryFailed ? ",status.eq.failed" : ""}`,
      )
      .order("first_seen_at", { ascending: false });
  const select = async () => {
    const limit = options.limit ?? 100;
    if (options.eventIds?.length) return base().in("id", options.eventIds).limit(limit);
    const cutoff = new Date(now.getTime() - LIVE_QUEUE_HOURS * 3_600_000).toISOString();
    const live = await base().gte("first_seen_at", cutoff).limit(liveLaneSize(limit));
    if (live.error) return live;
    const older = await base()
      .lt("first_seen_at", cutoff)
      .order("first_seen_at", { ascending: true })
      .limit(limit - live.data.length);
    return { data: [...live.data, ...(older.data ?? [])], error: older.error };
  };
  const [events, sourceRows, topicRows] = await Promise.all([
    select(),
    db.from("sources").select("id,name,homepage,kind"),
    db.from("topics").select("id,slug,label,terms"),
  ]);
  for (const result of [events, sourceRows, topicRows])
    if (result.error) throw new Error(result.error.message);
  const sources = new Map(
    (sourceRows.data ?? []).map((source) => [source.id, source as Publisher]),
  );
  const topics = (topicRows.data ?? []) as TopicRow[];
  const outcomes: EventOutcome[] = [];
  for (const event of events.data ?? []) {
    const owner = crypto.randomUUID();
    const base: EventOutcome = {
      eventId: event.id,
      title: event.title,
      decision: "failed",
      articles: 0,
      importance: null,
      novelty: null,
      topics: [],
      unknownTopics: [],
      promptTokens: 0,
      completionTokens: 0,
      detail: "",
    };
    try {
      if (!options.dryRun) {
        const claim = await db.rpc("claim_event_finalization", {
          p_event_id: event.id,
          p_owner: owner,
        });
        if (claim.error) throw new Error(claim.error.message);
        if (!claim.data) {
          outcomes.push({ ...base, decision: "claimed" });
          continue;
        }
      }
      const articles: NewsArticle[] = [];
      for (let offset = 0; ; offset += 200) {
        const coverage = await db
          .from("articles")
          .select("id,title,excerpt,published_at,source_id,url")
          .eq("event_id", event.id)
          .order("id")
          .range(offset, offset + 199);
        if (coverage.error) throw new Error(coverage.error.message);
        articles.push(...((coverage.data ?? []) as NewsArticle[]));
        if ((coverage.data?.length ?? 0) < 200) break;
      }
      if (!articles.length || articles.every((a) => isVcsRef(a.title)))
        throw new Error("No usable news coverage");
      const metadata = finalizeMetadata(articles, sources, event.first_seen_at, now);
      const text = articles.map((a) => a.title + " " + (a.excerpt ?? ""));
      const topicIds = topicsFor(metadata, text, topics);
      const candidates = await db
        .from("event_topic_candidates")
        .select("topic_id")
        .eq("event_id", event.id);
      if (candidates.error) throw new Error(candidates.error.message);
      const finalTopics = [
        ...new Set([...topicIds, ...(candidates.data ?? []).map((t) => t.topic_id)]),
      ];
      const tags = assignTags(text.join(" "));
      if (!options.dryRun) {
        const saved = await db.rpc("finish_event_finalization", {
          p_event_id: event.id,
          p_owner: owner,
          p_revision: event.coverage_revision,
          p_metadata: { ...metadata, tags },
          p_topics: finalTopics,
        });
        if (saved.error) throw new Error(saved.error.message);
        if (!saved.data) {
          outcomes.push({ ...base, decision: "claimed", detail: "Lease replaced" });
          continue;
        }
      }
      outcomes.push({
        ...base,
        title: metadata.title,
        decision: options.dryRun ? "skipped" : "analysed",
        articles: articles.length,
        importance: metadata.importance,
        novelty: metadata.novelty,
        topics: topics.filter((t) => finalTopics.includes(t.id)).map((t) => t.label),
        detail: "Deterministic finalization",
      });
    } catch (error) {
      if (!options.dryRun) {
        const released = await db.rpc("fail_event_finalization", {
          p_event_id: event.id,
          p_owner: owner,
        });
        if (released.error) console.error("Releasing finalization:", released.error.message);
      }
      outcomes.push({ ...base, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    considered: outcomes.length,
    analysed: outcomes.filter((o) => o.decision === "analysed").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    claimed: outcomes.filter((o) => o.decision === "claimed").length,
    ignored: 0,
    noDemand: 0,
    demandCheckFailed: 0,
    deferred: 0,
    modelCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    outcomes,
  };
}
export function describeAnalysis(report: AnalysisReport): string {
  return `finalize: ${report.analysed} complete, ${report.failed} failed, ${report.claimed} held; 0 AI calls`;
}
