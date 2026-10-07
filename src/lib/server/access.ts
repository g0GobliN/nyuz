import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import { countOrThrow } from "@/lib/supabase/count";
import { signupRateLimit } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCESS_DEFAULT, accessSchema, parseSetting, type Access } from "@/lib/site-content";
import { sendWaitlistInvited, sendWaitlistJoined } from "@/lib/server/email/lifecycle";
import type { WaitlistEntry } from "@/lib/supabase/types";

/**
 * Capacity, the waitlist, and the maintenance switch.
 *
 * **Nothing in this file is a security boundary.** The gate is the
 * `enforce_signups_open` trigger on `auth.users` in `0038_access_control.sql`,
 * because a Google sign-in never touches a server function we wrote — it goes
 * straight to GoTrue. Everything here exists so the product can *say* something
 * useful before the database refuses, which is the same split the console draws
 * between `viewer.ts` and `guard.ts`.
 *
 * So a bug here costs a visitor a confusing screen. It cannot cost a seat.
 */

/** Reads the stored access row, falling back rather than throwing. */
async function readAccess(): Promise<Access> {
  const db = createAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("key", "site.access")
    .maybeSingle();
  const [access] = parseSetting(accessSchema, data?.value ?? null, ACCESS_DEFAULT);
  return access;
}

export type SignupState = {
  /** Whether an account can be created right now. */
  open: boolean;
  /** Why not, when it is closed. Drives which screen the auth page shows. */
  reason: "open" | "full" | "closed" | "maintenance";
  /** Whether to offer the waitlist form rather than only an email address. */
  waitlistOpen: boolean;
};

/**
 * Whether signup is possible, for the auth page.
 *
 * Public and unauthenticated by necessity — it is read by somebody who does
 * not have an account yet. It therefore returns no counts: how many seats are
 * left, and how many people are waiting, are operator numbers. "Full" is all a
 * visitor needs, and all they are told.
 *
 * Never throws. A database wobble here would otherwise turn the sign-in page
 * into an error page for people who already have accounts, so failure reports
 * the doors as open and lets the trigger be the one to refuse.
 */
export const getSignupState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SignupState> => {
    try {
      const db = createAdminClient();
      const access = await readAccess();

      if (access.maintenance) {
        return { open: false, reason: "maintenance", waitlistOpen: false };
      }

      const { data: flag } = await db
        .from("feature_flags")
        .select("enabled")
        .eq("key", "signups_open")
        .maybeSingle();
      if (flag?.enabled !== true) {
        return { open: false, reason: "closed", waitlistOpen: access.waitlistOpen };
      }

      if (access.userLimit <= 0) {
        return { open: true, reason: "open", waitlistOpen: access.waitlistOpen };
      }

      // `head: true` asks Postgres for the count and none of the rows. An
      // unreadable count throws into the catch below, which is the launch
      // gate's written-down answer: a gate that cannot be read opens, because
      // locking every reader out on a failed read is the worse failure. That
      // decision lives there, not in a substituted zero here.
      const { count, error } = await db
        .from("profiles")
        .select("id", { count: "exact", head: true });
      const full = countOrThrow("profiles", { count, error }) >= access.userLimit;
      return {
        open: !full,
        reason: full ? "full" : "open",
        waitlistOpen: access.waitlistOpen,
      };
    } catch {
      return { open: true, reason: "open", waitlistOpen: true };
    }
  },
);

const joinInput = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
});

/**
 * Joins the waitlist.
 *
 * Public, and deliberately says the same thing whether or not the address was
 * already on the list. A form that answers "you are already on it" for one
 * address and "added" for another is an account-existence oracle, and this one
 * would answer for people who have not signed up yet.
 *
 * The address is lower-cased here because the signup trigger looks it up with
 * `lower(new.email)`; storing it any other way makes an invitation that can
 * never be spent.
 */
export const joinWaitlist = createServerFn({ method: "POST" })
  .middleware([signupRateLimit])
  .validator(joinInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const email = data.email.toLowerCase();

    try {
      const db = createAdminClient();
      const access = await readAccess();
      // Refused rather than silently dropped: an operator who closed the
      // waitlist does not want a list quietly filling up behind the switch.
      if (!access.waitlistOpen) return { ok: true };

      const { data: existing } = await db
        .from("waitlist")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (!existing) {
        const { error } = await db
          .from("waitlist")
          .insert({ email, name: data.name, note: data.note });
        // A unique-violation here is two submissions racing, which is the same
        // outcome as being on the list already.
        if (error && error.code !== "23505") {
          throw new Error(`joining waitlist: ${error.message}`);
        }
        await sendWaitlistJoined({ email, name: data.name });
      }
    } catch (error) {
      console.error(`joinWaitlist: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Always the same answer. See the note above about the oracle.
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Console                                                                */
/* ---------------------------------------------------------------------- */

export type AccessOverview = {
  access: Access;
  signupsFlagOn: boolean;
  seatsUsed: number;
  waiting: number;
  invitedPending: number;
  admitted: number;
};

export const getAccessOverview = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AccessOverview> => {
    const { db } = context.actor;
    const access = await readAccess();

    const [{ data: state, error }, { data: flag }] = await Promise.all([
      db.rpc("admin_access_state"),
      db.from("feature_flags").select("enabled").eq("key", "signups_open").maybeSingle(),
    ]);
    if (error) throw new AdminAuthError(`Access state: ${error.message}`, 500);

    const row = state?.[0];
    return {
      access,
      signupsFlagOn: flag?.enabled === true,
      seatsUsed: row?.seats_used ?? 0,
      waiting: row?.waiting ?? 0,
      invitedPending: row?.invited_pending ?? 0,
      admitted: row?.admitted ?? 0,
    };
  });

export const listWaitlist = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
  .handler(async ({ context, data }): Promise<WaitlistEntry[]> => {
    const { db } = context.actor;
    const { data: rows, error } = await db
      .from("waitlist")
      .select("*")
      // Oldest first: a waitlist that invites the most recent applicant first
      // is not a waitlist.
      .order("created_at", { ascending: true })
      .limit(data.limit);
    if (error) throw new AdminAuthError(`List waitlist: ${error.message}`, 500);
    return rows ?? [];
  });

/**
 * Invites the longest-waiting `count` people.
 *
 * Stamping `invited_at` is what lets those addresses past a full cap, so this
 * is a privilege grant and is audited as one. The mail is sent after the stamp
 * lands: an invitation somebody was told about but cannot use is worse than one
 * they can use but were not told about, and the console shows both states.
 */
export const inviteFromWaitlist = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator(z.object({ count: z.number().int().min(1).max(200) }))
  .handler(async ({ context, data }): Promise<{ invited: number }> => {
    const { db } = context.actor;

    const { data: pending, error } = await db
      .from("waitlist")
      .select("id, email, name")
      .is("invited_at", null)
      .is("signed_up_at", null)
      .order("created_at", { ascending: true })
      .limit(data.count);
    if (error) throw new AdminAuthError(`Reading waitlist: ${error.message}`, 500);
    if (!pending || pending.length === 0) return { invited: 0 };

    const now = new Date().toISOString();
    const { error: stampError } = await db
      .from("waitlist")
      .update({ invited_at: now })
      .in(
        "id",
        pending.map((p) => p.id),
      );
    if (stampError) throw new AdminAuthError(`Inviting: ${stampError.message}`, 500);

    await audit(
      context.actor,
      "access.invite",
      { type: "waitlist", id: "batch" },
      {
        count: pending.length,
        emails: pending.map((p) => p.email),
      },
    );

    // One failed send must not roll back the rest of the batch, or leave the
    // operator unsure which of two hundred people were invited.
    for (const person of pending) {
      await sendWaitlistInvited({ email: person.email, name: person.name });
    }

    return { invited: pending.length };
  });

export const removeFromWaitlist = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { db } = context.actor;
    const { data: row } = await db.from("waitlist").select("email").eq("id", data.id).maybeSingle();

    const { error } = await db.from("waitlist").delete().eq("id", data.id);
    if (error) throw new AdminAuthError(`Removing: ${error.message}`, 500);

    await audit(
      context.actor,
      "access.remove",
      { type: "waitlist", id: data.id },
      {
        email: row?.email ?? null,
      },
    );
    return { ok: true };
  });
