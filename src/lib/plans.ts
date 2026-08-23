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
