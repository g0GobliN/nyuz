import { describe, expect, it } from "vitest";
import { IMPORTANT_DAILY_CAP, remainingImportantSlots, shouldAlert } from "./alerts";
import { PLAN_LIMITS } from "@/lib/plans";

describe("shouldAlert", () => {
  it("sends nothing when alerts are off", () => {
    expect(shouldAlert("off", 10)).toBe(false);
    expect(shouldAlert("off", 0)).toBe(false);
  });

  it("sends every matched event on everything", () => {
    expect(shouldAlert("everything", 0)).toBe(true);
    expect(shouldAlert("everything", 10)).toBe(true);
  });

  it("uses the Minimal density floor on important", () => {
    expect(shouldAlert("important", 5.9)).toBe(false);
    expect(shouldAlert("important", 6)).toBe(true);
    expect(shouldAlert("important", 10)).toBe(true);
  });
});

describe("remainingImportantSlots", () => {
  it("caps important alerts at ten per rolling day", () => {
    expect(remainingImportantSlots(0)).toBe(10);
    expect(remainingImportantSlots(9)).toBe(1);
    expect(remainingImportantSlots(10)).toBe(0);
    expect(remainingImportantSlots(30)).toBe(0);
  });

  it("mirrors the entitlement table, which mirrors the database", () => {
    // Three copies of this number exist: `claim_alert` in 0037 (the only one
    // that enforces anything), PLAN_LIMITS (what the UI advertises) and
    // IMPORTANT_DAILY_CAP (what the pipeline reports as remaining). A drift
    // between them shows a reader a number the database will not honour.
    expect(IMPORTANT_DAILY_CAP).toBe(PLAN_LIMITS.personal.alertDailyCap);
  });

  it("does not ration a busy day into the next one", () => {
    // The old rule was 3 per rolling 7 days: a third alert on Tuesday meant
    // silence until the following Tuesday. Seven genuinely important events in
    // one day must all be sendable.
    expect(remainingImportantSlots(3)).toBeGreaterThanOrEqual(4);
  });
});
