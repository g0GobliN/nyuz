import { describe, expect, it } from "vitest";
import { isCoveredTopic, keepCoveredTopics } from "@/lib/coverage";
import {
  ASK_COOLDOWN_MS,
  DEFAULT_ANNUAL_PRICES,
  PLAN_LIMITS,
  allowedBreaking,
  allowedFrequency,
  askCapabilityFor,
  clipLabels,
  decideAsk,
  digestCapabilityFor,
} from "@/lib/plans";

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
    expect(PLAN_LIMITS.personal.asksPerDay).toBe(10);
    expect(PLAN_LIMITS.pro.asksPerDay).toBe(15);
  });

  it("keeps expensive features bounded per plan", () => {
    expect(PLAN_LIMITS.free.storyCaps.deep).toBe(18);
    expect(PLAN_LIMITS.personal.storyCaps.deep).toBe(30);
    expect(PLAN_LIMITS.pro.storyCaps.deep).toBe(50);
    expect(PLAN_LIMITS.free.alerts).toBe("none");
    expect(PLAN_LIMITS.personal.alertWeeklyCap).toBe(3);
    expect(PLAN_LIMITS.pro.alertDailyCap).toBe(10);
  });
});

describe("plan feature routing", () => {
  it("uses Flash for Free digests and Personal Ask", () => {
    expect(digestCapabilityFor(PLAN_LIMITS.free.digestModel)).toBe("cluster");
    expect(askCapabilityFor(PLAN_LIMITS.personal.askModel)).toBe("cluster");
  });

  it("uses Pro routes for paid digests and Pro Ask", () => {
    expect(digestCapabilityFor(PLAN_LIMITS.personal.digestModel)).toBe("digest");
    expect(askCapabilityFor(PLAN_LIMITS.pro.askModel)).toBe("reason");
  });

  it("clamps alert settings to the active plan", () => {
    expect(allowedBreaking("free", "everything")).toBe("off");
    expect(allowedBreaking("personal", "everything")).toBe("important");
    expect(allowedBreaking("pro", "everything")).toBe("everything");
  });

  it("holds Free to a weekly roundup and lets paid plans choose", () => {
    expect(allowedFrequency("free", "daily")).toBe("weekly");
    expect(allowedFrequency("free", "weekly")).toBe("weekly");
    expect(allowedFrequency("personal", "daily")).toBe("daily");
    expect(allowedFrequency("pro", "daily")).toBe("daily");
  });

  it("still honours a paid reader who prefers the weekly roundup", () => {
    expect(allowedFrequency("personal", "weekly")).toBe("weekly");
    expect(allowedFrequency("pro", "weekly")).toBe("weekly");
  });

  it("treats an unknown plan as Free rather than as unlimited", () => {
    expect(allowedFrequency("nonsense" as never, "daily")).toBe("weekly");
  });

  // The ceilings are the only thing standing between a heavy subscriber and a
  // negative month, so they are asserted rather than left to drift. DeepSeek
  // bills a pro completion at $3.96/M at peak; a month of a plan spent entirely
  // on output must still cost less than the annual price divides to.
  it("keeps a fully-spent month cheaper than the annual price it is sold at", () => {
    const perMillionOut = 3.96;
    const monthly = (annual: number) => annual / 12;

    const personal = (PLAN_LIMITS.personal.monthlyAiTokenCap / 1_000_000) * perMillionOut;
    const pro = (PLAN_LIMITS.pro.monthlyAiTokenCap / 1_000_000) * perMillionOut;

    expect(personal).toBeLessThan(monthly(DEFAULT_ANNUAL_PRICES.personal));
    expect(pro).toBeLessThan(monthly(DEFAULT_ANNUAL_PRICES.pro));
  });

  it("gives each tier more priority sources than the one below it", () => {
    expect(PLAN_LIMITS.free.prioritySources).toBeLessThan(PLAN_LIMITS.personal.prioritySources);
    expect(PLAN_LIMITS.personal.prioritySources).toBeLessThan(PLAN_LIMITS.pro.prioritySources);
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
