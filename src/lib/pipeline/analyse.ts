import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SecretBag } from "@/lib/ai/config";
import { finalizeMetadata, type NewsArticle, type Publisher } from "./news-signals";
import { topicsFor, sourceSignalsFrom, type TopicRow } from "./classify";
import { assignTags } from "./topic-assign";
import { isVcsRef } from "./shortlist";
import { activeCutoff } from "./freshness";
import {
  coverageTextOf,
  decideMaterialRevision,
  latestPublishedAt,
  storedMaterialFingerprint,
} from "./event-version";

/**
 * How recently an old event's coverage must have changed for it to re-enter.
 *
 * Measured on `coverage_changed_at` (0102), which the attachment trigger stamps
 * in the same statement that bumps `coverage_revision` -- so this is "an article
 * attached in the last fortnight", independent of how old the event is. A
 * thirty-day-old event that gains coverage today is inside it; an event created
 * yesterday whose coverage has not moved since is inside the live lane instead.
 *
 * The bound is what keeps the lane from being a corpus scan: without it, every
 * dirty row that ever failed to finalize would be a candidate. Two weeks covers
 * a story that developed while a source was failing, and is short enough that
 * nothing is re-read for nothing.
 */
export const REENTRY_LOOKBACK_HOURS = 14 * 24;

/**
 * Share of a batch the re-entry lane may take when live work is saturating it.
 *
 * A ceiling, never a floor: see `laneTake`.
 */
export const REENTRY_SHARE = 0.25;

/**
 * How many rows the re-entry lane may take from a batch.
 *
 * The 0068 guarantee, as arithmetic, with the small-batch case stated exactly:
 *
 *   live undersupplied   re-entry may take all the spare capacity, because the
 *                        alternative is idle capacity rather than protected work
 *   live saturating      re-entry may take `floor(limit x REENTRY_SHARE)` and
 *                        not a row more -- so a batch of 1, 2 or 3 stays entirely
 *                        live, and a batch of 100 gives re-entry at most 25
 *
 * The earlier form reserved `max(1, ...)`, which handed the only slot of a
 * one-row batch to re-entry while live work was waiting -- the violation this
 * rule exists to prevent.
 *
 * Live work takes whatever re-entry does not actually use (see `analyse`), so
 * an empty re-entry lane never costs live work a slot.
 */
export function laneTake(limit: number, liveCount: number): { reentry: number; fromLive: number } {
  const size = Math.max(0, Math.floor(limit));
  const live = Math.max(0, Math.min(size, Math.floor(liveCount)));
  const spare = size - live;
  const reserve = Math.floor(size * REENTRY_SHARE);
  const reentry = spare > 0 ? spare : reserve;
  return { reentry, fromLive: size - reentry };
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
  coverage_changed_at: string;
};

const QUEUE_COLUMNS =
  "id,title,first_seen_at,coverage_revision,analysed_at,material_fingerprint,material_occurrence_at,material_revision,coverage_changed_at";
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
    if (take === 0) return liveRows.slice(0, limit);

    const reentrySince = new Date(now.getTime() - REENTRY_LOOKBACK_HOURS * 3_600_000).toISOString();
    // The same work predicate as the live lane -- pending, analysing or dirty --
    // with the horizon replaced by coverage recency. `coverage_changed_at` is
    // stamped by the attachment trigger (0102), so an event from last month that
    // gained an article today is here, and one whose coverage has not moved is
    // not, however recently it was created. An event discovered late from an old
    // article is still work worth doing: its freshness is honest
    // (`material_occurrence_at` is publication time, never this clock), and the
    // digest lanes age it accordingly. What the horizon was protecting against
    // is not "an old story" but "an unbounded backlog", and the lookback plus the
    // lane share bound this one the same way.
    const reentry = await db
      .from("events")
      .select(QUEUE_COLUMNS)
      .or(
        `metadata_dirty.eq.true,status.eq.pending,status.eq.analysing${options.retryFailed ? ",status.eq.failed" : ""}`,
      )
      .lt("first_seen_at", cutoff)
      .gte("coverage_changed_at", reentrySince)
      .order("coverage_changed_at", { ascending: false })
      .limit(take);
    if (reentry.error) throw new Error(reentry.error.message);
    const reentryRows = (reentry.data ?? []) as QueueRow[];

    // Live work takes every slot re-entry did not actually use. The reserve is a
    // ceiling on re-entry, not a hole in the batch: when the lane comes back
    // short, the live tail fills it. When it is full, the reserve comes out of
    // the tail of the live page, never its head -- the newest live work is the
    // work that matters.
    return [...liveRows.slice(0, Math.max(0, limit - reentryRows.length)), ...reentryRows];
  };
  const [events, sourceRows, topicRows] = await Promise.all([
    select(),
    db.from("sources").select("id,name,homepage,kind,feed_url"),
    db.from("topics").select("id,slug,label,kind,terms,match_spec"),
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
  const customTopicIds = new Set(topics.filter((t) => t.kind === "custom").map((t) => t.id));
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
      const nextFingerprint = storedMaterialFingerprint(coverageTextOf(articles));
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
      // Candidates are unioned in so this recompute can never land narrower
      // than classification -- except for a custom topic, whose match spec is
      // re-evaluated here on a haystack at least as wide as classification's.
      // A candidate written before the topic gained an exclusion must not become
      // a permanent `event_topics` link the reader join would honour: the spec
      // as it stands now is the authority, in this stage as in every other.
      const finalTopics = [
        ...new Set([
          ...topicIds,
          ...(candidates.data ?? []).map((t) => t.topic_id).filter((id) => !customTopicIds.has(id)),
        ]),
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
