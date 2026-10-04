import { describe, expect, it } from "vitest";
import {
  distinctSources,
  formatRate,
  importanceSignals,
  isResearch,
  measure,
  rate,
  withheldSignalStrength,
  type EvalRow,
} from "./evaluation-corpus";

/**
 * The properties this module has to hold, in the order they can break a report.
 *
 * 1. A rate is never reported without its denominator, and an empty
 *    denominator is not a zero.
 * 2. Importance is read from the row alone — no global state, no clock.
 * 3. A withheld story with a signal stays visible; it is not averaged away.
 * 4. A row missing evidence is `unevaluable`, not `unimportant`.
 * 5. A paper is recognised by the pipeline's own source family, not by a
 *    second definition that can drift from it.
 */

function row(overrides: Partial<EvalRow> = {}): EvalRow {
  return {
    id: "e1",
    title: "Acme ships a thing",
    what: "Acme shipped a thing on Tuesday.",
    importance: 4,
    publisherCount: 1,
    status: "complete",
    sourceNames: ["The Register"],
    sourceTimes: ["2026-10-01T09:00:00Z"],
    enriched: true,
    evidenceUnits: 6,
    materialRevision: 0,
    topics: ["hardware"],
    audience: 1,
    delivered: false,
    withheldReason: "never_matched",
    firstSeenAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

describe("rate", () => {
  it("carries its denominator, so a rate can be checked", () => {
    expect(rate(3, 12)).toEqual({ numerator: 3, denominator: 12, value: 0.25 });
  });

  it("distinguishes an empty denominator from zero", () => {
    const empty = rate(0, 0);
    expect(empty.value).toBeUndefined();
    expect(empty.value).not.toBe(0);
    expect(formatRate(empty)).toBe("— (0/0)");
  });

  it("prints a real rate with the counts behind it", () => {
    expect(formatRate(rate(7, 18))).toBe("38.9% (7/18)");
  });

  it("can print an exact rate when the caller wants no rounding", () => {
    expect(formatRate(rate(1, 4), 0)).toBe("25% (1/4)");
  });
});

describe("distinctSources", () => {
  it("counts publishers, not rows, so a reprint is not corroboration", () => {
    expect(
      distinctSources(row({ sourceNames: ["The Register", "the register", " The Register "] })),
    ).toBe(1);
  });

  it("counts genuinely different outlets", () => {
    expect(distinctSources(row({ sourceNames: ["The Register", "Phoronix"] }))).toBe(2);
  });

  it("ignores empty names rather than counting them", () => {
    expect(distinctSources(row({ sourceNames: ["", "  ", "Phoronix"] }))).toBe(1);
  });
});

describe("importanceSignals", () => {
  it("fires nothing on an ordinary single-source story", () => {
    expect(importanceSignals(row())).toEqual([]);
  });

  it("does not treat having evidence as being important", () => {
    // The measured metric defect: a vendor's annual report has evidence and no
    // claim on a briefing, so availability is reported separately, never here.
    const rich = row({ evidenceUnits: 40, enriched: true });
    expect(importanceSignals(rich)).toEqual([]);
    expect(importanceSignals(rich)).not.toContain("has_evidence");
  });

  it("counts corroboration from either the publisher count or the source names", () => {
    expect(importanceSignals(row({ publisherCount: 2 }))).toContain("corroborated");
    expect(importanceSignals(row({ sourceNames: ["The Register", "Phoronix"] }))).toContain(
      "corroborated",
    );
  });

  it("counts a wide audience", () => {
    expect(importanceSignals(row({ audience: 2 }))).toContain("audience");
  });

  it("counts the pipeline's own high-importance band", () => {
    expect(importanceSignals(row({ importance: 7 }))).toContain("high_importance");
    expect(importanceSignals(row({ importance: 6.9 }))).not.toContain("high_importance");
  });

  it("counts a story that moved after delivery", () => {
    expect(importanceSignals(row({ materialRevision: 1 }))).toContain("revised");
  });

  it("orders a withheld story by how hard each signal is to explain away", () => {
    const rich = row({ materialRevision: 2, importance: 9, audience: 3 });
    expect(withheldSignalStrength(rich)).toEqual(["revised", "audience", "high_importance"]);
  });
});

describe("isResearch", () => {
  it("recognises an arXiv source through the pipeline's own family test", () => {
    expect(isResearch(row({ sourceNames: ["arXiv cs.CR"] }))).toBe(true);
    expect(isResearch(row({ sourceNames: ["arXiv.org"] }))).toBe(true);
  });

  it("does not treat ordinary reporting as research", () => {
    expect(isResearch(row({ sourceNames: ["The Register"] }))).toBe(false);
  });
});

describe("measure", () => {
  it("separates the delivered from the withheld and gives the denominator", () => {
    const census = measure([
      row({ id: "a", delivered: true, withheldReason: "delivered" }),
      row({ id: "b" }),
      row({ id: "c" }),
      row({ id: "d" }),
    ]);
    expect(census.measured).toBe(4);
    expect(census.delivered).toBe(1);
    expect(census.withheld).toBe(3);
    expect(census.deliveryRate).toEqual({ numerator: 1, denominator: 4, value: 0.25 });
  });

  it("reports an empty window as undefined, never as a reassuring zero", () => {
    const census = measure([]);
    expect(census.deliveryRate.value).toBeUndefined();
    expect(census.measured).toBe(0);
  });

  it("excludes rows no reader could have seen, and counts why", () => {
    const census = measure([
      row({ id: "a" }),
      row({ id: "b", status: "pending" }),
      row({ id: "c", sourceNames: [] }),
    ]);
    expect(census.excluded.notComplete).toBe(1);
    expect(census.excluded.noSources).toBe(1);
    expect(census.measured).toBe(1);
  });

  it("keeps a withheld story visible instead of averaging it away", () => {
    const census = measure([
      row({ id: "a", delivered: true, withheldReason: "delivered" }),
      row({ id: "b", importance: 10, audience: 4, materialRevision: 1 }),
    ]);
    expect(census.withheldWithSignal).toBe(1);
    expect(census.withheldNotable.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("counts a story with no evidence as unevaluable, not as unimportant", () => {
    const census = measure([row({ id: "a", enriched: false, evidenceUnits: 0 }), row({ id: "b" })]);
    expect(census.unevaluableRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    // The unevaluable row is still measured: it was a real event in the window.
    expect(census.measured).toBe(2);
  });

  it("buckets the withheld by the reason the pipeline itself recorded", () => {
    const census = measure([
      row({ id: "a", withheldReason: "no_evidence" }),
      row({ id: "b", withheldReason: "no_evidence" }),
      row({ id: "c", withheldReason: "expired" }),
    ]);
    const byReason = new Map(census.withheldByReason.map((bucket) => [bucket.reason, bucket]));
    expect(byReason.get("no_evidence")?.events).toBe(2);
    expect(byReason.get("expired")?.events).toBe(1);
    expect(byReason.get("never_matched")?.events).toBe(0);
  });

  it("keeps a delivery gap distinct from an ingestion gap and a ranking call", () => {
    const census = measure([
      row({ id: "ingest", withheldReason: "no_evidence", enriched: false, evidenceUnits: 0 }),
      row({ id: "delivery", withheldReason: "matched_not_sent", audience: 1 }),
      row({ id: "ranking", withheldReason: "never_matched", audience: 0 }),
    ]);
    const byReason = new Map(census.withheldByReason.map((bucket) => [bucket.reason, bucket]));
    // Three different repairs, so three different numbers — never one "withheld".
    expect(byReason.get("no_evidence")?.events).toBe(1);
    expect(byReason.get("matched_not_sent")?.events).toBe(1);
    expect(byReason.get("never_matched")?.events).toBe(1);
  });

  it("counts the signals inside each withheld bucket", () => {
    const census = measure([
      row({ id: "a", withheldReason: "never_matched", importance: 9 }),
      row({ id: "b", withheldReason: "never_matched", evidenceUnits: 0 }),
    ]);
    const bucket = census.withheldByReason.find((entry) => entry.reason === "never_matched");
    expect(bucket?.events).toBe(2);
    expect(bucket?.withSignal).toBe(1);
  });

  it("does not count a story as notable merely for having evidence", () => {
    // 50 of the 54 matched-not-sent rows in the live window fired this alone.
    const census = measure([row({ id: "vendor-report", evidenceUnits: 12 })]);
    expect(census.withheldWithSignal).toBe(0);
    expect(census.withheldNotable).toEqual([]);
    // …but its evidence is still reported, as availability.
    expect(census.unevaluableRate.numerator).toBe(0);
  });

  it("ranks the notable withheld stories by signal strength, then importance", () => {
    const census = measure([
      row({ id: "weak", importance: 10 }),
      row({ id: "strong", materialRevision: 1, audience: 3 }),
    ]);
    expect(census.withheldNotable.map((entry) => entry.id)).toEqual(["strong", "weak"]);
  });

  // Two stories of the same signal strength: the tiebreak is the pipeline's own
  // importance, so the report reads as a priority order rather than as whatever
  // order the database happened to return.
  it("breaks a signal-strength tie on the pipeline's own importance", () => {
    const census = measure([
      row({ id: "lower", importance: 7 }),
      row({ id: "higher", importance: 9 }),
    ]);
    expect(census.withheldNotable.map((entry) => entry.id)).toEqual(["higher", "lower"]);
  });

  it("counts research papers and how many reached a reader", () => {
    const census = measure([
      row({ id: "p1", sourceNames: ["arXiv cs.CR"], delivered: true, withheldReason: "delivered" }),
      row({ id: "p2", sourceNames: ["arXiv stat.ML"], importance: 8 }),
      row({ id: "n1", sourceNames: ["The Register"] }),
    ]);
    expect(census.research).toEqual({ events: 2, delivered: 1, withheldWithSignal: 1 });
  });

  it("counts events that moved after delivery", () => {
    const census = measure([
      row({ id: "r1", materialRevision: 2, delivered: true, withheldReason: "delivered" }),
      row({ id: "r2", materialRevision: 0 }),
    ]);
    expect(census.revised).toEqual({ events: 1, delivered: 1 });
  });

  it("reports the window's span from the rows it measured", () => {
    const census = measure([
      row({ id: "a", firstSeenAt: "2026-10-03T00:00:00Z" }),
      row({ id: "b", firstSeenAt: "2026-10-01T00:00:00Z" }),
    ]);
    expect(census.span).toEqual({ from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z" });
  });

  it("leaves the span empty rather than inventing dates", () => {
    expect(measure([row({ firstSeenAt: "" })]).span).toEqual({ from: "", to: "" });
  });
});
