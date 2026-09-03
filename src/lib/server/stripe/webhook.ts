import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, type ServerEnv } from "@/lib/supabase/admin";
import { envValue } from "@/lib/runtime-env";
import type { Database, PlanTier } from "@/lib/supabase/types";
import type { EmailEnv } from "@/lib/server/email/send";
import { recordOps } from "@/lib/server/ops";
import {
  sendPaymentFailed,
  sendSubscriptionCancelled,
  sendSubscriptionStarted,
} from "@/lib/server/email/lifecycle";
import {
  retrieveStripeBalanceTransaction,
  retrieveStripeCharge,
  retrieveStripeInvoice,
  retrieveStripePaymentIntent,
  type StripeApiEnv,
} from "./api";
import { type PriceEnv, resolvePrice } from "./prices";
import { type StripeEvent, verifyStripeSignature } from "./signature";
import {
  canEnterPaymentGrace,
  entitlementPlan,
  normalizeSubscriptionStatus,
  shouldApplySubscriptionEvent,
} from "./entitlements";

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
 *   3. Record the event id before acting. Stripe retries and does not promise
 *      exactly-once. Release that claim if processing fails so a retry can run.
 *   4. Answer 500 for transient processing failures and 200 only when the event
 *      was handled or deliberately ignored.
 */

export type WebhookEnv = ServerEnv &
  EmailEnv &
  StripeApiEnv &
  PriceEnv & {
    STRIPE_WEBHOOK_SECRET?: string;
  };

type Db = SupabaseClient<Database>;

function readSecret(env?: WebhookEnv): string {
  return envValue("STRIPE_WEBHOOK_SECRET", env) ?? "";
}

/**
 * Whether an event was produced by the same Stripe mode this deployment runs in.
 *
 * Stripe's default is a separate endpoint per mode, so in a correct setup these
 * always agree. They stop agreeing the moment someone points the test-mode
 * endpoint at production while debugging — and then a test-mode
 * `customer.subscription.created`, which anyone with the test dashboard can
 * create for free, grants a real reader a paid plan. The signature check does
 * not catch it: the event is genuinely from Stripe and genuinely signed.
 *
 * The secret key is the authority on which mode we are, because it is what
 * every outbound call authenticates with. An event whose mode disagrees with it
 * is describing objects on the other account, and acting on it would write
 * entitlements from one ledger into the other.
 *
 * Undefined `livemode` means the payload predates this field or is a test
 * fixture; those are allowed through so the existing suite and any hand-rolled
 * replay keep working.
 */
export function modeMatches(event: StripeEvent, env?: WebhookEnv): boolean {
  if (event.livemode === undefined) return true;
  const key = envValue("STRIPE_SECRET_KEY", env) ?? "";
  if (!key) return true;
  return event.livemode === key.startsWith("sk_live_");
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
async function claimEvent(
  db: Db,
  event: StripeEvent,
): Promise<"claimed" | "duplicate" | "in-progress" | "error"> {
  const now = new Date();
  const { error } = await db.from("stripe_events").insert({
    event_id: event.id,
    type: event.type,
    processing_started_at: now.toISOString(),
  });

  if (!error) return "claimed";
  if (error.code !== "23505") {
    console.error("Could not claim Stripe event:", error);
    return "error";
  }

  const { data: existing, error: readError } = await db
    .from("stripe_events")
    .select("processed_at")
    .eq("event_id", event.id)
    .maybeSingle();
  if (readError || !existing) {
    console.error("Could not inspect Stripe event claim:", readError);
    return "error";
  }
  if (existing.processed_at) return "duplicate";

  const stale = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const { data: reclaimed, error: reclaimError } = await db
    .from("stripe_events")
    .update({ processing_started_at: now.toISOString() })
    .eq("event_id", event.id)
    .is("processed_at", null)
    .or(`processing_started_at.is.null,processing_started_at.lt."${stale}"`)
    .select("event_id");
  if (reclaimError) {
    console.error("Could not reclaim Stripe event:", reclaimError);
    return "error";
  }
  return reclaimed && reclaimed.length > 0 ? "claimed" : "in-progress";
}

async function releaseEvent(db: Db, eventId: string): Promise<void> {
  const { error } = await db
    .from("stripe_events")
    .update({ processing_started_at: null })
    .eq("event_id", eventId)
    .is("processed_at", null);
  if (error) console.error(`Could not release Stripe event ${eventId}:`, error);
}

async function completeEvent(db: Db, eventId: string): Promise<void> {
  const { data, error } = await db
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString(), processing_started_at: null })
    .eq("event_id", eventId)
    .is("processed_at", null)
    .select("event_id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Completing Stripe event: ${error?.message ?? "claim not found"}`);
  }
}

/** The nyuz user behind a Stripe customer, or null when we have never seen it. */
async function userForCustomer(db: Db, customerId: string): Promise<string | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`Looking up Stripe customer: ${error.message}`);
  return data?.user_id ?? null;
}

type SubscriptionState = {
  plan: PlanTier;
  status: string;
  stripe_subscription_id: string | null;
  retired_stripe_subscription_id: string | null;
  stripe_event_created_at: string | null;
};

async function currentSubscription(db: Db, userId: string): Promise<SubscriptionState> {
  const { data, error } = await db
    .from("subscriptions")
    .select(
      "plan, status, stripe_subscription_id, retired_stripe_subscription_id, stripe_event_created_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Reading current plan: ${error.message}`);
  return (
    data ?? {
      plan: "free",
      status: "active",
      stripe_subscription_id: null,
      retired_stripe_subscription_id: null,
      stripe_event_created_at: null,
    }
  );
}

function metadataUserId(object: Record<string, unknown>): string | null {
  const metadata = object["metadata"] as Record<string, unknown> | undefined;
  const userId = str(metadata?.["user_id"]);
  return userId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    ? userId
    : null;
}

function invoiceMetadataUserId(invoice: Record<string, unknown>): string | null {
  const direct = metadataUserId(invoice);
  if (direct) return direct;

  const subscription = invoice["subscription_details"] as Record<string, unknown> | undefined;
  const fromSubscription = subscription ? metadataUserId(subscription) : null;
  if (fromSubscription) return fromSubscription;

  const parent = invoice["parent"] as Record<string, unknown> | undefined;
  const parentSubscription = parent?.["subscription_details"] as
    Record<string, unknown> | undefined;
  return parentSubscription ? metadataUserId(parentSubscription) : null;
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
  const pricing = first?.["pricing"] as Record<string, unknown> | undefined;
  const priceDetails = pricing?.["price_details"] as Record<string, unknown> | undefined;
  const price = (first?.["price"] ?? object["price"]) as Record<string, unknown> | undefined;
  const currentPrice = priceDetails?.["price"];
  const unitAmountDecimal = priceDetails?.["unit_amount_decimal"];

  return {
    priceId:
      str(price?.["id"]) ??
      idFromExpandable(first?.["price"] ?? object["price"]) ??
      idFromExpandable(currentPrice),
    amount:
      typeof price?.["unit_amount"] === "number"
        ? (price["unit_amount"] as number)
        : typeof unitAmountDecimal === "string" && Number.isFinite(Number(unitAmountDecimal))
          ? Number(unitAmountDecimal)
          : typeof object["amount_paid"] === "number"
            ? (object["amount_paid"] as number)
            : typeof object["amount_due"] === "number"
              ? (object["amount_due"] as number)
              : null,
  };
}

function firstLinePeriod(object: Record<string, unknown>): { start: Date; end: Date } | null {
  const lines = object["lines"] as { data?: unknown[] } | undefined;
  const first = lines?.data?.[0] as Record<string, unknown> | undefined;
  const period = first?.["period"] as Record<string, unknown> | undefined;
  const start = toDate(period?.["start"] ?? object["period_start"]);
  const end = toDate(period?.["end"] ?? object["period_end"]);
  return start && end && end > start ? { start, end } : null;
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
async function onCheckoutCompleted(
  db: Db,
  object: Record<string, unknown>,
  eventCreatedAt: Date,
): Promise<void> {
  const userId = str(object["client_reference_id"]);
  const customerId = str(object["customer"]);
  const subscriptionId = str(object["subscription"]);

  if (!userId || !customerId) {
    console.error("checkout.session.completed without client_reference_id or customer");
    return;
  }

  const existing = await currentSubscription(db, userId);
  if (
    !subscriptionId ||
    !shouldApplySubscriptionEvent({
      storedSubscriptionId: existing.stripe_subscription_id,
      retiredSubscriptionId: existing.retired_stripe_subscription_id,
      incomingSubscriptionId: subscriptionId,
      storedEventCreatedAt: existing.stripe_event_created_at,
      incomingEventCreatedAt: eventCreatedAt,
    })
  )
    return;

  const { data, error } = await db
    .from("subscriptions")
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_event_created_at: eventCreatedAt.toISOString(),
      checkout_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Linking checkout to account: ${error?.message ?? "account not found"}`);
  }

  // The plan itself is set by customer.subscription.created/updated, which
  // carries the price and the period end. This event carries neither reliably,
  // and guessing here would race the event that actually knows.
}

async function onSubscriptionChanged(
  db: Db,
  object: Record<string, unknown>,
  eventCreatedAt: Date,
  env?: WebhookEnv,
): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const { priceId, amount } = firstLinePrice(object);
  const resolved = resolvePrice(priceId, amount, env);
  // Not one of ours — the other product on this account. Acknowledge and ignore.
  if (!resolved) return;

  let userId = await userForCustomer(db, customerId);
  if (!userId) {
    userId = metadataUserId(object);
    if (userId) {
      const { data: linked, error } = await db
        .from("subscriptions")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle();
      if (error || !linked) {
        throw new Error(
          `Linking subscription to account: ${error?.message ?? "account not found"}`,
        );
      }
    }
  }
  if (!userId) {
    throw new Error(`No nyuz user for Stripe customer ${customerId}`);
  }

  const subscriptionId = str(object["id"]);
  const periodEnd = toDate(object["current_period_end"]);
  const status = normalizeSubscriptionStatus(str(object["status"]));
  const cancelling = object["cancel_at_period_end"] === true;
  const previous = await currentSubscription(db, userId);
  if (
    !shouldApplySubscriptionEvent({
      storedSubscriptionId: previous.stripe_subscription_id,
      retiredSubscriptionId: previous.retired_stripe_subscription_id,
      incomingSubscriptionId: subscriptionId,
      storedEventCreatedAt: previous.stripe_event_created_at,
      incomingEventCreatedAt: eventCreatedAt,
    })
  ) {
    return;
  }
  const effectivePlan = entitlementPlan(resolved.plan, status);

  const { error } = await db
    .from("subscriptions")
    .update({
      plan: effectivePlan,
      status,
      current_period_end: periodEnd?.toISOString() ?? null,
      stripe_subscription_id: subscriptionId,
      cancel_at_period_end: cancelling,
      stripe_event_created_at: eventCreatedAt.toISOString(),
      checkout_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`Applying subscription change: ${error.message}`);

  if (cancelling && periodEnd && effectivePlan !== "free") {
    await sendSubscriptionCancelled(
      db,
      userId,
      { plan: resolved.plan, accessUntil: periodEnd },
      env,
    );
    return;
  }

  // Only on the way up. A renewal is not news, and Stripe sends its own receipt.
  if (effectivePlan !== "free" && previous.plan !== effectivePlan && periodEnd) {
    await sendSubscriptionStarted(
      db,
      userId,
      { plan: resolved.plan, priceLabel: resolved.label, renewsOn: periodEnd },
      env,
    );
  }
}

/** The subscription is over. Drop to free rather than closing the account. */
async function onSubscriptionDeleted(
  db: Db,
  object: Record<string, unknown>,
  eventCreatedAt: Date,
): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const userId = await userForCustomer(db, customerId);
  if (!userId) return;

  const subscriptionId = str(object["id"]);
  const current = await currentSubscription(db, userId);
  if (
    !shouldApplySubscriptionEvent({
      storedSubscriptionId: current.stripe_subscription_id,
      retiredSubscriptionId: current.retired_stripe_subscription_id,
      incomingSubscriptionId: subscriptionId,
      storedEventCreatedAt: current.stripe_event_created_at,
      incomingEventCreatedAt: eventCreatedAt,
    })
  ) {
    return;
  }

  const { error } = await db
    .from("subscriptions")
    .update({
      plan: "free",
      status: "canceled",
      current_period_end: null,
      stripe_subscription_id: null,
      retired_stripe_subscription_id: subscriptionId,
      cancel_at_period_end: false,
      stripe_event_created_at: eventCreatedAt.toISOString(),
      checkout_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`Applying subscription cancellation: ${error.message}`);
}

async function onPaymentFailed(
  db: Db,
  object: Record<string, unknown>,
  eventCreatedAt: Date,
  env?: WebhookEnv,
): Promise<void> {
  const customerId = str(object["customer"]);
  if (!customerId) return;

  const { priceId, amount } = firstLinePrice(object);
  const resolved = resolvePrice(priceId, amount, env);
  if (!resolved) return;

  const userId = await userForCustomer(db, customerId);
  if (!userId) return;
  const current = await currentSubscription(db, userId);
  if (!canEnterPaymentGrace(current.status)) return;
  const invoiceSubscriptionId = idFromExpandable(object["subscription"]);
  if (
    invoiceSubscriptionId &&
    !shouldApplySubscriptionEvent({
      storedSubscriptionId: current.stripe_subscription_id,
      retiredSubscriptionId: current.retired_stripe_subscription_id,
      incomingSubscriptionId: invoiceSubscriptionId,
      storedEventCreatedAt: current.stripe_event_created_at,
      incomingEventCreatedAt: eventCreatedAt,
    })
  ) {
    return;
  }

  // Stripe schedules its own retry and tells us when. Falling back to "in three
  // days" rather than omitting the date: a decline email that cannot say what
  // happens next is the one that generates a support message.
  const retryOn =
    toDate(object["next_payment_attempt"]) ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const { error } = await db
    .from("subscriptions")
    .update({
      status: "past_due",
      stripe_event_created_at: eventCreatedAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`Applying payment failure: ${error.message}`);

  await sendPaymentFailed(db, userId, { plan: resolved.plan, retryOn }, env);
}

function idFromExpandable(value: unknown): string | null {
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? str((value as Record<string, unknown>)["id"]) : null;
}

async function chargeIdForInvoice(
  invoice: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<string | null> {
  const direct = idFromExpandable(invoice["charge"]);
  if (direct) return direct;

  const payments = invoice["payments"] as { data?: unknown[] } | undefined;
  const paid = payments?.data?.find(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      ((entry as Record<string, unknown>)["status"] === "paid" ||
        (entry as Record<string, unknown>)["status"] === "succeeded"),
  ) as Record<string, unknown> | undefined;
  const payment = paid?.["payment"] as Record<string, unknown> | undefined;
  const paymentIntentId =
    idFromExpandable(payment?.["payment_intent"]) ??
    idFromExpandable(paid?.["payment_intent"]) ??
    idFromExpandable(invoice["payment_intent"]);
  if (!paymentIntentId) return null;

  const result = await retrieveStripePaymentIntent(paymentIntentId, env);
  if (!result.ok) throw new Error(`Reading Stripe payment intent: ${result.error}`);
  return idFromExpandable(result.data["latest_charge"]);
}

/** Records real Stripe cash, refunds and the charge's balance fee. */
async function recordCharge(
  db: Db,
  object: Record<string, unknown>,
  invoice: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const chargeId = str(object["id"]);
  const invoiceId = str(invoice["id"]);
  const customerId = str(object["customer"]);
  const balanceTransactionId = str(object["balance_transaction"]);
  if (!chargeId || !invoiceId) return;
  const { priceId, amount } = firstLinePrice(invoice);
  const resolved = resolvePrice(priceId, amount, env);
  if (!resolved || !priceId) return;

  if (!customerId) throw new Error(`Nyuz charge ${chargeId} has no customer`);
  let userId = await userForCustomer(db, customerId);
  if (!userId) {
    userId = invoiceMetadataUserId(invoice);
    if (userId) {
      const { error } = await db
        .from("subscriptions")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) throw new Error(`Linking charge to account: ${error.message}`);
    }
  }
  if (!userId) throw new Error(`No nyuz user for Stripe charge ${chargeId}`);
  if (!balanceTransactionId) {
    throw new Error(`Nyuz charge ${chargeId} has no balance transaction yet`);
  }

  const balanceResult = await retrieveStripeBalanceTransaction(balanceTransactionId, env);
  if (!balanceResult.ok) {
    throw new Error(`Reading Stripe balance transaction: ${balanceResult.error}`);
  }

  const paidAt = toDate(object["created"]);
  const period = firstLinePeriod(invoice);
  const currency = str(object["currency"]);
  const gross = object["amount"];
  const refunded = object["amount_refunded"];
  if (
    !paidAt ||
    !period ||
    !currency ||
    typeof gross !== "number" ||
    typeof refunded !== "number"
  ) {
    throw new Error(`Nyuz charge ${chargeId} is missing accounting fields`);
  }

  const { error } = await db.from("billing_ledger").upsert({
    charge_id: chargeId,
    invoice_id: invoiceId,
    user_id: userId,
    plan: resolved.plan,
    interval: resolved.interval,
    price_id: priceId,
    currency,
    gross_cents: Math.max(0, Math.trunc(gross)),
    refunded_cents: Math.max(0, Math.trunc(refunded)),
    stripe_fee_amount: Math.max(0, Math.trunc(balanceResult.data.fee)),
    stripe_fee_currency: balanceResult.data.currency,
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
    paid_at: paidAt.toISOString(),
    livemode: object["livemode"] === true,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Recording Stripe unit economics: ${error.message}`);
}

async function onInvoicePaid(
  db: Db,
  invoice: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const { priceId, amount } = firstLinePrice(invoice);
  if (!resolvePrice(priceId, amount, env)) return;
  if (invoice["amount_paid"] === 0) return;

  const chargeId = await chargeIdForInvoice(invoice, env);
  if (!chargeId)
    throw new Error(`Paid nyuz invoice ${str(invoice["id"]) ?? "unknown"} has no charge`);
  const result = await retrieveStripeCharge(chargeId, env);
  if (!result.ok) throw new Error(`Reading Stripe charge: ${result.error}`);
  await recordCharge(db, result.data, invoice, env);
}

async function onChargeSucceeded(
  db: Db,
  charge: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const invoiceId = idFromExpandable(charge["invoice"]);
  if (!invoiceId) return;
  const result = await retrieveStripeInvoice(invoiceId, env);
  if (!result.ok) throw new Error(`Reading Stripe invoice: ${result.error}`);
  await recordCharge(db, charge, result.data, env);
}

async function onChargeRefunded(
  db: Db,
  charge: Record<string, unknown>,
  env?: WebhookEnv,
): Promise<void> {
  const chargeId = str(charge["id"]);
  const refunded = charge["amount_refunded"];
  if (!chargeId || typeof refunded !== "number") return;

  const { data, error } = await db
    .from("billing_ledger")
    .update({
      refunded_cents: Math.max(0, Math.trunc(refunded)),
      updated_at: new Date().toISOString(),
    })
    .eq("charge_id", chargeId)
    .select("charge_id")
    .maybeSingle();
  if (error) throw new Error(`Recording Stripe refund: ${error.message}`);
  if (!data) await onChargeSucceeded(db, charge, env);
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

  // Before the claim, so a wrong-mode event does not consume an id in
  // `stripe_events` and mask the real one if the endpoints are later corrected.
  // 200 rather than 400: the event is validly signed and there is nothing for
  // Stripe to retry — we are declining to act on it, not failing to receive it.
  if (!modeMatches(event, env)) {
    console.error(`Stripe webhook ignored: ${event.id} is from the other Stripe mode`);
    return new Response(JSON.stringify({ received: true, ignored: "livemode" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

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
    await recordOps(db, "stripe:webhook", "error", { event_id: event.id, error: "claim failed" });
    return new Response("Could not record event", { status: 500 });
  }
  if (claim === "duplicate") {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (claim === "in-progress") {
    return new Response("Event is already being processed", { status: 500 });
  }

  const object = event.data?.object ?? {};
  const eventCreatedAt = toDate(event.created) ?? new Date();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(db, object, eventCreatedAt);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await onSubscriptionChanged(db, object, eventCreatedAt, env);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(db, object, eventCreatedAt);
        break;
      case "invoice.payment_failed":
        await onPaymentFailed(db, object, eventCreatedAt, env);
        break;
      case "invoice.payment_succeeded":
        await onInvoicePaid(db, object, env);
        break;
      case "charge.succeeded":
        await onChargeSucceeded(db, object, env);
        break;
      case "charge.refunded":
        await onChargeRefunded(db, object, env);
        break;
      default:
        // Every other event on the account, including the other product's.
        break;
    }
    await completeEvent(db, event.id);
  } catch (error) {
    console.error(`Stripe ${event.type} (${event.id}) failed:`, error);
    await releaseEvent(db, event.id);
    await recordOps(db, "stripe:webhook", "error", {
      event_id: event.id,
      event_type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ received: true, handled: false }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  await recordOps(db, "stripe:webhook", "healthy", {
    event_id: event.id,
    event_type: event.type,
  });

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
