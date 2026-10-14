/**
 * Deterministic, dependency-free main-text extraction from a fetched HTML page.
 *
 * No DOM parser is added for this (no cheerio/jsdom/linkedom in this repo).
 * Three reasons: Workers-compatibility of a new native-ish dependency is
 * unverified here, a new dependency is lockfile churn in a tree several
 * agents edit concurrently, and `extract.ts` already established that
 * lightweight regex extraction is this codebase's preferred tool for exactly
 * this kind of deterministic text work. `<p>` tags are where article bodies
 * live in practice; this is a heuristic, not a full readability algorithm,
 * and a page that doesn't parse cleanly just yields little or no text --
 * `enrich.ts` treats "not enough text" the same as "couldn't fetch it".
 */

import { decodeEntities } from "./source-text";

const STRIP_TAGS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "svg",
  "iframe",
  "template",
];

/**
 * Tags first, then the shared decoder -- the order every caller of
 * `decodeEntities` must use, so that an escaped `<script>` becomes the harmless
 * text `<script>` only after the tag pass has already run.
 *
 * Decoding used to live here as a private map, which is how one surface could
 * resolve `&#39;` and another could publish `&#x20;` as four characters. There
 * is one decoder now, in `source-text.ts`, shared with normalization and with
 * the pipeline that reads feed fields.
 */
/**
 * Tags that end a text run, and tags that do not.
 *
 * The publisher's own structure is the only punctuation-free boundary we have,
 * and one line of this file used to throw it away: every tag became a word
 * space, so a Guardian standfirst -- which carries no full stop -- was welded to
 * the sentence after it and stored as one fact. The reader saw two clauses run
 * together with a mid-sentence capital (Marble Hill, 2026-10-10).
 *
 * A line-breaking tag is a *structural* boundary, not a grammatical one: a
 * `<br>` can separate the lines of one sentence, and a run that turns out to be
 * half a sentence is refused downstream by the rules that refuse any other
 * fragment. What must not happen is the fusion, because no later stage can tell
 * two sentences from one -- there is nothing left in the text to tell it by.
 *
 * Inline tags stay a word space, so `The <a>New York Times</a> reported` keeps
 * its words apart and never grows a break inside itself.
 */
const STRUCTURAL_TAG =
  /<\/?(?:br|p|div|h[1-6]|li|ul|ol|blockquote|section|article|figure|figcaption|td|th|tr|table|dd|dt|dl|pre|hr)\b[^>]*>/gi;

/** The boundary `extractMainText` emits between runs, and honours downstream. */
export const STRUCTURAL_BREAK = "\n";

/**
 * The in-flight marker for a structural boundary.
 *
 * Deliberately a character no page contains (private use area, and `source-text`
 * reserves `\uE000` for its dot placeholder), because the boundary has to be
 * distinguishable from the newlines a page's own source formatting is full of:
 * a `<p>` written across three lines in the markup is one run, not three. The
 * marker is converted to `STRUCTURAL_BREAK` once, on the way out.
 */
const RUN_MARK = "\uE001";

function stripTags(fragment: string): string {
  return fragment
    .split(RUN_MARK)
    .join(" ")
    .replace(STRUCTURAL_TAG, RUN_MARK)
    .split(RUN_MARK)
    .map((run) =>
      decodeEntities(run.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((run) => run !== "")
    .join(RUN_MARK);
}

/**
 * Headings that end the article body and start a separate sidebar or index.
 *
 * The Guardian's "What else we're reading about" section carries unrelated
 * snippets from other stories (visa policy, water restrictions) that sit inside
 * the same article column and reach the reader if extraction does not stop at
 * the heading. The boundary is exact and structural: it matches the heading
 * text, not the semantics of the sentences under it, so ordinary article prose
 * is untouched.
 */
const STOP_HEADING_TEXTS = ["what else we're reading about", "what else we’re reading about"];

/** Whether a heading is exactly one of the stop texts, plus optional trailing punctuation. */
function isStopHeading(text: string): boolean {
  const normalized = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  for (const stop of STOP_HEADING_TEXTS) {
    if (normalized === stop) return true;
    if (/^[-:;…!?.]+$/.test(normalized.slice(stop.length).trimStart())) return true;
  }
  return false;
}

/**
 * The index in `html` where the article body ends, or -1 if no stop heading is
 * found. Searches after furniture tags have been stripped, so a matching heading
 * inside `aside`/`footer`/`nav` cannot trigger an early cut.
 */
function stopHeadingIndex(html: string): number {
  const headingRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html)) !== null) {
    if (isStopHeading(match[1] ?? "")) return match.index ?? 0;
  }
  return -1;
}

/**
 * Main body text, one run per block -- never the raw HTML itself.
 *
 * Runs are separated by `STRUCTURAL_BREAK` rather than a space, so a caller can
 * tell one block from the next before whitespace collapsing erases the
 * difference. `selectEvidenceUnits` splits on it; everything else treats it as
 * whitespace.
 */
export function extractMainText(html: string, maxChars = 20_000): string {
  let cleaned = html;
  for (const tag of STRIP_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }

  const stopAt = stopHeadingIndex(cleaned);
  if (stopAt >= 0) cleaned = cleaned.slice(0, stopAt);

  const paragraphs: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = pRe.exec(cleaned)) !== null) {
    const text = stripTags(match[1] ?? "");
    if (text.length < 20) continue; // a caption or a single link, not prose
    paragraphs.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }
  return paragraphs.join(RUN_MARK).slice(0, maxChars).split(RUN_MARK).join(STRUCTURAL_BREAK);
}
