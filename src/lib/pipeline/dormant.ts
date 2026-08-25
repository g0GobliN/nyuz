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
import { sendDormant } from "@/lib/server/email/lifecycle";
import { siteUrl, type EmailEnv } from "@/lib/server/email/send";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

export const DORMANT_DAYS = 7;
export const NUDGE_EVERY_DAYS = 14;
export const AUDIT_ACTION = "email.dormant";

const BATCH = 20;

export type DormantOptions = {
  now?: Date | undefined;
  dryRun?: boolean | undefined;
  limit?: number | undefined;
  email?: EmailEnv | undefined;
};

export type DormantDecision = "sent" | "skipped" | "failed";

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
  skipped: number;
  failed: number;
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

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: candidates.length,
    sent: outcomes.filter((o) => o.decision === "sent").length,
    skipped: outcomes.filter((o) => o.decision === "skipped").length,
    failed: outcomes.filter((o) => o.decision === "failed").length,
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

  const [{ data: prefs }, { data: digests }, { data: nudges }] = await Promise.all([
    db.from("notification_preferences").select("user_id, paused").in("user_id", ids),
    db.from("digests").select("user_id").in("user_id", ids).in("status", ["ready", "sent", "skipped"]),
    db
      .from("admin_audit_log")
      .select("target_id, created_at")
      .eq("action", AUDIT_ACTION)
      .in("target_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  const paused = new Map((prefs ?? []).map((p) => [p.user_id, p.paused]));
  const mailed = new Set((digests ?? []).map((d) => d.user_id));
  const lastNudge = new Map<string, string>();
  for (const row of nudges ?? []) {
    if (!lastNudge.has(row.target_id)) lastNudge.set(row.target_id, row.created_at);
  }

  const due: Candidate[] = [];
  for (const profile of rows) {
    const candidate: Candidate = {
      userId: profile.id,
      onboardedAt: profile.onboarded_at,
      lastSeenAt: profile.last_seen_at,
      paused: paused.get(profile.id) === true,
      hasDigest: mailed.has(profile.id),
      lastNudgedAt: lastNudge.get(profile.id) ?? null,
    };
    if (!dueForNudge({ ...candidate, now })) continue;
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

  if (options.dryRun === true) {
    return { ...base, decision: "skipped", detail: "would send dormant nudge" };
  }

  const origin = siteUrl(options.email);
  const sent = await sendDormant(
    db,
    candidate.userId,
    { days: DORMANT_DAYS, unsubscribeUrl: `${origin}/dashboard/delivery` },
    options.email,
    `dormant:${candidate.userId}:${now.toISOString().slice(0, 10)}`,
  );

  if (!sent) return { ...base, decision: "failed", detail: "send failed" };

  await db.from("admin_audit_log").insert({
    actor_email: "pipeline:dormant",
    action: AUDIT_ACTION,
    target_type: "user",
    target_id: candidate.userId,
    meta: { days: DORMANT_DAYS },
  });

  return { ...base, decision: "sent", detail: `no visit in ${DORMANT_DAYS} days` };
}

export function describeDormant(report: DormantReport): string {
  const seconds = Math.round(
    (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000,
  );
  return (
    `dormant: ${report.considered} due, ${report.sent} sent, ` +
    `${report.skipped} skipped, ${report.failed} failed, ${seconds}s`
  );
}
