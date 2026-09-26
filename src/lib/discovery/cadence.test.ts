import { describe, expect, it } from "vitest";
import {
  MIN_INTERVALS,
  STALE_CEILING_DAYS,
  STALE_FLOOR_DAYS,
  classifyCoverage,
  discoveryAppetite,
  medianIntervalHours,
  staleAfterHours,
  type CoverageSignals,
} from "@/lib/discovery/cadence";
import { gapFor } from "@/lib/discovery/coverage";

/**
 * Coverage, measured against the subject's own pace.
 *
 * ---------------------------------------------------------------------------
 * The property this file exists for
 * ---------------------------------------------------------------------------
 *
 * Activity frequency must not be mistaken for coverage. The tests below are
 * written as the same subject at four different cadences -- daily, weekly,
 * fortnightly, and dormant -- and the assertion that matters is that the
 * fortnightly one reads `strong` while it is behaving normally. Any change that
 * reintroduces a fixed window ("no events in 24h means uncovered") fails here and
 * everywhere else in this file.
 */

const NOW = new Date("2026-09-25T12:00:00Z");

/** A series of observation times, most recent first, from hours ago. */
function timesAgo(...hours: number[]): string[] {
  return hours.map((hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString());
}

/** A subject observed on a regular cadence, ending `sinceLast` hours ago. */
function cadence(periodHours: number, observations: number, sinceLast: number): string[] {
  return timesAgo(...Array.from({ length: observations }, (_, i) => sinceLast + i * periodHours));
}

function signals(overrides: Partial<CoverageSignals> = {}): CoverageSignals {
  return {
    demandUsers: 1,
    eventTimes: [],
    mappedSources: 2,
    openTrials: 0,
    now: NOW,
    ...overrides,
  };
}

describe("the baseline is the subject's own pace", () => {
  it("reads a daily subject inside its envelope as strong", () => {
    const reading = classifyCoverage(signals({ eventTimes: cadence(24, 7, 6) }));
    expect(reading.baselineHours).toBe(24);
    expect(reading.classification).toBe("strong");
    expect(discoveryAppetite(reading)).toBe("off");
  });

  it("reads a weekly subject as strong", () => {
    const reading = classifyCoverage(signals({ eventTimes: cadence(168, 6, 40) }));
    expect(reading.baselineHours).toBe(168);
    expect(reading.classification).toBe("strong");
  });

  it("reads a fortnightly subject as strong, which is the whole point", () => {
    // Twelve days since the last event, and the subject moves every two weeks.
    // A fixed 24-hour window calls this uncovered and spends a search budget on a
    // subject that is producing exactly what it should.
    const reading = classifyCoverage(signals({ eventTimes: cadence(336, 5, 288) }));
    expect(reading.baselineHours).toBe(336);
    expect(reading.gapHours).toBe(288);
    expect(reading.classification).toBe("strong");
    expect(
      reading.reasons.some((reason) => reason.includes("usually") || reason.includes("usual")),
    ).toBe(true);
  });

  it("caps the window at the ceiling for a monthly-ish subject", () => {
    // Moves every ten days, silent for over a month: three times its pace is more
    // than a month, and the ceiling is what stops a noisy median buying itself
    // months of silence.
    const times = cadence(240, 5, 800);
    const reading = classifyCoverage(signals({ eventTimes: times }));
    expect(reading.baselineHours).toBe(240);
    expect(reading.staleAfterHours).toBe(STALE_CEILING_DAYS * 24);
    expect(reading.classification).toBe("stale");
  });

  it("never sets a window tighter than the subject's own pace", () => {
    // A ninety-day subject cannot be stale for sixty of them: a reading that is
    // true most of the time is not a reading.
    const times = cadence(2_160, 5, 2_000);
    const reading = classifyCoverage(signals({ eventTimes: times }));
    expect(reading.baselineHours).toBe(2_160);
    expect(reading.staleAfterHours).toBeGreaterThanOrEqual(2_160);
    expect(reading.classification).toBe("strong");
  });

  it("never calls a subject stale inside the floor", () => {
    expect(staleAfterHours(null)).toBe(STALE_FLOOR_DAYS * 24);
    expect(staleAfterHours(1)).toBe(STALE_FLOOR_DAYS * 24);
  });

  it("needs more than a couple of observations before claiming a pace", () => {
    expect(medianIntervalHours(timesAgo(0, 24, 48))).toBeNull();
    expect(MIN_INTERVALS).toBe(3);
    expect(medianIntervalHours(timesAgo(0, 24, 48, 72))).toBe(24);
  });

  it("takes the median, so one long silence does not become the norm", () => {
    // Gaps: 24, 24, 24, 24, 720. A mean of 163 would make every later gap look
    // early; the median of 24 describes what the subject actually does.
    const times = timesAgo(0, 24, 48, 72, 96, 816);
    expect(medianIntervalHours(times)).toBe(24);
  });
});

describe("the classes are distinct states, not one number", () => {
  it("separates no coverage from low-frequency coverage", () => {
    const never = classifyCoverage(signals({ eventTimes: [] }));
    expect(never.classification).toBe("none");
    expect(never.gapHours).toBeNull();
    expect(discoveryAppetite(never)).toBe("immediate");

    const quiet = classifyCoverage(signals({ eventTimes: cadence(720, 4, 200) }));
    expect(quiet.classification).toBe("strong");
    expect(discoveryAppetite(quiet)).toBe("off");
  });

  it("calls a subject stale when it is quiet for itself", () => {
    // Daily subject, silent for three weeks: three times its pace and past the
    // floor.
    const reading = classifyCoverage(signals({ eventTimes: cadence(24, 6, 500) }));
    expect(reading.classification).toBe("stale");
    expect(discoveryAppetite(reading)).toBe("active");
  });

  it("distinguishes thin coverage from strong coverage", () => {
    // Producing on schedule, but one source is a single point of failure rather
    // than coverage.
    const reading = classifyCoverage(signals({ eventTimes: cadence(24, 6, 6), mappedSources: 1 }));
    expect(reading.classification).toBe("thin");
    expect(reading.reasons.some((reason) => reason.includes("only one source"))).toBe(true);
    // Worth a second source, not an emergency.
    expect(discoveryAppetite(reading)).toBe("backoff");
  });

  it("pauses discovery while trials are open", () => {
    const reading = classifyCoverage(signals({ eventTimes: cadence(24, 6, 6), openTrials: 1 }));
    expect(reading.classification).toBe("trial");
    expect(discoveryAppetite(reading)).toBe("paused");
  });

  it("leaves subjects nobody follows alone", () => {
    const reading = classifyCoverage(signals({ demandUsers: 0, eventTimes: [] }));
    expect(reading.classification).toBe("untracked");
    expect(discoveryAppetite(reading)).toBe("off");
  });

  it("keeps every classification reachable, so no class is dead code", () => {
    const seen = new Set([
      classifyCoverage(signals({ demandUsers: 0 })).classification,
      classifyCoverage(signals({ eventTimes: [] })).classification,
      classifyCoverage(signals({ eventTimes: cadence(24, 6, 6), openTrials: 1 })).classification,
      classifyCoverage(signals({ eventTimes: cadence(24, 6, 500) })).classification,
      classifyCoverage(signals({ eventTimes: cadence(24, 6, 6) })).classification,
      classifyCoverage(signals({ eventTimes: cadence(24, 6, 6), mappedSources: 1 })).classification,
      classifyCoverage(signals({ eventTimes: cadence(24, 6, 6), mappedSources: 0 })).classification,
    ]);
    expect([...seen].sort()).toEqual([
      "none",
      "stale",
      "strong",
      "thin",
      "trial",
      "unmapped",
      "untracked",
    ]);
  });
});

describe("a stale reading is what reopens a covered subject to discovery", () => {
  it("queues a job for a subject whose sources have gone quiet", () => {
    // The seam between the two readings: `source_topics` says something is
    // collected, the candence says nothing has arrived for far longer than this
    // subject's own pace. A feed that died quietly is still mapped, so "mapped"
    // alone is not evidence of coverage.
    const stale = classifyCoverage(signals({ eventTimes: cadence(24, 6, 500) }));
    expect(discoveryAppetite(stale)).toBe("active");
    expect(
      gapFor({
        hasSourceLink: true,
        staleCoverage: true,
        hasOpenJob: false,
        lastJobAtMs: null,
        nowMs: NOW.getTime(),
      }),
    ).toEqual({
      queue: true,
    });
  });

  it("leaves a subject inside its own pace alone, and keeps the other gates first", () => {
    expect(
      gapFor({ hasSourceLink: true, hasOpenJob: false, lastJobAtMs: null, nowMs: NOW.getTime() }),
    ).toEqual({ queue: false, reason: "covered" });

    // An in-flight job still wins, so a stale reading cannot stack up work.
    expect(
      gapFor({
        hasSourceLink: true,
        staleCoverage: true,
        hasOpenJob: true,
        lastJobAtMs: null,
        nowMs: NOW.getTime(),
      }),
    ).toEqual({ queue: false, reason: "in-flight" });

    // And the cooldown still applies.
    expect(
      gapFor({
        hasSourceLink: false,
        hasOpenJob: false,
        lastJobAtMs: NOW.getTime() - 60_000,
        nowMs: NOW.getTime(),
      }),
    ).toEqual({ queue: false, reason: "cooling-down" });
  });
});

describe("the same rule serves any subject", () => {
  /**
   * The cadences below stand in for domains this code has no vocabulary for: a
   * wire service, a sports feed, a niche scene, a transit authority. Nothing in
   * the classifier reads the subject's name or its events' content.
   */
  it("classifies every cadence without knowing what the subject is", () => {
    const cases: { what: string; periodHours: number; sinceLast: number; expect: string }[] = [
      { what: "hourly feed", periodHours: 1, sinceLast: 1, expect: "strong" },
      { what: "daily news", periodHours: 24, sinceLast: 20, expect: "strong" },
      { what: "weekly column", periodHours: 168, sinceLast: 150, expect: "strong" },
      { what: "fortnightly scene", periodHours: 336, sinceLast: 300, expect: "strong" },
      { what: "seasonal authority", periodHours: 2_160, sinceLast: 2_000, expect: "strong" },
    ];

    for (const item of cases) {
      const reading = classifyCoverage(
        signals({ eventTimes: cadence(item.periodHours, 5, item.sinceLast) }),
      );
      expect(reading.classification, item.what).toBe(item.expect);
    }
  });
});
