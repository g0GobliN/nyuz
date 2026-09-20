import { describe, expect, it } from "vitest";
import {
  calculateBreakEven,
  calculateContribution,
  convertUsdToJpyMinor,
  projectPeriodCost,
} from "./economics";

describe("projectPeriodCost", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-10-01T00:00:00Z");

  it("refuses to forecast less than one day of observed data", () => {
    expect(
      projectPeriodCost({
        actualMinor: 500,
        periodStart: start,
        periodEnd: end,
        now: new Date("2026-09-01T12:00:00Z"),
      }),
    ).toEqual({ amountMinor: null, status: "unavailable", basis: "insufficient-data" });
  });

  it("uses the trailing seven-day average when supplied", () => {
    expect(
      projectPeriodCost({
        actualMinor: 7_000,
        periodStart: start,
        periodEnd: end,
        now: new Date("2026-09-08T00:00:00Z"),
        trailingSevenDayMinor: 7_000,
      }),
    ).toEqual({
      amountMinor: 30_000,
      status: "projected",
      basis: "trailing-7-day-average",
    });
  });

  it("falls back to the current-period average", () => {
    expect(
      projectPeriodCost({
        actualMinor: 1_000,
        periodStart: start,
        periodEnd: end,
        now: new Date("2026-09-11T00:00:00Z"),
      }),
    ).toEqual({ amountMinor: 3_000, status: "projected", basis: "current-period-average" });
  });
});

describe("convertUsdToJpyMinor", () => {
  it("keeps an exact zero even when FX is unavailable", () => {
    expect(convertUsdToJpyMinor(0, null)).toBe(0);
  });

  it("does not convert a non-zero amount without a rate", () => {
    expect(convertUsdToJpyMinor(1, null)).toBeNull();
  });

  it("converts non-zero USD into JPY minor units", () => {
    expect(convertUsdToJpyMinor(1.25, 150)).toBe(18_750);
  });
});

describe("calculateBreakEven", () => {
  it("models users from captured fixed cost and positive plan contribution", () => {
    expect(calculateBreakEven({ fixedCostMinor: 10_000, monthlyContributionMinor: 2_500 })).toEqual(
      {
        fixedCostMinor: 10_000,
        contributionPerUserMinor: 2_500,
        usersNeeded: 4,
        status: "modeled",
      },
    );
  });

  it("does not turn unknown or non-positive contribution into a fake break-even", () => {
    expect(calculateBreakEven({ fixedCostMinor: 10_000, monthlyContributionMinor: 0 }).status).toBe(
      "unavailable",
    );
  });
});

describe("calculateContribution", () => {
  it("keeps marginal and fully-loaded contribution separate", () => {
    expect(
      calculateContribution({
        grossRevenueMinor: 10_000,
        refundsMinor: 1_000,
        stripeFeesMinor: 500,
        directVariableCostMinor: 2_000,
        allocatedSharedCostMinor: 1_500,
      }),
    ).toEqual({
      netRevenueMinor: 9_000,
      marginalContributionMinor: 6_500,
      fullyLoadedContributionMinor: 5_000,
      contributionMarginPct: (5_000 / 9_000) * 100,
    });
  });

  it("does not manufacture a margin when net revenue is zero", () => {
    expect(
      calculateContribution({
        grossRevenueMinor: 100,
        refundsMinor: 100,
        stripeFeesMinor: 0,
        directVariableCostMinor: 50,
        allocatedSharedCostMinor: 50,
      }).contributionMarginPct,
    ).toBeNull();
  });
});
