import { describe, expect, it } from "vitest";
import { cleanEvidence, orderEvidenceSources, remapEvidence } from "./evidence-text";
import { selectEvidence, renderSelectedCoverage, type EvidenceArticle } from "./evidence-selection";
import { contract, thinContract, renderAnalysisPayload, isEnrichmentEligible } from "./analyse";
import { extractFacts } from "./extract";

const article = (title: string, excerpt: string, kind = "news"): EvidenceArticle => ({
  title,
  excerpt,
  source_id: kind,
  source_kind: kind,
  published_at: null,
});

describe("evidence correctness before compression", () => {
  it("does not mistake already inspected duplicate sources for fresh evidence growth", () => {
    expect(
      isEnrichmentEligible({ sourceCountAtAnalysis: 1, coverageCountAtAnalysis: 12 }, 12),
    ).toBe(false);
  });
  it("removes repeated sentences and headlines without altering numbers or quotes", () => {
    expect(
      cleanEvidence(
        "Revenue update",
        "Revenue update. Revenue grew 12%. Revenue grew 12%. Revenue grew 21%. On 2026-09-01, ¥100 became ¥200. He said ‘not approved’.",
      ),
    ).toEqual([
      "Revenue grew 12%.",
      "Revenue grew 21%.",
      "On 2026-09-01, ¥100 became ¥200.",
      "He said ‘not approved’.",
    ]);
  });
  it("preserves Japanese dates, percentages and conflicting claims", () => {
    expect(
      cleanEvidence(
        "決算",
        "売上は12%増加。売上は12%増加。売上は21%増加。2026年9月1日に発表。承認していない。",
      ),
    ).toHaveLength(4);
  });
  it("keeps primary evidence and detects potentially conflicting values", () => {
    const input = [
      article("Revenue", "Revenue grew 12%."),
      article("Results", "Revenue grew 21%.", "company_blog"),
    ];
    const result = selectEvidence(input);
    expect(result.selectedIndices).toContain(1);
    expect(result.selectedCount).toBe(2);
    expect(result.conflictsPreserved).toBeGreaterThan(0);
  });
  it("does not drop corrections and negation without new entities or figures", () => {
    const input = [
      article("Deal", "The board approved the deal."),
      article("Correction", "The board has not approved the deal."),
    ];
    expect(selectEvidence(input).selectedCount).toBe(2);
  });
  it("deduplicates exact articles, retaining the primary source", () => {
    const input = [
      article("Deal", "The deal closes tomorrow."),
      article("Deal", "The deal closes tomorrow.", "company_blog"),
    ];
    expect(selectEvidence(input).selectedIndices).toEqual([1]);
  });
  it("renders each shared claim once with every supporting citation", () => {
    const input = [
      article("Announcement", "Revenue grew 12%."),
      article("Report", "Revenue grew 12%. Revenue grew 21% in Europe."),
    ];
    const rendered = renderSelectedCoverage(input, [0, 1], 2, new Map());
    expect(rendered).toContain("[1,2] Revenue grew 12%.");
    expect(rendered).toContain("[2] Revenue grew 21% in Europe.");
  });
  it("reports overflow rather than claiming omitted evidence is preserved", () => {
    const input = Array.from({ length: 13 }, (_, n) =>
      article(`Source ${n}`, `Revenue grew ${n}%.`),
    );
    const selected = selectEvidence(input);
    expect(selected.selectedCount).toBe(12);
    expect(selected.omittedUniqueSources).toBe(1);
  });
  it("keeps stored source order and remaps removed sources without misattribution", () => {
    const sorted = orderEvidenceSources([{ id: "new" }, { id: "b" }, { id: "a" }], ["a", "b"]);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "new"]);
    expect(
      remapEvidence({ numbers: [{ evidence: [1, 2] }] }, ["removed", "b"], [{ id: "b" }]),
    ).toEqual({ numbers: [{ evidence: [1] }] });
  });
  it("keeps exactly one contract, including on thin requests", () => {
    const user = renderAnalysisPayload(
      "Deal",
      "[1] The deal was approved.",
      extractFacts("", 0),
      { selectedIndices: [0], totalUniqueFacts: 0, totalFactsFull: 0, conflictsPreserved: 0 },
      { totalFactsBefore: 0, totalFactsAfter: 0, factsRemoved: 0 },
      new Map(),
    );
    expect(user).not.toContain("Reply with JSON");
    expect(user).not.toContain('"understand"');
    // The thin contract carries its own minimal understand block, holding the
    // reader article. One either way is the point: the payload adds no second.
    expect(`${thinContract()}\n${user}`.match(/"understand":/g)).toHaveLength(1);
    expect(`${contract()}\n${user}`.match(/"understand":/g)).toHaveLength(1);
  });
});
