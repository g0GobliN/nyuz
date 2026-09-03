/**
 * Stage 6 — the day-one backfill.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 *
 * A reader finishes onboarding at four in the afternoon. The scheduled matcher
 * runs at twenty-five past, which is fine — except that between those two
 * moments they are looking at an empty dashboard, having just been told their
 * nyuz was ready. Nothing about the corpus changes in that half hour; the events
 * they would match were analysed hours ago, for somebody else. So the honest fix
 * is not to make them wait for a cron, it is to run the matcher for them now.
 *
 * That costs one query, because stage 5 costs one query. `match(db, { userIds,
 * sinceHours })` already takes exactly the two arguments this needs, so the
 * common case here is a call rather than a second matcher — and because stage 5
 * writes with `ignoreDuplicates` and never rewrites `matched_at`, a backfill
 * that overlaps the scheduled run cannot double up.
 *
 * ---------------------------------------------------------------------------
 * The one path that spends money, and what stops it spending twice
 * ---------------------------------------------------------------------------
 *
 * If nothing matches, the plan allows fetching and analysing on demand for the
 * first day only. That is the sole part of this stage that is not free, so it
 * carries three separate brakes:
 *
 *   - **Candidates must already name something the reader follows.** Nothing is
 *     analysed on the chance it might be relevant. An unanalysed event has no
 *     topics — analysis is what writes them — so the only evidence available is
 *     the headline stage 3 left on it, and `worthAnalysing` reads it with the
 *     same predicate the matcher uses. Exclusions apply here too: refusing to
 *     pay to understand a story the reader has already vetoed is free money.
 *   - **`ON_DEMAND_LIMIT` caps a run** at three events, against the scheduled
 *     stage's six an hour.
 *   - **One run per account, ever.** The audit log is written before the model
 *     is called, and read as the guard on the way in. That is the difference
 *     between a bounded first-day cost and a page that bills the project every
 *     time somebody refreshes it.
 *
 * The audit row is not bookkeeping added for its own sake. `admin_audit_log` is
 * already where this codebase records consequential things done by something
 * other than a person at a console — `ingest.ts` writes `source.disable` there
 * with `actor_email: "pipeline:ingest"` — and spending model tokens on behalf of
 * one account is exactly that. It is the only record of what day one cost.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 *
 * Not a fix for a quiet day. The product promises that quiet days stay quiet,
 * and a reader whose topics genuinely match nothing gets `outcome: "quiet"` and
 * an empty dashboard that says so. Backfill fills a **new account**, and the
 * distinction is the promise rather than a detail: if this stage ever starts
 * loosening a threshold to find something to show, it has become the padding
 * every other briefing product does.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SecretBag } from "@/lib/ai/config";
import { related } from "@/lib/relate";
import { matchesTerms, normaliseText } from "@/lib/topics";
import type { Database } from "@/lib/supabase/types";
import { analyse } from "./analyse";
import { loadReaders, match, type Reader } from "./match";

type Db = SupabaseClient<Database>;

/**
 * How far back day one reaches.
 *
 * Wide enough that a reader who picks a quiet topic still sees something,
 * narrow enough that the first thing they read is not a stale wall of text. The
 * ingester's own `MAX_AGE_DAYS` is 30, so the corpus deliberately reaches
 * further back than this: stage 3 wants history to cluster against, and day one
 * does not.
 */
export const WINDOW_HOURS = 72;

/**
 * Events analysed on demand, per account, ever.
 *
 * Half the scheduled stage's hourly budget, and it buys a different thing. The
 * cron is draining a backlog on the project's own schedule; this is answering
 * one person's first page load, where the useful outcome is "some real news"
 * rather than "all of it". Three events at the measured mean of about 1,850
 * tokens is roughly 5,500 tokens to fill a new dashboard, once.
 */
export const ON_DEMAND_LIMIT = 3;

/** Pending events read before `worthAnalysing` filters them. Free — one query. */
const CANDIDATE_PAGE = 200;

/** The audit action that records, and then prevents, on-demand spend. */
export const AUDIT_ACTION = "backfill.analyse";

export type BackfillOptions = {
  /** The reader this is for. Stage 6 is per account by definition. */
  userId: string;
  /** Hours of corpus to consider. Absent means `WINDOW_HOURS`. */
  windowHours?: number | undefined;
  /**
   * Allow the paid path when nothing matches. On by default, because a first
   * page load with nothing on it is the problem this stage exists to solve.
   */
  onDemand?: boolean | undefined;
  /** Events analysed on demand. Absent means `ON_DEMAND_LIMIT`. */
  analyseLimit?: number | undefined;
  /** Decide and report, write nothing, call no model. */
  dryRun?: boolean | undefined;
  /** Worker bindings. Required on Cloudflare, where there is no `process.env`. */
  secrets?: SecretBag | undefined;
  now?: Date | undefined;
};

/**
 * How day one ended for one reader.
 *
 * `quiet` and `no-topics` are both empty dashboards and are deliberately not the
 * same outcome: one is the product working, the other is a reader who has not
 * told it anything yet, and only one of them is fixed by picking topics.
 */
export type BackfillOutcome =
  | "matched" // the free path found something. The common case.
  | "analysed" // nothing matched, so events were understood on demand, then matched
  | "quiet" // nothing matched and nothing was worth paying to understand
  | "no-topics" // follows nothing: an empty briefing is the correct answer
  | "no-reader"; // no preferences row, or briefings are paused

export type BackfillReport = {
  startedAt: string;
  finishedAt: string;
  userId: string;
  windowHours: number;
  outcome: BackfillOutcome;
  /** Events this reader now has, across both passes. */
  matched: number;
  /** Rows written to `user_events`. Excludes anything an earlier run wrote. */
  inserted: number;
  /** Events understood on demand. Zero on every path but one. */
  analysed: number;
  /** What those events cost. The only number in this stage that is not free. */
  tokens: number;
  /** Whether the paid path was refused because it had already run for this account. */
  spentBefore: boolean;
  detail: string;
};

/**
 * Fills a brand-new reader's dashboard from events that already exist.
 *
 * The free pass always runs. The paid one runs only if the free pass found
 * nothing, only if this account has never had it, and only over events whose
 * headline already names something the reader asked for.
 */
export async function backfill(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const windowHours = options.windowHours ?? WINDOW_HOURS;

  const done = (
    outcome: BackfillOutcome,
    rest: Partial<BackfillReport> & { detail: string },
  ): BackfillReport => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    userId: options.userId,
    windowHours,
    outcome,
    matched: 0,
    inserted: 0,
    analysed: 0,
    tokens: 0,
    spentBefore: false,
    ...rest,
  });

  // Paused readers are skipped here exactly as the cron skips them. Pausing
  // means "stop", and a stage that quietly kept filling the dashboard would be
  // making that word mean something narrower than the reader was told.
  const { readers } = await loadReaders(db, { userIds: [options.userId] });
  const reader = readers[0];
  if (!reader) {
    return done("no-reader", { detail: "no preferences row, or briefings are paused" });
  }

  if (reader.topics.length === 0) {
    // Not a miss worth spending on. Following nothing is a state the dashboard
    // already has words for, and no amount of analysis changes it.
    return done("no-topics", { detail: "follows no topics" });
  }

  const first = await runMatch(db, options, windowHours, now);
  if (first.matched > 0) {
    return done("matched", {
      matched: first.matched,
      inserted: first.inserted,
      detail: `${first.matched} matched from the last ${windowHours}h, ${first.inserted} new`,
    });
  }

  if (options.onDemand === false) {
    return done("quiet", { detail: "nothing matched; on-demand analysis not requested" });
  }

  if (await alreadySpent(db, options.userId)) {
    return done("quiet", {
      spentBefore: true,
      detail: "nothing matched; day one already paid for this account",
    });
  }

  const pending = await pendingEvents(db, windowHours, now);
  const worth = worthAnalysing(pending, reader, options.analyseLimit ?? ON_DEMAND_LIMIT);

  if (worth.length === 0) {
    return done("quiet", {
      detail: `nothing matched, and none of ${pending.length} unanalysed events names a followed topic`,
    });
  }

  if (options.dryRun) {
    return done("quiet", {
      detail: `would analyse ${worth.length} of ${pending.length} unanalysed events (dry run)`,
    });
  }

  // Written before the model is called, not after. A crash between the two
  // costs this account its day-one analysis; the other order costs the project
  // an unbounded number of them.
  await recordSpend(db, options.userId, worth);

  const analysis = await analyse(db, {
    eventIds: worth.map((e) => e.id),
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });

  const tokens = analysis.promptTokens + analysis.completionTokens;
  const second = await runMatch(db, options, windowHours, now);

  return done(second.matched > 0 ? "analysed" : "quiet", {
    matched: second.matched,
    inserted: second.inserted,
    analysed: analysis.analysed,
    tokens,
    detail:
      `analysed ${analysis.analysed} of ${worth.length} on demand for ${tokens} tokens, ` +
      `then matched ${second.matched}`,
  });
}

/** One reader, one window. Stage 5 unchanged — this stage adds no rules of its own. */
async function runMatch(
  db: Db,
  options: BackfillOptions,
  windowHours: number,
  now: Date,
): Promise<{ matched: number; inserted: number }> {
  const report = await match(db, {
    userIds: [options.userId],
    sinceHours: windowHours,
    ...(options.dryRun ? { dryRun: true } : {}),
    now,
    skipAlerts: true,
  });

  const outcome = report.outcomes[0];
  return { matched: outcome?.matched ?? 0, inserted: outcome?.inserted ?? 0 };
}

export type PendingEvent = { id: string; title: string };

/**
 * Unanalysed events from the window, newest first.
 *
 * `status = 'pending'` rather than every unanalysed row: an event that failed
 * analysis once will usually fail again — a cluster of CI notifications has
 * nothing in it to understand — and a reader's first page load is not the place
 * to discover that a second time. `analyse` applies the same rule for the same
 * reason.
 */
async function pendingEvents(db: Db, windowHours: number, now: Date): Promise<PendingEvent[]> {
  const since = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const { data, error } = await db
    .from("events")
    .select("id, title")
    .is("analysed_at", null)
    .eq("status", "pending")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(CANDIDATE_PAGE);

  if (error) throw new Error(`reading pending events: ${error.message}`);
  return data ?? [];
}

/**
 * Which unanalysed events are worth paying to understand, for this reader.
 *
 * All that exists to judge on is the headline stage 3 left on the event, so this
 * is a weaker test than matching — it can admit an event that turns out to score
 * below the reader's threshold, and it will miss one whose headline happens not
 * to name the thing it is about. Both are acceptable: the first costs one
 * analysis that the whole corpus then shares forever, and the second costs
 * nothing at all.
 *
 * What it must not do is guess. A candidate has to name a followed topic — its
 * label, its slug, a keyword the reader added, or every term of an interest they
 * created — through the same predicates the matcher uses, so a reader cannot be
 * billed for an event they had no visible connection to. And a candidate the reader's own exclusions veto is
 * dropped before it is paid for rather than after.
 */
export function worthAnalysing(
  events: PendingEvent[],
  reader: Reader,
  limit: number,
): PendingEvent[] {
  const wanted = reader.topics.flatMap((t) =>
    t.kind === "predefined" ? [t.label, t.slug, ...t.keywords] : t.keywords,
  );
  const vetoes = [...reader.exclusions, ...reader.topics.flatMap((t) => t.excludeKeywords)];
  // A reader-created interest has to earn its place here the same way, and can
  // only be judged on the headline: an event this stage is deciding whether to
  // pay for has not been analysed, so it has no tags yet. Every term must
  // appear, which is the same rule stage 5 applies to the richer signal.
  const custom = reader.topics.filter((t) => t.kind === "custom" && t.terms.length > 0);

  const chosen: PendingEvent[] = [];
  for (const event of events) {
    if (chosen.length >= limit) break;
    const named =
      wanted.some((term) => related(event.title, term)) ||
      custom.some((t) => matchesTerms(normaliseText(event.title), t.terms));
    if (!named) continue;
    if (vetoes.some((term) => related(event.title, term))) continue;
    chosen.push(event);
  }

  return chosen;
}

/** Whether day one has already been paid for on this account. */
async function alreadySpent(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("admin_audit_log")
    .select("id")
    .eq("action", AUDIT_ACTION)
    .eq("target_type", "profile")
    .eq("target_id", userId)
    .limit(1);

  // A failed read must not open the gate. The cost of being wrong the other way
  // is one reader's dashboard staying empty until the cron catches up.
  if (error) throw new Error(`reading audit log: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The row that both records the spend and refuses the next one. */
async function recordSpend(db: Db, userId: string, events: PendingEvent[]): Promise<void> {
  const { error } = await db.from("admin_audit_log").insert({
    actor_id: userId,
    actor_email: "pipeline:backfill",
    action: AUDIT_ACTION,
    target_type: "profile",
    target_id: userId,
    meta: { events: events.map((e) => e.id) },
  });

  // Unlike `audit()` in the console, this one throws. There the row is a record
  // of something that already happened; here it is the brake, and a brake that
  // failed silently would let every page load spend money.
  if (error) throw new Error(`recording backfill spend: ${error.message}`);
}

/** One line per run, for `wrangler tail` and for the operator running it by hand. */
export function describeBackfill(report: BackfillReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);

  return (
    `backfill: ${report.userId.slice(0, 8)} ${report.outcome}, ` +
    `${report.matched} matched, ${report.inserted} new, ` +
    `${report.analysed} analysed for ${report.tokens} tokens, ${seconds}s` +
    ` | ${report.detail}`
  );
}
