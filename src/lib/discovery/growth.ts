/**
 * Where tomorrow's sources come from: the pure half of catalogue growth.
 *
 * ---------------------------------------------------------------------------
 * The problem this file exists for
 * ---------------------------------------------------------------------------
 *
 * Discovery in this product is demand-driven: a reader follows a topic, the
 * runner searches for pages about it, and a page with a feed becomes a source
 * for that topic. That finds a source when the news needs one. It does not grow
 * the catalogue, because nobody follows a topic called "a Nigerian business
 * daily we do not have yet". Measured 2026-10-30: sources were inserted in two
 * hand-run bursts of ~200 and then at 1-2 a day for nine days in a row, which
 * is the ambient rate of demand discovery and not a floor.
 *
 * So growth needs candidates that were not requested by anybody, and they have
 * to come from somewhere a machine can walk without a search API and without a
 * model. Three walks, all of them deterministic:
 *
 *   outlet indexes   `en.wikipedia.org`'s per-country lists of newspapers --
 *                    one request per country returns hundreds of outlet URLs,
 *                    which is what "country and beat directories" means here.
 *
 *   peer links       a source that is already in the catalogue links out to the
 *                    outlets it reads. Its homepage is one request and its
 *                    outbound hosts are the peers we do not have.
 *
 *   the resolver     `resolveFeed` already turns one candidate page into one
 *                    feed URL with a six-request budget, and it is what the
 *                    demand path uses. Growth reuses it rather than writing a
 *                    second, weaker fetcher.
 *
 * ---------------------------------------------------------------------------
 * What is pure and what is not
 * ---------------------------------------------------------------------------
 *
 * Everything here is a string in, strings out: no fetch, no clock, no database.
 * The network lives in `scripts/source-discover.ts`, because the daily job runs
 * on the operator's machine and the Worker's free-plan CPU budget has no room
 * for a crawl (see docs/decisions/cpu-killed-invocations.md). Being pure is what
 * lets the ranking, the de-duplication and the junk filter be tested against
 * real HTML instead of against a live internet.
 *
 * ---------------------------------------------------------------------------
 * Candidates are cheap, inserts are not
 * ---------------------------------------------------------------------------
 *
 * Over-collecting is safe: a candidate is a URL in a table and costs nothing
 * until something probes it. Under-collecting is what starves the floor. So this
 * module deliberately errs towards keeping a host it cannot classify, and the
 * language gate and the feed probe do the rejecting later, with the reason
 * recorded where the daily report can count it.
 */

/**
 * Hosts that are never an outlet, whatever page they were linked from.
 *
 * Social platforms, video, app stores, search engines, analytics, link
 * shorteners, archives and the platforms that host somebody else's blog. A
 * candidate root of `https://x.com/` is not a source, and probing it costs six
 * requests before the resolver says so.
 */
const JUNK_HOSTS: ReadonlySet<string> = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "t.co",
  "threads.net",
  "bsky.app",
  "mastodon.social",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "tumblr.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
  "weebly.com",
  "wixsite.com",
  "squarespace.com",
  "ghost.io",
  "beehiiv.com",
  "mailchimp.com",
  "list-manage.com",
  "feedburner.com",
  "google.com",
  "google.co.uk",
  "googleusercontent.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "doubleclick.net",
  "gstatic.com",
  "apple.com",
  "itunes.apple.com",
  "apps.apple.com",
  "play.google.com",
  "microsoft.com",
  "amazon.com",
  "amazonaws.com",
  "cloudflare.com",
  "cloudfront.net",
  "akamai.net",
  "fastly.net",
  "wikipedia.org",
  "wikimedia.org",
  "wikidata.org",
  "archive.org",
  "web.archive.org",
  "doi.org",
  "bit.ly",
  "buff.ly",
  "ow.ly",
  "tinyurl.com",
  "paypal.com",
  "stripe.com",
  "patreon.com",
  "spotify.com",
  "soundcloud.com",
  "scribd.com",
  "issuu.com",
  "calameo.com",
  "slideshare.net",
  "addtoany.com",
  "sharethis.com",
  "addthis.com",
  "disqus.com",
  "gravatar.com",
  "wp.com",
  "cdn.jsdelivr.net",
  "jsdelivr.net",
  "unpkg.com",
]);

/**
 * Second-level labels that are part of a country's public suffix.
 *
 * Without these `bbc.co.uk` and `bbc.com` are two outlets, and `news.com.au`
 * and `news.com` are two more. The list is the suffixes the catalogue actually
 * contains; a suffix that is missing shows up as a duplicate insert, which the
 * probe count reports rather than hides.
 */
const TWO_PART_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "co.za",
  "org.za",
  "com.br",
  "com.mx",
  "com.ar",
  "com.co",
  "com.pe",
  "com.ve",
  "com.ec",
  "com.uy",
  "com.py",
  "com.bo",
  "com.cl",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.in",
  "net.in",
  "org.in",
  "com.pk",
  "com.bd",
  "com.ng",
  "org.ng",
  "co.ke",
  "com.gh",
  "co.id",
  "com.tr",
  "com.my",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "com.ph",
  "com.vn",
  "co.th",
  "com.eg",
  "com.sa",
  "com.ua",
  "co.il",
  "com.kw",
  "com.qa",
  "com.om",
  "com.bh",
  "co.ug",
  "co.tz",
  "co.zm",
  "co.zw",
  "com.fj",
  "com.jm",
  "com.tt",
  "co.mu",
  "com.np",
  "com.lk",
  "com.kh",
  "com.mm",
  "com.mt",
  "com.cy",
  "com.gr",
  "com.pl",
  "com.ro",
  "com.ru",
  "com.es",
  "com.pt",
  "com.de",
  "com.fr",
  "com.it",
  "com.nl",
  "com.be",
  "com.se",
  "com.no",
  "com.dk",
  "com.fi",
  "com.ie",
  "com.ch",
  "com.at",
  "com.cz",
  "com.sk",
  "com.hu",
  "com.bg",
  "com.hr",
  "com.rs",
  "com.ba",
  "com.mk",
  "com.al",
  "com.az",
  "com.ge",
  "com.am",
  "com.kz",
  "com.uz",
  "com.kg",
  "com.tj",
  "com.mn",
]);

/**
 * The outlet indexes growth walks, one country per request.
 *
 * `List_of_newspapers_in_X` is the English Wikipedia page that exists for most
 * countries and is a genuine directory: it links the outlet homepages, in one
 * response, in a stable URL shape. Countries are chosen so the daily rotation
 * covers the world's English-language press rather than the anglophone five --
 * English is the language of the Philippines, India, Nigeria, Kenya, Pakistan,
 * Sri Lanka, Singapore, South Africa, Jamaica and Trinidad as much as of the
 * United Kingdom.
 *
 * A country whose page is missing costs one failed request and is skipped; the
 * rotation does not care, because there are more countries than days.
 */
export const GROWTH_COUNTRIES: readonly string[] = [
  "Australia",
  "Austria",
  "Bangladesh",
  "Belgium",
  "Botswana",
  "Brazil",
  "Bulgaria",
  "Cameroon",
  "Canada",
  "Chile",
  "Colombia",
  "Croatia",
  "Cyprus",
  "Czech_Republic",
  "Denmark",
  "Ecuador",
  "Egypt",
  "Estonia",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Germany",
  "Ghana",
  "Greece",
  "Guyana",
  "Hong_Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kenya",
  "Kuwait",
  "Latvia",
  "Lebanon",
  "Lithuania",
  "Malaysia",
  "Malta",
  "Mauritius",
  "Mexico",
  "Morocco",
  "Namibia",
  "Nepal",
  "Netherlands",
  "New_Zealand",
  "Nigeria",
  "Norway",
  "Oman",
  "Pakistan",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Rwanda",
  "Saudi_Arabia",
  "Senegal",
  "Serbia",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "South_Africa",
  "South_Korea",
  "Spain",
  "Sri_Lanka",
  "Sweden",
  "Switzerland",
  "Taiwan",
  "Tanzania",
  "Thailand",
  "Trinidad_and_Tobago",
  "Turkey",
  "Uganda",
  "Ukraine",
  "United_Arab_Emirates",
  "United_Kingdom",
  "United_States",
  "Uruguay",
  "Venezuela",
  "Vietnam",
  "Zambia",
  "Zimbabwe",
];

/**
 * The registrable-ish host a URL belongs to, or null.
 *
 * Not a public-suffix-list implementation: it strips `www.`, lowercases, and
 * keeps the last two labels unless the last two are a country suffix in
 * `TWO_PART_SUFFIXES` (then three). That is enough to answer "is this the same
 * outlet", which is the only question growth asks, and it is stable across the
 * `www`, `m`, `amp` and `edition` subdomains an article URL arrives with.
 */
export function hostKey(rawUrl: string): string | null {
  const host = hostOf(rawUrl);
  if (host === null) return null;
  const labels = host.split(".").filter((label) => label !== "");
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join(".");
  const take = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < take) return null;
  return labels.slice(-take).join(".");
}

/** The lowercased host of an http(s) URL, `www.` stripped, or null. */
export function hostOf(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (host === "" || !host.includes(".")) return null;
  return host;
}

/** Is this host one of the platforms that is never an outlet? */
export function isJunkHost(host: string): boolean {
  const key = hostKey(`https://${host}/`) ?? host;
  if (JUNK_HOSTS.has(key) || JUNK_HOSTS.has(host)) return true;
  // A link to a Facebook page or a Google search is a link to the platform,
  // not to a site the platform happens to host a subdomain of.
  for (const junk of JUNK_HOSTS) {
    if (host === junk || host.endsWith(`.${junk}`)) return true;
  }
  return false;
}

/**
 * Absolute `https://host/` root for a URL, which is what a candidate is.
 *
 * A candidate is a site, not a page: the resolver probes the site's declared
 * feed first and its conventional paths second, and both want the root. Keeping
 * paths would make the same outlet appear once per article that linked to it.
 */
export function siteRoot(rawUrl: string): string | null {
  const host = hostOf(rawUrl);
  if (host === null) return null;
  return `https://${host}/`;
}

/**
 * Every outbound link in an HTML page, as absolute URLs.
 *
 * Both the anchors a reader clicks and the `<link rel="alternate">` hints a CMS
 * declares. Deliberately regex over a parser: the page is only being mined for
 * URLs, the input is attacker-controlled, and a hand-rolled HTML parser in a
 * Worker is a worse liability than a strict regex. Every extracted URL is then
 * validated by `new URL` before it is kept.
 */
export function outboundLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const anchor = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  const alternate = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(anchor)) {
    const href = match[1];
    if (href === undefined) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (absolute !== null) links.push(absolute);
  }

  for (const match of html.matchAll(alternate)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["'][^"']*alternate/i.test(tag)) continue;
    const href = match[1];
    if (href === undefined) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (absolute !== null) links.push(absolute);
  }

  return links;
}

/**
 * The peer outlets a page links to: new sites, as roots, in page order.
 *
 * Excluded: the page's own site (already in the catalogue), anything junk,
 * anything already known, and anything that is not a public http(s) host. What
 * survives is deduplicated by host and capped, so one page cannot flood the
 * pool with its 300-tag archive sidebar.
 */
export function peerSites(input: {
  html: string;
  pageUrl: string;
  knownHosts: ReadonlySet<string>;
  limit?: number;
}): string[] {
  const { html, pageUrl, knownHosts, limit = 40 } = input;
  return newSites(outboundLinks(html, pageUrl), { pageUrl, knownHosts, limit });
}

/**
 * The same filter, for a list of URLs that is not HTML.
 *
 * This is the outlet-index path: Wikipedia's `externallinks` for a country's
 * newspaper page arrives as a JSON array of absolute URLs, and everything after
 * that is the same question as a peer link -- is this a site we do not have?
 */
export function newSites(
  urls: readonly string[],
  options: { pageUrl?: string; knownHosts: ReadonlySet<string>; limit?: number },
): string[] {
  const { pageUrl, knownHosts, limit = 400 } = options;
  const pageHost = pageUrl === undefined ? null : hostOf(pageUrl);
  const pageKey = pageUrl === undefined ? null : hostKey(pageUrl);
  const seen = new Set<string>();
  const sites: string[] = [];

  for (const url of urls) {
    if (sites.length >= limit) break;
    const host = hostOf(url);
    const key = hostKey(url);
    const root = siteRoot(url);
    if (host === null || key === null || root === null) continue;
    if (host === pageHost || key === pageKey) continue;
    if (knownHosts.has(key) || knownHosts.has(host)) continue;
    if (isJunkHost(host)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(root);
  }

  return sites;
}

/**
 * The countries to walk today, rotated by the day number.
 *
 * Deterministic in the day: the same date always walks the same countries, so a
 * re-run of a failed morning re-fetches the same pages (which are then cached or
 * cheap) and reports the same answer instead of a new random sample. Advancing
 * the day moves the window by `perDay`, so every country is visited before the
 * list wraps.
 */
export function countriesForDay(input: {
  dayIndex: number;
  perDay: number;
  countries?: readonly string[];
}): string[] {
  const { dayIndex, perDay } = input;
  const countries = input.countries ?? GROWTH_COUNTRIES;
  if (countries.length === 0 || perDay <= 0) return [];
  const start = (((dayIndex * perDay) % countries.length) + countries.length) % countries.length;
  const picked: string[] = [];
  for (let index = 0; index < Math.min(perDay, countries.length); index += 1) {
    const country = countries[(start + index) % countries.length];
    if (country !== undefined) picked.push(country);
  }
  return picked;
}

/**
 * The English Wikipedia page that lists a country's newspapers.
 *
 * Kept next to the country list rather than in the script so the shape is
 * testable: a page that does not exist answers with an `error` object, and the
 * caller must skip it rather than treat it as a country with no outlets.
 */
export function outletIndexPage(country: string): string {
  return `https://en.wikipedia.org/wiki/List_of_newspapers_in_${country}`;
}

/**
 * The outlet URLs in a Wikipedia `action=parse&prop=externallinks` response.
 *
 * Returns an empty list for an error response (a country page that does not
 * exist), which is the honest answer: no outlets found, not a crash. The caller
 * counts it as a skipped country so an empty index is visible in the report.
 */
export function outletLinksFromIndex(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const parse = (payload as { parse?: unknown }).parse;
  if (typeof parse !== "object" || parse === null) return [];
  const links = (parse as { externallinks?: unknown }).externallinks;
  if (!Array.isArray(links)) return [];
  return links.filter((link): link is string => typeof link === "string");
}

/** Absolute URL for a possibly-relative href, or null when it cannot be one. */
function absoluteUrl(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("javascript:")) return null;
  if (trimmed.startsWith("mailto:") || trimmed.startsWith("tel:") || trimmed.startsWith("data:")) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
