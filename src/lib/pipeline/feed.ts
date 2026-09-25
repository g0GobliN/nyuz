/**
 * RSS, Atom and RSS 1.0 parsing, by hand.
 *
 * ---------------------------------------------------------------------------
 * Why hand-written
 * ---------------------------------------------------------------------------
 *
 * The server ships to Cloudflare Workers. There is no `DOMParser`, no
 * `node:stream`, no `xml2js` — the usual feed libraries all reach for one of
 * those. docs/plan.md says so outright: "the parser must be `fetch` plus a string
 * or `DOMParser`-free approach — do not reach for a Node-only RSS library."
 *
 * So this is a scanner over the string. It is not an XML parser and does not try
 * to be: it never validates, never builds a tree, and never throws. Feeds in the
 * wild are broken in every way a document can be broken — unescaped ampersands,
 * mismatched tags, two `<link>` elements meaning different things, HTML in a
 * field documented as plain text, a 404 page served with `content-type:
 * application/rss+xml`. A parser that rejects those loses real articles. This one
 * extracts what it can recognise and drops what it cannot.
 *
 * ---------------------------------------------------------------------------
 * What it recognises
 * ---------------------------------------------------------------------------
 *
 *   RSS 2.0    <rss><channel><item>      title, link, description, pubDate
 *   Atom 1.0   <feed><entry>             title, link[rel=alternate], summary,
 *                                        content, published, updated
 *   RSS 1.0    <rdf:RDF><item>           title, link, description, dc:date
 *
 * Namespace prefixes are ignored — `<dc:creator>` and `<creator>` are the same
 * element to this code, because a feed that declares its namespaces incorrectly
 * is still a feed with an author in it.
 */

/** One entry, reduced to the columns `articles` actually has. */
export type FeedItem = {
  title: string;
  /** Absolute URL. Items without one are dropped: `articles.url` is not null. */
  link: string;
  author: string | null;
  excerpt: string | null;
  /** ISO 8601, or null when the feed gave no parseable date. */
  publishedAt: string | null;
};

export type ParsedFeed = {
  format: "rss" | "atom" | "rdf" | "unknown";
  /** The feed's own title, for telling an operator they subscribed to the wrong thing. */
  title: string | null;
  items: FeedItem[];
  /**
   * Entries that were found and thrown away, and why. Zero items with a nonzero
   * `dropped` is a very different problem from zero items in an empty feed, and
   * the ingester reports them differently.
   */
  dropped: number;
  /**
   * `<skipDays>`, lowercased — the days on which the publisher says it does not
   * publish. Almost nobody sets this, and the ones who do mean it: all five arXiv
   * feeds declare Saturday and Sunday and serve a valid channel with no items at
   * all at the weekend.
   *
   * This is the difference between "this feed is dead" and "it is Sunday", and
   * without it a liveness check run on a Sunday switches off five working feeds.
   * Parsed here rather than in the checker because the ingester wants the same
   * distinction before it counts a failure.
   */
  skipDays: string[];
};

/**
 * Longest excerpt kept. Enough for the clustering model to tell two stories
 * apart, short enough that a thousand articles is not a megabyte of database.
 */
const EXCERPT_LIMIT = 4000;

export function parseFeed(xml: string): ParsedFeed {
  // A UTF-8 BOM, or whitespace before the declaration, stops the format sniff
  // below from matching. Both are common. Written as an escape because the
  // character itself is invisible in an editor and in a diff.
  const source = xml.replace(/^\uFEFF/, "").trimStart();

  const format: ParsedFeed["format"] = /<(?:\w+:)?feed[\s>]/i.test(source)
    ? "atom"
    : /<(?:\w+:)?rss[\s>]/i.test(source)
      ? "rss"
      : /<rdf:RDF[\s>]/i.test(source)
        ? "rdf"
        : "unknown";

  // Entries are collected by element name rather than by walking the document
  // structure, because the structure is exactly what a broken feed gets wrong.
  // RSS 1.0 puts `<item>` beside `<channel>` rather than inside it; some
  // generators nest `<entry>` one level deeper than the spec allows. Searching
  // the whole document for both names finds all of them regardless.
  const raw = [...elements(source, "item"), ...elements(source, "entry")];

  const items: FeedItem[] = [];
  let dropped = 0;

  for (const entry of raw) {
    const item = readItem(entry.inner);
    if (item) items.push(item);
    else dropped += 1;
  }

  return { format, title: feedTitle(source), items, dropped, skipDays: skipDays(source) };
}

/**
 * The days named in `<skipDays>`, lowercased.
 *
 * Only the channel has one, so the search is bounded to the text before the first
 * entry — an `<item>` containing the word "day" in a nested element cannot
 * contribute. Unknown day names are kept as written; the caller compares against
 * a real weekday name and anything else simply never matches.
 */
function skipDays(source: string): string[] {
  const head = source.slice(0, indexOfFirstEntry(source));
  const days: string[] = [];

  for (const block of elements(head, "skipdays")) {
    for (const day of elements(block.inner, "day")) {
      const name = htmlToText(decodeXml(day.inner)).toLowerCase();
      if (name !== "") days.push(name);
    }
  }

  return days;
}

/**
 * The channel's own title, not the first item's.
 *
 * `<title>` appears on the channel and on every entry, and the channel's comes
 * first in every real feed, so the first match is the right one — except in Atom,
 * where an entry can technically precede the feed title. Taking the first title
 * that is not inside an entry would need a tree; taking the first title full stop
 * is right almost always and wrong harmlessly, since this value is shown to an
 * operator and nothing branches on it.
 */
function feedTitle(source: string): string | null {
  const head = source.slice(0, indexOfFirstEntry(source));
  return childText(head, "title");
}

function indexOfFirstEntry(source: string): number {
  const item = source.search(/<(?:\w+:)?item[\s>]/i);
  const entry = source.search(/<(?:\w+:)?entry[\s>]/i);
  const found = [item, entry].filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : source.length;
}

/* ---------------------------------------------------------------------- */
/* One entry                                                              */
/* ---------------------------------------------------------------------- */

function readItem(inner: string): FeedItem | null {
  const title = childText(inner, "title");
  const link = itemLink(inner);

  // Both are load-bearing. `articles.url` is the unique key the whole
  // deduplication story rests on, and an untitled article cannot be clustered,
  // scored or shown. An entry missing either is not salvageable.
  if (!link || !title) return null;

  const body =
    childText(inner, "encoded") ?? // content:encoded, the full post
    childText(inner, "content") ?? // Atom
    childText(inner, "summary") ?? // Atom
    childText(inner, "description"); // RSS

  return {
    title: clamp(title, 400),
    link,
    author: itemAuthor(inner),
    excerpt: body ? clamp(body, EXCERPT_LIMIT) : null,
    publishedAt: itemDate(inner),
  };
}

/**
 * The entry's canonical URL.
 *
 * RSS puts it in `<link>` as text. Atom puts it in a `href` attribute and may
 * carry several: `rel="alternate"` is the article, `rel="self"` is the feed,
 * `rel="replies"` is a comment thread, `rel="enclosure"` is a podcast file.
 * Picking the first `<link>` blindly subscribes half of Blogger to its own
 * comment feeds, so rel is checked before falling back.
 */
function itemLink(inner: string): string | null {
  const links = [...elements(inner, "link")];

  for (const link of links) {
    const rel = attr(link.attrs, "rel");
    const href = attr(link.attrs, "href");
    if (href && (rel === null || rel.toLowerCase() === "alternate")) {
      const absolute = asHttpUrl(href);
      if (absolute) return absolute;
    }
  }

  for (const link of links) {
    const text = asHttpUrl(decodeXml(link.inner).trim());
    if (text) return text;
  }

  // Atom's `<id>` is a URI and is usually the article's URL; RSS's `<guid>` is
  // one whenever `isPermaLink` is not false. Both are a better answer than
  // dropping the entry.
  for (const name of ["id", "guid"] as const) {
    const value = childText(inner, name);
    const absolute = value ? asHttpUrl(value) : null;
    if (absolute) return absolute;
  }

  return null;
}

function itemAuthor(inner: string): string | null {
  // Atom nests it: <author><name>…</name></author>. RSS puts an email address in
  // <author> and a human name in <dc:creator>, so the creator is preferred.
  for (const author of elements(inner, "author")) {
    const name = childText(author.inner, "name");
    if (name) return clamp(name, 120);
  }

  const creator = childText(inner, "creator") ?? childText(inner, "author");
  if (!creator) return null;

  // "editor@example.com (Jane Doe)" is the RSS convention for an author field.
  const named = /^\s*\S+@\S+\s*\((.+)\)\s*$/.exec(creator);
  return clamp(named?.[1] ?? creator, 120);
}

function itemDate(inner: string): string | null {
  for (const name of ["pubDate", "published", "date", "updated", "modified"] as const) {
    const raw = childText(inner, name);
    const iso = raw ? toIso(raw) : null;
    if (iso) return iso;
  }
  return null;
}

/**
 * A date string to ISO 8601, or null.
 *
 * RFC 822 (`Tue, 12 Aug 2026 09:00:00 GMT`) and ISO 8601 both parse natively.
 * What does not is a named zone other than GMT/UT/Z — `EST`, `PDT` — which V8
 * rejects outright, so those are mapped to a numeric offset first. Feeds also
 * emit dates decades in the future through simple typos; anything more than two
 * days ahead is treated as unparseable rather than allowed to sit at the top of
 * every reader's briefing forever.
 */
export function toIso(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;

  const candidates = [text, text.replace(NAMED_ZONE, (_, zone: string) => ZONES[zone] ?? "")];

  for (const candidate of candidates) {
    const date = new Date(candidate);
    const time = date.getTime();
    if (Number.isNaN(time)) continue;
    if (time > Date.now() + 2 * 24 * 60 * 60 * 1000) return null;
    // Nothing in this product predates the web. A 1970 date means a zero
    // timestamp was formatted, not that the article is from 1970.
    if (date.getUTCFullYear() < 1990) return null;
    return date.toISOString();
  }

  return null;
}

const NAMED_ZONE = /\s+\(?([A-Z]{2,5})\)?\s*$/;

/** The zones V8 will not take. GMT, UT and Z parse natively and are absent. */
const ZONES: Record<string, string> = {
  EST: "-0500",
  EDT: "-0400",
  CST: "-0600",
  CDT: "-0500",
  MST: "-0700",
  MDT: "-0600",
  PST: "-0800",
  PDT: "-0700",
  CET: "+0100",
  CEST: "+0200",
  BST: "+0100",
  IST: "+0530",
  JST: "+0900",
  AEST: "+1000",
};

/** Keeps only absolute http(s) URLs — a feed is not allowed to name a scheme. */
function asHttpUrl(value: string): string | null {
  if (value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------- */
/* The scanner                                                            */
/* ---------------------------------------------------------------------- */

export type Element = { attrs: string; inner: string };

/**
 * Every `<name>…</name>` in the string, ignoring any namespace prefix.
 *
 * Nesting of the same element is counted, so `<content>` containing a literal
 * `<content>` closes in the right place. CDATA and comments are skipped while
 * scanning, because `<![CDATA[</item>]]>` is text and not a closing tag — which
 * is exactly the kind of thing that makes a regex-only implementation lose the
 * second half of a feed.
 */
export function* elements(xml: string, name: string): Generator<Element> {
  const wanted = name.toLowerCase();
  let i = 0;

  while (i < xml.length) {
    const open = findTag(xml, i, wanted);
    if (!open) return;

    if (open.selfClosing) {
      yield { attrs: open.attrs, inner: "" };
      i = open.end;
      continue;
    }

    const close = findClose(xml, open.end, wanted);
    yield { attrs: open.attrs, inner: xml.slice(open.end, close.start) };
    i = close.end;
  }
}

type OpenTag = { attrs: string; end: number; selfClosing: boolean };

function findTag(xml: string, from: number, wanted: string): OpenTag | null {
  let i = from;

  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) return null;

    const skipped = skipNonElement(xml, lt);
    if (skipped !== null) {
      i = skipped;
      continue;
    }

    // `</…` is a closing tag; nothing to open here.
    if (xml[lt + 1] === "/") {
      i = lt + 2;
      continue;
    }

    const nameEnd = scanName(xml, lt + 1);
    const tagName = localName(xml.slice(lt + 1, nameEnd));
    const gt = findTagEnd(xml, nameEnd);
    if (gt === -1) return null;

    if (tagName === wanted) {
      const attrs = xml.slice(nameEnd, gt);
      return { attrs, end: gt + 1, selfClosing: xml[gt - 1] === "/" };
    }

    i = gt + 1;
  }

  return null;
}

/** Position of the matching close tag, counting nested opens of the same name. */
function findClose(xml: string, from: number, wanted: string): { start: number; end: number } {
  let depth = 0;
  let i = from;

  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;

    const skipped = skipNonElement(xml, lt);
    if (skipped !== null) {
      i = skipped;
      continue;
    }

    const closing = xml[lt + 1] === "/";
    const nameStart = closing ? lt + 2 : lt + 1;
    const nameEnd = scanName(xml, nameStart);
    const tagName = localName(xml.slice(nameStart, nameEnd));
    const gt = findTagEnd(xml, nameEnd);
    if (gt === -1) break;

    if (tagName === wanted) {
      if (closing) {
        if (depth === 0) return { start: lt, end: gt + 1 };
        depth -= 1;
      } else if (xml[gt - 1] !== "/") {
        depth += 1;
      }
    }

    i = gt + 1;
  }

  // Unterminated element. Treating the rest of the document as its content is
  // what browsers do, and it recovers the last item of a truncated feed.
  return { start: xml.length, end: xml.length };
}

/**
 * If `<` at this position begins a comment, CDATA block, processing instruction
 * or doctype, the index just past it. Otherwise null.
 */
function skipNonElement(xml: string, lt: number): number | null {
  if (xml.startsWith("<!--", lt)) {
    const end = xml.indexOf("-->", lt + 4);
    return end === -1 ? xml.length : end + 3;
  }
  if (xml.startsWith("<![CDATA[", lt)) {
    const end = xml.indexOf("]]>", lt + 9);
    return end === -1 ? xml.length : end + 3;
  }
  if (xml.startsWith("<?", lt)) {
    const end = xml.indexOf("?>", lt + 2);
    return end === -1 ? xml.length : end + 2;
  }
  if (xml.startsWith("<!", lt)) {
    const end = xml.indexOf(">", lt + 2);
    return end === -1 ? xml.length : end + 1;
  }
  return null;
}

function scanName(xml: string, from: number): number {
  let i = from;
  while (i < xml.length && !/[\s/>]/.test(xml[i] ?? ">")) i += 1;
  return i;
}

/** Index of the `>` closing this tag, stepping over quoted attribute values. */
function findTagEnd(xml: string, from: number): number {
  let i = from;
  let quote: string | null = null;

  while (i < xml.length) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
    i += 1;
  }
  return -1;
}

function localName(raw: string): string {
  const colon = raw.lastIndexOf(":");
  return (colon === -1 ? raw : raw.slice(colon + 1)).toLowerCase();
}

/** An attribute value, quoted or bare. */
export function attr(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const match = pattern.exec(attrs);
  if (!match) return null;
  const value = match[2] ?? match[3] ?? match[4];
  return value === undefined ? null : decodeXml(value);
}

/**
 * The text of the first child element with this name, as plain text.
 *
 * Two rounds of decoding, deliberately. The XML layer escapes the field's
 * contents, and the contents are very often HTML which was itself escaped — so a
 * title published as `Tom &amp;amp; Jerry` is `Tom &amp; Jerry` after the XML
 * layer and `Tom & Jerry` after the HTML one. Decoding once leaves visible
 * `&amp;` in a headline, which is the more common failure by a wide margin. The
 * cost is that a publisher who really did want to display `&amp;` literally gets
 * `&`; no news headline has ever wanted that.
 */
export function childText(xml: string, name: string): string | null {
  for (const element of elements(xml, name)) {
    const text = htmlToText(decodeXml(element.inner));
    if (text !== "") return text;
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* Text                                                                   */
/* ---------------------------------------------------------------------- */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ccedil: "ç",
  deg: "°",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
};

/**
 * Unwraps CDATA and resolves entity references. One pass — an unknown entity is
 * left exactly as written rather than mangled, because `&foo;` in a headline is
 * more likely to be text than a mistake.
 */
export function decodeXml(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1");

  return withoutCdata.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED[body.toLowerCase()] ?? whole;
    },
  );
}

/**
 * HTML to a single line of readable text, with one sentence per block.
 *
 * Script and style bodies are dropped entirely — a few feeds inline tracking
 * pixels and analytics into the description, and none of that is prose.
 *
 * ---------------------------------------------------------------------------
 * Why a block boundary is a sentence boundary
 * ---------------------------------------------------------------------------
 *
 * A block boundary used to become a bare space, which is what glued a source's
 * headings to its prose. "What to Expect from the Introduction Track" and the
 * paragraph after it arrived at the composer as one sentence, with the label
 * indistinguishable from the body, and no rule downstream can separate them: a
 * plain-text excerpt does not say which words were a heading, and the splitter
 * that guessed cut a real subject out of a real sentence.
 *
 * Closing a heading element was the first half of the fix. It is only half,
 * because a heading does not have to be an `<h1>`-`<h6>`: publishers write it as a
 * bold line in its own paragraph, as its own `<div>`, or as a line after a `<br>`,
 * and every one of those marks a block boundary just as clearly. So the rule is
 * the boundary itself: when a block ends without terminal punctuation and the next
 * block begins with a capital, the boundary closes the sentence. That is what
 * makes the heading its own unit — which the furniture filters then refuse, and
 * the prose after it a sentence the composer can read.
 *
 * Deliberately not a per-tag rule: a tag list is a list of the ways publishers
 * have already been seen to do it, and the next one is not on it. A boundary that
 * is followed by a lowercase word is left as a join ("He said / that it would
 * pass." is one sentence a publisher split across two paragraphs), and one that
 * already ends in punctuation is left alone rather than doubled.
 */
export function htmlToText(html: string): string {
  const text = decodeXml(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, BLOCK_BREAK)
      // A heading element always ends its unit, whatever follows it.
      .replace(/<\/h[1-6]\s*>/gi, `.${BLOCK_BREAK}`)
      .replace(
        /<\/(p|div|li|tr|blockquote|section|article|header|footer|figure)\s*>/gi,
        BLOCK_BREAK,
      )
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return joinBlocks(text).trim();
}

/**
 * A character no feed text contains, standing in for "a block ended here".
 *
 * It has to survive tag stripping and whitespace collapsing, which is why it is
 * not a space or a sentinel made of punctuation.
 */
const BLOCK_BREAK = "\u0000";

/** Punctuation that already closed the sentence, so the boundary adds nothing. */
const ALREADY_CLOSED = /[.!?…:;,"“”‘’)\]»]$/;

/**
 * Turn each block boundary into a sentence boundary, or into a plain space.
 *
 * A boundary whose text is empty disappears; one whose text already ends in
 * punctuation keeps the single space; one followed by a lowercase word keeps the
 * join, because a publisher that split mid-sentence meant it as one sentence.
 * Everything else ends the sentence, so the next block starts as its own unit.
 */
function joinBlocks(text: string): string {
  return text.replace(
    new RegExp(`\\s*${BLOCK_BREAK}\\s*`, "g"),
    (match: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      if (before.trim() === "") return "";
      if (ALREADY_CLOSED.test(before)) return " ";
      if (!/^[A-Z]/.test(after)) return " ";
      return ". ";
    },
  );
}

/** Truncates on a word boundary and marks it, so nothing reads as complete when it is not. */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
