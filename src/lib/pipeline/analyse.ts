import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SecretBag } from "@/lib/ai/config";
import { finalizeMetadata, type NewsArticle, type Publisher } from "./news-signals";
import { topicsFor, sourceSignalsFrom, type TopicRow } from "./classify";
import { assignTags } from "./topic-assign";
import { isVcsRef } from "./shortlist";
import { activeCutoff } from "./freshness";
import {
  MATERIAL_VERSION_SCHEME,
  coverageTextOf,
  decideMaterialRevision,
  latestPublishedAt,
  materialFingerprint,
  materialState,
} from "./event-version";

/**
 * How far back an attachment can be for an old event to re-enter analysis.
 *
 * The live lane is bounded by the work horizon; this lane is bounded by how
 * recently evidence actually arrived. Without a bound, every stale dirty row in
 * the corpus would be a candidate and the lane would be a corpus scan. Two
 * weeks is long enough to cover a story that developed while a source was
 * failing and short enough that nothing is re-read twice a month for nothing.
 */
export const REENTRY_LOOKBACK_HOURS = 14 * 24;

/**
 * Share of a batch the re-entry lane may take when live work is saturating it.
 *
 * This is the 0068 guarantee expressed as arithmetic: live work can never be
 * crowded out, because it owns the batch and re-entry is confined to a quarter
 * of it. When live work is undersupplied, re-entry takes the spare capacity
 * instead, so the lane is never starved either.
 */
const REENTRY_SHARE = 0.25;

/**
 * How a batch is split between live work and material re-entry.
 *
 * The 0068 guarantee, as arithmetic: live work owns the batch, and re-entry may
 * take a quarter of it when live work is saturating the run. When live work is
 * undersupplied the spare capacity goes to re-entry instead, so the lane is
 * never starved either. Extracted so the guarantee is testable without a
 * database -- it is the one rule in this stage that must not drift.
 */
export function laneTake(limit: number, liveCount: number): { reentry: number; fromLive: number } {
  const spare = Math.max(0, limit - liveCount);
  const reserve = Math.max(1, Math.floor(limit * REENTRY_SHARE));
  const reentry = spare > 0 ? spare : reserve;
  return { reentry, fromLive: Math.max(0, limit - reentry) };
}

/** One row of the analysis queue. Named so the lane merge has a shape. */
type QueueRow = {
  id: string;
  title: string;
  first_seen_at: string;
  coverage_revision: number;
  analysed_at: string | null;
  material_fingerprint: string | null;
  material_occurrence_at: string | null;
  material_revision: number;
  last_updated_at: string;
};

const QUEUE_COLUMNS =
  "id,title,first_seen_at,coverage_revision,analysed_at,material_fingerprint,material_occurrence_at,material_revision,last_updated_at";
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
  const limit = options.limit ?? 100;
  const base = () =>
    db
      .from("events")
      .select(QUEUE_COLUMNS)
      .or(
        `metadata_dirty.eq.true,status.eq.pending,status.eq.analysing${options.retryFailed ? ",status.eq.failed" : ""}`,
      )
      .order("first_seen_at", { ascending: false });

  /**
   * The batch, in two lanes.
   *
   * The live lane is the stage exactly as it was: pending, analysing and dirty
   * events inside the work horizon, newest first. The re-entry lane is the new
   * one -- dirty events *outside* the horizon whose coverage has moved recently,
   * which before this change were selected by the predicate and then discarded
   * by the age filter a line later.
   *
   * The share is what keeps the two honest. Live work owns the batch; re-entry
   * may take a quarter of it when live work is saturating the run, and all of
   * the spare when it is not. Old work can therefore never crowd out new work --
   * the 0068 incident -- while a genuinely changed old event still reaches a
   * finalization instead of waiting for its horizon to come back, which it never
   * would.
   */
  const select = async (): Promise<QueueRow[]> => {
    if (options.eventIds?.length) {
      const pinned = await base().in("id", options.eventIds).limit(limit);
      if (pinned.error) throw new Error(pinned.error.message);
      return (pinned.data ?? []) as QueueRow[];
    }

    const cutoff = activeCutoff(now).toISOString();
    const live = await base().gte("first_seen_at", cutoff).limit(limit);
    if (live.error) throw new Error(live.error.message);
    const liveRows = (live.data ?? []) as QueueRow[];

    const take = laneTake(limit, liveRows.length).reentry;

    const reentrySince = new Date(now.getTime() - REENTRY_LOOKBACK_HOURS * 3_600_000).toISOString();
    // The same work predicate as the live lane -- pending, analysing or dirty --
    // with the horizon replaced by attachment recency. An event discovered late
    // from an old article is still work worth doing: its freshness is already
    // honest (`first_seen_at` carries the article's publication time), and the
    // digest lanes age it accordingly. What the horizon was protecting against
    // is not "an old story" but "an unbounded backlog", and the lookback plus
    // the lane share bound this one the same way.
    const reentry = await db
      .from("events")
      .select(QUEUE_COLUMNS)
      .or(
        `metadata_dirty.eq.true,status.eq.pending,status.eq.analysing${options.retryFailed ? ",status.eq.failed" : ""}`,
      )
      .lt("first_seen_at", cutoff)
      .gte("last_updated_at", reentrySince)
      .order("last_updated_at", { ascending: false })
      .limit(take);
    if (reentry.error) throw new Error(reentry.error.message);
    const reentryRows = (reentry.data ?? []) as QueueRow[];

    // When live work is undersupplied there is spare capacity and re-entry takes
    // it; when it is saturated, the reserve comes out of the tail of the live
    // page, never out of its head -- the newest live work is the work that
    // matters, and the split is arithmetic rather than a judgement call.
    const fromLive = laneTake(limit, liveRows.length).fromLive;
    return [...liveRows.slice(0, Math.max(0, fromLive)), ...reentryRows];
  };
  const [events, sourceRows, topicRows] = await Promise.all([
    select(),
    db.from("sources").select("id,name,homepage,kind,feed_url"),
    db.from("topics").select("id,slug,label,terms"),
  ]);
  for (const result of [sourceRows, topicRows])
    if (result.error) throw new Error(result.error.message);
  const sources = new Map(
    (sourceRows.data ?? []).map((source) => [source.id, source as Publisher]),
  );
  // Same haystack classify.ts folds a section signal into ("BBC Sport", etc.),
  // so this independent recompute never lands narrower than the candidates it
  // unions with below -- see topic-assign.ts and classify.ts for why.
  const sourceSignals = sourceSignalsFrom(sourceRows.data ?? []);
  const topics = (topicRows.data ?? []) as TopicRow[];
  const outcomes: EventOutcome[] = [];
  for (const event of events) {
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
      // The material decision, made once per finalization and written atomically
      // with the rest of the metadata. `storedFingerprint` is null for an event
      // that has never been measured: the first finalization adopts the state
      // and advances no revision, so nothing already delivered becomes
      // re-deliverable just because this code shipped.
      const nextFingerprint = `v${MATERIAL_VERSION_SCHEME}|${materialFingerprint(
        materialState(coverageTextOf(articles)),
      )}`;
      const material = decideMaterialRevision({
        // `?? null` rather than a bare read: a row written before 0097 has
        // neither column, and "absent" must mean "never measured", not
        // "undefined fingerprint", which would read as a material change.
        storedFingerprint: event.material_fingerprint ?? null,
        storedOccurrenceAt: event.material_occurrence_at ?? null,
        nextFingerprint,
        latestPublishedAt: latestPublishedAt(articles),
        now,
      });
      const text = articles.map((a) => a.title + " " + (a.excerpt ?? ""));
      // Once per distinct source, matching classify.ts: repeating "BBC Sport"
      // for every article would not change any match, only inflate the text.
      const seenSource = new Set<string>();
      for (const article of articles) {
        const signal =
          article.source_id === null ? undefined : sourceSignals.get(article.source_id);
        if (signal !== undefined && !seenSource.has(signal)) {
          seenSource.add(signal);
          text.push(signal);
        }
      }
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
          p_material: {
            fingerprint: material.fingerprint,
            changed: material.changed,
            occurrence_at: material.occurrenceAt,
          },
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
