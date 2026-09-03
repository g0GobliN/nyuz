import { describe, expect, it } from "vitest";
import { isPredefinedTopic, keepUsableTopics } from "@/lib/coverage";
import {
  ASK_COOLDOWN_MS,
  PLAN_LIMITS,
  allowedBreaking,
  askCapabilityFor,
  clipLabels,
  decideAsk,
  digestCapabilityFor,
} from "@/lib/plans";

describe("isPredefinedTopic", () => {
  it("accepts pool labels regardless of case and spacing", () => {
    expect(isPredefinedTopic("OpenAI")).toBe(true);
    expect(isPredefinedTopic(" openai ")).toBe(true);
    expect(isPredefinedTopic("Developer tools")).toBe(true);
  });

  it("answers what the model can classify, not what a reader may follow", () => {
    // "Knitting" is followable now; it is simply not in the editorial
    // vocabulary the analysis prompt is built from. Conflating those two
    // questions is what made a reader-created interest unsaveable.
    expect(isPredefinedTopic("Knitting")).toBe(false);
    expect(isPredefinedTopic("Politics")).toBe(true);
    expect(isPredefinedTopic("Music")).toBe(true);
  });
});

describe("keepUsableTopics", () => {
  it("keeps free text and marks which entries are editorial", () => {
    const { kept } = keepUsableTopics(["Knitting", "OpenAI", "openai", "React"]);
    expect(kept.map((t) => t.label)).toEqual(["Knitting", "OpenAI", "React"]);
    expect(kept.map((t) => t.predefined)).toEqual([false, true, true]);
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
  });

  it("caps alerts per day, generously, on one window for every plan", () => {
    // Ceilings, not targets. Alerts reuse the shared event analysis and cost no
    // AI, so these exist to bound a bad day rather than to protect a budget —
    // what keeps Personal quiet is its importance floor, not this number.
    expect(PLAN_LIMITS.free.alertDailyCap).toBe(0);
    expect(PLAN_LIMITS.personal.alertDailyCap).toBe(10);
    expect(PLAN_LIMITS.pro.alertDailyCap).toBe(25);
  });

  it("differentiates Pro by sensitivity rather than by starving Personal", () => {
    // Personal is generous on volume and limited to what it would be a problem
    // to miss. Pro's extra is the ability to widen that, not merely a bigger
    // number — so a paid reader is never made to feel rationed.
    expect(PLAN_LIMITS.personal.alerts).toBe("important");
    expect(PLAN_LIMITS.pro.alerts).toBe("configurable");
    expect(PLAN_LIMITS.pro.alertDailyCap).toBeGreaterThan(PLAN_LIMITS.personal.alertDailyCap);
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
