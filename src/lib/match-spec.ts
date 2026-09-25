/**
 * What an interest means to the matcher, in a shape that can hold aliases.
 *
 * ---------------------------------------------------------------------------
 * Why `terms: string[]` was not enough
 * ---------------------------------------------------------------------------
 *
 * A topic's terms were derived from its label and matched with AND across all of
 * them. That is precise and it is why it never went wrong loudly, but it cannot
 * express the most ordinary fact about how a subject is named: a subject has more
 * than one name. Someone following "Arsenal" wants the North London derby, and
 * someone following "Japanese underground electronic music" wants a Tokyo label's
 * new release. Neither has all of their words in the coverage, and both were
 * therefore invisible.
 *
 * The specification below keeps the precision and adds the missing axis:
 *
 *   require   groups that must all be satisfied; a group is satisfied by ANY of
 *             its terms. `[["arsenal","gunners","north london derby"]]` is one
 *             subject with three names. `[["rust"],["compiler"]]` is two
 *             constraints, which is what "Rust" plus "compiler" means.
 *   optional  boosts ranking and never admits. A guess about a synonym lives
 *             here until evidence promotes it -- see `promotionCandidates`.
 *   exclude   vetoes the event for this topic. Evaluated as part of the match,
 *             before the reader's own exclusions, which still win last.
 *
 * ---------------------------------------------------------------------------
 * The degenerate case is today's behaviour, exactly
 * ---------------------------------------------------------------------------
 *
 * `deriveSpec(label)` produces one group per derived term, each holding that one
 * term -- AND across terms, which is precisely what `matchesTerms` did. So a
 * topic with no stored spec keeps matching exactly as it did, and the property is
 * tested rather than asserted in a comment.
 *
 * ---------------------------------------------------------------------------
 * Language
 * ---------------------------------------------------------------------------
 *
 * Terms are normalised with the same function the pipeline uses on event text
 * (`topics.normaliseText`), which is script-aware: Latin accents fold, and Han,
 * kana, Hangul and Devanagari survive as themselves. A term may carry the
 * language it was written in, so an enriched spec can hold a Japanese alias
 * beside an English one without either being transliterated into the other.
 */

import { mentions, normaliseText, topicTerms } from "./topics";

/** One way of naming the subject. */
export type MatchTerm = {
  /** The text to look for. Normalised at evaluation time, so it may be raw. */
  text: string;
  /** BCP-47-ish tag, informational: the matcher does not translate, it matches. */
  lang?: string;
  /**
   * `word-containment` is the default and is what reader-typed topics have always
   * used (word-prefix for spaced scripts, substring for unspaced ones).
   * `exact-phrase` requires the whole phrase to appear as written, which is how a
   * high-precision alias is represented without loosening anything else.
   */
  kind?: "word-containment" | "exact-phrase";
};

export type MatchSpec = {
  v: 1;
  require: MatchTerm[][];
  optional?: MatchTerm[];
  exclude?: MatchTerm[];
  /** The languages the terms are written in. Informational; never a gate. */
  langs?: string[];
};

export type SpecMatch = {
  /** True when every `require` group is satisfied and no `exclude` term hits. */
  matched: boolean;
  /**
   * How strongly, for ranking. Counts satisfied groups, phrase hits and optional
   * hits. Deterministic and bounded; never consulted to decide admission beyond
   * `matched`.
   */
  strength: number;
};

/**
 * A spec derived from a topic's own terms.
 *
 * One group per term, one term per group: AND across terms, which is the
 * behaviour every existing custom topic already has.
 */
export function deriveSpecFromTerms(terms: readonly string[]): MatchSpec {
  // Every term is kept, including one that normalises to nothing. Dropping it
  // would turn `["", "nepal"]` -- never matchable under the rule this replaces --
  // into `["nepal"]`, which matches: a filter here is a loosening of an existing
  // reader's interest dressed as tidying. It is also why `terms: []` produces an
  // empty `require`, which `evaluateSpec` refuses rather than admits -- see the
  // guard there; an interest that requires nothing must select nothing.
  return { v: 1, require: terms.map((term) => [{ text: term }]) };
}

/**
 * A spec derived from a label.
 *
 * The same thing as `deriveSpecFromTerms(topicTerms(label))`, spelled out so a
 * caller creating a topic does not have to know that two derivations exist.
 */
export function deriveSpec(label: string): MatchSpec {
  return deriveSpecFromTerms(topicTerms(label));
}

/** Empty specs -- `{}`, or a row written before 0100 -- mean "derive". */
export function isDerived(spec: MatchSpec | null | undefined): boolean {
  if (spec === null || spec === undefined) return true;
  if (spec.v !== 1) return true;
  if (!Array.isArray(spec.require) || spec.require.length === 0) return true;
  return false;
}

/**
 * The spec to evaluate for a topic, from whatever is stored.
 *
 * `terms` is the fallback rather than `label` because it is the value the topic
 * has actually been matching with: a spec derived from the label could differ if
 * `MAX_TERMS` clipped it, and silently changing an existing reader's matches is
 * exactly what this migration must not do.
 */
export function specForTopic(topic: {
  /** The stored spec as a `topics` row spells it. */
  match_spec?: unknown;
  /** The same value after the reader projection carried it, where it is `spec`. */
  spec?: unknown;
  terms: readonly string[];
}): MatchSpec {
  // Two spellings of one value: the database column is `match_spec`, and the
  // reader projection (`ReaderTopic`) shortens it to `spec` because every other
  // field there is short. Both are accepted so a caller holding either shape
  // cannot silently get the derived spec while believing it passed its own.
  const stored = topic.spec ?? topic.match_spec;
  if (stored && typeof stored === "object" && !isDerived(stored as MatchSpec)) {
    return stored as MatchSpec;
  }
  return deriveSpecFromTerms(topic.terms);
}

/** Whether one term is present in an already-normalised signal. */
function termMatches(normalisedSignal: string, term: MatchTerm): boolean {
  const needle = normaliseText(term.text);
  if (needle === "" || normalisedSignal === "") return false;

  if (term.kind === "exact-phrase") {
    return ` ${normalisedSignal} `.includes(` ${needle} `);
  }

  // Word-containment, delegated to `topics.mentions` by the caller: this module
  // must not re-implement the prefix/substring rule that three other call sites
  // already agree on. See `evaluateSpec`.
  return needleMatches(normalisedSignal, needle);
}

/**
 * The containing rule, kept in one place for the evaluator's two callers.
 *
 * `mentions` lives in `topics.ts` and is imported lazily through this thin
 * wrapper so the rule is textually the same function the rest of the pipeline
 * uses; the wrapper exists to give `exact-phrase` a branch, not to fork the rule.
 */
function needleMatches(normalisedSignal: string, needle: string): boolean {
  // `mentions` treats an unspaced term as a substring test and a spaced one as a
  // word-prefix test, with the short-term floor. Importing it here rather than
  // re-deriving it is the point: a second copy would pass its own tests and mean
  // something else.
  return mentions(normalisedSignal, needle);
}

/**
 * Evaluate a spec against an already-normalised signal.
 *
 * Pure, deterministic, and free: it is substring and prefix tests over a string
 * that was normalised once per event for every reader.
 */
export function evaluateSpec(spec: MatchSpec, normalisedSignal: string): SpecMatch {
  let strength = 0;

  // Nothing required is not "everything allowed". A topic whose terms are empty
  // (or whose stored spec is malformed) has told the matcher nothing about the
  // subject, and the fail-open reading of that would hand the reader the whole
  // corpus. `matchesTerms` refused here for the same reason, and this replaces
  // that call, so the refusal is preserved rather than rediscovered.
  if (!Array.isArray(spec.require) || spec.require.length === 0) {
    return { matched: false, strength: 0 };
  }

  for (const term of spec.exclude ?? []) {
    if (termMatches(normalisedSignal, term)) return { matched: false, strength: 0 };
  }

  for (const group of spec.require) {
    const hit = group.some((term) => termMatches(normalisedSignal, term));
    if (!hit) return { matched: false, strength: 0 };
    strength += 1;
    if (group.some((term) => term.kind === "exact-phrase" && termMatches(normalisedSignal, term))) {
      strength += 1;
    }
  }

  for (const term of spec.optional ?? []) {
    if (termMatches(normalisedSignal, term)) strength += 1;
  }

  return { matched: true, strength };
}

/**
 * How many independent matches a term needs before it may be promoted.
 *
 * Three, and it is a floor rather than a tuned constant: one match is the guess
 * restated, two can be an artefact of one story reported twice, and three
 * requires the term to have recurred against coverage the term itself did not
 * select. Promotion is a change to what a reader receives, so the bias is
 * strongly against doing it.
 */
export const PROMOTION_MIN_MATCHES = 3;

export type TermEvidence = {
  /** Events in which this term appeared alongside a satisfied require group. */
  matchedEvents: number;
  /** A reader engaged with one of those events (feedback machinery). */
  engaged: boolean;
};

/**
 * Which optional terms have earned promotion into `require`.
 *
 * The rule that matters here is that promotion needs evidence *from outside the
 * term's own matches*: an optional term never admits an event, so the events
 * counted are ones the rest of the spec already selected. That is what stops the
 * circularity a boost-only design would otherwise have -- waiting for matches
 * that can only happen after promotion.
 */
export function promotionCandidates(
  spec: MatchSpec,
  evidence: ReadonlyMap<string, TermEvidence>,
): MatchTerm[] {
  const promotable: MatchTerm[] = [];
  for (const term of spec.optional ?? []) {
    const key = normaliseText(term.text);
    const found = evidence.get(key);
    if (!found) continue;
    if (found.engaged || found.matchedEvents >= PROMOTION_MIN_MATCHES) promotable.push(term);
  }
  return promotable;
}

/** A new spec with the given terms moved from `optional` into `require`. */
export function promoteTerms(spec: MatchSpec, terms: readonly MatchTerm[]): MatchSpec {
  if (terms.length === 0) return spec;
  const promoted = new Set(terms.map((term) => normaliseText(term.text)));
  return {
    ...spec,
    require: [
      ...spec.require,
      ...(spec.optional ?? [])
        .filter((term) => promoted.has(normaliseText(term.text)))
        .map((term) => [term]),
    ],
    optional: (spec.optional ?? []).filter((term) => !promoted.has(normaliseText(term.text))),
  };
}
