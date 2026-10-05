/**
 * Turning the URL a feed gave us into the URL we store.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 *
 * `articles.url` is unique, and that constraint is the whole first line of
 * deduplication. It only works if the same article always produces the same
 * string — and feeds do not cooperate. The same story arrives as
 *
 *   https://example.com/story?utm_source=rss&utm_medium=feed
 *   https://example.com/story/
 *   https://example.com/story/amp/
 *   https://example-com.cdn.ampproject.org/c/s/example.com/story
 *   https://example.com/story#comments
 *
 * — five rows for one article, five clustering candidates, five model calls.
 *
 * ---------------------------------------------------------------------------
 * The rule this follows
 * ---------------------------------------------------------------------------
 *
 * **A canonical URL must still open the article.** It is not only a dedup key;
 * it is the link a reader clicks in their briefing. A rule that merges two rows
 * but sends somebody to a 404 has made the product worse, not better. So every
 * transform below is one of:
 *
 *   - defined by the URL spec as insignificant (case of scheme and host, the
 *     default port), or
 *   - a parameter the publisher added for their own analytics and does not read
 *     back, or
 *   - a documented alternate rendering of the same page (AMP).
 *
 * Two things are deliberately left alone, though stripping them would merge more
 * rows: `www.` and `m.` subdomains. Both are usually the same site and
 * occasionally are the only host that answers, and a dead link costs more than a
 * duplicate row. What the duplicates cost is one extra trigram comparison in
 * stage 3, where two identical titles shortlist against each other and resolve
 * without a model call.
 */

/**
 * Parameters that exist to tell the publisher where a click came from.
 *
 * Removing one cannot change which article is served — that is the test for
 * belonging on this list. Anything that might select content stays.
 */
const TRACKING = new Set([
  // Google Analytics and the wider utm_ convention. Prefix-matched below as
  // well, because publishers invent their own (utm_brand, utm_pubreferrer).
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  // Ad-click identifiers. One per network, all opaque, all ignored by the origin.
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "ttclid",
  "yclid",
  "igshid",
  "igsh",
  "li_fat_id",
  "epik",
  "_openstat",
  // Email and marketing platforms.
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "__hsfp",
  "__hssc",
  "__hstc",
  "hsctatracking",
  "vero_conv",
  "vero_id",
  "oly_anon_id",
  "oly_enc_id",
  // Publisher-side attribution. `ref` and `source` are the ones worth flagging:
  // a handful of sites use them semantically, but on a news article they are
  // always "you came from the RSS feed".
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "source",
  "cmpid",
  "cmp",
  "ncid",
  "ito",
  "smid",
  "smtyp",
  "sr_share",
  "share_source",
  "share_medium",
  "curator",
  "partner",
  "at_medium",
  "at_campaign",
  "at_custom1",
  "at_custom2",
  "at_custom3",
  "at_custom4",
  "spm",
  "scm",
  "__twitter_impression",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  // Matomo/Piwik and Webtrends.
  "pk_campaign",
  "pk_kwd",
  "piwik_campaign",
  "piwik_kwd",
  "matomo_campaign",
  "matomo_kwd",
  "wt_zmc",
  "wt.mc_id",
  "wtrid",
  "s_kwcid",
  "ef_id",
  "trk",
  "trkcampaign",
]);

/** Prefixes covering the vendor-specific variants of the above. */
const TRACKING_PREFIXES = ["utm_", "at_custom", "hsa_", "fb_action_", "action_"];

/**
 * Session parameters with unambiguous names. Removing these is always right —
 * they identify the visitor, never the page.
 */
const SESSIONS = new Set([
  "phpsessid",
  "jsessionid",
  "sessionid",
  "session_id",
  "aspsessionid",
  "cfid",
  "cftoken",
  "zenid",
  "oscsid",
]);

/**
 * Parameter names that are a session id on some sites and a content id on
 * others. `sid=4f8a…` is a session; `sid=1024` is a story. These are removed
 * only when the value looks like a token rather than an identifier.
 */
const AMBIGUOUS_SESSIONS = new Set(["sid", "s", "token", "sessid"]);

/** Long, opaque, and made of token characters — a session, not a story number. */
function looksLikeToken(value: string): boolean {
  return value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** Query parameters asking for the AMP rendering of a page rather than the page. */
const AMP_PARAMS = new Map([
  ["amp", null],
  ["output", "amp"],
  ["outputtype", "amp"],
]);

/**
 * The canonical form of a feed's link, or null if it is not a usable article URL.
 *
 * Null means the caller must drop the item: `articles.url` is `not null`, and a
 * URL this cannot parse is not one a reader could open either.
 */
export function canonicalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // A feed is not allowed to name the scheme. `javascript:`, `data:` and
  // `mailto:` all appear in the wild, usually from a broken template.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;

  const unwrapped = unwrapAmpCache(url) ?? url;
  return format(unwrapped);
}

/**
 * Google's AMP cache serves other people's articles from its own domain:
 *
 *   https://example-com.cdn.ampproject.org/c/s/example.com/story
 *
 * The path carries the real origin, so the original URL can be recovered exactly
 * rather than guessed. `/c/` is a document, `/v/` a video, `/i/` an image; the
 * `s` segment means the origin was https. Without this, an aggregator that links
 * to the cache and a publisher's own feed produce two rows for one article and
 * the reader is sent to a Google URL rather than to the publisher.
 */
function unwrapAmpCache(url: URL): URL | null {
  if (!/(^|\.)cdn\.ampproject\.org$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter((s) => s !== "");
  const kind = segments[0];
  if (kind !== "c" && kind !== "v" && kind !== "i") return null;

  let rest = segments.slice(1);
  let scheme = "http";
  if (rest[0] === "s") {
    scheme = "https";
    rest = rest.slice(1);
  }

  const host = rest[0];
  if (host === undefined || !host.includes(".")) return null;

  try {
    return new URL(`${scheme}://${host}/${rest.slice(1).join("/")}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

function format(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const protocol = url.protocol.toLowerCase();
  const port = isDefaultPort(protocol, url.port) ? "" : `:${url.port}`;

  return `${protocol}//${host}${port}${cleanPath(url.pathname)}${cleanQuery(url.searchParams)}${cleanHash(url.hash)}`;
}

function isDefaultPort(protocol: string, port: string): boolean {
  if (port === "") return true;
  return (protocol === "http:" && port === "80") || (protocol === "https:" && port === "443");
}

/**
 * The path, with AMP suffixes and any `;jsessionid=…` removed and one trailing
 * slash dropped.
 *
 * The trailing slash is the one judgement call here. `/story` and `/story/` are
 * different URLs by the spec and the same page in practice; every server that
 * cares redirects between them, so removing it is safe and merges a real
 * duplicate — feeds routinely disagree with the article's own canonical tag on
 * exactly this character.
 */
function cleanPath(pathname: string): string {
  // Servlet containers put the session in the path, not the query string.
  let path = pathname.replace(/;jsessionid=[^/?]*/i, "");

  path = path
    .replace(/\/amp\/?$/i, "/")
    .replace(/\.amp$/i, "")
    .replace(/\/amp\.html?$/i, "/");

  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/**
 * The query string with tracking, session and AMP parameters removed, and what
 * remains sorted.
 *
 * Sorting is what makes `?b=2&a=1` and `?a=1&b=2` one row. Parameter order is
 * not significant to any server that reads them as a map, which is all of them.
 */
function cleanQuery(params: URLSearchParams): string {
  const kept: [string, string][] = [];

  for (const [name, value] of params) {
    if (!isNoise(name, value)) kept.push([name, value]);
  }

  if (kept.length === 0) return "";

  kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  const search = new URLSearchParams();
  for (const [name, value] of kept) search.append(name, value);
  return `?${search.toString()}`;
}

function isNoise(name: string, value: string): boolean {
  const key = name.toLowerCase();

  if (TRACKING.has(key)) return true;
  if (TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (SESSIONS.has(key) || key.startsWith("aspsessionid")) return true;
  if (AMBIGUOUS_SESSIONS.has(key) && looksLikeToken(value)) return true;

  if (AMP_PARAMS.has(key)) {
    const required = AMP_PARAMS.get(key);
    // `amp` with no value, `amp=1`, `output=amp`. `amp=0` is a publisher
    // explicitly asking for the non-AMP page and is left in place.
    if (required === null) return value === "" || value === "1" || value.toLowerCase() === "true";
    return value.toLowerCase() === required;
  }

  return false;
}

/**
 * Fragments are dropped: `#comments` and `#main` name a position on a page, not
 * a page. The exception is hashbang routing (`#!/story/1` or `#/story/1`), where
 * the fragment is the only thing identifying the article — rare now, still alive
 * in a few older feeds, and merging those would collapse a site to one row.
 */
function cleanHash(hash: string): string {
  const body = hash.replace(/^#/, "");
  if (body === "") return "";
  return body.startsWith("!") || body.startsWith("/") ? `#${body}` : "";
}

/**
 * The forms a stored `sources.feed_url` might take for one feed, canonical first.
 *
 * ---------------------------------------------------------------------------
 * Why a lookup needs more than the canonical string
 * ---------------------------------------------------------------------------
 *
 * `canonicalUrl` drops a trailing slash, and `followCustomSource` looks an
 * existing source up by comparing that canonical form against the stored
 * column. That works only while every stored value is itself canonical — and
 * `sources` is written from three places, one of which (the console's add form,
 * `createSource` in src/lib/server/sources.ts) stored exactly what an operator
 * pasted until 0107 canonicalised the column.
 *
 * So a reader who pasted `https://a16z.com/feed/`, the form the catalogue has
 * held since 0006, got a canonical `https://a16z.com/feed`, found nothing, and
 * created a SECOND row for a feed nyuz already watched. The unique constraint
 * could not catch it: to Postgres those are two different strings. The cost is
 * a second crawler, a second backoff state and a reader following the copy
 * rather than the curated row.
 *
 * Asking for both shapes is what makes the lookup correct whether or not the
 * cleanup migration has run, and whatever order the reader pastes them in.
 * Ordering matters: the canonical row is the one every later stage agrees on,
 * so it wins when a legacy pair somehow coexists.
 *
 * The trailing slash is the only variant. Everything else `canonicalUrl`
 * removes (tracking parameters, AMP suffixes, the default port, a trailing
 * dot on the host) is removed identically by the writer and by this function,
 * so those forms cannot appear in the column in the first place.
 */
export function feedUrlVariants(canonical: string): string[] {
  return [canonical, `${canonical}/`];
}

/* ---------------------------------------------------------------------- */
/* Hashing                                                                */
/* ---------------------------------------------------------------------- */

/**
 * `articles.content_hash` — SHA-256 of the canonical URL and the normalised
 * title, hex encoded.
 *
 * ---------------------------------------------------------------------------
 * What it is actually used for
 * ---------------------------------------------------------------------------
 *
 * Stated plainly, because it would be easy to overclaim: since `articles.url` is
 * unique, a hash over the URL and the title cannot find a duplicate that the
 * unique constraint has not already found. It is not a second dedup key.
 *
 * What it does earn:
 *
 *   1. **Change detection.** On re-reading a feed, an article whose URL is
 *      already stored and whose hash still matches has not changed, and the
 *      ingester skips it without a write. A hash that differs means the
 *      publisher edited the headline — a correction, or a live story being
 *      updated — and the row is worth updating.
 *
 *   2. **A free first pass in stage 3.** Grouping the unclustered articles by
 *      hash costs one index-free scan and removes the pairs that need no
 *      similarity comparison at all before the trigram shortlist runs.
 *
 * Cross-outlet republishing — two sites running identical wire copy under
 * different URLs — is *not* caught here, because the URL is part of the input.
 * That case is what the trigram shortlist in stage 3 is for: two identical
 * titles score 1.0 against each other and resolve without a model call.
 *
 * WebCrypto rather than `node:crypto`: this runs on Workers, where there is no
 * `node:crypto`. `crypto.subtle` is present in both runtimes.
 */
export async function contentHash(canonical: string, title: string): Promise<string> {
  // A newline as the separator, because it cannot appear in either input — a URL
  // percent-encodes it and `normaliseTitle` collapses all whitespace. Without a
  // separator that guarantee fails: url "a" + title "bc" and url "ab" + title
  // "c" would hash the same.
  const input = `${canonical}\n${normaliseTitle(title)}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The form of a title used for hashing only — never for display.
 *
 * Lowercased, whitespace collapsed, and the typographic characters publishers
 * swap silently folded to ASCII: a headline is not a new headline because the
 * CMS turned an apostrophe into a curly one overnight.
 *
 * A trailing outlet name is removed too — " | Ars Technica", " • TechCrunch" —
 * because the same feed emits them inconsistently. Only the pipe and bullet
 * separators, never the hyphen: "GPT-5 ships - what changed" is a headline, and
 * a rule that cut at the last dash would truncate hundreds of them.
 */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[|•]\s*[^|•]{1,40}$/, "")
    .toLowerCase()
    .trim();
}
