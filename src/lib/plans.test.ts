import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_PRICES, resolvePlanPrices } from "@/lib/plans";

/**
 * These figures multiply into the MRR estimate on the console overview. A
 * silent fallback that looks like a real override is the failure worth
 * preventing here, which is why `resolvePlanPrices` reports whether the stored
 * value was actually used.
 */
describe("resolvePlanPrices", () => {
  it("uses the bundled prices when nothing is stored", () => {
    const { prices, overridden } = resolvePlanPrices(null);
    expect(prices).toEqual(DEFAULT_PLAN_PRICES);
    expect(overridden).toBe(false);
  });

  it("applies a stored override and says so", () => {
    const { prices, overridden } = resolvePlanPrices({ personal: 9, pro: 19 });
    expect(prices.personal).toBe(9);
    expect(prices.pro).toBe(19);
    expect(overridden).toBe(true);
  });

  it("keeps the default for any tier the override omits", () => {
    const { prices } = resolvePlanPrices({ personal: 9 });
    expect(prices.pro).toBe(DEFAULT_PLAN_PRICES.pro);
  });

  it("ignores non-numeric and negative values rather than trusting them", () => {
    const { prices } = resolvePlanPrices({ personal: "free", pro: -5 });
    expect(prices.personal).toBe(DEFAULT_PLAN_PRICES.personal);
    expect(prices.pro).toBe(DEFAULT_PLAN_PRICES.pro);
  });

  it("survives a stored value of the wrong shape entirely", () => {
    for (const bad of [[], "nine dollars", 42, true]) {
      const { prices, overridden } = resolvePlanPrices(bad);
      expect(prices).toEqual(DEFAULT_PLAN_PRICES);
      expect(overridden).toBe(false);
    }
  });

  it("does not mutate the shared default table", () => {
    resolvePlanPrices({ personal: 99 });
    expect(DEFAULT_PLAN_PRICES.personal).toBe(7);
  });
});
