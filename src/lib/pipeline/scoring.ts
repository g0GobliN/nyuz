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
  /**
   * The moment to judge freshness from. Defaults to now, which is right for the
   * pipeline and wrong for anything replaying history.
   *
   * The freshness term below is worth up to two points and turns negative past
   * 72 hours. Scoring a three-week-old event against today's clock therefore
   * marks it "old" no matter how urgent it was when it broke — so a shadow
   * comparison run against already-analysed events would measure the
   * deterministic scorer against a clock the AI never saw, and report a
   * disagreement this module did not actually have. Callers replaying history
   * must pass the event's own `analysed_at`.
   */
  now: Date = new Date(),
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

  const evaluatedAt = now.getTime();
  const newestTimestamp = articles.reduce((max, a) => {
    const t = a.published_at ? new Date(a.published_at).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const hoursOld =
    newestTimestamp > 0 ? (evaluatedAt - newestTimestamp) / (1000 * 60 * 60) : Infinity;

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

/* ---------------------------------------------------------------------- */
/* v2 — general-news importance/novelty, shadow only                      */
/* ---------------------------------------------------------------------- */

/**
 * Why v1 cannot be patched into this: measured against 1,259 analysed events
 * on 2026-09-12, v1 missed 98.5% of what the model called alert-worthy (67 of
 * 68). The pattern in what it missed is uniform — a Haiti gang attack, two
 * measles deaths, Nvidia's $12.9bn Hugging Face bid, a byelection-triggering
 * resignation, a WeChat worm, an EPA rule change — nearly all reported by ONE
 * outlet at analysis time, because that is what breaking news looks like
 * before the wire catches up. v1's dominant signals are `single source` (-1)
 * and `thin coverage` (-1), which punish exactly the shape of a story that
 * matters enough to report on before anyone else has: 54% of the model's
 * important events were single-source, 53% were thin. Its only positive
 * signals — CVE, CVSS, regulatory action, "a financial figure exists" — cover
 * a narrow slice of what "important" means in general news and fired on well
 * under half of what the model flagged.
 *
 * v2's answer is not "more of the same categories". It is: stop scoring
 * corroboration as importance, and start reading the coverage for *what
 * happened* using the same material-state extraction `event-version.ts`
 * already proved out for a different question (does this event need a new
 * Understand). A death toll, a completed acquisition, a resignation, a
 * regulator's ruling, a zero-day being exploited — these are signals of
 * consequence that do not require five outlets to already exist, and the
 * single-source penalty is suppressed entirely when one of them is present.
 *
 * Still shadow only. `promotionVerdict` decides when — if ever — this
 * replaces the model's importance/novelty, and nothing here is read by the
 * pipeline until it does.
 */

type Category = { name: string; pattern: RegExp; weight: number };

/**
 * Broad on purpose, and independent from `event-version.ts`'s development
 * markers even though the idea rhymes. That module is deliberately
 * conservative — a false "this changed" costs a paid regeneration — so it
 * matches "died" but not "dies", "agreed to buy" but not "confirms plans to
 * buy". Here a false positive costs a reader one extra briefing story (see
 * scoring-shadow.ts's asymmetry argument), so recall matters far more than
 * precision and these patterns are written to catch every common phrasing a
 * wire story uses, not the single most careful one.
 *
 * Weighted by consequence to a reader, not by rarity. Overlap across
 * categories on the same story is expected: "47 killed in a gang attack"
 * should outscore either "someone died" or "there was an attack" alone.
 */
const CATEGORIES: Category[] = [
  {
    name: "casualties",
    pattern:
      /\b(?:killed|kills?|dead|died|dies|dying|death toll|fatalit(?:y|ies)|casualt(?:y|ies)|perished|martyred)\b/i,
    weight: 4,
  },
  {
    name: "conflict",
    pattern:
      /\b(?:air ?strikes?|missile (?:strikes?|attacks?)|attacks?|invades?|invasion|bombing|shootings?|explosions?|hostages?|kidnapp?(?:ed|ing)|gunmen|militants?|terroris[tm]|warfare|ceasefire)\b/i,
    weight: 3,
  },
  {
    name: "disaster",
    pattern:
      /\b(?:earthquake|wildfires?|floodings?|floods?|hurricane|typhoon|tsunami|evacuat(?:ed|ions?)|derail(?:ed|ment)|crash(?:ed|es)?)\b/i,
    weight: 3,
  },
  {
    name: "security incident",
    pattern:
      /\b(?:data breach|breached?|hacked?|hacking|ransomware|exploited(?: in the wild)?|zero-day|malware|leaked|exposed\b|vulnerabilit(?:y|ies))\b/i,
    weight: 2,
  },
  {
    name: "corporate deal",
    pattern:
      /\b(?:to (?:buy|acquire)|acquir(?:es|ed|ing)|to merge|mergers?|merges?|takeovers?|buyouts?|to be acquired)\b/i,
    weight: 2,
  },
  {
    name: "leadership change",
    pattern:
      /\b(?:resigns?|resigned|steps? down|stepping down|ousted|fired|sacked|dismissed|to stand down|indicted|arrested|pleads? guilty|convicted|sentenced)\b/i,
    weight: 2,
  },
  {
    name: "regulatory or legal action",
    pattern:
      /\b(?:bans?|banned|blocks?|blocked|fines?|fined|sues?|sued|lawsuit|rulings?|ruled|court order|investigat(?:es|ed|ion)|sanctions?|tariffs?|antitrust|settlement reached)\b/i,
    weight: 2,
  },
  {
    name: "policy or government action",
    pattern:
      /\b(?:signs? into law|executive order|enacted|passes? (?:a |the )?(?:bill|law)|byelection|impeachment|proposes? (?:a |new )?rule)\b/i,
    weight: 2,
  },
  {
    name: "major announcement",
    pattern: /\b(?:unveils?|launches?|announces?|debuts?|confirms? plans? to)\b/i,
    weight: 1,
  },
];

/** Dollar value of one extracted money fact, or null if unparseable. */
function moneyValue(entry: { value: string }): number | null {
  const match = /-?[\d,]+(?:\.\d+)?/.exec(entry.value);
  if (!match || match.index === undefined) return null;
  const amount = Number.parseFloat(match[0].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const unit = entry.value
    .slice(match.index + match[0].length)
    .trim()
    .toLowerCase();
  const scale = /^(t|tn|trillion)/.test(unit)
    ? 1e12
    : /^(b|bn|billion)/.test(unit)
      ? 1e9
      : /^(m|mn|million)/.test(unit)
        ? 1e6
        : 1;
  return amount * scale;
}

/** The largest sum in the coverage, in dollars, or null when there is none. */
function largestSum(money: ExtractedFacts["money"]): number | null {
  let largest: number | null = null;
  for (const entry of money) {
    const value = moneyValue(entry);
    if (value !== null && (largest === null || value > largest)) largest = value;
  }
  return largest;
}

const CASUALTY_COUNT_RE =
  /(\d[\d,]*)\s+(?:\w+\s+){0,2}?(?:people\s+)?(?:were\s+|was\s+|are\s+|have\s+been\s+)?(?:killed|dead|died|injured|wounded|missing)\b|death toll (?:of|rose to|climbed to|reached)\s+(\d[\d,]*)/gi;

/** The largest reported death/casualty count in the text, or null. */
function largestCasualtyCount(text: string): number | null {
  let largest: number | null = null;
  const re = new RegExp(CASUALTY_COUNT_RE.source, CASUALTY_COUNT_RE.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const digits = (match[1] ?? match[2] ?? "").replace(/,/g, "");
    const n = Number.parseInt(digits, 10);
    if (Number.isFinite(n) && (largest === null || n > largest)) largest = n;
  }
  return largest;
}

export function scoreEventV2(
  articles: { title: string; excerpt: string | null; published_at: string | null }[],
  facts: ExtractedFacts,
  now: Date = new Date(),
): EventSignals {
  const reasons: string[] = [];
  let importance = 0;
  let novelty = 0;

  const fullText = articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n");

  let categoryImportance = 0;
  for (const category of CATEGORIES) {
    if (category.pattern.test(fullText)) {
      categoryImportance += category.weight;
      reasons.push(category.name);
    }
  }
  importance += categoryImportance;

  const sum = largestSum(facts.money);
  const moneyImportance = sum === null ? 0 : sum >= 1e9 ? 3 : sum >= 1e7 ? 2 : sum >= 1e6 ? 1 : 0;
  if (moneyImportance > 0) {
    importance += moneyImportance;
    reasons.push("large sum");
  }

  const casualties = largestCasualtyCount(fullText);
  let casualtyImportance = 0;
  if (casualties !== null) {
    // Any reported death is consequential before its scale is — the model
    // rated a two-death local story a 6. This adds to, not replaces, the
    // "casualties" category weight above.
    casualtyImportance = casualties >= 100 ? 3 : casualties >= 10 ? 2 : 1;
    importance += casualtyImportance;
    reasons.push(`casualty count ${casualties}`);
  }

  // A story worth reporting on before anyone else has is not less important
  // for having one source — it is often the definition of breaking. The
  // source-count penalty below only applies once nothing else already says
  // "this matters".
  const hasSubstance = categoryImportance > 0 || moneyImportance > 0 || casualtyImportance > 0;

  const totalSources = articles.length;
  if (totalSources <= 1) {
    if (!hasSubstance) {
      importance -= 1;
      reasons.push("single source, no substance signal");
    } else {
      reasons.push("single source (substance present)");
    }
  } else if (totalSources >= 5) {
    importance += 2;
    reasons.push("many sources");
  } else if (totalSources >= 3) {
    importance += 1;
    reasons.push("multiple sources");
  }

  const evaluatedAt = now.getTime();
  const newestTimestamp = articles.reduce((max, a) => {
    const t = a.published_at ? new Date(a.published_at).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const hoursOld =
    newestTimestamp > 0 ? (evaluatedAt - newestTimestamp) / (1000 * 60 * 60) : Infinity;

  if (hoursOld < 6) {
    novelty += 2;
    reasons.push("breaking");
  } else if (hoursOld < 24) {
    novelty += 1;
    reasons.push("recent");
  } else if (hoursOld > 72) {
    importance -= 1;
    novelty -= 1;
    reasons.push("old");
  }

  // A substance category firing is itself news of something changing — the
  // strongest deterministic proxy this module has for "this is not a rehash
  // of what a reader already saw".
  if (categoryImportance > 0) {
    novelty += 2;
    reasons.push("substantive development");
  }

  const wordCount = countWords(fullText);
  if (wordCount < 100 && totalSources <= 1 && !hasSubstance) {
    importance -= 1;
    reasons.push("thin coverage");
  }

  let confidence: "high" | "medium" | "low";
  if (hasSubstance || importance <= 0 || importance >= 7) {
    confidence = "high";
  } else if (importance >= 4) {
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
