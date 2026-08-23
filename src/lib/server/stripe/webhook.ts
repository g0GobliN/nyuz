import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, type ServerEnv } from "@/lib/supabase/admin";
import type { Database, PlanTier } from "@/lib/supabase/types";
import type { EmailEnv } from "@/lib/server/email/send";
import {
  sendPaymentFailed,
  sendSubscriptionCancelled,
  sendSubscriptionStarted,
} from "@/lib/server/email/lifecycle";
import { type PriceEnv, resolvePrice } from "./prices";
import { type StripeEvent, verifyStripeSignature } from "./signature";

/**
 * The Stripe webhook endpoint.
 *
 * Mounted from src/server.ts rather than as a route, because it needs the raw
 * request body — the signature is computed over the exact bytes Stripe sent, and
 * anything that parses and re-serialises the JSON invalidates it. src/server.ts
 * is also where the Cloudflare `env` arrives, which is where the secrets are.
 *
 * Four rules this handler follows, in order of how expensive they are to get
 * wrong:
 *
 *   1. Verify before reading. An unverified body is an attacker naming which of
 *      your users just upgraded.
 *   2. Match the price against the nyuz catalogue. Events are account-wide, so
 *      the other product's subscriptions arrive here too.
 *   3. Record the event id before acting. Stripe retries for days and does not
 *      promise exactly-once.
 *   4. Answer 200 for anything that will never succeed. A 500 makes Stripe
 *      retry, and enough retries disable the endpoint.
 */

export type WebhookEnv = ServerEnv &
  EmailEnv &
  PriceEnv & {
    STRIPE_WEBHOOK_SECRET?: string;
  };

type Db = SupabaseClient<Database>;

function readSecret(env?: WebhookEnv): string {
  const proc = globalThis.process?.env;
  return env?.STRIPE_WEBHOOK_SECRET ?? proc?.["STRIPE_WEBHOOK_SECRET"] ?? "";
}

/** Stripe sends seconds; JavaScript wants milliseconds. */
function toDate(seconds: unknown): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Claims the event id, returning false when it has been seen before.
 *
 * The insert IS the lock. Checking for existence and then inserting leaves a
 * window in which two concurrent deliveries of the same event both find nothing
 * and both proceed — which is exactly what a retry storm looks like.
 */
async function claimEvent(db: Db, event: StripeEvent): Promise<"claimed" | "duplicate" | "error"> {
  const { error } = await db.from("stripe_events").insert({ event_id: event.id, type: event.type });

  if (!error) return "claimed";
  // 23505 is unique_violation: another delivery of this event got here first.
  if (error.code === "23505") return "duplicate";

  // Anything else is the database being unavailable, which is the one case
  // where a Stripe retry is genuinely useful.
  console.error("Could not claim Stripe event:", error);
  return "error";
}

/** The nyuz user behind a Stripe customer, or null when we have never seen it. */
async function userForCustomer(db: Db, customerId: string): Promise<string | null> {
  const { data } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function currentPlan(db: Db, userId: string): Promise<PlanTier> {
  const { data } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan ?? "free";
}

/**
 * The first line item's price on a subscription or invoice payload.
 *
 * nyuz sells one thing at a time, so a multi-line subscription is either the
 * other product's or a mistake; taking the first line and letting the catalogue
 * reject it is the right amount of trust.
 */
function firstLinePrice(object: Record<string, unknown>): {
  priceId: string | null;
  amount: number | null;
} {
  const items = (object["items"] ?? object["lines"]) as { data?: unknown[] } | undefined;
  const first = items?.data?.[0] as Record<string, unknown> | undefined;
  const price = (first?.["price"] ?? object["price"]) as Record<string, unknown> | undefined;

  return {
    priceId: str(price?.["id"]),
    amount:
      typeof price?.["unit_amount"] === "number"
        ? (price["unit_amount"] as number)
        : typeof object["amount_paid"] === "number"
          ? (object["amount_paid"] as number)
          : typeof object["amount_due"] === "number"
            ? (object["amount_due"] as number)
            : null,
  };
}

/* ---------------------------------------------------------------------- */
/* Handlers                                                                */
/* ---------------------------------------------------------------------- */

/**
 * First payment. This is the only event that can link a Stripe customer to a
 * nyuz user, and it does so from `client_reference_id` — the user id the
 * checkout session was created with. Nothing else in the payload identifies the
 * account.
 */
async function onCheckoutCompleted(db: Db, object: Record<string, unknown>): Promise<void> {
  const userId = str(object["client_reference_id"]);
  const customerId = str(object["customer"]);
  const subscriptionId = str(object["subscription"]);

  if (!userId || !customerId) {
    console.error("checkout.session.completed without client_reference_id or customer");
    return;
  }

  await db
    .from("subscriptions")
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // The plan itself is set by customer.subscription.created/updated, which
  // carries the price and the period end. This event carries neither reliably,
  // and guessing here would race the event that actually knows.
}

async function onSubscriptionChanged(
  db: Db,
  object: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const { priceId, amount } = firstLinePrice(object);
  const resolved = resolvePrice(priceId, amount, env);
  // Not one of ours — the other product on this account. Acknowledge and ignore.
  if (!resolved) return;

  const userId = await userForCustomer(db, customerId);
  if (!userId) {
    console.error(`No nyuz user for Stripe customer ${customerId}`);
    return;
  }

  const periodEnd = toDate(object["current_period_end"]);
  const status = str(object["status"]) ?? "active";
  const cancelling = object["cancel_at_period_end"] === true;
  const previous = await currentPlan(db, userId);

  await db
    .from("subscriptions")
    .update({
      plan: resolved.plan,
      status,
      current_period_end: periodEnd?.toISOString() ?? null,
      stripe_subscription_id: str(object["id"]),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (cancelling && periodEnd) {
    await sendSubscriptionCancelled(
      db,
      userId,
      { plan: resolved.plan, accessUntil: periodEnd },
      env,
    );
    return;
  }

  // Only on the way up. A renewal is not news, and Stripe sends its own receipt.
  if (previous !== resolved.plan && periodEnd) {
    await sendSubscriptionStarted(
      db,
      userId,
      { plan: resolved.plan, priceLabel: resolved.label, renewsOn: periodEnd },
      env,
    );
  }
}

/** The subscription is over. Drop to free rather than closing the account. */
async function onSubscriptionDeleted(db: Db, object: Record<string, unknown>): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const userId = await userForCustomer(db, customerId);
  if (!userId) return;

  await db
    .from("subscriptions")
    .update({
      plan: "free",
      status: "canceled",
      current_period_end: null,
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

async function onPaymentFailed(
  db: Db,
  object: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const { priceId, amount } = firstLinePrice(object);
  const resolved = resolvePrice(priceId, amount, env);
  if (!resolved) return;

  const userId = await userForCustomer(db, customerId);
  if (!userId) return;

  // Stripe schedules its own retry and tells us when. Falling back to "in three
  // days" rather than omitting the date: a decline email that cannot say what
  // happens next is the one that generates a support message.
  const retryOn =
    toDate(object["next_payment_attempt"]) ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  await db
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  await sendPaymentFailed(db, userId, { plan: resolved.plan, retryOn }, env);
}

/* ---------------------------------------------------------------------- */
/* Entry point                                                             */
/* ---------------------------------------------------------------------- */

export async function handleStripeWebhook(request: Request, env?: WebhookEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read as text, never as JSON. The signature is over these exact bytes.
  const payload = await request.text();

  const verified = await verifyStripeSignature({
    payload,
    header: request.headers.get("stripe-signature"),
    secret: readSecret(env),
  });

  if (!verified.ok) {
    // 400, not 500: a body that does not verify will never verify, so there is
    // nothing for Stripe to usefully retry.
    console.error(`Stripe webhook rejected: ${verified.reason}`);
    return new Response(verified.reason, { status: 400 });
  }

  const { event } = verified;

  let db: Db;
  try {
    db = createAdminClient(env);
  } catch (error) {
    // Genuinely our fault and genuinely transient once fixed — this is the one
    // case worth a retry.
    console.error(error);
    return new Response("Server not configured", { status: 500 });
  }

  const claim = await claimEvent(db, event);
  if (claim === "error") {
    return new Response("Could not record event", { status: 500 });
  }
  if (claim === "duplicate") {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const object = event.data?.object ?? {};

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(db, object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await onSubscriptionChanged(db, object, env);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(db, object);
        break;
      case "invoice.payment_failed":
        await onPaymentFailed(db, object, env);
        break;
      default:
        // Every other event on the account, including the other product's.
        break;
    }
  } catch (error) {
    console.error(`Stripe ${event.type} (${event.id}) failed:`, error);
    // Still 200. The event id is already claimed, so a retry would be dropped as
    // a duplicate anyway — reporting failure would only invite retries that
    // cannot run, and eventually disable the endpoint.
    return new Response(JSON.stringify({ received: true, handled: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
