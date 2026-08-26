import { createServerFn } from "@tanstack/react-start";
import { signedInOnly } from "./guard";
import { sendBriefingsPaused, sendWelcomeOnce } from "./email/lifecycle";

/**
 * Actions a reader performs on their own account.
 *
 * Every one of these sends mail, which is why none of them takes a user id as an
 * argument. The id comes from `context.actor`, resolved from a verified access
 * token — an endpoint that accepted `{ userId }` from the body would be an open
 * relay for sending nyuz-branded email to any address in the database.
 *
 * They also never throw on a send failure. A reader who has just finished
 * onboarding should not be shown an error because Resend was briefly
 * unreachable; the outcome is reported in the return value and logged
 * server-side.
 */

/**
 * Sends the welcome email, at most once per account.
 *
 * Called when onboarding completes rather than at sign-up, for two reasons.
 * Sign-up happens in the browser against Supabase directly, where there is no
 * server to hold the Resend key; and an account created but never confirmed is
 * not yet a reader worth writing to. `sendWelcomeOnce` guards on
 * `profiles.welcomed_at`, so calling this twice is harmless.
 */
export const sendWelcome = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<{ status: "sent" | "already" | "failed" }> => {
    const status = await sendWelcomeOnce(context.actor.db, context.actor.id);
    return { status };
  });

/**
 * Confirms that briefings have stopped.
 *
 * The caller is expected to fire this only on the transition into paused, not on
 * every save — the message says "this is a confirmation, not a nudge", and
 * sending it twice for one decision would make that a lie.
 */
export const notifyBriefingsPaused = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<{ sent: boolean }> => {
    const sent = await sendBriefingsPaused(context.actor.db, context.actor.id);
    return { sent };
  });

/**
 * Records that this reader is looking at the product.
 *
 * Throttled to once an hour so a burst of dashboard fetches is one write, not
 * one per card. `last_seen_at` is what the dormant nudge keys off, and what the
 * privacy policy already says we store.
 */
export const pingPresence = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<void> => {
    const { data: profile } = await context.actor.db
      .from("profiles")
      .select("auto_paused_at")
      .eq("id", context.actor.id)
      .maybeSingle();
    if (profile?.auto_paused_at) {
      await Promise.all([
        context.actor.db
          .from("notification_preferences")
          .update({ paused: false, updated_at: new Date().toISOString() })
          .eq("user_id", context.actor.id),
        context.actor.db
          .from("profiles")
          .update({
            last_seen_at: new Date().toISOString(),
            auto_paused_at: null,
            paused_notified_at: null,
          })
          .eq("id", context.actor.id),
      ]);
      return;
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await context.actor.db
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", context.actor.id)
      .or(`last_seen_at.is.null,last_seen_at.lt."${hourAgo}"`);
  });
