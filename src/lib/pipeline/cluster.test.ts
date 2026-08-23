import { describe, expect, it } from "vitest";
import { readVerdict } from "./cluster";
import type { Candidate } from "./shortlist";

/**
 * What the model says, and what is done with it.
 *
 * Everything else in `cluster.ts` is a conversation with Postgres and is verified
 * against the real database instead. `readVerdict` is the exception, and it is the
 * one worth pinning here, because it is the only place in the stage where being
 * wrong corrupts data rather than failing: a mishandled index merges two articles
 * that are about different events, and a merged event misinforms every reader who
 * receives it. There is no error message for that and no way to notice it later.
 *
 * The rule these tests encode is that anything unrecognised means "no match". That
 * direction is deliberate. A wrongly split event costs one extra summary; a wrongly
 * merged one is a lie told to a reader.
 */

const candidates: Candidate[] = [
  { id: "a", title: "First", event_id: null, published_at: null },
  { id: "b", title: "Second", event_id: "e1", published_at: null },
  { id: "c", title: "Third", event_id: null, published_at: null },
];

const ids = (matched: Candidate[]): string[] => matched.map((c) => c.id);

describe("readVerdict", () => {
  it("resolves one-based indices to candidates", () => {
    expect(ids(readVerdict({ same: [1, 3] }, candidates))).toEqual(["a", "c"]);
  });

  it("reads an empty answer as no match", () => {
    expect(readVerdict({ same: [] }, candidates)).toEqual([]);
  });

  it("drops an index past the end of the list", () => {
    // The dangerous one. `candidates[10]` is `undefined`, and an undefined
    // candidate carried forward would either crash the run or, worse, be spread
    // into an event row as a missing id.
    expect(readVerdict({ same: [11, 2] }, candidates).map((c) => c.id)).toEqual(["b"]);
    expect(readVerdict({ same: [4] }, candidates)).toEqual([]);
  });

  it("rejects zero and negatives rather than counting from the end", () => {
    // `candidates[-1]` is undefined in JS, not the last element, but a reader of
    // this code should not have to know that to trust it.
    expect(readVerdict({ same: [0] }, candidates)).toEqual([]);
    expect(readVerdict({ same: [-1] }, candidates)).toEqual([]);
  });

  it("accepts numbers written as strings", () => {
    // Worth tolerating: it is a formatting slip by a model that got the judgement
    // right, and the alternative is paying for the reasoning again.
    expect(ids(readVerdict({ same: ["1", "2"] }, candidates))).toEqual(["a", "b"]);
  });

  it("ignores fractions and unparseable entries", () => {
    expect(readVerdict({ same: [1.5, "two", null, {}, true] }, candidates)).toEqual([]);
  });

  it("de-duplicates a repeated index", () => {
    // A repeat would otherwise put the same article id in the `in.(…)` list twice.
    expect(ids(readVerdict({ same: [2, 2, 2] }, candidates))).toEqual(["b"]);
  });

  it("reads a non-array answer as no match instead of throwing", () => {
    // Real shapes a model reaches for when it ignores the format: a bare number,
    // prose, an object keyed by index, the key missing entirely.
    expect(readVerdict({ same: 1 }, candidates)).toEqual([]);
    expect(readVerdict({ same: "none of them" }, candidates)).toEqual([]);
    expect(readVerdict({ same: { 1: true } }, candidates)).toEqual([]);
    expect(readVerdict({}, candidates)).toEqual([]);
  });

  it("returns nothing when there were no candidates", () => {
    expect(readVerdict({ same: [1] }, [])).toEqual([]);
  });

  it("preserves the order the model gave, not the shortlist order", () => {
    // Load-bearing indirectly: the first matched candidate that already has an
    // event is the one attached to, so a reordering here would change which event
    // an article joins when two of its matches are already clustered.
    expect(ids(readVerdict({ same: [3, 1] }, candidates))).toEqual(["c", "a"]);
  });
});
