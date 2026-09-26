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
 * `coverage_changed_at`, which the attachment trigger stamps whenever an article
 * attaches (0102). Not the
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
 *   - **Identity.** The CVEs the coverage is about, and the releases it names
 *     (`version:2.0`). Stable identifiers, not every proper noun in the text: a
 *     new principal entering the story is only a development when it arrives
 *     with a version or a CVE, which is the narrow claim this module can
 *     actually keep. (The previous comment here claimed companies and
 *     countries; the code never extracted them, and this comment now describes
 *     what it does.)
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
import { markersIn, releaseIdentity } from "./marker-packs";

/*
 * Development markers -- the status transitions that make an event a different
 * event -- are defined once, in `marker-packs.ts`, per language. This module
 * used to carry its own copy of the English list; two copies of a rule are two
 * rules, and they had already begun to differ (see that file). Each marker is a
 * *destination* state: it fires when coverage contains the phrase, regardless of
 * what it said before, because comparing against a previous state would need the
 * previous coverage text, which nothing keeps.
 *
 * Kept small on purpose. Every marker is a new reason to spend money and to
 * re-deliver, so a marker earns its place by naming a transition a reader would
 * be misinformed by not seeing.
 */

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

  // Every language pack the text is written in, plus the version-gated release
  // stages -- one definition, in `marker-packs.ts`.
  const markers = markersIn(coverageText);

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

  const entities = [
    ...extracted.cves.map((c) => `cve:${c.value}`),
    // `2.0` announced and `2.0` at release-candidate are two material states
    // even before the stage markers are considered; this is the identity half.
    ...releaseIdentity(coverageText).versions.map((version) => `version:${version}`),
  ];

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
export const MATERIAL_VERSION_SCHEME = 2;

/**
 * The revision of the marker *rules*, stamped on the fingerprint an event stores.
 *
 * Distinct from `MATERIAL_VERSION_SCHEME` because the two protect different
 * things. The scheme invalidates the Understand cache, which costs money to
 * refill, so it moves only when every cached explanation is genuinely stale.
 * This one protects the *revision* decision: when the rules change, a stored
 * fingerprint computed under the old rules differs from today's for reasons
 * that have nothing to do with the story, and comparing the two would advance a
 * revision -- and re-deliver -- on a code change. A stamp mismatch is therefore
 * a re-baseline, never a development (see `decideMaterialRevision`).
 *
 *   (none)  0097: the English list and the first language packs
 *   3       bare `RC`, version-gated CJK stages, one canonical marker source
 */
export const MATERIAL_RULES_REVISION = 3;

/** The stamp in front of a stored fingerprint: `v2r3`. */
export function materialStamp(): string {
  return `v${MATERIAL_VERSION_SCHEME}r${MATERIAL_RULES_REVISION}`;
}

/**
 * The fingerprint `finish_event_finalization` stores for this coverage.
 *
 * The one place the stored form is built, so the pipeline and the tests cannot
 * disagree about the stamp.
 */
export function storedMaterialFingerprint(coverageText: string): string {
  return `${materialStamp()}|${materialFingerprint(materialState(coverageText))}`;
}

/** The stamp of a stored fingerprint: everything before the first `|`. */
function stampOf(fingerprint: string): string {
  const at = fingerprint.indexOf("|");
  return at < 0 ? fingerprint : fingerprint.slice(0, at);
}

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

/* ---------------------------------------------------------------------------
 * The two clocks
 * ------------------------------------------------------------------------- */

/**
 * When the coverage actually happened, as far as the world's timestamps go.
 *
 * The newest `published_at` in an event's coverage, or null when not one
 * article carries a date. Deliberately the *publication* time and not the
 * fetch time: an old article discovered today was published when it was
 * published, and the whole point of keeping this separate from
 * `last_material_change_at` is that ingestion must never be able to age a
 * story forward.
 */
export function latestPublishedAt(
  articles: readonly { published_at: string | null }[],
): string | null {
  let newest: number | null = null;
  let newestIso: string | null = null;
  for (const article of articles) {
    if (!article.published_at) continue;
    const at = Date.parse(article.published_at);
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest) {
      newest = at;
      newestIso = article.published_at;
    }
  }
  return newestIso;
}

export type MaterialRevisionDecision = {
  /** True when the event's revision must advance. */
  changed: boolean;
  /** The fingerprint worth storing, or null to leave the stored one alone. */
  fingerprint: string | null;
  /**
   * When the newly established material state's evidence was published. Null
   * when the decision is not to advance.
   */
  occurrenceAt: string | null;
  /** Why, in one word, for the pipeline report and for tests. */
  reason:
    "first_finalization" | "rules_changed" | "material_change" | "unchanged" | "stale_evidence";
};

/**
 * Whether a finalization advances the event's material revision.
 *
 * Three cases, and the third is the one the product turns on:
 *
 *   - **First finalization.** Adopt the state and its occurrence time, advance
 *     no revision. An event a reader has never seen has nothing to re-deliver.
 *   - **Material change.** The fingerprint moved *and* the coverage contains
 *     evidence published after the state we already recorded. The revision
 *     advances and the occurrence moves to that evidence's publication time --
 *     not to `now`, so a development reported last week is dated last week.
 *   - **Stale evidence.** The fingerprint moved but no article is newer than
 *     what established the current state: a rehash or a late-discovered copy
 *     that happens to mention a new number. No revision, and the stored
 *     fingerprint is left alone so a later genuine change is still measured
 *     against the state the reader actually received.
 *
 * The fourth outcome is the boring one: nothing moved, so nothing happens.
 * `now` is accepted for symmetry with the callers and is deliberately unused --
 * the decision is a function of evidence, never of wall-clock time.
 */
export function decideMaterialRevision(input: {
  storedFingerprint: string | null;
  storedOccurrenceAt: string | null;
  nextFingerprint: string;
  latestPublishedAt: string | null;
  now: Date;
}): MaterialRevisionDecision {
  if (input.storedFingerprint === null) {
    return {
      changed: false,
      fingerprint: input.nextFingerprint,
      occurrenceAt: input.latestPublishedAt,
      reason: "first_finalization",
    };
  }

  // Measured under different rules: the difference is the code's, not the
  // story's. Adopt today's reading of the same coverage and keep the stored
  // occurrence, exactly as a first finalization would -- a rules change must
  // never be what re-delivers a story. The cost is honest and paid once per
  // event: a genuine development that lands in the very run that re-baselines
  // is absorbed into the new baseline rather than delivered as a revision.
  // Every later development is measured against a fingerprint computed under
  // the rules that will judge it.
  if (stampOf(input.storedFingerprint) !== stampOf(input.nextFingerprint)) {
    return {
      changed: false,
      fingerprint: input.nextFingerprint,
      occurrenceAt: null,
      reason: "rules_changed",
    };
  }

  if (input.storedFingerprint === input.nextFingerprint) {
    return { changed: false, fingerprint: null, occurrenceAt: null, reason: "unchanged" };
  }

  const newest = input.latestPublishedAt === null ? null : Date.parse(input.latestPublishedAt);
  const previous = input.storedOccurrenceAt === null ? null : Date.parse(input.storedOccurrenceAt);

  // Strictly newer, and undated coverage counts as not newer: an event whose
  // state changed on evidence we cannot date is not a revision, because
  // freshness cannot be claimed for it.
  const advanced =
    newest !== null &&
    Number.isFinite(newest) &&
    (previous === null || !Number.isFinite(previous) || newest > previous);

  if (!advanced) {
    return { changed: false, fingerprint: null, occurrenceAt: null, reason: "stale_evidence" };
  }

  return {
    changed: true,
    fingerprint: input.nextFingerprint,
    occurrenceAt: input.latestPublishedAt,
    reason: "material_change",
  };
}
