/**
 * Deterministic event signals — a conservative pre-scorer for analysis depth.
 *
 * This module does NOT replace AI importance/novelty scoring. It exists to
 * help the pipeline choose between a thin and a full analysis contract for
 * events where the answer is obvious from deterministic signals alone.
 *
 * Signals are deliberately coarse. The goal is to catch:
 *   - routine CI refs and single-source blog posts (low importance)
 *   - CVEs, regulatory actions, acquisitions (high importance)
 *   - breaking vs. follow-up coverage (novelty)
 *
 * When confidence is "high" and the estimate is at an extreme, the pipeline
 * can use a thinner AI contract. When confidence is "low" or the estimate is
 * in the ambiguous middle, the full contract is used and the AI decides.
 *
 * See docs/track.md phase 7+ for the shadow measurement framework that
 * validated these replacements.
 */

import type { ExtractedFacts } from "./extract";

export interface EventSignals {
  importanceEstimate: number;
  noveltyEstimate: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

const HIGH_IMPORTANCE_EVENT_TYPES = new Set([
  "cve",
  "cvss",
  "regulatory",
  "acquisition",
  "funding",
  "layoff",
]);

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function scoreEvent(
  articles: { title: string; excerpt: string | null; published_at: string | null }[],
  facts: ExtractedFacts,
): EventSignals {
  const reasons: string[] = [];
  let importance = 0;
  let novelty = 0;

  const totalSources = articles.length;
  if (totalSources <= 1) {
    importance -= 1;
    reasons.push("single source");
  } else if (totalSources >= 5) {
    importance += 2;
    reasons.push("many sources");
  } else if (totalSources >= 3) {
    importance += 1;
    reasons.push("multiple sources");
  }

  const now = Date.now();
  const newestTimestamp = articles.reduce((max, a) => {
    const t = a.published_at ? new Date(a.published_at).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const hoursOld = newestTimestamp > 0 ? (now - newestTimestamp) / (1000 * 60 * 60) : Infinity;

  if (hoursOld < 6) {
    importance += 1;
    novelty += 1;
    reasons.push("breaking");
  } else if (hoursOld < 24) {
    importance += 0;
    novelty += 0;
    reasons.push("recent");
  } else if (hoursOld > 72) {
    importance -= 1;
    reasons.push("old");
  }

  const cveFacts = facts.cves ?? [];
  if (cveFacts.length > 0) {
    importance += 2;
    reasons.push("CVE");
  }

  const cvssFacts = facts.cvss ?? [];
  if (cvssFacts.length > 0) {
    const highCvss = cvssFacts.some((f) => {
      const n = Number.parseFloat(f.value);
      return Number.isFinite(n) && n >= 7.0;
    });
    if (highCvss) {
      importance += 1;
      reasons.push("high CVSS");
    }
  }

  const regulatoryFacts = facts.regulatoryActions ?? [];
  if (regulatoryFacts.length > 0) {
    importance += 2;
    reasons.push("regulatory action");
  }

  const moneyFacts = facts.money ?? [];
  if (moneyFacts.length > 0) {
    importance += 1;
    reasons.push("financial figure");
  }

  const companyFacts = facts.companies ?? [];
  if (companyFacts.length > 0) {
    importance += 1;
    reasons.push("named companies");
  }

  const productFacts = facts.products ?? [];
  if (productFacts.length > 0) {
    importance += 0;
    reasons.push("named products");
  }

  const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n");
  const wordCount = countWords(fullText);
  if (wordCount < 100 && totalSources <= 1) {
    importance -= 1;
    reasons.push("thin coverage");
  }

  let confidence: "high" | "medium" | "low";
  if (importance <= 1 || importance >= 7) {
    confidence = "high";
  } else if (importance >= 5) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    importanceEstimate: Math.round(Math.min(10, Math.max(0, importance))),
    noveltyEstimate: Math.round(Math.min(10, Math.max(0, novelty))),
    confidence,
    reasons,
  };
}
