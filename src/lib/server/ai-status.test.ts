import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/guard", () => ({ adminOnly: {}, audit: vi.fn() }));

import { deriveAiStatus } from "./ai-status";

const healthy: Parameters<typeof deriveAiStatus>[0] = {
  spentUsd: 6.17,
  ceilingUsd: 25,
  tokensUsed: 4_160_000,
  tokensBudget: 20_000_000,
  inFlightUsd: 0.1,
  daySpentPro: 0.2,
  dayCapPro: 5,
  daySpentFlash: 0.1,
  dayCapFlash: 1,
  killSwitchOn: false,
  creditRemainingUsd: 3.12,
  creditToppedUpUsd: 15,
  creditBurnUsdPerDay: 0.1,
  creditDaysRemaining: 31.2,
  creditStatus: "ok",
  creditGateEnabled: false,
  ceilingSource: "database",
  tokenBudgetSource: "database",
};

describe("Cost page limit status", () => {
  it("is healthy with provider credit and room under both safety caps", () => {
    expect(deriveAiStatus(healthy)).toMatchObject({
      status: "healthy",
      blocker: { kind: "none" },
      credit: { remainingUsd: 3.12 },
    });
  });

  it("gate enabled: blocks on exhausted recorded provider credit, independent of the safety caps (0080)", () => {
    // Before 0080 this was advisory-only: the provider's own account balance
    // was the real stop. With the gate on, the app enforces it too,
    // atomically alongside the monthly/daily caps, so the console must
    // report it as an actual blocker rather than a warning nobody has to
    // act on.
    const status = deriveAiStatus({
      ...healthy,
      creditGateEnabled: true,
      creditRemainingUsd: -0.7,
      creditToppedUpUsd: 8.32,
      creditStatus: "exhausted",
    });
    expect(status).toMatchObject({
      status: "blocked",
      blocker: { kind: "credit_exhausted", remainingUsd: -0.7, toppedUpUsd: 8.32 },
    });
    expect(status.blockerLabel).toContain("Record a top-up");
    expect(status.blockerLabel).toContain("monthly safety cap is separate");
    // No settingKey: there is no ai_runtime_config key for a top-up. The
    // console falls back to its "Record top-up" anchor button for this case.
    expect(status.action).toBeNull();
  });

  it("gate disabled: exhausted credit is advisory only, never a blocker", () => {
    // Development, migration, or emergency use — no enforcement at all,
    // matching the pre-0080 shape exactly.
    const status = deriveAiStatus({
      ...healthy,
      creditGateEnabled: false,
      creditRemainingUsd: -0.7,
      creditStatus: "exhausted",
    });
    expect(status).toMatchObject({ status: "warning", blocker: { kind: "none" } });
  });

  it("gate enabled, no top-up ever recorded: blocked, not silently skipped", () => {
    // The whole point of making this an explicit flag (rather than "skip
    // when ai_credit_topups is empty"): a production deployment that turns
    // the gate on cannot spend without someone having deliberately funded it.
    const status = deriveAiStatus({
      ...healthy,
      creditGateEnabled: true,
      creditRemainingUsd: 0,
      creditToppedUpUsd: 0,
      creditStatus: "unrecorded",
    });
    expect(status).toMatchObject({ status: "blocked", blocker: { kind: "credit_exhausted" } });
    expect(status.blockerLabel).toContain("no top-up has ever been recorded");
  });

  it("gate disabled, no top-up ever recorded: healthy, not a warning", () => {
    expect(
      deriveAiStatus({
        ...healthy,
        creditGateEnabled: false,
        creditRemainingUsd: 0,
        creditStatus: "unrecorded",
      }).status,
    ).toBe("healthy");
  });

  it("exposes whether the gate is enabled regardless of what else is happening", () => {
    expect(deriveAiStatus({ ...healthy, creditGateEnabled: true }).creditGateEnabled).toBe(true);
    expect(deriveAiStatus({ ...healthy, creditGateEnabled: false }).creditGateEnabled).toBe(false);
    // Even mid-blocker (kill switch here), the gate's own on/off state must
    // still be reported — an operator debugging "why is nothing running"
    // needs every switch's position, not just the one that fired first.
    expect(
      deriveAiStatus({ ...healthy, killSwitchOn: true, creditGateEnabled: true }).creditGateEnabled,
    ).toBe(true);
  });

  it("identifies the monthly safety cap even while provider credit remains", () => {
    const status = deriveAiStatus({ ...healthy, spentUsd: 25 });
    expect(status).toMatchObject({
      status: "blocked",
      blocker: { kind: "monthly_usd" },
      action: { label: "Increase safety cap", settingKey: "ai.monthly_cost_usd" },
    });
    expect(status.blockerLabel).toContain("$25.00 / $25.00");
    expect(status.credit.remainingUsd).toBe(3.12);
  });

  it("counts in-flight spend already included in the monthly aggregate exactly once", () => {
    expect(deriveAiStatus({ ...healthy, spentUsd: 25, inFlightUsd: 5 }).blocker.kind).toBe(
      "monthly_usd",
    );
    expect(deriveAiStatus({ ...healthy, spentUsd: 24, inFlightUsd: 5 }).blocker.kind).toBe("none");
  });

  it("identifies token exhaustion and links to its control", () => {
    expect(deriveAiStatus({ ...healthy, tokensUsed: 20_000_000 })).toMatchObject({
      status: "blocked",
      blocker: { kind: "monthly_tokens" },
      action: { settingKey: "ai.monthly_token_budget" },
    });
  });

  it("prioritizes the kill switch over both caps and credit exhaustion", () => {
    expect(
      deriveAiStatus({
        ...healthy,
        killSwitchOn: true,
        spentUsd: 25,
        tokensUsed: 20_000_000,
        creditGateEnabled: true,
        creditRemainingUsd: 0,
        creditStatus: "exhausted",
      }),
    ).toMatchObject({ status: "blocked", blocker: { kind: "kill_switch" } });
  });

  it("prioritizes token then dollar global blocks over model and credit advisories", () => {
    const limits = { ...healthy, spentUsd: 25, tokensUsed: 20_000_000, daySpentPro: 5 };
    expect(deriveAiStatus(limits).blocker.kind).toBe("monthly_tokens");
    expect(deriveAiStatus({ ...limits, tokensUsed: 0 }).blocker.kind).toBe("monthly_usd");
    expect(deriveAiStatus({ ...limits, tokensUsed: 0, spentUsd: 6 }).blocker.kind).toBe(
      "daily_cap",
    );
  });

  it("a global condition (credit exhaustion) outranks a single model's daily cap", () => {
    // Exhausted provider credit stops every capability, not one model, so it
    // is checked before the per-model daily caps — same reasoning as the
    // monthly caps above it.
    const status = deriveAiStatus({
      ...healthy,
      daySpentPro: 5, // would report "daily_cap" on its own
      creditGateEnabled: true,
      creditRemainingUsd: 0,
      creditStatus: "exhausted",
    });
    expect(status.blocker.kind).toBe("credit_exhausted");
  });

  it.each(["Flash", "Pro"] as const)(
    "reports the %s daily limit as a model-specific block",
    (model) => {
      const status = deriveAiStatus({
        ...healthy,
        ...(model === "Flash" ? { daySpentFlash: 1 } : { daySpentPro: 5 }),
      });
      expect(status.status).toBe("warning");
      expect(status.blocker).toMatchObject({
        kind: "daily_cap",
        model: `deepseek-v4-${model.toLowerCase()}`,
      });
    },
  );

  it("does not infer a provider outage from open reservations", () => {
    expect(deriveAiStatus({ ...healthy, inFlightUsd: 3 })).toMatchObject({
      status: "healthy",
      blocker: { kind: "none" },
    });
  });
});
