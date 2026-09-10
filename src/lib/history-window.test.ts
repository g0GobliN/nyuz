import { describe, expect, it } from "vitest";
import {
  ageInDays,
  defaultMonthKey,
  describeMonth,
  HISTORY_GRACE_DAYS,
  monthLabel,
  planForAgeDays,
  retentionDaysFor,
  shortPlanName,
  type MonthFacts,
} from "./history-window";

/**
 * The labels the History page puts on a month, and the plan it offers to bring
 * a locked one back.
 *
 * None of this is the access boundary — `history_window_start()` is, and no
 * test in this file can reach a database to prove it. What these assert is the
 * arithmetic that decides what the reader is TOLD, and specifically that it is
 * arithmetic: every judgement comes from a timestamp compared against a window,
 * never from a month's name or its position in the list. A month called
 * "August" is not older than one called "September" in any way this code is
 * allowed to notice.
 */

const NOW = new Date("2026-09-07T12:00:00.000Z");

/** `days` before NOW, as the timestamp the database would have returned. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function facts(over: Partial<MonthFacts> = {}): MonthFacts {
  return { monthKey: "2026-08", available: 0, lockedNewestAt: null, lockedOldestAt: null, ...over };
}

describe("plan entitlements are exactly 7 / 90 / 365 days", () => {
  it("reads the same numbers the pricing page and the SQL do", () => {
    expect(retentionDaysFor("uno")).toBe(7);
    expect(retentionDaysFor("plura")).toBe(90);
    expect(retentionDaysFor("omni")).toBe(365);
  });

  it("holds the grace period at thirty days", () => {
    expect(HISTORY_GRACE_DAYS).toBe(30);
  });
});

describe("the cheapest plan that would actually reach a given age", () => {
  it("treats the boundary day as inside the window, exactly as SQL does", () => {
    // `scheduled_for >= now() - 7 days` includes a row 7.0 days old. If this
    // disagreed, the page would offer Plura for something Uno already reads.
    expect(planForAgeDays(7)).toBe("uno");
    expect(planForAgeDays(90)).toBe("plura");
    expect(planForAgeDays(365)).toBe("omni");
  });

  it("steps up the moment the boundary is crossed", () => {
    expect(planForAgeDays(7.01)).toBe("plura");
    expect(planForAgeDays(90.01)).toBe("omni");
  });

  it("offers nothing at all beyond a year, rather than the priciest plan", () => {
    expect(planForAgeDays(366)).toBeNull();
    expect(planForAgeDays(400)).toBeNull();
  });

  it("measures age in real days, not calendar months", () => {
    expect(ageInDays(daysAgo(10), NOW)).toBeCloseTo(10, 6);
    expect(ageInDays("not a date", NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("a month is labelled from its rows, not from its name", () => {
  it("is available when everything in it is still readable", () => {
    const month = describeMonth(facts({ monthKey: "2026-09", available: 5 }), NOW);
    expect(month.state).toBe("available");
    expect(month.count).toBe(5);
    expect(month.restorePlan).toBeNull();
  });

  it("keeps an allowed month available when it has no briefings", () => {
    const month = describeMonth(facts({ monthKey: "2026-09", available: 0 }), NOW);
    expect(month.state).toBe("available");
    expect(month.count).toBe(0);
  });

  it("is partly available when the window cuts through it", () => {
    // A 90-day Plura window landing mid-June: some days inside, some outside.
    const month = describeMonth(
      facts({
        monthKey: "2026-06",
        available: 12,
        lockedNewestAt: daysAgo(91),
        lockedOldestAt: daysAgo(105),
      }),
      NOW,
    );
    expect(month.state).toBe("partially_available");
    expect(month.count).toBe(12);
    expect(month.restorePlan).toBe("omni");
  });

  it("is locked when nothing in it can be opened", () => {
    const month = describeMonth(
      facts({ available: 0, lockedNewestAt: daysAgo(20), lockedOldestAt: daysAgo(38) }),
      NOW,
    );
    expect(month.state).toBe("locked");
    expect(month.count).toBe(0);
  });

  it("keeps both months of a seven-day window that crosses one", () => {
    // 1-7 September and 31 August are one entitlement, two headings. Neither
    // is locked, because the boundary is a date and the month names are not
    // consulted at any point.
    const september = describeMonth(facts({ monthKey: "2026-09", available: 6 }), NOW);
    const august = describeMonth(facts({ monthKey: "2026-08", available: 1 }), NOW);
    expect([september.state, august.state]).toEqual(["available", "available"]);
    expect(september.label).toBe(monthLabel("2026-09", "en-US"));
  });
});

describe("which plan is offered to restore a locked month", () => {
  it("offers Plura when Plura's window genuinely reaches it", () => {
    const month = describeMonth(
      facts({ lockedNewestAt: daysAgo(30), lockedOldestAt: daysAgo(58) }),
      NOW,
    );
    expect(month.restorePlan).toBe("plura");
    expect(month.restorePartial).toBe(false);
  });

  it("offers Omni when ninety days would not reach any of it", () => {
    // January 2026 seen from September: ~250 days old. Plura restores none of
    // it, so offering Plura would be selling something that does not work.
    const month = describeMonth(
      facts({ monthKey: "2026-01", lockedNewestAt: daysAgo(220), lockedOldestAt: daysAgo(250) }),
      NOW,
    );
    expect(month.restorePlan).toBe("omni");
    expect(month.restorePartial).toBe(false);
  });

  it("says a plan restores only part of a month when that is the truth", () => {
    // Newest locked day 80 days back (Plura reaches it), oldest 100 days back
    // (Plura does not). Both facts are true and the copy has to carry both.
    const month = describeMonth(
      facts({ lockedNewestAt: daysAgo(80), lockedOldestAt: daysAgo(100) }),
      NOW,
    );
    expect(month.restorePlan).toBe("plura");
    expect(month.restorePartial).toBe(true);
  });

  it("offers no plan for history no plan can reach", () => {
    const month = describeMonth(
      facts({ lockedNewestAt: daysAgo(380), lockedOldestAt: daysAgo(395) }),
      NOW,
    );
    expect(month.restorePlan).toBeNull();
    expect(month.restorePartial).toBe(false);
  });

  it("derives the offer from dates even when the month name suggests otherwise", () => {
    // Same month key, two different histories. If the label were doing the
    // work, these would agree; they must not.
    const recent = describeMonth(facts({ monthKey: "2026-08", lockedNewestAt: daysAgo(9) }), NOW);
    const ancient = describeMonth(
      facts({ monthKey: "2026-08", lockedNewestAt: daysAgo(300) }),
      NOW,
    );
    expect(recent.restorePlan).toBe("plura");
    expect(ancient.restorePlan).toBe("omni");
  });
});

describe("presentation details", () => {
  it("turns a month key into a heading", () => {
    expect(monthLabel("2026-09", "en-US")).toBe("September 2026");
    expect(monthLabel("2026-01", "en-US")).toBe("January 2026");
    // Never off by one month: the key is read as UTC, formatted as UTC.
    expect(monthLabel("2026-12", "en-US")).toBe("December 2026");
    expect(monthLabel("nonsense")).toBe("nonsense");
  });

  it("drops the brand prefix for inline copy", () => {
    expect(shortPlanName("plura")).toBe("Plura");
    expect(shortPlanName("omni")).toBe("Omni");
  });

  it("opens on the newest month with something readable in it", () => {
    const months = [
      describeMonth(facts({ monthKey: "2026-09", available: 0, lockedNewestAt: daysAgo(1) }), NOW),
      describeMonth(facts({ monthKey: "2026-08", available: 4 }), NOW),
    ];
    // Not simply months[0]: landing a downgraded reader on a locked wall is the
    // exact experience this feature exists to avoid.
    expect(defaultMonthKey(months)).toBe("2026-08");
    expect(defaultMonthKey([])).toBeNull();
  });
});
