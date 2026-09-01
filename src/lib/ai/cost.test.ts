import { describe, expect, it } from "vitest";
import { aiCostMicrousd, isDeepSeekPeak } from "./cost";

describe("DeepSeek cost snapshots", () => {
  it("recognises only the documented weekday UTC peak windows", () => {
    expect(isDeepSeekPeak(new Date("2026-08-31T02:00:00Z"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-08-31T05:00:00Z"))).toBe(false);
    expect(isDeepSeekPeak(new Date("2026-08-31T08:00:00Z"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-08-30T08:00:00Z"))).toBe(false);
  });

  it("prices measured cached, uncached and output tokens at peak", () => {
    expect(
      aiCostMicrousd({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        promptTokens: 1_000_000,
        cachedPromptTokens: 250_000,
        completionTokens: 1_000_000,
        at: new Date("2026-08-31T02:00:00Z"),
      }),
    ).toBe(4_961_000);
  });

  it("applies the documented half-price off-peak rate", () => {
    expect(
      aiCostMicrousd({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        promptTokens: 0,
        cachedPromptTokens: 0,
        completionTokens: 1_000_000,
        at: new Date("2026-08-30T08:00:00Z"),
      }),
    ).toBe(660_000);
  });

  it("returns null for an unpriced provider or model", () => {
    expect(
      aiCostMicrousd({
        provider: "openrouter",
        model: "some-model",
        promptTokens: 100,
        cachedPromptTokens: 0,
        completionTokens: 100,
      }),
    ).toBeNull();
  });
});
