/**
 * How a story's timestamp is written.
 *
 * A card used to show a bare clock time — "06:12" — which is unambiguous for
 * about a day and quietly misleading after that. Open the dashboard a week
 * later and a week-old story still reads as though it landed this morning,
 * which is the opposite of what a briefing product is for: knowing when
 * something happened is most of knowing whether it still matters.
 *
 * "Today" and "Yesterday" carry the two days where a numeric date is the slower
 * read, and everything older gets the date itself.
 */
export function formatStoryTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  // h23 rather than `hour12: false`, which renders midnight as "24:00" in some
  // locales. The rest of the app writes times as 07:30, so this matches.
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const days = calendarDaysBetween(at, now);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;

  // Within the same year the year is noise. Across one it is the entire point,
  // and a briefing kept for a year on the Omni plan will cross that line.
  const date = at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date} · ${time}`;
}

/**
 * Whole calendar days from `a` to `b`, ignoring the clock.
 *
 * Subtracting the instants and dividing would call 23:00 and 01:00 the same day
 * when they are not, and two timestamps 25 hours apart "yesterday" when one is
 * three days back. Both dates are flattened to local midnight first, so this
 * answers the question a reader is actually asking.
 */
function calendarDaysBetween(a: Date, b: Date): number {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayB - dayA) / 86_400_000);
}
