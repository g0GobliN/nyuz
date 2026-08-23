import { describe, expect, it } from "vitest";
import { formatStoryTime } from "@/lib/story-time";

/**
 * The card showed a bare "06:12" with no date on it, so a story read the same
 * whether it broke this morning or last week. These lock in the part that
 * actually matters — that age is visible — without asserting on the locale's
 * choice of separator, which differs between a developer's machine and CI.
 */

/** Local time, so the ISO round-trip lands on the same instant in any zone. */
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const NOW = at(2026, 8, 23, 9, 0);

describe("formatStoryTime", () => {
  it("says Today rather than printing today's date", () => {
    expect(formatStoryTime(at(2026, 8, 23, 6, 12).toISOString(), NOW)).toMatch(/^Today · 06.12$/);
  });

  it("says Yesterday", () => {
    expect(formatStoryTime(at(2026, 8, 22, 23, 50).toISOString(), NOW)).toMatch(
      /^Yesterday · 23.50$/,
    );
  });

  it("counts calendar days, not elapsed hours", () => {
    // Two hours ago, but on the previous date. Dividing the gap by 24 would
    // call this today; a reader looking at the date would not.
    const out = formatStoryTime(at(2026, 8, 22, 23, 0).toISOString(), at(2026, 8, 23, 1, 0));
    expect(out).toMatch(/^Yesterday/);
  });

  it("dates anything older, so a week-old story cannot read as this morning", () => {
    const out = formatStoryTime(at(2026, 8, 16, 6, 12).toISOString(), NOW);
    expect(out).not.toMatch(/Today|Yesterday/);
    expect(out).toMatch(/16/);
    expect(out).toMatch(/06.12/);
  });

  it("omits the year within the current one and states it outside", () => {
    expect(formatStoryTime(at(2026, 1, 4, 6, 12).toISOString(), NOW)).not.toMatch(/2026/);
    // A Pro plan keeps a year of history, so this boundary is reachable.
    expect(formatStoryTime(at(2025, 12, 30, 6, 12).toISOString(), NOW)).toMatch(/2025/);
  });

  it("returns nothing for an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(formatStoryTime("not a date", NOW)).toBe("");
  });
});
