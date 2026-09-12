import { describe, expect, it } from "vitest";
import {
  ALERT_BURST,
  ALERT_BURST_WINDOW_MINUTES,
  ALERT_DAILY_SAFETY_CAP,
  IMPORTANT_DAILY_CAP,
  paceAlerts,
  remainingImportantSlots,
  shouldAlert,
} from "./alerts";
import { PLAN_LIMITS } from "@/lib/plans";

describe("shouldAlert", () => {
  it("sends nothing when alerts are off", () => {
    expect(shouldAlert("off", 10)).toBe(false);
    expect(shouldAlert("off", 0)).toBe(false);
  });

  it("keeps the important floor in configurable mode", () => {
    expect(shouldAlert("everything", 0)).toBe(false);
    expect(shouldAlert("everything", 10)).toBe(true);
  });

  it("uses the Minimal density floor on important", () => {
    expect(shouldAlert("important", 5.9)).toBe(false);
    expect(shouldAlert("important", 6)).toBe(true);
    expect(shouldAlert("important", 10)).toBe(true);
  });
});

describe("remainingImportantSlots", () => {
  it("caps important alerts at five per rolling day", () => {
    expect(remainingImportantSlots(0)).toBe(5);
    expect(remainingImportantSlots(4)).toBe(1);
    expect(remainingImportantSlots(10)).toBe(0);
    expect(remainingImportantSlots(30)).toBe(0);
  });

  it("mirrors the entitlement table, which mirrors the database", () => {
    // Three copies of this number exist: `claim_alert` in 0037 (the only one
    // that enforces anything), PLAN_LIMITS (what the UI advertises) and
    // IMPORTANT_DAILY_CAP (what the pipeline reports as remaining). A drift
    // between them shows a reader a number the database will not honour.
    expect(IMPORTANT_DAILY_CAP).toBe(PLAN_LIMITS.plura.alertDailyCap);
  });

  it("does not ration a busy day into the next one", () => {
    // The old rule was 3 per rolling 7 days: a third alert on Tuesday meant
    // silence until the following Tuesday. Seven genuinely important events in
    // one day must all be sendable.
    expect(remainingImportantSlots(3)).toBe(2);
  });
});

describe("paceAlerts", () => {
  const now = new Date("2026-09-01T09:25:00Z");
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60 * 1000);
  const hoursAgo = (n: number) => minutesAgo(n * 60);
  const hits = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ eventId: `e${i}`, importance: i, eventAt: null }));

  it("holds one match run to a single burst", () => {
    // 2026-09-01: twenty-two alerts inside one minute, in event order, because
    // a run sent everything it matched.
    expect(paceAlerts({ hits: hits(22), recent: [], now })).toHaveLength(ALERT_BURST);
  });

  it("sends the strongest hits, not the first ones the matcher walked past", () => {
    const picked = paceAlerts({
      hits: [
        { eventId: "routine", importance: 1, eventAt: null },
        { eventId: "major", importance: 9, eventAt: null },
        { eventId: "filler", importance: 0, eventAt: null },
        { eventId: "notable", importance: 5, eventAt: null },
      ],
      recent: [],
      now,
    });
    expect(picked.map((h) => h.eventId)).toEqual(["major", "notable", "routine"]);
  });

  it("leaves the tail unclaimed for later runs to reconsider", () => {
    // Nothing here rejects the rest. `alert_claims` is only written for hits
    // that reach `create_alert_delivery`, so what this drops stays eligible.
    const all = hits(22);
    const sent = paceAlerts({ hits: all, recent: [], now });
    const carried = all.filter((h) => !sent.some((p) => p.eventId === h.eventId));
    expect(carried).toHaveLength(22 - ALERT_BURST);
    expect(paceAlerts({ hits: carried, recent: [], now })).toHaveLength(ALERT_BURST);
  });

  it("reopens as soon as the burst window has slid past", () => {
    const justFired = Array.from({ length: ALERT_BURST }, () => minutesAgo(5));
    expect(paceAlerts({ hits: hits(5), recent: justFired, now })).toEqual([]);

    const older = Array.from({ length: ALERT_BURST }, () =>
      minutesAgo(ALERT_BURST_WINDOW_MINUTES + 1),
    );
    expect(paceAlerts({ hits: hits(5), recent: older, now })).toHaveLength(ALERT_BURST);
  });

  it("does not silence a major story two hours after an earlier burst", () => {
    // An acquisition at 10:00 and an announcement at 12:00 are two events. The
    // second is not less urgent for the first having happened.
    const earlier = Array.from({ length: ALERT_BURST }, () => hoursAgo(2));
    const picked = paceAlerts({
      hits: [{ eventId: "openai", importance: 9, eventAt: null }],
      recent: earlier,
      now,
    });
    expect(picked.map((h) => h.eventId)).toEqual(["openai"]);
  });

  it("keeps a busy day sending well past the old six-a-day rule", () => {
    // Twelve genuinely important developments in one unusual day send twelve.
    let recent: Date[] = [];
    let sent = 0;
    for (let hour = 12; hour >= 1; hour -= 1) {
      const at = new Date(now.getTime() - hour * 60 * 60 * 1000);
      const picked = paceAlerts({ hits: hits(1), recent, now: at });
      sent += picked.length;
      if (picked.length > 0) recent = [...recent, at];
    }
    expect(sent).toBe(12);
  });

  it("stops at the rolling-day safety ceiling", () => {
    const spent = Array.from({ length: ALERT_DAILY_SAFETY_CAP }, (_, i) => hoursAgo(1 + i * 0.5));
    expect(paceAlerts({ hits: hits(5), recent: spent, now })).toEqual([]);
  });

  it("never spends more of the day's ceiling than is left", () => {
    const spent = Array.from({ length: ALERT_DAILY_SAFETY_CAP - 1 }, (_, i) =>
      hoursAgo(1 + i * 0.5),
    );
    expect(paceAlerts({ hits: hits(5), recent: spent, now })).toHaveLength(1);
  });

  it("does not count alerts that have aged out of the rolling day", () => {
    const yesterday = Array.from({ length: ALERT_DAILY_SAFETY_CAP }, () => hoursAgo(25));
    expect(paceAlerts({ hits: hits(5), recent: yesterday, now })).toHaveLength(ALERT_BURST);
  });

  it("invents nothing when the mode admitted nothing", () => {
    // `important` sending zero on a quiet day is the correct answer, not a gap
    // to fill. Pacing only ever returns a subset of what it was handed.
    const quiet = [{ importance: 5.9 }, { importance: 0 }].filter((e) =>
      shouldAlert("important", e.importance),
    );
    expect(quiet).toEqual([]);
    expect(paceAlerts({ hits: [], recent: [], now })).toEqual([]);
  });

  it("keeps weak events out even with advanced controls", () => {
    const low = [
      { eventId: "a", importance: 0, eventAt: null },
      { eventId: "b", importance: 1, eventAt: null },
    ];
    expect(low.every((h) => shouldAlert("everything", h.importance))).toBe(false);
    expect(low.every((h) => shouldAlert("important", h.importance))).toBe(false);
    expect(paceAlerts({ hits: low, recent: [], now })).toHaveLength(2);
  });
});
