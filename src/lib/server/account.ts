import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { parseInput } from "./validate";
import { cancelStripeSubscription } from "./stripe/api";
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

/** A portable copy of the account data nyuz stores for the signed-in reader. */
export const exportAccountData = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }) => {
    const { actor } = context;
    const [
      profile,
      subscription,
      preferences,
      topics,
      exclusions,
      sourcePrefs,
      feedback,
      saved,
      matches,
      digests,
      questions,
      aiUsage,
      customSources,
      telegram,
      push,
    ] = await Promise.all([
      actor.db.from("profiles").select("*").eq("id", actor.id).maybeSingle(),
      actor.db
        .from("subscriptions")
        .select("plan, status, current_period_end, cancel_at_period_end")
        .eq("user_id", actor.id)
        .maybeSingle(),
      actor.db.from("notification_preferences").select("*").eq("user_id", actor.id).maybeSingle(),
      actor.db
        .from("user_topics")
        .select(
          "created_at, importance, frequency, keywords, exclude_keywords, weight, muted, topics ( label )",
        )
        .eq("user_id", actor.id),
      actor.db.from("user_exclusions").select("term").eq("user_id", actor.id),
      actor.db
        .from("user_source_prefs")
        .select("source_id, pref, sources ( name, homepage )")
        .eq("user_id", actor.id),
      actor.db.from("feedback").select("event_id, vote, created_at").eq("user_id", actor.id),
      actor.db.from("saved_stories").select("event_id, saved_at").eq("user_id", actor.id),
      actor.db
        .from("user_events")
        .select("event_id, relevance, matched_at")
        .eq("user_id", actor.id),
      actor.db
        .from("digests")
        .select("digest_id, scheduled_for, generated_at, status, item_count")
        .eq("user_id", actor.id)
        .order("scheduled_for", { ascending: false }),
      actor.db
        .from("ask_log")
        .select("event_id, created_at")
        .eq("user_id", actor.id)
        .order("created_at", { ascending: false }),
      actor.db
        .from("ai_usage_ledger")
        .select(
          "capability, model, prompt_tokens, cached_prompt_tokens, completion_tokens, cost_microusd, reserved_tokens, created_at",
        )
        .eq("user_id", actor.id)
        .order("created_at", { ascending: false }),
      actor.db
        .from("user_custom_sources")
        .select("active, created_at, updated_at, sources ( name, homepage, feed_url )")
        .eq("user_id", actor.id),
      actor.db
        .from("telegram_accounts")
        .select("chat_id, linked_at")
        .eq("user_id", actor.id)
        .maybeSingle(),
      actor.db.from("push_subscriptions").select("endpoint, created_at").eq("user_id", actor.id),
    ]);

    const failed = [
      profile,
      subscription,
      preferences,
      topics,
      exclusions,
      sourcePrefs,
      feedback,
      saved,
      matches,
      digests,
      questions,
      aiUsage,
      customSources,
      telegram,
      push,
    ].find((result) => result.error);
    if (failed?.error) throw new Error(`exporting account data: ${failed.error.message}`);

    const digestIds = (digests.data ?? []).map((digest) => digest.digest_id);
    const [items, deliveries] = digestIds.length
      ? await Promise.all([
          actor.db
            .from("digest_items")
            .select("digest_id, event_id, position, why_it_matters")
            .in("digest_id", digestIds),
          actor.db
            .from("deliveries")
            .select("digest_id, channel, status, attempts, delivered_at, created_at")
            .in("digest_id", digestIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (items.error) throw new Error(`exporting briefing items: ${items.error.message}`);
    if (deliveries.error) throw new Error(`exporting deliveries: ${deliveries.error.message}`);

    return {
      exportedAt: new Date().toISOString(),
      account: { id: actor.id, email: actor.email, profile: profile.data },
      subscription: subscription.data,
      preferences: preferences.data,
      topics: topics.data ?? [],
      exclusions: exclusions.data ?? [],
      sourcePreferences: sourcePrefs.data ?? [],
      feedback: feedback.data ?? [],
      savedStories: saved.data ?? [],
      matchedStories: matches.data ?? [],
      questions: questions.data ?? [],
      aiUsage: aiUsage.data ?? [],
      customSources: customSources.data ?? [],
      telegram: telegram.data,
      pushSubscriptions: push.data ?? [],
      briefings: digests.data ?? [],
      briefingItems: items.data ?? [],
      deliveries: deliveries.data ?? [],
    };
  });

/**
 * Deletes the reader's own account, billing first.
 *
 * ---------------------------------------------------------------------------
 * Why the order is the whole design
 * ---------------------------------------------------------------------------
 *
 * `profiles.id` references `auth.users` with `on delete cascade`, and every
 * user-owned table cascades from `profiles`. That is what makes deletion a
 * single call — and it is also the trap: the `subscriptions` row holds the only
 * copy of `stripe_subscription_id`, so deleting the authentication user first
 * destroys the identifier needed to stop the billing. The reader would be gone
 * from the product and still charged every month, with nothing left to link the
 * charge back to them.
 *
 * So Stripe is cancelled first and the deletion is abandoned if that fails.
 * A reader who is still billed but still has an account can try again or write
 * in; a reader who is billed with no account cannot be helped without a manual
 * reconciliation against Stripe. This mirrors docs/account-deletion-runbook.md
 * step for step, which is what operators have been doing by hand.
 *
 * Cancellation is immediate rather than at period end, because "cancel at
 * period end" leaves a live subscription against a customer who no longer
 * exists here.
 *
 * ---------------------------------------------------------------------------
 * Confirmation
 * ---------------------------------------------------------------------------
 *
 * The caller must send back the account's own email address. This is not
 * security — the request is already behind `signedInOnly`, and anyone holding
 * the token could read the address from the profile. It is there so that an
 * irreversible action cannot happen on one stray click, which is the failure
 * mode this actually has.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ confirmEmail: z.string().trim().min(1).max(320) }), input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ ok: true } | { ok: false; reason: "mismatch" | "billing"; detail: string }> => {
      const { actor } = context;

      if (data.confirmEmail.toLowerCase() !== actor.email.toLowerCase()) {
        return {
          ok: false,
          reason: "mismatch",
          detail: "That does not match the email address on this account.",
        };
      }

      const { data: subscription } = await actor.db
        .from("subscriptions")
        .select("stripe_subscription_id, status")
        .eq("user_id", actor.id)
        .maybeSingle();

      const subscriptionId = subscription?.stripe_subscription_id;
      if (subscriptionId) {
        const cancelled = await cancelStripeSubscription(subscriptionId);
        // `resource_missing` means Stripe has no such subscription — already
        // cancelled, or cancelled from the portal. Nothing left to stop, so
        // this is not a reason to refuse the deletion.
        const alreadyGone =
          !cancelled.ok && /resource_missing|No such subscription/i.test(cancelled.error);
        if (!cancelled.ok && !alreadyGone) {
          console.error(`Deletion halted for ${actor.id}: ${cancelled.error}`);
          return {
            ok: false,
            reason: "billing",
            detail:
              "Your subscription could not be cancelled, so nothing was deleted. Try again shortly, or cancel from the billing page first.",
          };
        }
      }

      // Cascades through profiles to every user-owned table. Accounting rows in
      // billing_ledger deliberately survive with user_id set to null.
      const { error } = await actor.db.auth.admin.deleteUser(actor.id);
      if (error) {
        // Billing is already stopped at this point, so the worst case is a Free
        // account that outlives its owner's intent — recoverable by retrying.
        console.error(`Deleting ${actor.id} failed after cancelling billing: ${error.message}`);
        return {
          ok: false,
          reason: "billing",
          detail:
            "Your subscription was cancelled but the account could not be removed. Try again in a moment.",
        };
      }

      return { ok: true };
    },
  );
