/**
 * Turns a short event summary plus feed excerpts into paragraphs a Read page
 * can set as a news column. No extra model call: the excerpts were stored at
 * ingest.
 */

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
    const graf = clipGraf(excerpt);
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
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function nearDuplicate(a: string, b: string): boolean {
  const left = a.slice(0, 80).toLowerCase();
  const right = b.slice(0, 80).toLowerCase();
  return left === right || a.includes(b.slice(0, 60)) || b.includes(a.slice(0, 60));
}
