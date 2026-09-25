import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import type { FeedFetcher } from "./feed";
import { discover, resolveDueCandidates } from "./runner";

/* ---------------------------------------------------------------------- */
/* Fixtures                                                               */
/* ---------------------------------------------------------------------- */

const NOW = new Date("2026-09-25T12:00:00Z");
const PAST = new Date(NOW.getTime() - 60_000).toISOString();

/** A pending job for one topic, as the coverage pass would have left it. */
function job(extra: Record<string, unknown> = {}) {
  return {
    id: "j1",
    topic_id: "t1",
    status: "pending",
    attempt: 0,
    method: null,
    terms: [],
    attempts: [],
    linked_count: 0,
    error: null,
    created_at: PAST,
    started_at: null,
    finished_at: null,
    next_attempt_at: PAST,
    ...extra,
  };
}

function topic(extra: Record<string, unknown> = {}) {
  return {
    id: "t1",
    slug: "rust-programming",
    label: "Rust programming",
    kind: "custom",
    terms: ["rust", "programming"],
    ...extra,
  };
}

function source(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    // The name carries every term of the subject, which is the registry rule:
    // one shared word ("Rust") is a language, a fungus and a game.
    name: "Rust Programming Weekly",
    homepage: "https://rust-programming.example",
    feed_url: "https://rust-programming.example/feed",
    kind: "rss",
    active: true,
    origin: "curated",
    listed: true,
    coverage_mode: "core",
    ...extra,
  };
}

function article(extra: Record<string, unknown> = {}) {
  return {
    id: "a1",
    source_id: "s1",
    title: "Rust programming in 2026",
    excerpt: "The language and its tooling.",
    published_at: PAST,
    fetched_at: PAST,
    ...extra,
  };
}

function rss(title: string, item: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>
<item><title>${item}</title><link>https://example.com/a</link></item></channel></rss>`;
}

function fakeFetcher(replies: Record<string, string>): { fetcher: FeedFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: FeedFetcher = async (url) => {
    calls.push(url);
    const body = replies[url];
    if (body === undefined) {
      return { ok: false, status: 404, reason: "HTTP 404 Not Found", retryable: false };
    }
    return { ok: true, status: 200, finalUrl: url, contentType: "application/xml", body };
  };
  return { fetcher, calls };
}

function db(options: {
  flag?: boolean;
  jobs?: unknown[];
  sources?: unknown[];
  articles?: unknown[];
}) {
  return new FakeDb(
    {
      feature_flags: [{ key: "source_discovery_enabled", enabled: options.flag ?? true }],
      discovery_jobs: (options.jobs ?? [job()]) as Record<string, unknown>[],
      topics: [topic({ created_at: PAST })],
      sources: (options.sources ?? []) as Record<string, unknown>[],
      articles: (options.articles ?? []) as Record<string, unknown>[],
      source_candidates: [],
      source_topics: [],
      user_topics: [],
      admin_audit_log: [],
    },
    {},
    {},
    { generatedIds: ["sources"] },
  );
}

function linksOf(fake: FakeDb): Record<string, unknown>[] {
  return fake.rows("source_topics");
}

/* ---------------------------------------------------------------------- */
/* The flag                                                               */
/* ---------------------------------------------------------------------- */

describe("discover — nothing happens unless it is allowed to", () => {
  it("does no work at all when the flag is off", async () => {
    const fake = db({ flag: false, sources: [source()] });
    const report = await discover(asDb(fake), { now: NOW });

    expect(report.reason).toBe("disabled");
    expect(report.linked).toBe(0);
    expect(linksOf(fake)).toHaveLength(0);
    expect(fake.rows("discovery_jobs")[0]?.["status"]).toBe("pending");
  });

  it("needs no key, and makes no outbound request, to link a source", async () => {
    const fake = db({ sources: [source()] });
    // The transport is a tripwire: a job body must not reach the network at all.
    const spy = vi.fn(async () => {
      throw new Error("a job body must not fetch");
    });

    const report = await discover(asDb(fake), { fetcher: spy as unknown as FeedFetcher, now: NOW });

    expect(report.reason).toBe("ok");
    expect(report.linked).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* The job body                                                           */
/* ---------------------------------------------------------------------- */

describe("discover — a subject with no coverage", () => {
  it("links a source the registry already holds", async () => {
    const fake = db({ sources: [source()] });

    const report = await discover(asDb(fake), { now: NOW });

    expect(linksOf(fake)).toMatchObject([{ source_id: "s1", topic_id: "t1", confidence: 0.3 }]);
    expect(report.linked).toBe(1);
    expect(report.processed).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      topicLabel: "Rust programming",
      decision: "succeeded",
      linked: 1,
      method: "registry",
    });

    // The job records what was asked and what each method made of it.
    expect(fake.rows("discovery_jobs")[0]).toMatchObject({
      status: "succeeded",
      method: "registry",
      terms: ["rust", "programming"],
      linked_count: 1,
      next_attempt_at: null,
    });
    expect(fake.rows("discovery_jobs")[0]?.["attempts"]).toEqual([
      { method: "registry", considered: 1, matched: 1, linked: 1 },
    ]);
  });

  it("falls back to the corpus when no source's own name names the subject", async () => {
    const fake = db({
      sources: [source({ name: "Example News", homepage: "https://example.com" })],
      articles: [article()],
    });

    const report = await discover(asDb(fake), { now: NOW });

    expect(linksOf(fake)).toMatchObject([{ source_id: "s1", topic_id: "t1", confidence: 0.3 }]);
    expect(report.linked).toBe(1);
    expect(fake.rows("discovery_jobs")[0]).toMatchObject({ method: "corpus", linked_count: 1 });
  });

  it("requires every term, so one shared word is not coverage", async () => {
    const fake = db({
      sources: [source({ name: "Example News", homepage: "https://example.com" })],
      articles: [article({ title: "Rust belt towns see investment", excerpt: "Manufacturing." })],
    });

    const report = await discover(asDb(fake), { now: NOW });

    expect(linksOf(fake)).toHaveLength(0);
    expect(report.linked).toBe(0);
  });

  it("finishes as a reason, not a failure, when nothing we hold mentions the subject", async () => {
    const fake = db({});

    const report = await discover(asDb(fake), { now: NOW });

    expect(report.failed).toBe(0);
    expect(report.linked).toBe(0);
    expect(report.outcomes[0]?.detail).toContain("mentions this subject");
    expect(fake.rows("discovery_jobs")[0]).toMatchObject({
      status: "succeeded",
      method: "none",
      linked_count: 0,
      next_attempt_at: null,
    });
  });

  it("counts only links it actually wrote", async () => {
    const fake = db({ sources: [source()] });
    // The subject is already linked to this source: the upsert skips it, and
    // the job must not claim credit for a row that did not change.
    fake.rows("source_topics").push({ source_id: "s1", topic_id: "t1", confidence: 1 });

    const report = await discover(asDb(fake), { now: NOW });

    expect(report.linked).toBe(0);
    expect(linksOf(fake)).toHaveLength(1);
    expect(linksOf(fake)[0]?.["confidence"]).toBe(1);
  });

  it("treats a broken link table as a zero, not as a failed job", async () => {
    const fake = db({ sources: [source()] });
    const explode = () => {
      throw new Error("database on fire");
    };
    const intact = fake as unknown as { from: (table: string) => unknown };
    const broken = {
      from(table: string) {
        if (table === "source_topics") return { select: explode, upsert: explode };
        return intact.from(table);
      },
    };

    const report = await discover(broken as never, { now: NOW });

    // The subject is simply still uncovered -- which is what the next tick and
    // the reader's own "add a site" path are for. A failed write is not a
    // failed job, so nothing is retried and nothing is reported as broken.
    expect(report.failed).toBe(0);
    expect(report.linked).toBe(0);
    expect(fake.rows("discovery_jobs")[0]).toMatchObject({
      status: "succeeded",
      method: "none",
      linked_count: 0,
      next_attempt_at: null,
    });
  });
});

/* ---------------------------------------------------------------------- */
/* The candidate pass — reader-supplied URLs only                          */
/* ---------------------------------------------------------------------- */

describe("discover — candidates", () => {
  function candidate(extra: Record<string, unknown> = {}) {
    return {
      id: "c1",
      url: "https://blog.rust-lang.org/feed",
      title: "Rust Blog",
      method: "reader",
      first_topic_id: "t1",
      status: "discovered",
      probe_attempts: 0,
      retryable: false,
      next_attempt_at: PAST,
      ...extra,
    };
  }

  it("turns a queued URL into an ordinary source linked to the subject", async () => {
    const fake = db({ jobs: [] });
    fake.rows("source_candidates").push(candidate());
    const { fetcher, calls } = fakeFetcher({
      "https://blog.rust-lang.org/feed": rss("Rust Blog", "Announcing Rust 1.99"),
    });

    const report = await discover(asDb(fake), { fetcher, now: NOW });

    expect(calls).toEqual(["https://blog.rust-lang.org/feed"]);
    expect(report.registered).toBe(1);

    const created = fake.rows("sources")[0] as Record<string, unknown> | undefined;
    expect(created).toMatchObject({
      feed_url: "https://blog.rust-lang.org/feed",
      kind: "rss",
      origin: "discovered",
      listed: false,
      coverage_mode: "demand",
      active: true,
    });
    expect(linksOf(fake)).toMatchObject([
      { source_id: created?.["id"], topic_id: "t1", confidence: 0.25 },
    ]);
    expect(fake.rows("source_candidates")[0]).toMatchObject({
      status: "registered",
      resolved_source_id: created?.["id"],
    });
  });

  it("never registers a source for a page that is not a feed", async () => {
    const fake = db({ jobs: [] });
    fake.rows("source_candidates").push(candidate({ url: "https://example.com/rust" }));
    const { fetcher } = fakeFetcher({
      // No <link rel="alternate">, and no feed at the conventional addresses.
      "https://example.com/rust": "<!doctype html><html><body>Rust community</body></html>",
    });

    const report = await resolveDueCandidates(asDb(fake), { limit: 2, fetcher, now: NOW });

    expect(report.registered).toBe(0);
    expect(fake.rows("sources")).toHaveLength(0);
    expect(fake.rows("source_candidates")[0]).toMatchObject({
      status: "rejected",
      retryable: false,
      next_attempt_at: null,
    });
  });

  it("keeps a transient failure in the queue with a later attempt", async () => {
    const fake = db({ jobs: [] });
    fake.rows("source_candidates").push(candidate());
    const fetcher: FeedFetcher = async () => ({
      ok: false,
      status: null,
      reason: "connection reset",
      retryable: true,
    });

    const report = await resolveDueCandidates(asDb(fake), { limit: 2, fetcher, now: NOW });

    expect(report.skipped).toBe(1);
    expect(fake.rows("source_candidates")[0]).toMatchObject({ status: "discovered" });
    expect(fake.rows("source_candidates")[0]?.["probe_attempts"]).toBe(1);
  });
});
