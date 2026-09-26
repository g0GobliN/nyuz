import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REENTRY_LOOKBACK_HOURS, REENTRY_SHARE, analyse, laneTake } from "./analyse";
import { MAX_WEEKLY_AGE_HOURS } from "./freshness";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * The two guarantees that make re-entry safe, and the index that makes it cheap.
 *
 * ---------------------------------------------------------------------------
 * Arithmetic first, then the lane against a queue
 * ---------------------------------------------------------------------------
 *
 * `revision-delivery.test.ts` proves an old event with a genuine material change
 * travels the whole pipeline to a reader. What it cannot prove is the *bound*:
 * that a corpus of stale dirty rows cannot crowd live work out of a batch. That
 * bound is one arithmetic rule, stated as one function and tested directly --
 * `laneTake` -- and then run against a queue to show `analyse` applies it the way
 * the function says.
 *
 * The 0068 incident is the reason this file exists: the re-entry lane is exactly
 * the kind of change that reintroduces it, and it did once.
 */

describe("live work owns the batch, and re-entry fits in the rest", () => {
  it("gives re-entry all the spare capacity when live work is undersupplied", () => {
    expect(laneTake(100, 0)).toEqual({ reentry: 100, fromLive: 0 });
    expect(laneTake(100, 30)).toEqual({ reentry: 70, fromLive: 30 });
    // One row short of full leaves that row to re-entry, because the alternative
    // is idle capacity rather than protected work.
    expect(laneTake(100, 99)).toEqual({ reentry: 1, fromLive: 99 });
  });

  it("confines re-entry to a quarter when live work fills the batch", () => {
    const saturated = laneTake(100, 100);
    expect(saturated).toEqual({ reentry: 25, fromLive: 75 });
    expect(laneTake(4, 4)).toEqual({ reentry: 1, fromLive: 3 });
    expect(laneTake(8, 50)).toEqual({ reentry: 2, fromLive: 6 });
  });

  it("keeps every slot of a tiny saturated batch for live work", () => {
    // The only slot of a one-row batch belongs to the live row that is waiting
    // for it. The previous rule reserved `max(1, ...)` and gave it to re-entry.
    expect(laneTake(1, 1)).toEqual({ reentry: 0, fromLive: 1 });
    expect(laneTake(2, 2)).toEqual({ reentry: 0, fromLive: 2 });
    expect(laneTake(3, 7)).toEqual({ reentry: 0, fromLive: 3 });
    // With no live work at all, the one slot is spare and re-entry may use it.
    expect(laneTake(1, 0)).toEqual({ reentry: 1, fromLive: 0 });
  });

  it("never gives re-entry more than its share while live work is waiting", () => {
    for (const limit of [0, 1, 2, 3, 4, 5, 7, 40, 100]) {
      for (const live of [0, 1, 3, limit, limit + 50]) {
        const { reentry, fromLive } = laneTake(limit, live);
        const label = `limit ${limit}, live ${live}`;
        expect(reentry + fromLive, label).toBe(limit);
        expect(reentry, label).toBeGreaterThanOrEqual(0);
        // Live gets every row it has, up to the batch, less at most the share.
        const waiting = Math.min(limit, live);
        expect(fromLive, label).toBeGreaterThanOrEqual(
          Math.min(waiting, limit - Math.floor(limit * REENTRY_SHARE)),
        );
        if (live >= limit) expect(reentry, label).toBeLessThanOrEqual(limit * REENTRY_SHARE);
      }
    }
  });

  it("bounds the re-entry lookback, so the lane cannot become a corpus scan", () => {
    expect(REENTRY_LOOKBACK_HOURS).toBeGreaterThan(72);
    expect(REENTRY_LOOKBACK_HOURS).toBeLessThanOrEqual(MAX_WEEKLY_AGE_HOURS * 3);
  });
});

/* -------------------------------------------------------------------------- */
/* The lanes against a queue                                                   */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-09-26T12:00:00Z");
const HOUR = 3_600_000;

/** A pending live event, `hoursOld` after it was first seen. */
function live(id: string, hoursOld: number): Row {
  const at = new Date(NOW.getTime() - hoursOld * HOUR).toISOString();
  return {
    id,
    title: id,
    status: "pending",
    metadata_dirty: true,
    first_seen_at: at,
    coverage_changed_at: at,
    coverage_revision: 1,
    analysed_at: null,
    material_revision: 0,
  };
}

/** A complete event from `daysOld` ago whose coverage changed `hoursAgo`. */
function reentering(id: string, daysOld: number, hoursAgo: number): Row {
  return {
    id,
    title: id,
    status: "complete",
    metadata_dirty: true,
    first_seen_at: new Date(NOW.getTime() - daysOld * 24 * HOUR).toISOString(),
    coverage_changed_at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    coverage_revision: 2,
    analysed_at: new Date(NOW.getTime() - daysOld * 24 * HOUR).toISOString(),
    material_revision: 0,
  };
}

/** The order `analyse` would work the queue in, without finalizing anything. */
async function batch(events: Row[], limit: number): Promise<string[]> {
  const db = new FakeDb({ events, sources: [], topics: [] });
  const report = await analyse(asDb(db), { now: NOW, limit, dryRun: true });
  return report.outcomes.map((outcome) => outcome.eventId);
}

describe("analyse applies the lane rule to a real queue", () => {
  it("gives the only slot of a one-row batch to the live event", async () => {
    expect(await batch([live("L1", 1), reentering("R1", 20, 1)], 1)).toEqual(["L1"]);
  });

  it("lets live work fill the slots re-entry does not use", async () => {
    // Four live rows, a batch of four, and nothing re-entering: the reserve is a
    // ceiling on re-entry, not a hole in the batch.
    const rows = [live("L1", 1), live("L2", 2), live("L3", 3), live("L4", 4)];
    expect(await batch(rows, 4)).toEqual(["L1", "L2", "L3", "L4"]);
  });

  it("confines re-entry to its share when live work saturates the batch", async () => {
    const rows = [
      live("L1", 1),
      live("L2", 2),
      live("L3", 3),
      live("L4", 4),
      live("L5", 5),
      reentering("R1", 20, 1),
      reentering("R2", 30, 2),
    ];
    // Newest live work first, the reserve from the tail of the live page.
    expect(await batch(rows, 4)).toEqual(["L1", "L2", "L3", "R1"]);
  });

  it("gives re-entry the spare capacity, most recent coverage first", async () => {
    const rows = [live("L1", 1), reentering("R-old", 30, 20), reentering("R-new", 15, 2)];
    expect(await batch(rows, 10)).toEqual(["L1", "R-new", "R-old"]);
  });

  it("selects on when coverage changed, not on when the event was created", async () => {
    // Thirty days old and touched an hour ago: in. Forty days old and last
    // touched sixteen days ago: out, however dirty, because its coverage is past
    // the lookback.
    const rows = [reentering("recent-coverage", 30, 1), reentering("stale-coverage", 40, 16 * 24)];
    expect(await batch(rows, 10)).toEqual(["recent-coverage"]);
  });
});

describe("the query and the index still describe the same lane", () => {
  const coverageClock = readFileSync("supabase/migrations/0102_coverage_clock.sql", "utf8");
  const materialReentry = readFileSync("supabase/migrations/0098_material_reentry.sql", "utf8");
  const analyseSource = readFileSync("src/lib/pipeline/analyse.ts", "utf8");

  it("reads the coverage clock the attachment trigger writes, through its own index", () => {
    // `events_metadata_work` (0085) orders by `first_seen_at desc`, which is the
    // column the re-entry lane is deliberately *outside* of.
    expect(coverageClock).toMatch(
      /create index events_coverage_reentry_idx\s+on public\.events \(coverage_changed_at desc\)\s+where metadata_dirty or status in \('pending', 'analysing'\);/,
    );
    expect(coverageClock).toMatch(/drop index if exists public\.events_material_reentry_idx;/);
    expect(analyseSource).toContain('.gte("coverage_changed_at", reentrySince)');
    expect(analyseSource).toContain('.order("coverage_changed_at", { ascending: false })');
    // `last_updated_at` is never written after insert; reading it here is the
    // defect 0102 exists for.
    expect(analyseSource).not.toMatch(/\.(?:gte|order)\("last_updated_at"/);
  });

  it("keeps the material clock indexed for the match stage", () => {
    expect(materialReentry).toMatch(
      /create index events_material_clock_idx\s+on public\.events \(material_occurrence_at desc\)\s+where material_revision > 0;/,
    );
  });

  it("still admits on the work predicate rather than on the taxonomy", () => {
    // The invariant `security-invariants.test.ts` enforces: analysis is admitted
    // because there is work to do, not because a curated list recognised the
    // event. Adding a lane must not add a taxonomy gate.
    expect(analyseSource).toContain("metadata_dirty.eq.true");
    expect(analyseSource).not.toMatch(/TOPIC_KEYWORDS/);
  });
});
