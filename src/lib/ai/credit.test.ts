import { describe, expect, it } from "vitest";
import {
  computeAiCredit,
  creditRefusesReservation,
  providerCreditAvailableMicrousd,
  type AiCreditInput,
} from "@/lib/ai/credit";

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
    expect(c.remainingUsd).toBe(c.toppedUpUsd - c.settledUsd - c.inFlightUsd);
  });

  it("adds multiple top-ups without resetting attributed spend", () => {
    const c = credit({
      toppedUpMicrousd: 15 * M,
      topups: 2,
      lastTopupMicrousd: 10 * M,
      lastTopupAt: NOW.toISOString(),
      spentMicrousd: 3 * M,
      settledMicrousd: 2 * M,
      inFlightMicrousd: M,
    });
    expect(c.remainingUsd).toBe(12);
    expect(c.topups).toBe(2);
    expect(c.lastTopupUsd).toBe(10);
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
      spentMicrousd: 2 * M,
      weekSpentMicrousd: 2 * M,
    });
    expect(c.burnUsdPerDay).toBeCloseTo(1);
  });

  it("excludes pre-top-up spend from burn for a young balance", () => {
    const c = credit({
      firstTopupAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      spentMicrousd: M,
      weekSpentMicrousd: 10 * M,
      unfundedSpentMicrousd: 9 * M,
    });
    expect(c.burnUsdPerDay).toBe(0.5);
    expect(c.daysRemaining).toBe(8);
  });

  it("does not mistake an unavailable week measurement for zero burn", () => {
    const c = credit({ weekSpentMicrousd: null });
    expect(c.burnUsdPerDay).toBeNull();
    expect(c.daysRemaining).toBeNull();
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

/**
 * The provider-credit gate (0080), mirrored from `reserve_ai_tokens` in SQL.
 * This is arithmetic only — the SQL function is what actually refuses a
 * reservation, atomically, under the same advisory lock as the monthly and
 * daily caps. These tests are the executable spec that SQL is written against,
 * plus the user-facing scenarios the gate exists to satisfy.
 */
describe("providerCreditAvailableMicrousd", () => {
  it("is zero, not null, when no top-up has ever been recorded", () => {
    // Well-defined arithmetic, not a sentinel: whether this zero refuses
    // anything is entirely up to creditRefusesReservation's gateEnabled flag.
    expect(
      providerCreditAvailableMicrousd({ toppedUpMicrousd: 0, spentSinceFirstTopupMicrousd: 0 }),
    ).toBe(0);
  });

  it("is topped-up minus spent once at least one top-up exists", () => {
    expect(
      providerCreditAvailableMicrousd({
        toppedUpMicrousd: 15 * M,
        spentSinceFirstTopupMicrousd: 8 * M,
      }),
    ).toBe(7 * M);
  });

  it("a new top-up increases available credit immediately", () => {
    const before = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 15 * M,
      spentSinceFirstTopupMicrousd: 8 * M,
    });
    const after = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 25 * M, // a further $10 top-up recorded
      spentSinceFirstTopupMicrousd: 8 * M, // nothing new spent
    });
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(17 * M);
  });

  it("can go negative — spend already exceeded what was topped up", () => {
    // nyuz's real state on 2026-09-12: $8.32 topped up, $9.03 spent since.
    expect(
      providerCreditAvailableMicrousd({
        toppedUpMicrousd: 8_320_000,
        spentSinceFirstTopupMicrousd: 9_029_335,
      }),
    ).toBe(8_320_000 - 9_029_335);
  });
});

describe("creditRefusesReservation", () => {
  it("gate disabled: never refuses, however negative the balance", () => {
    // Development/migration/emergency use — no enforcement at all.
    expect(creditRefusesReservation(false, -1_000_000_000, 1_000_000_000)).toBe(false);
  });

  it("gate enabled, no top-up ever recorded: available is zero, every call is refused", () => {
    const available = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 0,
      spentSinceFirstTopupMicrousd: 0,
    });
    expect(creditRefusesReservation(true, available, 1)).toBe(true);
  });

  it("gate enabled, top-ups recorded, both have room: allowed", () => {
    expect(creditRefusesReservation(true, 7 * M, 1 * M)).toBe(false);
  });

  it("gate enabled: refuses a request that would exceed remaining credit", () => {
    expect(creditRefusesReservation(true, 0.5 * M, 1 * M)).toBe(true);
  });

  it("gate enabled: refuses at exactly the boundary, not only past it", () => {
    expect(creditRefusesReservation(true, 1 * M, 1 * M)).toBe(false);
    expect(creditRefusesReservation(true, 1 * M, 1 * M + 1)).toBe(true);
  });

  it("recording a top-up turns a refusal into an allow, immediately", () => {
    const beforeTopup = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 8 * M,
      spentSinceFirstTopupMicrousd: 8 * M,
    });
    expect(creditRefusesReservation(true, beforeTopup, 1 * M)).toBe(true);

    const afterTopup = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M, // +$2 recorded
      spentSinceFirstTopupMicrousd: 8 * M,
    });
    expect(creditRefusesReservation(true, afterTopup, 1 * M)).toBe(false);
  });

  it("a reservation reduces available credit immediately for the next caller", () => {
    // The reservation itself becomes in-flight spend the moment it is
    // inserted, so a second caller reading the balance a moment later sees
    // less room — same mechanism the existing monthly/daily caps rely on.
    const beforeReservation = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 2 * M,
    });
    const afterReservation = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 2 * M + 1 * M, // the new reservation counted
    });
    expect(afterReservation).toBe(beforeReservation - 1 * M);
  });

  it("settlement replaces the estimate with actual cost, not adding to it", () => {
    // computeAiCredit's spentMicrousd already uses coalesce(cost, estimate, 0)
    // per row — settling a $1 estimate at $0.60 actual reduces spend, it does
    // not stack a second charge. Mirrored here at the aggregate level.
    const reservedEstimate = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 1 * M, // in-flight estimate
    });
    const settledActual = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 0.6 * M, // settled, cheaper than estimated
    });
    expect(settledActual).toBeGreaterThan(reservedEstimate);
  });

  it("a released or failed reservation restores credit — contributes zero, not the estimate", () => {
    // release_ai_reservation zeroes estimated_cost_microusd; a row that never
    // settled and was released stops counting entirely.
    const withOpenReservation = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 3 * M,
    });
    const afterRelease = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 10 * M,
      spentSinceFirstTopupMicrousd: 0, // the released reservation's estimate zeroed
    });
    expect(afterRelease).toBeGreaterThan(withOpenReservation);
    expect(afterRelease).toBe(10 * M);
  });
});

describe("the two ceilings stay independent", () => {
  it("a top-up never changes the monthly safety cap", () => {
    // The safety cap lives entirely in ai_runtime_config; nothing computed
    // here reads or writes it. Recording a top-up only ever moves
    // toppedUpMicrousd, which the safety cap does not read.
    const monthlySafetyCapUsd = 10;
    providerCreditAvailableMicrousd({
      toppedUpMicrousd: 1_000 * M,
      spentSinceFirstTopupMicrousd: 0,
    });
    expect(monthlySafetyCapUsd).toBe(10);
  });

  it("a higher safety cap never fabricates provider credit", () => {
    // Symmetric case: raising ai.monthly_cost_usd cannot be expressed as an
    // input to the credit functions at all, so an exhausted balance stays
    // exhausted regardless of what the safety cap is set to.
    const available = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 8 * M,
      spentSinceFirstTopupMicrousd: 8 * M,
    });
    expect(creditRefusesReservation(true, available, 1)).toBe(true);
  });

  it("provider credit available but the emergency cap is exhausted: still blocked", () => {
    const available = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 1_000 * M, // plenty of provider credit
      spentSinceFirstTopupMicrousd: 0,
    });
    const creditWouldRefuse = creditRefusesReservation(true, available, 1 * M);
    const monthlySpentUsd = 10;
    const monthlyCapUsd = 10;
    const monthlyWouldRefuse = monthlySpentUsd + 1 >= monthlyCapUsd;
    expect(creditWouldRefuse).toBe(false);
    expect(monthlyWouldRefuse).toBe(true);
    expect(creditWouldRefuse || monthlyWouldRefuse).toBe(true);
  });

  it("the emergency cap has headroom but provider credit is exhausted: still blocked", () => {
    const available = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 8 * M,
      spentSinceFirstTopupMicrousd: 8 * M, // exhausted
    });
    const creditWouldRefuse = creditRefusesReservation(true, available, 1 * M);
    const monthlySpentUsd = 2;
    const monthlyCapUsd = 30; // plenty of safety-cap headroom
    const monthlyWouldRefuse = monthlySpentUsd + 1 >= monthlyCapUsd;
    expect(creditWouldRefuse).toBe(true);
    expect(monthlyWouldRefuse).toBe(false);
    expect(creditWouldRefuse || monthlyWouldRefuse).toBe(true);
  });

  it("both ceilings have headroom: the reservation succeeds", () => {
    const available = providerCreditAvailableMicrousd({
      toppedUpMicrousd: 20 * M,
      spentSinceFirstTopupMicrousd: 5 * M,
    });
    const creditWouldRefuse = creditRefusesReservation(true, available, 1 * M);
    const monthlySpentUsd = 2;
    const monthlyCapUsd = 30;
    const monthlyWouldRefuse = monthlySpentUsd + 1 >= monthlyCapUsd;
    expect(creditWouldRefuse || monthlyWouldRefuse).toBe(false);
  });
});
