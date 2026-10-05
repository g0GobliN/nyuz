/**
 * The periods the alert history can be read in, and the day grouping inside
 * them — pure, so the page renders whatever the server already sent and the
 * cost of orientation is zero queries.
 *
 * The wall-of-alerts problem this solves is one of scale, not correctness: a
 * Plura reader's 90-day window paged 25 at a time is a scroll nobody asked
 * for, when what they came for was "what fired this week". The periods are a
 * lens over the same rows, not a different query.
 */

export type AlertPeriod = "week" | "month" | "all";

export const ALERT_PERIODS: { key: AlertPeriod; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

export function isAlertPeriod(value: string | null | undefined): value is AlertPeriod {
  return value === "week" || value === "month" || value === "all";
}

/** The inclusive start of a period, as a local-time midnight. */
export function periodStart(period: AlertPeriod, now: Date): Date | null {
  const start = new Date(now);
  if (period === "week") {
    start.setDate(start.getDate() - 6);
  } else if (period === "month") {
    // Day-of-month clamped: March 31 minus one month must land on Feb 28/29,
    // not spill into March — setMonth alone overflows and silently shortens
    // the window by up to three days.
    const day = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
  } else {
    return null;
  }
  start.setHours(0, 0, 0, 0);
  return start;
}

export type AlertDayGroup<T> = {
  key: string;
  label: string;
  alerts: T[];
};

const DAY_MS = 86_400_000;

/**
 * Rows grouped by calendar day, newest first. The input is already ordered by
 * the query (`scheduled_for desc`), so the groups come out in the same order
 * and every label is derived from the row's own date — no clock skew between
 * the grouping and what the reader sees.
 */
export function groupAlertsByDay<T extends { firedAt: string }>(
  alerts: T[],
  locale?: string,
): AlertDayGroup<T>[] {
  const groups: AlertDayGroup<T>[] = [];
  const today = new Date();
  const todayKey = today.toDateString();
  const yesterdayKey = new Date(today.getTime() - DAY_MS).toDateString();

  for (const alert of alerts) {
    const date = new Date(alert.firedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toDateString();
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.alerts.push(alert);
      continue;
    }
    const label =
      key === todayKey
        ? "Today"
        : key === yesterdayKey
          ? "Yesterday"
          : date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
    groups.push({ key, label, alerts: [alert] });
  }
  return groups;
}
