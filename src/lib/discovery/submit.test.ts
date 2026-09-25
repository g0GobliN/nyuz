import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import type { FeedFetcher } from "./feed";
import { submitSiteSource } from "./submit";

/* ---------------------------------------------------------------------- */
/* Fixtures                                                               */
/* ---------------------------------------------------------------------- */

const NOW = new Date("2026-09-25T12:00:00Z");

const TOPIC = {
  topicId: "t1",
  topicLabel: "Rust programming",
  terms: ["rust", "programming"],
};

const SITE = "https://blog.example.com/";

const PAGE_WITH_FEED = `<!doctype html><html><head><title>Blog</title>
<link rel="alternate" type="application/rss+xml" href="/feed">
</head><body>Rust programming notes</body></html>`;

const PAGE_WITHOUT_FEED = `<!doctype html><html><head><title>Blog</title></head>
<body>Rust programming notes, but no feed declared anywhere</body></html>`;

function rss(title: string, item: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>
<item><title>${item}</title><link>https://blog.example.com/a</link></item></channel></rss>`;
}

type Reply = { ok: true; body: string } | { ok: false; retryable: boolean; reason?: string };

function fakeFetcher(replies: Record<string, Reply>): { fetcher: FeedFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: FeedFetcher = async (url) => {
    calls.push(url);
    const reply = replies[url];
    if (!reply) {
      return { ok: false, status: 404, reason: "HTTP 404 Not Found", retryable: false };
    }
    if (!reply.ok) {
      return {
        ok: false,
        status: null,
        reason: reply.reason ?? "connection reset",
        retryable: reply.retryable,
      };
    }
    return { ok: true, status: 200, finalUrl: url, contentType: "text/html", body: reply.body };
  };
  return { fetcher, calls };
}

function fakeDb(): FakeDb {
  return new FakeDb(
    {
      sources: [],
      source_topics: [],
      source_candidates: [],
      admin_audit_log: [],
    },
    {},
    {},
    { generatedIds: ["sources"] },
  );
}

/* ---------------------------------------------------------------------- */
/* The invariant                                                          */
/* ---------------------------------------------------------------------- */

describe("submitSiteSource — nothing becomes a source without a feed", () => {
  it("refuses a URL that is not a public http address", async () => {
    const db = fakeDb();

    for (const url of ["javascript:alert(1)", "http://127.0.0.1/feed", "not a url"]) {
      const result = await submitSiteSource(asDb(db), { ...TOPIC, url, now: NOW });
      expect(result).toMatchObject({ ok: false, reason: "unusable-url", retryable: false });
    }

    expect(db.rows("sources")).toHaveLength(0);
    expect(db.rows("source_candidates")).toHaveLength(0);
  });

  it("refuses a page that answers 200 and has no feed", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher({ [SITE]: { ok: true, body: PAGE_WITHOUT_FEED } });

    const result = await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: "no-feed", retryable: false });
    expect(db.rows("sources")).toHaveLength(0);
    expect(db.rows("source_topics")).toHaveLength(0);
    // Permanent, so nothing is queued: a dead site must not be probed weekly.
    expect(db.rows("source_candidates")).toHaveLength(0);
  });

  it("refuses a feed that says nothing about the subject", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher({
      "https://gossip.example/feed": { ok: true, body: rss("Daily Star", "Celebrity roundup") },
    });

    const result = await submitSiteSource(asDb(db), {
      ...TOPIC,
      url: "https://gossip.example/feed",
      fetcher,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "not-relevant" });
    expect(db.rows("sources")).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------- */
/* The happy path                                                         */
/* ---------------------------------------------------------------------- */

describe("submitSiteSource — a site that carries a feed", () => {
  const replies = {
    [SITE]: { ok: true as const, body: PAGE_WITH_FEED },
    "https://blog.example.com/feed": {
      ok: true as const,
      body: rss("Rust Blog", "Rust programming in 2026"),
    },
  };

  it("follows the declared link, registers an ordinary source and links the subject", async () => {
    const db = fakeDb();
    const { fetcher, calls } = fakeFetcher(replies);

    const result = await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });

    expect(result.ok).toBe(true);
    // The page first, then the feed it declared. Bounded by resolveFeed.
    expect(calls).toEqual([SITE, "https://blog.example.com/feed"]);

    const created = db.rows("sources")[0];
    expect(created).toMatchObject({
      name: "Rust Blog",
      feed_url: "https://blog.example.com/feed",
      homepage: "https://blog.example.com",
      kind: "rss",
      origin: "discovered",
      listed: false,
      coverage_mode: "demand",
      active: true,
    });

    expect(db.rows("source_topics")).toMatchObject([
      { source_id: created?.["id"], topic_id: "t1", confidence: 0.25 },
    ]);
    expect(db.rows("admin_audit_log")[0]).toMatchObject({
      action: "source.discover.register",
      actor_email: "pipeline:discovery",
    });
    expect(db.rows("source_candidates")).toHaveLength(0);
  });

  it("reuses the existing source when the feed is already collected", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher(replies);

    const first = await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });
    const second = await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(db.rows("sources")).toHaveLength(1);
    expect(db.rows("source_topics")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------- */
/* The retry queue                                                        */
/* ---------------------------------------------------------------------- */

describe("submitSiteSource — the retry queue", () => {
  it("queues a transient failure as a candidate for the next tick", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher({ [SITE]: { ok: false, retryable: true } });

    const result = await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });

    expect(result).toMatchObject({ ok: false, reason: "transient", retryable: true });
    expect(db.rows("source_candidates")[0]).toMatchObject({
      url: SITE,
      method: "reader",
      status: "discovered",
      first_topic_id: "t1",
    });
    expect(db.rows("sources")).toHaveLength(0);
  });

  it("queues the URL when our own write fails, rather than losing the reader's answer", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher(repliesForSite());

    const intact = db as unknown as { from: (table: string) => unknown };
    const broken = {
      from(table: string) {
        if (table === "sources") {
          return {
            select: () => broken.from("sources"),
            eq: () => broken.from("sources"),
            insert: () => broken.from("sources"),
            maybeSingle: async () => ({ data: null, error: null }),
          };
        }
        return intact.from(table);
      },
    };

    const result = await submitSiteSource(broken as never, {
      ...TOPIC,
      url: SITE,
      fetcher,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "storage", retryable: true });
    expect(db.rows("source_candidates")[0]).toMatchObject({ url: SITE, method: "reader" });
  });

  it("does not queue the same URL twice", async () => {
    const db = fakeDb();
    const { fetcher } = fakeFetcher({ [SITE]: { ok: false, retryable: true } });

    await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });
    await submitSiteSource(asDb(db), { ...TOPIC, url: SITE, fetcher, now: NOW });

    expect(db.rows("source_candidates")).toHaveLength(1);
  });
});

function repliesForSite(): Record<string, Reply> {
  return {
    [SITE]: { ok: true, body: PAGE_WITH_FEED },
    "https://blog.example.com/feed": { ok: true, body: rss("Rust Blog", "Rust programming") },
  };
}
