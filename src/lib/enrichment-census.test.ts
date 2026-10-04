import { describe, expect, it } from "vitest";
import {
  absenceFor,
  bestAbsence,
  census,
  formatPercent,
  type ArticleRow,
  type EventRow,
} from "./enrichment-census";

/**
 * The distinctions that matter here are the ones that decide whether a fix is
 * warranted at all. A test that only checked "covered vs not covered" would pass
 * on an implementation that told the reader to go optimise `robots.txt`.
 */

const article = (overrides: Partial<ArticleRow> = {}): ArticleRow => ({
  articleId: "a1",
  status: "enriched",
  evidenceUnits: 5,
  wordCount: 900,
  ...overrides,
});

const event = (eventId: string, articles: ArticleRow[]): EventRow => ({ eventId, articles });

describe("absenceFor", () => {
  it("treats a missing row as never attempted, not as pending", () => {
    // The nullable status is the whole point: a left join reports null, and
    // defaulting it to `pending` would turn a scheduling gap into "in flight".
    expect(absenceFor(article({ status: null, evidenceUnits: 0, wordCount: 0 }))).toBe(
      "never_attempted",
    );
  });

  it("reads a claimed-but-unfinished row as pending", () => {
    expect(absenceFor(article({ status: "pending", evidenceUnits: 0, wordCount: 0 }))).toBe(
      "pending",
    );
  });

  it("keeps a robots refusal as blocked, which is a boundary and not a defect", () => {
    expect(absenceFor(article({ status: "blocked", evidenceUnits: 0, wordCount: 0 }))).toBe(
      "blocked",
    );
  });

  it("separates a page that never fetched from a page with too little text", () => {
    // Both are `unavailable` in the database. They are different problems, and
    // `word_count` is the field that tells them apart.
    expect(absenceFor(article({ status: "unavailable", evidenceUnits: 0, wordCount: 0 }))).toBe(
      "unreachable",
    );
    expect(absenceFor(article({ status: "unavailable", evidenceUnits: 0, wordCount: 120 }))).toBe(
      "thin_content",
    );
  });

  it("separates an extractor that found nothing from a page that had nothing", () => {
    // The family that represents real loss: enough words, zero units.
    expect(absenceFor(article({ status: "enriched", evidenceUnits: 0, wordCount: 1200 }))).toBe(
      "extraction_empty",
    );
    expect(absenceFor(article({ status: "enriched", evidenceUnits: 3, wordCount: 1200 }))).toBe(
      "covered",
    );
  });

  it("reads a throw as failed rather than as a source problem", () => {
    expect(absenceFor(article({ status: "failed", evidenceUnits: 0, wordCount: 0 }))).toBe(
      "failed",
    );
  });
});

describe("bestAbsence", () => {
  it("attributes an event to its most promising article", () => {
    // One blocked, one extractor-empty. The event is reported under the fixable
    // family, so a reader is not sent to audit robots.txt first.
    expect(
      bestAbsence([
        article({ status: "blocked", evidenceUnits: 0, wordCount: 0 }),
        article({ status: "enriched", evidenceUnits: 0, wordCount: 900 }),
      ]),
    ).toBe("extraction_empty");
  });

  it("prefers real evidence over every failure mode", () => {
    expect(
      bestAbsence([
        article({ status: "blocked", evidenceUnits: 0, wordCount: 0 }),
        article({ status: "enriched", evidenceUnits: 4, wordCount: 900 }),
      ]),
    ).toBe("covered");
  });

  it("reports no articles as never attempted, since nothing was scheduled", () => {
    expect(bestAbsence([])).toBe("never_attempted");
  });
});

describe("census", () => {
  it("counts coverage over events that have articles", () => {
    const result = census([
      event("e1", [article({ evidenceUnits: 5 })]),
      event("e2", [article({ status: "blocked", evidenceUnits: 0, wordCount: 0 })]),
    ]);
    expect(result.covered).toBe(1);
    expect(result.uncovered).toBe(1);
    expect(result.coveredRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it("counts an event with no articles separately rather than as an enrichment failure", () => {
    const result = census([event("e1", [article({ evidenceUnits: 5 })]), event("e2", [])]);
    expect(result.noArticles).toBe(1);
    // It is not in the denominator either: enrichment was never its problem.
    expect(result.coveredRate.denominator).toBe(1);
    expect(result.coveredRate.value).toBe(1);
  });

  it("attributes every uncovered event to exactly one family", () => {
    const result = census([
      event("e1", [article({ status: null, evidenceUnits: 0, wordCount: 0 })]),
      event("e2", [article({ status: "enriched", evidenceUnits: 0, wordCount: 900 })]),
      event("e3", [article({ status: "blocked", evidenceUnits: 0, wordCount: 0 })]),
    ]);
    const total = result.buckets.reduce((sum, bucket) => sum + bucket.events, 0);
    expect(total).toBe(result.uncovered);
    const byFamily = new Map(result.buckets.map((bucket) => [bucket.absence, bucket.events]));
    expect(byFamily.get("never_attempted")).toBe(1);
    expect(byFamily.get("extraction_empty")).toBe(1);
    expect(byFamily.get("blocked")).toBe(1);
  });

  it("counts articles by family, which is the raw material for a fix", () => {
    const result = census([
      event("e1", [
        article({ status: "blocked", evidenceUnits: 0, wordCount: 0 }),
        article({ status: "blocked", evidenceUnits: 0, wordCount: 0 }),
      ]),
    ]);
    const byFamily = new Map(
      result.articlesByAbsence.map((entry) => [entry.absence, entry.articles]),
    );
    expect(byFamily.get("blocked")).toBe(2);
    expect(result.articles).toBe(2);
  });

  it("reports how many uncovered events carry an importance signal", () => {
    const result = census(
      [
        event("e1", [article({ status: "blocked", evidenceUnits: 0, wordCount: 0 })]),
        event("e2", [article({ status: "blocked", evidenceUnits: 0, wordCount: 0 })]),
      ],
      new Set(["e2"]),
    );
    expect(result.uncoveredNotable).toBe(1);
  });

  it("reports an empty window as undefined rather than as a healthy zero", () => {
    const result = census([]);
    expect(result.coveredRate.value).toBeUndefined();
    expect(formatPercent(result.coveredRate)).toBe("—");
  });
});
