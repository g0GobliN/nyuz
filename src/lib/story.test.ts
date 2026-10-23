import { describe, expect, it } from "vitest";
import { asPercent, clockOf, importanceBand, sourceCount } from "./story";

/**
 * `sourceCount` is the reason this file exists.
 *
 * Every single-source story in the 2026-09-30 briefing rendered "Based on 1
 * sources" twenty-five times over, because each of four call sites decided the
 * plural for itself and they disagreed. The helper is the fix; without a test
 * the next call site can decide for itself again. The other three helpers are
 * here because they are the same shape of shared decision — a band, a
 * percentage and a clock, each rendered on more than one screen.
 */

describe("sourceCount", () => {
  it("does not print '1 sources'", () => {
    expect(sourceCount(1)).toBe("1 source");
  });

  it("pluralises above one", () => {
    expect(sourceCount(2)).toBe("2 sources");
    expect(sourceCount(25)).toBe("25 sources");
  });

  it("treats zero as plural, which is what English does", () => {
    // A story with no attached sources is still a real state while an event is
    // being assembled, and "0 source" reads as a bug.
    expect(sourceCount(0)).toBe("0 sources");
  });
});

describe("importanceBand", () => {
  it("maps the shared 0-10 score onto the three printed bands", () => {
    expect(importanceBand(10)).toBe("High");
    expect(importanceBand(6)).toBe("High");
    expect(importanceBand(5.9)).toBe("Medium");
    expect(importanceBand(3)).toBe("Medium");
    expect(importanceBand(2.9)).toBe("Low");
    expect(importanceBand(0)).toBe("Low");
  });

  it("never returns the mixed-register band the audit rejected — the three bands can be ordered by reading them", () => {
    // H-05 (reader clarity audit 2026-10-22): the bottom band was "Notable" —
    // a compliment at the bottom — so 14 of 25 cards carried a word that
    // could not be put in order with High and Medium. The ruling is one
    // band scale in one register: Low / Medium / High over the same 0-10
    // score S9 fixed. The legacy "Notable" member stays in the Story type
    // only so stored fixtures and older call sites keep compiling; no band
    // a reader is handed can be "Notable" now.
    for (const score of [0, 1, 2, 2.9, 3.5, 9]) {
      expect(["High", "Medium", "Low"]).toContain(importanceBand(score));
    }
    expect(importanceBand(2.99)).toBe("Low");
    expect(importanceBand(2.01)).toBe("Low");
  });
});

describe("asPercent", () => {
  it("scales a 0-10 score to the 0-100 the bars were drawn for", () => {
    expect(asPercent(5)).toBe(50);
    expect(asPercent(0)).toBe(0);
    expect(asPercent(10)).toBe(100);
  });

  it("clamps rather than overflowing the bar", () => {
    // Relevance is unbounded on purpose, so this is reachable.
    expect(asPercent(14)).toBe(100);
    expect(asPercent(-3)).toBe(0);
  });
});

describe("clockOf", () => {
  it("prints UTC hours and minutes, zero-padded", () => {
    expect(clockOf("2026-10-01T06:12:00Z")).toBe("06:12");
    expect(clockOf("2026-10-01T00:05:00Z")).toBe("00:05");
  });

  it("returns nothing for an unparseable timestamp rather than 'NaN:NaN'", () => {
    expect(clockOf("not a date")).toBe("");
  });
});
