import { describe, expect, it } from "vitest";
import {
  ACTIVE_WORK_HORIZON_HOURS,
  CANDIDATE_EXPIRY_DAYS,
  DAILY_POLICY,
  FLASH_POLICY,
  FRESH_WINDOW_HOURS,
  LIVE_QUEUE_HOURS,
  MAX_DAILY_AGE_HOURS,
  MAX_WEEKLY_AGE_HOURS,
  SIGNIFICANT_IMPORTANCE,
  WEEKLY_POLICY,
  activeCutoff,
  ageHours,
  backlogLaneSize,
  bandFor,
  briefingScore,
  isEligible,
  isPriority,
  liveLaneSize,
  policyFor,
  rankIntoLanes,
  recencyMultiplier,
  type RankableItem,
} from "./freshness";

const NOW = new Date("2026-09-08T06:00:00Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function item(
  relevance: number,
  ageHrs: number,
  opts: { importance?: number; novelty?: number } = {},
): RankableItem {
  return {
    relevance,
    importance: opts.importance ?? 5,
    novelty: opts.novelty ?? 5,
    eventAt: hoursAgo(ageHrs),
  };
}

describe("the bands", () => {
  it("gives a daily briefing 24h primary, 48h allowed, 72h ceiling", () => {
    expect(bandFor(item(1, 2), NOW, DAILY_POLICY)).toBe("primary");
    expect(bandFor(item(1, 24), NOW, DAILY_POLICY)).toBe("primary");
    expect(bandFor(item(1, 36), NOW, DAILY_POLICY)).toBe("allowed");
    expect(bandFor(item(1, 48), NOW, DAILY_POLICY)).toBe("allowed");
    expect(bandFor(item(1, 60), NOW, DAILY_POLICY)).toBe("exceptional");
    expect(bandFor(item(1, 72), NOW, DAILY_POLICY)).toBe("exceptional");
    expect(bandFor(item(1, 73), NOW, DAILY_POLICY)).toBe("expired");
  });

  it("prefers 12h for a flash alert and refuses anything over a day", () => {
    expect(bandFor(item(1, 6), NOW, FLASH_POLICY)).toBe("primary");
    expect(bandFor(item(1, 12), NOW, FLASH_POLICY)).toBe("primary");
    expect(bandFor(item(1, 18), NOW, FLASH_POLICY)).toBe("allowed");
    expect(bandFor(item(1, 30), NOW, FLASH_POLICY)).toBe("expired");
  });

  it("leaves a weekly reader no exceptional band at all", () => {
    // Everything since their last send IS their briefing — a six-day-old story
    // is the news of their week, not stale material padding a quiet day.
    expect(WEEKLY_POLICY.allowedHours).toBe(WEEKLY_POLICY.maxHours);
    expect(bandFor(item(1, 6 * 24), NOW, WEEKLY_POLICY)).toBe("allowed");
    expect(isEligible(item(1, 6 * 24, { importance: 1 }), NOW, WEEKLY_POLICY)).toBe(true);
    expect(bandFor(item(1, 9 * 24), NOW, WEEKLY_POLICY)).toBe("expired");
  });

  it("hands each cadence its own policy", () => {
    expect(policyFor("daily")).toBe(DAILY_POLICY);
    expect(policyFor("weekly")).toBe(WEEKLY_POLICY);
  });
});

describe("a quiet day produces a short briefing, not a padded one", () => {
  it("refuses an ordinary story in the 48-72h backstop band", () => {
    // The band exists, but for the daily cadence it is a quiet-day backstop, not
    // a normal third band. An ordinary story at 60 hours is therefore refused when
    // the thin-day gate is on.
    const ordinary = item(3, 60, { importance: 5 });
    expect(bandFor(ordinary, NOW, DAILY_POLICY)).toBe("exceptional");
    expect(isEligible(ordinary, NOW, DAILY_POLICY, true, 6)).toBe(false);
  });

  it("still admits a significant story into the backstop band on a thin day", () => {
    // The backstop is for exactly this: a quiet day with room to spare, and a
    // story that is still worth knowing even though it is past the fresh window.
    const major = item(3, 60, { importance: SIGNIFICANT_IMPORTANCE });
    expect(isEligible(major, NOW, DAILY_POLICY, true, 6)).toBe(true);
  });

  it("refuses a significant story past the daily ceiling entirely", () => {
    // Significance does not extend the daily window. A major story at 73 hours is
    // out, even when the day is thin.
    const major = item(3, 73, { importance: SIGNIFICANT_IMPORTANCE });
    expect(isEligible(major, NOW, DAILY_POLICY, true, 6)).toBe(false);
    expect(isPriority(major, NOW, DAILY_POLICY)).toBe(false);
  });

  it("returns fourteen rather than stuffing thirty with stale material", () => {
    // Fourteen items worth sending, and a hundred ordinary ones just past the
    // daily ceiling that a cap-filling ranker would have reached for. The
    // backstop is significance- and thin-day-gated, so this is not a real
    // competition with stale material.
    const worthSending = Array.from({ length: 14 }, (_, i) => item(2 + i / 100, 3));
    const stale = Array.from({ length: 100 }, () => item(9, 60, { importance: 5 }));

    const { priority, backfill } = rankIntoLanes(
      [...worthSending, ...stale],
      NOW,
      DAILY_POLICY,
      true,
      6,
    );
    expect(priority).toHaveLength(14);
    expect(backfill).toHaveLength(0);
    expect([...priority, ...backfill].slice(0, 30)).toHaveLength(14);
  });

  it("still uses the 24-48h band as ordinary material", () => {
    // "Allowed" means allowed. A day-and-a-half-old story a reader has not seen
    // is news to them, and it may fill a briefing without being significant.
    const yesterday = item(2, 36, { importance: 3 });
    expect(isEligible(yesterday, NOW, DAILY_POLICY)).toBe(true);
    expect(isPriority(yesterday, NOW, DAILY_POLICY)).toBe(false);

    const { priority, backfill } = rankIntoLanes([item(2, 2), yesterday], NOW, DAILY_POLICY);
    expect(priority).toHaveLength(1);
    expect(backfill).toEqual([yesterday]);
  });
});

describe("ranking", () => {
  it("puts today ahead of a slightly more relevant story from yesterday", () => {
    const stale = item(2.4, 40);
    const fresh = item(2, 2);
    expect(briefingScore(fresh, NOW, DAILY_POLICY)).toBeGreaterThan(
      briefingScore(stale, NOW, DAILY_POLICY),
    );
  });

  it("puts today ahead of a far more relevant story from last week", () => {
    // The exact shape of the 2026-09-08 incident. The decay ALONE does not
    // achieve this — 9 x 0.4 beats 3 x 1.0 — which is why the bands exist and
    // why this is not merely a sort.
    const stale = item(9, 14 * 24);
    const fresh = item(3, 2);
    const { priority, backfill } = rankIntoLanes([stale, fresh], NOW, DAILY_POLICY);
    expect([...priority, ...backfill]).toEqual([fresh]);
  });

  it("scores an ineligible item below every eligible one", () => {
    // `briefingScore` is exported, so it has to be safe on its own rather than
    // only safe when reached through `rankIntoLanes`.
    expect(briefingScore(item(10, 30 * 24), NOW, DAILY_POLICY)).toBeLessThan(
      briefingScore(item(0.1, 1), NOW, DAILY_POLICY),
    );
  });

  it("keeps significance a tie-break, not an override of the reader's interests", () => {
    // A reader who follows motorsport does not want an important election above
    // their race. Importance may reorder comparable stories; it may not
    // overturn a real relevance gap.
    const theirs = item(3, 2, { importance: 2 });
    const important = item(1, 2, { importance: 10 });
    expect(briefingScore(theirs, NOW, DAILY_POLICY)).toBeGreaterThan(
      briefingScore(important, NOW, DAILY_POLICY),
    );
  });

  it("breaks a tie on age, not on insertion order", () => {
    const older = item(2, 20);
    const newer = item(2, 1);
    expect(rankIntoLanes([older, newer], NOW, DAILY_POLICY).priority[0]).toBe(newer);
  });

  it("never lets a backlog occupy a slot a fresh story wanted", () => {
    const stale = Array.from({ length: 40 }, () => item(9, 40));
    const fresh = [item(1, 1), item(1.2, 2), item(1.1, 3)];
    const { priority, backfill } = rankIntoLanes([...stale, ...fresh], NOW, DAILY_POLICY);
    expect(priority).toHaveLength(3);
    expect(backfill).toHaveLength(40);
    expect([...priority, ...backfill].slice(0, 3)).toEqual(expect.arrayContaining(fresh));
  });

  it("treats an undateable event as not current, whatever its importance", () => {
    const undated: RankableItem = { relevance: 9, importance: 10, novelty: 10, eventAt: null };
    expect(bandFor(undated, NOW, DAILY_POLICY)).toBe("expired");
    expect(isEligible(undated, NOW, DAILY_POLICY)).toBe(false);
  });
});

describe("recencyMultiplier", () => {
  it("does not penalise anything inside the primary band", () => {
    expect(recencyMultiplier(0, DAILY_POLICY)).toBe(1);
    expect(recencyMultiplier(FRESH_WINDOW_HOURS, DAILY_POLICY)).toBe(1);
  });

  it("decays monotonically from the band to the ceiling", () => {
    const at25 = recencyMultiplier(25, DAILY_POLICY);
    const at36 = recencyMultiplier(36, DAILY_POLICY);
    const at48 = recencyMultiplier(48, DAILY_POLICY);
    expect(at25).toBeLessThan(1);
    expect(at36).toBeLessThan(at25);
    expect(at48).toBeLessThan(at36);
    expect(at48).toBeGreaterThan(0);
  });

  it("survives a policy whose ceiling sits inside its own primary band", () => {
    const nonsense = { primaryHours: 40, allowedHours: 12, maxHours: 12 };
    expect(Number.isFinite(recencyMultiplier(20, nonsense))).toBe(true);
  });
});

describe("ageHours", () => {
  it("treats an undateable event as infinitely old rather than brand new", () => {
    expect(ageHours(null, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(ageHours("not a date", NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("floors at zero, so a clock skew cannot buy a boost", () => {
    expect(ageHours(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW)).toBe(0);
  });
});

describe("queue lanes", () => {
  it("reserves most of a batch for live news and the rest for history", () => {
    expect(liveLaneSize(6)).toBe(5);
    expect(backlogLaneSize(6)).toBe(1);
    expect(liveLaneSize(200)).toBe(166);
    expect(backlogLaneSize(200)).toBe(34);
  });

  it("always leaves at least one live slot, so a backlog can never take the batch", () => {
    for (const limit of [2, 3, 4, 5, 6, 12, 50]) {
      expect(liveLaneSize(limit)).toBeGreaterThanOrEqual(1);
    }
  });

  it("always leaves at least one backlog slot, so history is never stranded", () => {
    for (const limit of [6, 12, 50, 200]) {
      expect(backlogLaneSize(limit)).toBeGreaterThanOrEqual(1);
    }
  });

  it("degrades sanely at the edges rather than returning a negative width", () => {
    expect(liveLaneSize(1)).toBe(1);
    expect(backlogLaneSize(1)).toBe(0);
    expect(liveLaneSize(0)).toBe(0);
    expect(backlogLaneSize(0)).toBe(0);
  });

  it("uses the daily hard ceiling as the active worker horizon", () => {
    expect(LIVE_QUEUE_HOURS).toBe(ACTIVE_WORK_HORIZON_HOURS);
    expect(LIVE_QUEUE_HOURS).toBe(MAX_DAILY_AGE_HOURS);
    expect(activeCutoff(NOW).toISOString()).toBe("2026-09-05T06:00:00.000Z");
  });

  it("keeps lane helpers safe for bounded callers", () => {
    expect(liveLaneSize(6)).toBe(5);
    expect(backlogLaneSize(6)).toBe(1);
  });
});

describe("active work horizon", () => {
  it.each([1, 24, 48])("keeps %dh-old work active", (hours) => {
    expect(activeCutoff(NOW).getTime()).toBeLessThanOrEqual(new Date(hoursAgo(hours)).getTime());
  });

  it("rejects work older than the configured horizon", () => {
    expect(new Date(hoursAgo(73)).getTime()).toBeLessThan(activeCutoff(NOW).getTime());
  });
});

describe("candidate expiry", () => {
  it("outlives the widest briefing window, so expiry never removes a briefable row", () => {
    expect(CANDIDATE_EXPIRY_DAYS * 24).toBeGreaterThan(MAX_WEEKLY_AGE_HOURS);
  });
});
