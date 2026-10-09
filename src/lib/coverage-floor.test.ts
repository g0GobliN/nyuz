import { describe, expect, it } from "vitest";
import { floorUnder, RECORD_HEADROOM } from "../../scripts/lib/floor.mjs";

/**
 * The rule that turns a coverage measurement into a floor.
 *
 * It exists because the runner does not measure one commit identically twice:
 * on 2026-10-09 the same tree reported 8899 branch ranges and then 8897, which
 * failed a floor that had been recorded exactly from the first run. The test
 * pins the two properties that make the number safe to record — headroom under
 * the measurement, and never a step down.
 */
describe("the recorded coverage floor", () => {
  it("sits a headroom under what was measured", () => {
    expect(floorUnder(42.91, undefined)).toBe(42.86);
    expect(floorUnder(100, undefined)).toBe(100 - RECORD_HEADROOM);
  });

  it("rounds to the two decimals the summary reports", () => {
    expect(floorUnder(80.086, undefined)).toBe(80.04);
    expect(floorUnder(12.345, undefined)).toBe(12.3);
  });

  it("never records below the floor already committed", () => {
    // The measurement dropped into the noise: the floor holds where it was.
    expect(floorUnder(80.07, 80.08)).toBe(80.08);
    expect(floorUnder(10, 20)).toBe(20);
    // A measurement well above it still records, with its own headroom.
    expect(floorUnder(30, 20)).toBe(29.95);
  });

  it("keeps the headroom narrower than the smallest real regression", () => {
    // Removing a test file or adding an untested module moves a group by half a
    // point; the widest drift seen between two runner runs of one tree was
    // 0.02pp. The headroom has to sit between those two numbers.
    expect(RECORD_HEADROOM).toBeGreaterThanOrEqual(0.04);
    expect(RECORD_HEADROOM).toBeLessThan(0.5);
  });
});
