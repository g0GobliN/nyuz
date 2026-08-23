/**
 * The `in.(…)` chunking invariants.
 *
 * This is the only part of the ingester that is worth testing without a database:
 * everything else is a conversation with Postgres. `byUrlLength` is arithmetic, and
 * it is arithmetic that already went wrong once in production — a 17,082 character
 * request URL that Supabase dropped without an HTTP status, reported as
 * `TypeError: fetch failed` and charged to Rock Paper Shotgun for two runs before
 * anybody looked at the cause.
 *
 * Both failure directions are invisible from the outside, which is why they are
 * pinned here rather than left to a live run:
 *
 *   - a group that is too big brings back the original bug, for whichever
 *     publisher happens to write the longest slugs
 *   - a dropped or duplicated group means headline updates quietly stop being
 *     correct, and nothing anywhere reports it
 */

import { describe, expect, it } from "vitest";

import { byUrlLength, URL_FILTER_BUDGET } from "./ingest";

/** What one URL costs inside `in.("…","…")`, as the implementation counts it. */
const cost = (url: string): number => encodeURIComponent(url).length + 3;
const total = (urls: string[]): number => urls.reduce((n, u) => n + cost(u), 0);

/** Long enough to need splitting, and shaped like the feed that caused this. */
const rps = (n: number): string[] =>
  Array.from(
    { length: n },
    (_, i) => `https://www.rockpapershotgun.com/${"a-long-descriptive-slug-".repeat(6)}${i}`,
  );

describe("byUrlLength", () => {
  it("loses nothing and duplicates nothing, at any size", () => {
    for (const n of [0, 1, 2, 17, 100, 500]) {
      const urls = rps(n);
      expect(byUrlLength(urls).flat(), `n=${n}`).toEqual(urls);
    }
  });

  it("keeps every group within the budget", () => {
    for (const group of byUrlLength(rps(500))) {
      expect(total(group)).toBeLessThanOrEqual(URL_FILTER_BUDGET);
    }
  });

  it("returns no groups for no urls, rather than one empty group", () => {
    // An empty group would become `url=in.()`, which is a syntax error and not a
    // query returning nothing.
    expect(byUrlLength([])).toEqual([]);
  });

  it("splits the real case that failed", () => {
    // 100 items with slugs up to ~200 characters. One group would be the bug.
    const groups = byUrlLength(rps(100));

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toHaveLength(100);
  });

  it("uses one request when a feed fits, which is nearly all of them", () => {
    const short = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    expect(byUrlLength(short)).toEqual([short]);
  });

  it("gives an over-budget url its own group instead of dropping it", () => {
    // Attempting it is right: at 4000 there is still 12KB of headroom before the
    // real limit, so a single long URL very probably works. Dropping it would
    // mean an article that can never have its headline corrected.
    const huge = `https://example.com/${"x".repeat(URL_FILTER_BUDGET * 2)}`;
    const groups = byUrlLength(["https://example.com/a", huge, "https://example.com/b"]);

    expect(groups.flat()).toEqual(["https://example.com/a", huge, "https://example.com/b"]);
    expect(groups.some((group) => group.length === 1 && group[0] === huge)).toBe(true);
  });

  it("counts encoded length, not raw length", () => {
    // A URL of characters that each triple under percent-encoding must be
    // budgeted at its encoded size, or the group passes this check and fails at
    // the server. One space is `%20`.
    const spaced = Array.from({ length: 40 }, (_, i) => `https://example.com/a b c d e f g h ${i}`);

    for (const group of byUrlLength(spaced)) {
      const raw = group.reduce((n, u) => n + u.length + 3, 0);
      expect(total(group)).toBeLessThanOrEqual(URL_FILTER_BUDGET);
      expect(total(group)).toBeGreaterThan(raw);
    }
  });
});
