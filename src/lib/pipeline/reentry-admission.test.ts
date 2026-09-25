import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REENTRY_LOOKBACK_HOURS, laneTake } from "./analyse";
import { MAX_WEEKLY_AGE_HOURS } from "./freshness";

/**
 * The two guarantees that make re-entry safe, and the index that makes it cheap.
 *
 * ---------------------------------------------------------------------------
 * Why this is arithmetic and not an integration test
 * ---------------------------------------------------------------------------
 *
 * `revision-delivery.test.ts` proves an old event with a genuine material change
 * travels the whole pipeline to a reader. What it cannot prove is the *bound*:
 * that a corpus of stale dirty rows cannot crowd live work out of a batch. That
 * bound is one arithmetic rule, so it is stated as one function and tested
 * directly -- `laneTake` -- and the two source-level assertions below check that
 * the rule is still wired to the query it was written for.
 *
 * The 0068 incident is the reason this file exists: the re-entry lane is exactly
 * the kind of change that reintroduces it, and it did once.
 */

describe("live work owns the batch, and re-entry fits in the rest", () => {
  it("gives re-entry all the spare capacity when live work is undersupplied", () => {
    expect(laneTake(100, 0)).toEqual({ reentry: 100, fromLive: 0 });
    expect(laneTake(100, 30)).toEqual({ reentry: 70, fromLive: 30 });
    // One row of live work leaves the batch to re-entry, because the alternative
    // is idle capacity rather than protected work.
    expect(laneTake(100, 99)).toEqual({ reentry: 1, fromLive: 99 });
  });

  it("confines re-entry to a quarter when live work fills the batch", () => {
    // The guarantee: with a saturating live queue, three quarters of the batch is
    // still live work no matter how large the dirty backlog is.
    const saturated = laneTake(100, 100);
    expect(saturated.reentry).toBe(25);
    expect(saturated.fromLive).toBe(75);
    expect(saturated.fromLive / 100).toBeGreaterThanOrEqual(0.75);

    // And a batch smaller than the reserve still keeps at least one live row.
    const small = laneTake(4, 4);
    expect(small.reentry).toBe(1);
    expect(small.fromLive).toBe(3);
    expect(laneTake(1, 1).fromLive).toBe(0);
  });

  it("never over-commits the batch, whatever the live count", () => {
    for (const limit of [1, 2, 5, 40, 100]) {
      for (const live of [0, 1, 3, limit, limit + 50]) {
        const { reentry, fromLive } = laneTake(limit, live);
        expect(reentry + fromLive, `limit ${limit}, live ${live}`).toBeLessThanOrEqual(limit);
        expect(reentry).toBeGreaterThanOrEqual(0);
        expect(fromLive).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("bounds the re-entry lookback, so the lane cannot become a corpus scan", () => {
    // Without a bound on how recently coverage must have arrived, every stale
    // dirty row ever created would be a candidate, which is the unbounded
    // backlog the horizon exists to prevent.
    expect(REENTRY_LOOKBACK_HOURS).toBeGreaterThan(72);
    expect(REENTRY_LOOKBACK_HOURS).toBeLessThanOrEqual(MAX_WEEKLY_AGE_HOURS * 3);
  });
});

describe("the query and the index still describe the same lane", () => {
  const migration = readFileSync("supabase/migrations/0098_material_reentry.sql", "utf8");
  const analyse = readFileSync("src/lib/pipeline/analyse.ts", "utf8");

  it("has a partial index ordered the way the re-entry lane reads", () => {
    // `events_metadata_work` (0085) orders by `first_seen_at desc`, which is the
    // column the re-entry lane is deliberately *outside* of: admitting old work
    // without a second index means scanning every dirty row.
    expect(migration).toMatch(
      /create index events_material_reentry_idx\s+on public\.events \(last_updated_at desc\)\s+where metadata_dirty;/,
    );
    expect(analyse).toContain('.gte("last_updated_at", reentrySince)');
    expect(analyse).toContain('.order("last_updated_at", { ascending: false })');
  });

  it("keeps the material clock indexed for the match stage", () => {
    // Only materially revised events need this ordering, hence the partial
    // predicate: everything else sorts on `first_seen_at` as before.
    expect(migration).toMatch(
      /create index events_material_clock_idx\s+on public\.events \(material_occurrence_at desc\)\s+where material_revision > 0;/,
    );
  });

  it("still admits on the work predicate rather than on the taxonomy", () => {
    // The invariant `security-invariants.test.ts` enforces: analysis is admitted
    // because there is work to do, not because a curated list recognised the
    // event. Adding a lane must not add a taxonomy gate.
    expect(analyse).toContain("metadata_dirty.eq.true");
    expect(analyse).not.toMatch(/TOPIC_KEYWORDS/);
  });
});
