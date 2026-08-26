import { describe, expect, it } from "vitest";
import { DORMANT_DAYS, NUDGE_EVERY_DAYS, dueForNudge } from "./dormant";

const now = new Date("2026-08-25T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const due = (over: Partial<Parameters<typeof dueForNudge>[0]> = {}) =>
  dueForNudge({
    onboardedAt: daysAgo(30),
    lastSeenAt: daysAgo(24),
    paused: false,
    hasDigest: true,
    lastNudgedAt: null,
    now,
    ...over,
  });

describe("dueForNudge", () => {
  it("is due when a mailed reader has been away longer than the window", () => {
    expect(due()).toBe(true);
  });

  it("is not due when they visited recently", () => {
    expect(due({ lastSeenAt: daysAgo(DORMANT_DAYS - 1) })).toBe(false);
  });

  it("treats never-seen as last active at onboarding", () => {
    expect(due({ lastSeenAt: null, onboardedAt: daysAgo(DORMANT_DAYS - 1) })).toBe(false);
    expect(due({ lastSeenAt: null, onboardedAt: daysAgo(DORMANT_DAYS + 1) })).toBe(true);
  });

  it("does not nudge a paused reader, or one who has never had a briefing", () => {
    expect(due({ paused: true })).toBe(false);
    expect(due({ hasDigest: false })).toBe(false);
  });

  it("does not re-nudge inside the cooldown", () => {
    expect(due({ lastNudgedAt: daysAgo(NUDGE_EVERY_DAYS - 1) })).toBe(false);
    expect(due({ lastNudgedAt: daysAgo(NUDGE_EVERY_DAYS + 1) })).toBe(true);
  });
});
