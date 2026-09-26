import { describe, expect, it } from "vitest";
import {
  MIN_INTERVALS,
  MIN_OBSERVATIONS,
  STALE_FLOOR_DAYS,
  classifyCoverage,
  discoveryAppetite,
  medianIntervalHours,
} from "./cadence";
import { COOLDOWN_HOURS, enqueueDiscoveryForTopics, gapFor } from "./coverage";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * The cadence reading, wired into the stage that queues discovery.
 *
 * `cadence.test.ts` proves the classifier. These run `enqueueDiscoveryForTopics`
 * -- the function the cron tick and the preferences save both call -- against a
 * database holding each coverage state, and assert what it queues. The property
 * the audit asked for is the first case: a subject with no mapped source is a
 * discovery gap, and wiring the cadence must never turn that into "back off".
 */

const NOW = new Date("2026-09-26T12:00:00Z");
const HOUR = 3_600_000;
const TOPIC = "99999999-9999-4999-8999-999999999999";

type Coverage = {
  followers?: number;
  /** Hours ago of each relevant event, most recent first. */
  eventsHoursAgo?: number[];
  sources?: number;
  trials?: number;
  lastJobHoursAgo?: number;
};

function db(coverage: Coverage): FakeDb {
  const fake = new FakeDb({
    feature_flags: [{ key: "source_discovery_enabled", enabled: true }],
    user_topics: Array.from({ length: coverage.followers ?? 1 }, (_, i) => ({
      user_id: `reader-${i}`,
      topic_id: TOPIC,
      muted: false,
    })),
    source_topics: Array.from({ length: coverage.sources ?? 0 }, (_, i) => ({
      source_id: `source-${i}`,
      topic_id: TOPIC,
    })),
    source_candidates: Array.from({ length: coverage.trials ?? 0 }, (_, i) => ({
      id: `candidate-${i}`,
      first_topic_id: TOPIC,
      status: "discovered",
    })),
    discovery_jobs:
      coverage.lastJobHoursAgo === undefined
        ? []
        : [
            {
              topic_id: TOPIC,
              status: "succeeded",
              created_at: new Date(NOW.getTime() - coverage.lastJobHoursAgo * HOUR).toISOString(),
            },
          ],
  });
  fake.rpcs["subject_history"] = () =>
    (coverage.eventsHoursAgo ?? []).map((hours, i) => ({
      topic_id: TOPIC,
      event_id: `event-${i}`,
      title: "",
      what_happened: "",
      first_seen_at: new Date(NOW.getTime() - hours * HOUR).toISOString(),
    }));
  return fake;
}

/** A subject observed every `period` hours, the last one `since` hours ago. */
function pace(period: number, count: number, since: number): number[] {
  return Array.from({ length: count }, (_, i) => since + i * period);
}

async function enqueue(coverage: Coverage) {
  const fake = db(coverage);
  const result = await enqueueDiscoveryForTopics(asDb(fake), [{ id: TOPIC, label: "Subject" }], {
    now: NOW,
  });
  const queued = fake.rows("discovery_jobs").filter((job: Row) => job["status"] === "pending");
  return { result, queued: queued.length };
}

describe("discovery acts on the cadence reading, through the production loader", () => {
  it("1. no source: queues discovery, even though the subject is producing", async () => {
    // Events arrive through other subjects' feeds, on a daily pace -- and
    // nothing is collected for it. The old cadence called this "thin" and backed
    // off; it is the gap discovery exists for.
    const { queued } = await enqueue({ sources: 0, eventsHoursAgo: pace(24, 6, 6) });
    expect(queued).toBe(1);
  });

  it("2. active trial: waits for the candidates already being tried", async () => {
    const { queued, result } = await enqueue({ sources: 0, trials: 2, eventsHoursAgo: [] });
    expect(queued).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("3. stale source: reopens a mapped subject that has gone quiet for itself", async () => {
    const { queued } = await enqueue({ sources: 2, eventsHoursAgo: pace(24, 6, 500) });
    expect(queued).toBe(1);
  });

  it("4. healthy mapped source: leaves a subject on its own pace alone", async () => {
    const { queued } = await enqueue({ sources: 2, eventsHoursAgo: pace(24, 6, 6) });
    expect(queued).toBe(0);
  });

  it("5. thin source: looks for a second source, once per its own stale window", async () => {
    // Never tried: go.
    expect((await enqueue({ sources: 1, eventsHoursAgo: pace(24, 6, 6) })).queued).toBe(1);
    // Tried three days ago: a daily subject's window is the seven-day floor, so
    // not yet -- where the stage's own one-day cooldown would already say yes.
    const recent = await enqueue({
      sources: 1,
      eventsHoursAgo: pace(24, 6, 6),
      lastJobHoursAgo: 72,
    });
    expect(recent.queued).toBe(0);
    expect(72).toBeGreaterThan(COOLDOWN_HOURS);
    // Tried eight days ago: past its window.
    const later = await enqueue({
      sources: 1,
      eventsHoursAgo: pace(24, 6, 6),
      lastJobHoursAgo: STALE_FLOOR_DAYS * 24 + 24,
    });
    expect(later.queued).toBe(1);
  });

  it("6. fortnightly subject: strong on its own pace, however long since the last event", async () => {
    // Twelve days quiet, which a fixed window would call uncovered.
    expect((await enqueue({ sources: 2, eventsHoursAgo: pace(336, 5, 288) })).queued).toBe(0);
    // The same subject on one source is thin, and its backoff is its own pace:
    // a job twenty days ago is still inside a fortnightly subject's window.
    expect(
      (await enqueue({ sources: 1, eventsHoursAgo: pace(336, 5, 288), lastJobHoursAgo: 20 * 24 }))
        .queued,
    ).toBe(0);
  });

  it("7. discovery gap: followed, nothing ever arrived, nothing mapped -- immediately", async () => {
    expect((await enqueue({ sources: 0, eventsHoursAgo: [] })).queued).toBe(1);
  });

  it("does nothing for a subject nobody follows any more", async () => {
    const { queued, result } = await enqueue({ followers: 0, sources: 0, eventsHoursAgo: [] });
    expect(queued).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("falls back to the shipped mapped-source rule when the reading cannot be built", async () => {
    const fake = db({ sources: 0 });
    fake.rpcs["subject_history"] = () => new Error("function does not exist");
    await enqueueDiscoveryForTopics(asDb(fake), [{ id: TOPIC, label: "Subject" }], { now: NOW });
    expect(fake.rows("discovery_jobs")).toHaveLength(1);

    const mapped = db({ sources: 1 });
    mapped.rpcs["subject_history"] = () => new Error("function does not exist");
    await enqueueDiscoveryForTopics(asDb(mapped), [{ id: TOPIC, label: "Subject" }], { now: NOW });
    expect(mapped.rows("discovery_jobs")).toHaveLength(0);
  });
});

describe("no mapped source is never a reason to back off", () => {
  it("classifies every no-source reading as a gap", () => {
    const base = { demandUsers: 1, mappedSources: 0, openTrials: 0, now: NOW };
    const times = (hours: number[]) =>
      hours.map((h) => new Date(NOW.getTime() - h * HOUR).toISOString());
    for (const eventTimes of [
      [],
      times(pace(24, 6, 6)),
      times(pace(24, 6, 500)),
      times(pace(336, 5, 288)),
    ]) {
      const reading = classifyCoverage({ ...base, eventTimes });
      expect(["none", "unmapped", "stale"]).toContain(reading.classification);
      expect(["immediate", "active"]).toContain(discoveryAppetite(reading));
      expect(
        gapFor({
          hasSourceLink: false,
          reading,
          hasOpenJob: false,
          lastJobAtMs: null,
          nowMs: NOW.getTime(),
        }),
      ).toEqual({ queue: true });
    }
  });
});

describe("MIN_INTERVALS counts gaps, and needs one more observation than that", () => {
  it("names the rule and applies the same number", () => {
    expect(MIN_OBSERVATIONS).toBe(MIN_INTERVALS + 1);
    const at = (hours: number[]) =>
      hours.map((h) => new Date(NOW.getTime() - h * HOUR).toISOString());
    // MIN_INTERVALS - 1 gaps: no pace yet.
    expect(medianIntervalHours(at([0, 24, 48]))).toBeNull();
    // Exactly MIN_INTERVALS gaps, from MIN_OBSERVATIONS events: a pace.
    expect(medianIntervalHours(at([0, 24, 48, 72]))).toBe(24);
    // Duplicate timestamps are one observation, not two.
    expect(medianIntervalHours(at([0, 0, 24, 48]))).toBeNull();
  });
});
