import {
  extractMoney,
  extractPercentages,
  extractCompanies,
  extractCountries,
  extractProducts,
} from "./extract";
import { sentences, repeats, isEvidenceBoilerplate, type EvidenceUnit } from "@/lib/understand";
import {
  cleanDeterministicSentence,
  isCutSentence,
  validDeterministicSentence,
} from "@/lib/reader-evidence";
import { evidenceScore, rankEntities } from "../reader-evidence";
import { normalizeSourceText, type SourceContext } from "./source-text";

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

/** The stored unit's character bound -- the copyright-safety cap the tests pin. */
export const MAX_UNIT_CHARS = 320;
/** A cut below this many characters is a stub, not a fact, so the unit is dropped. */
const MIN_CUT_CHARS = 120;

/**
 * A unit is a sentence or it is not stored.
 *
 * The bound used to be a plain `slice(0, 320)`, which stops mid-word: the corpus
 * stored "...delivering " (PyTorch), "...after a deployment of An" (TechCrunch)
 * and "...into the Pacific O" (The Guardian) -- text a reader can see, ending in
 * the middle of a word. A sentence that does not fit is now cut at its last full
 * stop inside the bound, so whole sentences are kept instead of fragments; one
 * with no boundary in range is dropped, because a fragment is not a fact.
 */
export function boundUnitText(text: string): string | null {
  if (text.length <= MAX_UNIT_CHARS) return text;
  const window = text.slice(0, MAX_UNIT_CHARS);
  const cut = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf('."'),
    window.lastIndexOf(".”"),
  );
  if (cut + 1 < MIN_CUT_CHARS) return null;
  return window.slice(0, cut + 1);
}

/**
 * `mainText` is the already-extracted, script/nav/footer-stripped body -- see
 * `html-text.ts`.
 *
 * Source normalization runs here, before sentence splitting and validity, so a
 * provider's metadata header never becomes a candidate fact in the first place.
 * `source` is optional because the same function serves fixtures and pages whose
 * origin adds nothing; when it is given, arXiv-shaped text gets the extra
 * treatment `source-text.ts` documents.
 */
export function selectEvidenceUnits(
  mainText: string,
  maxUnits = MAX_EVIDENCE_UNITS,
  title = "",
  source?: SourceContext,
): EvidenceUnit[] {
  // Normalize the whole body first, then each candidate, because a `<p>` block
  // can itself begin with a header field when a page mixes prose and metadata.
  const body = normalizeSourceText(source, mainText).text;
  if (body === "") return [];

  const quotes = extractQuotes(body)
    .filter((q) => !isEvidenceBoilerplate(`${q.attribution} said: "${q.quote}"`))
    .slice(0, 3);
  const quoteKeys = quotes.map((q) => q.quote.toLowerCase());

  const candidates = sentences(body)
    .map((text) => normalizeSourceText(source, text))
    .filter((unit) => !unit.metadataOnly)
    .map((unit) => cleanDeterministicSentence(unit.text))
    .filter((text) => validDeterministicSentence(text))
    // Storage holds the block verbatim, so a block that was cut -- a page's
    // extraction stopping before its stop, a caption seam's punctuationless head
    // -- is refused here rather than stored and printed as a sentence later.
    .filter((text) => !isCutSentence(text))
    .filter((text) => !isEvidenceBoilerplate(text))
    .filter((text) => !quoteKeys.some((q) => text.toLowerCase().includes(q)));

  const entities = rankEntities(title, [{ excerpt: body }]);
  const scored = candidates
    .map((text) => ({
      text,
      score: evidenceScore(text, title, entities) + factDensity(text),
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
    const bounded = boundUnitText(item.text);
    if (bounded === null) continue;
    kept.push({
      kind: item.uncertain ? "uncertain" : "fact",
      text: bounded,
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
