import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNUAL_PRICES,
  DEFAULT_PLAN_PRICES,
  formatUsd,
  resolvePlanPrices,
} from "@/lib/plans";

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
    const { prices, overridden } = resolvePlanPrices({ plura: 9, omni: 19 });
    expect(prices.plura).toBe(9);
    expect(prices.omni).toBe(19);
    expect(overridden).toBe(true);
  });

  it("keeps the default for any tier the override omits", () => {
    const { prices } = resolvePlanPrices({ plura: 9 });
    expect(prices.omni).toBe(DEFAULT_PLAN_PRICES.omni);
  });

  it("ignores non-numeric and negative values rather than trusting them", () => {
    const { prices } = resolvePlanPrices({ plura: "uno", omni: -5 });
    expect(prices.plura).toBe(DEFAULT_PLAN_PRICES.plura);
    expect(prices.omni).toBe(DEFAULT_PLAN_PRICES.omni);
  });

  it("survives a stored value of the wrong shape entirely", () => {
    for (const bad of [[], "nine dollars", 42, true]) {
      const { prices, overridden } = resolvePlanPrices(bad);
      expect(prices).toEqual(DEFAULT_PLAN_PRICES);
      expect(overridden).toBe(false);
    }
  });

  it("does not mutate the shared default table", () => {
    resolvePlanPrices({ plura: 99 });
    expect(DEFAULT_PLAN_PRICES.plura).toBe(14.99);
  });
});

describe("DEFAULT_PLAN_PRICES", () => {
  it("matches the Stripe catalogue", () => {
    expect(DEFAULT_PLAN_PRICES.plura).toBe(14.99);
    expect(DEFAULT_PLAN_PRICES.omni).toBe(29.99);
  });
});

describe("DEFAULT_ANNUAL_PRICES", () => {
  it("matches the Stripe catalogue", () => {
    expect(DEFAULT_ANNUAL_PRICES.plura).toBe(149.9);
    expect(DEFAULT_ANNUAL_PRICES.omni).toBe(299.9);
  });
});

describe("formatUsd", () => {
  it("uses the two-decimal form Stripe shows", () => {
    expect(formatUsd(7)).toBe("$7.00");
    expect(formatUsd(149.9)).toBe("$149.90");
  });
});
