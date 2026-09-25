/**
 * Turning one search result into one feed URL, with a hard budget.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 * ---------------------------------------------------------------------------
 *
 * A search result is a page somebody's crawler thought was relevant. It is not
 * a source: the pipeline reads feeds, and a site URL is not one. So each
 * candidate gets a bounded investigation for a machine-readable feed --
 * declared in the page's own `<link rel="alternate">`, or at one of the four
 * conventional addresses -- and then the answer is either a feed URL or a
 * refusal.
 *
 * This is deliberately NOT a crawler. There is no recursion, no sitemap walk,
 * no article fetching, no link following beyond the declared feed links, and a
 * hard cap of six HTTP requests per candidate for the entire resolution. A
 * candidate that is a feed URL itself costs one request; the worst case is the
 * six and then it is done, whatever the site looks like.
 *
 * ---------------------------------------------------------------------------
 * Why the probes are safe by construction
 * ---------------------------------------------------------------------------
 *
 * Every request goes through `fetchFeed`, which is the same transport the
 * ingester uses: `isPublicHttpUrl` before the first request and again after
 * EVERY redirect hop, manual redirects capped at five, a 2MB body cap, a
 * fifteen-second timeout, and a named user agent. A page that redirects to
 * 127.0.0.1 is refused at the hop; a page that answers with its entire archive
 * is refused by the size cap. Nothing in this module calls `fetch` directly.
 */

import { canonicalUrl } from "@/lib/pipeline/canonical";
import { attr, parseFeed, type ParsedFeed } from "@/lib/pipeline/feed";
import { fetchFeed, type FeedFetch } from "@/lib/pipeline/fetch";
import { mentions, normaliseText } from "@/lib/topics";

/** Injectable for tests; the real one is the ingester's own transport. */
export type FeedFetcher = (url: string) => Promise<FeedFetch>;

/**
 * Hard ceiling on requests per candidate.
 *
 * One for the candidate page, up to two declared feed links, and the rest of
 * the common paths -- and it stops there whatever happens. This constant is
 * part of the Worker's subrequest arithmetic (see `runner.ts`): a discovery
 * invocation must fit inside the same budget as a cluster run.
 */
export const MAX_FETCHES = 6;

/** Declared `<link rel="alternate">` hints probed before conventional paths. */
const MAX_LINK_PROBES = 2;

/**
 * The addresses that carry a feed on most sites.
 *
 * Conventional rather than exhaustive: these four cover the overwhelming
 * majority of self-hosted and CMS-produced feeds, and a site with its feed
 * somewhere else has almost always declared it in the page head, which is
 * checked first. Adding more paths buys coverage of a long tail at a linear
 * cost in requests; that is a P1 decision, not a P0 one.
 */
export const COMMON_FEED_PATHS = ["/feed", "/feed/", "/rss.xml", "/atom.xml"] as const;

/** The resolved feed, ready to validate and register. */
export type ResolvedFeed = {
  /** Canonicalised. This is what `sources.feed_url` gets. */
  feedUrl: string;
  /** The site the feed belongs to, for `sources.homepage`. */
  homepage: string;
  /** The feed's own title, or null when it did not have one. */
  title: string | null;
  /** First few item titles, for the relevance tripwire. */
  itemTitles: string[];
};

export type FeedResolution =
  | { ok: true; feed: ResolvedFeed }
  | {
      ok: false;
      /** Whether trying again later could succeed. Network → true; no feed → false. */
      retryable: boolean;
      reason: string;
    };

/**
 * Finds the feed behind one candidate URL.
 *
 * Order, cheapest and most explicit first: the URL may already be a feed; the
 * page may declare one; the site may serve one at a conventional address. The
 * moment a request parses as RSS, Atom or RDF, resolution stops -- a real feed
 * at `/feed` does not cost probes at `/rss.xml`.
 */
export async function resolveFeed(
  candidateUrl: string,
  options: { fetcher?: FeedFetcher } = {},
): Promise<FeedResolution> {
  const fetcher = options.fetcher ?? fetchFeed;
  let fetches = 0;
  let transientFailure = false;
  const attempts: string[] = [];

  /** A page that was actually read, narrowed to the two fields that matter. */
  type FeedPage = { body: string; finalUrl: string };

  const attempt = async (url: string): Promise<FeedPage | null> => {
    if (fetches >= MAX_FETCHES) return null;
    fetches += 1;
    const response = await fetcher(url);
    if (!response.ok) {
      if (response.retryable) transientFailure = true;
      attempts.push(`${url}: ${response.reason}`);
      return null;
    }
    return { body: response.body, finalUrl: response.finalUrl || url };
  };

  const first = await attempt(candidateUrl);

  if (!first) {
    // The candidate itself could not be read. Whether the caller may try again
    // is exactly what the transport said about it, hoisted.
    return {
      ok: false,
      retryable: transientFailure,
      reason: attempts[0] ?? "could not read the candidate",
    };
  }

  const direct = parseFeed(first.body);
  if (direct.format !== "unknown") {
    return resolved(first.finalUrl, direct);
  }

  // HTML. The declared feed links come first because a declaration is a
  // publisher's explicit statement about where their feed is.
  const pageUrl = first.finalUrl;
  for (const href of declaredFeedLinks(first.body, pageUrl).slice(0, MAX_LINK_PROBES)) {
    const response = await attempt(href);
    if (!response) continue;
    const parsed = parseFeed(response.body);
    if (parsed.format !== "unknown") return resolved(response.finalUrl, parsed);
    attempts.push(`${href}: not a feed`);
  }

  for (const path of commonFeedCandidates(pageUrl)) {
    const response = await attempt(path);
    if (!response) continue;
    const parsed = parseFeed(response.body);
    if (parsed.format !== "unknown") return resolved(response.finalUrl, parsed);
    attempts.push(`${path}: not a feed`);
  }

  // The page was read. If every probe that could have found a feed answered,
  // the site has none -- that is permanent. If any probe timed out or 5xx'd,
  // one of them might have been the feed, so the answer stays provisional.
  return {
    ok: false,
    retryable: transientFailure,
    reason: transientFailure
      ? attempts.slice(0, 3).join("; ") || "unreachable"
      : "no feed found on the page or at the conventional addresses",
  };
}

function resolved(finalUrl: string, feed: ParsedFeed): FeedResolution {
  const feedUrl = canonicalUrl(finalUrl) ?? finalUrl;
  let homepage = feedUrl;
  try {
    homepage = new URL(feedUrl).origin;
  } catch {
    // `feedUrl` came out of a successful fetch, so this cannot happen; leaving
    // homepage as the feed URL is the harmless answer if it somehow does.
  }

  return {
    ok: true,
    feed: {
      feedUrl,
      homepage,
      title: feed.title,
      itemTitles: feed.items.slice(0, 5).flatMap((item) => (item.title ? [item.title] : [])),
    },
  };
}

/**
 * The `<link rel="alternate" type="…rss/atom/rdf…">` hints in an HTML head,
 * resolved against the page they came from.
 *
 * A regex rather than the `elements` scanner, deliberately: `<link>` is a void
 * element in HTML and has no closing tag, and the XML scanner treats an
 * unclosed element as extending to the end of the document -- which would
 * return the first link and silently miss the rest. The pattern is quote-aware
 * so an attribute value containing `>` cannot truncate the tag.
 *
 * Bounded to the first 200KB: link hints live in the head, and a 2MB page of
 * article text has nothing to add after that.
 */
export function declaredFeedLinks(html: string, baseUrl: string): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  const head = html.slice(0, 200_000);
  const pattern = /<link\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi;
  for (const match of head.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const rel = (attr(attrs, "rel") ?? "").toLowerCase();
    const type = (attr(attrs, "type") ?? "").toLowerCase();
    const href = attr(attrs, "href");
    if (!href || !rel.split(/\s+/).includes("alternate")) continue;
    if (!/(rss|atom|rdf)\+xml/.test(type)) continue;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    resolved.push(absolute);
  }

  return resolved;
}

/** The conventional feed addresses for one page, resolved against its origin. */
export function commonFeedCandidates(pageUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  return COMMON_FEED_PATHS.map((path) => `${origin}${path}`);
}

/**
 * The relevance tripwire: lightweight, one-sided, and biased against saying no.
 *
 * A search result returned for a query that contains the whole interest is
 * already evidence of relevance. This check exists only to catch results that
 * have nothing to do with the subject at all -- and it passes if ANY single
 * term of the interest appears anywhere in the candidate's title or snippet,
 * the feed's own title, or its first few item titles.
 *
 * It deliberately does NOT require the literal interest phrase. The audit
 * walked through why: "Tokyo Jazz Festival Official" is a valid source for
 * "Japanese jazz" and contains neither word in the phrase, and "Rust Blog" is
 * a valid source for "Rust programming" and contains one. Requiring more would
 * reject real sources, and the false-negative cost is higher than the
 * false-positive one: a wrong registration stops being collected on its own
 * through the demand grace period, while a rejected source is invisible.
 *
 * Fail-open when there is nothing to read: a result with no title and no
 * snippet is not evidence of irrelevance, it is absence of evidence, and the
 * provider already matched it to the query.
 */
export function passesRelevanceTripwire(input: {
  terms: string[];
  candidateTitle: string | null;
  snippet: string | null;
  feedTitle: string | null;
  itemTitles: string[];
}): boolean {
  if (input.terms.length === 0) return true;

  const haystack = normaliseText(
    [
      input.candidateTitle ?? "",
      input.snippet ?? "",
      input.feedTitle ?? "",
      ...input.itemTitles,
    ].join(" "),
  );
  if (haystack === "") return true;

  return input.terms.some((term) => mentions(haystack, term));
}

/**
 * Whether a URL looks like it is already a feed.
 *
 * Used to order the work and to explain a result in the console -- never to
 * skip the fetch, because a path is a guess and the body is proof.
 */
export function looksLikeFeedUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /(\.rss|\.xml|\.atom|\/feed\/?|\/rss\/?|\/atom\/?)$/.test(path);
  } catch {
    return false;
  }
}
