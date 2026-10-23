import { describe, expect, it } from "vitest";
import { asPercent, clockOf, importanceBand, sourceCount, sourceRailLabel } from "./story";

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
    expect(importanceBand(2.9)).toBe("Notable");
    expect(importanceBand(0)).toBe("Notable");
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

/**
 * `sourceRailLabel` is the reader-clarity audit's I-06 (2026-10-22).
 *
 * The story rail printed "BASED ON 4 SOURCES" above nine rows from eight
 * outlets. The four came from `events.publisher_count` (a count taken when the
 * cluster wrote the event); the rows came from the event's current coverage. Two
 * different measures shared one label, so the reader could count a number the
 * page denied. The rail's rows are the only measure a reader can check, so the
 * label is read off them: it names the publishers and the reports, and says
 * nothing the reader cannot verify underneath.
 */
describe("sourceRailLabel", () => {
  const rows = (...names: string[]) => names.map((name) => ({ name }));

  it("splits publishers from reports when the delivered card-12 rail disagrees with itself", () => {
    // The audited rail, verbatim: nine rows, eight outlets (Al Jazeera twice).
    const label = sourceRailLabel(
      rows(
        "The Verge",
        "Ars Technica",
        "BBC Science",
        "Al Jazeera",
        "Al Jazeera",
        "BBC World",
        "Engadget",
        "France 24",
        "The Guardian World",
      ),
    );
    expect(label).toBe("Based on 8 publishers · 9 reports");
  });

  it("collapses an outlet that differs only by case or padding", () => {
    const label = sourceRailLabel(rows("Al Jazeera", "al jazeera", "Al Jazeera "));
    // Three reports from one publisher: the publisher count is one, so the
    // two-clause label would say "1 publishers" -- it reads as the plain count.
    expect(label).toBe("Based on 3 sources");
  });

  it("keeps the plain count when publishers and reports agree", () => {
    // "Based on 3 sources" is true by either measure, so the shape is unchanged.
    expect(sourceRailLabel(rows("The Verge", "Ars Technica", "BBC"))).toBe("Based on 3 sources");
  });

  it("says nothing the reader cannot count under the label for a single source", () => {
    expect(sourceRailLabel(rows("The Verge"))).toBe("Based on 1 source");
    expect(sourceRailLabel(rows("The Verge", "The Verge"))).toBe("Based on 2 sources");
  });
});
