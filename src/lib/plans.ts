import type { PlanTier } from "@/lib/supabase/types";

/**
 * Monthly price per plan, in whole US dollars.
 *
 * The marketing copy on /pricing is written by hand and is the thing customers
 * read; this table is what revenue arithmetic uses. They are separate on
 * purpose — a price change has to be made in both places, and having to touch
 * the page is a useful forcing function. The admin console can override these
 * without a deploy via the `billing.prices` site setting.
 */
export const DEFAULT_PLAN_PRICES: Record<PlanTier, number> = {
  free: 0,
  personal: 7,
  pro: 15,
};

export const PLAN_TIERS: PlanTier[] = ["free", "personal", "pro"];

/**
 * What each plan actually allows.
 *
 * One table, because these numbers decide two different things in two different
 * places: what the billing page advertises, and what the topics page lets a
 * reader do. They were only ever written down on the billing page, which is why
 * somebody could pick eight topics on the Free plan and not discover until they
 * opened billing that five of them were inert.
 *
 * `Infinity` rather than a large number or null: it compares correctly against a
 * count without any caller special-casing "unlimited", and it formats to
 * something obviously wrong if one ever forgets to.
 */
export const PLAN_LIMITS: Record<PlanTier, { topics: number; retention: string }> = {
  free: { topics: 3, retention: "7-day history" },
  personal: { topics: 15, retention: "90-day history" },
  pro: { topics: Infinity, retention: "1-year history" },
};

/** "3" or "unlimited" — never the literal Infinity. */
export function formatTopicLimit(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : "unlimited";
}

/** The next plan up, or null at the top. What an upgrade prompt offers. */
export function nextPlanUp(plan: PlanTier): PlanTier | null {
  const index = PLAN_TIERS.indexOf(plan);
  return index >= 0 && index < PLAN_TIERS.length - 1 ? (PLAN_TIERS[index + 1] ?? null) : null;
}

export const PLAN_NAMES: Record<PlanTier, string> = {
  free: "Free",
  personal: "Personal",
  pro: "Pro",
};

/**
 * Reads a stored override, ignoring anything malformed rather than throwing.
 * A bad row here would take down the whole overview page, and a wrong MRR
 * figure is less damaging than no page at all — but it is still wrong, so the
 * caller is told whether an override was applied.
 */
export function resolvePlanPrices(stored: unknown): {
  prices: Record<PlanTier, number>;
  overridden: boolean;
} {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return { prices: DEFAULT_PLAN_PRICES, overridden: false };
  }

  const record = stored as Record<string, unknown>;
  const prices = { ...DEFAULT_PLAN_PRICES };
  let overridden = false;

  for (const tier of PLAN_TIERS) {
    const value = record[tier];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      prices[tier] = value;
      overridden = true;
    }
  }

  return { prices, overridden };
}
