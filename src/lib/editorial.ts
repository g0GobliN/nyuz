import type { Story } from "@/lib/story";
import type { ArticleParagraph, ReaderArticle } from "@/lib/reader-article";
import { legacyEventIntelligence } from "@/lib/understand";
import {
  centralTokens,
  cleanDeterministicSentence,
  deterministicFactType,
  editorialNoise,
  hasPredicate,
  nearDuplicate,
  normalizeReaderSources,
  normalizeSummary,
  normalizedNumericKey,
  preferCleaner,
  selectReaderEvidence,
  sentenceKey,
  sourceNameForEvidence,
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
  hasSourceMetadata,
  isRepositorySourceName,
  malformedAttribution,
} from "./pipeline/source-text";
import { relatedContext } from "./related-events";
import { repeats } from "./understand";

function sentence(text: string): string {
  const clean = cleanDeterministicSentence(text);
  return clean && !/[.!?…]["”]?$/.test(clean) ? `${clean}.` : clean;
}

function lowerFirst(text: string): string {
  if (!text) return text;
  return /^(?:The|A|An)\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
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
    /** Selected facts not found in the output. Anything above zero is a bug. */
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
   * How the published facts were ordered. `narrative` means one repository
   * document, read in its own order; `relevance` means the news ranking.
   */
  ordering: "narrative" | "relevance";
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
    },
    dedupe: { duplicateGroups: 0, preferredCleanVariant: 0, restatements: 0 },
    qualityGate: {
      metadataLeakWarnings: 0,
      malformedAttributionWarnings: 0,
      deckRefusals: 0,
      deckReasons: {},
    },
    facts: { selected: 0, rendered: 0, deduplicated: 0, rejected: 0, lost: 0 },
    paragraphs: { assembled: 0, split: 0, rendered: 0, rejected: 0, reasons: {} },
    sentences: { considered: 0, rendered: 0, merged: 0, refused: 0, reasons: {} },
    ordering: "relevance",
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
      if (validDeterministicSentence(text) && !editorialNoise(text)) {
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

function safeLead(
  lead: ReaderFact | undefined,
  story: Story,
  sourceCount: number,
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
      text: `${researchAttribution(deterministicFactType(text))}: ${text}`,
      evidence: lead.evidence,
    };
  }
  if (/^(?:once|when|while|because|although|and|but|or)\b/i.test(text)) {
    return { text: `${source} reports that ${lowerFirst(text)}`, evidence: lead.evidence };
  }
  return { text: `According to ${source}, ${lowerFirst(text)}`, evidence: lead.evidence };
}

/**
 * How a research repository introduces a claim.
 *
 * arXiv is where a paper is posted, not a party to anything, so it can never be
 * the claimant: `According to arXiv cs.CR, ...` credits a subject category with
 * a research finding. The paper is the actor, and the form ends in a colon
 * because the sentence that follows is a complete one -- lowercasing its first
 * word would be a guess about whether that word is a proper noun.
 */
function researchAttribution(type: DeterministicFactType): string {
  if (type === "projection") return "The paper projects";
  if (type === "estimate") return "The paper estimates";
  if (type === "claim") return "The paper argues";
  return "A new paper reports";
}

function attributedFactText(text: string, evidence: number[], story: Story): string {
  const type = deterministicFactType(text);
  if (!evidence.length || !["claim", "estimate", "projection"].includes(type)) return text;
  if (AUTHORIAL_OPENING.test(text)) return text;
  if (
    /\b(?:according to|reports?|said|says|estimates?|projects?|found|argues?|claims?)\b/i.test(text)
  )
    return text;
  const source = sourceNameForEvidence(evidence, story.sourceList);
  if (!source) return text;
  return isRepositorySourceName(source)
    ? `${researchAttribution(type)}: ${text}`
    : `${source} reports that ${lowerFirst(text)}`;
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
      if (!validDeterministicSentence(part)) {
        refuse("invalid_sentence");
        continue;
      }
      if (malformedAttribution(part)) {
        diagnostics.qualityGate.malformedAttributionWarnings += 1;
        refuse("malformed_attribution");
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
        sentencesWithEvidence.push({ text: part, evidence: [...paragraph.evidence] });
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
): ArticleParagraph[] {
  const groups: ReaderFact[][] = [];
  for (const fact of facts) {
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
    if (
      prior &&
      prior.length < 8 &&
      (prior.some((item) => item.evidence.some((ref) => fact.evidence.includes(ref))) ||
        prior.length === 0)
    )
      prior.push(fact);
    else if (!prior) groups[target] = [fact];
    else groups.push([fact]);
  }
  return groups
    .filter((group): group is ReaderFact[] => !!group?.length)
    .map((group) => {
      const parts = group
        .map((fact) => factSentence(fact, story, diagnostics))
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
): string | null {
  const attributed = sentence(attributedFactText(fact.text, fact.evidence, story));
  const text = validDeterministicSentence(attributed) ? attributed : sentence(fact.text);
  if (validDeterministicSentence(text)) return text;
  diagnostics.sentences.refused += 1;
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
): ArticleParagraph[] {
  const paragraphs: ArticleParagraph[] = [];
  for (const fact of facts) {
    const text = factSentence(fact, story, diagnostics);
    if (text === null) continue;
    paragraphs.push({ text, evidence: [...fact.evidence] });
  }
  return paragraphs;
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
  diagnostics.facts.lost = Math.max(0, diagnostics.facts.selected - diagnostics.facts.rendered);
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
  if (malformedAttribution(text)) return { text: "", reason: "malformed_attribution" };
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
  for (const candidate of candidates) {
    if (candidate.trim() === "") continue;
    diagnostics.fallback.candidates += 1;
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
    const facts = mergeFacts(
      [...selection.facts, ...supplementalEntityFacts(cleanStory, selection)],
      diagnostics,
    );
    diagnostics.facts.selected = facts.length;
    const independentSources = new Set(
      story.sourceList.map((source) => source.name.trim().toLowerCase()).filter(Boolean),
    ).size;
    /**
     * One paper, read in the order it was written.
     *
     * Deliberately narrow: a single source *entry*, from a repository, whose
     * facts all came from that source's own text. `sourceOrder` is a position
     * within one document, so it is only meaningful when there is exactly one
     * document -- two arXiv articles for one event, or facts whose order was
     * already rearranged by article-page enrichment, would interleave two
     * sequences into nonsense.
     */
    const researchNarrative =
      story.sourceList.length === 1 &&
      isRepositorySourceName(story.sourceList[0]?.name) &&
      facts.every((fact) => fact.origin === "rss");
    if (researchNarrative) {
      // Scoring answers "what matters most", which is the wrong question for a
      // paper: its own first sentence is its lead, and everything after it
      // assumes the reader has passed the sentences before.
      facts.sort((a, b) => a.sourceOrder - b.sourceOrder);
      diagnostics.ordering = "narrative";
    }
    const lead = researchNarrative
      ? facts[0]
      : selection.lead && facts.includes(selection.lead)
        ? selection.lead
        : facts[0];
    const leadText = lead ? safeLead(lead, story, independentSources).text : "";
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
    const remaining = researchNarrative
      ? facts.filter((fact) => fact !== lead)
      : [
          ...priorityFacts,
          ...facts.filter((fact) => fact !== lead && !priorityFacts.includes(fact)),
        ];
    const paragraphs = researchNarrative
      ? narrativeParagraphs(remaining, story, diagnostics)
      : [
          ...deterministicParagraphs(remaining, story, diagnostics),
          ...priorityFacts
            .filter((fact) => !remaining.slice(0, 8).includes(fact))
            .slice(0, 3)
            .map((fact) => ({
              text: sentence(attributedFactText(fact.text, fact.evidence, story)),
              evidence: fact.evidence,
            })),
        ];
    const composedText = paragraphs.map((paragraph) => paragraph.text).join(" ");
    // The entity-context pass inserts a source sentence that names an entity the
    // article has not introduced yet. In narrative order the paper has already
    // said what it means to say, in the order it meant to say it, so nothing is
    // spliced in.
    for (const entity of researchNarrative
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
    for (const candidate of story.relatedEvents ?? []) {
      const context = relatedContext({ title: story.title, summary: leadText }, candidate);
      if (context && validDeterministicSentence(context))
        paragraphs.push({ text: sentence(context), evidence: [] });
    }
    // Thin evidence should remain thin; rich evidence is capped at four useful blocks.
    // Whatever the cap drops is counted, so a fact behind it is explicable.
    const capped = paragraphs.slice(0, facts.length <= 3 ? 2 : paragraphs.length);
    for (const block of paragraphs.slice(capped.length)) {
      refuseBlock(block.text, "thin_evidence_cap", diagnostics);
    }
    const gated = qualityGate({ deck, paragraphs: capped }, story.title, diagnostics);
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
      const text = sentence(attributedFactText(item.text, item.evidence, story));
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
