import { describe, expect, it } from "vitest";
import {
  budgetThresholds,
  requestTokens,
  requestTokenCeiling,
  checkRequestBudget,
  operationThinking,
} from "./request-policy";

describe("complete request accounting", () => {
  it("keeps degradation opt-in and validates configured warning thresholds", () => {
    expect(budgetThresholds({})).toEqual({ warning: 0.8, degradation: 1 });
    expect(
      budgetThresholds({ AI_BUDGET_WARNING_FRACTION: "0.7", AI_BUDGET_DEGRADE_FRACTION: "0.9" }),
    ).toEqual({ warning: 0.7, degradation: 0.9 });
    expect(() => budgetThresholds({ AI_BUDGET_DEGRADE_FRACTION: "0.5" })).toThrow();
  });
  it("counts system instructions and multilingual text", () => {
    expect(requestTokens("schema ".repeat(100), "事件")).toBeGreaterThan(requestTokens("", "事件"));
    expect(requestTokens("", "日本語")).toBeGreaterThanOrEqual(9 + 32);
    expect(requestTokenCeiling("schema", "日本語")).toBeGreaterThan(
      requestTokens("schema", "日本語"),
    );
  });
  it("refuses an oversized system prompt even with tiny evidence", () => {
    expect(() => checkRequestBudget("cluster", "schema".repeat(3000), "yes")).toThrow();
  });
  it("requires a documented exception and still enforces the hard ceiling", () => {
    const prompt = "a".repeat(6500);
    expect(() => checkRequestBudget("cluster", prompt, "")).toThrow();
    expect(checkRequestBudget("cluster", prompt, "", "large candidate titles")).toBeGreaterThan(
      2048,
    );
    expect(() =>
      checkRequestBudget("cluster", prompt.repeat(3), "", "large candidate titles"),
    ).toThrow();
  });
  it("keeps unbenchmarked modes enabled and controls each operation independently", () => {
    expect(operationThinking("analyse", {})).toBe("enabled");
    expect(operationThinking("translate", { AI_THINKING_TRANSLATE: "disabled" })).toBe("disabled");
    expect(operationThinking("analyse", { AI_THINKING_TRANSLATE: "disabled" })).toBe("enabled");
    expect(() => operationThinking("cluster", { AI_THINKING_CLUSTER: "false" })).toThrow();
  });
});
