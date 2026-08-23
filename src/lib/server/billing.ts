import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { createCheckoutSession, createPortalSession } from "./stripe/api";
import { priceIdFor } from "./stripe/prices";
import { siteUrl } from "./email/send";

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
  plan: z.enum(["personal", "pro"]),
  interval: z.enum(["month", "year"]),
});

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

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

    // Reuse the Stripe customer if this reader has paid before. Letting Stripe
    // create a second one for the same person splits their billing history and
    // breaks the unique index on stripe_customer_id.
    const { data: subscription } = await actor.db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", actor.id)
      .maybeSingle();

    const base = siteUrl();

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
      console.error(`Checkout failed for ${actor.id}: ${session.error}`);
      return { ok: false, error: "Could not start checkout. Try again in a moment." };
    }

    return { ok: true, url: session.data.url };
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
