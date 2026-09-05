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
  it("gives Uno no Ask calls", () => {
    expect(PLAN_LIMITS.uno.asksPerDay).toBe(0);
  });

  it("gives paid plans a daily cap", () => {
    expect(PLAN_LIMITS.plura.asksPerDay).toBe(10);
    expect(PLAN_LIMITS.omni.asksPerDay).toBe(15);
  });

  it("keeps expensive features bounded per plan", () => {
    expect(PLAN_LIMITS.uno.storyCaps.deep).toBe(18);
    expect(PLAN_LIMITS.plura.storyCaps.deep).toBe(30);
    expect(PLAN_LIMITS.omni.storyCaps.deep).toBe(50);
    expect(PLAN_LIMITS.uno.alerts).toBe("none");
  });

  it("caps alerts per day, generously, on one window for every plan", () => {
    // Ceilings, not targets. Alerts reuse the shared event analysis and cost no
    // AI, so these exist to bound a bad day rather than to protect a budget —
    // what keeps Plura quiet is its importance floor, not this number.
    expect(PLAN_LIMITS.uno.alertDailyCap).toBe(0);
    expect(PLAN_LIMITS.plura.alertDailyCap).toBe(10);
    expect(PLAN_LIMITS.omni.alertDailyCap).toBe(25);
  });

  it("differentiates Omni by sensitivity rather than by starving Plura", () => {
    // Plura is generous on volume and limited to what it would be a problem
    // to miss. Omni's extra is the ability to widen that, not merely a bigger
    // number — so a paid reader is never made to feel rationed.
    expect(PLAN_LIMITS.plura.alerts).toBe("important");
    expect(PLAN_LIMITS.omni.alerts).toBe("configurable");
    expect(PLAN_LIMITS.omni.alertDailyCap).toBeGreaterThan(PLAN_LIMITS.plura.alertDailyCap);
  });
});

describe("plan feature routing", () => {
  it("uses Flash for Uno digests and Plura Ask", () => {
    expect(digestCapabilityFor(PLAN_LIMITS.uno.digestModel)).toBe("cluster");
    expect(askCapabilityFor(PLAN_LIMITS.plura.askModel)).toBe("cluster");
  });

  it("uses Omni routes for paid digests and Omni Ask", () => {
    expect(digestCapabilityFor(PLAN_LIMITS.plura.digestModel)).toBe("digest");
    expect(askCapabilityFor(PLAN_LIMITS.omni.askModel)).toBe("reason");
  });

  it("clamps alert settings to the active plan", () => {
    expect(allowedBreaking("uno", "everything")).toBe("off");
    expect(allowedBreaking("plura", "everything")).toBe("important");
    expect(allowedBreaking("omni", "everything")).toBe("everything");
  });
});

describe("decideAsk", () => {
  const now = new Date("2026-08-25T03:00:00.000Z");

  it("fails closed when the flag row is missing or off", () => {
    expect(decideAsk({ flagOn: null, plan: "omni", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(decideAsk({ flagOn: false, plan: "omni", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("refuses Uno", () => {
    expect(decideAsk({ flagOn: true, plan: "uno", usedToday: 0, lastAt: null, now })).toEqual({
      ok: false,
      reason: "plan",
    });
  });

  it("refuses once the daily cap is hit", () => {
    expect(
      decideAsk({
        flagOn: true,
        plan: "plura",
        usedToday: PLAN_LIMITS.plura.asksPerDay,
        lastAt: null,
        now,
      }),
    ).toEqual({ ok: false, reason: "quota" });
  });

  it("enforces a cooldown between calls", () => {
    const lastAt = new Date(now.getTime() - ASK_COOLDOWN_MS / 2);
    expect(decideAsk({ flagOn: true, plan: "plura", usedToday: 0, lastAt, now })).toEqual({
      ok: false,
      reason: "cooldown",
    });
  });

  it("allows a Plura call under the cap after the cooldown", () => {
    const lastAt = new Date(now.getTime() - ASK_COOLDOWN_MS - 1);
    expect(decideAsk({ flagOn: true, plan: "plura", usedToday: 0, lastAt, now })).toEqual({
      ok: true,
    });
  });
});
