import { describe, expect, it } from "vitest";
import { BASE_WEIGHT, signalStrength, weightForNet, weightsFromSignals } from "./feedback-weights";

/**
 * Two properties matter more than any individual number here.
 *
 * Idempotence: a weight is a function of the signals that exist, so replaying
 * them in any order lands on the same value. That is what makes un-voting work.
 *
 * And the skip asymmetry: a story that was shown and not opened must move a
 * topic far less than one that was opened and read, because in a briefing a skip
 * frequently means the summary was sufficient rather than unwanted.
 */

describe("signalStrength", () => {
  it("knows nothing from a single unopened impression", () => {
    expect(signalStrength({ eventId: "e", impressions: 1 })).toBe(0);
  });

  it("counts a skip only after several impressions", () => {
    expect(signalStrength({ eventId: "e", impressions: 2 })).toBe(0);
    expect(signalStrength({ eventId: "e", impressions: 5 })).toBeLessThan(0);
  });

  it("rates a story read to the end above one merely opened", () => {
    const read = signalStrength({ eventId: "e", openCount: 1, reachedEnd: true });
    const opened = signalStrength({ eventId: "e", openCount: 1 });
    expect(read).toBeGreaterThan(opened);
  });

  it("treats long dwell as having read it, without needing the scroll", () => {
    const long = signalStrength({ eventId: "e", openCount: 1, readMs: 60_000 });
    const scrolled = signalStrength({ eventId: "e", openCount: 1, reachedEnd: true });
    expect(long).toBe(scrolled);
  });

  it("reads an instant exit as a bounce", () => {
    expect(signalStrength({ eventId: "e", openCount: 1, readMs: 900 })).toBeLessThan(0);
  });

  it("does not call a missing duration a bounce", () => {
    // The flush can fail. An open with no recorded time is still an open.
    expect(signalStrength({ eventId: "e", openCount: 1, readMs: 0 })).toBeGreaterThan(0);
  });

  it("lets an explicit vote override the behaviour it contradicts", () => {
    const bouncedButLiked = signalStrength({
      eventId: "e",
      vote: "useful",
      openCount: 1,
      readMs: 300,
    });
    expect(bouncedButLiked).toBeGreaterThan(0);

    const readButDisliked = signalStrength({
      eventId: "e",
      vote: "not_useful",
      openCount: 1,
      reachedEnd: true,
      readMs: 120_000,
    });
    expect(readButDisliked).toBeLessThan(0);
  });

  it("treats not-interested as the stronger negative", () => {
    const bored = signalStrength({ eventId: "e", vote: "not_interested" });
    const unhelpful = signalStrength({ eventId: "e", vote: "not_useful" });
    expect(bored).toBeLessThan(unhelpful);
  });

  it("weighs a skip far below an explicit rejection", () => {
    const skipped = Math.abs(signalStrength({ eventId: "e", impressions: 10 }));
    const rejected = Math.abs(signalStrength({ eventId: "e", vote: "not_useful" }));
    expect(skipped * 4).toBeLessThan(rejected);
  });
});

describe("weightForNet", () => {
  it("leaves an untouched topic at exactly the base weight", () => {
    expect(weightForNet(0)).toBe(BASE_WEIGHT);
  });

  it("never reaches zero, so inference cannot delete a chosen topic", () => {
    expect(weightForNet(-1000)).toBeGreaterThan(0);
  });

  it("is bounded above, so one topic cannot crowd out the rest", () => {
    expect(weightForNet(1000)).toBeLessThanOrEqual(3);
  });
});

describe("weightsFromSignals", () => {
  const topics = new Map([
    ["event-a", ["ai", "chips"]],
    ["event-b", ["ai"]],
    ["event-c", ["sports"]],
  ]);

  it("moves every topic a story carries", () => {
    const weights = weightsFromSignals(
      [{ eventId: "event-a", openCount: 1, reachedEnd: true }],
      topics,
    );
    expect(weights.get("ai")).toBeGreaterThan(BASE_WEIGHT);
    expect(weights.get("chips")).toBeGreaterThan(BASE_WEIGHT);
  });

  it("leaves an untouched topic absent rather than at a default", () => {
    const weights = weightsFromSignals([{ eventId: "event-a", openCount: 1 }], topics);
    expect(weights.has("sports")).toBe(false);
  });

  it("accumulates across stories sharing a topic", () => {
    const once = weightsFromSignals([{ eventId: "event-a", vote: "useful" }], topics);
    const twice = weightsFromSignals(
      [
        { eventId: "event-a", vote: "useful" },
        { eventId: "event-b", vote: "useful" },
      ],
      topics,
    );
    expect(twice.get("ai")!).toBeGreaterThan(once.get("ai")!);
    // event-b does not carry chips, so the second signal must not move it.
    expect(twice.get("chips")).toBe(once.get("chips"));
  });

  it("gives the same answer whatever order signals arrive in", () => {
    const forwards = weightsFromSignals(
      [
        { eventId: "event-a", vote: "useful" },
        { eventId: "event-b", impressions: 9 },
      ],
      topics,
    );
    const backwards = weightsFromSignals(
      [
        { eventId: "event-b", impressions: 9 },
        { eventId: "event-a", vote: "useful" },
      ],
      topics,
    );
    expect([...forwards]).toEqual([...backwards]);
  });

  it("lands a seen-but-neutral topic on base, not absent", () => {
    // One impression is not enough to mean anything, but the topic is known.
    const weights = weightsFromSignals([{ eventId: "event-c", impressions: 1 }], topics);
    expect(weights.get("sports")).toBe(BASE_WEIGHT);
  });

  it("ignores a story with no topics attached", () => {
    const weights = weightsFromSignals([{ eventId: "unknown", vote: "useful" }], topics);
    expect(weights.size).toBe(0);
  });

  it("cannot demote a topic to the floor on skips alone", () => {
    const skipped = Array.from({ length: 40 }, () => ({
      eventId: "event-b",
      impressions: 10,
    }));
    const weights = weightsFromSignals(skipped, topics);
    // Forty ignored stories is a real signal, but it must stay recoverable —
    // one good story should be able to pull it back.
    expect(weights.get("ai")!).toBeGreaterThan(0.25);
  });
});
