/**
 * When a followed subject needs discovery, and the one place a job is created.
 *
 * ---------------------------------------------------------------------------
 * The decision, stated once
 * ---------------------------------------------------------------------------
 *
 * A topic needs discovery when all three of these are true:
 *
 *   1. the flag is on,
 *   2. no source is mapped to the topic in `source_topics` -- nothing is being
 *      collected for it, and
 *   3. no job for it is open, and none finished inside the cooldown window.
 *
 * The third is the coverage test and it is deliberately the cheapest possible
 * one. `source_topics` is the same table `refresh_source_demand` reads, so
 * "mapped" means exactly "this subject keeps a feed collected"; a topic with a
 * mapped source is not a gap, whatever its briefing currently contains. The
 * alternative -- counting events or articles per topic on every save -- would
 * be a fuzzy test of a question the collection system already answers, run on
 * the hot path of onboarding.
 *
 * ---------------------------------------------------------------------------
 * Topic-level, shared, and never per reader
 * ---------------------------------------------------------------------------
 *
 * `discovery_jobs` has a partial unique index on open rows per topic (0096).
 * That is not a nicety: it is what makes "a thousand readers following Rust"
 * produce one job. Two readers following the same new subject in the same
 * minute race on the insert, one wins, and the loser records the same
 * in-flight reason it would have computed anyway. No application check can
 * promise that across two Worker invocations; the index can.
 *
 * ---------------------------------------------------------------------------
 * Safe by construction for the caller
 * ---------------------------------------------------------------------------
 *
 * `queueDiscoverySafely` is what the preferences save path calls. It performs
 * no network request, awaits only PostgREST round trips, and swallows every
 * error into a log line: a reader's topic save must never fail because
 * discovery could not be queued. The job runs later, on its own cron tick,
 * where a failure costs a retry and nothing else.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * How long one topic waits after a discovery attempt before another is queued.
 *
 * A day, because a successful attempt usually yields several candidates that
 * take further ticks to resolve and register, and because the thing this
 * protects is a search budget, not freshness: a topic with no result today
 * will have no result in the next hour either. Retries of a *failed* job are
 * handled by the job's own `next_attempt_at`, not by this cooldown.
 */
export const COOLDOWN_HOURS = 24;

/**
 * Topics considered per enqueue pass. Bounded because this runs on the save
 * path as well as in the cron, and because four fresh subjects is already more
 * than one invocation needs to keep up with a signup wave.
 */
export const MAX_TOPICS_PER_ENQUEUE = 4;

/** The latest follow rows read to find subjects that need coverage. */
export const FOLLOW_READ_LIMIT = 200;

export type CoverageTopic = {
  id: string;
  label: string;
};

export type GapFacts = {
  /** At least one source is mapped to the topic in `source_topics`. */
  hasSourceLink: boolean;
  /**
   * The cadence reading says this subject has gone unusually quiet *for itself*
   * (`cadence.ts`). A mapped source proves something is collected; it does not
   * prove the subject is still producing, and a feed can die quietly for
   * months while remaining mapped.
   *
   * Optional, and absent means "not stale": every existing caller and test keeps
   * the meaning it had, which is the conservative reading.
   */
  staleCoverage?: boolean;
  /** A job for this topic is pending or running. */
  hasOpenJob: boolean;
  /** When the most recent job for this topic was created, in ms. */
  lastJobAtMs: number | null;
  nowMs: number;
};

export type GapDecision =
  { queue: true } | { queue: false; reason: "covered" | "in-flight" | "cooling-down" };

/**
 * The pure decision. Every rule is here so it is the same rule in a test as in
 * production, and so the report can say *why* nothing was queued.
 */
export function gapFor(facts: GapFacts): GapDecision {
  if (facts.hasSourceLink && facts.staleCoverage !== true) {
    return { queue: false, reason: "covered" };
  }
  if (facts.hasOpenJob) return { queue: false, reason: "in-flight" };
  if (facts.lastJobAtMs !== null && facts.nowMs - facts.lastJobAtMs < COOLDOWN_HOURS * 3_600_000) {
    return { queue: false, reason: "cooling-down" };
  }
  return { queue: true };
}

export type EnqueueResult = {
  considered: number;
  queued: number;
  skipped: number;
  reason: "ok" | "disabled";
  detail: string;
};

/**
 * Queues discovery for any of these topics that have no coverage.
 *
 * Never throws for a single topic: a refused insert is either the unique index
 * saying another invocation got there first (in-flight, which is fine) or a
 * real database error, which is logged and reported. The caller decides
 * whether that is worth surfacing; in the cron it never is.
 */
export async function enqueueDiscoveryForTopics(
  db: Db,
  topics: CoverageTopic[],
  options: { now?: Date } = {},
): Promise<EnqueueResult> {
  const now = options.now ?? new Date();
  const wanted = topics.slice(0, MAX_TOPICS_PER_ENQUEUE);
  const base: EnqueueResult = {
    considered: wanted.length,
    queued: 0,
    skipped: 0,
    reason: "ok",
    detail: "",
  };
  if (wanted.length === 0) return { ...base, detail: "no followed custom topics" };

  const { data: flag, error: flagError } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "source_discovery_enabled")
    .maybeSingle();
  if (flagError) {
    console.warn(`discovery: reading the feature flag failed: ${flagError.message}`);
    return { ...base, reason: "disabled", detail: "flag could not be read; discovery stays off" };
  }
  if (flag?.enabled !== true) {
    return { ...base, reason: "disabled", detail: "source_discovery_enabled is off" };
  }

  const ids = wanted.map((topic) => topic.id);
  const [links, jobs] = await Promise.all([
    db.from("source_topics").select("topic_id").in("topic_id", ids),
    db
      .from("discovery_jobs")
      .select("topic_id, status, created_at")
      .in("topic_id", ids)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (links.error) console.warn(`discovery: reading coverage failed: ${links.error.message}`);
  if (jobs.error) console.warn(`discovery: reading job history failed: ${jobs.error.message}`);

  const covered = new Set((links.data ?? []).map((row) => row.topic_id));
  const open = new Set<string>();
  const latest = new Map<string, number>();
  for (const job of jobs.data ?? []) {
    if (job.status === "pending" || job.status === "running") open.add(job.topic_id);
    const at = Date.parse(job.created_at);
    if (!Number.isNaN(at) && (latest.get(job.topic_id) ?? 0) < at) latest.set(job.topic_id, at);
  }

  let queued = 0;
  let skipped = 0;

  for (const topic of wanted) {
    const decision = gapFor({
      hasSourceLink: covered.has(topic.id),
      hasOpenJob: open.has(topic.id),
      lastJobAtMs: latest.get(topic.id) ?? null,
      nowMs: now.getTime(),
    });

    if (!decision.queue) {
      skipped += 1;
      continue;
    }

    const { error } = await db.from("discovery_jobs").insert({
      topic_id: topic.id,
      status: "pending",
      next_attempt_at: now.toISOString(),
    });

    if (error) {
      // The partial unique index (0096) refuses a second open job for a topic.
      // That is the shared-discovery race resolving correctly, not a failure.
      if (error.code === "23505") {
        skipped += 1;
        continue;
      }
      console.warn(`discovery: queueing a job for "${topic.label}" failed: ${error.message}`);
      continue;
    }

    queued += 1;
  }

  return {
    considered: wanted.length,
    queued,
    skipped,
    reason: "ok",
    detail:
      queued === 0
        ? `${skipped} topic(s) skipped: covered, in flight or cooling down`
        : `${queued} job(s) queued from ${wanted.length} topic(s)`,
  };
}

/**
 * The save-path entry point: queue, log, and never throw.
 *
 * `savePreferences` calls this after a reader adds a custom interest. The
 * await is a handful of database round trips at most -- no provider call, no
 * feed fetch, no model -- which is what "queue asynchronously" means here: the
 * job runs on the next discovery tick, minutes later, while onboarding and the
 * first briefing carry on with whatever the corpus already holds.
 */
export async function queueDiscoverySafely(
  db: Db,
  topics: CoverageTopic[],
  options: { now?: Date } = {},
): Promise<EnqueueResult | null> {
  if (topics.length === 0) return null;
  try {
    return await enqueueDiscoveryForTopics(db, topics, options);
  } catch (error) {
    console.warn(`discovery: queueing after a topic save failed: ${String(error)}`);
    return null;
  }
}

/**
 * The custom topics followed recently, newest follow first.
 *
 * This is the scan the discovery stage runs before its queue pass. Reading
 * `user_topics` newest-first means a subject somebody added a minute ago is
 * found on the next tick, which is the "discovery should be immediate"
 * requirement satisfied without touching the save path at all -- the save
 * path's own enqueue is an optimisation on top of this, not its replacement.
 *
 * Bounded so the read does not grow with the user base; a topic only needs to
 * appear once for its gap to be considered, and the enqueue dedupes by topic.
 */
export async function followedCustomTopics(
  db: Db,
  options: { limit?: number } = {},
): Promise<CoverageTopic[]> {
  const { data, error } = await db
    .from("user_topics")
    .select("created_at, topic_id, muted, topics ( id, label, kind )")
    .eq("muted", false)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? FOLLOW_READ_LIMIT);

  if (error) throw new Error(`reading followed topics: ${error.message}`);

  const seen = new Set<string>();
  const topics: CoverageTopic[] = [];
  for (const row of data ?? []) {
    const embedded = row.topics as { id?: string; label?: string; kind?: string } | null;
    const id = embedded?.id ?? row.topic_id;
    const label = embedded?.label;
    if (!id || !label) continue;
    // P0 scope: reader-created subjects only. The editorial pool is already
    // mapped by hand and its gaps are an operator's business, not a web
    // search's.
    if (embedded?.kind !== "custom") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    topics.push({ id, label });
  }

  return topics;
}
