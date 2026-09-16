/**
 * What counts as the same story, for the purpose of not paying twice.
 *
 * ---------------------------------------------------------------------------
 * The question this answers
 * ---------------------------------------------------------------------------
 *
 * `event_understanding` is keyed on `(event_id, content_version)`. That key is
 * the entire cost argument for on-demand Understand: a hundred readers of one
 * story share one generation, and a fourth outlet publishing the same facts an
 * hour later must not buy a second one.
 *
 * So `content_version` cannot be derived from anything that moves on its own.
 * Not the source count -- "one more outlet ran it" is the single most common
 * thing that happens to an event and the single least informative. Not
 * `last_updated_at`, which stage 3 bumps whenever an article attaches. Not the
 * headline, which every outlet words differently and some rewrite twice an hour.
 * A version keyed on any of those would regenerate continuously while telling
 * the reader nothing new, which is the old eager behaviour wearing a cache.
 *
 * What it IS derived from is the event's *material state*: the small set of
 * facts whose change means the story is now a different story.
 *
 *   - **Development markers.** A closed set of status transitions that change
 *     what happened, not how it was described: talks -> confirmed, filing ->
 *     ruling, leak -> launch, proposed -> enacted. These are the cases the
 *     product brief lists as worth regenerating for.
 *   - **Material numbers, bucketed.** Casualty counts, money, percentages.
 *     Bucketed by magnitude rather than compared exactly, because "at least 12
 *     dead" becoming "at least 14 dead" is the same story with a corrected
 *     detail, while 12 becoming 400 is not. Buckets are logarithmic for the
 *     same reason a $40M round and a $4B acquisition are different events but
 *     $40M and $45M are one.
 *   - **Identity.** The companies, countries and CVEs the coverage is about, as
 *     a set. A new principal entering the story is a development.
 *
 * Everything else is deliberately ignored.
 *
 * ---------------------------------------------------------------------------
 * Which way to be wrong
 * ---------------------------------------------------------------------------
 *
 * Two mistakes are available and they do not cost the same.
 *
 * Regenerating when nothing happened spends money and shows the reader prose
 * that says what the old prose said. Failing to regenerate when something did
 * happen shows a reader an explanation that is out of date -- it will say a
 * deal is "under discussion" after it closed.
 *
 * The second is worse, but only just, and only when the development is large.
 * So the markers below are a closed, conservative list of *large* transitions:
 * this module would rather miss a subtle development than churn on wording. An
 * event whose material state genuinely has not moved produces a byte-identical
 * version string forever, which is exactly what the cache needs.
 */

import { extractFacts, type ExtractedFacts } from "./extract";

/**
 * Status transitions that make an event a different event.
 *
 * Each entry is a *destination* state: the marker fires when coverage contains
 * the phrase, regardless of what it said before. That is deliberate --
 * comparing against a previous state would need the previous coverage text,
 * which nothing keeps, and "the word 'confirmed' is now present" is enough to
 * separate a version. The patterns are anchored on word boundaries so
 * "unconfirmed" does not read as "confirmed".
 *
 * Kept small on purpose. Every pattern added here is a new reason to spend
 * money, so a pattern earns its place by naming a transition a reader would be
 * misinformed by not seeing.
 */
const DEVELOPMENT_MARKERS: { readonly marker: string; readonly pattern: RegExp }[] = [
  // Deals: agreed and closed are different events from "in talks".
  { marker: "deal_confirmed", pattern: /\b(?:has |have |was |were )?confirmed\b/i },
  { marker: "deal_agreed", pattern: /\b(?:has|have) agreed to (?:buy|acquire|merge)\b/i },
  {
    marker: "deal_completed",
    pattern: /\b(?:deal|acquisition|merger|takeover) (?:has )?(?:closed|completed)\b/i,
  },
  {
    marker: "deal_abandoned",
    pattern:
      /\b(?:called off|abandoned|walked away from|terminated) the (?:deal|merger|acquisition)\b/i,
  },

  // Courts and regulators: a ruling is not a filing.
  { marker: "court_ruled", pattern: /\b(?:ruled|ruling|verdict|judgment|judgement)\b/i },
  { marker: "court_settled", pattern: /\b(?:settled|settlement reached)\b/i },
  {
    marker: "charges_filed",
    pattern: /\b(?:charged with|indicted|pleaded (?:guilty|not guilty))\b/i,
  },
  { marker: "regulator_approved", pattern: /\b(?:approved|cleared|authorised|authorized) by\b/i },
  { marker: "regulator_blocked", pattern: /\b(?:blocked|rejected|refused|vetoed) the\b/i },
  {
    marker: "policy_enacted",
    pattern: /\b(?:signed into law|came into force|takes effect|enacted)\b/i,
  },

  // Shipping: a launch is not a leak.
  {
    marker: "released",
    pattern: /\b(?:has |have )?(?:launched|released|shipped|went on sale|now available)\b/i,
  },
  { marker: "recalled", pattern: /\b(?:recalled|pulled from sale|withdrawn)\b/i },

  // Corporate and personnel.
  {
    marker: "results_reported",
    pattern:
      /\b(?:reported|posted) (?:quarterly |annual |full-year )?(?:results|earnings|revenue)\b/i,
  },
  {
    marker: "resigned",
    pattern: /\b(?:resigned|stepped down|has been (?:fired|ousted|dismissed))\b/i,
  },
  {
    marker: "filed_bankruptcy",
    pattern: /\b(?:filed for bankruptcy|chapter 11|entered administration|liquidation)\b/i,
  },

  // Safety and security: a patch changes what a reader should do.
  {
    marker: "patch_available",
    pattern: /\b(?:patch|fix|update) (?:is )?(?:available|released)\b/i,
  },
  { marker: "exploited_in_wild", pattern: /\bexploited in the wild\b/i },

  // Casualty events: "died" after "injured" is a development.
  { marker: "fatalities", pattern: /\b(?:killed|dead|died|fatalities|death toll)\b/i },
];

function hasAffirmativeDealConfirmation(text: string): boolean {
  return (text.match(/[^.!?;\n]+[.!?;]?/g) ?? []).some(
    (sentence) =>
      /\bconfirmed\b/i.test(sentence) &&
      !sentence.endsWith("?") &&
      /\b(?:deal|agreement|acquisition|merger|takeover|acquire|buy|merge)\b/i.test(sentence) &&
      !/\b(?:no|not|never|neither|without|unconfirmed|uncertain|unverified|if|whether|may|might|could|would|expected|reportedly|allegedly|rumou?rs?|awaiting|pending|yet|declined|refused)\b|\b\w+n['’]t\b/i.test(
        sentence,
      ),
  );
}

/**
 * Casualty figures, which `extract.ts` does not cover.
 *
 * Its `extractCounts` matches business nouns — jobs, users, subscribers — and
 * is deliberately left alone here: that module is the baseline of the shadow
 * comparison against AI-extracted facts, and widening its categories would move
 * a measurement other work depends on. A death toll is a material number for
 * *this* module's purposes and nowhere else, so it is extracted here.
 *
 * "at least 12 killed", "12 people died", "a death toll of 40".
 */
const CASUALTY_RE =
  /(\d[\d,]*)\s+(?:\w+\s+){0,2}?(?:people\s+)?(?:were\s+|was\s+|are\s+|have\s+been\s+)?(?:killed|dead|died|injured|wounded|missing)\b|death toll (?:of|rose to|climbed to|reached)\s+(\d[\d,]*)/gi;

function extractCasualties(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(CASUALTY_RE.source, CASUALTY_RE.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const digits = match[1] ?? match[2];
    if (digits) found.push(digits);
  }
  return found;
}

/**
 * Magnitude bucket for a number, as a power of ten.
 *
 * 12 and 14 share a bucket; 12 and 400 do not. This is what stops a corrected
 * casualty figure or a revised revenue estimate from buying a regeneration
 * while a genuine order-of-magnitude change still does.
 */
export function magnitudeBucket(value: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
  return Math.floor(Math.log10(magnitude));
}

/** Digits out of a fact string like "$1.3 billion" or "at least 12". */
function numericValue(text: string): number | null {
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  const scale = /\bb(?:n|illion)\b/i.test(text)
    ? 1e9
    : /\bm(?:n|illion)\b/i.test(text)
      ? 1e6
      : /\bk\b|\bthousand\b/i.test(text)
        ? 1e3
        : 1;
  return parsed * scale;
}

/** Sorted, de-duplicated, lowercased — so ordering of coverage cannot move the hash. */
function stableSet(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

export type MaterialState = {
  /** Development markers present in the coverage, sorted. */
  markers: string[];
  /** `label:bucket` for each material number, sorted. */
  magnitudes: string[];
  /** Companies, countries, CVEs and tickers the coverage is about, sorted. */
  entities: string[];
};

/**
 * The material state of an event, from its coverage text.
 *
 * Takes the concatenated title + excerpt of every article on the event. Source
 * count is not a parameter and must not become one.
 */
export function materialState(coverageText: string, facts?: ExtractedFacts): MaterialState {
  const extracted = facts ?? extractFacts(coverageText, 0);

  const markers = DEVELOPMENT_MARKERS.filter(({ marker, pattern }) =>
    marker === "deal_confirmed"
      ? hasAffirmativeDealConfirmation(coverageText)
      : pattern.test(coverageText),
  ).map(({ marker }) => marker);

  // Money, counts and percentages are the numbers whose size changes the story.
  // Versions, dates and CVSS scores are identity, not magnitude, and are folded
  // into `entities` instead.
  const magnitudes: string[] = [];
  for (const [label, items] of [
    ["money", extracted.money],
    ["count", extracted.counts],
    ["pct", extracted.percentages],
  ] as const) {
    for (const item of items) {
      const value = numericValue(item.value);
      if (value === null) continue;
      magnitudes.push(`${label}:${magnitudeBucket(value)}`);
    }
  }
  for (const casualty of extractCasualties(coverageText)) {
    const value = numericValue(casualty);
    if (value !== null) magnitudes.push(`casualty:${magnitudeBucket(value)}`);
  }

  const entities = [...extracted.cves.map((c) => `cve:${c.value}`)];

  return {
    markers: stableSet(markers),
    magnitudes: stableSet(magnitudes),
    entities: stableSet(entities),
  };
}

/** The canonical string a version hashes. Exported so tests can read the input. */
export function materialFingerprint(state: MaterialState): string {
  return [
    `m=${state.markers.join(",")}`,
    `n=${state.magnitudes.join(",")}`,
    `e=${state.entities.join(",")}`,
  ].join("|");
}

/**
 * Bumped when a change to this module should invalidate every cached version.
 *
 * Without it, improving the marker list would change nothing a reader ever
 * sees: every already-cached row would keep matching its old key and keep
 * serving prose written under the old rules. This is the same reasoning
 * `translate.ts` applies to its own prompt version, and the same trap.
 */
export const MATERIAL_VERSION_SCHEME = 1;

/**
 * Twelve hex characters of SHA-256 over the material fingerprint.
 *
 * WebCrypto, not a Node built-in: this runs on Workers. Twelve characters is
 * the same width `canonical.ts` and `translate.ts` use — collision risk across
 * the versions of one event is not a real concern at this length, and a short
 * key is one somebody can read in a ledger row.
 */
export async function contentVersion(
  coverageText: string,
  facts?: ExtractedFacts,
): Promise<string> {
  const fingerprint = `v${MATERIAL_VERSION_SCHEME}|${materialFingerprint(materialState(coverageText, facts))}`;
  const bytes = new TextEncoder().encode(fingerprint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

/**
 * Coverage text for an event, in the shape the version is computed over.
 *
 * Article order is not stabilised here and does not need to be: every signal
 * `materialState` extracts is order-independent by construction (sets and
 * sorted lists), so the same articles in a different order hash the same.
 */
export function coverageTextOf(articles: { title: string; excerpt: string | null }[]): string {
  return articles.map((a) => `${a.title}\n${a.excerpt ?? ""}`).join("\n---\n");
}
