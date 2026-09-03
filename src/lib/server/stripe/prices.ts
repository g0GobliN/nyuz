import { envValue } from "@/lib/runtime-env";
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
  /**
   * Prices an existing subscriber is still billed against after a repricing.
   * Unset until one happens. See the `legacy` note on CATALOGUE.
   */
  STRIPE_PRICE_PERSONAL_MONTHLY_LEGACY?: string;
  STRIPE_PRICE_PERSONAL_ANNUAL_LEGACY?: string;
  STRIPE_PRICE_PRO_MONTHLY_LEGACY?: string;
  STRIPE_PRICE_PRO_ANNUAL_LEGACY?: string;
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
  /**
   * A price that still grants its plan but is no longer offered at checkout
   * (plan2 §61). Repricing means creating new Stripe prices, not editing old
   * ones — an existing subscription keeps billing against the price object it
   * was created with, and that object must keep resolving to a plan or every
   * existing subscriber silently loses their entitlements at the next webhook.
   *
   * So: add the new price ids, mark the old ones legacy, and nobody is
   * repriced or cut off. `priceIdFor` refuses to sell a legacy price;
   * `resolvePrice` keeps honouring one.
   */
  legacy?: true;
}[] = [
  { key: "STRIPE_PRICE_PERSONAL_MONTHLY", plan: "personal", interval: "month" },
  { key: "STRIPE_PRICE_PERSONAL_ANNUAL", plan: "personal", interval: "year" },
  { key: "STRIPE_PRICE_PRO_MONTHLY", plan: "pro", interval: "month" },
  { key: "STRIPE_PRICE_PRO_ANNUAL", plan: "pro", interval: "year" },
  // Populated when a repricing actually happens. Empty today, and the
  // machinery is here so that the day it happens is a configuration change
  // and a one-line addition rather than a redesign under time pressure.
  {
    key: "STRIPE_PRICE_PERSONAL_MONTHLY_LEGACY",
    plan: "personal",
    interval: "month",
    legacy: true,
  },
  { key: "STRIPE_PRICE_PERSONAL_ANNUAL_LEGACY", plan: "personal", interval: "year", legacy: true },
  { key: "STRIPE_PRICE_PRO_MONTHLY_LEGACY", plan: "pro", interval: "month", legacy: true },
  { key: "STRIPE_PRICE_PRO_ANNUAL_LEGACY", plan: "pro", interval: "year", legacy: true },
];

function read(env: PriceEnv | undefined, key: keyof PriceEnv): string | undefined {
  return envValue(key, env)?.trim() || undefined;
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
 *
 * **Legacy prices are excluded here and honoured there**, and the asymmetry is
 * the whole grandfathering mechanism (plan2 §61): an existing subscriber keeps
 * their old price forever, and nobody new can be sold it.
 */
export function priceIdFor(
  plan: ResolvedPrice["plan"],
  interval: Interval,
  env?: PriceEnv,
): string | null {
  const entry = CATALOGUE.find((c) => c.plan === plan && c.interval === interval && !c.legacy);
  return entry ? (read(env, entry.key) ?? null) : null;
}

/**
 * True when at least one price a customer could actually buy is configured.
 *
 * Legacy prices do not count: a catalogue containing only grandfathered ids
 * cannot start a checkout, and reporting it as configured would turn a
 * misconfiguration into a silent one.
 */
export function priceCatalogueConfigured(env?: PriceEnv): boolean {
  return CATALOGUE.some((entry) => !entry.legacy && read(env, entry.key) !== undefined);
}
