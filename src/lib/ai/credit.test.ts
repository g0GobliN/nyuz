import { describe, expect, it } from "vitest";
import { computeAiCredit, type AiCreditInput } from "@/lib/ai/credit";

/**
 * A balance display earns its place by being trustworthy when it is boring and
 * loud only when it should be. These assertions are mostly about the second
 * half: what the console must refuse to claim.
 */

const M = 1_000_000;
const NOW = new Date("2026-09-02T12:00:00Z");
const DAY = 86_400_000;

function credit(over: Partial<AiCreditInput> = {}) {
  return computeAiCredit({
    toppedUpMicrousd: 5 * M,
    topups: 1,
    firstTopupAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    lastTopupAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    lastTopupMicrousd: 5 * M,
    spentMicrousd: 1 * M,
    settledMicrousd: 1 * M,
    inFlightMicrousd: 0,
    unfundedSpentMicrousd: 0,
    calls: 12,
    unpricedCalls: 0,
    weekSpentMicrousd: 0.7 * M,
    now: NOW,
    ...over,
  });
}

describe("balance arithmetic", () => {
  it("is deposits minus spend", () => {
    const c = credit();
    expect(c.remainingUsd).toBe(4);
    expect(c.usedPct).toBeCloseTo(20);
  });

  it("counts in-flight reservations as already spent", () => {
    // The money is authorized; treating it as available is how a balance
    // overdraws between reservation and settlement.
    const c = credit({ spentMicrousd: 2 * M, settledMicrousd: 1 * M, inFlightMicrousd: 1 * M });
    expect(c.remainingUsd).toBe(3);
  });

  it("keeps spend that predates the first top-up out of the balance", () => {
    // That spend was funded by credit nobody recorded. Subtracting it would put
    // the console permanently below the provider's own figure.
    const c = credit({ unfundedSpentMicrousd: 9 * M });
    expect(c.remainingUsd).toBe(4);
    expect(c.unfundedSpentUsd).toBe(9);
  });

  it("goes negative rather than clamping when spend overruns deposits", () => {
    // Clamping to zero would hide exactly the situation worth seeing.
    expect(credit({ spentMicrousd: 7 * M }).remainingUsd).toBe(-2);
  });
});

describe("burn rate", () => {
  it("is a week of spend spread over a week", () => {
    expect(credit({ weekSpentMicrousd: 7 * M }).burnUsdPerDay).toBeCloseTo(1);
  });

  it("divides by the life of the balance when it is younger than a week", () => {
    const c = credit({
      firstTopupAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      weekSpentMicrousd: 2 * M,
    });
    expect(c.burnUsdPerDay).toBeCloseTo(1);
  });

  it("is withheld under an hour of history", () => {
    const c = credit({
      firstTopupAt: new Date(NOW.getTime() - 60_000).toISOString(),
      weekSpentMicrousd: 3 * M,
    });
    expect(c.burnUsdPerDay).toBeNull();
    expect(c.daysRemaining).toBeNull();
    expect(c.runsOutAt).toBeNull();
  });

  it("is withheld when there is no top-up to measure from", () => {
    expect(credit({ topups: 0, firstTopupAt: null, toppedUpMicrousd: 0 }).burnUsdPerDay).toBeNull();
  });

  it("gives no runway when nothing is being spent", () => {
    // Not "infinite days": a rate of zero cannot forecast a date at all.
    const c = credit({ weekSpentMicrousd: 0 });
    expect(c.burnUsdPerDay).toBe(0);
    expect(c.daysRemaining).toBeNull();
    expect(c.runsOutAt).toBeNull();
  });

  it("projects the recharge date from the balance and the rate", () => {
    const c = credit({ spentMicrousd: 1 * M, weekSpentMicrousd: 7 * M });
    expect(c.daysRemaining).toBeCloseTo(4);
    expect(c.runsOutAt).toBe(new Date(NOW.getTime() + 4 * DAY).toISOString());
  });
});

describe("status", () => {
  it("is unrecorded, not exhausted, before any top-up is entered", () => {
    // Both are a zero balance. Only one of them is an emergency.
    const c = credit({ topups: 0, toppedUpMicrousd: 0, spentMicrousd: 0, firstTopupAt: null });
    expect(c.status).toBe("unrecorded");
  });

  it("is ok with most of the credit left and weeks of runway", () => {
    expect(credit({ weekSpentMicrousd: 0.35 * M }).status).toBe("ok");
  });

  it("is low under a fifth of everything deposited", () => {
    expect(credit({ spentMicrousd: 4.5 * M, weekSpentMicrousd: 0 }).status).toBe("low");
  });

  it("is low when the recharge is due within a week, however much is left", () => {
    // A comfortable-looking $4 is not comfortable at $2/day.
    const c = credit({ spentMicrousd: 1 * M, weekSpentMicrousd: 14 * M });
    expect(c.remainingUsd).toBe(4);
    expect(c.status).toBe("low");
  });

  it("is exhausted at exactly zero, not only below it", () => {
    expect(credit({ spentMicrousd: 5 * M }).status).toBe("exhausted");
  });
});
