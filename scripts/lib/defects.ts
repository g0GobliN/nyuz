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

/**
 * A URL published as prose.
 *
 * D9's second class. The block the owner read ended `Investors.boeing.com/... Am
 * wondering what ransomware negotiations he was involved in.` -- a link from
 * somebody's comment thread, published as if it were reporting. Nothing counted
 * it, which is the D2/D3 shape again: a ruler that cannot see the thing being
 * judged.
 *
 * Two shapes, both requiring a real address rather than a dotted word: a scheme
 * or `www.`, or a bare host with a path or a two-or-more-letter TLD. Deliberately
 * not anchored to the start of a block, because the address in the sample sits
 * mid-sentence.
 *
 * Deliberately does *not* require the address to resolve or the TLD to be real.
 * "Is it a URL" is a question about shape, and a ruler that checked liveness
 * would report an outage as an absence of defects.
 */
/**
 * The TLDs that make a bare dotted word read as a web address rather than a name.
 *
 * The first draft accepted any two-letter-or-longer suffix and published 16 raw
 * URLs on the frozen corpus, most of them not URLs at all: `llama.cpp`,
 * `Node.js`, `GLM-5.3-Flash`. A file extension and a country TLD are the same
 * shape, so the suffix alone cannot decide it -- the list below is what a reader
 * recognises as the web, and it is deliberately short rather than clever.
 */
const WEB_TLD = "(?:com|org|net|io|ai|app|dev|gov|edu|co|uk|jp|us|news|blog|xyz|me|info|site|sh)";

/**
 * A URL published as prose.
 *
 * D9's second class -- the block the owner read ended `Investors.boeing.com/...
 * Am wondering what ransomware negotiations he was involved in.`, a link out of
 * somebody's comment thread published as reporting. Nothing counted it.
 *
 * Three shapes: `https://` and `www.` are addresses by declaration, and a bare
 * host is one when its suffix is a name the web uses. The third draft of this
 * ruler also accepted *any* suffix followed by a path, on the theory that a path
 * makes an address unambiguous; the frozen corpus showed what that costs --
 * `Assisted-by: pi:llama.cpp/Qwen3.8-Flash-Next` is an identifier with a slash in
 * it, and it was counted as a published URL. So the suffix list decides, and `sh`
 * is on it precisely so `bun.sh/install.ps1` still counts without the path rule.
 *
 * Deliberately does not check that the address resolves. "Is it an address" is a
 * question about shape, and a ruler that probed liveness would report a network
 * outage as an absence of defects.
 *
 * Known, recorded limitation: a bare host whose TLD is not on the list is missed.
 * `bun.sh` survives only because `sh` is listed; a future `.dev`-like suffix that
 * is not named here would not. That is the trade this ruler chose -- a miss costs
 * one row, and a false positive costs the count the ruling is argued from.
 */
export const RAW_URL = new RegExp(
  `\\b(?:https?:\\/\\/[^\\s]+|www\\.[^\\s]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${WEB_TLD}(?:\\/[^\\s]*)?)`,
  "i",
);

/**
 * The words a sentence cannot end on, so their period is a cut and not a stop.
 *
 * Two families, and they are the ones a clipping boundary leaves behind:
 *
 * - a **month** ("... between Oct.", "... sentenced on Sept."): a date was
 *   being given and the feed's excerpt ended inside it;
 * - a **function word** -- article, conjunction or preposition -- which by
 *   definition wants a complement after it ("... the Loews Philadelphia Hotel
 *   between Oct." is the sample's other half).
 *
 * Months are a closed list, so that half is exact. The function-word half is
 * deliberately a **short** list: articles and conjunctions, which cannot end a
 * sentence at all, plus the few prepositions that bind forward so tightly that
 * stopping on one is a cut. The first draft listed every preposition and fired on
 * four published leads, all of them idiomatic -- "while OpenAI moves on.", "most
 * passionate about.", "have quickly signed on.", "was scheduled on." -- which is
 * the failure mode this file exists to avoid: a ruler that measures English rather
 * than damage. `on`, `about`, `for` and `to` are ordinary sentence endings and are
 * therefore absent by measurement, not by taste.
 */
export const DANGLING_TAIL =
  /(?:\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.|\b(?:the|a|an|and|or|but|of|between|into|during)\.)$/i;

/**
 * A sentence that ends where prose cannot: the fragment D9 asked to be counted.
 *
 * Returns the offending sentence, or "" -- the sentence rather than a boolean,
 * because the report has to print the evidence beside the count or the number is
 * an anecdote again.
 *
 * Bounded by a length floor and by requiring the sentence to have run for a few
 * words. `Oct.` as an entire line is a date, not a truncated clause, and a
 * two-word block is not prose that can be judged this way.
 */
export function truncatedSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (!DANGLING_TAIL.test(trimmed)) return "";
  const words = trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  if (words < 5) return "";
  return trimmed;
}

/**
 * The opening sentence of a block, when it is a truncated one.
 *
 * The reader meets the fragment in the lead slot, which is what makes it cost
 * more than a fragment further down: it is the one sentence with nothing before
 * it. Only the first sentence is judged, because that is the class D9 described
 * and widening it to every sentence would be a different measurement wearing the
 * same name.
 */
export function truncatedLead(block: string): string {
  const first = readerSentences(block)[0];
  return first === undefined ? "" : truncatedSentence(first);
}

/**
 * What a withheld story's reason says the gate refused.
 *
 * Grouped here rather than guessed in the report, and deliberately read off the
 * gate's own `reason` string: that string is the rule's self-report of which
 * shape it matched, so the audit and the rule cannot drift about what "a vendor
 * how-to" is. The four families are different questions, which is why the count
 * of 19 means nothing until they are separated:
 *
 * - `not-a-headline` -- the title is a machine identifier, a commit message, a
 *   byline, a newsletter container or an announcement of a quotation. There is
 *   nothing for a reader to read, so nothing was lost by withholding it.
 * - `promotion` -- the title's own words are a price, a sale with a clock on it,
 *   or a shopping-event listing. The reader was offered a shop, not a story.
 * - `first-party-shape` -- a vendor-marketing shape fired: a first-person
 *   imperative, a benefit aimed at the reader, a how-to trailer. This is the only
 *   family the gate is *guessing* about, because the shape is judged on the title
 *   and the title's words alone decide whether the source was a vendor.
 * - `evidence` -- the refusal came from the composition or the coverage (no body,
 *   one-source primary material, an empty summary). A different failure entirely.
 */
export type WithheldFamily = "not-a-headline" | "promotion" | "first-party-shape" | "evidence";

const WITHHELD_REASONS: readonly [WithheldFamily, readonly string[]][] = [
  [
    "not-a-headline",
    [
      "headline is an identifier",
      "commit message",
      "byline",
      "announces the container",
      "announces a quotation",
    ],
  ],
  [
    "promotion",
    [
      "price promotion",
      "sale with a clock",
      "ranks products by price",
      "shopping-event listing",
      "shop shelf with a price",
      "event promotion with a deadline",
    ],
  ],
  [
    "first-party-shape",
    [
      "imperative promotion",
      "vendor how-to",
      "pitches a benefit",
      "celebrates the vendor",
      "themed campaign banner",
    ],
  ],
];

export function withheldFamily(reason: string): WithheldFamily {
  for (const [family, markers] of WITHHELD_REASONS) {
    if (markers.some((marker) => reason.includes(marker))) return family;
  }
  return "evidence";
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
