import type { PlanTier } from "@/lib/supabase/types";

/**
 * Which Stripe prices belong to nyuz, and what plan each one grants.
 *
 * This is the filter that keeps a shared Stripe account safe. Webhook events are
 * account-wide: an endpoint registered for nyuz receives every subscription
 * event on the account, including the other product's. Without a positive match
 * against these ids, a LaunchReady customer paying for a credit pack would be
 * handed a nyuz Pro plan.
 *
 * The ids live in the environment rather than in this file because test-mode and
 * live-mode prices are different objects with different ids. Hard-coding the
 * sandbox ids would mean the first live payment silently matched nothing.
 */

export type PriceEnv = {
  STRIPE_PRICE_PERSONAL_MONTHLY?: string;
  STRIPE_PRICE_PERSONAL_ANNUAL?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_ANNUAL?: string;
};

export type Interval = "month" | "year";

export type ResolvedPrice = {
  plan: Extract<PlanTier, "personal" | "pro">;
  interval: Interval;
  /** For the receipt email — "$7 / month". */
  label: string;
};

const CATALOGUE: {
  key: keyof PriceEnv;
  plan: ResolvedPrice["plan"];
  interval: Interval;
}[] = [
  { key: "STRIPE_PRICE_PERSONAL_MONTHLY", plan: "personal", interval: "month" },
  { key: "STRIPE_PRICE_PERSONAL_ANNUAL", plan: "personal", interval: "year" },
  { key: "STRIPE_PRICE_PRO_MONTHLY", plan: "pro", interval: "month" },
  { key: "STRIPE_PRICE_PRO_ANNUAL", plan: "pro", interval: "year" },
];

function read(env: PriceEnv | undefined, key: keyof PriceEnv): string | undefined {
  const proc = globalThis.process?.env;
  const value = env?.[key] ?? proc?.[key];
  return value?.trim() || undefined;
}

/**
 * The plan a Stripe price grants, or `null` when the price is not ours.
 *
 * `null` is a normal answer, not an error. It is what the other product's prices
 * return, and the caller's correct response is to acknowledge the webhook and do
 * nothing — never to fail it, which would make Stripe retry an event that will
 * never apply.
 */
export function resolvePrice(
  priceId: string | null | undefined,
  amountCents: number | null | undefined,
  env?: PriceEnv,
): ResolvedPrice | null {
  if (!priceId) return null;

  for (const entry of CATALOGUE) {
    if (read(env, entry.key) === priceId) {
      return {
        plan: entry.plan,
        interval: entry.interval,
        label: formatPriceLabel(amountCents, entry.interval),
      };
    }
  }
  return null;
}

/**
 * "$7 / month", from whatever Stripe actually charged.
 *
 * Taken from the invoice rather than from `plans.ts` on purpose: the receipt has
 * to state the amount that left the customer's account. If the two ever disagree
 * — a grandfathered price, a coupon, a price edited in the dashboard and not in
 * the code — the charge is the truth and the code is the thing that is wrong.
 */
export function formatPriceLabel(
  amountCents: number | null | undefined,
  interval: Interval,
): string {
  if (amountCents == null || !Number.isFinite(amountCents)) return `— / ${interval}`;
  const dollars = amountCents / 100;
  const amount = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${amount} / ${interval}`;
}

/**
 * The price id to charge for a plan and billing interval.
 *
 * The inverse of `resolvePrice`: that one answers "what did Stripe just charge
 * for", this one answers "what should we ask Stripe to charge". Both read the
 * same table, so a price that checkout can start is always a price the webhook
 * will recognise coming back.
 */
export function priceIdFor(
  plan: ResolvedPrice["plan"],
  interval: Interval,
  env?: PriceEnv,
): string | null {
  const entry = CATALOGUE.find((c) => c.plan === plan && c.interval === interval);
  return entry ? (read(env, entry.key) ?? null) : null;
}

/** True when at least one price id is configured — used to warn on boot. */
export function priceCatalogueConfigured(env?: PriceEnv): boolean {
  return CATALOGUE.some((entry) => read(env, entry.key) !== undefined);
}
