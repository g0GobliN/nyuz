import { describe, expect, it } from "vitest";
import {
  selectEvidence,
  deduplicateEvidence,
  computeEvidenceShadowMetrics,
  scoreArticle,
  renderSelectedCoverage,
  type EvidenceArticle,
} from "./evidence-selection";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeArticle(
  overrides: Partial<EvidenceArticle> & { title: string; excerpt?: string },
): EvidenceArticle {
  const article: EvidenceArticle = {
    title: overrides.title,
    excerpt: overrides.excerpt ?? null,
    published_at: overrides.published_at ?? null,
    source_id: overrides.source_id ?? null,
  };
  if (overrides.source_kind !== undefined) article.source_kind = overrides.source_kind;
  if (overrides.source_coverage_mode !== undefined)
    article.source_coverage_mode = overrides.source_coverage_mode;
  if (overrides.source_polling_tier !== undefined)
    article.source_polling_tier = overrides.source_polling_tier;
  if (overrides.source_failure_count !== undefined)
    article.source_failure_count = overrides.source_failure_count;
  if (overrides.content_hash !== undefined) article.content_hash = overrides.content_hash;
  return article;
}

const PRIMARY_SOURCE = makeArticle({
  title: "OpenAI announces GPT-5 with 13B parameter model",
  excerpt:
    "OpenAI today announced GPT-5, a 13 billion parameter model. The model was raised at a $4 billion valuation. The company said the model would be available next quarter.",
  source_kind: "company_blog",
  source_coverage_mode: "core",
  source_polling_tier: "hot",
  published_at: "2026-09-03T10:00:00Z",
});

const INDEPENDENT_SOURCE_1 = makeArticle({
  title: "OpenAI launches GPT-5 with 13B parameters",
  excerpt:
    "OpenAI has launched GPT-5, featuring 13 billion parameters. The model was valued at $4 billion. Expected to ship next quarter.",
  source_kind: "news",
  source_coverage_mode: "demand",
  source_polling_tier: "normal",
  published_at: "2026-09-03T12:00:00Z",
});

const INDEPENDENT_SOURCE_2 = makeArticle({
  title: "OpenAI GPT-5 release: 13B parameters, $4B valuation",
  excerpt:
    "OpenAI released GPT-5 with 13 billion parameters. The valuation stands at $4 billion. The company expects availability next quarter.",
  source_kind: "news",
  source_coverage_mode: "demand",
  source_polling_tier: "normal",
  published_at: "2026-09-03T14:00:00Z",
});

const CONFLICTING_SOURCE = makeArticle({
  title: "OpenAI GPT-5 deal valued at $12B not $4B",
  excerpt:
    "Sources close to the deal say OpenAI's GPT-5 valuation was actually $12 billion, not $4 billion as initially reported. The model has 13 billion parameters.",
  source_kind: "news",
  source_coverage_mode: "demand",
  source_polling_tier: "normal",
  published_at: "2026-09-03T16:00:00Z",
});

const UNRELATED_SOURCE = makeArticle({
  title: "Polygon reviews the latest handheld console",
  excerpt:
    "Polygon reviewed the latest handheld console from Nintendo. The device has a 7-inch screen and costs $200.",
  source_kind: "news",
  source_coverage_mode: "demand",
  source_polling_tier: "normal",
  published_at: "2026-09-03T18:00:00Z",
});

const SECONDARY_REPORTING = makeArticle({
  title: "AI industry sees major shift as OpenAI releases GPT-5",
  excerpt:
    "The AI industry is seeing a major shift following OpenAI's release of GPT-5. The 13 billion parameter model was valued at $4 billion.",
  source_kind: "news",
  source_coverage_mode: "demand",
  source_polling_tier: "normal",
  published_at: "2026-09-03T15:00:00Z",
});

// ---------------------------------------------------------------------------
// scoreArticle tests
// ---------------------------------------------------------------------------

describe("scoreArticle", () => {
  it("gives primary sources higher scores", () => {
    const primary = makeArticle({
      title: "OpenAI announcement",
      source_kind: "company_blog",
      source_coverage_mode: "core",
    });
    const secondary = makeArticle({
      title: "OpenAI announcement",
      source_kind: "news",
      source_coverage_mode: "demand",
    });

    const primaryScore = scoreArticle(primary, 0, [primary, secondary]);
    const secondaryScore = scoreArticle(secondary, 1, [primary, secondary]);

    expect(primaryScore).toBeGreaterThan(secondaryScore);
  });

  it("gives fresh articles higher scores", () => {
    const fresh = makeArticle({
      title: "Fresh article",
      published_at: new Date().toISOString(),
    });
    const old = makeArticle({
      title: "Old article",
      published_at: "2026-08-01T00:00:00Z",
    });

    const freshScore = scoreArticle(fresh, 0, [fresh, old]);
    const oldScore = scoreArticle(old, 1, [fresh, old]);

    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it("gives core coverage sources a boost", () => {
    const core = makeArticle({
      title: "Core source",
      source_coverage_mode: "core",
    });
    const demand = makeArticle({
      title: "Demand source",
      source_coverage_mode: "demand",
    });

    const coreScore = scoreArticle(core, 0, [core, demand]);
    const demandScore = scoreArticle(demand, 1, [core, demand]);

    expect(coreScore).toBeGreaterThan(demandScore);
  });
});

// ---------------------------------------------------------------------------
// selectEvidence tests
// ---------------------------------------------------------------------------

describe("selectEvidence", () => {
  it("selects all articles when they all have unique facts", () => {
    const articles = [
      makeArticle({
        title: "OpenAI GPT-5 launch",
        excerpt: "OpenAI launched GPT-5 with 13 billion parameters.",
        source_kind: "company_blog",
      }),
      makeArticle({
        title: "Nvidia new chip",
        excerpt: "Nvidia released a new H200 chip with 141GB memory.",
        source_kind: "company_blog",
      }),
    ];

    const result = selectEvidence(articles);
    expect(result.selectedCount).toBe(2);
    expect(result.selectedIndices).toEqual([0, 1]);
  });

  it("retains differently worded claims even when extracted entities and numbers match", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1, INDEPENDENT_SOURCE_2];
    const result = selectEvidence(articles);
    expect(result.selectedCount).toBe(3);
  });

  it("always keeps at least 1 primary source", () => {
    const articles = [
      makeArticle({
        title: "OpenAI GPT-5",
        excerpt: "OpenAI launched GPT-5 with 13 billion parameters.",
        source_kind: "company_blog",
        source_coverage_mode: "core",
      }),
      makeArticle({
        title: "OpenAI GPT-5",
        excerpt: "OpenAI launched GPT-5 with 13 billion parameters.",
        source_kind: "news",
      }),
      makeArticle({
        title: "OpenAI GPT-5",
        excerpt: "OpenAI launched GPT-5 with 13 billion parameters.",
        source_kind: "news",
      }),
    ];

    const result = selectEvidence(articles);
    const selectedArticles = result.selectedIndices.map((i) => articles[i]!);
    const hasPrimary = selectedArticles.some((a) => a.source_kind === "company_blog");
    expect(hasPrimary).toBe(true);
  });

  it("preserves conflicting sources", () => {
    const articles = [PRIMARY_SOURCE, CONFLICTING_SOURCE];
    const result = selectEvidence(articles);
    const selectedIndices = result.selectedIndices;
    const hasPrimary = selectedIndices.some((i) => articles[i]!.source_kind === "company_blog");
    const hasConflict = selectedIndices.some((i) => articles[i]!.title.includes("$12B"));
    expect(hasPrimary).toBe(true);
    expect(hasConflict).toBe(true);
  });

  it("never exceeds 12 articles", () => {
    const manyArticles = Array.from({ length: 20 }, (_, i) =>
      makeArticle({
        title: `Article ${i}`,
        excerpt: `Unique fact ${i} about this event.`,
        source_kind: i % 2 === 0 ? "news" : "company_blog",
      }),
    );

    const result = selectEvidence(manyArticles);
    expect(result.selectedCount).toBeLessThanOrEqual(12);
  });

  it("returns empty result for empty input", () => {
    const result = selectEvidence([]);
    expect(result.selectedCount).toBe(0);
    expect(result.totalFactsFull).toBe(0);
    expect(result.factsLost).toBe(0);
  });

  it("adapts to simple events (fewer articles needed)", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1];
    const result = selectEvidence(articles);
    expect(result.selectedCount).toBeLessThanOrEqual(articles.length);
    expect(result.totalUniqueFacts).toBeLessThanOrEqual(result.totalFactsFull);
  });

  it("adapts to complex events (more articles needed)", () => {
    const articles = [
      PRIMARY_SOURCE,
      INDEPENDENT_SOURCE_1,
      CONFLICTING_SOURCE,
      SECONDARY_REPORTING,
    ];
    const result = selectEvidence(articles);
    expect(result.selectedCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// deduplicateEvidence tests
// ---------------------------------------------------------------------------

describe("deduplicateEvidence", () => {
  it("removes duplicate facts from multiple articles", () => {
    const articles = [
      makeArticle({
        title: "Source A",
        excerpt: "OpenAI raised $13 billion. The valuation is $4 billion.",
      }),
      makeArticle({
        title: "Source B",
        excerpt: "OpenAI raised $13 billion. The valuation is $4 billion. Expected to close Q4.",
      }),
      makeArticle({ title: "Source C", excerpt: "OpenAI raised $13 billion." }),
    ];

    const result = deduplicateEvidence(articles);
    expect(result.totalFactsBefore).toBeGreaterThan(result.totalFactsAfter);
    expect(result.factsRemoved).toBeGreaterThan(0);
  });

  it("preserves conflicting claims", () => {
    const articles = [
      makeArticle({ title: "Source A", excerpt: "The deal was valued at $4 billion." }),
      makeArticle({ title: "Source B", excerpt: "The deal was valued at $12 billion." }),
    ];

    const result = deduplicateEvidence(articles);
    const allNewFacts = result.deduplicatedArticles.flatMap((a) => a.newFacts);
    const values = allNewFacts.map((f) => f.value);
    expect(values.some((v) => v.includes("4 billion"))).toBe(true);
    expect(values.some((v) => v.includes("12 billion"))).toBe(true);
  });

  it("preserves source attribution", () => {
    const articles = [
      makeArticle({ title: "Source A", excerpt: "Fact A. Fact B." }),
      makeArticle({ title: "Source B", excerpt: "Fact A. Fact C." }),
    ];

    const result = deduplicateEvidence(articles);
    expect(result.deduplicatedArticles.length).toBe(2);
    expect(result.deduplicatedArticles[0]!.title).toBe("Source A");
    expect(result.deduplicatedArticles[1]!.title).toBe("Source B");
  });

  it("returns empty result for empty input", () => {
    const result = deduplicateEvidence([]);
    expect(result.totalFactsBefore).toBe(0);
    expect(result.totalFactsAfter).toBe(0);
    expect(result.factsRemoved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceShadowMetrics tests
// ---------------------------------------------------------------------------

describe("computeEvidenceShadowMetrics", () => {
  it("computes metrics for a simple event", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1];
    const metrics = computeEvidenceShadowMetrics("event-1", articles);

    expect(metrics.fullArticleCount).toBe(2);
    expect(metrics.selectedArticleCount).toBeLessThanOrEqual(2);
    expect(metrics.factsPreserved).toBeGreaterThanOrEqual(0);
    expect(metrics.agreementRate).toBeGreaterThanOrEqual(0);
    expect(metrics.agreementRate).toBeLessThanOrEqual(1);
    expect(metrics.sourceAttributionPreserved).toBe(true);
  });

  it("reports high agreement rate for non-conflicting events", () => {
    const articles = [PRIMARY_SOURCE, UNRELATED_SOURCE];
    const metrics = computeEvidenceShadowMetrics("event-2", articles);
    expect(metrics.agreementRate).toBeGreaterThanOrEqual(0.8);
  });

  it("reports conflicts preserved for conflicting events", () => {
    const articles = [PRIMARY_SOURCE, CONFLICTING_SOURCE];
    const metrics = computeEvidenceShadowMetrics("event-3", articles);
    expect(metrics.conflictsPreserved).toBeGreaterThanOrEqual(0);
    expect(metrics.factsPreserved).toBeGreaterThan(0);
  });

  it("reports prompt tokens saved", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1, INDEPENDENT_SOURCE_2];
    const metrics = computeEvidenceShadowMetrics("event-4", articles);
    expect(metrics.promptTokensSaved).toBeGreaterThanOrEqual(0);
    expect(metrics.selectedArticleCount).toBeLessThanOrEqual(articles.length);
  });

  it("handles empty article set", () => {
    const metrics = computeEvidenceShadowMetrics("event-5", []);
    expect(metrics.fullArticleCount).toBe(0);
    expect(metrics.selectedArticleCount).toBe(0);
    expect(metrics.agreementRate).toBe(1);
  });

  it("records selected indices", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1, UNRELATED_SOURCE];
    const metrics = computeEvidenceShadowMetrics("event-6", articles);
    expect(metrics.selectedIndices.length).toBeLessThanOrEqual(12);
    expect(metrics.selectedIndices.every((i) => i >= 0 && i < articles.length)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderSelectedCoverage tests
// ---------------------------------------------------------------------------

describe("renderSelectedCoverage", () => {
  it("generates coverage text for selected articles", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1];
    const outlets = new Map([["src-1", "OpenAI"]]);
    const coverage = renderSelectedCoverage(articles, [0, 1], 2, outlets);
    expect(coverage).toContain("OpenAI");
    expect(coverage).toContain("GPT-5");
  });

  it("indicates when not all articles are shown", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1, UNRELATED_SOURCE];
    const outlets = new Map();
    const coverage = renderSelectedCoverage(articles, [0, 1], 3, outlets);
    expect(coverage).toContain("2 of 3 sources");
  });

  it("shows all articles when all are selected", () => {
    const articles = [PRIMARY_SOURCE, INDEPENDENT_SOURCE_1];
    const outlets = new Map();
    const coverage = renderSelectedCoverage(articles, [0, 1], 2, outlets);
    expect(coverage).toContain("2 of 2 sources");
  });
});
