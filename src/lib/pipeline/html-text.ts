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
function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Main body text, joined from `<p>` content -- never the raw HTML itself. */
export function extractMainText(html: string, maxChars = 20_000): string {
  let cleaned = html;
  for (const tag of STRIP_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }

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
  return paragraphs.join(" ").slice(0, maxChars);
}
