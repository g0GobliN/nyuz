import { describe, expect, it } from "vitest";
import {
  commonFeedCandidates,
  COMMON_FEED_PATHS,
  declaredFeedLinks,
  MAX_FETCHES,
  passesRelevanceTripwire,
  resolveFeed,
  type FeedFetcher,
} from "./feed";

/* ---------------------------------------------------------------------- */
/* Feeds, as the parser sees them                                         */
/* ---------------------------------------------------------------------- */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Rust Blog</title>
<item><title>Announcing Rust 1.99</title><link>https://blog.rust-lang.org/1.99</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Tokyo Jazz Festival</title>
<entry><title>Lineup announced</title><link rel="alternate" href="https://jazz.example.jp/lineup"/></entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
<channel><title>Arsenal News</title></channel>
<item><title>Match report</title><link>https://arsenal.example/report</link></item>
</rdf:RDF>`;

const HTML_WITH_LINK = `<!doctype html><html><head>
<title>Example</title>
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" title="Feed" href="/feed.xml">
</head><body>Article</body></html>`;

const HTML_NO_FEED = `<!doctype html><html><head><title>Example</title></head><body>Nothing here</body></html>`;

/* ---------------------------------------------------------------------- */
/* A fetcher that is a map                                                */
/* ---------------------------------------------------------------------- */

type Reply =
  | { ok: true; body: string; finalUrl?: string }
  | { ok: false; retryable: boolean; reason?: string };

function fakeFetcher(replies: Record<string, Reply>): { fetcher: FeedFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const reply = replies[url];
    if (!reply) {
      return { ok: false as const, status: 404, reason: "HTTP 404 Not Found", retryable: false };
    }
    if (!reply.ok) {
      return {
        ok: false as const,
        status: null,
        reason: reply.reason ?? "network failure",
        retryable: reply.retryable,
      };
    }
    return {
      ok: true as const,
      status: 200,
      finalUrl: reply.finalUrl ?? url,
      contentType: "application/xml",
      body: reply.body,
    };
  };
  return { fetcher: fetcher as FeedFetcher, calls };
}

/* ---------------------------------------------------------------------- */

describe("resolveFeed — a candidate that is already a feed", () => {
  it("accepts RSS in one request", async () => {
    const { fetcher, calls } = fakeFetcher({
      "https://blog.rust-lang.org/feed": { ok: true, body: RSS },
    });
    const result = await resolveFeed("https://blog.rust-lang.org/feed", { fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.feedUrl).toBe("https://blog.rust-lang.org/feed");
    expect(result.feed.title).toBe("Rust Blog");
    expect(result.feed.itemTitles).toContain("Announcing Rust 1.99");
    expect(calls).toHaveLength(1);
  });

  it("accepts Atom", async () => {
    const { fetcher } = fakeFetcher({
      "https://jazz.example.jp/atom.xml": { ok: true, body: ATOM },
    });
    const result = await resolveFeed("https://jazz.example.jp/atom.xml", { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.title).toBe("Tokyo Jazz Festival");
  });

  it("accepts RSS 1.0 (RDF)", async () => {
    const { fetcher } = fakeFetcher({ "https://arsenal.example/rdf": { ok: true, body: RDF } });
    const result = await resolveFeed("https://arsenal.example/rdf", { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.title).toBe("Arsenal News");
  });

  it("uses the URL the transport actually landed on, after redirects", async () => {
    const { fetcher } = fakeFetcher({
      "https://example.com/old-feed": {
        ok: true,
        body: RSS,
        finalUrl: "https://example.com/new-feed",
      },
    });
    const result = await resolveFeed("https://example.com/old-feed", { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.feedUrl).toBe("https://example.com/new-feed");
  });
});

describe("resolveFeed — a site URL", () => {
  it("follows the page's own declared feed link", async () => {
    const { fetcher, calls } = fakeFetcher({
      "https://example.com/post": { ok: true, body: HTML_WITH_LINK },
      "https://example.com/feed.xml": { ok: true, body: RSS },
    });
    const result = await resolveFeed("https://example.com/post", { fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.feedUrl).toBe("https://example.com/feed.xml");
    expect(calls).toEqual(["https://example.com/post", "https://example.com/feed.xml"]);
  });

  it("falls back to the conventional addresses, in order", async () => {
    const { fetcher, calls } = fakeFetcher({
      "https://example.com/post": { ok: true, body: HTML_NO_FEED },
      "https://example.com/feed": { ok: true, body: RSS },
    });
    const result = await resolveFeed("https://example.com/post", { fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.feed.feedUrl).toBe("https://example.com/feed");
    expect(calls).toEqual(["https://example.com/post", "https://example.com/feed"]);
  });

  it("refuses permanently when the page exists and has no feed", async () => {
    const { fetcher, calls } = fakeFetcher({
      "https://example.com/post": { ok: true, body: HTML_NO_FEED },
    });
    const result = await resolveFeed("https://example.com/post", { fetcher });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain("no feed");
    expect(calls).toHaveLength(1 + COMMON_FEED_PATHS.length);
  });

  it("stays provisional when a probe failed transiently", async () => {
    const { fetcher } = fakeFetcher({
      "https://example.com/post": { ok: true, body: HTML_NO_FEED },
      "https://example.com/feed": { ok: false, retryable: true, reason: "timeout" },
    });
    const result = await resolveFeed("https://example.com/post", { fetcher });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
  });

  it("never exceeds the fetch budget, whatever the site returns", async () => {
    const declared = `<!doctype html><html><head>
<link rel="alternate" type="application/rss+xml" href="/a.xml">
<link rel="alternate" type="application/atom+xml" href="/b.xml">
<link rel="alternate" type="application/rss+xml" href="/c.xml">
</head><body>${"x".repeat(50)}</body></html>`;

    const replies: Record<string, Reply> = {
      "https://example.com/post": { ok: true, body: declared },
    };
    for (const path of ["/a.xml", "/b.xml", "/c.xml", ...COMMON_FEED_PATHS]) {
      replies[`https://example.com${path}`] = { ok: true, body: HTML_NO_FEED };
    }

    const { fetcher, calls } = fakeFetcher(replies);
    const result = await resolveFeed("https://example.com/post", { fetcher });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(MAX_FETCHES);
  });
});

describe("resolveFeed — transport failures", () => {
  it("reports a 404 as permanent", async () => {
    const { fetcher } = fakeFetcher({});
    const result = await resolveFeed("https://example.com/gone", { fetcher });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
  });

  it("reports a network failure as retryable", async () => {
    const { fetcher } = fakeFetcher({
      "https://example.com/post": { ok: false, retryable: true, reason: "connection reset" },
    });
    const result = await resolveFeed("https://example.com/post", { fetcher });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
  });
});

describe("declaredFeedLinks", () => {
  it("keeps only alternate feed hints, resolved against the page", () => {
    const links = declaredFeedLinks(HTML_WITH_LINK, "https://example.com/post");
    expect(links).toEqual(["https://example.com/feed.xml"]);
  });

  it("ignores a stylesheet, a wrong type and a duplicate", () => {
    const html = `<link rel="stylesheet" type="text/css" href="/s.css">
<link rel="alternate" type="text/html" href="/index.html">
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
<link rel="alternate" type="application/rss+xml" href="/feed.xml">`;
    expect(declaredFeedLinks(html, "https://example.com/")).toEqual([
      "https://example.com/feed.xml",
    ]);
  });
});

describe("commonFeedCandidates", () => {
  it("builds the conventional addresses from the page's origin", () => {
    expect(commonFeedCandidates("https://example.com/deep/post?x=1")).toEqual(
      COMMON_FEED_PATHS.map((path) => `https://example.com${path}`),
    );
  });

  it("returns nothing for an unusable URL rather than guessing", () => {
    expect(commonFeedCandidates("not a url")).toEqual([]);
  });
});

describe("passesRelevanceTripwire", () => {
  const base = { candidateTitle: null, snippet: null, feedTitle: null, itemTitles: [] };

  it("passes when any single term appears anywhere", () => {
    // "Tokyo Jazz Festival Official" contains neither word of the phrase
    // "Japanese jazz" in the phrase sense -- one term is enough.
    expect(
      passesRelevanceTripwire({
        ...base,
        terms: ["japanese", "jazz"],
        feedTitle: "Tokyo Jazz Festival Official",
      }),
    ).toBe(true);

    expect(
      passesRelevanceTripwire({ ...base, terms: ["rust", "programming"], feedTitle: "Rust Blog" }),
    ).toBe(true);
  });

  it("passes on an item title when the feed title says nothing", () => {
    expect(
      passesRelevanceTripwire({
        ...base,
        terms: ["arsenal"],
        itemTitles: ["Arsenal 2-1 Chelsea"],
      }),
    ).toBe(true);
  });

  it("refuses a result with nothing to do with the subject", () => {
    expect(
      passesRelevanceTripwire({
        ...base,
        terms: ["arsenal"],
        candidateTitle: "Celebrity gossip roundup",
        feedTitle: "Daily Star",
      }),
    ).toBe(false);
  });

  it("fails open when there is nothing to read", () => {
    expect(passesRelevanceTripwire({ ...base, terms: ["arsenal"] })).toBe(true);
    expect(passesRelevanceTripwire({ ...base, terms: [] })).toBe(true);
  });
});
