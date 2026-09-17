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

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&hellip;": "…",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

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
