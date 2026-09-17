import {
  extractMoney,
  extractPercentages,
  extractCompanies,
  extractCountries,
  extractProducts,
} from "./extract";
import { sentences, repeats, isEvidenceBoilerplate, type EvidenceUnit } from "@/lib/understand";

/**
 * Turning one article's extracted main text into a bounded set of short,
 * evidence-cited facts -- never the article itself.
 *
 * Sentences are *scored and reordered*, not taken in source order: printing
 * the highest-density facts first (rather than the first N sentences as they
 * appeared) is what keeps this a selection of facts rather than something
 * that "substantially mirrors the source's phrasing/order", which is the
 * copyright line this whole feature has to stay on the right side of.
 */

const QUOTE_TRAILING_RE =
  /"([^"]{15,200})"\s*,?\s*(?:said|says|told\s+\w+|according to)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/g;
const QUOTE_LEADING_RE =
  /([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})\s+(?:said|says)[,:]?\s*"([^"]{15,200})"/g;

const UNCERTAIN_PATTERNS = [
  /\bhas not\b/i,
  /\bhave not\b/i,
  /\bdid not\b/i,
  /\bdeclined to\b/i,
  /\bunclear\b/i,
  /\bunconfirmed\b/i,
  /\byet to\b/i,
  /\bno immediate\b/i,
  /\bcould not immediately\b/i,
  /\bhas yet to\b/i,
];

export function extractQuotes(text: string): { quote: string; attribution: string }[] {
  const out: { quote: string; attribution: string }[] = [];
  const seen = new Set<string>();
  const passes: [RegExp, "trailing" | "leading"][] = [
    [QUOTE_TRAILING_RE, "trailing"],
    [QUOTE_LEADING_RE, "leading"],
  ];
  for (const [pattern, shape] of passes) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const [quote, attribution] =
        shape === "trailing" ? [match[1], match[2]] : [match[2], match[1]];
      if (!quote || !attribution) continue;
      const key = quote.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ quote: quote.trim(), attribution: attribution.trim().replace(/\.$/, "") });
      if (out.length >= 4) break;
    }
  }
  return out;
}

function entitiesIn(text: string): string[] {
  const names = [
    ...extractCompanies(text, 0).map((h) => h.value),
    ...extractProducts(text, 0).map((h) => h.value),
    ...extractCountries(text, 0).map((h) => h.value),
  ];
  return [...new Set(names)].slice(0, 4);
}

function factDensity(text: string): number {
  return (
    extractMoney(text, 0).length * 3 +
    extractPercentages(text, 0).length * 3 +
    extractCompanies(text, 0).length * 2 +
    extractProducts(text, 0).length * 2 +
    extractCountries(text, 0).length +
    (/\d/.test(text) ? 1 : 0)
  );
}

export const MAX_EVIDENCE_UNITS = 12;

/** `mainText` is the already-extracted, script/nav/footer-stripped body -- see `html-text.ts`. */
export function selectEvidenceUnits(
  mainText: string,
  maxUnits = MAX_EVIDENCE_UNITS,
): EvidenceUnit[] {
  const quotes = extractQuotes(mainText)
    .filter((q) => !isEvidenceBoilerplate(q.quote))
    .slice(0, 3);
  const quoteKeys = quotes.map((q) => q.quote.toLowerCase());

  const candidates = sentences(mainText)
    .map((text) => text.trim())
    .filter((text) => text.length >= 40 && text.length <= 320)
    .filter((text) => !isEvidenceBoilerplate(text))
    .filter((text) => !quoteKeys.some((q) => text.toLowerCase().includes(q)));

  const scored = candidates
    .map((text) => ({
      text,
      score: factDensity(text),
      uncertain: UNCERTAIN_PATTERNS.some((p) => p.test(text)),
    }))
    .sort((a, b) => b.score - a.score);

  const kept: EvidenceUnit[] = [];
  const keptTexts: string[] = [];
  for (const item of scored) {
    if (kept.length >= maxUnits) break;
    if (keptTexts.some((existing) => repeats(existing, item.text))) continue;
    keptTexts.push(item.text);
    const entities = entitiesIn(item.text);
    kept.push({
      kind: item.uncertain ? "uncertain" : "fact",
      text: item.text.slice(0, 320),
      ...(entities.length ? { entities } : {}),
    });
  }

  for (const q of quotes) {
    kept.push({
      kind: "quote",
      text: q.quote.slice(0, 200),
      attribution: q.attribution.slice(0, 80),
    });
  }

  return kept;
}
