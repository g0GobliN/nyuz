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
  creditBurnUsdPerDay: 0.1,
  creditDaysRemaining: 31.2,
  creditStatus: "ok",
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

  it("treats exhausted recorded credit as advisory while safety caps remain", () => {
    const status = deriveAiStatus({ ...healthy, creditRemainingUsd: 0, creditStatus: "exhausted" });
    expect(status).toMatchObject({
      status: "warning",
      blocker: { kind: "none" },
      credit: { status: "exhausted" },
    });
  });

  it("does not report unrecorded credit as exhausted", () => {
    expect(
      deriveAiStatus({ ...healthy, creditRemainingUsd: 0, creditStatus: "unrecorded" }).status,
    ).toBe("healthy");
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
        creditRemainingUsd: 0,
        creditStatus: "exhausted",
      }),
    ).toMatchObject({ status: "blocked", blocker: { kind: "kill_switch" } });
  });

  it("prioritizes token then dollar global blocks over model and credit advisories", () => {
    const limits = {
      ...healthy,
      spentUsd: 25,
      tokensUsed: 20_000_000,
      daySpentPro: 5,
      creditRemainingUsd: 0,
      creditStatus: "exhausted" as const,
    };
    expect(deriveAiStatus(limits).blocker.kind).toBe("monthly_tokens");
    expect(deriveAiStatus({ ...limits, tokensUsed: 0 }).blocker.kind).toBe("monthly_usd");
    expect(deriveAiStatus({ ...limits, tokensUsed: 0, spentUsd: 6 }).blocker.kind).toBe(
      "daily_cap",
    );
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
