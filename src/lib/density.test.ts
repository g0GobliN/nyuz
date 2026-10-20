import { describe, expect, it } from "vitest";

import { LEVELS, bandSpans, capFor, thresholdFor } from "./density";

/**
 * The dial's labels used to be two hardcoded words under the track while the readout above it named the
 * band the reader was actually in — three labels from two vocabularies, and no way to see where a band began
 * or ended. `bandSpans` is the rule that fixes it, and it is pure, so it is pinned here rather than left to a
 * rendered component to prove.
 */
describe("bandSpans", () => {
  it("gives each band the width of the track it governs", () => {
    // 0-20, 20-45, 45-70, 70-100.
    expect(bandSpans().map((band) => band.share)).toEqual([20, 25, 25, 30]);
  });

  it("sums to the whole track even though the last band's max is 101", () => {
    // `density < max` has to catch 100, so `deep.max` is 101 — which would otherwise make the shares add up
    // to 101 and push the last label past the end of the slider.
    expect(bandSpans().reduce((sum, band) => sum + band.share, 0)).toBe(100);
    expect(LEVELS.at(-1)?.max).toBe(101);
  });

  it("aligns the ends outward and the middles centrally", () => {
    expect(bandSpans().map((band) => band.align)).toEqual(["left", "center", "center", "right"]);
  });

  it("labels every band, in the order the slider traverses them", () => {
    expect(bandSpans().map((band) => band.label)).toEqual(LEVELS.map((level) => level.label));
    expect(bandSpans().map((band) => band.label)).toEqual(["Minimal", "Focused", "Broad", "Deep"]);
  });
});

/**
 * The two numbers a reader is shown beside the label — the threshold that decides what reaches them, and the
 * ceiling their plan puts on it — must come from the same bands, or the dial promises something the query
 * does not keep.
 */
describe("the dial's numbers", () => {
  it("tightens the threshold as the dial moves towards Minimal", () => {
    expect(thresholdFor(0)).toBe(6);
    expect(thresholdFor(35)).toBe(3);
    expect(thresholdFor(60)).toBe(1);
    expect(thresholdFor(80)).toBe(0);
  });

  it("never shows a count above the reader's plan ceiling", () => {
    for (const value of [0, 20, 45, 70, 100]) {
      expect(capFor(value, "uno")).toBeLessThanOrEqual(5);
      expect(capFor(value, "omni")).toBeLessThanOrEqual(25);
    }
  });
});
