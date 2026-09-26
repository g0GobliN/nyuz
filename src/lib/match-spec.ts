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

import { z } from "zod";
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
  /**
   * Optional terms only: the index of the `require` group this term is a
   * candidate *alternative name* for. Promotion adds the term to that group --
   * see `promoteTerms`. Absent on a single-group spec means group 0; absent on a
   * multi-group spec means the term is a booster that can never be promoted,
   * because "which constraint is this a synonym of" has no answer.
   */
  aliasOf?: number;
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

/* -------------------------------------------------------------------------- */
/* What may be stored                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Bounds on an authored spec. Generous for a subject with many names, and small
 * enough that one topic cannot turn the per-event evaluation into real work.
 */
export const SPEC_LIMITS = {
  groups: 8,
  termsPerGroup: 16,
  optional: 24,
  exclude: 24,
  termChars: 120,
} as const;

const termSchema = z
  .object({
    text: z.string().max(SPEC_LIMITS.termChars),
    lang: z.string().max(16).optional(),
    kind: z.enum(["word-containment", "exact-phrase"]).optional(),
    aliasOf: z
      .number()
      .int()
      .min(0)
      .max(SPEC_LIMITS.groups - 1)
      .optional(),
  })
  .strict();

const specSchema = z
  .object({
    v: z.literal(1),
    require: z
      .array(z.array(termSchema).min(1).max(SPEC_LIMITS.termsPerGroup))
      .min(1)
      .max(SPEC_LIMITS.groups),
    optional: z.array(termSchema).max(SPEC_LIMITS.optional).optional(),
    exclude: z.array(termSchema).max(SPEC_LIMITS.exclude).optional(),
    langs: z.array(z.string().max(16)).max(16).optional(),
  })
  .strict();

/** `{}`, `null` or absent: the "derive from `terms`" value 0100 defaults to. */
export function isEmptySpec(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

export type SpecParse = { ok: true; spec: MatchSpec } | { ok: false; reason: string };

/**
 * A stored value, read as a specification -- or refused.
 *
 * Structural only: this is the *read* path, and it must accept every value the
 * write paths can produce, including a derived spec whose term normalises to
 * nothing (an unmatchable requirement, which narrows and is therefore safe).
 * Anything that is not exactly the shape above -- a wrong version, an empty
 * `require`, a stray key, a term that is not a string -- is refused rather than
 * guessed at.
 */
export function parseMatchSpec(value: unknown): SpecParse {
  const parsed = specSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: issue ? `${issue.path.join(".") || "spec"}: ${issue.message}` : "invalid",
    };
  }
  return { ok: true, spec: parsed.data as MatchSpec };
}

/**
 * The *write* path's validation: structure, plus the rules only an author can
 * break.
 *
 *   - Every term must normalise to something. An exclude term that normalises to
 *     nothing never vetoes, which silently broadens; a require term that does
 *     never matches, which silently empties the interest. Both are authoring
 *     mistakes, refused here rather than stored.
 *   - `aliasOf` must name a group that exists.
 */
export function validateAuthoredSpec(value: unknown): SpecParse {
  const parsed = parseMatchSpec(value);
  if (!parsed.ok) return parsed;
  const { spec } = parsed;

  const every = [...spec.require.flat(), ...(spec.optional ?? []), ...(spec.exclude ?? [])];
  const empty = every.find((term) => normaliseText(term.text) === "");
  if (empty) return { ok: false, reason: `term "${empty.text}" normalises to nothing` };

  const badAlias = (spec.optional ?? []).find(
    (term) => term.aliasOf !== undefined && term.aliasOf >= spec.require.length,
  );
  if (badAlias) {
    return { ok: false, reason: `optional "${badAlias.text}" is an alias of a missing group` };
  }
  return parsed;
}

/**
 * The value that selects nothing, for a stored spec that cannot be read.
 *
 * `evaluateSpec` refuses an empty `require`, so this matches no event. Failing
 * closed is the whole point: a malformed row falling back to the derived spec
 * could be *broader* than what an operator wrote (an exclusion that no longer
 * applies), and the damage is invisible. An interest that selects nothing is
 * visible in the operator's diagnostics and costs a reader nothing they asked
 * not to see.
 */
const REFUSED: MatchSpec = Object.freeze({ v: 1, require: [] }) as MatchSpec;

export type TopicSpecSource = {
  /** The stored spec as a `topics` row spells it. */
  match_spec?: unknown;
  /** The same value after the reader projection carried it, where it is `spec`. */
  spec?: unknown;
  terms: readonly string[];
};

/** How a topic's stored value reads. For diagnostics and the console. */
export function specStatus(topic: TopicSpecSource): "derived" | "explicit" | "malformed" {
  const stored = topic.spec ?? topic.match_spec;
  if (isEmptySpec(stored)) return "derived";
  // JSONB can hold any JSON value, including a string or number. Those are
  // malformed specifications too; do not pass a primitive into WeakMap below.
  if (typeof stored !== "object") return "malformed";
  return parsedStored(stored as object) === null ? "malformed" : "explicit";
}

/**
 * Parsed stored specs, by the stored object's identity.
 *
 * The reader join evaluates a topic once per (reader, candidate), which for a
 * popular subject is a thousand readers times a page of four hundred events.
 * Validating the stored JSON on each of those calls would put a schema parse on
 * the hottest path in the pipeline; the stored object is the same object for
 * the whole run (it comes from one `topics` read), so it is parsed once.
 * A WeakMap, so the cache dies with the run's rows.
 */
const PARSED = new WeakMap<object, MatchSpec | null>();

function parsedStored(stored: object): MatchSpec | null {
  const cached = PARSED.get(stored);
  if (cached !== undefined) return cached;
  const parsed = parseMatchSpec(stored);
  const spec = parsed.ok ? parsed.spec : null;
  PARSED.set(stored, spec);
  return spec;
}

/** Derived specs, by the `terms` array's identity -- the same argument. */
const DERIVED = new WeakMap<readonly string[], MatchSpec>();

function derivedFor(terms: readonly string[]): MatchSpec {
  const cached = DERIVED.get(terms);
  if (cached) return cached;
  const spec = deriveSpecFromTerms(terms);
  DERIVED.set(terms, spec);
  return spec;
}

/**
 * The spec to evaluate for a topic, from whatever is stored.
 *
 *   empty (`{}`, null)   derive from `terms` -- the behaviour before 0100
 *   a valid spec         itself
 *   anything else        `REFUSED`: selects nothing, never falls back
 *
 * `terms` is the fallback rather than `label` because it is the value the topic
 * has actually been matching with: a spec derived from the label could differ if
 * `MAX_TERMS` clipped it, and silently changing an existing reader's matches is
 * exactly what this migration must not do.
 */
export function specForTopic(topic: TopicSpecSource): MatchSpec {
  // Two spellings of one value: the database column is `match_spec`, and the
  // reader projection (`ReaderTopic`) shortens it to `spec` because every other
  // field there is short. Both are accepted so a caller holding either shape
  // cannot silently get the derived spec while believing it passed its own.
  const stored = topic.spec ?? topic.match_spec;
  if (isEmptySpec(stored)) return derivedFor(topic.terms);
  if (typeof stored !== "object") return REFUSED;
  return parsedStored(stored as object) ?? REFUSED;
}

/**
 * Whether a topic selects an already-normalised signal.
 *
 * The one call every custom-topic path makes -- classification, finalization,
 * observed coverage, the reader join, the day-one backfill and the significance
 * baseline -- so the same (event, topic) pair cannot be a match in one stage and
 * a non-match in the next by construction. What differs between stages is only
 * the text each can see, never the rule applied to it.
 */
export function topicMatches(topic: TopicSpecSource, normalisedSignal: string): boolean {
  return evaluateSpec(specForTopic(topic), normalisedSignal).matched;
}

/**
 * Whether a topic's own exclusions veto this signal, whatever selected it.
 *
 * `evaluateSpec` already applies exclusions to a spec match. This is for the
 * other route into a topic -- a link in `event_topics` written by an earlier
 * finalization -- which must not be a way around an exclusion the topic carries
 * now.
 */
export function topicVetoes(topic: TopicSpecSource, normalisedSignal: string): boolean {
  const spec = specForTopic(topic);
  return (spec.exclude ?? []).some((term) => termMatches(normalisedSignal, term));
}

/**
 * Build the custom-topic signal once for every pipeline stage that evaluates
 * persisted event links. The topic's own label/link is excluded so a stale link
 * cannot satisfy a spec that has since changed.
 */
export function customTopicSignal(
  input: {
    title: string;
    whatHappened: string;
    tags: readonly string[];
    topics: readonly { id: string; slug: string; label: string }[];
    sources: readonly { name: string }[];
  },
  topicId: string,
): string {
  return normaliseText(
    [
      input.title,
      input.whatHappened,
      ...input.tags,
      ...input.topics
        .filter((topic) => topic.id !== topicId)
        .flatMap((topic) => [topic.slug, topic.label]),
      ...input.sources.map((source) => source.name),
    ].join(" "),
  );
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
    if (aliasGroupOf(spec, term) === null) continue;
    const key = normaliseText(term.text);
    const found = evidence.get(key);
    if (!found) continue;
    if (found.engaged || found.matchedEvents >= PROMOTION_MIN_MATCHES) promotable.push(term);
  }
  return promotable;
}

/**
 * The `require` group an optional term would join if promoted, or null.
 *
 * Explicit `aliasOf` wins; a single-group spec has only one answer; a
 * multi-group spec without `aliasOf` has none, and the term stays a booster.
 */
export function aliasGroupOf(spec: MatchSpec, term: MatchTerm): number | null {
  if (term.aliasOf !== undefined) return term.aliasOf < spec.require.length ? term.aliasOf : null;
  return spec.require.length === 1 ? 0 : null;
}

/**
 * A new spec with the given optional terms promoted to alternative names.
 *
 * A promoted term joins the `require` group it is an alias of -- an OR inside
 * that constraint, so it can now admit an event the other names did not
 * mention. It does not become a new group: an optional term is a guess about a
 * *synonym*, and appending it as its own group would AND it onto the interest,
 * silently narrowing every reader of the subject to the coverage that happens to
 * use the new word. (The previous version of this function did exactly that.)
 *
 * Exclusions are untouched and are still evaluated first, so a promoted name is
 * as subject to the topic's vetoes as the names it joined.
 */
export function promoteTerms(spec: MatchSpec, terms: readonly MatchTerm[]): MatchSpec {
  if (terms.length === 0) return spec;
  const wanted = new Set(terms.map((term) => normaliseText(term.text)));
  const require = spec.require.map((group) => [...group]);
  const optional: MatchTerm[] = [];
  let changed = false;

  for (const term of spec.optional ?? []) {
    const group = wanted.has(normaliseText(term.text)) ? aliasGroupOf(spec, term) : null;
    const target = group === null ? undefined : require[group];
    if (target === undefined) {
      optional.push(term);
      continue;
    }
    const { aliasOf: _aliasOf, ...name } = term;
    if (!target.some((existing) => normaliseText(existing.text) === normaliseText(name.text))) {
      target.push(name);
    }
    changed = true;
  }

  if (!changed) return spec;
  return { ...spec, require, optional };
}

/** One event the topic already selected, as promotion evidence sees it. */
export type EvidenceObservation = {
  eventId: string;
  /** The event's normalised signal (title, summary, concept tags). */
  signal: string;
  /** A follower of this topic engaged with the event. */
  engaged: boolean;
};

/**
 * How often each optional term turned up in coverage the spec selected *without*
 * it.
 *
 * An observation counts for a term only when the spec matched on its own -- the
 * require groups were satisfied and no exclusion hit -- and the term is present.
 * Optional terms never affect `matched`, so this is by construction evidence
 * from outside the term's own matches: the circularity a boost-only design would
 * otherwise have is impossible, not merely unlikely.
 */
export function termEvidence(
  spec: MatchSpec,
  observations: readonly EvidenceObservation[],
): Map<string, TermEvidence> {
  const evidence = new Map<string, TermEvidence>();
  const counted = new Map<string, Set<string>>();

  for (const observation of observations) {
    if (!evaluateSpec(spec, observation.signal).matched) continue;
    for (const term of spec.optional ?? []) {
      if (!termMatches(observation.signal, term)) continue;
      const key = normaliseText(term.text);
      const events = counted.get(key) ?? new Set<string>();
      events.add(observation.eventId);
      counted.set(key, events);
      const previous = evidence.get(key);
      evidence.set(key, {
        matchedEvents: events.size,
        engaged: (previous?.engaged ?? false) || observation.engaged,
      });
    }
  }
  return evidence;
}
