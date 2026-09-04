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
});
