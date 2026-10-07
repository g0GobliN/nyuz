import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOnly, audit, superadminOnly, AdminAuthError, type Actor } from "@/lib/server/guard";
import { countOrThrow } from "@/lib/supabase/count";
import { PLAN_TIERS } from "@/lib/plans";
import type { AdminRole, Database, PlanTier } from "@/lib/supabase/types";

/**
 * User administration.
 *
 * Two things here are more dangerous than the rest of the console and are
 * gated harder:
 *
 *   - Banning writes to auth.users through the Admin API. The user_bans row is
 *     only the reason and the paper trail; auth.users.banned_until is what
 *     actually stops the session. Both move together or the ban is a lie.
 *   - Role changes are superadmin-only, and there are two invariants the UI
 *     cannot be trusted to keep: an admin cannot outrank the person editing
 *     them, and the last superadmin cannot be removed. Both are enforced here.
 */

/** 100 years. Supabase wants a Go duration string; there is no "forever". */
const INDEFINITE = "876000h";

const ROLE_RANK: Record<AdminRole, number> = { user: 0, admin: 1, superadmin: 2 };

/**
 * PostgREST's `.or()` takes a comma/parenthesis mini-language, so a search term
 * containing those characters would change the filter's meaning. Strip them —
 * a search box has no legitimate need for them.
 */
function safeTerm(raw: string): string {
  return raw
    .replace(/[,()*\\]/g, "")
    .trim()
    .slice(0, 100);
}

export type UserListRow = {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  plan: PlanTier;
  planStatus: string;
  banned: boolean;
  onboarded: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

export type UserListResult = {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
};

const listInput = z.object({
  search: z.string().optional().default(""),
  page: z.number().int().min(0).optional().default(0),
  pageSize: z.number().int().min(1).max(100).optional().default(25),
  role: z.enum(["user", "admin", "superadmin"]).optional(),
  plan: z.enum(["uno", "plura", "omni"]).optional(),
  bannedOnly: z.boolean().optional().default(false),
});

export const listUsers = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ context, data }): Promise<UserListResult> => {
    const db = context.actor.db;
    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;

    let query = db
      .from("profiles")
      .select("id, email, display_name, onboarded_at, created_at, last_seen_at", {
        count: "exact",
      });

    const term = safeTerm(data.search);
    if (term) {
      query = query.or(`email.ilike.%${term}%,display_name.ilike.%${term}%`);
    }

    const {
      data: profiles,
      count,
      error,
    } = await query.order("created_at", { ascending: false }).range(from, to);

    if (error) throw new AdminAuthError(`List users: ${error.message}`, 500);

    const ids = (profiles ?? []).map((p) => p.id);
    // Roles, plans and bans live in separate tables. Fetch the three slices for
    // just this page in parallel, then stitch — cheaper than three joins per row.
    const [roles, subs, bans] = await Promise.all([
      db.from("user_roles").select("user_id, role").in("user_id", ids),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", ids),
      db.from("user_bans").select("user_id").in("user_id", ids),
    ]);

    const roleBy = new Map((roles.data ?? []).map((r) => [r.user_id, r.role]));
    const subBy = new Map((subs.data ?? []).map((s) => [s.user_id, s]));
    const bannedSet = new Set((bans.data ?? []).map((b) => b.user_id));

    let rows: UserListRow[] = (profiles ?? []).map((p) => {
      const sub = subBy.get(p.id);
      return {
        id: p.id,
        email: p.email,
        displayName: p.display_name,
        role: roleBy.get(p.id) ?? "user",
        plan: sub?.plan ?? "uno",
        planStatus: sub?.status ?? "active",
        banned: bannedSet.has(p.id),
        onboarded: p.onboarded_at !== null,
        createdAt: p.created_at,
        lastSeenAt: p.last_seen_at,
      };
    });

    // Role/plan/ban filters run here, after stitching, because they live on
    // other tables. The count above is therefore the pre-filter total; when a
    // filter is active the UI shows "matching this page" rather than a global
    // count, which the pagination copy reflects.
    if (data.role) rows = rows.filter((r) => r.role === data.role);
    if (data.plan) rows = rows.filter((r) => r.plan === data.plan);
    if (data.bannedOnly) rows = rows.filter((r) => r.banned);

    return {
      rows,
      total: count ?? rows.length,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export type UserDetail = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  role: AdminRole;
  plan: PlanTier;
  planStatus: string;
  currentPeriodEnd: string | null;
  onboardedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  ban: { reason: string; bannedAt: string; expiresAt: string | null } | null;
  counts: { topics: number; savedStories: number; digests: number; feedback: number };
  recentDigests: { scheduledFor: string; status: string; itemCount: number }[];
};

export const getUserDetail = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ userId: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<UserDetail> => {
    const db = context.actor.db;
    const { userId } = data;

    const [profile, role, sub, ban, topics, saved, digests, feedback, recent] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      db.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      db.from("user_bans").select("*").eq("user_id", userId).maybeSingle(),
      countFor(db, "user_topics", userId),
      countFor(db, "saved_stories", userId),
      countFor(db, "digests", userId),
      countFor(db, "feedback", userId),
      db
        .from("digests")
        .select("scheduled_for, status, item_count")
        .eq("user_id", userId)
        .order("scheduled_for", { ascending: false })
        .limit(5),
    ]);

    if (profile.error) throw new AdminAuthError(`User detail: ${profile.error.message}`, 500);
    if (!profile.data) throw new AdminAuthError("User not found.", 404);

    return {
      id: profile.data.id,
      email: profile.data.email,
      displayName: profile.data.display_name,
      timezone: profile.data.timezone,
      role: role.data?.role ?? "user",
      plan: sub.data?.plan ?? "uno",
      planStatus: sub.data?.status ?? "active",
      currentPeriodEnd: sub.data?.current_period_end ?? null,
      onboardedAt: profile.data.onboarded_at,
      createdAt: profile.data.created_at,
      lastSeenAt: profile.data.last_seen_at,
      ban: ban.data
        ? { reason: ban.data.reason, bannedAt: ban.data.banned_at, expiresAt: ban.data.expires_at }
        : null,
      counts: {
        topics: topics,
        savedStories: saved,
        digests: digests,
        feedback: feedback,
      },
      recentDigests: (recent.data ?? []).map((d) => ({
        scheduledFor: d.scheduled_for,
        status: d.status,
        itemCount: d.item_count,
      })),
    };
  });

async function countFor(
  db: SupabaseClient<Database>,
  table: "user_topics" | "saved_stories" | "digests" | "feedback",
  userId: string,
): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  try {
    return countOrThrow(`count(${table})`, { count, error });
  } catch (cause) {
    throw new AdminAuthError((cause as Error).message, 500);
  }
}

/** Reads a user's current role directly, bypassing the stitched list. */
async function roleOf(actor: Actor, userId: string): Promise<AdminRole> {
  const { data, error } = await actor.db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AdminAuthError(`Read role: ${error.message}`, 500);
  return data?.role ?? "user";
}

const banInput = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional().default(""),
  /** ISO date; omitted or null = indefinite. */
  expiresAt: z.string().datetime().nullable().optional(),
});

export const banUser = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => banInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;
    if (data.userId === actor.id) {
      throw new AdminAuthError("You cannot ban yourself.", 400);
    }

    // An admin cannot ban another admin or a superadmin; only a superadmin can
    // act on staff. This stops one admin from locking out the rest.
    const targetRole = await roleOf(actor, data.userId);
    if (targetRole !== "user" && actor.role !== "superadmin") {
      throw new AdminAuthError("Only a superadmin can ban another admin.", 403);
    }

    // Duration is measured from now. A past expiry would be a no-op ban, so an
    // explicit expiry in the past is rejected rather than silently ignored.
    let banDuration = INDEFINITE;
    if (data.expiresAt) {
      const ms = new Date(data.expiresAt).getTime() - Date.now();
      if (ms <= 0) throw new AdminAuthError("Ban expiry must be in the future.", 400);
      banDuration = `${Math.ceil(ms / 3_600_000)}h`;
    }

    // Enforcement first. If this fails the ban has not taken effect, so the
    // row must not be written — otherwise the console would show a ban that
    // does not exist in auth.
    const { error: authError } = await actor.db.auth.admin.updateUserById(data.userId, {
      ban_duration: banDuration,
    });
    if (authError) throw new AdminAuthError(`Ban failed: ${authError.message}`, 500);

    const { error } = await actor.db.from("user_bans").upsert({
      user_id: data.userId,
      reason: data.reason,
      banned_by: actor.id,
      banned_at: new Date().toISOString(),
      expires_at: data.expiresAt ?? null,
    });
    if (error) throw new AdminAuthError(`Ban record failed: ${error.message}`, 500);

    await audit(
      actor,
      "user.ban",
      { type: "user", id: data.userId },
      {
        reason: data.reason,
        expiresAt: data.expiresAt ?? null,
      },
    );
    return { ok: true };
  });

export const unbanUser = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ userId: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    // An admin cannot unban another admin or a superadmin; only a superadmin can
    // act on staff. This mirrors banUser so the two stay symmetric.
    const targetRole = await roleOf(actor, data.userId);
    if (targetRole !== "user" && actor.role !== "superadmin") {
      throw new AdminAuthError("Only a superadmin can unban another admin.", 403);
    }

    const { error: authError } = await actor.db.auth.admin.updateUserById(data.userId, {
      ban_duration: "none",
    });
    if (authError) throw new AdminAuthError(`Unban failed: ${authError.message}`, 500);

    const { error } = await actor.db.from("user_bans").delete().eq("user_id", data.userId);
    if (error) throw new AdminAuthError(`Unban record failed: ${error.message}`, 500);

    await audit(actor, "user.unban", { type: "user", id: data.userId });
    return { ok: true };
  });

const roleInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin", "superadmin"]),
});

/**
 * Role changes are superadmin-only. The invariants below are the reason this
 * is not just an upsert: a console that lets the last superadmin demote
 * themselves is one bad click from locking everyone out.
 */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) => roleInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;
    const current = await roleOf(actor, data.userId);
    if (current === data.role) return { ok: true };

    // Guard the floor: if this edit removes the last superadmin, refuse. Counts
    // the others, not the total, so demoting yourself while a colleague remains
    // is allowed.
    if (current === "superadmin" && data.role !== "superadmin") {
      const { count, error } = await actor.db
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "superadmin")
        .neq("user_id", data.userId);
      // Read the count, and refuse on a count that could not be read: the
      // floor is only safe to lower on a number the server really sent.
      let others: number;
      try {
        others = countOrThrow("other superadmins", { count, error });
      } catch (cause) {
        throw new AdminAuthError(`Role check: ${(cause as Error).message}`, 500);
      }
      if (others === 0) {
        throw new AdminAuthError("Refusing to remove the last superadmin.", 400);
      }
    }

    const { error } = await actor.db.from("user_roles").upsert({
      user_id: data.userId,
      role: data.role,
      granted_by: actor.id,
      granted_at: new Date().toISOString(),
    });
    if (error) throw new AdminAuthError(`Role change failed: ${error.message}`, 500);

    await audit(
      actor,
      "user.role",
      { type: "user", id: data.userId },
      {
        from: current,
        to: data.role,
      },
    );
    return { ok: true };
  });

const planInput = z.object({
  userId: z.string().uuid(),
  plan: z.enum(["uno", "plura", "omni"]),
});

/**
 * Manual plan override — for comps, support credits and refunds. In production
 * the billing webhook owns this column; a manual change here is deliberately
 * audited so a later reconciliation can tell operator edits from billed ones.
 */
export const setUserPlan = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => planInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;
    if (!PLAN_TIERS.includes(data.plan)) {
      throw new AdminAuthError("Unknown plan.", 400);
    }

    // An admin cannot change the plan of another admin or a superadmin; only a
    // superadmin can act on staff. This stops one admin from cutting off access.
    const targetRole = await roleOf(actor, data.userId);
    if (targetRole !== "user" && actor.role !== "superadmin") {
      throw new AdminAuthError("Only a superadmin can change another admin's plan.", 403);
    }

    // Clear any retired subscription IDs so a later webhook cannot overwrite
    // this manual override.
    const { error } = await actor.db.from("subscriptions").upsert({
      user_id: data.userId,
      plan: data.plan,
      status: "active",
      stripe_subscription_id: null,
      retired_stripe_subscription_id: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new AdminAuthError(`Plan change failed: ${error.message}`, 500);

    await audit(actor, "user.plan", { type: "user", id: data.userId }, { to: data.plan });
    return { ok: true };
  });
