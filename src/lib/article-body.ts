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
import { admissibleReaderSentence, nearDuplicate, readerSentences } from "./reader-evidence";

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

export function storyGrafs(input: {
  what: string;
  before: string;
  after: string;
  excerpts: string[];
}): string[] {
  const grafs = [...toGrafs(input.what)];
  if (input.before.trim()) grafs.push(clipGraf(input.before));
  if (input.after.trim()) grafs.push(clipGraf(input.after));

  for (const excerpt of input.excerpts) {
    // The excerpts are the only publisher-written text that reaches this file,
    // so they are the only place the reader-quality gate applies. `what`,
    // `before` and `after` are nyuz's own stored copy and may have been
    // translated, where an English furniture pattern would mean nothing.
    //
    // Appending the excerpt whole is what let the email print "Subscribe to The
    // Verge for more" and "Contact the editorial team at news@..." to an inbox
    // while every Read-page quality counter read zero: the two surfaces had two
    // different definitions of a sentence. The email keeps its own shape -- its
    // own length, its own truncation, its own first four paragraphs -- and no
    // longer its own idea of what may be published.
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
