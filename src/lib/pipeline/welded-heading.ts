/**
 * Repairing a heading the publisher welded onto the sentence that follows it.
 *
 * **What the defect looks like.** A delivered briefing card on 2026-10-18 opened
 * with:
 *
 *     Ransomware with physical consequences Building automation systems - BAS -
 *     are the critical systems that control and monitor facilities' HVAC ...
 *
 * The words are all the publisher's; the boundary between its subhead and its
 * first paragraph is gone. The Register's feed ships the article as *plain text*
 * inside `content:encoded`, with the `<h3>` subhead and the next paragraph
 * separated by one space — so `htmlToText` had no tag to close a block on, and
 * `events.what_happened` (the feed's lead sentence) stored the two sentences run
 * together. Re-extracting the same page today gives the separated form, because
 * the page itself marks the heading up; the stored text does not.
 *
 * **Why the repair needs the page.** A text pattern cannot tell this from an
 * ordinary sentence: measured on the frozen 200 (2026-10-18), the loosest
 * candidate ruler matched 35 stored summaries, and reading all 35 found exactly
 * one welded heading against 34 ordinary sentences with a proper noun in them
 * ("... with fraud, affordability and fallout from the Trump administration's
 * policies"). The arbiter's ruling (#10, 2026-10-18) is therefore structural:
 * split **only** where the article's own page confirms a heading with that exact
 * text, and leave the text untouched when the page is unavailable or the heading
 * is not there. Nothing is guessed and no good line is withheld to catch a bad
 * one.
 *
 * **Two stored strings carry the same weld, and they need different repairs.**
 *
 * - `events.what_happened` is *a line*: one sentence shown under a headline, so
 *   the heading is dropped and the sentence after it is kept
 *   (`splitWeldedHeading`).
 * - `articles.excerpt` is *a document*: the composer reads it for evidence and
 *   selects its own lead from it, which is why repairing the event line alone
 *   left the story page still opening on the weld (measured 2026-10-18). The
 *   excerpt keeps the publisher's words and closes the boundary instead —
 *   `... consequences. Building automation systems ...`, which is the form the
 *   page's own extractor produces (`separateWeldedHeading`).
 *
 * **What this file is not.** It does not fetch, store or render anything — the
 * caller supplies the text and the page's HTML, so the same rule can be tested
 * without a network and run by `scripts/repair-welded-headings.ts` against the
 * rows already stored.
 */

import { decodeEntities } from "./source-text";

/**
 * The page's own headings, as plain text, longest first.
 *
 * Longest first because the seam is decided by the text that follows the
 * heading: when two headings share a prefix, the longer one is the one the
 * publisher actually wrote above the paragraph, and matching the shorter one
 * first would splice the paragraph's opening into the wrong place.
 *
 * Only headings with at least two words and eight characters are kept. A
 * one-word heading ("Review", "Analysis") is a label that also occurs in running
 * prose, and removing it from a line would be indistinguishable from deleting a
 * sentence's subject.
 */
export function pageHeadings(html: string): string[] {
  const found = new Set<string>();
  const headingRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html)) !== null) {
    const text = decodeEntities((match[1] ?? "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.split(/\s+/).length < 2) continue;
    if (text.length < 8) continue;
    found.add(text);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** A confirmed weld: where the heading sits, and which heading it is. */
type Weld = { index: number; heading: string };

/**
 * Every welded occurrence of a confirmed heading in `text`, back to front.
 *
 * The seam is exact: the heading's text followed by one space and a character
 * that opens a sentence. A heading followed by punctuation already stands as its
 * own sentence and is not a weld; one followed by a lowercase word is inside a
 * sentence rather than above it.
 *
 * Returned in reverse order so a caller can rewrite the text without its own
 * indices moving under it.
 */
function weldsIn(text: string, headings: readonly string[]): Weld[] {
  const welds: Weld[] = [];
  for (const heading of headings) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(heading, from);
      if (index < 0) break;
      from = index + 1;
      if (text.charAt(index + heading.length) !== " ") continue;
      const next = text.charAt(index + heading.length + 1);
      if (!/[A-Z0-9"'“‘]/u.test(next)) continue;
      // A heading that overlaps one already accepted is the same seam seen
      // through a shorter heading; the longer match is the one the page wrote.
      if (welds.some((weld) => Math.abs(weld.index - index) < heading.length)) continue;
      welds.push({ index, heading });
    }
  }
  return welds.sort((a, b) => b.index - a.index);
}

export type WeldedHeadingRepair = {
  /** The repaired text. */
  text: string;
  /** The headings the page confirmed, in the order they were removed. */
  headings: string[];
};

/**
 * The event line without the headings the article's own page confirms, or null.
 *
 * Null is the answer in every case the ruling names as a preserve: no heading
 * matches, the page could not be read (the caller passes `[]`), the heading
 * already stands as its own sentence (it is followed by punctuation), or
 * removing it would leave less than a sentence behind.
 */
export function splitWeldedHeading(
  line: string,
  headings: readonly string[],
): WeldedHeadingRepair | null {
  const original = line.replace(/\s+/gu, " ").trim();
  if (original === "") return null;
  const welds = weldsIn(original, headings);
  if (welds.length === 0) return null;

  let text = original;
  const removed: string[] = [];
  for (const weld of welds) {
    const candidate =
      `${text.slice(0, weld.index)}${text.slice(weld.index + weld.heading.length + 1)}`.trim();
    // A repair must keep a sentence, and must not empty the line: the seam's
    // right-hand side is the sentence the reader should read.
    if (candidate.length < 30) continue;
    if (!/[.!?]$/u.test(candidate)) continue;
    text = candidate;
    removed.push(weld.heading);
  }
  if (removed.length === 0) return null;
  return { text, headings: removed.reverse() };
}

/**
 * The document with each confirmed weld closed into two sentences, or null.
 *
 * Used on `articles.excerpt`, which the composer reads for evidence: the
 * publisher's own words are kept and only the missing boundary is supplied, so
 * the excerpt reads exactly as the page's own extraction reads.
 */
export function separateWeldedHeading(
  document: string,
  headings: readonly string[],
): WeldedHeadingRepair | null {
  const welds = weldsIn(document, headings);
  if (welds.length === 0) return null;
  let text = document;
  const closed: string[] = [];
  for (const weld of welds) {
    const seam = weld.index + weld.heading.length;
    // One space becomes `. `: the heading keeps its own text and the sentence
    // after it starts as a sentence. Nothing else about the document moves.
    text = `${text.slice(0, seam)}. ${text.slice(seam + 1)}`;
    closed.push(weld.heading);
  }
  return { text, headings: closed.reverse() };
}
