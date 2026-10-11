/**
 * The rulers that judge published prose, defined once.
 *
 * Three callers measure the same defects -- the audit over the live corpus, the
 * before/after diff over two snapshots, and the regression tests over the
 * production fixture. Two definitions of "malformed attribution" would let the
 * number and the fixture disagree, which is the one inconsistency a report like
 * this cannot afford.
 *
 * Every ruler reads the *published text*, never the composer's own counters: a
 * leak the composer does not know about is the leak worth counting.
 *
 * One exception, and it is deliberate: whether a quote opening is a *defect*
 * cannot be read off the prose alone. The reader's question is "can I tell who is
 * speaking, and have I already read this?", and the second half of that is a fact
 * about the page and the ledger, not about one block -- see
 * `quoteOpeningEvidence` below.
 */

// Relative rather than `@/`, deliberately: this file is imported by a suite that
// runs under vitest as well as by the operator scripts under tsrun, and only the
// scripts's own resolution maps the alias. Every other script that reaches into
// `src` does the same.
import { readerSentences, sentenceKey } from "../../src/lib/reader-evidence";

/** An HTML entity of any kind -- named, decimal or hex. */
export const ENTITY_LEAK = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i;

/**
 * Attribution glued to a clause it cannot introduce.
 *
 * `reports that Once they were out in the wild` and `reports that "But ...` are
 * the production shapes. Two families: a discourse or subordinating word that
 * the source capitalised ("Once", "Only", "Both"), and a fronted adverbial with
 * its own comma ("reports that Overall,", "reports that Ten days later,") --
 * a comma may not follow `that`, so the wrap is ungrammatical however the clause
 * is cased.
 *
 * Deliberately case-sensitive, and deliberately attached to a reporting verb. A
 * lower-cased subordinator after `that` is ordinary English -- "Tom's Hardware
 * reports that while $439 makes most of us shudder, it is one of the best deals"
 * was flagged by an earlier, case-insensitive version of this ruler -- and so is a
 * quotation that merely follows the word `that` in a sentence ("devices that
 * "support the latest generation of Photographic Styles""). Counting those as
 * defects is how a report starts disagreeing with its own samples.
 */
export const GLUED_ATTRIBUTION =
  /\b(?:reports?|said|says)\s+that\s+(?:[A-Z][\p{L}'-]+,\s|(?:Once|When|While|Because|Although|After|Before|If|Since|But|And|Or|So|Yet|Only|Both)\b|["“])/u;

/**
 * A *candidate* fusion: a clause with no terminal punctuation welded to a
 * capital-initial clause, with more words after it.
 *
 * Deliberately named a candidate and never counted as a defect. It fires on the
 * fused standfirst the reader saw on 2026-10-10 ("...while his child was in the
 * back of his car Residents of Manhattan's Marble Hill neighborhood..."), and it
 * also fires on place names and product nouns -- "several trains to Delhi have
 * been cancelled", "the German Federal Public Prosecutor" -- so on its own it
 * cannot say how many stored units are wrong. The only trustworthy count of a
 * fusion is a re-extraction: the old extractor produced the unit, the current
 * one separates it, and the words are unchanged. That experiment is
 * `scripts/reader-fusion-sample.ts`, and its number is the confirmed one.
 */
export const CANDIDATE_FUSION = /[a-z,)\u201d]\s+[A-Z][a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/u;

/**
 * Whether a re-extraction actually divided a fused unit.
 *
 * The comparison has to be against the *runs*, never against the whole text with
 * its whitespace collapsed: collapsing turns the boundary back into a space, so
 * a space-joined test finds the fused sentence "still present" in the very
 * extraction that separated it -- which is how the first version of this test
 * scored zero confirmed repairs on pages the diagnostic had already shown were
 * fixed.
 *
 * True when no single run contains the original unit and both halves of its seam
 * are present in the text.
 */
export function fusionSeparatedByRuns(unitText: string, runs: string[]): boolean {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  const whole = norm(unitText);
  if (whole.length < 80) return false;
  // No run holds the unit whole: that is the proof, and no pattern can produce
  // it. A unit always comes from one run -- `sentences` runs inside a run -- so a
  // unit that no longer sits inside any single run was divided by the boundary,
  // whatever its words are.
  if (runs.some((run) => norm(run).includes(whole))) return false;
  // Its beginning and its end survived, so this was a division and not a
  // deletion. Deliberately not a guessed seam: the first version looked for the
  // space after the regex's own match and cut "Marble | Hill" out of the middle
  // of a proper noun, which turned a test that could only pass into one that
  // could only fail.
  const head = whole.slice(0, 40);
  const tail = whole.slice(-40);
  return (
    runs.some((run) => norm(run).includes(head)) && runs.some((run) => norm(run).includes(tail))
  );
}

/** A space where punctuation was meant to follow a word instead. */
export const SPACE_BEFORE_PUNCT = /\s+[,;.!?]/;

/** Two spaces, the seam a cleanup pass leaves behind. */
export const DOUBLE_SPACE = / {2}/;

/** Two disconnected quotations in one block. */
export const TWO_QUOTES = /["“][^"”]{10,}["”][^.!?]*["“][^"”]{10,}["”]/;

/**
 * A block opening on quote punctuation that is not an opening mark: the tail of a
 * quotation whose opening was cut, which is a fragment rather than a sentence.
 */
export const LEADING_QUOTE = /^\s*[”‘']/;
/** A block that opens on a quotation mark: a quotation in the lead slot. */
export const OPENS_ON_QUOTE = /^\s*["“]/;

/**
 * Words the composer lowercased that their source only ever capitalises.
 *
 * The ruler for the leading-word case rewrite this patch removed, and the reason
 * it has to compare two texts: the defect was invisible in the published prose.
 * "all Things Considered host Mary Louise Kelly talks with ..." is an ordinary
 * looking phrase until it is put next to the source, which is why a count over
 * output alone could not see it and why this takes the source with it.
 *
 * A word counts only when the source writes it capitalised *everywhere* and the
 * block writes it lowercase somewhere. `the`, `that` and `a` are therefore never
 * counted -- every source writes them both ways, so no ruler can say which
 * occurrence was a name. `all` in the sentence above is: NPR never writes it
 * lowercase, so publishing `all` is a rewrite, whoever made it.
 *
 * Scripts only: a snapshot carries published prose and no source text, so the
 * audit and the diff cannot share this one the way they share the rulers above.
 */
export function lowercasedSourceCapitals(published: string, source: string): string[] {
  const capitalisedOnly = new Set<string>();
  const everLowercase = new Set<string>();
  for (const [word] of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const key = word.toLowerCase();
    if (word === key) everLowercase.add(key);
    else capitalisedOnly.add(key);
  }
  const rewritten = new Set<string>();
  for (const [word] of published.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const key = word.toLowerCase();
    if (word !== key || everLowercase.has(key) || !capitalisedOnly.has(key)) continue;
    rewritten.add(word);
  }
  return [...rewritten].sort();
}

/**
 * A quotation: an opening mark, its speech, and the matching closing mark.
 *
 * Single quotes are deliberately absent. The corpus uses them for titles and
 * possessives far more often than for speech, and counting one as a quotation
 * would put a speaker's name inside somebody's book title.
 */
const QUOTED_SPAN = /"[^"\n]*"|“[^”\n]*”/g;

/**
 * The page with every quotation removed.
 *
 * A name inside quotation marks is the speaker's own words about somebody else,
 * so it cannot be the name that tells the reader who is talking.
 */
export function withoutQuotedSpeech(text: string): string {
  return text.replace(QUOTED_SPAN, " ");
}

/**
 * The speech inside each quotation, as its own text.
 *
 * Needed because a quotation is often glued to its attribution -- `"..." said
 * Jane Smith.` is one sentence to the sentence splitter, so comparing whole
 * sentences misses the repeat the reader actually meets. The repeated unit is the
 * quoted sentence, which is why the repeat check reads both.
 */
export function quotedSpeech(text: string): string[] {
  return [...text.matchAll(QUOTED_SPAN)].map((match) => match[0].slice(1, -1).trim());
}

/** The verbs that hand a name to the words after it. */
const SPEECH_VERB =
  "said|says|told|tells|added|adds|noted|notes|wrote|writes|asked|asks|stated|states|explained|explains|warned|warns|announced|announces|argued|argues|claimed|claims|reported|reports|testified|testifies|confirmed|confirms|denied|denies";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The name the page hands a speech verb, or an empty string.
 *
 * The name has to come from the story's own entity list, so this never guesses
 * that a capitalised word is a person: `containers said` and `The report said`
 * are how a name-shaped ruler starts naming nobody. Both directions are read,
 * because English writes both -- `Jane Smith said` and `, said Jane Smith` -- and
 * each is bounded to one sentence, so a name in a later paragraph cannot count as
 * this sentence's speaker.
 */
export function attributionSeam(text: string, names: string[]): string {
  const prose = withoutQuotedSpeech(text);
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const before = new RegExp(`\\b${escaped}(?:'s)?[^.!?]{0,30}\\b(?:${SPEECH_VERB})\\b`, "u");
    const after = new RegExp(`\\b(?:${SPEECH_VERB})\\b[^.!?]{0,24}?\\b${escaped}\\b`, "u");
    if (before.test(prose) || after.test(prose)) return name;
  }
  return "";
}

/** What a quote-opening block turned out to be. */
export type QuoteOpeningClass =
  /** The block repeats a sentence the reader has already read above it. */
  | "duplicate"
  /** The speaker is named nowhere, and the ledger shows one was charged. */
  | "attribution-refused"
  /** The speaker is named nowhere and nothing shows an attribution existed. */
  | "unresolved"
  /** The page names the speaker, so the opening resolves for the reader. */
  | "valid";

/**
 * The sentence the page hands the name to the verb in.
 *
 * Printed beside the name because the name alone is not the evidence the ruling
 * asked for -- "where the attribution or necessary context appears" is. The ruler
 * reports *an* entity in an attribution seam, which is not always the speaker: an
 * organisation standing next to the verb (`Gartner said`) and a name the entity
 * extractor cut short (`J.J`, for J.J. "Yank" Cummings) both satisfy it. The
 * sentence is what lets a reader see which of those happened, and none of those
 * cases changes the classification, because the person speaking is named in it.
 */
export function attributionSentence(text: string, names: string[]): string {
  for (const sentence of readerSentences(withoutQuotedSpeech(text))) {
    if (attributionSeam(sentence, names) !== "") return sentence.trim();
  }
  return "";
}

export type QuoteOpeningEvidence = {
  class: QuoteOpeningClass;
  /** The speaker the page names, or "". */
  attribution: string;
  /** The sentence that name was found in, or "". */
  attributionSentence: string;
  /** Where that name is, relative to this block. */
  where: "block" | "page" | "none";
  /** The sentence above it that this block repeats, or "". */
  duplicateOf: string;
  /** The rule that charged a fact naming the speaker, or "". */
  refusedRule: string;
};

/**
 * Whether a block that opens on a quotation leaves the reader able to read it.
 *
 * The arbiter's ruling of 2026-10-11 (option (a) of the quote-opening queue): a
 * quote opening is defective when the page lacks the context needed to interpret
 * it, or when it genuinely repeats something already published -- not because it
 * begins with quoted speech. So this reads four things and no more:
 *
 * - whether the *page* names the speaker, in this block or in another one;
 * - whether the name sits in an attribution seam, so the name is a speaker and
 *   not a passing mention;
 * - whether the ledger charged a fact that named a speaker, which is the case
 *   where the composer had the attribution and did not publish it ("do not invent
 *   an attribution" -- and do not silently drop one either);
 * - whether a sentence of this block is the identity of a sentence already
 *   published above it, by `sentenceKey`, which is the fact identity the merge and
 *   refusal rules use. Similarity is not enough: the wording comparison matched
 *   three sentences about other things on the frozen corpus, which is exactly why
 *   the resemblance class is reported beside the republication class and never
 *   instead of it.
 */
export function quoteOpeningEvidence(input: {
  /** Every published block of the story, in reading order: deck first. */
  page: string[];
  /** The index of the block that opens on a quotation. */
  index: number;
  /** The story's named entities, longest first so a full name beats a surname. */
  names: string[];
  /** Facts the composer did not publish, with the rule that charged each. */
  unrendered: { text: string; rule: string }[];
}): QuoteOpeningEvidence {
  const block = input.page[input.index] ?? "";
  const earlier = input.page.slice(0, input.index);
  const others = [...earlier, ...input.page.slice(input.index + 1)].join(" ");

  const own = attributionSeam(block, input.names);
  const elsewhere = own === "" ? attributionSeam(others, input.names) : "";
  const attribution = own !== "" ? own : elsewhere;
  const attributionSentenceText = attributionSentence(own !== "" ? block : others, input.names);
  const where: QuoteOpeningEvidence["where"] =
    own !== "" ? "block" : elsewhere !== "" ? "page" : "none";

  // The same sentence twice, by the identity the merge rules use: punctuation and
  // case removed. Only sentences already published *above* it count -- a repeat
  // below is the same defect, reported once, at the block that did it first.
  //
  // Both the block's own sentences and the speech inside its quotation marks are
  // candidates, because a quotation is usually glued to its attribution: `"<the
  // sentence>" said Jane Smith.` is one sentence to the splitter, and reading only
  // whole sentences would call a repeated quotation new prose. The unit a reader
  // repeats is the quoted sentence, so that is the unit compared.
  let duplicateOf = "";
  const above = earlier.flatMap((text) => readerSentences(text));
  const aboveKeys = new Map(above.map((sentence) => [sentenceKey(sentence), sentence]));
  const candidates = [...readerSentences(block), ...quotedSpeech(block).flatMap(readerSentences)];
  for (const sentence of candidates) {
    const hit = aboveKeys.get(sentenceKey(sentence));
    if (hit !== undefined) {
      duplicateOf = hit;
      break;
    }
  }

  // The composer had an attribution and charged it. Read only when the page
  // names nobody, so a story whose speaker is published is never reported as a
  // refused one.
  let refusedRule = "";
  if (where === "none") {
    const refused = input.unrendered.find((fact) => attributionSeam(fact.text, input.names) !== "");
    refusedRule = refused?.rule ?? "";
  }

  const klass: QuoteOpeningClass =
    duplicateOf !== ""
      ? "duplicate"
      : attribution !== ""
        ? "valid"
        : refusedRule !== ""
          ? "attribution-refused"
          : "unresolved";

  return {
    class: klass,
    attribution,
    attributionSentence: attributionSentenceText,
    where,
    duplicateOf,
    refusedRule,
  };
}
