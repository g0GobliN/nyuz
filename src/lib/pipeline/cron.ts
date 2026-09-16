/**
 * What a Cron Trigger runs.
 *
 * ---------------------------------------------------------------------------
 * Why this is not simply `ingest()`
 * ---------------------------------------------------------------------------
 *
 * A scheduled invocation on Workers is not a script on a server. It has limits
 * that a `npm run pipeline` does not, and the two that bite are:
 *
 *   - **Subrequests.** Every `fetch` counts, and so does every PostgREST call.
 *     The cap is 50 per invocation on the free plan and 1000 on paid. A full run
 *     over 64 sources is roughly 64 feed fetches plus three or four database
 *     calls each — comfortably past 50, comfortably under 1000.
 *   - **Wall clock.** Generous for cron (unlike a request), but not unlimited.
 *
 * So a scheduled run takes a slice rather than everything. `selectSources`
 * already orders by `last_fetched_at` ascending, nulls first — most-neglected
 * first — which means a limit rotates through every source on its own without
 * any cursor to store. Four invocations cover 64 sources; at one invocation
 * every fifteen minutes each source is read about every forty minutes, which is
 * the other side of `MIN_INTERVAL_MINUTES` and about right for a news feed.
 *
 * ---------------------------------------------------------------------------
 * Adding a stage
 * ---------------------------------------------------------------------------
 *
 * Clustering and analysis have different shapes to ingestion: they cost model
 * tokens, so they want their own budget and their own failure story. What they
 * cannot have is their own trigger. Cloudflare registers **three Cron Triggers
 * per Worker**, on the free plan and on paid alike, and the pipeline has seven
 * stages — declaring seven is not an error at deploy, it simply leaves four of
 * them unregistered, and the first anyone hears of it is empty briefings.
 *
 * So ingestion and digest keep a trigger each, and the remaining five stages
 * share `STAGES_CRON` and are told apart by the minute they fire on. Those are
 * the same minutes the separate schedules used, so the spacing between the
 * stages is unchanged and each one is still its own invocation with its own
 * subrequest budget. Adding a stage now means a minute in `stageForMinute`
 * rather than a trigger there is no room for.
 */

import { createAdminClient, type ServerEnv } from "@/lib/supabase/admin";
import type { EmailEnv } from "@/lib/server/email/send";
import type { TelegramEnv } from "@/lib/server/telegram/send";
import type { PushEnv } from "@/lib/server/push/send";
import { analyse, describeAnalysis, type AnalysisReport } from "./analyse";
import { cluster, describeCluster, type ClusterReport } from "./cluster";
import {
  describeDigest,
  digest,
  flushDeliveries,
  type DeliveryReport,
  type DigestReport,
} from "./digest";
import { classify, describeClassify, type ClassifyReport } from "./classify";
import { describeDormant, dormant, type DormantReport } from "./dormant";
import { ingest, type IngestReport } from "./ingest";
import { describeMatch, match, type MatchReport } from "./match";

/**
 * Feeds read per scheduled invocation.
 *
 * 12 rather than 64 for the Free Worker subrequest budget above. A normal
 * successful feed costs the external fetch, an article write and a source
 * update; twelve leaves room for the source-list query and failure/audit paths.
 * Raising it is a decision
 * about the Cloudflare plan, not about the pipeline.
 */
const SCHEDULED_LIMIT = 12;

/** Free clustering remains bounded by the worker's subrequest limit. */
const CLUSTER_LIMIT = 12;

/** Finalization is free; keep room for claim, coverage, topic and persistence queries. */
const ANALYSE_LIMIT = 6;

/**
 * Events classified per scheduled invocation.
 *
 * An order of magnitude above the model stages, because this one costs nothing:
 * two queries and some string matching over the topic taxonomy. It has to be
 * large. Classification is what decides which events analysis is allowed to
 * see, so a classifier running slower than clustering would become the new
 * bottleneck and would starve analysis of fresh candidates in exactly the way
 * `pre_analysis_demand_gate` did — see `classify.ts` for that failure.
 */
const CLASSIFY_LIMIT_PER_RUN = 200;

/** The schedules this handler knows. Must match `triggers.crons` in vite.config.ts. */
export const INGEST_CRON = "*/15 * * * *";

/**
 * Clustering runs two minutes after each ingest window.
 *
 * Two minutes lets the concurrent feed reads finish while leaving enough room for
 * classification, analysis and matching before each quarter-hour briefing slot.
 */
export const CLUSTER_CRON = "2,17,32,47 * * * *";

/**
 * Analysis runs after clustering, on the same reasoning.
 *
 * One minute behind classification. Demand and the next briefing deadline decide
 * which events receive the bounded model capacity in each run.
 */
export const ANALYSE_CRON = "9,24,39,54 * * * *";

/**
 * Classification runs between clustering and analysis, and costs nothing.
 *
 * Placed six minutes after clustering and before analysis because that is the
 * order the data needs: an event has to exist before it can be labelled, and it
 * has to be labelled before the demand gate can value it.
 */
export const CLASSIFY_CRON = "8,23,38,53 * * * *";

/**
 * Matching runs last in the chain, and is the only schedule with no budget note.
 *
 * Two minutes behind `ANALYSE_CRON`, so an event matched on this pass has been
 * read and scored first — an unanalysed event has no importance to compare against
 * a reader's threshold and no topics to join, so matching one would be matching a
 * placeholder. There is no limit constant above because there is nothing to limit:
 * no model call, no token, and re-running it writes nothing the second time.
 */
export const MATCH_CRON = "14,29,44,59 * * * *";

/**
 * Digest generation and delivery, after matching.
 *
 * Every minute, because `send_at` is a clock time the reader chose and the tick
 * that sends is the resolution of the promise: at five minutes, a briefing owed
 * at 07:30 could not arrive before 07:35 without arriving before it was due.
 * Only every fifth invocation generates — see `digestGenerates` — so the cost
 * of the extra ticks is the delivery query alone.
 */
export const DIGEST_CRON = "* * * * *";

/**
 * How often the expensive half of `DIGEST_CRON` runs, in minutes.
 *
 * The trigger fires every minute but only sends on most of them. Scheduling
 * slots and generating briefings is the part that spends per reader, and five
 * minutes remains the right cadence for it; sending is one indexed query that
 * usually returns nothing.
 *
 * Splitting them is the last of the lateness. While the two shared a five
 * minute tick, five minutes was the floor: a briefing finished at 07:20 for a
 * 07:30 deadline still waited for the 07:35 tick, because 07:30's tick was the
 * one that had to both generate and send. A fourth Cron Trigger would have been
 * the obvious way to separate them and is not available — Cloudflare registers
 * three and drops the rest — so the split is on the minute, as `STAGES_CRON`
 * already does it.
 */
const GENERATION_EVERY_MINUTES = 5;

/**
 * Whether a `DIGEST_CRON` invocation should generate, or only send.
 *
 * Read off the schedule Cloudflare fired for rather than the wall clock, for
 * the same reason `stageForMinute` is: an invocation that starts late still
 * does the work of the minute it was scheduled for.
 */
export function digestGenerates(scheduledFor: Date): boolean {
  return scheduledFor.getUTCMinutes() % GENERATION_EVERY_MINUTES === 0;
}

/**
 * Inactivity warning, automatic Uno pause, and retention purge, once a day.
 *
 * Keys off `profiles.last_seen_at`, which the dashboard writes, not off an email
 * open pixel. Monday noon UTC is arbitrary and quiet: it is not a send_at the
 * reader chose, and it is not every five minutes.
 */
export const DORMANT_CRON = "0 12 * * *";

/**
 * The one trigger that carries every stage there is no trigger left for.
 *
 * Only the minutes the shared stages actually want, so an invocation that has
 * nothing to do is the exception rather than the rule — the single exception
 * being minute 0, which exists for a nudge that runs once a week.
 */
export const STAGES_CRON = "0,2,8,9,14,17,23,24,29,32,38,39,44,47,53,54,59 * * * *";

type SharedStage = "cluster" | "classify" | "analyse" | "match" | "dormant";

/**
 * Which stage a `STAGES_CRON` invocation is for, or null when the answer is
 * nothing.
 *
 * Read off the schedule Cloudflare fired for, not off the wall clock, so a run
 * that starts late still does the work of the minute it was scheduled for.
 */
export function stageForMinute(scheduledFor: Date): SharedStage | null {
  const minute = scheduledFor.getUTCMinutes();
  if (minute === 2 || minute === 17 || minute === 32 || minute === 47) return "cluster";
  if (minute === 8 || minute === 23 || minute === 38 || minute === 53) return "classify";
  if (minute === 9 || minute === 24 || minute === 39 || minute === 54) return "analyse";
  if (minute === 14 || minute === 29 || minute === 44 || minute === 59) return "match";
  // Noon UTC daily, as DORMANT_CRON said. The other 23 minute-zero firings are
  // deliberately nothing at all.
  if (minute === 0 && scheduledFor.getUTCHours() === 12) {
    return "dormant";
  }
  return null;
}

export type ScheduledResult =
  | { stage: "ingest"; report: IngestReport }
  | { stage: "cluster"; report: ClusterReport }
  | { stage: "classify"; report: ClassifyReport }
  | { stage: "analyse"; report: AnalysisReport }
  | { stage: "match"; report: MatchReport }
  | { stage: "digest"; report: DigestReport }
  | { stage: "delivery"; report: DeliveryReport }
  | { stage: "dormant"; report: DormantReport }
  | { stage: "idle"; cron: string; minute: number }
  | { stage: "unknown"; cron: string };

/**
 * Runs whatever the given schedule is for.
 *
 * `force` is deliberately not set. An operator running the pipeline by hand
 * wants to override the backoff; a cron firing every fifteen minutes must
 * respect it, or the backoff means nothing and a dead feed is fetched ninety-six
 * times a day.
 */
type Env = ServerEnv | undefined;

async function runIngest(env: Env): Promise<ScheduledResult> {
  const report = await ingest(createAdminClient(env), { limit: SCHEDULED_LIMIT });
  return { stage: "ingest", report };
}

async function runCluster(env: Env): Promise<ScheduledResult> {
  // The env bag is passed twice on purpose: once so the client can reach the
  // database, and once as `secrets` so the AI router can read `ai_model_routes`
  // and find the provider key. On Cloudflare there is no `process.env` for
  // either of them to fall back to.
  const report = await cluster(createAdminClient(env), {
    limit: CLUSTER_LIMIT,
    ...(env ? { secrets: env as Record<string, string | undefined> } : {}),
  });
  return { stage: "cluster", report };
}

/**
 * The one shared stage that takes no `secrets` bag, because it calls no model.
 * If that argument ever appears here, something has gone wrong with the design.
 */
async function runClassify(env: Env): Promise<ScheduledResult> {
  const report = await classify(createAdminClient(env), { limit: CLASSIFY_LIMIT_PER_RUN });
  return { stage: "classify", report };
}

async function runAnalyse(env: Env): Promise<ScheduledResult> {
  const report = await analyse(createAdminClient(env), {
    limit: ANALYSE_LIMIT,
    ...(env ? { secrets: env as Record<string, string | undefined> } : {}),
  });
  return { stage: "analyse", report };
}

async function runMatch(env: Env): Promise<ScheduledResult> {
  // No model. The channel env bags are passed because a newly matched event may
  // fire a breaking alert, which sends immediately rather than waiting for digest.
  const report = await match(createAdminClient(env), {
    ...(env ? { email: env as EmailEnv, telegram: env as TelegramEnv, push: env as PushEnv } : {}),
  });
  return { stage: "match", report };
}

async function runDigest(env: Env): Promise<ScheduledResult> {
  const report = await digest(createAdminClient(env), {
    ...(env
      ? {
          secrets: env as Record<string, string | undefined>,
          email: env as EmailEnv,
          telegram: env as TelegramEnv,
          push: env as PushEnv,
        }
      : {}),
  });
  return { stage: "digest", report };
}

/**
 * The sending half of `runDigest`, on its own tick.
 *
 * Generates nothing and schedules nothing: everything it sends was prepared by
 * a `DIGEST_CRON` invocation ahead of the deadline. The delivery lease is what
 * makes the two safe to overlap — whichever tick claims a row first is the one
 * that sends it.
 */
async function runDelivery(env: Env): Promise<ScheduledResult> {
  const report = await flushDeliveries(createAdminClient(env), {
    ...(env
      ? {
          secrets: env as Record<string, string | undefined>,
          email: env as EmailEnv,
          telegram: env as TelegramEnv,
          push: env as PushEnv,
        }
      : {}),
  });
  return { stage: "delivery", report };
}

async function runDormant(env: Env): Promise<ScheduledResult> {
  const report = await dormant(createAdminClient(env), {
    ...(env ? { email: env as EmailEnv } : {}),
  });
  return { stage: "dormant", report };
}

/** Release positively unstarted old reservations; uncertain charges remain held. */
async function reapStaleReservations(env: Env): Promise<void> {
  const { data, error } = await createAdminClient(env).rpc("void_stale_ai_reservations", {});
  if (error) {
    console.error(`voiding stale AI reservations: ${error.message}`);
    return;
  }
  if (typeof data === "number" && data > 0) {
    console.log(`voided ${data} stale AI reservation${data === 1 ? "" : "s"}`);
  }
}

async function runShared(stage: SharedStage, env: Env): Promise<ScheduledResult> {
  if (stage === "cluster" || stage === "analyse") await reapStaleReservations(env);
  if (stage === "cluster") return runCluster(env);
  if (stage === "classify") return runClassify(env);
  if (stage === "analyse") return runAnalyse(env);
  if (stage === "match") return runMatch(env);
  return runDormant(env);
}

/**
 * Runs whatever the given schedule is for.
 *
 * `force` is deliberately not set. An operator running the pipeline by hand
 * wants to override the backoff; a cron firing every fifteen minutes must
 * respect it, or the backoff means nothing and a dead feed is fetched ninety-six
 * times a day.
 */
export async function runScheduled(
  env: ServerEnv | undefined,
  cron: string,
  scheduledFor: Date = new Date(),
): Promise<ScheduledResult> {
  if (cron === INGEST_CRON) return runIngest(env);
  // `runDigest` delivers as well as generates, so a generating minute needs no
  // second pass.
  if (cron === DIGEST_CRON) {
    return digestGenerates(scheduledFor) ? runDigest(env) : runDelivery(env);
  }

  if (cron === STAGES_CRON) {
    const stage = stageForMinute(scheduledFor);
    if (!stage) return { stage: "idle", cron, minute: scheduledFor.getUTCMinutes() };
    return runShared(stage, env);
  }

  // The per-stage schedules are no longer registered triggers, but they stay
  // dispatchable: `npm run cron:test -- "2,17,32,47 * * * *"` has to force clustering
  // rather than depend on the minute the operator happened to run it.
  if (cron === CLUSTER_CRON || cron === ANALYSE_CRON) {
    await reapStaleReservations(env);
    return cron === CLUSTER_CRON ? runCluster(env) : runAnalyse(env);
  }
  if (cron === CLASSIFY_CRON) return runClassify(env);
  if (cron === MATCH_CRON) return runMatch(env);
  if (cron === DORMANT_CRON) return runDormant(env);

  return { stage: "unknown", cron };
}

/**
 * One line per run, for `wrangler tail`.
 *
 * Cron runs have no reader and no response, so the log is the only evidence the
 * thing happened. Failures are named individually because "3 failed" in a log
 * nobody can query is not something anyone can act on.
 */
export function describe(result: ScheduledResult): string {
  if (result.stage === "unknown") {
    return `cron ${result.cron} fired and nothing is registered for it`;
  }

  if (result.stage === "idle") {
    const minute = String(result.minute).padStart(2, "0");
    return `cron ${result.cron} fired at :${minute} with no stage due`;
  }

  if (result.stage === "cluster") {
    const line = describeCluster(result.report);
    const failures = result.report.outcomes.filter((o) => o.decision === "failed");
    if (failures.length === 0) return line;
    return `${line}\n${failures.map((f) => `  ${f.articleId}: ${f.detail}`).join("\n")}`;
  }

  if (result.stage === "analyse") {
    const line = describeAnalysis(result.report);
    const failures = result.report.outcomes.filter((o) => o.decision === "failed");
    if (failures.length === 0) return line;
    return `${line}\n${failures.map((f) => `  ${f.eventId}: ${f.detail}`).join("\n")}`;
  }

  if (result.stage === "classify") return describeClassify(result.report);
  if (result.stage === "match") return describeMatch(result.report);
  if (result.stage === "digest") return describeDigest(result.report);
  if (result.stage === "delivery") {
    const { sent, retried } = result.report;
    // Most minutes have nothing due. Saying so is the point: a silent log and a
    // broken delivery tick look the same.
    if (sent === 0 && retried === 0) return "delivery: nothing due";
    return `delivery: ${sent} sent, ${retried} retried`;
  }
  if (result.stage === "dormant") return describeDormant(result.report);

  const { report } = result;
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);
  const failures = report.outcomes.filter((o) => o.state === "failed");

  const unwanted = report.skippedNoDemand > 0 ? `, ${report.skippedNoDemand} no demand` : "";

  const summary =
    `ingest: ${report.attempted}/${report.considered} sources, ` +
    `${report.inserted} new, ${report.retitled} retitled, ` +
    `${report.failed} failed, ${report.disabled} switched off${unwanted}, ${seconds}s`;

  if (failures.length === 0) return summary;
  return `${summary}\n${failures.map((f) => `  ${f.name}: ${f.detail}`).join("\n")}`;
}
