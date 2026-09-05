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
 * per Worker**, on the free plan and on paid alike, and the pipeline has six
 * stages — declaring six is not an error at deploy, it simply leaves three of
 * them unregistered, and the first anyone hears of it is empty briefings.
 *
 * So ingestion and digest keep a trigger each, and the remaining four stages
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
import { describeDigest, digest, type DigestReport } from "./digest";
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

/**
 * Articles clustered per scheduled invocation.
 *
 * Much smaller than ingestion's slice, and for a different reason. Ingestion is
 * bounded by subrequests; clustering is bounded by money and by time. Each article
 * costs a shortlist query, up to one model call, and one or two writes — so twelve
 * articles is around forty subrequests and twelve calls to a reasoning model, which
 * is the part that takes seconds rather than milliseconds.
 *
 * At four invocations an hour this clusters under 1200 articles a day, against a
 * real ingestion rate of a few hundred. There is headroom, and the backlog is
 * drained by `npm run pipeline -- cluster --limit N` rather than by a cron that
 * might run up a bill unattended.
 */
const CLUSTER_LIMIT = 12;

/**
 * Events analysed per scheduled invocation.
 *
 * Smaller again, and the tightest budget in the file, because this is the only
 * stage that calls the strongest configured model and the only one whose output a
 * reader will read as prose. Each event costs a coverage read, a claim, one model
 * call and one or two writes — call it five subrequests, so six events is around
 * thirty-five plus the shared reads. That fits inside the free plan's fifty, which
 * ingestion's slice does not.
 *
 * Six an hour is not how the backlog gets cleared, and is not meant to be: an
 * operator runs `npm run pipeline -- analyse --limit N` and watches it. What this
 * number has to cover is the news of the last half hour, not the corpus — the
 * standing backlog is drained deliberately, by hand, because it is money.
 */
const ANALYSE_LIMIT = 6;

/** The schedules this handler knows. Must match `triggers.crons` in vite.config.ts. */
export const INGEST_CRON = "*/15 * * * *";

/**
 * Clustering runs on its own schedule, offset from ingestion.
 *
 * Offset rather than shared because the two stages want the opposite thing from
 * each other's timing: clustering works best when the coverage of one announcement
 * has all arrived, so it should run after an ingest rather than alongside one. Ten
 * past the half hour is a few minutes after an ingest run, and half as often,
 * which also keeps the two from competing for the same invocation's budget.
 */
export const CLUSTER_CRON = "4,34 * * * *";

/**
 * Analysis runs after clustering, on the same reasoning.
 *
 * Ten minutes behind `CLUSTER_CRON`, so an event analysed on this pass has had the
 * coverage that arrived with it grouped first. Getting that order wrong would not
 * corrupt anything — a later article still attaches to the analysed event, and
 * still costs nothing — but the analysis would have been written from one outlet's
 * account of the story when three were available.
 */
export const ANALYSE_CRON = "47,53 * * * *";

/**
 * Matching runs last in the chain, and is the only schedule with no budget note.
 *
 * Five minutes behind `ANALYSE_CRON`, so an event matched on this pass has been
 * read and scored first — an unanalysed event has no importance to compare against
 * a reader's threshold and no topics to join, so matching one would be matching a
 * placeholder. There is no limit constant above because there is nothing to limit:
 * no model call, no token, and re-running it writes nothing the second time.
 */
export const MATCH_CRON = "25,55 * * * *";

/**
 * Digest generation and delivery, after matching.
 *
 * Every five minutes rather than twice an hour, because send_at is a clock time
 * the reader chose. A half-hourly slot would smear 07:30 across half an hour;
 * five minutes is the coarsest cadence that still lands "at the time you asked".
 * Generation is capped per invocation the same way analysis is — this is the
 * stage that spends per reader.
 */
export const DIGEST_CRON = "*/5 * * * *";

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
export const STAGES_CRON = "0,4,25,34,47,53,55 * * * *";

type SharedStage = "cluster" | "analyse" | "match" | "dormant";

/**
 * Which stage a `STAGES_CRON` invocation is for, or null when the answer is
 * nothing.
 *
 * Read off the schedule Cloudflare fired for, not off the wall clock, so a run
 * that starts late still does the work of the minute it was scheduled for.
 */
export function stageForMinute(scheduledFor: Date): SharedStage | null {
  const minute = scheduledFor.getUTCMinutes();
  if (minute === 4 || minute === 34) return "cluster";
  if (minute === 47 || minute === 53) return "analyse";
  if (minute === 25 || minute === 55) return "match";
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
  | { stage: "analyse"; report: AnalysisReport }
  | { stage: "match"; report: MatchReport }
  | { stage: "digest"; report: DigestReport }
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

async function runDormant(env: Env): Promise<ScheduledResult> {
  const report = await dormant(createAdminClient(env), {
    ...(env ? { email: env as EmailEnv } : {}),
  });
  return { stage: "dormant", report };
}

/**
 * Clears reservations that never settled, before any stage tries to reserve.
 *
 * A model call that fails with a 5xx or a dropped connection keeps its
 * reservation as a conservative charge, because the provider may have generated
 * a reply nobody received. Nothing ever cleared those, so two days of provider
 * failure in August held 2.5M tokens and $5.45 against the monthly ceilings
 * having spent nothing, and the pipeline stopped for the rest of the month.
 *
 * One database call at the top of a run, and it costs nothing when the ledger is
 * clean. Failure is logged and swallowed: an unreapable ledger is a reason to
 * look at the ledger, not a reason to skip the run — `reserve_ai_tokens` applies
 * the same cutoff itself, so the ceiling is right either way.
 */
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
  if (cron === DIGEST_CRON) return runDigest(env);

  if (cron === STAGES_CRON) {
    const stage = stageForMinute(scheduledFor);
    if (!stage) return { stage: "idle", cron, minute: scheduledFor.getUTCMinutes() };
    return runShared(stage, env);
  }

  // The per-stage schedules are no longer registered triggers, but they stay
  // dispatchable: `npm run cron:test -- "10,40 * * * *"` has to force clustering
  // rather than depend on the minute the operator happened to run it.
  if (cron === CLUSTER_CRON || cron === ANALYSE_CRON) {
    await reapStaleReservations(env);
    return cron === CLUSTER_CRON ? runCluster(env) : runAnalyse(env);
  }
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

  if (result.stage === "match") return describeMatch(result.report);
  if (result.stage === "digest") return describeDigest(result.report);
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
