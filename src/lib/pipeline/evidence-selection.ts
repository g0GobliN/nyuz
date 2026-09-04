/**
 * Adaptive evidence selection and deterministic deduplication — shadow mode only.
 *
 * This module ranks, selects, and deduplicates article evidence BEFORE it
 * reaches the analysis model. It is never used in production today — it only
 * computes what a reduced evidence set would look like and logs the comparison
 * against the full 12-article set.
 *
 * See docs/track.md phase 9 for the shadow measurement framework.
 *
 * The goal is NOT to summarize with code. The goal is to transform repetitive
 * input into the smallest set that preserves all meaningful evidence, while
 * preserving source attribution, conflicting claims, numbers, and quotes.
 */

import type { ExtractedFacts } from "./extract";
import { extractFacts } from "./extract";
import { repeats } from "../understand";
import { norm } from "../relate";
import { titleTokens } from "./shortlist";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An article as it exists in the analysis coverage query. */
export interface EvidenceArticle {
  title: string;
  excerpt: string | null;
  published_at: string | null;
  source_id: string | null;
  /** Source metadata available for scoring. */
  source_kind?: string;
  source_coverage_mode?: string;
  source_polling_tier?: string;
  source_failure_count?: number;
  content_hash?: string;
}

/** A fact extracted from an article excerpt. */
export interface ArticleFact {
  category: string;
  value: string;
  label: string;
  evidence: number[];
  articleIndex: number;
}

/** The result of selecting and deduplicating evidence. */
export interface EvidenceSelectionResult {
  /** Indices of the selected articles (0-based into the original array). */
  selectedIndices: number[];
  /** Per-article facts marked as NEW or SEEN. */
  articleFacts: ArticleFactGroup[];
  /** Total unique facts across all selected articles. */
  totalUniqueFacts: number;
  /** Total facts in the full set. */
  totalFactsFull: number;
  /** Facts that were lost by deduplication (identical repeats). */
  factsLost: number;
  /** Conflicts that were preserved. */
  conflictsPreserved: number;
  /** Source attribution preserved (each selected article keeps its header). */
  sourceAttributionPreserved: boolean;
  /** Number of articles selected. */
  selectedCount: number;
  /** Estimated prompt tokens saved vs. full set. */
  promptTokensSaved: number;
}

/** Facts grouped per article with their novelty status. */
export interface ArticleFactGroup {
  articleIndex: number;
  title: string;
  sourceId: string | null;
  facts: ArticleFact[];
  newFacts: number;
  seenFacts: number;
  conflictFacts: number;
}

/** Metrics recorded for shadow comparison. */
export interface EvidenceShadowMetrics {
  eventId: string;
  fullArticleCount: number;
  selectedArticleCount: number;
  factsPreserved: number;
  factsLost: number;
  conflictsPreserved: number;
  sourceAttributionPreserved: boolean;
  promptTokensSaved: number;
  agreementRate: number;
  selectedIndices: number[];
  factPreservationDetail: FactPreservationDetail[];
}

export interface FactPreservationDetail {
  category: string;
  fullCount: number;
  preservedCount: number;
  lostCount: number;
  conflictCount: number;
}

// ---------------------------------------------------------------------------
// Scoring signals
// ---------------------------------------------------------------------------

/** Primary source kinds that get highest priority. */
const PRIMARY_SOURCE_KINDS = new Set(["company_blog", "research"]);

/** Secondary source kinds that get moderate priority. */
const SECONDARY_SOURCE_KINDS = new Set(["news", "rss"]);

/**
 * Score an article for evidence selection.
 *
 * Higher scores mean the article is more likely to be selected.
 * The score is a sum of deterministic signals — no AI involved.
 */
export function scoreArticle(
  article: EvidenceArticle,
  _articleIndex: number,
  _allArticles: EvidenceArticle[],
): number {
  let score = 0;

  // Primary source preference
  if (article.source_kind && PRIMARY_SOURCE_KINDS.has(article.source_kind)) {
    score += 3;
  } else if (article.source_kind && SECONDARY_SOURCE_KINDS.has(article.source_kind)) {
    score += 1;
  }

  // Core coverage preference
  if (article.source_coverage_mode === "core") {
    score += 2;
  }

  // Freshness: articles published within 24h get a boost
  if (article.published_at) {
    const published = new Date(article.published_at).getTime();
    const now = Date.now();
    const hoursOld = (now - published) / (1000 * 60 * 60);
    if (hoursOld < 24) score += 2;
    else if (hoursOld < 72) score += 1;
  }

  // Independence: articles with distinct title tokens
  const titleTokensSet = new Set(titleTokens(article.title));
  if (titleTokensSet.size >= 2) score += 1;

  // Low failure count suggests a healthy, reliable source
  if (article.source_failure_count !== undefined && article.source_failure_count === 0) {
    score += 1;
  }

  // Polling tier: hot sources get a small boost
  if (article.source_polling_tier === "hot") {
    score += 1;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Fact extraction and comparison
// ---------------------------------------------------------------------------

/**
 * Extract all facts from all articles, tagged with their article index.
 */
function extractAllFacts(articles: EvidenceArticle[]): ArticleFact[] {
  const allFacts: ArticleFact[] = [];

  articles.forEach((article, index) => {
    const text = `${article.title}\n${article.excerpt ?? ""}`;
    if (!text.trim()) return;

    const facts = extractFacts(text, index);
    const categories: string[] = [
      "money",
      "percentages",
      "dates",
      "cves",
      "cvss",
      "versions",
      "counts",
      "companies",
      "countries",
      "products",
      "tickers",
      "layoffs",
      "regulatoryActions",
    ];

    for (const category of categories) {
      const items = facts[category as keyof ExtractedFacts] as
        { value: string; label: string; evidence: number[] }[] | undefined;
      if (!items) continue;
      for (const item of items) {
        allFacts.push({
          category,
          value: item.value.toLowerCase().trim(),
          label: item.label,
          evidence: item.evidence.map((e) => e + index),
          articleIndex: index,
        });
      }
    }
  });

  return allFacts;
}

/**
 * Check if two facts are duplicates using norm() and repeats().
 */
function areFactsDuplicate(factA: ArticleFact, factB: ArticleFact): boolean {
  if (factA.category === factB.category && factA.value === factB.value) {
    return true;
  }
  const normA = norm(factA.label);
  const normB = norm(factB.label);
  if (normA && normB && repeats(factA.label, factB.label)) {
    return true;
  }
  return false;
}

/**
 * Check if two facts conflict (same category, different values).
 */
function areFactsConflict(factA: ArticleFact, factB: ArticleFact): boolean {
  if (factA.category !== factB.category) return false;
  return factA.value !== factB.value;
}

// ---------------------------------------------------------------------------
// Adaptive evidence selection
// ---------------------------------------------------------------------------

/**
 * Select the smallest set of articles that preserves all meaningful evidence.
 *
 * The 12-article upper bound is NEVER changed — this just selects a subset.
 */
export function selectEvidence(articles: EvidenceArticle[]): EvidenceSelectionResult {
  if (articles.length === 0) {
    return {
      selectedIndices: [],
      articleFacts: [],
      totalUniqueFacts: 0,
      totalFactsFull: 0,
      factsLost: 0,
      conflictsPreserved: 0,
      sourceAttributionPreserved: true,
      selectedCount: 0,
      promptTokensSaved: 0,
    };
  }

  // Step 1: Score all articles
  const scored = articles.map((article, index) => ({
    index,
    article,
    score: scoreArticle(article, index, articles),
  }));

  // Step 2: Sort by score descending, then by publication date (newest first)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.article.published_at && b.article.published_at) {
      return (
        new Date(b.article.published_at).getTime() - new Date(a.article.published_at).getTime()
      );
    }
    return 0;
  });

  // Step 3: Extract all facts from all articles
  const allFacts = extractAllFacts(articles);
  const totalFactsFull = allFacts.length;

  // Group facts by category+value to identify unique facts and conflicts
  const factGroups = new Map<string, ArticleFact[]>();
  for (const fact of allFacts) {
    const key = `${fact.category}::${fact.value}`;
    if (!factGroups.has(key)) factGroups.set(key, []);
    factGroups.get(key)!.push(fact);
  }

  // Identify conflict categories (same category, different values)
  const conflictCategories = new Set<string>();
  for (const [category, facts] of factGroups) {
    const values = new Set(facts.map((f) => f.value));
    if (values.size > 1) {
      conflictCategories.add(category);
    }
  }

  // Step 4: Greedy selection — pick highest-scored articles first
  const selectedIndices: number[] = [];
  const coveredFacts = new Set<string>();

  // First pass: always include at least 1 primary source
  let hasPrimary = false;
  for (const item of scored) {
    if (item.article.source_kind && PRIMARY_SOURCE_KINDS.has(item.article.source_kind)) {
      selectedIndices.push(item.index);
      hasPrimary = true;
      break;
    }
  }

  // If no primary source found, start with the highest-scored article
  if (!hasPrimary && scored.length > 0) {
    selectedIndices.push(scored[0]!.index);
  }

  // Track facts covered by selected articles
  for (const index of selectedIndices) {
    const articleFacts = extractAllFacts([articles[index]!]);
    for (const fact of articleFacts) {
      coveredFacts.add(`${fact.category}::${fact.value}`);
    }
  }

  // Step 5: Continue selecting until all unique facts are covered or 12 articles
  for (const item of scored) {
    if (selectedIndices.length >= 12) break;
    if (selectedIndices.includes(item.index)) continue;

    const articleFacts = extractAllFacts([item.article]);
    const newFacts = articleFacts.filter((f) => !coveredFacts.has(`${f.category}::${f.value}`));

    if (newFacts.length > 0) {
      selectedIndices.push(item.index);
      for (const fact of articleFacts) {
        coveredFacts.add(`${fact.category}::${fact.value}`);
      }
    }
  }

  // Step 6: Ensure conflicting sources are preserved
  for (const category of conflictCategories) {
    const articlesWithCategory = articles
      .map((a, i) => ({ index: i, article: a }))
      .filter(({ article: a }) => {
        const text = `${a.title}\n${a.excerpt ?? ""}`;
        const facts = extractFacts(text, 0);
        const catFacts = facts[category as keyof ExtractedFacts];
        return catFacts && catFacts.length > 0;
      });

    const selectedWithCategory = articlesWithCategory.filter(({ index }) =>
      selectedIndices.includes(index),
    );

    const valuesPresent = new Set<string>();
    for (const { article: a } of selectedWithCategory) {
      const text = `${a.title}\n${a.excerpt ?? ""}`;
      const facts = extractFacts(text, 0);
      const catFacts = facts[category as keyof ExtractedFacts] ?? [];
      for (const f of catFacts) {
        valuesPresent.add(f.value.toLowerCase().trim());
      }
    }

    if (valuesPresent.size < 2 && articlesWithCategory.length > 0) {
      for (const { index } of articlesWithCategory) {
        if (!selectedIndices.includes(index) && selectedIndices.length < 12) {
          selectedIndices.push(index);
        }
      }
    }
  }

  // Step 7: Sort selected indices chronologically
  selectedIndices.sort((a, b) => {
    const dateA = articles[a]?.published_at ? new Date(articles[a]!.published_at).getTime() : 0;
    const dateB = articles[b]?.published_at ? new Date(articles[b]!.published_at).getTime() : 0;
    return dateA - dateB;
  });

  // Step 8: Compute metrics
  const allSelectedFacts = extractAllFacts(selectedIndices.map((i) => articles[i]!));
  const uniqueSelectedFacts = new Set(allSelectedFacts.map((f) => `${f.category}::${f.value}`));
  const totalUniqueFacts = uniqueSelectedFacts.size;

  const allFactKeys = allFacts.map((f) => `${f.category}::${f.value}`);
  const factsLost = allFactKeys.length - new Set(allFactKeys).size;

  let conflictsPreserved = 0;
  for (const category of conflictCategories) {
    const selectedValues = new Set<string>();
    for (const index of selectedIndices) {
      const text = `${articles[index]!.title}\n${articles[index]!.excerpt ?? ""}`;
      const facts = extractFacts(text, 0);
      const catFacts = facts[category as keyof ExtractedFacts] ?? [];
      for (const f of catFacts) {
        selectedValues.add(f.value.toLowerCase().trim());
      }
    }
    if (selectedValues.size >= 2) conflictsPreserved++;
  }

  const tokensPerArticle = 100;
  const promptTokensSaved = (articles.length - selectedIndices.length) * tokensPerArticle;

  return {
    selectedIndices,
    articleFacts: [],
    totalUniqueFacts,
    totalFactsFull,
    factsLost,
    conflictsPreserved,
    sourceAttributionPreserved: true,
    selectedCount: selectedIndices.length,
    promptTokensSaved,
  };
}

// ---------------------------------------------------------------------------
// Deterministic evidence deduplication
// ---------------------------------------------------------------------------

interface DeduplicationResult {
  deduplicatedArticles: DeduplicatedArticle[];
  totalFactsBefore: number;
  totalFactsAfter: number;
  factsRemoved: number;
}

interface DeduplicatedArticle {
  index: number;
  title: string;
  sourceId: string | null;
  originalFacts: ArticleFact[];
  newFacts: ArticleFact[];
  seenCount: number;
}

/**
 * Deduplicate facts across articles, preserving source attribution and conflicts.
 */
export function deduplicateEvidence(articles: EvidenceArticle[]): DeduplicationResult {
  if (articles.length === 0) {
    return { deduplicatedArticles: [], totalFactsBefore: 0, totalFactsAfter: 0, factsRemoved: 0 };
  }

  const allArticleFacts: { index: number; article: EvidenceArticle; facts: ArticleFact[] }[] = [];
  for (const article of articles) {
    const text = `${article.title}\n${article.excerpt ?? ""}`;
    const extracted = extractFacts(text, 0);
    const categories: string[] = [
      "money",
      "percentages",
      "dates",
      "cves",
      "cvss",
      "versions",
      "counts",
      "companies",
      "countries",
      "products",
      "tickers",
      "layoffs",
      "regulatoryActions",
    ];
    const facts: ArticleFact[] = [];
    for (const category of categories) {
      const items = extracted[category as keyof ExtractedFacts] as
        { value: string; label: string; evidence: number[] }[] | undefined;
      if (!items) continue;
      for (const item of items) {
        facts.push({
          category,
          value: item.value.toLowerCase().trim(),
          label: item.label,
          evidence: item.evidence,
          articleIndex: 0,
        });
      }
    }
    allArticleFacts.push({ index: allArticleFacts.length, article, facts });
  }

  const totalFactsBefore = allArticleFacts.reduce((sum, a) => sum + a.facts.length, 0);

  const seenFacts = new Set<string>();
  const deduplicatedArticles: DeduplicatedArticle[] = [];

  for (const { index, article, facts } of allArticleFacts) {
    const newFacts: ArticleFact[] = [];
    let seenCount = 0;

    for (const fact of facts) {
      const key = `${fact.category}::${fact.value}`;
      if (!seenFacts.has(key)) {
        seenFacts.add(key);
        newFacts.push(fact);
      } else {
        // Check if this is a conflict (another article has a different value for same category)
        const isConflict = checkConflict(fact.category, seenFacts, fact.value);
        if (isConflict) {
          newFacts.push(fact);
        } else {
          seenCount++;
        }
      }
    }

    deduplicatedArticles.push({
      index,
      title: article.title,
      sourceId: article.source_id,
      originalFacts: facts,
      newFacts,
      seenCount,
    });
  }

  const totalFactsAfter = deduplicatedArticles.reduce((sum, a) => sum + a.newFacts.length, 0);
  const factsRemoved = totalFactsBefore - totalFactsAfter;

  return { deduplicatedArticles, totalFactsBefore, totalFactsAfter, factsRemoved };
}

function checkConflict(category: string, seenFacts: Set<string>, value: string): boolean {
  for (const seenKey of seenFacts) {
    if (seenKey.startsWith(`${category}::`) && !seenKey.endsWith(value)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Shadow metrics computation
// ---------------------------------------------------------------------------

/**
 * Compute shadow metrics comparing full evidence against selected/deduplicated evidence.
 */
export function computeEvidenceShadowMetrics(
  eventId: string,
  articles: EvidenceArticle[],
): EvidenceShadowMetrics {
  const fullArticleCount = articles.length;
  const selection = selectEvidence(articles);
  const dedup = deduplicateEvidence(articles);

  const totalFacts = selection.totalFactsFull;
  const agreementRate = totalFacts > 0 ? selection.totalUniqueFacts / totalFacts : 1.0;

  const factPreservationDetail = buildFactPreservationDetail(articles, selection);
  const promptTokensSaved = selection.promptTokensSaved + dedup.factsRemoved * 5;

  return {
    eventId,
    fullArticleCount,
    selectedArticleCount: selection.selectedCount,
    factsPreserved: selection.totalUniqueFacts,
    factsLost: selection.factsLost,
    conflictsPreserved: selection.conflictsPreserved,
    sourceAttributionPreserved: selection.sourceAttributionPreserved,
    promptTokensSaved,
    agreementRate: Math.round(agreementRate * 10000) / 10000,
    selectedIndices: selection.selectedIndices,
    factPreservationDetail,
  };
}

function buildFactPreservationDetail(
  articles: EvidenceArticle[],
  selection: EvidenceSelectionResult,
): FactPreservationDetail[] {
  const detail: FactPreservationDetail[] = [];
  const categories = new Set<string>();

  for (const article of articles) {
    const text = `${article.title}\n${article.excerpt ?? ""}`;
    const facts = extractFacts(text, 0);
    for (const cat of Object.keys(facts)) categories.add(cat);
  }

  for (const category of categories) {
    const fullCount = countFactsByCategory(articles, category);
    const preservedCount = countFactsByCategory(
      selection.selectedIndices.map((i) => articles[i]!),
      category,
    );
    const lostCount = fullCount - preservedCount;
    const conflictCount = countConflictsByCategory(
      selection.selectedIndices.map((i) => articles[i]!),
      category,
    );

    detail.push({ category, fullCount, preservedCount, lostCount, conflictCount });
  }

  return detail;
}

function countFactsByCategory(articles: EvidenceArticle[], category: string): number {
  let count = 0;
  for (const article of articles) {
    const text = `${article.title}\n${article.excerpt ?? ""}`;
    const facts = extractFacts(text, 0);
    const catFacts = facts[category as keyof ExtractedFacts];
    if (catFacts) count += catFacts.length;
  }
  return count;
}

function countConflictsByCategory(articles: EvidenceArticle[], category: string): number {
  const values = new Set<string>();
  for (const article of articles) {
    const text = `${article.title}\n${article.excerpt ?? ""}`;
    const facts = extractFacts(text, 0);
    const catFacts = facts[category as keyof ExtractedFacts] ?? [];
    for (const f of catFacts) {
      values.add(f.value.toLowerCase().trim());
    }
  }
  return values.size > 1 ? values.size : 0;
}

// ---------------------------------------------------------------------------
// Coverage text generation for shadow comparison
// ---------------------------------------------------------------------------

/**
 * Generate the coverage text that would be sent to the model with selected evidence.
 * This is used for shadow comparison only — never sent to the model in production.
 */
export function renderSelectedCoverage(
  articles: EvidenceArticle[],
  selectedIndices: number[],
  total: number,
  outlets: Map<string, string>,
): string {
  const selected = selectedIndices
    .map((i) => articles[i]!)
    .filter((a): a is EvidenceArticle => a !== undefined);
  const shown = selected.length;

  const header =
    shown === total
      ? `${total} article${total === 1 ? "" : "s"} about one event, oldest first.`
      : `${total} articles about one event. The ${shown} highest-evidence are below.`;

  const body = selected.map((article, i) => {
    const outlet = article.source_id ? outlets.get(article.source_id) : undefined;
    const when = article.published_at?.slice(0, 10);
    const meta = [outlet, when]
      .filter((part): part is string => part !== undefined && part !== "")
      .join(", ");
    const excerpt = (article.excerpt ?? "").trim().replace(/\s+/g, " ");

    return [
      `${i + 1}. ${article.title}${meta === "" ? "" : ` (${meta})`}`,
      excerpt === "" ? null : `   ${excerpt.slice(0, 400)}${excerpt.length > 400 ? "..." : ""}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  });

  return `${header}\n\n${body.join("\n\n")}`;
}
