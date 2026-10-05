import { describe, expect, it } from "vitest";
import {
  ALERT_PERIODS,
  groupAlertsByDay,
  isAlertPeriod,
  periodStart,
  type AlertPeriod,
} from "@/lib/alerts-periods";

describe("isAlertPeriod", () => {
  it("accepts exactly the three periods", () => {
    expect(isAlertPeriod("week")).toBe(true);
    expect(isAlertPeriod("month")).toBe(true);
    expect(isAlertPeriod("all")).toBe(true);
  });

  it("refuses anything else the URL might carry", () => {
    // The history range arrives in the query string, so this is the only line
    // between `?range=<script>` and a rendered period.
    expect(isAlertPeriod("fortnight")).toBe(false);
    expect(isAlertPeriod("")).toBe(false);
    expect(isAlertPeriod(null)).toBe(false);
    expect(isAlertPeriod(undefined)).toBe(false);
  });

  it("lists the three tabs in reading order", () => {
    expect(ALERT_PERIODS.map((p) => p.key)).toEqual<AlertPeriod[]>(["week", "month", "all"]);
  });
});

describe("periodStart", () => {
  it("starts the week at local midnight six days back", () => {
    const start = periodStart("week", new Date(2026, 8, 30, 14, 30));
    expect(start).not.toBeNull();
    expect(start!.getFullYear()).toBe(2026);
    expect(start!.getMonth()).toBe(8);
    expect(start!.getDate()).toBe(24);
    expect(start!.getHours()).toBe(0);
    expect(start!.getMinutes()).toBe(0);
  });

  it("starts the month one calendar month back, clamped at its end", () => {
    // March 31 minus one month is February 28/29, not a spill into March —
    // setMonth alone would land on March 3 and silently shorten the window.
    const start = periodStart("month", new Date(2026, 2, 31, 9, 0));
    expect(start).not.toBeNull();
    expect(start!.getFullYear()).toBe(2026);
    expect(start!.getMonth()).toBe(1);
    expect(start!.getDate()).toBe(28);
  });

  it("keeps the same day when the previous month is long enough", () => {
    const start = periodStart("month", new Date(2026, 9, 5, 23, 59));
    expect(start).not.toBeNull();
    expect(start!.getMonth()).toBe(8);
    expect(start!.getDate()).toBe(5);
    expect(start!.getHours()).toBe(0);
  });

  it("has no start for All — the whole history is already loaded", () => {
    expect(periodStart("all", new Date())).toBeNull();
  });
});

describe("groupAlertsByDay", () => {
  const NOON = 12;
  const today = new Date();
  const dayAt = (daysAgo: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(NOON, 0, 0, 0);
    return d;
  };
  const alert = (firedAt: Date) => ({ firedAt: firedAt.toISOString() });

  it("labels today, yesterday, and older days from each row's own date", () => {
    const groups = groupAlertsByDay([alert(dayAt(0)), alert(dayAt(1)), alert(dayAt(4))], "en-US");
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", expect.any(String)]);
    expect(groups[2]!.label).not.toBe("Today");
    expect(groups[2]!.label).not.toBe("Yesterday");
    expect(groups[2]!.label.length).toBeGreaterThan(0);
  });

  it("merges consecutive rows of one day and keeps every alert", () => {
    const groups = groupAlertsByDay([alert(dayAt(0)), alert(dayAt(0)), alert(dayAt(1))]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.alerts).toHaveLength(2);
    expect(groups[1]!.alerts).toHaveLength(1);
  });

  it("groups in input order without re-sorting across a day break", () => {
    // The query returns `scheduled_for desc`; a reader's clock can disagree
    // with the server's, so the grouper must never re-order — it only splits.
    const groups = groupAlertsByDay([alert(dayAt(1)), alert(dayAt(0)), alert(dayAt(1))]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.alerts)).toHaveLength(3);
  });

  it("drops rows whose date cannot be parsed instead of grouping a NaN day", () => {
    const groups = groupAlertsByDay([{ firedAt: "not-a-date" }, alert(dayAt(0))]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Today");
  });
});
