import { describe, expect, it } from "vitest";
import {
  AiBudgetExceededError,
  aiCapacityRetryAt,
  completionUsageFromError,
  isDefinitelyUnbilledAiError,
} from "./config";
import { CompletionUsageError, TruncatedCompletionError } from "./deepseek";

describe("temporary AI capacity", () => {
  const now = new Date("2026-09-19T12:00:00Z");

  it("defers a monthly ceiling until the next budget period", () => {
    expect(aiCapacityRetryAt(new AiBudgetExceededError(), now)?.toISOString()).toBe(
      "2026-10-01T00:05:00.000Z",
    );
  });

  it("backs off provider capacity responses without treating real failures as capacity", () => {
    expect(aiCapacityRetryAt({ status: 429 }, now)?.toISOString()).toBe("2026-09-19T12:15:00.000Z");
    expect(aiCapacityRetryAt({ status: 503 }, now)?.toISOString()).toBe("2026-09-19T12:15:00.000Z");
    expect(aiCapacityRetryAt(new TypeError("fetch failed"), now)?.toISOString()).toBe(
      "2026-09-19T12:15:00.000Z",
    );
    expect(aiCapacityRetryAt(new Error("bad JSON"), now)).toBeNull();
  });

  it("releases only errors known to have been refused before generation", () => {
    expect(isDefinitelyUnbilledAiError({ status: 429 })).toBe(true);
    expect(isDefinitelyUnbilledAiError(new Error("Missing DEEPSEEK_API_KEY"))).toBe(true);
    expect(isDefinitelyUnbilledAiError(new Error("network response was lost"))).toBe(false);
  });

  it("settles measured usage on failed completions instead of leaking the reservation", () => {
    const usage = {
      content: "bad json",
      model: "deepseek-v4-pro",
      promptTokens: 100,
      completionTokens: 200,
      reasoningTokens: 150,
      cachedTokens: 20,
      attempt_count: 1,
    };
    expect(completionUsageFromError(new CompletionUsageError("bad json", usage))).toBe(usage);
    expect(
      completionUsageFromError(
        new TruncatedCompletionError("deepseek-v4-pro", 180, 200, 100, 200, 20),
      ),
    ).toMatchObject({ promptTokens: 100, completionTokens: 200, cachedTokens: 20 });
  });

  it("records reasoning tokens correctly when truncation occurs above the old 2048 ceiling", () => {
    // Simulates the reported failure: 2048 reasoning tokens of 2048 maxTokens
    // With the new 4096 ceiling, this would succeed, but the error path must
    // still correctly capture and report the reasoning token count.
    const error = new TruncatedCompletionError(
      "deepseek-v4-pro",
      2048, // reasoning tokens consumed
      2048, // old maxTokens ceiling
      1700, // prompt tokens
      2048, // completion tokens (all reasoning)
      100, // cached tokens
    );

    const usage = completionUsageFromError(error);
    expect(usage).not.toBeNull();
    expect(usage?.reasoningTokens).toBe(2048);
    expect(usage?.completionTokens).toBe(2048);
    expect(usage?.promptTokens).toBe(1700);
    expect(usage?.cachedTokens).toBe(100);
    expect(usage?.model).toBe("deepseek-v4-pro");
  });

  it("records reasoning tokens correctly when truncation would occur at 3072 ceiling", () => {
    // Tests the intermediate ceiling (old ANALYSE_MAX_TOKENS = 3072)
    // A complex event could consume >3072 reasoning tokens
    const error = new TruncatedCompletionError(
      "deepseek-v4-pro",
      3200, // reasoning tokens consumed (exceeds old 3072 ceiling)
      3072, // old maxTokens ceiling
      2100, // prompt tokens
      3200, // completion tokens
      50, // cached tokens
    );

    const usage = completionUsageFromError(error);
    expect(usage).not.toBeNull();
    expect(usage?.reasoningTokens).toBe(3200);
    expect(usage?.completionTokens).toBe(3200);
    expect(usage?.promptTokens).toBe(2100);
  });

  it("does not treat TruncatedCompletionError as definitely unbilled", () => {
    // A truncated call DID spend tokens (the reasoning tokens), so it must
    // NOT be treated as unbilled. The reservation must be settled with the
    // actual usage, not released.
    const error = new TruncatedCompletionError("deepseek-v4-pro", 2048, 2048, 1700, 2048, 100);
    expect(isDefinitelyUnbilledAiError(error)).toBe(false);
  });
});
