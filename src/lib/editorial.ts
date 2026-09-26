import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import { legacyEventIntelligence } from "@/lib/understand";
import {
  alreadyAttributed,
  attributeToOwnSource,
  centralTokens,
  cleanDeterministicSentence,
  contextDependent,
  deterministicFactType,
  editorialNoise,
  hasPredicate,
  headingUnit,
  keepSample,
  normalizeRelativeTime,
  recoverableContext,
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
  sourceSeam,
  readerSentences,
  validDeterministicParagraph,
  validDeterministicSentence,
  MAX_SENTENCE_CHARS,
  MIN_PARAGRAPH_WORDS,
  MIN_SENTENCE_CHARS,
  type DeterministicFactType,
  type ReaderFact,
} from "./reader-evidence";
import {
  gluedAttribution,
  hasSourceMetadata,
  hasVisibleEntity,
  isRepositorySourceName,
  malformedAttribution,
  REPORTED_CLAUSE_WORDS,
} from "./pipeline/source-text";
import { relatedContext } from "./related-events";
import { repeats } from "./understand";

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
    /** Facts in hand after merging duplicates. */
    selected: number;
    /** Of those, how many reached the published prose. */
    rendered: number;
    /** Facts a duplicate replaced, before merging. */
    deduplicated: number;
    /** Facts refused before any paragraph was built. */
    rejected: number;
    /**
     * Selected facts the composer itself refused, with a reason.
     *
     * Refusal is a valid outcome -- a sentence with no antecedent, a wh-headed
     * fragment -- and it is counted, never silent. These are subtracted from
     * `lost` below, because `lost` is the counter that means "nobody knows why
     * this is missing".
     */
    refused: number;
    /** Selected facts not rendered and not refused. Anything above zero is a bug. */
    lost: number;
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
    },
    facts: { selected: 0, rendered: 0, deduplicated: 0, rejected: 0, refused: 0, lost: 0 },
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
      const normalizedRaw = raw
        .replace(/^As we write,\s*/i, "")
        .replace(/^It's less than three weeks since we wrote about\s+/i, "The article describes ");
      const text = cleanDeterministicSentence(
        surname &&
          !new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(
            normalizedRaw,
          )
          ? normalizedRaw.replace(new RegExp(`\\b${surname}\\b`, "i"), entity.name)
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
      const carriesSelected = selection.facts.some((fact) => carries([text], fact.text));
      if (
        !carriesSelected &&
        unitTextRejection(text, false) === null &&
        !editorialNoise(text) &&
        !headingUnit(text) &&
        !contextDependent(text)
      ) {
        facts.push({
          text,
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
const NO_SURVEYS: Map<number, string> = new Map();

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
  return `${source} reports that ${reportedClause(clause) ?? clause}`;
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
): ReaderArticle {
  const sentencesWithEvidence: { text: string; evidence: number[] }[] = [];
  const index = new Map<string, number>();
  const deck = article.deck;
  const mergeInto = (target: { evidence: number[] }, evidence: number[]) => {
    target.evidence = [...new Set([...target.evidence, ...evidence])];
  };
  const refuse = (reason: string) => {
    diagnostics.sentences.refused += 1;
    tally(diagnostics.sentences.reasons, reason);
  };
  // The deck is prose, so it is judged as prose. Indexing it only when it
  // already passed is what let a photo credit sit under a headline: an invalid
  // deck was never refused, because nothing here ever asked.
  const deckVerdict = deck.text.trim() === "" ? null : judgeFallbackDeck(deck.text, title);
  if (deckVerdict === null) {
    // Nothing to publish; the page renders headline and sources.
  } else if (deckVerdict.reason === null) {
    index.set(sentenceKey(deckVerdict.text), -1);
  } else {
    diagnostics.qualityGate.deckRefusals += 1;
    tally(diagnostics.qualityGate.deckReasons, deckVerdict.reason);
    refuse(deckVerdict.reason);
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
        refuse("empty_sentence");
        continue;
      }
      // Checked before validity so a leak is still reported as a leak: the
      // sentence validator refuses these too, but this counter is what the admin
      // read-quality sample reads.
      if (hasSourceMetadata(part)) {
        diagnostics.qualityGate.metadataLeakWarnings += 1;
        refuse("metadata_leak");
        continue;
      }
      // An undecoded `&#x20;` is four characters on the page. Nothing below this
      // point may publish one, whatever route brought it here.
      if (hasVisibleEntity(part)) {
        diagnostics.qualityGate.entityLeakWarnings += 1;
        refuse("entity_leak");
        continue;
      }
      if (!validDeterministicSentence(part)) {
        refuse("invalid_sentence");
        continue;
      }
      if (malformedAttribution(part) || gluedAttribution(part)) {
        diagnostics.qualityGate.malformedAttributionWarnings += 1;
        refuse("malformed_attribution");
        continue;
      }
      // A heading that reached a block anyway -- a stored summary, a sentence the
      // entity path rebuilt -- because a subhead is not a fact about anything.
      if (headingUnit(part)) {
        diagnostics.qualityGate.headingUnitWarnings += 1;
        refuse("headline_fragment");
        continue;
      }
      // Two blocks published as one sentence: a heading, a photo credit or a
      // session's speakers joined to the prose after them. Judged before the
      // sentence itself is, because the sentence test is what the glue passes.
      if (sourceSeam(part)) {
        diagnostics.qualityGate.sourceSeamWarnings += 1;
        refuse("invalid_sentence");
        continue;
      }
      // "Both saw agents make their way onto the open internet", and a fronted
      // clause whose main clause is a pronoun: the subject is outside the
      // sentence, and no ordering of the page supplies it. The softer class --
      // `they`, `this`, `these` -- was already decided by the composer, which is
      // the only place that knows what is published next to what.
      if (unresolvableContext(part)) {
        diagnostics.qualityGate.unresolvedContextWarnings += 1;
        refuse("unresolved_context");
        continue;
      }
      // Two long quoted passages in one sentence is a concatenation, not speech.
      if (quotedSpans(part) > 1) {
        diagnostics.qualityGate.stackedQuoteWarnings += 1;
        refuse("stacked_quotes");
        continue;
      }
      // A paragraph that only restates the deck is the deck, not a paragraph.
      if (nearDuplicate(deck.text, part)) {
        mergeInto(deck, paragraph.evidence);
        diagnostics.sentences.merged += 1;
        continue;
      }
      const key = sentenceKey(part);
      if (key === "") {
        refuse("empty_sentence");
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

function deterministicParagraphs(
  facts: ReaderFact[],
  story: Story,
  diagnostics: CompositionDiagnostics,
  surveys: Map<number, string>,
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
      diagnostics.facts.refused += 1;
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
    .map((group) => {
      const parts = group
        .map((fact) => factSentence(fact, story, diagnostics, surveys))
        .filter((text): text is string => text !== null);
      return { text: parts.join(" "), evidence: citationRefs(group) };
    })
    .filter((paragraph) => {
      if (countWords(paragraph.text) >= MIN_PARAGRAPH_WORDS) return true;
      refuseBlock(paragraph.text, "short_block", diagnostics);
      return false;
    });
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
): string | null {
  const attributed = sentence(attributedFactText(fact.text, fact.evidence, story, surveys));
  const text = validDeterministicSentence(attributed) ? attributed : sentence(fact.text);
  if (validDeterministicSentence(text)) return text;
  diagnostics.sentences.refused += 1;
  diagnostics.facts.refused += 1;
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
): ArticleParagraph[] {
  const paragraphs: ArticleParagraph[] = [];
  let previousOrder = deckOrder;
  for (const fact of facts) {
    const text = factSentence(fact, story, diagnostics, surveys);
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
      diagnostics.facts.refused += 1;
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
 * maps say which unit refused it.
 */
function finishDiagnostics(
  article: ReaderArticle,
  facts: ReaderFact[],
  diagnostics: CompositionDiagnostics,
): void {
  const blocks = [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)];
  diagnostics.facts.rendered = facts.filter((fact) => carries(blocks, fact.text)).length;
  // A refused fact is explained, so it is not lost: `lost` has to keep meaning
  // "selected, valid, and published nowhere", or the number stops being a bug
  // report and starts being a style preference.
  diagnostics.facts.lost = Math.max(
    0,
    diagnostics.facts.selected - diagnostics.facts.rendered - diagnostics.facts.refused,
  );
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
  if (hasVisibleEntity(text)) return { text: "", reason: "entity_leak" };
  if (editorialNoise(text)) return { text: "", reason: "editorial_noise" };
  if (!validDeckSentence(text)) return { text: "", reason: "malformed_sentence" };
  if (titleDuplicate(text, title)) return { text: "", reason: "title_duplicate" };
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

/**
 * Prefer authored prose. Without it, build a deterministic article from the
 * source excerpts and related coverage already attached to the story -- this
 * is what renders when AI never ran, is unavailable, or hasn't finished yet,
 * so Read never depends on a live model call.
 */
export function composeArticle(story: Story): ReaderArticle {
  return composeArticleWithDiagnostics(story).article;
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
  const diagnostics = createDiagnostics();
  if (story.understand?.article) return { article: story.understand.article, diagnostics };

  if (!story.understand) {
    // Normalize the source list first: this branch also reads excerpts directly
    // for entity context, and that text has to be the same clean text the
    // evidence selection sees. The quality gate is the backstop, not the fix.
    const { sources, normalization } = normalizeReaderSources(story.sourceList);
    diagnostics.sourceNormalization = { ...normalization };
    const cleanStory: Story = { ...story, sourceList: sources };
    const selection = selectReaderEvidence(story.title, sources);
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
    const dated = anchorRelativeTimes(
      [...selection.facts, ...supplementalEntityFacts(cleanStory, selection)],
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
    const lead = researchNarrative ? facts[0] : rankedLead;
    const leadText = lead ? safeLead(lead, story, independentSources, surveys).text : "";
    const deck = { text: leadText, evidence: lead ? [...lead.evidence] : [] };
    // No fact survived selection, so the deck has to come from somewhere else --
    // and that "somewhere else" is the stored event summary. It is a candidate,
    // not a conclusion: `applyFallbackDeck` judges it exactly as the gate would.
    if (deck.text === "") applyFallbackDeck(deck, story, [story.what], diagnostics);
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
    const paragraphs = oneDocument
      ? narrativeParagraphs(remaining, story, diagnostics, lead?.sourceOrder ?? -1, surveys)
      : [
          ...deterministicParagraphs(remaining, story, diagnostics, surveys),
          ...priorityFacts
            .filter((fact) => !remaining.slice(0, 8).includes(fact))
            .slice(0, 3)
            .map((fact) => ({
              text: sentence(attributedFactText(fact.text, fact.evidence, story, surveys)),
              evidence: fact.evidence,
            })),
        ];
    const composedText = paragraphs.map((paragraph) => paragraph.text).join(" ");
    // The entity-context pass inserts a source sentence that names an entity the
    // article has not introduced yet. In narrative order the paper has already
    // said what it means to say, in the order it meant to say it, so nothing is
    // spliced in.
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
      const text = raw
        ? cleanDeterministicSentence(
            raw
              .replace(/^As we write,\s*/i, "")
              .replace(
                /^It's less than three weeks since we wrote about\s+/i,
                "The article describes ",
              ),
          )
        : "";
      if (text && validDeterministicSentence(text) && !editorialNoise(text))
        paragraphs.unshift({ text: sentence(text), evidence: [sourceIndex + 1] });
      if (paragraphs.length >= 8) break;
    }
    /**
     * Prior-coverage background, kept out of the thin-evidence cap.
     *
     * The cap exists so a story with two facts does not pad itself out, and it
     * counts *evidence* paragraphs. Background about an earlier nyuz story is not
     * that: it was attached deliberately, it is one sentence, and dropping it as
     * if it were padding is how a thin story silently loses the context the
     * product promised to attach.
     */
    const related: ArticleParagraph[] = [];
    for (const candidate of story.relatedEvents ?? []) {
      const context = relatedContext({ title: story.title, summary: leadText }, candidate);
      if (context && validDeterministicSentence(context))
        related.push({ text: sentence(context), evidence: [] });
    }
    // Thin evidence should remain thin; rich evidence is capped at four useful blocks.
    // Whatever the cap drops is counted, so a fact behind it is explicable.
    const capped = paragraphs.slice(0, facts.length <= 3 ? 2 : paragraphs.length);
    for (const block of paragraphs.slice(capped.length)) {
      refuseBlock(block.text, "thin_evidence_cap", diagnostics);
    }
    paragraphs.length = 0;
    paragraphs.push(...capped, ...related);
    const gated = qualityGate({ deck, paragraphs }, story.title, diagnostics);
    finishDiagnostics(gated, facts, diagnostics);

    return { article: gated, diagnostics };
  }

  const intel =
    story.understand ??
    legacyEventIntelligence({
      what: story.what,
      sources: story.sourceList,
      ...(story.relatedEvents ? { relatedEvents: story.relatedEvents } : {}),
    });
  const deck = { text: "", evidence: [] as number[] };
  applyFallbackDeck(deck, story, [story.what, intel.oneSentence], diagnostics);
  const paragraphs: ArticleParagraph[] = [];
  const seen: { text: string; evidence: number[] }[] = [
    { text: deck.text, evidence: deck.evidence },
  ];
  const add = (items: { text: string; evidence: number[] }[]) => {
    const kept: string[] = [];
    const evidence: number[] = [];
    const paragraph = { text: "", evidence };
    for (const item of items) {
      const text = sentence(attributedFactText(item.text, item.evidence, story, NO_SURVEYS));
      if (!validDeterministicSentence(text) || editorialNoise(text)) continue;
      const existing = seen.find((candidate) => repeats(candidate.text, text));
      if (existing) {
        existing.evidence = [...new Set([...existing.evidence, ...item.evidence])];
        continue;
      }
      seen.push({ text, evidence: item.evidence });
      kept.push(text);
      for (const ref of item.evidence) if (!evidence.includes(ref)) evidence.push(ref);
    }
    if (kept.length) {
      paragraph.text = kept.join(" ");
      paragraphs.push(paragraph);
    }
  };
  const plain = (text: string) => ({ text, evidence: [] as number[] });

  const deckItems = [plain(intel.oneSentence), ...intel.newDevelopments, ...intel.context];
  mergeEvidenceIntoDeck(
    deck,
    deckItems.filter((item) => repeats(deck.text, item.text)),
  );
  add([plain(story.before), plain(story.after), ...intel.newDevelopments]);
  {
    add([...intel.context]);
    add(
      intel.numbers.flatMap((n) =>
        selectReaderEvidence(story.title, [{ excerpt: n.label }])
          .facts.filter((f) => f.text.includes(n.value))
          .map((f) => ({ text: f.text, evidence: n.evidence })),
      ),
    );
    add(intel.overview.map((o) => ({ text: `${o.name}: ${o.detail}`, evidence: o.evidence })));
    if (intel.comparison) {
      const comparison = intel.comparison;
      add(
        comparison.rows.map((r) => ({
          text: `${r.label}: ${comparison.leftLabel}, ${r.left}; ${comparison.rightLabel}, ${r.right}`,
          evidence: r.evidence,
        })),
      );
    }
    if (intel.series) {
      const series = intel.series;
      add([
        {
          text: `${series.caption}: ${series.points.map((p) => `${p.label}, ${p.display}`).join("; ")}`,
          evidence: series.points.flatMap((p) => p.evidence),
        },
      ]);
    }
    if (intel.relationships) {
      const { nodes, edges } = intel.relationships;
      add(
        edges
          .filter((edge) => edge.label)
          .map((edge) => ({
            text: `${nodes.find((n) => n.id === edge.from)?.label ?? edge.from} ${edge.label} ${nodes.find((n) => n.id === edge.to)?.label ?? edge.to}`,
            evidence: edge.evidence,
          })),
      );
    }
    add(
      intel.audiences.map((a) => ({
        text: `For ${a.audience}: ${a.implication}`,
        evidence: a.evidence,
      })),
    );
    for (const conflict of intel.conflicts) {
      add(
        conflict.reports.map((r) => ({
          text: `${conflict.topic}: ${r.text}`,
          evidence: r.evidence,
        })),
      );
    }
    add(
      intel.perspectives.map((p) => ({ text: `${p.source}: ${p.stance}`, evidence: p.evidence })),
    );
    add(intel.unknowns.map(plain));
    add(intel.timeline.map((t) => ({ text: `${t.when}: ${t.what}`, evidence: t.evidence })));
    add([
      ...intel.whatNext,
      ...intel.watchNext.map((w) => ({
        text: `${w.label}: ${w.detail}`,
        evidence: w.evidence,
      })),
    ]);
  }
  const cleanParagraphs = paragraphs
    .filter((paragraph) => paragraph.text.split(/\s+/).length >= 3)
    .reduce<ArticleParagraph[]>((out, paragraph) => {
      const duplicate = out.find((prior) => similarEnough(prior.text, paragraph.text));
      if (duplicate)
        duplicate.evidence = [...new Set([...duplicate.evidence, ...paragraph.evidence])];
      else out.push(paragraph);
      return out;
    }, []);
  const gated = qualityGate({ deck, paragraphs: cleanParagraphs }, story.title, diagnostics);
  finishDiagnostics(gated, [], diagnostics);
  return { article: gated, diagnostics };
}
