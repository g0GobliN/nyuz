import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import {
  admissibleReaderSentence,
  alreadyAttributed,
  attributeToOwnSource,
  centralTokens,
  storyPositionRank,
  cleanDeterministicSentence,
  contextDependent,
  deterministicFactType,
  editorialNoise,
  hasPredicate,
  headingUnit,
  keepSample,
  normalizeRelativeTime,
  recoverableContext,
  resolveNarrator,
  stripUnanchorableTime,
  unitTextRejection,
  unresolvableContext,
  unresolvedContextOpening,
  nearDuplicate,
  normalizeReaderSources,
  normalizeSummary,
  normalizedNumericKey,
  preferCleaner,
  selectReaderEvidence,
  sentenceKey,
  sourceNameForEvidence,
  sourceMarkupOrUrl,
  sourceSeam,
  noMainClause,
  readerSentences,
  validDeterministicParagraph,
  validDeterministicSentence,
  MAX_SENTENCE_CHARS,
  MIN_PARAGRAPH_WORDS,
  MIN_SENTENCE_CHARS,
  type DeterministicFactType,
  type RankedEntity,
  type ReaderFact,
  type ReaderSource,
} from "./reader-evidence";
import {
  gluedAttribution,
  hasSourceMetadata,
  hasVisibleEntity,
  isRepositorySourceName,
  malformedAttribution,
  REPORTED_CLAUSE_WORDS,
} from "./pipeline/source-text";
import { stripFrontedConnector } from "./pipeline/news-signals";
import { relatedContext } from "./related-events";
import { briefingText, cardSummaryRefused, repeats } from "./understand";
import { RAW_URL_WITH_PATH, truncatedSentence } from "../../scripts/lib/defects";

function sentence(text: string): string {
  const clean = cleanDeterministicSentence(text);
  return clean && !/[.!?…]["”]?$/.test(clean) ? `${clean}.` : clean;
}

/**
 * A discourse marker the source was answering a question with.
 *
 * The corpus supplied "Yes, the servers still required a username and password for
 * access ...", the tipster answering a question the reader never saw. After
 * `reports that` it reads "The Register reports that Yes, the servers ... ", which
 * is not English -- a reported clause may not open on an affirmation. The comma is
 * required, and is what keeps this away from a quantity: "No more than half could
 * trace ..." keeps its `No`, because that `No` is part of the measure.
 */
const DISCOURSE_MARKER =
  /^(?:Yes|No|Well|Okay|OK|Right|Sure|Indeed|Exactly|True|Honestly|Frankly)\s*,\s+/i;
/** The sentence as a reported clause, without the marker it cannot open on. */
function withoutDiscourseMarker(text: string): string {
  return text.replace(DISCOURSE_MARKER, "");
}

/**
 * A subordinating conjunction a *reported* clause may open on.
 *
 * `X reports that Once they were out in the wild, ...` is the production defect:
 * a clause subordinate to a reporting verb cannot keep the sentence capital its
 * source gave it. The token this pattern matches is the one that gets lowered, so
 * the rule is the construction rather than a word list consulted at the call site
 * -- and the construction is the gate's own list, imported rather than restated:
 * lowering exactly what the gate refuses is what keeps the composer from
 * publishing prose its own gate would reject.
 */
const REPORTED_CLAUSE_OPENING = new RegExp(`^(?:${REPORTED_CLAUSE_WORDS})\\b`, "i");

/**
 * The same shape, for the reported clauses that lead with a fronted adverbial.
 *
 * `After the merger, ...` and `Before the vote, ...` are hoisted in front of the
 * attribution by `frontedOpener`, and the branch below takes the rest.
 */
const SUBORDINATE_CLAUSE_OPENING = /^(?:once|when|while|because|although|and|but|or)\b/i;

/**
 * A source sentence as a reported clause, with its opening conjunction lowercased.
 *
 * Returns null when the sentence does not open on one of those words, which is
 * the caller's signal that no lowercasing is available: the sentence then keeps
 * the capital its source wrote, because a leading capital can be the first letter
 * of a name and nothing in a plain-text excerpt says which. `All Things
 * Considered host Mary Louise Kelly ...` is the case -- the frozen 200-event
 * corpus caught the rule this replaces publishing it as `all Things Considered
 * host ...`, because `all` is a quantifier, and a quantifier is also how a title
 * can start.
 */
function reportedClause(text: string): string | null {
  const opening = REPORTED_CLAUSE_OPENING.exec(text)?.[0];
  if (opening === undefined) return null;
  return opening.toLowerCase() + text.slice(opening.length);
}

/**
 * A fronted adverbial and the clause it belongs to, or null.
 *
 * `X reports that Overall, the cadence ... accelerated` and `PyTorch blog reports
 * that however, they work best ...` were both in the corpus, and neither is
 * English: a comma may not follow `that`. The adverbial is what makes the wrap
 * impossible -- lowercasing it does not help, because the comma remains -- so it
 * is lifted out in front of the attribution instead, where it is grammatical and
 * stays next to the clause it modifies. Four words maximum: a longer comma-
 * terminated opening is a subordinate clause, and splitting there would rewrite
 * the sentence rather than unsnarl its attribution.
 */
const ADVERBIAL_OPENING = new Set(
  "in on at during after before since by over under within around for from with without between among against later earlier meanwhile however overall still yet instead then now today yesterday tomorrow first second next finally subsequently separately previously initially ultimately notably reportedly according".split(
    " ",
  ),
);
/** "Ten days later", "Two weeks ago", "Three months after" -- a span, not a term. */
const TIME_SPAN_OPENING =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:hour|day|week|month|year)s?\s+(?:later|earlier|ago|after|before|on|in)\b/i;

function frontedOpener(text: string): { opener: string; rest: string } | null {
  const match = /^([\p{L}][\p{L}\p{N}'’.-]*(?:\s+\S{1,20}){0,3}),\s+([\s\S]+)$/u.exec(text.trim());
  if (!match) return null;
  const opener = match[1] ?? "";
  const rest = (match[2] ?? "").trim();
  if (opener === "" || rest === "") return null;
  if (cannotWrap(rest) || !hasPredicate(rest)) return null;
  // The opener has to *be* an adverbial, because the alternative is a subject:
  // hoisting "The first briefing" out of "The first briefing, which Allan did
  // not sign, warned that ..." produced "The first briefing, The Register reports
  // that which Allan did not sign, warned that ...". Openings are recognised by
  // their first word, from a closed set of function words, or as a time span.
  const first = (opener.split(/\s+/, 1)[0] ?? "").replace(/[^\p{L}]/gu, "").toLowerCase();
  if (!ADVERBIAL_OPENING.has(first) && !TIME_SPAN_OPENING.test(opener)) return null;
  return { opener, rest };
}

/**
 * A sentence that already names the paper's authors does not need "a new paper
 * reports" in front of it. Source normalization resolves a repository's "We" to
 * "The authors", so without this the deck would read "A new paper reports: The
 * authors call this loopjacking" -- one attribution glued to another.
 */
const AUTHORIAL_OPENING = /^The (?:authors|researchers|paper|study|team|work)\b/i;

/** How many words a published block may carry before the next one starts. */
const PARAGRAPH_WORD_BUDGET = 75;

function similarEnough(left: string, right: string): boolean {
  if (normalizedNumericKey(left) === normalizedNumericKey(right)) return true;
  // One statement carrying extra furniture -- a provider prefix, a source label
  // -- is the same statement. Checked before the token-set comparison, which
  // would otherwise score a decorated variant as only partly similar.
  if (nearDuplicate(left, right)) return true;
  const a = new Set(centralTokens(left));
  const b = new Set(centralTokens(right));
  if (Math.min(a.size, b.size) < 4) return repeats(left, right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.max(a.size, b.size) >= 0.88;
}

function citationRefs(facts: ReaderFact[]): number[] {
  return [...new Set(facts.flatMap((fact) => fact.evidence))].sort((a, b) => a - b);
}

function mergeEvidenceIntoDeck(
  deck: { text: string; evidence: number[] },
  items: { text: string; evidence: number[] }[],
): void {
  for (const item of items) {
    if (repeats(deck.text, item.text))
      deck.evidence = [...new Set([...deck.evidence, ...item.evidence])];
  }
}

/** Counters for the deterministic composer. Admin/debug only -- see `composeArticleWithDiagnostics`. */
export type CompositionDiagnostics = {
  sourceNormalization: {
    removedMetadataFields: number;
    cleanedEvidence: number;
    rejectedMetadataOnly: number;
    /** Sources refused whole because they are a digest of other publications'. */
    refusedDigests: number;
    authorialVoiceRewrites: number;
    /** Texts that opened by repeating their own item headline. */
    strippedHeadlines: number;
    /** Sentences an editorial adverbial was removed from, keeping the fact. */
    sourceVoiceStripped: number;
    /** Sentences a fronted editorial frame was removed from, keeping the fact. */
    strippedFrames: number;
    /** Sentences refused for carrying a loaded metaphor instead of the fact. */
    sourceColourRejections: number;
    /** Frames moved behind the fact they were in front of ("The paper reports: X"). */
    reportFramesMoved: number;
    /** Frames deleted because the fact already named its own claimant. */
    reportFramesDropped: number;
    /** Bounded before/after examples of each rewrite, for the audit only. */
    samples: {
      voiceStrips: string[];
      frames: string[];
      relativeTimes: string[];
      droppedContext: string[];
      /** Narrator resolutions and drops, before/after, to be read by hand. */
      narrator: string[];
    };
    /** Relative time references replaced with the date they meant. */
    relativeTimesAnchored: number;
    /** Sentences kept with an unanchorable time phrase removed from them. */
    relativeTimesStripped: number;
    /** Reporting wrappers resolved to the actor they named. */
    narratorWrappersRemoved: number;
    /**
     * First-person facts published as the source's own: an observation or an
     * experiment reported by its author, or the source named as the actor of a
     * sentence that was only ever about its own work.
     */
    authorAttributedFacts: number;
    /** First-person sentences dropped because the subject could not be restored. */
    ambiguousNarratorRejected: number;
  };
  /**
   * One claim reaching the composer more than once. `duplicateGroups` counts
   * every merge; `restatements` counts the merges where the two variants were
   * worded differently, which is the number that says whether the wording-aware
   * comparison is doing any work on live stories.
   */
  dedupe: { duplicateGroups: number; preferredCleanVariant: number; restatements: number };
  qualityGate: {
    metadataLeakWarnings: number;
    malformedAttributionWarnings: number;
    /** Sentences carrying an undecoded HTML reference. Never publishable. */
    entityLeakWarnings: number;
    /** A subhead that reached a block: a heading, not a sentence. */
    headingUnitWarnings: number;
    /**
     * Units holding a seam: a heading or a session credit line a provider joined
     * to the prose under it, with no punctuation between them. A row stored before
     * the ingest boundary ended headings still carries these.
     */
    sourceSeamWarnings: number;
    /** Sentences whose subject is a pronoun with no antecedent. */
    unresolvedContextWarnings: number;
    /** Sentences holding more than one quoted passage. */
    stackedQuoteWarnings: number;
    /** Double spaces repaired before publication. */
    spacingRepairs: number;
    /** Facts refused because a "this month" could not be made absolute. */
    relativeTimeRefusals: number;
    /**
     * Facts refused because they announce, as still ahead of the reader, a date
     * the reader has already lived through. "The company is hosting its annual
     * DevDay on September 29th" published on the 30th is not early, it is wrong:
     * it tells a reader who has already read the coverage that it is coming.
     */
    stalePreviewRefusals: number;
    /**
     * Decks the gate itself refused, by reason. The deck is the one published
     * unit that is not derived from a selected fact, so it is the one that can
     * arrive at the gate without having been judged -- and it used to be indexed
     * only when it already passed, which published the failures instead of
     * refusing them.
     */
    deckRefusals: number;
    deckReasons: Record<string, number>;
  };
  /**
   * The invariant this exists for: a selected fact is either published, merged
   * into an identical one, or counted under a reason. It never just disappears.
   */
  facts: {
    /**
     * Facts in hand after merging duplicates -- the accounting set.
     *
     * Every one of them leaves this pass in exactly one of three states, and
     * the three are a partition rather than overlapping counters:
     * `selected === rendered + refused + lost`. `rendered` is the prose that
     * exists, `refused` is a named rule that accounts for the absence, and
     * `lost` is the residue nobody can explain -- the one number that has to
     * stay at zero for the accounting to mean anything.
     */
    selected: number;
    /** Of those, how many reached the published prose. */
    rendered: number;
    /** Facts a duplicate replaced, before merging. */
    deduplicated: number;
    /** Facts refused before any paragraph was built. */
    rejected: number;
    /**
     * Refusal *events*: how many times a fact-level rule refused a fact, whether
     * or not the fact was later published by another path.
     *
     * This is execution history, and it is deliberately not a partition term: a
     * fact the ranked pass refused was once republished by the priority hoist, and
     * the history should show the refusal rather than pretend it never happened.
     * The partition uses `refused` below, the facts whose *final* state is an
     * explained absence. Block-level drops are not events here: they charge the
     * facts they carried once, and `dispositions` is where a reviewer reads them.
     */
    refusalEvents: number;
    /**
     * Unrendered facts whose absence a named rule accounts for.
     *
     * Both kinds count here, and the reason says which: a fact-level rule
     * (`invalid_sentence`, `unresolved_context`) judged the sentence itself, and
     * a block-level rule (`short_block`, `thin_evidence_cap`, `article_limit`,
     * `deck_refused`) dropped the paragraph or deck carrying it. Recording the
     * block's rule per fact is what makes a dropped paragraph explicable -- a
     * sentence count cannot say which fact went, and a fact nobody can account
     * for is the thing this whole ledger exists to prevent.
     */
    refused: number;
    /**
     * Which rule accounts for each unrendered fact, by count.
     *
     * The audit reads this table beside `lostFacts`, so "where did it go" is
     * answerable per rule instead of per total.
     */
    dispositions: Record<string, number>;
    /**
     * The unrendered facts themselves, each with the rule that accounts for it.
     *
     * The reason table says how many; this says which, which is what an operator
     * checking a decision actually needs. One entry per unrendered fact, in the
     * order the facts were selected.
     */
    unrendered: { text: string; rule: string }[];
    /**
     * The facts behind `renderedAfterRefusal`: identity, the rule that charged
     * them, the test that found them, and the sentence it found them in.
     *
     * `sentence` means every sentence of the fact is one of the page's own
     * sentences: the fact's own text is on the page as prose, and a rule charged it
     * anyway. That is the class this counter exists to drive to zero.
     *
     * `resemblance` means only the wording comparison matched -- the page says
     * something like the fact, not the fact. Both classes are recorded with the
     * sentence that carried them, because the difference between them is a
     * judgement a reader has to be able to check, and the ledger's own sentence
     * index is not evidence for it: every publishing path writes that index,
     * including a block a later rule refused, so it says a fact was published when
     * nothing on the page says it.
     */
    renderedAfterRefusalFacts: {
      text: string;
      rule: string;
      matched: "sentence" | "resemblance";
      /** The published sentence carrying the fact, or its closest match. */
      evidence: string;
    }[];
    /**
     * Facts a rule refused along one path that another path published anyway.
     *
     * A diagnostic, not a partition term: the fact is `rendered`, because that is
     * what the reader got, and the refusal stays visible here rather than being
     * erased from the history. Non-zero is a bug in a later path -- the ranked
     * priority hoist and the entity-context splice were the two -- not a
     * tolerance. Counted on the `matched: "sentence"` class alone: only a fact the
     * page actually carries is a republished one, and the resemblance class is a
     * separate, diagnostic number.
     */
    renderedAfterRefusal: number;
    /**
     * Facts a rule charged that the page only *resembles*.
     *
     * The generous half of `renderedAfterRefusal`, and a diagnostic rather than a
     * defect: the token comparison matched a sentence about something else. Kept
     * as its own number so the verdict line above can mean "the page carries a
     * fact a rule refused" without the resemblance class weakening it.
     */
    renderedAfterRefusalResemblance: number;
    /**
     * Units refused in the evidence pass, before selection, by reason.
     *
     * The gate's `reasons` above can only name a sentence that became a fact;
     * these never did, and a refusal nobody can read is a silent one. The keys
     * are `EvidenceRejectionReason` names.
     */
    evidenceRefusals: Record<string, number>;
    /**
     * Selected facts with no rendered prose and no rule to account for it.
     *
     * The partition's residue: anything above zero is a bug, and an unexplained
     * one, which is why the facts behind it are printed in full below.
     */
    lost: number;
    /**
     * The facts behind `lost`, in full, so the number can be read.
     *
     * `lost` is the one counter that means "nobody can explain this missing",
     * and a number nobody can read is not a bug report. Each entry was selected
     * and did not reach the prose, and no rule refused *it* by name -- which is
     * what a block-level refusal looks like from here: `short_block`,
     * `thin_evidence_cap` and `article_limit` charge the sentence, so the fact
     * behind it is only explicable when a reviewer can read it. Written in full
     * rather than sampled, because the class is rare and the list is already
     * bounded by the facts the story itself supplied.
     */
    lostFacts: string[];
  };
  paragraphs: {
    /** Blocks handed to the gate. */
    assembled: number;
    /** Blocks holding more than one sentence, so the gate split them first. */
    split: number;
    /** Blocks in the published article. */
    rendered: number;
    /** Blocks that produced no publishable sentence. */
    rejected: number;
    reasons: Record<string, number>;
  };
  sentences: {
    considered: number;
    rendered: number;
    merged: number;
    refused: number;
    reasons: Record<string, number>;
  };
  /**
   * How the published facts were ordered. `narrative` means one source
   * document, read in its own order; `relevance` means the news ranking.
   */
  ordering: "narrative" | "relevance";
  /**
   * How each published block acquired its attribution, by count.
   *
   * `reports_that` is the wrapper, `according_to` the deck's opening clause,
   * `research_clause` the paper-shaped form, and `none` a sentence published as
   * the source wrote it -- which is what an unsafe wrap now falls back to, so a
   * jump here is the signal that the composer is refusing to build clauses.
   */
  attribution: Record<string, number>;
  /**
   * The no-evidence path: a story with nothing to compose from still has to
   * show *something* under its headline, and that something used to be whatever
   * the feed put in its description field. Every candidate is now judged before
   * it may render, and refusing all of them is a valid outcome.
   */
  fallback: {
    /** Stories that had no usable evidence, so a fallback was considered. */
    attempted: number;
    /** Candidates offered to the judge. */
    candidates: number;
    accepted: number;
    rejected: number;
    reasons: Record<string, number>;
    /** Candidates refused for repeating the headline. */
    titleDuplicate: number;
    /** Candidates refused as provider furniture. */
    furnitureRejected: number;
    /** Stories left with no deck at all -- the intended end for junk. */
    empty: number;
  };
  /** 1 = paragraphs published, 2 = the deck alone, 3 = nothing publishable. */
  fallbackLevel: 1 | 2 | 3;
};

function createDiagnostics(): CompositionDiagnostics {
  return {
    sourceNormalization: {
      removedMetadataFields: 0,
      cleanedEvidence: 0,
      rejectedMetadataOnly: 0,
      refusedDigests: 0,
      authorialVoiceRewrites: 0,
      strippedHeadlines: 0,
      sourceVoiceStripped: 0,
      strippedFrames: 0,
      sourceColourRejections: 0,
      reportFramesMoved: 0,
      reportFramesDropped: 0,
      samples: {
        voiceStrips: [],
        frames: [],
        relativeTimes: [],
        droppedContext: [],
        narrator: [],
      },
      /** Relative time references replaced with the date they meant. */
      relativeTimesAnchored: 0,
      relativeTimesStripped: 0,
      narratorWrappersRemoved: 0,
      authorAttributedFacts: 0,
      ambiguousNarratorRejected: 0,
    },
    dedupe: { duplicateGroups: 0, preferredCleanVariant: 0, restatements: 0 },
    qualityGate: {
      metadataLeakWarnings: 0,
      malformedAttributionWarnings: 0,
      entityLeakWarnings: 0,
      headingUnitWarnings: 0,
      sourceSeamWarnings: 0,
      unresolvedContextWarnings: 0,
      stackedQuoteWarnings: 0,
      spacingRepairs: 0,
      deckRefusals: 0,
      deckReasons: {},
      /** Facts refused because a "this month" could not be made absolute. */
      relativeTimeRefusals: 0,
      stalePreviewRefusals: 0,
    },
    facts: {
      selected: 0,
      rendered: 0,
      deduplicated: 0,
      rejected: 0,
      refusalEvents: 0,
      refused: 0,
      dispositions: {},
      unrendered: [],
      renderedAfterRefusalFacts: [],
      renderedAfterRefusal: 0,
      renderedAfterRefusalResemblance: 0,
      evidenceRefusals: {},
      lost: 0,
      lostFacts: [],
    },
    paragraphs: { assembled: 0, split: 0, rendered: 0, rejected: 0, reasons: {} },
    sentences: { considered: 0, rendered: 0, merged: 0, refused: 0, reasons: {} },
    ordering: "relevance",
    attribution: {},
    fallback: {
      attempted: 0,
      candidates: 0,
      accepted: 0,
      rejected: 0,
      reasons: {},
      titleDuplicate: 0,
      furnitureRejected: 0,
      empty: 0,
    },
    fallbackLevel: 1,
  };
}

/** Count one occurrence of a reason, keeping the maps small and readable. */
function tally(counter: Record<string, number>, reason: string): void {
  counter[reason] = (counter[reason] ?? 0) + 1;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** How many separate quoted passages a sentence carries. */
function quotedSpans(text: string): number {
  return [...text.matchAll(/"[^"]{12,}"|“[^”]{12,}”/g)].length;
}

/** Two facts are about the same thing when they share subject vocabulary. */
const SHARED_SUBJECT_MIN = 2;

function sharesSubject(left: string, right: string): boolean {
  const first = new Set(centralTokens(left));
  let shared = 0;
  for (const token of centralTokens(right)) {
    if (!first.has(token)) continue;
    shared += 1;
    if (shared >= SHARED_SUBJECT_MIN) return true;
  }
  return false;
}

/**
 * Record a block that never reached the gate, sentence by sentence.
 *
 * The composer drops blocks in two places before assembly -- below the paragraph
 * floor, and over the thin-evidence cap -- and a block dropped without a reason
 * is a fact lost without a reason. Every such drop is counted here instead, so
 * "selected but not published" always has an answer.
 */
function refuseBlock(text: string, reason: string, diagnostics: CompositionDiagnostics): void {
  const count = Math.max(1, readerSentences(text).length);
  diagnostics.sentences.refused += count;
  tally(diagnostics.sentences.reasons, reason);
}

/**
 * The fact ledger: where each fact went, and which sentence carries it.
 *
 * Two maps, because the two passes speak different languages. The composer works
 * in facts and knows which fact became which published sentence (`sentences`),
 * the gate works in sentences and can only name the sentence it refused. Joining
 * them on `sentenceKey` -- the same identity `carries` already uses to ask
 * whether a fact reached the page -- is what lets a sentence-level refusal be
 * charged to the fact behind it, instead of leaving that fact unexplained.
 *
 * `unrendered` is the rule accounting for a fact that will not be published, keyed
 * by the fact's own sentence. First rule wins: the sentence builder's
 * `invalid_sentence` is a more specific answer than the `short_block` of the
 * paragraph that never got built around it, and a later, coarser drop must not
 * overwrite a reason a reviewer can check.
 */
type FactLedger = {
  sentences: Map<string, string>;
  unrendered: Map<string, string>;
};

function markUnrendered(ledger: FactLedger, factKey: string, rule: string): void {
  console.log("markUnrendered", factKey.slice(0, 80), rule);
  if (factKey === "" || ledger.unrendered.has(factKey)) return;
  ledger.unrendered.set(factKey, rule);
}

/** Charge a fact, by its own text, to the rule that refused it. */
function markFact(ledger: FactLedger, factText: string, rule: string): void {
  markUnrendered(ledger, sentenceKey(factText), rule);
}

/**
 * Charge every fact behind a sentence inside `text` to the rule that refused it.
 *
 * Used where only the block exists by then -- the thin-evidence cap, a gate
 * refusal, a dropped deck -- and the facts have to be recovered through the
 * identity the composer recorded when it published the sentence.
 */
function markSentence(ledger: FactLedger, text: string, rule: string): void {
  for (const sentence of readerSentences(text)) {
    const fact = ledger.sentences.get(sentenceKey(sentence));
    if (fact !== undefined) markUnrendered(ledger, fact, rule);
  }
}

/** Every fact a dropped block carried is charged to the rule that dropped it. */
function markDroppedFacts(ledger: FactLedger, facts: readonly { text: string }[], rule: string) {
  for (const fact of facts) markFact(ledger, fact.text, rule);
}

/**
 * Whether publishing this sentence would republish a fact a rule refused.
 *
 * Refusal-finality, as one predicate: the venue for a fact a rule declined is
 * silence, not a second path. Tested by containment rather than equality, because
 * the sentence a later pass rebuilds is often longer than the fact inside it --
 * the entity-context splice takes a whole source sentence, and a fact the ranked
 * pass refused can be a fragment of one ("THE PATRIOTS CAUCUS sends its
 * regards!!!!!!!!!!" inside the message it was written in).
 *
 * Only one direction is a republication: this sentence carrying the refused fact.
 * A sentence that is merely *part* of a refused fact is a fragment, which the
 * sentence rules judge on their own terms.
 */
function republishesRefusedFact(ledger: FactLedger, text: string): boolean {
  const key = sentenceKey(text);
  if (key === "") return false;
  for (const charged of ledger.unrendered.keys()) {
    if (charged !== "" && key.includes(charged)) return true;
  }
  return false;
}

/**
 * Record which fact a published sentence was built from, for the two above.
 *
 * Indexed sentence by sentence rather than as one string, because the gate reads
 * sentences: a fact whose text carries two of them -- a fragment the source wrote
 * as its own line followed by the sentence about it -- was invisible to the join
 * both ways round, which is how one fact stayed unexplained after every drop path
 * was charged.
 */
function indexSentence(ledger: FactLedger, sentence: string, factText: string): void {
  const fact = sentenceKey(factText);
  if (fact === "") return;
  for (const part of readerSentences(sentence)) {
    const key = sentenceKey(part);
    if (key !== "") ledger.sentences.set(key, fact);
  }
}

/**
 * Whether a published block carries this fact.
 *
 * Containment catches the plain case; `similarEnough` catches the same sentence
 * under an attribution prefix ("A new paper reports: ...") or after the cleaner
 * variant of a merged pair won, so the count does not report a fact as lost
 * merely because its wording moved.
 */
function carries(blocks: string[], factText: string): boolean {
  const key = sentenceKey(factText);
  if (key.length > 0 && blocks.some((block) => sentenceKey(block).includes(key))) return true;
  return blocks.some((block) => similarEnough(block, factText));
}

/**
 * The published sentence that resembles `factText` most closely.
 *
 * For the resemblance class of the overlap counter only. That class is a
 * judgement -- "the page says something like this fact" -- and a judgement needs
 * its evidence attached, so the sentence with the largest share of the fact's
 * own tokens is the one recorded. Nothing is published from this reading; it is
 * what an operator reads to decide whether a charge is a republication or the
 * comparison being generous.
 */
function closestPublishedSentence(sentences: string[], factText: string): string {
  const factTokens = new Set(centralTokens(factText));
  let best = "";
  let bestScore = 0;
  for (const sentence of sentences) {
    if (sentence.trim() === "") continue;
    let shared = 0;
    for (const token of new Set(centralTokens(sentence))) if (factTokens.has(token)) shared += 1;
    const score = shared / Math.max(factTokens.size, 1);
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best;
}

function mergeFacts(facts: ReaderFact[], diagnostics: CompositionDiagnostics): ReaderFact[] {
  const kept: ReaderFact[] = [];
  for (const fact of facts) {
    if (!validDeterministicSentence(fact.text) || editorialNoise(fact.text)) {
      diagnostics.facts.rejected += 1;
      continue;
    }
    const normalized = normalizedNumericKey(fact.text);
    const prior = kept.find(
      (item) =>
        similarEnough(item.text, fact.text) ||
        (normalized.length > 20 && normalizedNumericKey(item.text) === normalized),
    );
    if (prior) {
      prior.evidence = [...new Set([...prior.evidence, ...fact.evidence])];
      diagnostics.dedupe.duplicateGroups += 1;
      diagnostics.facts.deduplicated += 1;
      // Two variants of one claim written differently: not the same string, so
      // this is the wording-aware comparison earning its keep rather than an
      // exact repeat.
      if (sentenceKey(prior.text) !== sentenceKey(fact.text)) {
        diagnostics.dedupe.restatements += 1;
      }
      // Two variants of one claim merged. Keep the one carrying less furniture
      // -- and the same text regardless of which variant arrived first.
      if (preferCleaner(prior.text, fact.text)) {
        prior.text = fact.text;
        prior.score = Math.max(prior.score, fact.score);
        diagnostics.dedupe.preferredCleanVariant += 1;
      } else if (!preferCleaner(fact.text, prior.text) && fact.score > prior.score) {
        prior.text = fact.text;
        prior.score = fact.score;
      }
    } else {
      kept.push({ ...fact, evidence: [...fact.evidence] });
    }
  }
  return kept.sort(
    (a, b) =>
      Number(a.quote) - Number(b.quote) || b.score - a.score || a.sourceOrder - b.sourceOrder,
  );
}

function supplementalEntityFacts(
  story: Story,
  selection: ReturnType<typeof selectReaderEvidence>,
): ReaderFact[] {
  const facts: ReaderFact[] = [];
  /**
   * Only entities the source text itself supports.
   *
   * Entity ranking reads the title and the excerpts as one string, so a
   * capitalized window can span the boundary between them -- "Hijacking
   * Human-in-the-Loop Approval Human" is a title tail glued to the excerpt's
   * first word. Rewriting a sentence with a name like that attributes a claim to
   * nobody and duplicates the sentence it was spliced into.
   */
  const supportedText = story.sourceList
    .map((source) =>
      [source.excerpt ?? "", ...(source.enrichedEvidence ?? []).map((unit) => unit.text)].join(" "),
    )
    .join(" ")
    .toLowerCase();
  const entities = selection.entities.filter(
    (entity) =>
      entity.role !== "REPORTING_SOURCE" && supportedText.includes(entity.name.toLowerCase()),
  );
  story.sourceList.forEach((source, sourceIndex) => {
    const sentences = readerSentences(source.excerpt ?? "");
    // The identity the evidence pass hands its narrator resolution, computed the
    // same way from the same field: a paper's authors are plural and a news
    // desk's narrator is one person. Both paths have to agree about who "us" is,
    // because this one publishes the source's raw sentence.
    const person: "author" | "authors" = isRepositorySourceName(source.name) ? "authors" : "author";
    // The same context the evidence pass reads -- the source's whole text -- so
    // every textual rule fires here exactly as it fired there. A rule that
    // needs the source's own words (a newsletter's index, a name cut at an
    // initial) is inert without it, and the sentence came back published.
    const sourceContext = [
      source.excerpt ?? "",
      ...(source.enrichedEvidence ?? []).map((unit) => unit.text),
    ].join(" ");
    for (const [sentenceIndex, raw] of sentences.entries()) {
      const entity = entities.find((candidate) => {
        const surname = candidate.name.split(" ").at(-1);
        return (
          surname &&
          new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(raw)
        );
      });
      if (!entity) continue;
      const surname = entity.name.split(" ").at(-1);
      // The "As we write, ..." frame comes off because the fact behind it is
      // usually the source's own reporting and survives on its own. The rest of
      // that construction -- "it's less than three weeks since we wrote about
      // X" -- is the publication talking about its own schedule, and it used to
      // be rewritten to "The article describes X". That rewrite published a
      // sentence a bot would write, so the construction is left to the voice
      // refusal below instead, which is where the same sentence's "we" already
      // belongs.
      const normalizedRaw = raw.replace(/^As we write,\s*/i, "");
      // The introduction is the operation the evidence pass performs -- a bare
      // surname resolved to the full name the source supplies -- and it carries
      // the same two guards that pass applies to it: the surname must be
      // name-shaped (capital plus lowercase; `on` and `AI` are not surnames) and
      // the occurrence must be written as a name (case-sensitive; `power-on` is
      // a word, not a person). Without them the first word-boundary occurrence
      // anywhere was replaced, and a heading's text landed mid-sentence:
      // `power-Developer Use Cases on to running models` and `Personal Local AI
      // Supercomputing` on the fresh corpus were both this substitution, made
      // from the harvest's half-phrase "Developer Use Cases on" and the term
      // "Local AI" whose surname is the initialism `AI`.
      const nameShaped = /^[A-Z][a-z]+$/.test(surname ?? "");
      const text = cleanDeterministicSentence(
        surname &&
          nameShaped &&
          !new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(
            normalizedRaw,
          )
          ? normalizedRaw.replace(new RegExp(`\\b${surname}\\b`), entity.name)
          : normalizedRaw,
      );
      // The same boundary the evidence pass applies. This path rebuilds a
      // sentence straight out of the source excerpt because it names an entity,
      // which used to mean it skipped every rule that had already refused that
      // sentence -- including the one that refuses a sentence whose subject is a
      // pronoun pointing outside itself. The production fixture showed exactly
      // that: a fragment the evidence layer had dropped came back through here.
      //
      // It also has to skip a sentence the evidence pass *carries*. That pass
      // publishes it with its editorial wrapper already removed, and this one
      // reads the raw excerpt, so publishing this copy as well is one fact twice
      // -- the second time with the source's own commentary still on it. The
      // production fixture was rendering "DigiCert doesn't see agent management
      // as a manual problem" and then, again, "Perhaps predictably for a company
      // that built its success on automated verification, DigiCert doesn't see
      // agent management as a manual problem".
      // The narrator rule, for the reason the boundary above is here: this path
      // rebuilds the source's sentence, so a unit the evidence pass refused as an
      // unestablished first person came back through this one. Measured on the
      // live window (2026-10-14): "For us, the single most dominant theme in the
      // talks, the materials, the stands, and even the T-shirts was AI." was
      // counted as `narrator_ambiguous` and then published by this path, because
      // the sentence names NetBSD -- and `publisherVoice`'s VOICE set has never
      // carried `us`, since under a case-insensitive test it matches the country.
      // A sentence the resolution *does* resolve publishes its resolved form, so
      // the same fact cannot reach the page twice in two different voices.
      const narrated = resolveNarrator(text, person);
      if (narrated?.kind === "ambiguous") continue;
      const published = narrated === null ? text : cleanDeterministicSentence(narrated.text);
      const carriesSelected = selection.facts.some((fact) => carries([published], fact.text));
      if (
        !carriesSelected &&
        unitTextRejection(published, false, sourceContext) === null &&
        !editorialNoise(published) &&
        !headingUnit(published) &&
        !contextDependent(published)
      ) {
        facts.push({
          text: published,
          evidence: [sourceIndex + 1],
          origin: "rss",
          score: 1,
          quote: false,
          uncertain: false,
          // This sentence's own position in its source, not a synthetic "after
          // everything else" index: it is a real sentence of that document, so
          // ordering it must land where the document put it.
          sourceOrder: sentenceIndex,
        });
      }
      if (facts.length >= 32) return;
    }
  });
  return facts;
}

/**
 * Whether an attribution clause can be built around this sentence at all.
 *
 * Every test here is a way `"X reports that "` produces a sentence nobody wrote:
 * a question ("reports that Why identity built for humans breaks at agent speed"),
 * a quotation ("reports that "But visibility..."), a sentence whose subject is a
 * pronoun with no antecedent ("According to The Register, they were also
 * commandeering..."), or a stub with no predicate to report. In each case the
 * fact is published without an invented clause -- provenance is not weaker for
 * it, because the citation travels with the sentence either way.
 */
function cannotWrap(text: string): boolean {
  return (
    /\?/.test(text) ||
    /^["“]/.test(text) ||
    // "reports that Why identity built for humans breaks at agent speed" is the
    // glued-attribution defect, whatever else the unit is.
    headingUnit(text) ||
    unresolvedContextOpening(text) ||
    // A sentence that already names its own claimant -- "Researchers also
    // observed ...", "The study found ..." -- is attributed. Wrapping it again
    // produced "According to Nature, Researchers also observed ...": two
    // attributions on one fact, and a capital after a comma. See
    // `alreadyAttributed`.
    alreadyAttributed(text) ||
    !hasPredicate(text)
  );
}

/**
 * The deck's own test: an opening whose referent the page never establishes.
 *
 * Thin on purpose. `unresolvedContextOpening` carries the definition -- including the
 * document-self-reference exemption -- because the audit's ruler and this rule have
 * to agree on what "unresolved" means or the diagnostic cannot tell a real defect
 * from a research abstract convention (the arbiter's D2 closure ruling, 2026-10-11).
 * What stays here is the deck's question, which only the deck has: nothing precedes
 * it, so no ordering of the page can supply the reference.
 */
function needsAntecedentToOpen(text: string): boolean {
  return unresolvedContextOpening(text.trim());
}

function safeLead(
  lead: ReaderFact | undefined,
  story: Story,
  sourceCount: number,
  /** Survey labels per source, from `surveyLabels`. */
  surveys: Map<number, string>,
): { text: string; evidence: number[] } {
  if (!lead) return { text: "", evidence: [] };
  const text = sentence(lead.text);
  if (sourceCount !== 1) return { text, evidence: lead.evidence };
  const source = sourceNameForEvidence(lead.evidence, story.sourceList);
  if (
    !source ||
    AUTHORIAL_OPENING.test(text) ||
    new RegExp(`^${source.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(text)
  ) {
    return { text, evidence: lead.evidence };
  }
  if (isRepositorySourceName(source)) {
    return {
      text: attributedTail(text, researchAttribution(deterministicFactType(text))),
      evidence: lead.evidence,
    };
  }
  if (cannotWrap(text)) return { text, evidence: lead.evidence };
  // The survey comes before the publication, and before the subordinator form:
  // a share of respondents is the survey's finding, and "The Register reports
  // that only half could trace ..." credits the magazine with the interview.
  const survey = surveys.get(lead.evidence[0] ?? -1);
  if (survey && isShareStatistic(text)) {
    return { text: `According to ${survey}, ${statisticClause(text)}`, evidence: lead.evidence };
  }
  // `Overall, ...` and `Ten days later, ...` cannot follow `that` -- see
  // `frontedOpener` -- so the adverbial leads the attribution instead. Its rest
  // keeps the source's capitalisation: the adverbial was written mid-sentence, so
  // the case that follows it is the source's own.
  const opener = frontedOpener(text);
  if (opener) {
    return {
      text: `${opener.opener}, ${source} reports that ${withoutDiscourseMarker(opener.rest)}`,
      evidence: lead.evidence,
    };
  }
  const clause = withoutDiscourseMarker(text);
  // `Once they were out in the wild ...` is the one opening a reported clause may
  // not keep -- the gate refuses it, so the composer lowers it.
  if (SUBORDINATE_CLAUSE_OPENING.test(clause)) {
    return {
      text: `${source} reports that ${reportedClause(clause) ?? clause}`,
      evidence: lead.evidence,
    };
  }
  // Everything else keeps the capital its source wrote -- "All Things Considered
  // host ..." is a name, and lowering it after `that` would be a guess -- so it
  // cannot follow `reports that`. This used to publish "According to <outlet>,
  // <clause>", which is how the deck read "According to Krebs on Security, Army
  // soldier who pleaded guilty ...": the story's own source, credited in front of
  // a fact its citation already carries. The same rule a source's own frame
  // gets decides it: a plain fact stands alone, and a claim, estimate or
  // projection keeps its attribution after it. See `attributeToOwnSource`.
  return { text: attributeToOwnSource(clause, source).text, evidence: lead.evidence };
}

/* ------------------------------------------------------------------------- */
/* Who a statistic belongs to                                                */
/* ------------------------------------------------------------------------- */

/**
 * The survey a statistic came from, when the source names one.
 *
 * "Only half could trace AI decisions back to the models and data that produced
 * them." carries no claimant of its own, and the sentence two lines earlier
 * says "in DigiCert's 2026 AI Trust Pulse survey of 1,001 IT and cybersecurity
 * decision-makers". Handed to the publication, that sentence credits a magazine
 * with 1,001 interviews it did not run -- wrong in a way a reader cannot see.
 *
 * The label is the source's own words: possessor, optional year, the survey's
 * name. Nothing is invented, no sample size is spliced into the sentence, and a
 * sentence that already names its survey is left exactly as written. A label
 * that starts with "The" or "This" is not a name and is ignored.
 */
const SURVEY_LABEL =
  /([A-Z][\p{L}\p{N}&.'’-]*(?:['’]s)?(?:\s+(?:\d{4}|[A-Z][\p{L}\p{N}&.'’-]*)){0,4}\s+(?:survey|poll|study))/u;
const NOT_A_SURVEY_OWNER = /^(?:the|a|an|this|that|these|those|its|their|our|his|her|new)$/i;

/** The longest survey label named anywhere in each source's own facts. */
function surveyLabels(items: { text: string; evidence: number[] }[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const fact of items) {
    const index = fact.evidence[0];
    if (index === undefined) continue;
    const label = SURVEY_LABEL.exec(fact.text)?.[1];
    if (!label) continue;
    if (NOT_A_SURVEY_OWNER.test(label.split(/\s+/)[0] ?? "")) continue;
    const current = labels.get(index);
    if (current === undefined || label.length > current.length) labels.set(index, label);
  }
  return labels;
}

/**
 * Whether a sentence reports a share, which is what makes it the survey's claim.
 *
 * Both halves are required. The opening quantifier says the sentence is a
 * proportion rather than an incident, and the share word says the same thing
 * again from the inside, so "Only three customers complained" -- a count of named
 * people -- is left to the publication that printed it.
 */
const SHARE_OPENING =
  /^(?:only|just|about|around|roughly|nearly|almost|some|half|two[-\s]thirds?|three[-\s]quarters?|a third|a quarter|a half|one in)\s/i;
const SHARE_WORD =
  /\b(?:half|halves|quarter|quarters|third|thirds|per ?cent|percent|percentage|share|majority|minority)\b|\d+\s+(?:out )?of\s+\d+/i;

export function isShareStatistic(text: string): boolean {
  return SHARE_OPENING.test(text) && SHARE_WORD.test(text);
}

/**
 * A share statistic spliced after the survey that measured it, quantifier lowered.
 *
 * Only a sentence `SHARE_OPENING` matched reaches this, so the token being lowered
 * is a quantity by the same test that decided the sentence is a share at all --
 * not a guess about whether the word before a capital is part of a name. The rest
 * of the sentence keeps the source's own capitalisation.
 */
function statisticClause(text: string): string {
  const opening = (SHARE_OPENING.exec(text)?.[0] ?? "").trimEnd();
  if (opening === "") return text;
  return opening.toLowerCase() + text.slice(opening.length);
}

/**
 * The path that composes from the legacy intelligence shape has no selected
 * facts to read a survey label out of -- its items are constructed labels and
 * numbers rather than the source's own sentences -- so it attributes to the
 * publication and never to a survey it cannot quote.
 */

/* ------------------------------------------------------------------------- */
/* Relative time, anchored to the story's own date                            */
/* ------------------------------------------------------------------------- */

/**
 * Replace a source's relative time references with the dates they meant, or
 * refuse the fact.
 *
 * "Earlier this month" is not wrong, it is unusable: a story is read days or
 * weeks after it was written and kept in the archive for as long as a plan
 * allows, so the reader cannot tell which month it was. The story's own date is
 * the anchor, and a phrase that cannot be anchored that way -- a week has no
 * name -- refuses the fact instead, which is counted. One pass over the inputs,
 * before selection, so the deck, the paragraphs and the entity facts all read
 * the same list.
 */
function anchorRelativeTimes(
  facts: ReaderFact[],
  publishedAt: string,
  diagnostics: CompositionDiagnostics,
): ReaderFact[] {
  const parsed = publishedAt ? new Date(publishedAt) : null;
  const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const kept: ReaderFact[] = [];
  for (const fact of facts) {
    const timed = normalizeRelativeTime(fact.text, at);
    if (timed === null) {
      // A week cannot be named and "the last month" is not the calendar month
      // before this one, so there is no absolute form to write. The phrase is a
      // modifier rather than a fact, so the sentence is kept without it, and only
      // a sentence that stops being a sentence is refused whole. Refusing all of
      // them is how the Greek prime minister's remark published an empty page:
      // every sentence it had said "this week".
      const trimmed = stripUnanchorableTime(fact.text);
      if (trimmed === null) {
        diagnostics.qualityGate.relativeTimeRefusals += 1;
        refuseBlock(fact.text, "relative_time", diagnostics);
        continue;
      }
      diagnostics.sourceNormalization.relativeTimesStripped += 1;
      keepSample(diagnostics.sourceNormalization.samples.relativeTimes, fact.text, trimmed);
      kept.push({ ...fact, text: trimmed });
      continue;
    }
    if (timed.changed) {
      diagnostics.sourceNormalization.relativeTimesAnchored += 1;
      keepSample(diagnostics.sourceNormalization.samples.relativeTimes, fact.text, timed.text);
      kept.push({ ...fact, text: timed.text });
      continue;
    }
    kept.push(fact);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* A preview of something that has already happened                     */
/* ------------------------------------------------------------------ */

/** Month names as calendar numbers, for a date written the way copy writes it. */
const MONTH_NUMBERS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/** `September 29`, `September 29th, 2026` — the forms a news source writes. */
const ABSOLUTE_DATE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/i;

/**
 * Framing that presents the event as still ahead of the reader.
 *
 * Present continuous and the polite futures — "is hosting", "is set to",
 * "takes place" — are how a preview is written, and they are the only reason a
 * past date in a sentence means anything wrong: "The council met on September
 * 29" is reporting, "The council meets on September 29" published on the 30th
 * is a promise about a day that has gone.
 */
const UPCOMING_FRAMING =
  /\b(?:has a date|is happening|are happening|is hosting|are hosting|will host|will be hosting|is scheduled for|are scheduled for|is set to|are set to|takes place|take place|will take place|is slated to|kicks off|will kick off|starts on|will start|is due to|coming up)\b/i;

/**
 * Refuse a sentence that announces, as still ahead of the reader, a date the
 * reader has already lived through.
 *
 * `anchorRelativeTimes` above fixes "earlier this month"; this is its opposite
 * failure. A source written the day before an event carries the event into the
 * archive as a promise — on 2026-09-30 the DevDay story still said "The company
 * is hosting its annual DevDay on September 29th", which a reader who had
 * watched it happen reads as either stale or wrong. The date is not rewritten:
 * the composer never paraphrases, so a sentence that cannot be published as it
 * stands is refused, and the refusal is counted like every other.
 *
 * Both halves are required. A date with no upcoming frame is reporting about
 * the past, and an upcoming frame with no date may be about any day — neither is
 * a claim this rule can prove false.
 */
function refuseStalePreviews(
  facts: ReaderFact[],
  publishedAt: string,
  diagnostics: CompositionDiagnostics,
): ReaderFact[] {
  const published = publishedAt ? new Date(publishedAt) : null;
  if (published === null || Number.isNaN(published.getTime())) return facts;
  const cutoff = Date.UTC(
    published.getUTCFullYear(),
    published.getUTCMonth(),
    published.getUTCDate(),
  );

  const kept: ReaderFact[] = [];
  for (const fact of facts) {
    const match = ABSOLUTE_DATE.exec(fact.text);
    if (match === null || !UPCOMING_FRAMING.test(fact.text)) {
      kept.push(fact);
      continue;
    }
    const month = MONTH_NUMBERS[match[1]!.toLowerCase()];
    // With no year, the story's own year: a source written this month means
    // this month, and a reader who met the date in a later year has the
    // archive's own date to work from.
    const year = match[3] === undefined ? published.getUTCFullYear() : Number(match[3]);
    const day = Number(match[2]);
    if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) {
      kept.push(fact);
      continue;
    }
    const when = Date.UTC(year, month, day);
    if (when >= cutoff) {
      kept.push(fact);
      continue;
    }
    diagnostics.qualityGate.stalePreviewRefusals += 1;
    refuseBlock(fact.text, "stale_preview", diagnostics);
  }
  return kept;
}

/**
 * How a research repository's claim is attributed, after the fact.
 *
 * arXiv is where a paper is posted, not a party to anything, so it can never be
 * the claimant: `According to arXiv cs.CR, ...` credits a subject category with
 * a research finding. The paper is the actor.
 *
 * The attribution follows the sentence rather than leading it, because a fact
 * that leads has to be lowercased to follow a colon or a `that`, and that would
 * be a guess about whether its first word is a proper noun. "A new paper
 * reports: DigiCert will ..." was that guess avoided by publishing a label;
 * "DigiCert will ..., a new paper reports" needs no guess and reads as prose.
 * See `normalizeReportFraming`, which does the same for a source's own labels.
 */
function researchAttribution(type: DeterministicFactType): string {
  if (type === "projection") return "the paper projects";
  if (type === "estimate") return "the paper estimates";
  if (type === "claim") return "the paper argues";
  return "a new paper reports";
}

/**
 * The fact, with its attribution after it: "DigiCert will ..., a new paper
 * reports."
 *
 * Only for a fact that ends in a full stop. A question cannot take a trailing
 * attribution, and a fact carrying its attribution in the middle of it would
 * read as two claims if one were appended to the end.
 */
function attributedTail(text: string, attribution: string): string {
  if (/[!?…]\s*$/.test(text)) return text;
  return `${text.replace(/[.!?]+$/, "")}, ${attribution}.`;
}

function attributedFactText(
  text: string,
  evidence: number[],
  story: Story,
  /** Survey labels per source, from `surveyLabels`. */
  surveys: Map<number, string>,
): string {
  const type = deterministicFactType(text);
  if (!evidence.length) return text;
  const survey = surveys.get(evidence[0] ?? -1);
  // A share of respondents is a finding, whichever way the sentence is typed,
  // and it is the survey's -- so the type test does not gate it.
  const statistic = Boolean(survey) && isShareStatistic(text);
  if (!statistic && !["claim", "estimate", "projection"].includes(type)) return text;
  if (AUTHORIAL_OPENING.test(text)) return text;
  if (
    alreadyAttributed(text) ||
    /\b(?:according to|reports?|said|says|estimates?|projects?|found|argues?|claims?)\b/i.test(text)
  )
    return text;
  const source = sourceNameForEvidence(evidence, story.sourceList);
  if (!source) return text;
  // The sentence decides the shape, not the source: an ungrammatical wrap is
  // worse than no wrap, and the citation already carries the provenance.
  if (cannotWrap(text)) return text;
  if (statistic && survey) return `According to ${survey}, ${statisticClause(text)}`;
  if (isRepositorySourceName(source)) return attributedTail(text, researchAttribution(type));
  const opener = frontedOpener(text);
  if (opener)
    return `${opener.opener}, ${source} reports that ${withoutDiscourseMarker(opener.rest)}`;
  const clause = withoutDiscourseMarker(text);
  // `reportedClause` answers null when it cannot lowercase the opening -- a
  // name, a participle ("Founded in early 2024, ..."), a fronted adverbial it
  // does not recognise ("As part of the deal, ..."), or a plain subject ("The
  // acquisition ..."). The code here used to append the clause anyway, which
  // is how production published `The Register reports that Founded in early
  // 2024` and `reports that The acquisition is also a hedge`: a capital after
  // `that`, which is not English. Guessing which capital begins a name is the
  // guess `reportedClause` exists to refuse, so the attribution goes behind the
  // fact instead -- grammatical either way, and a claim keeps its claimant.
  const reported = reportedClause(clause);
  if (reported !== null) return `${source} reports that ${reported}`;
  return attributeToOwnSource(clause, source).text;
}

export type DeterministicQualityReport = {
  factsSelected: number;
  // Counted by reading the article, so the audit stands on its own: every
  // paragraph is split into sentences, and each is judged as a sentence.
  acceptedSentences: number;
  rejectedSentences: number;
  rejectionReasons: Record<string, number>;
  paragraphsKept: number;
  paragraphGroups: number;
  paragraphsSplit: number;
  paragraphRejectedReasons: Record<string, number>;
  duplicateParagraphs: number;
  malformedParagraphs: number;
  /**
   * Selected facts that reached no block. Only the composition pass holds the
   * fact list, so this is 0 when the audit is called without its diagnostics.
   */
  factsLostAfterComposition: number;
  /** Sentences dropped because a provider field was still at their start. */
  metadataLeakWarnings: number;
  /** Sentences dropped because they credited a repository or category with a claim. */
  malformedAttributionWarnings: number;
  fallbackLevel: 1 | 2 | 3;
};

export function auditDeterministicArticle(
  article: ReaderArticle,
  diagnostics?: CompositionDiagnostics,
): DeterministicQualityReport {
  let duplicateParagraphs = 0;
  let malformedParagraphs = 0;
  let metadataLeakWarnings = 0;
  let malformedAttributionWarnings = 0;
  let acceptedSentences = 0;
  let rejectedSentences = 0;
  let paragraphsSplit = 0;
  const rejectionReasons: Record<string, number> = {};
  const paragraphRejectedReasons: Record<string, number> = {};
  const kept: ArticleParagraph[] = [];
  for (const paragraph of article.paragraphs) {
    const sentences = readerSentences(paragraph.text);
    if (sentences.length > 1) paragraphsSplit++;
    if (!validDeterministicParagraph(paragraph.text)) {
      malformedParagraphs++;
      tally(paragraphRejectedReasons, "invalid_paragraph");
    } else if (kept.some((prior) => similarEnough(prior.text, paragraph.text))) {
      duplicateParagraphs++;
      tally(paragraphRejectedReasons, "duplicate_paragraph");
    } else {
      kept.push(paragraph);
    }
    for (const part of sentences) {
      if (part.trim() !== "" && validDeterministicSentence(part)) {
        acceptedSentences++;
        continue;
      }
      rejectedSentences++;
      tally(rejectionReasons, "invalid_sentence");
    }
  }
  for (const text of [article.deck.text, ...article.paragraphs.map((part) => part.text)]) {
    if (hasSourceMetadata(text)) metadataLeakWarnings++;
    if (malformedAttribution(text)) malformedAttributionWarnings++;
  }
  const fallbackLevel = kept.length === 0 ? (article.deck.text ? 2 : 3) : 1;
  return {
    factsSelected:
      article.deck.evidence.length +
      article.paragraphs.reduce((sum, paragraph) => sum + paragraph.evidence.length, 0),
    acceptedSentences,
    rejectedSentences,
    rejectionReasons,
    paragraphsKept: kept.length,
    paragraphGroups: article.paragraphs.length,
    paragraphsSplit,
    paragraphRejectedReasons,
    duplicateParagraphs,
    malformedParagraphs,
    factsLostAfterComposition: diagnostics?.facts.lost ?? 0,
    metadataLeakWarnings,
    malformedAttributionWarnings,
    fallbackLevel,
  };
}

/**
 * The final deterministic check before prose ships.
 *
 * It refuses four things the composer is not allowed to publish even if they
 * reach it: a sentence still carrying a provider field, an attribution that
 * credits a repository or subject category with a claim, a sentence that only
 * restates the deck, and a sentence that is not a sentence. Provenance is never
 * dropped with the text -- the duplicate's evidence is folded into the copy that
 * survives.
 *
 * Validation runs at the level each unit belongs to. A paragraph reaching this
 * function is several sentences, so it is split before anything is judged: a
 * character limit describes a sentence, and passing a paragraph to the sentence
 * validator is how a 462-character block of three valid sentences used to be
 * refused whole, discarding two of them. Every refusal is counted with its
 * reason, so nothing between selection and rendering disappears unexplained.
 */
function qualityGate(
  article: ReaderArticle,
  title: string,
  diagnostics: CompositionDiagnostics,
  /**
   * The fact ledger, so a sentence this gate refuses is charged to the fact
   * behind it. Without it the gate can only count sentences, and every fact
   * inside a block it dropped stayed unexplainable in `facts.lost`.
   */
  ledger: FactLedger,
): ReaderArticle {
  const sentencesWithEvidence: { text: string; evidence: number[] }[] = [];
  const index = new Map<string, number>();
  const deck = article.deck;
  const mergeInto = (target: { evidence: number[] }, evidence: number[]) => {
    target.evidence = [...new Set([...target.evidence, ...evidence])];
  };
  const refuse = (reason: string, part: string) => {
    diagnostics.sentences.refused += 1;
    tally(diagnostics.sentences.reasons, reason);
    markSentence(ledger, part, reason);
  };
  // The deck is prose, so it is judged as prose. Indexing it only when it
  // already passed is what let a photo credit sit under a headline: an invalid
  // deck was never refused, because nothing here ever asked.
  //
  // Before judging: a deck opens a page nobody has read half of, so a
  // backwards-referencing connector -- "Meanwhile, The Register reports that
  // ..." shipped on the 2026-10-01 briefing -- must go. The event-summary
  // path strips the same family (news-signals.ts); the deck takes the
  // identical treatment here, at the one gate every deck path passes through,
  // so the gate judges and publishes the same cleaned sentence.
  if (deck.text.trim() !== "") deck.text = stripFrontedConnector(deck.text);
  const deckVerdict = deck.text.trim() === "" ? null : judgeFallbackDeck(deck.text, title);
  if (deckVerdict === null) {
    // Nothing to publish; the page renders headline and sources.
  } else if (deckVerdict.reason === null) {
    index.set(sentenceKey(deckVerdict.text), -1);
  } else {
    diagnostics.qualityGate.deckRefusals += 1;
    tally(diagnostics.qualityGate.deckReasons, deckVerdict.reason);
    // Charged to the fact behind the deck before the deck is cleared: a refused
    // deck is the story's lead sentence gone, and it used to leave the fact that
    // produced it unexplained.
    refuse(deckVerdict.reason, deck.text);
    deck.text = "";
    deck.evidence = [];
  }
  for (const paragraph of article.paragraphs) {
    diagnostics.paragraphs.assembled += 1;
    const parts = readerSentences(paragraph.text);
    if (parts.length > 1) diagnostics.paragraphs.split += 1;
    let published = 0;
    for (const part of parts) {
      diagnostics.sentences.considered += 1;
      if (part.trim() === "") {
        refuse("empty_sentence", part);
        continue;
      }
      // Checked before validity so a leak is still reported as a leak: the
      // sentence validator refuses these too, but this counter is what the admin
      // read-quality sample reads.
      if (hasSourceMetadata(part)) {
        diagnostics.qualityGate.metadataLeakWarnings += 1;
        refuse("metadata_leak", part);
        continue;
      }
      // An undecoded `&#x20;` is four characters on the page. Nothing below this
      // point may publish one, whatever route brought it here.
      if (hasVisibleEntity(part)) {
        diagnostics.qualityGate.entityLeakWarnings += 1;
        refuse("entity_leak", part);
        continue;
      }
      if (!validDeterministicSentence(part)) {
        refuse("invalid_sentence", part);
        continue;
      }
      if (malformedAttribution(part) || gluedAttribution(part)) {
        diagnostics.qualityGate.malformedAttributionWarnings += 1;
        refuse("malformed_attribution", part);
        continue;
      }
      // A heading that reached a block anyway -- a stored summary, a sentence the
      // entity path rebuilt -- because a subhead is not a fact about anything.
      if (headingUnit(part)) {
        diagnostics.qualityGate.headingUnitWarnings += 1;
        refuse("headline_fragment", part);
        continue;
      }
      // Two blocks published as one sentence: a heading, a photo credit or a
      // session's speakers joined to the prose after them. Judged before the
      // sentence itself is, because the sentence test is what the glue passes.
      if (sourceSeam(part)) {
        diagnostics.qualityGate.sourceSeamWarnings += 1;
        refuse("invalid_sentence", part);
        continue;
      }
      // A paragraph that only restates the deck is the deck, not a paragraph.
      //
      // Checked before the refusal rules below, because a duplicate of published
      // prose is not a defect in it: refusing it under one of them charges the
      // *deck's* fact -- this sentence's key is the deck's key -- with a rule the
      // deck itself passed, which is how a fact that was never withheld came to be
      // reported as refused and published by another path. The reader is owed the
      // sentence once, and this is the block that supplies it.
      if (nearDuplicate(deck.text, part)) {
        mergeInto(deck, paragraph.evidence);
        diagnostics.sentences.merged += 1;
        continue;
      }
      // "Both saw agents make their way onto the open internet", and a fronted
      // clause whose main clause is a pronoun: the subject is outside the
      // sentence, and no ordering of the page supplies it. The softer class --
      // `they`, `this`, `these` -- was already decided by the composer, which is
      // the only place that knows what is published next to what.
      if (unresolvableContext(part)) {
        diagnostics.qualityGate.unresolvedContextWarnings += 1;
        refuse("unresolved_context", part);
        continue;
      }
      // Two long quoted passages in one sentence is a concatenation, not speech.
      if (quotedSpans(part) > 1) {
        diagnostics.qualityGate.stackedQuoteWarnings += 1;
        refuse("stacked_quotes", part);
        continue;
      }
      // A sentence cut at a clipping boundary -- a month, an article, a binding
      // preposition -- is broken prose, and the block that opens on it is the
      // worst place for broken prose to sit. The predicate uses the same bounded
      // ruler the audit measures with, so the rule and the measurement cannot
      // drift.
      if (truncatedSentence(part) !== "") {
        console.log("REFUSE truncated part:", JSON.stringify(part));
        console.log("  key:", sentenceKey(part));
        console.log("  found:", ledger.sentences.has(sentenceKey(part)));
        refuse("truncated_sentence", part);
        continue;
      }
      // A raw URL is source metadata leaking into reporting. Only the narrower
      // shape is refused -- a scheme, www., or a path -- because bare domains
      // such as "WordPress.com" are often ordinary nouns in the corpus.
      if (RAW_URL_WITH_PATH.test(part)) {
        refuse("raw_url", part);
        continue;
      }
      const key = sentenceKey(part);
      if (key === "") {
        refuse("empty_sentence", part);
        continue;
      }
      const existing = index.get(key);
      if (existing === undefined) {
        index.set(key, sentencesWithEvidence.length);
        // Deduplicated: a paragraph assembled from facts that all cite one source
        // was carrying `[1]` twice per block, which read as machinery rather than
        // as provenance. The renderer dedupes too; this keeps the stored article
        // honest for anything else that reads it.
        sentencesWithEvidence.push({ text: part, evidence: [...new Set(paragraph.evidence)] });
        published += 1;
        continue;
      }
      const target = existing < 0 ? deck : sentencesWithEvidence[existing];
      if (target) mergeInto(target, paragraph.evidence);
      diagnostics.sentences.merged += 1;
    }
    if (published === 0) {
      diagnostics.paragraphs.rejected += 1;
      tally(diagnostics.paragraphs.reasons, "no_publishable_sentence");
    }
  }

  // Assemble blocks from sentences that already passed, and let the paragraph
  // validator be the merge condition: a merge that would produce a block its own
  // validator refuses simply does not happen, so no fact is lost to reach a
  // paragraph shape, and every published block passes the paragraph check.
  const assembled: { text: string; evidence: number[]; sentences: number }[] = [];
  for (const part of sentencesWithEvidence) {
    const prior = assembled.at(-1);
    const merged = prior ? `${prior.text} ${part.text}` : part.text;
    const shares = prior && prior.evidence.some((ref) => part.evidence.includes(ref));
    if (
      prior &&
      shares &&
      countWords(merged) <= PARAGRAPH_WORD_BUDGET &&
      validDeterministicParagraph(merged)
    ) {
      prior.text = merged;
      prior.evidence = [...new Set([...prior.evidence, ...part.evidence])];
      prior.sentences += 1;
    } else {
      assembled.push({ text: part.text, evidence: [...part.evidence], sentences: 1 });
    }
  }

  const cap = sentencesWithEvidence.length > 12 ? 8 : 6;
  // Whitespace is repaired rather than punished: a double space is a seam from
  // text assembly (an attribution prefix pasted onto a cleaned sentence), not a
  // claim, and dropping the fact over it would fail in the wrong direction. The
  // counter exists so the seam is visible in diagnostics instead of silent.
  for (const block of assembled) {
    const tidy = block.text.replace(/\s{2,}/g, " ").trim();
    if (tidy !== block.text) diagnostics.qualityGate.spacingRepairs += 1;
    block.text = tidy;
  }
  const blocks = assembled.slice(0, cap);
  for (const block of assembled.slice(cap)) {
    // Over the cap, so the block is not published and the facts behind its
    // sentences are charged to the cap rather than vanishing with the block.
    markSentence(ledger, block.text, "article_limit");
    for (let count = 0; count < block.sentences; count++) {
      diagnostics.sentences.refused += 1;
      tally(diagnostics.sentences.reasons, "article_limit");
      tally(diagnostics.paragraphs.reasons, "article_limit");
    }
  }
  diagnostics.sentences.rendered = blocks.reduce((total, block) => total + block.sentences, 0);
  diagnostics.paragraphs.rendered = blocks.length;
  return {
    deck,
    paragraphs: blocks.map((block) => ({ text: block.text, evidence: block.evidence })),
  };
}

/**
 * Where a group of facts belongs in the reader's progression.
 *
 * The earliest position any of its sentences occupies, so a paragraph built
 * around "Atlas can navigate pages" leads even when it also carries a passing
 * commercial aside. The deck already carries the event, so `capability` leads
 * rather than another statement of what happened -- see `storyPosition` for why
 * that ordering is the one a reader wants.
 *
 * Stable: `Array.prototype.sort` is stable in every engine this runs on, so two
 * groups of equal rank keep the relevance order they arrived in, which is the
 * tie-break that existed before this and the one that should still decide.
 */
function groupRank(group: ReaderFact[]): number {
  return Math.min(...group.map((fact) => storyPositionRank(fact.text)));
}

function deterministicParagraphs(
  facts: ReaderFact[],
  story: Story,
  diagnostics: CompositionDiagnostics,
  surveys: Map<number, string>,
  /** Where a fact this pass does not publish is charged, with its rule. */
  ledger: FactLedger,
): ArticleParagraph[] {
  const groups: ReaderFact[][] = [];
  for (const fact of facts) {
    /**
     * A `they` or a `this` in a ranked list has nothing to point at.
     *
     * Source order is what makes an anaphoric sentence readable -- the sentence
     * the author wrote before it is the sentence the reader just read. Ranking
     * destroys that guarantee: relevance order puts whatever scored highest first,
     * so "they were also commandeering a German website" can land three paragraphs
     * away from the agents it means. Rather than publish a mystery, the fact is
     * refused here and counted, which is the same trade the gate makes for the
     * class no ordering can fix.
     */
    if (
      contextDependent(fact.text) &&
      !recoverableContext(fact.text) &&
      !unresolvableContext(fact.text)
    ) {
      diagnostics.qualityGate.unresolvedContextWarnings += 1;
      diagnostics.facts.refusalEvents += 1;
      markFact(ledger, fact.text, "unresolved_context");
      refuseBlock(fact.text, "unresolved_context", diagnostics);
      continue;
    }
    const type = deterministicFactType(fact.text, fact.quote);
    const target =
      type === "fact" || type === "claim" || type === "estimate" || type === "projection"
        ? 0
        : type === "future_action"
          ? 3
          : type === "background" || type === "comparison"
            ? 2
            : 1;
    const prior = groups[target];
    const sameSource =
      !!prior && prior.some((item) => item.evidence.some((ref) => fact.evidence.includes(ref)));
    /**
     * A paragraph is one idea, so facts join it only when they are about what it
     * is already about.
     *
     * The old condition was "same source", which is satisfied by every fact of a
     * single-source story -- so eight unrelated sentences became one paragraph and
     * the reader got OpenAI, then a survey, then Meta, then JFrog in a single
     * block. Two shared content words is a low bar and a decisive one: it groups
     * adjacent evidence about one incident and refuses to group evidence about
     * two.
     *
     * The exception is a group still shorter than the paragraph floor: a fact that
     * has nowhere better to go joins it rather than being dropped for the crime of
     * arriving alone. Failing towards a slightly looser paragraph is better than
     * failing towards a missing fact.
     */
    const underFloor =
      !!prior && countWords(prior.map((item) => item.text).join(" ")) < MIN_PARAGRAPH_WORDS;
    if (
      prior &&
      prior.length < 8 &&
      sameSource &&
      (sharesSubject(prior.map((item) => item.text).join(" "), fact.text) || underFloor)
    )
      prior.push(fact);
    else if (!prior) groups[target] = [fact];
    else groups.push([fact]);
  }
  return groups
    .filter((group): group is ReaderFact[] => !!group?.length)
    .sort((a, b) => groupRank(a) - groupRank(b))
    .map((group) => {
      const parts = group
        .map((fact) => factSentence(fact, story, diagnostics, surveys, ledger))
        .filter((text): text is string => text !== null);
      return { text: parts.join(" "), evidence: citationRefs(group), facts: group };
    })
    .filter((paragraph) => {
      if (countWords(paragraph.text) >= MIN_PARAGRAPH_WORDS) return true;
      // A paragraph under the floor is dropped whole, so every fact it was built
      // from is charged to `short_block` here. A sentence count could not say
      // which facts went, which is how they became "unexplained" before.
      markDroppedFacts(ledger, paragraph.facts, "short_block");
      refuseBlock(paragraph.text, "short_block", diagnostics);
      return false;
    })
    .map(({ text, evidence }) => ({ text, evidence }));
}

/**
 * The published sentence for one fact, or null when it cannot be published.
 *
 * The sentence the reader would get is the one that has to be valid. An
 * attribution prefix adds ~20 characters, so a fact sitting near the sentence
 * ceiling can be pushed over it -- in that case the fact ships without the
 * prefix rather than not at all.
 */
function factSentence(
  fact: ReaderFact,
  story: Story,
  diagnostics: CompositionDiagnostics,
  surveys: Map<number, string>,
  /** The ledger this sentence either joins or is charged to. */
  ledger: FactLedger,
): string | null {
  const attributed = sentence(attributedFactText(fact.text, fact.evidence, story, surveys));
  const text = validDeterministicSentence(attributed) ? attributed : sentence(fact.text);
  if (validDeterministicSentence(text)) {
    indexSentence(ledger, text, fact.text);
    return text;
  }
  diagnostics.sentences.refused += 1;
  diagnostics.facts.refusalEvents += 1;
  markFact(ledger, fact.text, "invalid_sentence");
  tally(diagnostics.sentences.reasons, "invalid_sentence");
  return null;
}

/**
 * A single paper in the order it was written, one sentence per fact.
 *
 * Abstracts are structured on purpose -- problem, method, finding, implication
 * -- and they lean on that structure to be readable: "That boundary is only
 * meaningful if...", "They show that...", "These results do not..." all point at
 * a sentence some distance back. Grouping those facts by role and relevance, as
 * a multi-source news event wants, publishes the anaphora before its antecedent.
 *
 * Order here is the document's own order, and the gate does the merging, so the
 * paragraphs that come out are simply the paper read forwards. Nothing else is
 * reordered: a second source, or facts that came from article-page enrichment
 * (whose units were already selected by density rather than position), keep the
 * role-and-relevance path.
 */
function narrativeParagraphs(
  facts: ReaderFact[],
  story: Story,
  diagnostics: CompositionDiagnostics,
  /** Source position of the sentence already published as the deck. */
  deckOrder: number,
  surveys: Map<number, string>,
  /** Where a fact this pass does not publish is charged, with its rule. */
  ledger: FactLedger,
): ArticleParagraph[] {
  const paragraphs: ArticleParagraph[] = [];
  let previousOrder = deckOrder;
  for (const fact of facts) {
    const text = factSentence(fact, story, diagnostics, surveys, ledger);
    if (text === null) continue;
    // Here, unlike the ranked path, adjacency can actually be checked: the fact
    // the author wrote immediately before this one is the one just published, so
    // "That boundary is only meaningful if..." has a boundary in hand. One
    // sentence gap -- because the sentence between them was refused, or because
    // two sentences were merged -- and the pronoun is pointing at a page that no
    // longer says what it meant.
    if (
      contextDependent(text) &&
      !recoverableContext(text) &&
      !unresolvableContext(text) &&
      fact.sourceOrder !== previousOrder + 1
    ) {
      diagnostics.qualityGate.unresolvedContextWarnings += 1;
      diagnostics.facts.refusalEvents += 1;
      markFact(ledger, fact.text, "unresolved_context");
      refuseBlock(text, "unresolved_context", diagnostics);
      continue;
    }
    paragraphs.push({ text, evidence: [...new Set(fact.evidence)] });
    previousOrder = fact.sourceOrder;
  }
  return paragraphs;
}

/**
 * Which form of attribution a published block wears, read off its own text.
 *
 * Read rather than recorded, deliberately: the counters have to describe the
 * prose that exists, not the intention that produced it, which is the same rule
 * the audit script applies when it counts defects on the published page.
 */
function attributionShape(block: string): string {
  if (/^(?:A new paper reports|The paper (?:argues|estimates|projects)):/.test(block))
    return "research_clause";
  // Read off the prose, like every other shape here: a deck that credits a poll
  // because it read the label is the thing being counted, not the intent.
  if (/^According to [^,]{0,80}\b(?:survey|poll|study)\b/i.test(block))
    return "according_to_survey";
  if (/^According to /.test(block)) return "according_to";
  if (/^[^.!?]{1,60} reports that /.test(block)) return "reports_that";
  if (/^[^.!?]{1,60} (?:said|says) /.test(block)) return "speaker";
  return "none";
}

/**
 * Close out the counters once the article exists.
 *
 * `facts.lost` is the invariant worth watching: a fact that was selected, valid
 * and not a duplicate should appear in the published prose. Anything above zero
 * means it was dropped between selection and rendering, and the gate's reason
 * maps say which unit refused it. The loop walks the facts themselves rather
 * than subtracting the refusal counter, so a fact a rule refused and a later
 * path published anyway is counted where it ended up -- published -- instead of
 * being charged to `lost` and quietly inflating the number that has to mean
 * "nobody can explain this".
 */
function finishDiagnostics(
  article: ReaderArticle,
  facts: ReaderFact[],
  diagnostics: CompositionDiagnostics,
  /** Where every fact that did not publish was charged, with its rule. */
  ledger: FactLedger,
): void {
  const blocks = [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)];
  /**
   * The published sentences, as prose, for the overlap test below.
   *
   * Sentence by sentence rather than block by block, because a block is an
   * assembly of sentences that may come from different facts: containment in the
   * whole block says a fact's words appear somewhere in the paragraph, which is
   * not the same claim as a sentence of this fact being on the page.
   */
  const publishedSentences = blocks.flatMap((block) => readerSentences(block));
  /** The same sentences as identity, for the republication test below. */
  const publishedKeys = new Set(publishedSentences.map((part) => sentenceKey(part)));
  const lost: string[] = [];
  const dispositions: Record<string, number> = {};
  const unrendered: { text: string; rule: string }[] = [];
  const renderedAfterRefusalFacts: {
    text: string;
    rule: string;
    matched: "sentence" | "resemblance";
    evidence: string;
  }[] = [];
  /**
   * Facts whose sentence the ledger says the composer wrote from them.
   *
   * Read off the page, not off the intention: every published sentence is looked
   * up through the ledger, and a sentence the composer wrote from a fact names
   * that fact. It is the same prose test `carries` makes, but it survives a
   * rewrite, which is why it stays in the `rendered` test below even though it is
   * not evidence of a republished fact.
   */
  const publishedFacts = new Set<string>();
  for (const sentence of publishedSentences) {
    const fact = ledger.sentences.get(sentenceKey(sentence));
    if (fact !== undefined) publishedFacts.add(fact);
  }
  let rendered = 0;
  let renderedAfterRefusal = 0;
  let renderedAfterRefusalResemblance = 0;
  for (const fact of facts) {
    // A rule that charged this fact leaves its reason behind even when another
    // path published it anyway, so the overlap is visible rather than erased.
    const key = sentenceKey(fact.text);
    const charged = ledger.unrendered.get(key);
    // Whether this fact reached the page at all. Three readings, and only the
    // first decides the class below.
    //
    // `byLedger` is the ledger's own index: a published sentence was built from
    // this fact, which stays true when the composer *rewrote* it -- "For founders,
    // the Expo Hall ... could mean meeting an investor" publishes as "For
    // founders, TechCrunch reports that the Expo Hall ...", and nothing about the
    // fact's own wording survives to be found. It is right about the fact being
    // published; it is wrong as evidence, because a block a later rule refused
    // also wrote an entry before it was refused.
    //
    // `carrying` asks the page directly, and at sentence boundaries: is every
    // sentence of this fact one of the page's own sentences? That is the one
    // reading that can say a refused fact was republished, because it needs the
    // fact's own text to be a sentence on the page rather than words inside one.
    // Containment alone is not enough -- a quoted message inside another sentence
    // contains its words (the Ohio blogger's "THE PATRIOTS CAUCUS sends its
    // regards" is inside the sentence that reports it), and that is the page
    // quoting a source, not a path republishing a refused fact.
    //
    // `resembles` is the oldest and most generous: the wording comparison matched
    // a sentence about something else, which is the counter reaching too far rather
    // than a bypass, and is kept as its own number for exactly that reason.
    const byLedger = publishedFacts.has(key);
    const factSentences = readerSentences(fact.text)
      .map((part) => sentenceKey(part))
      .filter((part) => part !== "");
    const carrying =
      factSentences.length > 0 && factSentences.every((part) => publishedKeys.has(part))
        ? publishedSentences.filter((part) => factSentences.includes(sentenceKey(part))).join(" ")
        : undefined;
    const resembles = carrying === undefined && carries(blocks, fact.text);
    if (byLedger || carrying !== undefined || resembles) {
      rendered += 1;
      if (charged !== undefined) {
        if (carrying !== undefined) renderedAfterRefusal += 1;
        else renderedAfterRefusalResemblance += 1;
        renderedAfterRefusalFacts.push({
          text: fact.text,
          rule: charged,
          matched: carrying !== undefined ? "sentence" : "resemblance",
          evidence: carrying ?? closestPublishedSentence(publishedSentences, fact.text),
        });
      }
      continue;
    }
    // An explained absence is not lost: `lost` has to keep meaning "selected,
    // valid, published nowhere, and nobody can say why", or the number stops
    // being a bug report and starts being a style preference. The reason is the
    // rule that dropped it -- the sentence validator, the paragraph floor, the
    // thin-evidence cap, the article cap, or the gate itself.
    if (charged !== undefined) {
      tally(dispositions, charged);
      unrendered.push({ text: fact.text, rule: charged });
      continue;
    }
    console.log(
      "LOST fact key:",
      key,
      "len",
      key.length,
      "has?",
      ledger.unrendered.has(key),
      "size",
      ledger.unrendered.size,
    );
    for (const [k, v] of ledger.unrendered.entries())
      console.log("  unrendered key", k, "len", k.length, v);
    lost.push(fact.text);
  }
  diagnostics.facts.rendered = rendered;
  diagnostics.facts.renderedAfterRefusal = renderedAfterRefusal;
  diagnostics.facts.renderedAfterRefusalResemblance = renderedAfterRefusalResemblance;
  diagnostics.facts.renderedAfterRefusalFacts = renderedAfterRefusalFacts;
  diagnostics.facts.dispositions = dispositions;
  diagnostics.facts.unrendered = unrendered;
  diagnostics.facts.refused = Object.values(dispositions).reduce((sum, count) => sum + count, 0);
  diagnostics.facts.lost = lost.length;
  diagnostics.facts.lostFacts = lost;
  for (const block of blocks) {
    if (block === "") continue;
    tally(diagnostics.attribution, attributionShape(block));
  }
  diagnostics.fallbackLevel = auditDeterministicArticle(article, diagnostics).fallbackLevel;
}

/* ------------------------------------------------------------------------- */
/* The no-evidence path                                                      */
/* ------------------------------------------------------------------------- */

const FURNITURE_KINDS = new Set<string>([
  "photo_credit",
  "commit_trailer",
  "release_metadata",
  "metadata_heavy",
  "url_heavy",
  "email_heavy",
]);

/**
 * The sentence a fallback deck is allowed to be, or nothing.
 *
 * A story whose evidence came back empty still renders, and the deck it renders
 * used to be `story.what` verbatim: the stored event summary, written straight
 * from a feed's `description` field. Nothing between the feed and the page asked
 * whether that field was prose, so a media credit, a `git` trailer or a release
 * page's label list shipped under a headline as the article's opening sentence.
 *
 * The judge is the quality gate's rule applied at the deck's own level: a
 * sentence is judged as a sentence. A candidate may be selected, normalized,
 * cleaned and deduplicated against the headline. It may not be *repaired* --
 * nothing here turns metadata into prose, and no sentence is synthesised that
 * the source did not write. An empty deck is the right answer when every
 * candidate is furniture, because headline plus sources is a cleaner absence
 * than a credit line presented as a summary.
 */
export function judgeFallbackDeck(
  candidate: string,
  title: string,
): { text: string; reason: null } | { text: ""; reason: string } {
  // The boundary every provider string meets: normalize, then refuse what
  // normalization leaves. Shared with the briefing card, so the two surfaces
  // cannot disagree about whether the same stored summary is publishable.
  const summary = normalizeSummary(candidate);
  if (summary.reason !== null) return { text: "", reason: summary.reason };
  const text = sentence(summary.text);
  if (malformedAttribution(text) || gluedAttribution(text))
    return { text: "", reason: "malformed_attribution" };
  // A stored summary that is really a subhead is furniture like any other.
  if (headingUnit(text)) return { text: "", reason: "headline_fragment" };
  // And a stored summary that is a heading joined to its own prose is not a
  // sentence, however much of one its second half reads like.
  if (sourceSeam(text)) return { text: "", reason: "malformed_sentence" };
  // And a stored summary that is a list item is not a sentence either: its one verb
  // belongs to a relative clause, so the head is a noun phrase the page never
  // completes. Withheld rather than repaired, on the ruling of 2026-10-14: recover
  // the source's complete sentence when it is attributable, and a bulleted item has
  // none to recover. See `noMainClause` for the live shape and the measurement.
  if (noMainClause(text)) return { text: "", reason: "malformed_sentence" };
  if (hasVisibleEntity(text)) return { text: "", reason: "entity_leak" };
  if (editorialNoise(text)) return { text: "", reason: "editorial_noise" };
  if (!validDeckSentence(text)) return { text: "", reason: "malformed_sentence" };
  if (titleDuplicate(text, title)) return { text: "", reason: "title_duplicate" };
  if (truncatedSentence(text) !== "") return { text: "", reason: "truncated_sentence" };
  if (RAW_URL_WITH_PATH.test(text)) return { text: "", reason: "raw_url" };
  return { text, reason: null };
}

/**
 * A deck is a sentence, but a deck is allowed to be terse.
 *
 * The full sentence floor belongs to a *fact* pulled out of an article, where
 * three words is already a thin claim. A summary the publisher wrote is allowed
 * to be shorter and still say something -- "Talks collapsed." is prose, and
 * holding a deck to the fact floor would empty real stories. What a deck still
 * has to be is a clause with a predicate, which is what keeps a label or a
 * name-and-outlet credit out.
 */
function validDeckSentence(text: string): boolean {
  if (validDeterministicSentence(text)) return true;
  const trimmed = text.trim();
  if (trimmed.length < MIN_SENTENCE_CHARS || trimmed.length > MAX_SENTENCE_CHARS) return false;
  // Terse is allowed; markup is not. The lighter standard below judges the
  // clause, not the serialization, and a stored summary that stops mid-word
  // inside an image tag is neither.
  if (sourceMarkupOrUrl(trimmed)) return false;
  // Terse is allowed; a domain tail is not. "Org automated benchmarking
  // software." is the second half of a site's own about line, and a deck made of
  // it is worse than no deck at all.
  if (/^(?:Org|Com|Gov|Edu|Info|Biz|Xyz)\s+[a-z]/.test(trimmed)) return false;
  const words = trimmed.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 2 && hasPredicate(trimmed);
}

/**
 * Whether a deck is only the headline said again.
 *
 * Kept to near-identity -- the same words, or the same words with a clause
 * appended -- rather than the general near-duplicate test. A summary that shares
 * vocabulary with its own headline is usually a real sentence, and refusing it
 * would trade a good deck for no deck at all. The length floor is what stops a
 * short headline from swallowing a longer summary, and the eight-word allowance
 * is what stops a headline plus one clause from counting as news.
 */
function titleDuplicate(text: string, title: string): boolean {
  const left = sentenceKey(text);
  const right = sentenceKey(title);
  if (left === "" || right === "") return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 24 || !long.includes(short)) return false;
  return long.split(" ").length - short.split(" ").length <= 8;
}

/**
 * Fill the deck from the first candidate that survives the judge, or leave it
 * empty.
 *
 * Every refusal is counted with its reason, so "no deck" is an answer the
 * diagnostics can give rather than a silence -- the same invariant the fact
 * counters hold for the composition path.
 */
function applyFallbackDeck(
  deck: { text: string; evidence: number[] },
  story: Story,
  candidates: string[],
  diagnostics: CompositionDiagnostics,
): void {
  diagnostics.fallback.attempted += 1;
  const parsed = story.publishedAt ? new Date(story.publishedAt) : null;
  const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  for (const raw of candidates) {
    if (raw.trim() === "") continue;
    diagnostics.fallback.candidates += 1;
    // The event summary is prose from the same day as the event, so it carries
    // the same "this month" problem a source sentence does.
    const timed = normalizeRelativeTime(raw, at);
    // Same repair as the facts get: the unanchorable phrase is dropped and the
    // sentence around it kept, because an empty deck is worse than a deck without
    // "this week" in it.
    const stripped = timed === null ? stripUnanchorableTime(raw) : null;
    if (timed === null && stripped === null) {
      diagnostics.fallback.rejected += 1;
      diagnostics.qualityGate.relativeTimeRefusals += 1;
      tally(diagnostics.fallback.reasons, "relative_time");
      continue;
    }
    if (stripped !== null) diagnostics.sourceNormalization.relativeTimesStripped += 1;
    if (timed !== null && timed.changed) {
      diagnostics.sourceNormalization.relativeTimesAnchored += 1;
      keepSample(diagnostics.sourceNormalization.samples.relativeTimes, raw, timed.text);
    }
    const candidate = timed?.text ?? stripped ?? raw;
    const verdict = judgeFallbackDeck(candidate, story.title);
    if (verdict.reason === null) {
      deck.text = verdict.text;
      diagnostics.fallback.accepted += 1;
      return;
    }
    diagnostics.fallback.rejected += 1;
    tally(diagnostics.fallback.reasons, verdict.reason);
    if (verdict.reason === "title_duplicate") diagnostics.fallback.titleDuplicate += 1;
    if (FURNITURE_KINDS.has(verdict.reason)) diagnostics.fallback.furnitureRejected += 1;
  }
  diagnostics.fallback.empty += 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the source itself named this person by surname alone.
 *
 * The evidence pass resolves a bare surname to the full name -- "Schut and his
 * team discovered" becomes "Richard Schut and his team discovered" -- so the
 * test here is the same one: did the source ever write the surname standing
 * alone? "The Omacom Foundation" is only ever spelled that way, so "Foundation"
 * was never a name the reader has been introduced to, and an organisation's last
 * word is not a surname to shorten to.
 */
function surnameStandsAlone(sourceText: string, entityName: string): boolean {
  const parts = entityName.split(" ");
  const surname = parts.at(-1) ?? "";
  const given = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  for (const match of sourceText.matchAll(new RegExp(`\\b${escapeRegExp(surname)}\\b`, "gi"))) {
    const preceding = sourceText.slice(0, match.index ?? 0);
    const before = /([\p{L}][\p{L}'-]*)\s*$/u.exec(preceding)?.[1];
    if (!before || !given.has(before.toLowerCase())) return true;
  }
  return false;
}

/** Ranges of a block that are quoted speech. */
function quotedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(/"[^"\n]*"|“[^”\n]*”/g))
    ranges.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  return ranges;
}

/**
 * A person named in full once, then by the surname their own source used.
 *
 * The evidence pass judges one sentence at a time, and a sentence that says
 * "Schut and his team discovered" has handed the reader a stranger -- so it
 * resolves the surname to the full name. Judged a sentence at a time that rule
 * repeats the full name for the whole story: the production fixture rendered
 * "Richard Schut" four times in 195 words, which is neither how the source wrote
 * it nor how a person is named in prose.
 *
 * The introduction belongs to the article, not to the sentence, so this runs
 * where the reading order exists: the first block to name the entity keeps the
 * full name and every later mention takes the surname -- AP's precedence, and
 * the wording the source itself used. Nothing inside quotation marks is touched;
 * a quoted speaker's words are the source's, and rewriting them would invent a
 * quotation.
 */
function shortenIntroducedNames(
  blocks: { text: string }[],
  entities: RankedEntity[],
  sourceText: string,
): void {
  const candidates = entities.filter((entity) => {
    const parts = entity.name.split(" ");
    if (entity.role === "REPORTING_SOURCE") return false;
    if (parts.length < 2 || parts.length > 3) return false;
    const surname = parts.at(-1)!;
    if (!/^[A-Z][\p{L}'-]*$/u.test(surname)) return false;
    // One surname, one person: two entities sharing it would merge into one.
    if (entities.filter((other) => other.name.endsWith(` ${surname}`)).length !== 1) return false;
    return surnameStandsAlone(sourceText, entity.name);
  });
  if (candidates.length === 0) return;

  const introduced = new Set<string>();
  for (const block of blocks) {
    for (const entity of candidates) {
      const surname = entity.name.split(" ").at(-1)!;
      const namePattern = new RegExp(`\\b${escapeRegExp(entity.name)}\\b`, "g");
      const spoken = quotedRanges(block.text);
      const named = [...block.text.matchAll(namePattern)].filter(
        (match) =>
          !spoken.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end),
      );
      if (named.length === 0) continue;
      // The first mention in reading order is the one that introduces the name;
      // when it is in this block, only the mentions after it are shortened.
      const firstKept = introduced.has(entity.name) ? -1 : (named[0]!.index ?? 0);
      introduced.add(entity.name);
      const shortened = named.filter((match) => (match.index ?? 0) > firstKept);
      if (shortened.length === 0) continue;
      let text = "";
      let cursor = 0;
      for (const match of shortened) {
        const at = match.index ?? 0;
        text += block.text.slice(cursor, at) + surname;
        cursor = at + entity.name.length;
      }
      block.text = text + block.text.slice(cursor);
    }
  }
}

/**
 * How many times one outlet may be credited inside one article.
 *
 * `attributedFactText` gives a claim, estimate or projection its claimant, which
 * is right the first time and wrong on the sixth: a single-source vendor post
 * where nearly every sentence was typed a claim published "according to
 * Cloudflare" eleven times ("Identify AI model overuse with User Insights",
 * 2026-10-02), and a Microsoft Research read repeated "according to Microsoft
 * Research" seven. The outlet is already named in the sidebar and every block
 * carries its citation, so past the second mention the attribution is furniture.
 * The count is per-name across the whole article, in reading order.
 */
const ATTRIBUTION_CAP = 3;

export function capAttributionRepetition(blocks: { text: string }[]): number {
  const counts = new Map<string, number>();
  let removed = 0;
  for (const block of blocks) {
    const parts = readerSentences(block.text);
    if (parts.length === 0) continue;
    const kept = parts.map((part) => {
      const trailing = /,\s*(?:according to|per)\s+([^,.;:!?]{1,60})\.\s*$/.exec(part);
      const prefix =
        /^([A-Z][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,4})\s+reports? that\s+(\S[\s\S]*)$/u.exec(part);
      const framed = /^According to\s+([^,]{1,60}),\s+(\S[\s\S]*)$/.exec(part);
      const name = trailing?.[1] ?? prefix?.[1] ?? framed?.[1];
      if (!name) return part;
      const key = name.trim().toLowerCase();
      const seen = (counts.get(key) ?? 0) + 1;
      counts.set(key, seen);
      if (seen <= ATTRIBUTION_CAP) return part;
      removed += 1;
      const restore = (value: string) => {
        const trimmed = value.trim().replace(/[.!?]+$/, "");
        return trimmed === "" ? trimmed : `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}.`;
      };
      if (trailing) return `${part.slice(0, trailing.index).trimEnd()}.`;
      if (prefix) return restore(prefix[2] ?? "");
      return restore(framed?.[2] ?? "");
    });
    block.text = kept.join(" ");
  }
  return removed;
}

/**
 * The inert story shell the composer reads when a caller has a headline and
 * coverage but no story row.
 *
 * Only `title` and `sourceList` reach the deterministic composer, so every
 * other field is here because `Story` asks for it, never because a rule reads
 * it. A caller that has the real fields (the audit, the reader's own page)
 * still passes its story and never sees this.
 */
const COMPOSER_SHELL: Omit<Story, "title" | "sourceList"> = {
  id: "",
  org: "",
  what: "",
  why: "",
  importance: "Notable",
  score: { relevance: 0, importance: 0, novelty: 0 },
  sources: 0,
  topics: [],
  time: "",
  publishedAt: "",
  before: "",
  after: "",
  timeline: [],
};

/**
 * What the composer would publish from a headline and its coverage, for a caller
 * that has no story row: the readiness gate, and the tests that pin it.
 *
 * The gate decides whether the reader gets anything at all, so it has to ask the
 * composer's own question rather than a proxy for it. The proxy it used to ask --
 * "does the evidence pass accept two facts?" -- counted a currency the composer
 * does not spend: three accepted facts of which the publication-time rules refuse
 * two as `stacked_quotes` passed the gate and reached the reader as a headline, a
 * deck and no article (2026-10-10, Microsoft's foreign-worker sponsorship). One
 * question, asked in one place, is what stops the two counters from drifting.
 *
 * The return is the whole composed article, not a boolean, so a caller can print
 * the deck and the paragraph count it actually got.
 */
/**
 * Everything the composer reads beyond the coverage itself.
 *
 * `publishedAt` is not decoration: the event's date is what anchors a source's
 * relative time ("this year", "on Thursday"). Compose without it and a fact
 * that the delivery path publishes -- because the reader's page knows the date
 * -- is refused here instead, which turns an admissible story into a withheld
 * one. The readiness audit caught exactly that: one story's body existed only
 * when the date was present, and the gate was composing without it (2026-10-10).
 */
export type ComposeFromSourcesOptions = { publishedAt?: string | null | undefined };

export function composeFromSources(
  title: string,
  sources: ReaderSource[],
  options: ComposeFromSourcesOptions = {},
): { article: ReaderArticle; selectedFacts: number; refusedFacts: number } {
  const { article, diagnostics } = composeArticleWithDiagnostics({
    ...COMPOSER_SHELL,
    title,
    publishedAt: options.publishedAt ?? "",
    // The cast is a widening, not a claim: the composer reads a source through
    // `ReaderSource` (`name`, `headline`, `excerpt`, `enrichedEvidence`), while
    // `Story` also asks for `at`, which no rule reads and the corpus sets to "".
    // A caller that has `url` and `articleId` keeps them -- nothing is dropped
    // on the way in, which is what keeps this answer the delivery path's answer.
    sourceList: sources as Story["sourceList"],
  });
  return {
    article,
    selectedFacts: diagnostics.facts.selected,
    // Facts the publication rules refused outright -- the body that was there
    // and was declined. A deck-only story refuses nothing; a story whose body
    // disappeared (the Microsoft case: two `stacked_quotes` refusals) refuses
    // plenty. The readiness gate needs the difference, not just the emptiness.
    refusedFacts: diagnostics.facts.refused,
  };
}

/**
 * Ignore stored model prose and build the Read article from source evidence
 * and related coverage already attached to the story.
 */
export function composeArticle(story: Story): ReaderArticle {
  return composeArticleWithDiagnostics(story).article;
}

/**
 * The opening sentence a story actually publishes, for a card whose stored
 * summary the deck predicate refuses.
 *
 * The card and the story page must not have different standards for trustworthy
 * prose. When `cardSummaryRefused` refuses the stored event summary, the card
 * asks for this instead -- and what it gets is the article's own opening block,
 * through the same composition path the story page renders, never a sentence
 * built here and never a rewrite of the refused text. The arbiter's ruling of
 * 2026-10-14 (option 2, lazy recovery) is explicit that the replacement "must
 * come from the same validated content path that determines what the story page
 * publishes", and that a different voice from the stored summary is acceptable
 * while correctness and attribution are not negotiable.
 *
 * Returns "" when the article publishes nothing usable, or when the opening it
 * does publish is itself refused: the card then withholds its summary line and
 * keeps its headline and sources, which is the behaviour it already has for a
 * furniture summary. Nothing here composes twice or falls back to body prose
 * chosen because it reads well.
 *
 * The replacement is held to two boundaries, and both are the point of the
 * arbiter's hold on this slice (2026-10-14): `cardSummaryRefused`, so a recovery
 * cannot print the class the card was refusing, and `admissibleReaderSentence`,
 * the shared boundary the story page and the email both ask -- **without it, a
 * refused card line recovered straight into a byline**. Measured rather than
 * assumed: on the live window the byline "Sayem Ahmed is the Subscription Editor
 * at Tom's Hardware." is `publisherFurniture` true and `unitTextRejection`
 * `editorial_noise`, and recovery for that card returned it verbatim until the
 * furniture rule learned the copular shape and this check asked for it.
 *
 * Cost is the composer's own, measured at 150-220 ms per story in the component
 * that already pays it, which is why the caller pays it only for the rare
 * refused card -- 12 of 679 summary lines in the measured window -- rather than
 * for every card in the feed. The validation itself adds no refusal on that
 * window: 12 refused lines, 12 recovered, 0 withheld, and neither boundary
 * refuses a recovered line.
 */
export function recoverCardSummary(story: Story): string {
  const article = composeArticle(story);
  const opening = [
    article.deck.text,
    ...article.paragraphs.map((paragraph) => paragraph.text),
  ].find((block) => block.trim() !== "");
  if (opening === undefined) return "";
  const text = briefingText(opening);
  if (text === "" || cardSummaryRefused(text) || !admissibleReaderSentence(text)) return "";
  return text;
}
/**
 * The same composition, plus the counters behind it.
 *
 * Only admin surfaces and tests read the counters: how much provider metadata
 * normalization removed, how many duplicate claims merged and which variant
 * won, and what the quality gate refused. Users never see any of it.
 */
export function composeArticleWithDiagnostics(story: Story): {
  article: ReaderArticle;
  diagnostics: CompositionDiagnostics;
} {
  // Historical event rows and offline archives may still contain model output.
  // Read deliberately ignores it and always composes from source evidence.
  const sourceStory: Story = { ...story };
  delete sourceStory.understand;

  story = sourceStory;
  const diagnostics = createDiagnostics();
  if (!story.understand) {
    // Normalize the source list first: this branch also reads excerpts directly
    // for entity context, and that text has to be the same clean text the
    // evidence selection sees. The quality gate is the backstop, not the fix.
    const { sources, normalization } = normalizeReaderSources(story.sourceList);
    diagnostics.sourceNormalization = { ...normalization };
    const cleanStory: Story = { ...story, sourceList: sources };
    // The source's own wording, for the rules that read what the source wrote
    // rather than what the article says. Not lowercased, unlike the same join in
    // `supplementalEntityFacts`: a surname standing alone is only recognisable
    // next to the given name it is not.
    const sourceText = sources
      .map((source) =>
        [source.excerpt ?? "", ...(source.enrichedEvidence ?? []).map((unit) => unit.text)].join(
          " ",
        ),
      )
      .join(" ");
    const selection = selectReaderEvidence(story.title, sources);
    // A unit the evidence pass refused never becomes a fact, so the gate's own
    // reason table can never name it. Carried here verbatim, because a refusal
    // nobody can read is a silent one -- the audit prints this table beside the
    // gate's.
    diagnostics.facts.evidenceRefusals = { ...selection.rejectionReasons };
    // Furniture counters come from *this* pass, which is the one that strips
    // headlines and standfirsts, while voice and colour are counted in the
    // evidence pass, where each unit is judged. Taking the whole set from either
    // pass alone reports zeros for the other's fields: this pass runs first, so
    // by the time evidence sees the text there is no metadata left to remove.
    diagnostics.sourceNormalization = {
      ...normalization,
      // Voice wrappers and fronted frames are found per sentence, in the
      // evidence pass, along with source colour.
      sourceVoiceStripped: selection.sourceNormalization.sourceVoiceStripped,
      strippedFrames: selection.sourceNormalization.strippedFrames,
      sourceColourRejections: selection.sourceNormalization.sourceColourRejections,
      // The narrator is classified in the same pass, and for the same reason:
      // these counters say what happened to a sentence the voice test would have
      // refused, and they were reporting zero while the samples below showed the
      // rewrites -- a report that contradicts its own evidence.
      narratorWrappersRemoved: selection.sourceNormalization.narratorWrappersRemoved,
      authorAttributedFacts: selection.sourceNormalization.authorAttributedFacts,
      ambiguousNarratorRejected: selection.sourceNormalization.ambiguousNarratorRejected,
      samples: selection.sourceNormalization.samples,
    };
    // The story's own date anchors any relative time reference in a source's
    // own words, before anything is selected: the deck, the paragraphs and the
    // entity facts all read this list, so anchoring once here is the only way
    // they can agree about what "this month" meant.
    const dated = refuseStalePreviews(
      anchorRelativeTimes(
        [...selection.facts, ...supplementalEntityFacts(cleanStory, selection)],
        story.publishedAt,
        diagnostics,
      ),
      story.publishedAt,
      diagnostics,
    );
    const facts = mergeFacts(dated, diagnostics);
    diagnostics.facts.selected = facts.length;
    // Which survey each source names, for the statistics that do not name one
    // themselves -- see `surveyLabels`.
    const surveys = surveyLabels(facts);
    const independentSources = new Set(
      story.sourceList.map((source) => source.name.trim().toLowerCase()).filter(Boolean),
    ).size;
    /**
     * One document, read in the order it was written.
     *
     * The condition is the guarantee that `sourceOrder` needs to mean anything:
     * a single source *entry*, and every selected fact taken from that entry's
     * own text. Then a position is a position in one document, and reading
     * forwards cannot interleave two sequences. It used to require a repository
     * on top of that, which is why a real single-source production feature still
     * came out scrambled: the DigiCert story was ranked by relevance, so the
     * reader got governance framing, then an agent escape, then a German website,
     * then the survey, then the mechanism, then a customer quote, then back to
     * the escape. Two arXiv articles for one event, or facts whose order was
     * already rearranged by article-page enrichment, still take the ranking path.
     *
     * `researchNarrative` is the paper-shaped part of this, and stays narrow: a
     * paper's own first sentence is its lead, so the deck comes from position
     * zero. A news feature keeps a relevance-selected deck, because the strongest
     * fact is the right opening and a test pins that. What changes for it is the
     * *body*, which now reads forwards -- that is the difference between an
     * article and a pile of ranked excerpts.
     */
    const oneDocument =
      story.sourceList.length === 1 && facts.every((fact) => fact.origin === "rss");
    const researchNarrative = oneDocument && isRepositorySourceName(story.sourceList[0]?.name);
    /**
     * The relevance-selected lead, captured before source order re-sorts the list.
     *
     * `mergeFacts` returns copies and sorts by score, so this is position zero as
     * it stood -- and it has to be read *now*, because the deck's question ("what
     * matters most") is not the body's question ("what came next"). Comparing by
     * sentence key rather than by identity, because the fact in hand is a copy.
     */
    const rankedLead =
      (selection.lead
        ? facts.find((fact) => sentenceKey(fact.text) === sentenceKey(selection.lead!.text))
        : undefined) ?? facts[0];
    if (oneDocument) {
      facts.sort((a, b) => a.sourceOrder - b.sourceOrder);
      diagnostics.ordering = "narrative";
    }
    /**
     * The deck is the one block with no block before it.
     *
     * A paragraph opening on `This` or `That` is repaired by adjacency: the
     * sentence the reader just read is the antecedent. A deck has no such
     * sentence, so its opening has to stand on its own -- and ranking is no help,
     * because the highest-scoring fact can be the one that needs the antecedent.
     * The arbiter's ruling of 2026-10-10: walk the ranked facts in order and take
     * the first that composes a self-sufficient deck, keeping every existing
     * evidence and sentence rule; if none qualifies, the story gets no deck and
     * is withheld rather than shown an opening the page never establishes.
     *
     * A displaced candidate is not charged: it is still a fact, and the body path
     * decides its sentence-level fate on its own terms. Only when *no* candidate
     * qualifies -- the story that is withheld -- is the missing deck accounted for
     * by the rule that refused it, so the fact ledger stays a partition.
     */
    const deckCandidates = researchNarrative
      ? facts
      : [rankedLead, ...facts.filter((fact) => fact !== rankedLead)].filter(
          (fact): fact is ReaderFact => fact !== undefined,
        );
    let lead: ReaderFact | undefined;
    let leadText = "";
    const needsAntecedent: { fact: string; text: string }[] = [];
    for (const candidate of deckCandidates) {
      const text = safeLead(candidate, story, independentSources, surveys).text;
      if (text === "") continue;
      if (needsAntecedentToOpen(text)) {
        needsAntecedent.push({ fact: candidate.text, text });
        continue;
      }
      lead = candidate;
      leadText = text;
      break;
    }
    const deck = { text: leadText, evidence: lead ? [...lead.evidence] : [] };
    // No fact survived selection, so the deck has to come from somewhere else --
    // and that "somewhere else" is the stored event summary. It is a candidate,
    // not a conclusion: `applyFallbackDeck` judges it exactly as the gate would.
    if (deck.text === "") applyFallbackDeck(deck, story, [story.what], diagnostics);
    // The summary is prose too, so it faces the same test. A fallback that opens
    // on a sentence the reader cannot see is refused here as well, which is what
    // stops the rule above from being routed around by the one path that does not
    // go through `safeLead`.
    if (deck.text !== "" && needsAntecedentToOpen(deck.text)) {
      needsAntecedent.push({ fact: deck.text, text: deck.text });
      deck.text = "";
      deck.evidence = [];
    }
    mergeEvidenceIntoDeck(
      deck,
      selection.facts.filter((fact) => !lead || repeats(lead.text, fact.text)),
    );
    const primaryNames = selection.entities
      .filter((entity) => entity.role !== "REPORTING_SOURCE")
      .flatMap((entity) => [entity.name, ...entity.aliases]);
    const priorityFacts = facts.filter(
      (fact) =>
        fact !== lead &&
        primaryNames.some((name) =>
          new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(
            fact.text,
          ),
        ),
    );
    // `priorityFacts` hoists the facts naming a primary entity, which is a news
    // instinct -- the central actor belongs up front. For a paper it would pull
    // sentence seven ahead of the sentence that explains it, so the narrative
    // path reads the facts where the author put them and never consults it.
    const remaining = oneDocument
      ? facts.filter((fact) => fact !== lead)
      : [
          ...priorityFacts,
          ...facts.filter((fact) => fact !== lead && !priorityFacts.includes(fact)),
        ];
    /**
     * The fact ledger: which published sentence carries which fact, and the rule
     * accounting for every fact this pass will not publish.
     *
     * Both the fact-level rules (the sentence validator, the anaphora decision)
     * and the block-level ones (paragraph floor, thin-evidence cap, article cap,
     * the gate) write here, which is what turns `facts.lost` back into the one
     * number it is meant to be: facts nobody can explain.
     */
    const ledger: FactLedger = { sentences: new Map(), unrendered: new Map() };
    // The lead fact, indexed under both forms of its sentence: the gate rewrites
    // the deck before judging it (`stripFrontedConnector`), and a refused deck has
    // to be chargeable to the fact that produced it whichever form was refused.
    if (lead && deck.text !== "") {
      indexSentence(ledger, deck.text, lead.text);
      indexSentence(ledger, stripFrontedConnector(deck.text), lead.text);
    }
    // Every candidate needed an antecedent the page does not carry (or the
    // fallback summary did), so this story has no deck and no body: nothing is
    // published, and the facts that could not open it are charged to the rule
    // that refused them. Without this the story would read as one whose facts
    // vanished with no explanation, and readiness would have nothing to withhold
    // it on.
    if (lead === undefined && needsAntecedent.length > 0) {
      // The absence of a deck gets its own reason rather than a fact charge. A
      // candidate that could not open the story may still be published by the body
      // path -- that is the composer's own business -- and charging it here would
      // report the same fact as refused and rendered, which is the overlap the
      // ledger exists to keep truthful. Readiness withholds on the empty deck, and
      // this reason is what a reviewer sees for the refusal in the mean time.
      diagnostics.qualityGate.unresolvedContextWarnings += needsAntecedent.length;
      for (const entry of needsAntecedent) refuseBlock(entry.text, "deck_refused", diagnostics);
    }
    const paragraphs = oneDocument
      ? narrativeParagraphs(remaining, story, diagnostics, lead?.sourceOrder ?? -1, surveys, ledger)
      : [
          ...deterministicParagraphs(remaining, story, diagnostics, surveys, ledger),
          ...priorityFacts
            // A fact a rule already refused is never republished here. The ranked
            // pass decides the softer anaphora class (`they`, `this`) because it
            // is the only place that knows what is published next to what, and
            // the gate deliberately does not re-decide it -- so hoisting a
            // refused fact into its own paragraph was the one path that could
            // print a sentence the story's own rule had already rejected.
            // This spread is evaluated after `deterministicParagraphs` above,
            // which is what makes the ledger complete when it is read.
            .filter((fact) => !ledger.unrendered.has(sentenceKey(fact.text)))
            .filter((fact) => !remaining.slice(0, 8).includes(fact))
            .slice(0, 3)
            .map((fact) => {
              const text = sentence(attributedFactText(fact.text, fact.evidence, story, surveys));
              indexSentence(ledger, text, fact.text);
              return { text, evidence: fact.evidence };
            }),
        ];
    const composedText = paragraphs.map((paragraph) => paragraph.text).join(" ");
    /**
     * The entity-context pass inserts a source sentence that names an entity the
     * article has not introduced yet. In narrative order the paper has already
     * said what it means to say, in the order it meant to say it, so nothing is
     * spliced in.
     *
     * Two rules hold this pass to the same standard as every other path.
     *
     * **Refusal-finality.** A sentence the ledger already charged may not be
     * reinserted here. The whole point of the splice is to add prose the article
     * does not have, so a sentence it *does* have -- one a rule judged and refused
     * -- must not be smuggled back in as context. On the 2026-10-10 corpus that
     * was four of the seven facts the ledger reported as refused and published
     * anyway, including the PC-shipments opening whose referent the page never
     * establishes.
     *
     * **The gate.** The candidate is added to the article *before* the gate reads
     * it, not after, so it is judged as prose like every other sentence -- the
     * metadata, entity, heading, seam, anaphora and quote rules all apply to it.
     * Splicing after the gate published a sentence no rule had ever seen.
     */
    const spliced: ArticleParagraph[] = [];
    for (const entity of oneDocument
      ? []
      : selection.entities.filter((item) => item.role !== "REPORTING_SOURCE")) {
      if (composedText.includes(entity.name) || !entity.name.includes(" ")) continue;
      const sourceIndex = sources.findIndex((source) =>
        (source.excerpt ?? "").toLowerCase().includes(entity.name.toLowerCase()),
      );
      const raw =
        sourceIndex < 0
          ? undefined
          : readerSentences(sources[sourceIndex]?.excerpt ?? "").find((part) =>
              part.toLowerCase().includes(entity.name.toLowerCase()),
            );
      const text = raw ? cleanDeterministicSentence(raw.replace(/^As we write,\s*/i, "")) : "";
      if (!text) continue;
      if (republishesRefusedFact(ledger, text)) continue;
      const candidate = { text: sentence(text), evidence: [sourceIndex + 1] };
      if (validDeterministicSentence(candidate.text) && !editorialNoise(candidate.text))
        spliced.push(candidate);
      if (paragraphs.length + spliced.length >= 8) break;
    }
    paragraphs.unshift(...spliced);
    /**
     * Prior-coverage background, kept out of the thin-evidence cap.
     *
     * The cap exists so a story with two facts does not pad itself out, and it
     * counts *evidence* paragraphs. Background about an earlier nyuz story is not
     * that: it was attached deliberately, it is one sentence, and dropping it as
     * if it were padding is how a thin story silently loses the context the
     * product promised to attach.
     */
    // The background path is the one entrance to the reader the evidence pass
    // never sees: this sentence was never a selected fact, so nothing judged it.
    // It runs the same sentence gates here and drops a sentence the article
    // already carries -- one story printed its own deck back as "Previously, a
    // California man has been arrested ...", which is a stutter, not context.
    const publishedTokens = new Set(
      centralTokens([deck?.text ?? "", ...paragraphs.map((p) => p.text)].join(" ")),
    );
    const related: ArticleParagraph[] = [];
    for (const candidate of story.relatedEvents ?? []) {
      const context = relatedContext({ title: story.title, summary: leadText }, candidate);
      if (!context || !validDeterministicSentence(context)) continue;
      if (
        readerSentences(context).some(
          (line) =>
            hasSourceMetadata(line) ||
            hasVisibleEntity(line) ||
            editorialNoise(line) ||
            malformedAttribution(line) ||
            gluedAttribution(line) ||
            unitTextRejection(line, /["“]/.test(line)) !== null,
        )
      )
        continue;
      const text = sentence(context);
      // The "Previously," connector is not content: counting it would let the
      // same stutter slip under the ratio by one token.
      const tokens = centralTokens(text).filter((token) => token !== "previously");
      if (
        tokens.length >= 6 &&
        tokens.filter((token) => publishedTokens.has(token)).length / tokens.length >= 0.6
      )
        continue;
      related.push({ text, evidence: [] });
    }
    // Thin evidence should remain thin; rich evidence is capped at four useful blocks.
    // Whatever the cap drops is counted, so a fact behind it is explicable.
    const capped = paragraphs.slice(0, facts.length <= 3 ? 2 : paragraphs.length);
    for (const block of paragraphs.slice(capped.length)) {
      // The facts behind the block are charged to the cap that dropped it, so a
      // thin story's lost sentence is explained rather than unaccounted for.
      markSentence(ledger, block.text, "thin_evidence_cap");
      refuseBlock(block.text, "thin_evidence_cap", diagnostics);
    }
    paragraphs.length = 0;
    paragraphs.push(...capped, ...related);
    const gated = qualityGate({ deck, paragraphs }, story.title, diagnostics, ledger);
    console.log("after qualityGate unrendered size", ledger.unrendered.size);
    for (const [k, v] of ledger.unrendered.entries()) console.log("  ", k.slice(0, 80), v);
    // After the gate, because the gate reads each block as the composer wrote
    // it. Removing a repeated attribution can only shorten a sentence, never
    // break one, so a block that passed stays publishable.
    capAttributionRepetition([gated.deck, ...gated.paragraphs]);
    finishDiagnostics(gated, facts, diagnostics, ledger);
    // Last, and deliberately after the counters: renaming is presentation, and
    // `facts.rendered` is read by matching a fact's own text against the
    // published blocks. Shortening a name in the prose but not in the fact makes
    // a published sentence read as missing, and `lost` is the one counter that
    // has to keep meaning "nobody can explain this" -- it went to 3 of 7 on the
    // production fixture when this ran before `finishDiagnostics`. Shortening a
    // name cannot introduce a defect the gate would have refused: it only takes a
    // given name back out of a mention the source itself wrote as a surname.
    shortenIntroducedNames([gated.deck, ...gated.paragraphs], selection.entities, sourceText);

    return { article: gated, diagnostics };
  }
  return { article: { deck: { text: "", evidence: [] }, paragraphs: [] }, diagnostics };
}
