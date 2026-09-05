import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import {
  changeStripeSubscriptionPrice,
  createCheckoutSession,
  createPortalSession,
  retrieveStripePrice,
  retrieveStripeSubscription,
  stripePriceMatches,
} from "./stripe/api";
import { canChangePaidSubscription } from "./stripe/entitlements";
import { priceIdFor } from "./stripe/prices";
import { siteUrl } from "./email/send";
import { DEFAULT_ANNUAL_PRICES, DEFAULT_PLAN_PRICES } from "@/lib/plans";

/**
 * Starting and managing a subscription.
 *
 * Both handlers take the acting user from the verified token, never from their
 * arguments. A `userId` parameter here would let anyone start a checkout that
 * upgrades somebody else's account — or, worse, open a billing portal session
 * for a customer they do not own, which shows that customer's payment history.
 *
 * Neither handler decides what anything costs. The client asks for a plan and an
 * interval; the price id comes from the server's own catalogue, and Stripe
 * charges what that price says. A client that could name a price id could name a
 * $0 one.
 */

const checkoutInput = z.object({
  plan: z.enum(["plura", "omni"]),
  interval: z.enum(["month", "year"]),
});

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };
export type PlanChangeResult = { ok: true } | { ok: false; error: string };

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => checkoutInput.parse(input))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const { actor } = context;

    const priceId = priceIdFor(data.plan, data.interval);
    if (!priceId) {
      return {
        ok: false,
        error: "That plan is not available for purchase yet.",
      };
    }

    const base = siteUrl();
    const hostname = new URL(base).hostname;
    const requireLive = hostname !== "localhost" && hostname !== "127.0.0.1";
    const expectedDollars =
      data.interval === "month" ? DEFAULT_PLAN_PRICES[data.plan] : DEFAULT_ANNUAL_PRICES[data.plan];
    const checkedPrice = await retrieveStripePrice(priceId);
    if (
      !checkedPrice.ok ||
      !stripePriceMatches(checkedPrice.data, {
        cents: Math.round(expectedDollars * 100),
        interval: data.interval,
        requireLive,
      })
    ) {
      console.error(
        `Checkout price validation failed for ${data.plan}/${data.interval}: ${checkedPrice.ok ? "catalogue mismatch" : checkedPrice.error}`,
      );
      return {
        ok: false,
        error: "That plan is not available for purchase yet.",
      };
    }

    // Reuse the Stripe customer if this reader has paid before. Letting Stripe
    // create a second one for the same person splits their billing history and
    // breaks the unique index on stripe_customer_id.
    const { data: subscription } = await actor.db
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("user_id", actor.id)
      .maybeSingle();

    if (subscription?.stripe_subscription_id) {
      return {
        ok: false,
        error: "Use Change plan for an existing subscription.",
      };
    }

    const { data: checkoutClaim, error: claimError } = await actor.db.rpc(
      "claim_subscription_checkout",
      { p_user_id: actor.id },
    );
    if (claimError || checkoutClaim !== "ok") {
      return {
        ok: false,
        error:
          checkoutClaim === "pending"
            ? "A checkout is already open. Try again in a few minutes."
            : "Could not reserve checkout. Try again in a moment.",
      };
    }

    const session = await createCheckoutSession({
      priceId,
      userId: actor.id,
      email: actor.email,
      customerId: subscription?.stripe_customer_id ?? null,
      // The plan is applied by the webhook, not by this redirect — a reader who
      // closes the tab before it loads still gets what they paid for.
      successUrl: `${base}/dashboard/billing?checkout=success`,
      cancelUrl: `${base}/dashboard/billing?checkout=cancelled`,
    });

    if (!session.ok) {
      await actor.db.rpc("release_subscription_checkout", { p_user_id: actor.id });
      console.error(`Checkout failed for ${actor.id}: ${session.error}`);
      return { ok: false, error: "Could not start checkout. Try again in a moment." };
    }

    return { ok: true, url: session.data.url };
  });

/** Changes the price on the one existing Nyuz subscription; never opens Checkout. */
export const changePlan = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => checkoutInput.parse(input))
  .handler(async ({ data, context }): Promise<PlanChangeResult> => {
    const { actor } = context;
    const priceId = priceIdFor(data.plan, data.interval);
    if (!priceId) return { ok: false, error: "That plan is not available yet." };

    const base = siteUrl();
    const hostname = new URL(base).hostname;
    const expectedDollars =
      data.interval === "month" ? DEFAULT_PLAN_PRICES[data.plan] : DEFAULT_ANNUAL_PRICES[data.plan];
    const checkedPrice = await retrieveStripePrice(priceId);
    if (
      !checkedPrice.ok ||
      !stripePriceMatches(checkedPrice.data, {
        cents: Math.round(expectedDollars * 100),
        interval: data.interval,
        requireLive: hostname !== "localhost" && hostname !== "127.0.0.1",
      })
    ) {
      return { ok: false, error: "That plan is not available yet." };
    }

    const { data: row, error } = await actor.db
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (error || !row?.stripe_customer_id || !row.stripe_subscription_id) {
      return { ok: false, error: "No existing paid subscription was found." };
    }
    if (!canChangePaidSubscription(row.status)) {
      return {
        ok: false,
        error: "Resolve the current payment state in Stripe before changing plan.",
      };
    }

    const current = await retrieveStripeSubscription(row.stripe_subscription_id);
    if (
      !current.ok ||
      current.data.id !== row.stripe_subscription_id ||
      current.data.customer !== row.stripe_customer_id ||
      !canChangePaidSubscription(current.data.status)
    ) {
      return { ok: false, error: "Could not verify the current Stripe subscription." };
    }

    const items = current.data.items.data;
    if (items.length !== 1 || !items[0]) {
      return { ok: false, error: "The Stripe subscription has an unexpected item layout." };
    }
    if (items[0].price?.id === priceId) return { ok: true };

    const changed = await changeStripeSubscriptionPrice({
      subscriptionId: current.data.id,
      itemId: items[0].id,
      priceId,
      userId: actor.id,
    });
    if (!changed.ok) {
      console.error(`Plan change failed for ${actor.id}: ${changed.error}`);
      return { ok: false, error: "Could not change plan. Try again in a moment." };
    }
    return { ok: true };
  });

/**
 * Sends the reader to Stripe's portal to cancel, resume or change a card.
 *
 * Refuses rather than improvising when there is no customer id: somebody who has
 * never paid has nothing to manage, and creating a customer here just to open a
 * portal would leave an empty record behind for every curious click.
 */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<CheckoutResult> => {
    const { actor } = context;

    const { data: subscription } = await actor.db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", actor.id)
      .maybeSingle();

    const customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      return { ok: false, error: "There is no payment history on this account yet." };
    }

    const session = await createPortalSession({
      customerId,
      returnUrl: `${siteUrl()}/dashboard/billing`,
    });

    if (!session.ok) {
      console.error(`Portal failed for ${actor.id}: ${session.error}`);
      return { ok: false, error: "Could not open the billing portal. Try again in a moment." };
    }

    return { ok: true, url: session.data.url };
  });
