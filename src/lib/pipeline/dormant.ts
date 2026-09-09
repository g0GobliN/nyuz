/**
 * The dormant-reader nudge. Stage 7 sends briefings; this notices nobody opened
 * them.
 *
 * Open-tracking on the mail itself is a Resend webhook and a verified domain.
 * What we already promised, in the privacy policy and on `profiles.last_seen_at`,
 * is that a visit to the product is what distinguishes active from dormant. So
 * this keys off that column, written when the dashboard loads, not off a pixel.
 *
 * Quiet days and paused accounts are not dormancy. A reader who has never
 * received a briefing has nothing to have ignored. A reader who was nudged
 * recently is not nudged again — the audit row is the brake, same pattern as
 * day-one analysis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendBriefingsPaused, sendDormant } from "@/lib/server/email/lifecycle";
import { siteUrl, type EmailEnv } from "@/lib/server/email/send";
import { unsubscribeUrl } from "@/lib/server/email/unsubscribe";
import type { Database } from "@/lib/supabase/types";
import { CANDIDATE_EXPIRY_DAYS } from "./freshness";

type Db = SupabaseClient<Database>;

export const DORMANT_DAYS = 23;
export const AUTO_PAUSE_DAYS = 30;
export const NUDGE_EVERY_DAYS = 30;
export const AUDIT_ACTION = "email.dormant";
export const PAUSE_AUDIT_ACTION = "briefing.auto_paused";

const BATCH = 20;

export type DormantOptions = {
  now?: Date | undefined;
  dryRun?: boolean | undefined;
  limit?: number | undefined;
  email?: EmailEnv | undefined;
};

export type DormantDecision = "sent" | "paused" | "skipped" | "failed";

export type DormantOutcome = {
  userId: string;
  decision: DormantDecision;
  detail: string;
};

export type DormantReport = {
  startedAt: string;
  finishedAt: string;
  considered: number;
  sent: number;
  paused: number;
  skipped: number;
  failed: number;
  purged: number;
  /** Accounts whose reversible deletion window ended during this sweep. */
  deletedAccounts: number;
  /** Unbriefed matches marked ineligible by age (0068). Marked, not deleted. */
  expired: number;
  outcomes: DormantOutcome[];
};

export type NudgeInput = {
  onboardedAt: string | null;
  lastSeenAt: string | null;
  paused: boolean;
  hasDigest: boolean;
  lastNudgedAt: string | null;
  now: Date;
};

/**
 * Whether this reader is due a nudge. Pure, so the tests can pin the rules
 * without a database.
 */
export function dueForNudge({
  onboardedAt,
  lastSeenAt,
  paused,
  hasDigest,
  lastNudgedAt,
  now,
}: NudgeInput): boolean {
  if (paused) return false;
  if (!hasDigest) return false;
  if (onboardedAt === null) return false;

  const oldest = now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000;
  if (Date.parse(onboardedAt) > oldest) return false;

  const lastActive = lastSeenAt !== null ? Date.parse(lastSeenAt) : Date.parse(onboardedAt);
  if (lastActive > oldest) return false;

  if (lastNudgedAt !== null) {
    const wait = now.getTime() - NUDGE_EVERY_DAYS * 24 * 60 * 60 * 1000;
    if (Date.parse(lastNudgedAt) > wait) return false;
  }

  return true;
}

export async function dormant(db: Db, options: DormantOptions = {}): Promise<DormantReport> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const candidates = await loadCandidates(db, now, options.limit ?? BATCH);

  const outcomes: DormantOutcome[] = [];
  for (const candidate of candidates) {
    outcomes.push(await nudgeOne(db, candidate, options, now));
  }
  let purged = 0;
  let deletedAccounts = 0;
  let expired = 0;
  if (options.dryRun !== true) {
    const { data, error } = await db.rpc("purge_expired_digests", { p_limit: 500 });
    if (error) console.error(`purging expired digests: ${error.message}`);
    else purged = data ?? 0;

    const { data: corpus, error: corpusError } = await db.rpc("purge_expired_corpus", {
      p_limit: 500,
    });
    if (corpusError) console.error(`purging expired corpus: ${corpusError.message}`);
    else purged += corpus ?? 0;

    const { data: accounts, error: accountError } = await db.rpc(
      "purge_expired_account_deletions",
      { p_limit: 100 },
    );
    if (accountError) console.error(`purging expired accounts: ${accountError.message}`);
    else deletedAccounts = accounts ?? 0;

    // Briefing candidates that aged out without ever being sent (0068). Counted
    // separately from `purged` because nothing is destroyed here — the rows keep
    // recording that this reader matched this event, which dedupe and analytics
    // read; they simply stop being eligible for a future briefing. A failure is
    // logged and swallowed for the same reason the purges above are: a sweep
    // that could not run is a reason to look at the sweep, not a reason to fail
    // the daily nudge that shares its cron.
    const { data: staleMatches, error: expiryError } = await db.rpc("expire_stale_user_events", {
      p_days: CANDIDATE_EXPIRY_DAYS,
      p_limit: 5000,
    });
    if (expiryError) console.error(`expiring stale briefing candidates: ${expiryError.message}`);
    else expired = staleMatches ?? 0;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: candidates.length,
    sent: outcomes.filter((o) => o.decision === "sent").length,
    paused: outcomes.filter((o) => o.decision === "paused").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
    purged,
    deletedAccounts,
    expired,
    outcomes,
  };
}

type Candidate = {
  userId: string;
  onboardedAt: string | null;
  lastSeenAt: string | null;
  paused: boolean;
  hasDigest: boolean;
  lastNudgedAt: string | null;
};

async function loadCandidates(db: Db, now: Date, limit: number): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: profiles, error: profileError } = await db
    .from("profiles")
    .select("id, onboarded_at, last_seen_at")
    .not("onboarded_at", "is", null)
    .lte("onboarded_at", cutoff)
    .or(`last_seen_at.is.null,last_seen_at.lte."${cutoff}"`)
    .limit(limit * 4);

  if (profileError) throw new Error(`reading profiles: ${profileError.message}`);
  const rows = profiles ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);

  const [{ data: prefs }, { data: digests }, { data: nudges }, { data: subscriptions }] =
    await Promise.all([
      db.from("notification_preferences").select("user_id, paused").in("user_id", ids),
      db
        .from("digests")
        .select("user_id")
        .in("user_id", ids)
        .in("status", ["ready", "sent", "skipped"]),
      db
        .from("admin_audit_log")
        .select("target_id, created_at")
        .eq("action", AUDIT_ACTION)
        .in("target_id", ids)
        .order("created_at", { ascending: false }),
      db.from("subscriptions").select("user_id, plan").in("user_id", ids),
    ]);

  const paused = new Map((prefs ?? []).map((p) => [p.user_id, p.paused]));
  const mailed = new Set((digests ?? []).map((d) => d.user_id));
  const lastNudge = new Map<string, string>();
  const free = new Set(
    (subscriptions ?? [])
      .filter((subscription) => subscription.plan === "uno")
      .map((s) => s.user_id),
  );
  for (const row of nudges ?? []) {
    if (!lastNudge.has(row.target_id)) lastNudge.set(row.target_id, row.created_at);
  }

  const due: Candidate[] = [];
  for (const profile of rows) {
    if (!free.has(profile.id)) continue;
    const candidate: Candidate = {
      userId: profile.id,
      onboardedAt: profile.onboarded_at,
      lastSeenAt: profile.last_seen_at,
      paused: paused.get(profile.id) === true,
      hasDigest: mailed.has(profile.id),
      lastNudgedAt: lastNudge.get(profile.id) ?? null,
    };
    const lastActive = candidate.lastSeenAt ?? candidate.onboardedAt;
    const autoPauseCutoff = now.getTime() - AUTO_PAUSE_DAYS * 86_400_000;
    const autoPauseDue =
      !candidate.paused &&
      candidate.hasDigest &&
      lastActive !== null &&
      Date.parse(lastActive) <= autoPauseCutoff;
    if (!autoPauseDue && !dueForNudge({ ...candidate, now })) continue;
    due.push(candidate);
    if (due.length >= limit) break;
  }
  return due;
}

async function nudgeOne(
  db: Db,
  candidate: Candidate,
  options: DormantOptions,
  now: Date,
): Promise<DormantOutcome> {
  const base = { userId: candidate.userId };
  const lastActive = candidate.lastSeenAt ?? candidate.onboardedAt;
  const inactiveDays = lastActive
    ? Math.floor((now.getTime() - Date.parse(lastActive)) / 86_400_000)
    : 0;

  if (options.dryRun === true) {
    return {
      ...base,
      decision: "skipped",
      detail:
        inactiveDays >= AUTO_PAUSE_DAYS
          ? "would auto-pause inactive Uno reader"
          : "would send inactivity warning",
    };
  }

  if (inactiveDays >= AUTO_PAUSE_DAYS) {
    const { data: changed, error } = await db
      .from("notification_preferences")
      .update({ paused: true, updated_at: now.toISOString() })
      .eq("user_id", candidate.userId)
      .eq("paused", false)
      .select("user_id");
    if (error) return { ...base, decision: "failed", detail: `auto-pause: ${error.message}` };
    if (!changed || changed.length === 0) {
      return { ...base, decision: "skipped", detail: "already paused" };
    }

    await db
      .from("profiles")
      .update({ auto_paused_at: now.toISOString() })
      .eq("id", candidate.userId);
    const notified = await sendBriefingsPaused(db, candidate.userId, options.email);
    await db.from("admin_audit_log").insert({
      actor_email: "pipeline:dormant",
      action: PAUSE_AUDIT_ACTION,
      target_type: "user",
      target_id: candidate.userId,
      meta: { days: inactiveDays, notified },
    });
    return {
      ...base,
      decision: "paused",
      detail: `${inactiveDays} inactive days${notified ? "" : "; notice failed"}`,
    };
  }

  const origin = siteUrl(options.email);
  let unsubscribe: string;
  try {
    unsubscribe = await unsubscribeUrl(candidate.userId, origin, options.email, now);
  } catch (error) {
    return { ...base, decision: "failed", detail: (error as Error).message };
  }
  const sent = await sendDormant(
    db,
    candidate.userId,
    { days: inactiveDays, unsubscribeUrl: unsubscribe },
    options.email,
    `dormant:${candidate.userId}:${now.toISOString().slice(0, 10)}`,
  );

  if (!sent) return { ...base, decision: "failed", detail: "send failed" };

  await db.from("admin_audit_log").insert({
    actor_email: "pipeline:dormant",
    action: AUDIT_ACTION,
    target_type: "user",
    target_id: candidate.userId,
    meta: { days: inactiveDays },
  });

  return { ...base, decision: "sent", detail: `no visit in ${inactiveDays} days` };
}

export function describeDormant(report: DormantReport): string {
  const seconds = Math.round(
    (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000,
  );
  return (
    `dormant: ${report.considered} due, ${report.sent} warned, ${report.paused} paused, ` +
    `${report.skipped} skipped, ${report.failed} failed, ${report.purged} expired rows purged, ` +
    `${report.deletedAccounts} expired accounts deleted, ` +
    `${report.expired} stale candidates retired, ${seconds}s`
  );
}
