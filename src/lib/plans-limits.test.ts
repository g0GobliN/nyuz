import { describe, expect, it } from "vitest";
import { isCoveredTopic, keepCoveredTopics } from "@/lib/coverage";
import { ASK_COOLDOWN_MS, PLAN_LIMITS, clipLabels, decideAsk } from "@/lib/plans";

describe("isCoveredTopic", () => {
  it("accepts pool labels regardless of case and spacing", () => {
    expect(isCoveredTopic("OpenAI")).toBe(true);
    expect(isCoveredTopic(" openai ")).toBe(true);
    expect(isCoveredTopic("Developer tools")).toBe(true);
  });

  it("rejects a label we do not cover", () => {
    expect(isCoveredTopic("Knitting")).toBe(false);
    expect(isCoveredTopic("Politics")).toBe(true);
    expect(isCoveredTopic("Music")).toBe(true);
  });
});

describe("keepCoveredTopics", () => {
  it("drops uncovered labels and keeps first-seen spelling", () => {
    expect(keepCoveredTopics(["Knitting", "OpenAI", "openai", "React"])).toEqual([
      "OpenAI",
      "React",
    ]);
  });
});

describe("clipLabels", () => {
  it("keeps the first N, in order", () => {
    expect(clipLabels(["a", "b", "c", "d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("does not clip an unlimited plan", () => {
    expect(clipLabels(["a", "b", "c"], Infinity)).toEqual(["a", "b", "c"]);
  });
});

describe("PLAN_LIMITS.asksPerDay", () => {
  it("gives Free no Ask calls", () => {
    expect(PLAN_LIMITS.free.asksPerDay).toBe(0);
  });

  it("gives paid plans a daily cap", () => {
    expect(PLAN_LIMITS.personal.asksPerDay).toBe(24);
    expect(PLAN_LIMITS.pro.asksPerDay).toBe(48);
  });
});

describe("decideAsk", () => {
  const now = new Date("2026-08-25T03:00:00.000Z");

  it("fails closed when the flag row is missing or off", () => {
    expect(decideAsk({ flagOn: null, plan: "pro", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(decideAsk({ flagOn: false, plan: "pro", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("refuses Free", () => {
    expect(decideAsk({ flagOn: true, plan: "free", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "plan",
    });
  });

  it("refuses once the daily cap is hit", () => {
    expect(
      decideAsk({
        flagOn: true,
        plan: "personal",
        usedToday: PLAN_LIMITS.personal.asksPerDay,
        lastAt: null,
        now,
      }),
    ).toEqual({ ok: false, reason: "quota" });
  });

  it("enforces a cooldown between calls", () => {
    const lastAt = new Date(now.getTime() - ASK_COOLDOWN_MS / 2);
    expect(decideAsk({ flagOn: true, plan: "personal", usedToday: 0, lastAt, now })).toEqual({
      ok: false,
      reason: "cooldown",
    });
  });

  it("allows a Personal call under the cap after the cooldown", () => {
    const lastAt = new Date(now.getTime() - ASK_COOLDOWN_MS - 1);
    expect(decideAsk({ flagOn: true, plan: "personal", usedToday: 0, lastAt, now })).toEqual({
      ok: true,
    });
  });
});
