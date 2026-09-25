/**
 * Stage — source discovery. The half of the pipeline that finds something new
 * to collect when a followed subject has nothing.
 *
 * ---------------------------------------------------------------------------
 * Two halves, one tick, one shared registry
 * ---------------------------------------------------------------------------
 *
 *   enqueue   topics followed recently with no mapped source and no open job
 *             get one job. Pure database work; no network. This is also the
 *             code path the save-time hook calls, which is why it is separate.
 *
 *   run       one due job is claimed and its topic's seed methods are tried,
 *             in order of cost: sources we already collect whose own name
 *             names the subject (M0), then articles we already hold that
 *             mention it (M1). Both write `source_topics` links and neither
 *             makes a request -- see `seeds.ts`.
 *
 *   resolve   a URL a reader supplied for a subject (M2, `submit.ts`) lands in
 *             `source_candidates`; a bounded number of candidates are probed
 *             with `resolveFeed`, checked against the subject, and registered
 *             as ordinary `sources` rows. The residue is retried by the pass.
 *
 * Nothing here knows what a subject means. A job is a topic id and a term
 * list; a link is evidence that a source we already hold talks about it; a
 * candidate is a URL that either carries a feed or does not. "Arsenal", "Rust
 * programming" and "public transportation Tokyo" take the identical path, and
 * a test asserts that rather than trusting it.
 *
 * ---------------------------------------------------------------------------
 * The budget is part of the design, not a tuning knob
 * ---------------------------------------------------------------------------
 *
 * A cron invocation on Workers has a subrequest ceiling, and this stage shares
 * it with everything else the Worker does. Worst case for one tick:
 *
 *   enqueue     ~5 PostgREST calls
 *   claim/run   ~5 PostgREST calls: the topic, the registry scan and its link
 *               write, the corpus scan and its link write. Not one fetch -- a
 *               job body cannot make an outbound request at all, which is what
 *               makes this stage free and reproducible.
 *   pass        CANDIDATES_PER_PASS x MAX_FETCHES feed requests
 *
 * At most 12 feed requests and roughly twenty database calls -- the same order
 * as `SCHEDULED_LIMIT = 12` feeds in `cron.ts`, and deliberately so: discovery
 * must never be the stage that starves ingestion on the free plan.
 *
 * ---------------------------------------------------------------------------
 * Failure is contained three ways
 * ---------------------------------------------------------------------------
 *
 *   One candidate   a failed probe is that candidate's row, never the job's.
 *   One job         a failed read or link write is that method's outcome and
 *                   never the job's: the job finishes with what it found. The
 *                   retry backoff stays for the one failure left, an unforeseen
 *                   database error, and the next due job still runs.
 *   One stage       every loop body catches, so one pathological result cannot
 *                   take down the enqueue pass or the tick.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { enqueueDiscoveryForTopics, followedCustomTopics } from "./coverage";
import { passesRelevanceTripwire, resolveFeed, type FeedFetcher } from "./feed";
import { registerDiscoveredSource } from "./register";
import { attemptsJson, linkExistingCoverage, type SeedMethod } from "./seeds";

type Db = SupabaseClient<Database>;

/* ---------------------------------------------------------------------- */
/* Bounds                                                                 */
/* ---------------------------------------------------------------------- */

/** Jobs claimed per invocation. One shared job is already a good hour's work. */
export const MAX_JOBS_PER_RUN = 1;

/** Candidates resolved by the follow-up pass, for earlier jobs' leftovers. */
export const CANDIDATES_PER_PASS = 2;

/** Job attempts before it is left failed for good. */
export const MAX_JOB_ATTEMPTS = 3;

/** Minutes before retrying a failed job, indexed by attempt - 1. */
export const JOB_RETRY_MINUTES = [60, 360, 1_440] as const;

/** Candidate probes before an unresolved candidate is rejected for good. */
export const MAX_PROBE_ATTEMPTS = 3;

/** Minutes before retrying a candidate that failed transiently. */
export const CANDIDATE_RETRY_MINUTES = 60;

/* ---------------------------------------------------------------------- */
/* Report                                                                 */
/* ---------------------------------------------------------------------- */

export type JobOutcome = {
  jobId: string;
  topicId: string;
  topicLabel: string;
  decision: "succeeded" | "failed";
  /** Sources linked to the subject by this job. */
  linked: number;
  /** Where the links came from, or `none` when the subject is not in our data. */
  method: SeedMethod;
  detail: string;
};

export type CandidateOutcome = {
  candidateId: string;
  url: string;
  decision: "registered" | "rejected" | "retry";
  detail: string;
};

export type DiscoveryReport = {
  startedAt: string;
  finishedAt: string;
  /** Jobs claimed plus candidates considered. */
  considered: number;
  /** Jobs that completed and candidates resolved. */
  processed: number;
  /** Jobs and candidates deliberately left for later. */
  skipped: number;
  failed: number;
  /** Jobs queued by the coverage pass. */
  enqueued: number;
  /** Sources linked to a followed subject by this tick's job bodies. */
  linked: number;
  /** Candidates the resolver pass considered. */
  candidates: number;
  /** Sources registered (new or already known). */
  registered: number;
  reason: "ok" | "disabled";
  detail: string;
  outcomes: JobOutcome[];
};

export type DiscoverOptions = {
  /**
   * Injected for tests and dry runs. Defaults to the ingester's own transport.
   *
   * There is no `provider` option any more, and no env bag: the seed methods
   * read the database, so the only thing that could need a secret is the feed
   * transport, and that one is the ingester's.
   */
  fetcher?: FeedFetcher;
  now?: Date;
};

/**
 * Runs one discovery tick.
 *
 * Returns a report rather than throwing, in every case including a database
 * that is unreadable: a cron whose job is discovery must not fail the tick of
 * a Worker that also runs ingestion. Errors inside the tick are counted and
 * described; the caller logs the description.
 */
export async function discover(db: Db, options: DiscoverOptions = {}): Promise<DiscoveryReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const base: DiscoveryReport = {
    startedAt,
    finishedAt: startedAt,
    considered: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    enqueued: 0,
    linked: 0,
    candidates: 0,
    registered: 0,
    reason: "ok",
    detail: "",
    outcomes: [],
  };

  const done = (patch: Partial<DiscoveryReport>): DiscoveryReport => ({
    ...base,
    finishedAt: new Date().toISOString(),
    ...patch,
  });

  // Flag first: off means no reads and no writes at all.
  const { data: flag, error: flagError } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "source_discovery_enabled")
    .maybeSingle();
  if (flagError) {
    return done({
      reason: "disabled",
      detail: `flag could not be read: ${flagError.message}`,
    });
  }
  if (flag?.enabled !== true) {
    return done({ reason: "disabled", detail: "source_discovery_enabled is off" });
  }

  // ---- enqueue ----------------------------------------------------------
  let enqueued = 0;
  try {
    const topics = await followedCustomTopics(db);
    const result = await enqueueDiscoveryForTopics(db, topics, { now });
    enqueued = result.queued;
  } catch (error) {
    // The enqueue pass failing must not stop a job that is already queued.
    console.warn(`discovery: enqueue pass failed: ${describeError(error)}`);
  }

  // ---- jobs -------------------------------------------------------------
  const outcomes: JobOutcome[] = [];
  let registered = 0;
  let linked = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  let claimed: ClaimedJob[] = [];
  try {
    claimed = await claimJobs(db, now);
  } catch (error) {
    console.warn(`discovery: claiming jobs failed: ${describeError(error)}`);
  }

  const topics = await loadTopics(
    db,
    claimed.map((job) => job.topicId),
  );

  for (const job of claimed) {
    const topic = topics.get(job.topicId);
    if (!topic) {
      // The topic was deleted between insert and claim. Not a failure.
      skipped += 1;
      await finishJob(db, job.id, { status: "succeeded", nextAttempt: null });
      continue;
    }

    const outcome = await runJob(db, { job, topic, now });
    outcomes.push(outcome);
    linked += outcome.linked;
    if (outcome.decision === "succeeded") processed += 1;
    else failed += 1;
  }

  // ---- leftover candidates ---------------------------------------------
  const pass = await resolveDueCandidates(db, {
    limit: CANDIDATES_PER_PASS,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    now,
  });
  processed += pass.resolved;
  registered += pass.registered;
  failed += pass.failed;
  skipped += pass.skipped;

  return done({
    considered: claimed.length + pass.considered,
    processed,
    skipped,
    failed,
    enqueued,
    linked,
    candidates: pass.considered,
    registered,
    detail:
      `${enqueued} queued, ${claimed.length} claimed, ${linked} source links, ` +
      `${pass.considered} candidates, ${registered} sources`,
    outcomes,
  });
}

/* ---------------------------------------------------------------------- */
/* Claims                                                                 */
/* ---------------------------------------------------------------------- */

export type ClaimedJob = {
  id: string;
  topicId: string;
  attempt: number;
};

/**
 * Due jobs, atomically claimed by status.
 *
 * The select is a hint and the update is the claim: the update returns only
 * the rows it actually changed, so if two invocations overlap, the second one
 * updates nothing and runs nothing. `attempt` is incremented here, which is
 * what the retry backoff is derived from -- no second counter to keep in step.
 */
export async function claimJobs(db: Db, now: Date): Promise<ClaimedJob[]> {
  const { data: due, error } = await db
    .from("discovery_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .lt("attempt", MAX_JOB_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (error) throw new Error(`reading due discovery jobs: ${error.message}`);
  const ids = (due ?? []).map((row) => row.id);
  if (ids.length === 0) return [];

  const { data: claimed, error: claimError } = await db
    .from("discovery_jobs")
    .update({
      status: "running",
      started_at: now.toISOString(),
    })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, topic_id, attempt");

  if (claimError) throw new Error(`claiming discovery jobs: ${claimError.message}`);

  return (claimed ?? []).map((row) => ({
    id: row.id,
    topicId: row.topic_id,
    attempt: row.attempt,
  }));
}

/* ---------------------------------------------------------------------- */
/* One job                                                                */
/* ---------------------------------------------------------------------- */

export type JobTopic = {
  id: string;
  label: string;
  terms: string[];
};

export type RunJobInput = {
  job: ClaimedJob;
  topic: JobTopic;
  now: Date;
};

/**
 * One job: link the sources we already hold to the subject, record the outcome.
 *
 * No request is made and none can be: both seed methods read the database (see
 * `seeds.ts`). A job that finds nothing finishes `succeeded` with
 * `method: "none"` -- "nothing we collect mentions this subject yet" is an
 * answer, and the reader-supplied path (`submit.ts`) is what can change it.
 *
 * The retry backoff stays for the one failure left: an unforeseen database
 * error. It is not the subject's fault and the next tick may well succeed.
 */
export async function runJob(db: Db, input: RunJobInput): Promise<JobOutcome> {
  const { job, topic, now } = input;

  try {
    const seeds = await linkExistingCoverage(db, topic, { now });

    await finishJob(db, job.id, {
      status: "succeeded",
      nextAttempt: null,
      method: seeds.method,
      terms: seeds.terms,
      attempts: attemptsJson(seeds),
      linkedCount: seeds.linked,
    });

    return {
      jobId: job.id,
      topicId: topic.id,
      topicLabel: topic.label,
      decision: "succeeded",
      linked: seeds.linked,
      method: seeds.method,
      detail:
        seeds.linked > 0
          ? `${seeds.linked} source(s) linked from the ${seeds.method}`
          : "nothing in the registry or the corpus mentions this subject yet",
    };
  } catch (error) {
    const message = describeError(error);
    await finishJob(db, job.id, {
      status: "failed",
      error: message.slice(0, 240),
      nextAttempt: job.attempt < MAX_JOB_ATTEMPTS ? retryAt(now, job.attempt) : null,
    });

    return {
      jobId: job.id,
      topicId: topic.id,
      topicLabel: topic.label,
      decision: "failed",
      linked: 0,
      method: "none",
      detail: message,
    };
  }
}

type CandidateRow = {
  id: string;
  url: string;
  title: string | null;
  first_topic_id: string | null;
  probe_attempts: number;
};

type JobPatch = {
  status: "succeeded" | "failed";
  finished_at: string;
  next_attempt_at: string | null;
  error?: string;
  method?: string;
  terms?: string[];
  attempts?: Json;
  linked_count?: number;
};

async function finishJob(
  db: Db,
  jobId: string,
  patch: {
    status: "succeeded" | "failed";
    nextAttempt?: Date | null;
    error?: string;
    method?: SeedMethod;
    terms?: string[];
    attempts?: Json;
    linkedCount?: number;
  },
): Promise<void> {
  const row: JobPatch = {
    status: patch.status,
    finished_at: new Date().toISOString(),
    next_attempt_at: patch.nextAttempt ? patch.nextAttempt.toISOString() : null,
  };
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.method !== undefined) row.method = patch.method;
  if (patch.terms !== undefined) row.terms = patch.terms;
  if (patch.attempts !== undefined) row.attempts = patch.attempts;
  if (patch.linkedCount !== undefined) row.linked_count = patch.linkedCount;

  const { error } = await db.from("discovery_jobs").update(row).eq("id", jobId);
  if (error) console.warn(`discovery: finishing job ${jobId} failed: ${error.message}`);
}

/**
 * When a failed job may be claimed again.
 *
 * Indexed by the attempt that just failed, so attempt 1 buys an hour and
 * attempt 3 buys a day. The caller decides whether there is a retry at all;
 * this only says when.
 */
export function retryAt(now: Date, attempt: number): Date {
  const index = Math.min(Math.max(attempt - 1, 0), JOB_RETRY_MINUTES.length - 1);
  const minutes = JOB_RETRY_MINUTES[index] ?? JOB_RETRY_MINUTES[0];
  return new Date(now.getTime() + minutes * 60_000);
}

/* ---------------------------------------------------------------------- */
/* Candidates                                                             */
/* ---------------------------------------------------------------------- */

export type ResolveCandidateContext = {
  topic: JobTopic;
  fetcher?: FeedFetcher;
  now: Date;
};

export type CandidateResolution = {
  decision: "registered" | "rejected" | "retry";
  sourceId?: string;
  detail: string;
};

/**
 * One candidate: resolve a feed, check it is about the topic at all, register.
 *
 * Every branch writes the candidate's own row, so a candidate is never left in
 * an ambiguous state: `registered` with a source id, `rejected` with a reason
 * and no retry, or `discovered` with a later `next_attempt_at`.
 */
export async function resolveCandidate(
  db: Db,
  candidate: CandidateRow,
  context: ResolveCandidateContext,
): Promise<CandidateResolution> {
  const { topic, now } = context;
  const attempts = candidate.probe_attempts + 1;
  const wait = new Date(now.getTime() + CANDIDATE_RETRY_MINUTES * 60_000);

  const resolution = await resolveFeed(candidate.url, {
    ...(context.fetcher ? { fetcher: context.fetcher } : {}),
  });

  if (!resolution.ok) {
    const exhausted = attempts >= MAX_PROBE_ATTEMPTS;
    const rejected = !resolution.retryable || exhausted;

    await updateCandidate(db, candidate.id, {
      status: rejected ? "rejected" : "discovered",
      reject_reason: rejected ? shortReason(resolution.reason) : null,
      retryable: !rejected && resolution.retryable,
      probe_attempts: attempts,
      next_attempt_at: rejected ? null : wait.toISOString(),
    });

    return {
      decision: rejected ? "rejected" : "retry",
      detail: rejected
        ? `rejected: ${shortReason(resolution.reason)}`
        : `retry: ${resolution.reason}`,
    };
  }

  const relevant = passesRelevanceTripwire({
    terms: topic.terms,
    candidateTitle: candidate.title,
    snippet: null,
    feedTitle: resolution.feed.title,
    itemTitles: resolution.feed.itemTitles,
  });

  if (!relevant) {
    await updateCandidate(db, candidate.id, {
      status: "rejected",
      reject_reason: "not-relevant",
      retryable: false,
      probe_attempts: attempts,
      next_attempt_at: null,
      feed_url: resolution.feed.feedUrl,
    });
    return { decision: "rejected", detail: "rejected: not-relevant" };
  }

  const registration = await registerDiscoveredSource(db, {
    topicId: topic.id,
    feedUrl: resolution.feed.feedUrl,
    homepage: resolution.feed.homepage,
    name: resolution.feed.title ?? candidate.title ?? domainOf(resolution.feed.feedUrl),
    topicLabel: topic.label,
  });

  if (!registration.ok) {
    // Our database, not the site. Worth another tick rather than a verdict.
    await updateCandidate(db, candidate.id, {
      status: "discovered",
      retryable: true,
      probe_attempts: attempts,
      next_attempt_at: wait.toISOString(),
      feed_url: resolution.feed.feedUrl,
    });
    return { decision: "retry", detail: `registration failed: ${registration.reason}` };
  }

  await updateCandidate(db, candidate.id, {
    status: "registered",
    retryable: false,
    probe_attempts: attempts,
    next_attempt_at: null,
    feed_url: resolution.feed.feedUrl,
    resolved_source_id: registration.sourceId,
  });

  return {
    decision: "registered",
    sourceId: registration.sourceId,
    detail: registration.created ? "registered as a new source" : "linked to an existing source",
  };
}

type CandidatePatch = {
  status?: "discovered" | "registered" | "rejected";
  feed_url?: string;
  reject_reason?: string | null;
  retryable?: boolean;
  probe_attempts?: number;
  next_attempt_at?: string | null;
  resolved_source_id?: string;
};

async function updateCandidate(
  db: Db,
  id: string,
  patch: Omit<CandidatePatch, "updated_at">,
): Promise<void> {
  const { error } = await db
    .from("source_candidates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn(`discovery: updating candidate ${id} failed: ${error.message}`);
}

/* ---------------------------------------------------------------------- */
/* The leftover pass                                                      */
/* ---------------------------------------------------------------------- */

export type PassReport = {
  considered: number;
  resolved: number;
  registered: number;
  failed: number;
  skipped: number;
};

/**
 * Candidates due for another attempt, from any earlier job.
 *
 * Deliberately race-tolerant rather than race-proof: the `next_attempt_at`
 * check is what a claim would be, and two overlapping invocations could both
 * probe one candidate. The cost of that is one extra HTTP request against a
 * row that is about to be resolved anyway; the cost of a lease column would be
 * a second piece of state for the same guarantee.
 */
export async function resolveDueCandidates(
  db: Db,
  options: { limit: number; fetcher?: FeedFetcher; now: Date },
): Promise<PassReport> {
  const { now } = options;
  const report: PassReport = { considered: 0, resolved: 0, registered: 0, failed: 0, skipped: 0 };

  const { data, error } = await db
    .from("source_candidates")
    .select("id, url, title, first_topic_id, probe_attempts")
    .eq("status", "discovered")
    .lte("next_attempt_at", now.toISOString())
    .lt("probe_attempts", MAX_PROBE_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(options.limit);

  if (error) {
    console.warn(`discovery: reading due candidates failed: ${error.message}`);
    return report;
  }

  const candidates = (data ?? []) as CandidateRow[];
  report.considered = candidates.length;
  if (candidates.length === 0) return report;

  const topics = await loadTopics(
    db,
    candidates.flatMap((candidate) => (candidate.first_topic_id ? [candidate.first_topic_id] : [])),
  );

  for (const candidate of candidates) {
    const topic = candidate.first_topic_id ? topics.get(candidate.first_topic_id) : undefined;
    if (!topic) {
      report.skipped += 1;
      await updateCandidate(db, candidate.id, {
        status: "rejected",
        reject_reason: "topic-gone",
        retryable: false,
        next_attempt_at: null,
      });
      continue;
    }

    try {
      const resolution = await resolveCandidate(db, candidate, {
        topic,
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        now,
      });
      if (resolution.decision === "registered") report.registered += 1;
      else if (resolution.decision === "rejected") report.resolved += 1;
      else report.skipped += 1;
    } catch (error) {
      report.failed += 1;
      console.warn(`discovery: resolving ${candidate.url} failed: ${describeError(error)}`);
    }
  }

  return report;
}

/* ---------------------------------------------------------------------- */
/* Shared reads                                                           */
/* ---------------------------------------------------------------------- */

/** Topic rows for a set of ids, in one query. Missing ids are simply absent. */
async function loadTopics(db: Db, ids: string[]): Promise<Map<string, JobTopic>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await db.from("topics").select("id, label, terms, kind").in("id", unique);

  if (error) {
    console.warn(`discovery: reading topics failed: ${error.message}`);
    return new Map();
  }

  return new Map(
    (data ?? []).map((topic) => [
      topic.id,
      { id: topic.id, label: topic.label, terms: topic.terms },
    ]),
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const REASON_CAP = 120;

function shortReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, REASON_CAP);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ---------------------------------------------------------------------- */
/* Logging                                                                */
/* ---------------------------------------------------------------------- */

/**
 * One line per run, for `wrangler tail`.
 *
 * Names the topic and the outcome so an operator reading the log can answer
 * the two questions the stage raises: did a reader's new subject get looked
 * at, and what did looking at it produce. Revision ids and URLs, never reader
 * data -- discovery has never heard of a reader.
 */
export function describeDiscovery(report: DiscoveryReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);

  const head =
    `discover: ${report.reason}, ${report.enqueued} queued, ` +
    `${report.considered} considered, ${report.linked} links, ` +
    `${report.candidates} candidates, ${report.registered} sources, ` +
    `${report.skipped} skipped, ${report.failed} failed, ${seconds}s`;

  if (report.detail === "" || report.reason !== "ok") return `${head} | ${report.detail}`;

  const lines = report.outcomes.map(
    (outcome) => `  ${outcome.topicLabel}: ${outcome.decision} (${outcome.detail})`,
  );

  return lines.length === 0 ? head : `${head}\n${lines.join("\n")}`;
}
