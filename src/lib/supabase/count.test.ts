import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CountUnreadableError, countOrThrow, countOrZero, readCount } from "@/lib/supabase/count";

/**
 * The counted read is the seam this codebase asks "how many?" through, and it
 * exists because the obvious way to ask cannot fail.
 *
 * `select(..., { count: "exact", head: true })` reads a *missing relation* as an
 * empty success: `postgrest-js` cannot read the body of a HEAD response, so
 * PostgREST's 404 arrives as `body === ""` and the library rewrites that as
 * `{ status: 204, count: null, error: null }`. Every `count ?? 0` sitting on top
 * of one of those reads therefore reported a relation that does not exist as a
 * relation with no rows. Measured against the live project on 2026-10-07, which
 * is why `active_custom_sources` could be absent from production while the
 * checks that were supposed to notice stayed green.
 *
 * Two properties are pinned here, and the second is the one that matters:
 * a real zero stays a zero, and an unreadable count is never a zero.
 */

describe("counted reads", () => {
  it("returns a real zero, because a relation with no rows counts zero", () => {
    expect(countOrThrow("sources", { count: 0, error: null })).toBe(0);
  });

  it("returns the count when the read succeeded", () => {
    expect(countOrThrow("articles", { count: 16, error: null })).toBe(16);
  });

  it("refuses the silent-success shape a missing relation produces", () => {
    // The exact response `postgrest-js` synthesises for a HEAD request that
    // PostgREST answered 404: no error, and no count either.
    const probe = { count: null, error: null };
    expect(() => countOrThrow("active_custom_sources", probe)).toThrow(CountUnreadableError);
    expect(() => countOrThrow("active_custom_sources", probe)).toThrow(/no count/);
    expect(() => countOrThrow("active_custom_sources", probe)).toThrow(/not a zero/);
  });

  it("names the read that failed, so an operator can find it", () => {
    expect(() => countOrThrow("user_topics", { count: null, error: null })).toThrow(
      /count\(user_topics\)/,
    );
  });

  it("keeps the server's own message when the server sent one", () => {
    expect(() =>
      countOrThrow("sources", {
        count: null,
        error: { message: "permission denied for table sources" },
      }),
    ).toThrow(/permission denied for table sources/);
  });

  it("awaits a query that has not been sent yet", async () => {
    await expect(readCount("digests", Promise.resolve({ count: 7, error: null }))).resolves.toBe(7);
    await expect(
      readCount("digests", Promise.resolve({ count: null, error: null })),
    ).rejects.toThrow(CountUnreadableError);
  });
});

describe("countOrZero, the one deliberate exception", () => {
  it("passes a real count through, including a real zero", () => {
    expect(countOrZero("topics", { count: 3, error: null })).toBe(3);
    expect(countOrZero("topics", { count: 0, error: null })).toBe(0);
  });

  it("reads an unreadable count as zero instead of failing, and says so", () => {
    expect(countOrZero("topics", { count: null, error: null })).toBe(0);
    expect(countOrZero("topics", { count: null, error: { message: "boom" } })).toBe(0);
  });
});

/**
 * The invariant, enforced rather than remembered.
 *
 * The fault was never `head: true` itself; it was what got done with the
 * answer. `count ?? 0` turns "I could not read this" into "there are none", so
 * the rule is that no counted read falls back to a number. The scan is scoped
 * to the files that actually ask PostgREST for a count, because an identifier
 * ending in `Count` elsewhere is ordinary data — a row's own
 * `enrichment_failure_count`, an input's `sourceCount` — with its own default.
 * Only zero and one are flagged: `count ?? null` says "unknown" out loud and is
 * the opposite of the bug.
 */
describe("no counted read substitutes a number for an unreadable count", () => {
  const files = readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    // A recursive readdir joins with the platform's separator, so on Windows
    // every nested entry arrived as `lib\server\operations.ts` and the paths
    // below never matched -- the scan silently read only the top level of `src`
    // and the two assertions that need a nested file failed for a reason that
    // had nothing to do with what they check.
    .map((entry) => `src/${entry.replace(/\\/g, "/")}`);

  const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")] as const));
  const counters = files.filter((file) => sources.get(file)?.includes('count: "exact"'));

  /** `count ?? 0`, `pushCount ?? 0`, `failedDeliveries ?? 0`. Never `?? null`. */
  const fallback = /[A-Za-z_$][A-Za-z0-9_$]*\s*\?\?\s*[01]\b/;
  const mentioned = /count|Count|failedDeliveries/;
  const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);
  /**
   * A `map.get(key) ?? default` is a local tally with an explicit per-key
   * default, never a PostgREST count whose failure would need a voice.
   */
  const isTally = (line: string): boolean => /\.get\([^)]*\)\s*\?\?/.test(line);

  it("scans the files that count, and only those", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(counters.length).toBeGreaterThan(10);
    expect(counters).toContain("src/lib/server/operations.ts");
    expect(counters).not.toContain("src/lib/feedback-weights.ts");
  });

  it("never falls back to a number after a counted read", () => {
    const offenders: string[] = [];
    for (const file of counters) {
      (sources.get(file) ?? "").split("\n").forEach((line, index) => {
        if (isComment(line) || isTally(line) || !mentioned.test(line) || !fallback.test(line)) {
          return;
        }
        offenders.push(`  - ${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      [
        "These lines fall back to a number after a counted read, so a relation",
        "that does not exist reads as an empty one. Use `countOrThrow` from",
        "@/lib/supabase/count, which throws instead of substituting zero, or",
        "`countOrZero` where a zero is the written-down safe answer:",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
