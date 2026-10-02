/**
 * Turns a short event summary plus feed excerpts into paragraphs a Read page
 * can set as a news column. No extra model call: the excerpts were stored at
 * ingest.
 *
 * Also the digest's paragraph source, so the text it sets in an email is the
 * same text the site sets -- which is why decoding lives in one place now. This
 * file used to carry its own five-entity map, so `&nbsp;` resolved here and
 * `&#x20;` did not, and the two surfaces could disagree about the same stored
 * summary.
 */

import { decodeEntities } from "./pipeline/source-text";
import {
  admissibleReaderSentence,
  nearDuplicate,
  readerSentences,
  storyPosition,
} from "./reader-evidence";

export function toGrafs(text: string): string[] {
  const raw = text.trim();
  if (raw === "") return [];
  const blocks = raw
    .split(/\n\n+/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter((b) => b.length > 0);
  if (blocks.length >= 3) return blocks;

  const sentences = splitSentences(blocks.join(" "));
  if (sentences.length <= 2) return blocks;

  const grafs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const a = sentences[i];
    const b = sentences[i + 1];
    if (!a) continue;
    grafs.push(b ? `${a} ${b}` : a);
  }
  return grafs;
}

export function clipGraf(text: string, max = 560): string {
  const clean = stripMarkup(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return at >= 24 ? cut.slice(0, at + 1) : `${cut.trimEnd()}…`;
}

/**
 * How many paragraphs the Read page builds up to.
 *
 * Raised from eight because the column read short: an event summary plus a
 * before and after leaves only five slots for actual coverage, and a story with
 * several sources ran out before it felt like an article. Ten is still bounded —
 * this is a briefing, not a reprint — and the length floor below means a feed
 * with nothing to add cannot pad it out.
 *
 * `mailGrafs` is unaffected on purpose. It takes the first four whatever this
 * is, because an email is the summary and the site is the whole thing.
 */
const STORY_GRAFS = 10;

/**
 * Whether two sentences belong in one paragraph.
 *
 * `toGrafs` paired by array position -- one and two, then three and four -- which
 * is how a paragraph came to hold an evaluation of agent risk next to a
 * statement about what the agent costs to run. Two unrelated topics welded
 * together is one of the clearest assembly signals a reader can see, and it was
 * being produced by a loop counter rather than by anything about the sentences.
 *
 * The rule is a refusal, not a plan. Sentences sit together unless one of them
 * is a reaction and the other is not: an evaluation needs its own paragraph to
 * read as a reaction, and a commercial detail has no business sharing one. No
 * attempt is made to understand what either sentence means.
 */
function pairsWell(left: string, right: string): boolean {
  const a = storyPosition(left);
  const b = storyPosition(right);
  if (a === b) return true;
  return a !== "impact" && b !== "impact";
}

/** The event summary, admitted and grouped by role rather than by position. */
function whatParagraphs(what: string): string[] {
  const admitted = readerSentences(what).filter(admissibleReaderSentence);
  const grafs: string[] = [];
  let current: string[] = [];
  for (const part of admitted) {
    const previous = current.at(-1);
    if (previous !== undefined && !pairsWell(previous, part)) {
      grafs.push(current.join(" "));
      current = [];
    }
    current.push(part);
  }
  if (current.length > 0) grafs.push(current.join(" "));
  return grafs;
}

export function storyGrafs(input: {
  what: string;
  before: string;
  after: string;
  excerpts: string[];
}): string[] {
  // `what` is gated too, and that used to look unsafe: it can be a translated
  // string, where an English furniture pattern would be meaningless. It is not
  // unsafe, it is merely ineffective -- a pattern that cannot match a Japanese
  // sentence cannot produce a false positive in one either. Leaving this field
  // ungated was the hole that let "Analysts say the risk is ..." reach an inbox
  // while every Read-page counter read zero, which is the exact incoherence the
  // shared gate exists to remove.
  const grafs = whatParagraphs(input.what);
  if (input.before.trim()) grafs.push(clipGraf(input.before));
  if (input.after.trim()) grafs.push(clipGraf(input.after));

  for (const excerpt of input.excerpts) {
    // Appending the excerpt whole is what let the email print "Subscribe to The
    // Verge for more" and "Contact the editorial team at news@..." while every
    // Read-page quality counter read zero: the two surfaces had two different
    // definitions of a sentence. The email keeps its own shape -- its own
    // length, its own truncation, its own first four paragraphs -- and no longer
    // its own idea of what may be published.
    const admitted = readerSentences(excerpt).filter(admissibleReaderSentence);
    if (admitted.length === 0) continue;
    const graf = clipGraf(admitted.join(" "));
    if (graf.length < 40) continue;
    if (grafs.some((g) => nearDuplicate(g, graf))) continue;
    grafs.push(graf);
    if (grafs.length >= STORY_GRAFS) break;
  }
  return grafs;
}

/** First half of the column — enough to know what happened. The site keeps the rest. */
export function mailGrafs(input: {
  what: string;
  before: string;
  after: string;
  excerpts: string[];
}): string[] {
  const all = storyGrafs(input);
  if (all.length <= 4) return all;
  return all.slice(0, 4);
}

/** Drop the why box when it is the same paragraph already in the brief. */
export function mailWhy(why: string, grafs: string[]): string {
  const trimmed = why.trim();
  if (!trimmed) return "";
  if (grafs.some((g) => nearDuplicate(g, trimmed))) return "";
  return trimmed;
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter((s) => s.length > 0);
}

function stripMarkup(text: string): string {
  // Tags first, then the shared decoder, then one collapse -- the order that
  // keeps an escaped `<script>` from becoming markup after the tag pass.
  return decodeEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
