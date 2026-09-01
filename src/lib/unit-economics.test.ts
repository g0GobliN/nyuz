import { describe, expect, it } from "vitest";
import { computeUnitEconomics, COST_PROVIDERS } from "./unit-economics";

const costs = COST_PROVIDERS.map((provider) => ({
  provider,
  monthly_cents: provider === "domain" ? 100 : 0,
  updated_at: "2026-08-01T00:00:00.000Z",
}));

describe("computeUnitEconomics", () => {
  it("prorates annual revenue and allocates shared costs per paying customer", () => {
    const result = computeUnitEconomics({
      days: 30,
      now: new Date("2026-08-31T00:00:00.000Z"),
      billing: [
        {
          user_id: "personal-user",
          plan: "personal",
          currency: "usd",
          gross_cents: 14990,
          refunded_cents: 0,
          stripe_fee_amount: 465,
          stripe_fee_currency: "usd",
          period_start: "2026-08-01T00:00:00.000Z",
          period_end: "2027-08-01T00:00:00.000Z",
          livemode: true,
        },
        {
          user_id: "pro-user",
          plan: "pro",
          currency: "usd",
          gross_cents: 2999,
          refunded_cents: 0,
          stripe_fee_amount: 117,
          stripe_fee_currency: "usd",
          period_start: "2026-08-01T00:00:00.000Z",
          period_end: "2026-09-01T00:00:00.000Z",
          livemode: true,
        },
      ],
      allTimeBilling: [
        { user_id: "personal-user", livemode: true },
        { user_id: "pro-user", livemode: true },
      ],
      ai: [
        { user_id: "personal-user", plan: "personal", cost_microusd: 1_000_000 },
        { user_id: null, plan: null, cost_microusd: 2_000_000 },
      ],
      operatingCosts: costs,
    });

    expect(result.complete).toBe(true);
    expect(result.plans.personal.recognizedRevenueUsd).toBeCloseTo(149.9 * (30 / 365));
    expect(result.plans.personal.sharedAiUsd).toBe(1);
    expect(result.plans.pro.sharedAiUsd).toBe(1);
    expect(result.plans.personal.p95DirectAiUsd).toBe(1);
    expect(result.nextMilestone).toBe(10);
  });

  it("withholds margin when any required cost is unknown", () => {
    const result = computeUnitEconomics({
      days: 30,
      now: new Date("2026-08-31T00:00:00.000Z"),
      billing: [],
      allTimeBilling: [],
      ai: [{ user_id: null, plan: null, cost_microusd: null }],
      operatingCosts: [],
    });

    expect(result.complete).toBe(false);
    expect(result.incompleteReasons.join(" ")).toContain("AI calls");
    expect(result.incompleteReasons.join(" ")).toContain("cloudflare");
    expect(result.plans.personal.marginPct).toBeNull();
  });
});
