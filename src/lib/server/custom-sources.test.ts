import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";

/**
 * The reader's own sources: adding one, listing them, removing one.
 *
 * ---------------------------------------------------------------------------
 * What is being tested and what is not
 * ---------------------------------------------------------------------------
 *
 * The decisions this module makes in TypeScript, between two queries: which of
 * the three outcomes a follow gets, whether a feed is new or already in the
 * catalogue, and what a stored source row is allowed to claim about itself.
 *
 * Not the conversations with Postgres. `claim_custom_source` and
 * `claim_source_probe` are answers the database owns -- the plan cap, the
 * advisory lock, the probe rate limit -- and they are stubbed here with
 * whatever answer the test needs. Asserting against the stubs would only prove
 * the stub was called; the caps themselves are asserted against the migration
 * text in src/lib/plans-custom-sources.test.ts, and the live check is
 * `npm run verify:v2`.
 *
 * `fetchFeed` and `parseFeed` are mocked too, because a test that reaches the
 * internet is a test that fails for reasons nobody can reproduce.
 */

const fetchFeed = vi.hoisted(() => vi.fn());
const parseFeed = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pipeline/fetch", () => ({ fetchFeed }));
vi.mock("@/lib/pipeline/feed", () => ({ parseFeed }));
vi.mock("./guard", () => ({ signedInOnly: {}, AdminAuthError: class extends Error {} }));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => {
    const builder = {
      middleware: () => builder,
      server: (fn: unknown) => fn,
    };
    return builder;
  },
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));

import { followCustomSource, listCustomSources, unfollowCustomSource } from "./custom-sources";

const READER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";

type FollowOutcome =
  | { ok: true; sourceId: string; name: string; shared: boolean }
  | {
      ok: false;
      reason: string;
      detail: string;
    };

const follow = (db: FakeDb, feedUrl: string): Promise<FollowOutcome> =>
  (followCustomSource as unknown as (input: unknown) => Promise<FollowOutcome>)({
    context: { actor: { id: READER, db: asDb(db) } },
    data: { feedUrl },
  });

const list = (db: FakeDb, id = READER) =>
  (listCustomSources as unknown as (input: unknown) => Promise<unknown>)({
    context: { actor: { id, db: asDb(db) } },
  });

const unfollow = (db: FakeDb, sourceId: string, id = READER) =>
  (unfollowCustomSource as unknown as (input: unknown) => Promise<unknown>)({
    context: { actor: { id, db: asDb(db) } },
    data: { sourceId },
  });

/** A reader on a plan, with `probe`/`claim` answering whatever the test needs. */
function readerDb(options: {
  sources?: Record<string, unknown>[];
  probe?: string;
  claim?: string;
  plan?: "uno" | "plura" | "omni";
}) {
  const db = new FakeDb(
    {
      sources: options.sources ?? [],
      user_custom_sources: [],
      subscriptions: [{ user_id: READER, plan: options.plan ?? "plura" }],
    },
    {
      claim_source_probe: () => options.probe ?? "ok",
      claim_custom_source: () => options.claim ?? "ok",
    },
    {},
    { generatedIds: ["sources"] },
  );
  return db;
}

/** A feed that reads back as a real RSS document, which is all the probe wants. */
function feedParses(title = "Acme Changelog") {
  parseFeed.mockReturnValue({
    format: "rss",
    title,
    items: [{ title: "One", url: "https://acme.test/1" }],
  });
  fetchFeed.mockResolvedValue({ ok: true, body: "<rss/>" });
}

beforeEach(() => {
  fetchFeed.mockReset();
  parseFeed.mockReset();
});

describe("following a feed nyuz already watches", () => {
  it("reuses the catalogue row and never re-fetches it", async () => {
    const db = readerDb({
      sources: [{ id: SOURCE, name: "a16z", feed_url: "https://a16z.com/feed", active: true }],
    });
    feedParses();

    expect(await follow(db, "https://a16z.com/feed")).toEqual({
      ok: true,
      sourceId: SOURCE,
      name: "a16z",
      shared: true,
    });

    // Re-fetching a feed we already watch on every follow would let one reader
    // make the product hammer a publisher.
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(db.rows("sources")).toHaveLength(1);
  });

  it("calls the database claim, because the plan cap lives there", async () => {
    const db = readerDb({
      sources: [{ id: SOURCE, name: "a16z", feed_url: "https://a16z.com/feed", active: true }],
    });

    await follow(db, "https://a16z.com/feed");

    expect(db.rpcCalls).toContainEqual({
      fn: "claim_custom_source",
      args: { p_user_id: READER, p_source_id: SOURCE },
    });
    // Already watched, so there is nothing new to probe and nothing to spend.
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("claim_source_probe");
  });
});

describe("the duplicate-feed regression", () => {
  // `canonicalUrl` drops a trailing slash. The catalogue has held the slashed
  // form since 0006 for 21 of its feeds, and the lookup used to compare the
  // canonical string against the stored column with `eq`. Those are different
  // strings, so the lookup found nothing, the code correctly concluded the feed
  // was new, and a reader adding a feed nyuz already watched got a SECOND row
  // for it -- which `sources.feed_url` UNIQUE cannot catch.
  it("finds a catalogue feed whose stored URL carries a trailing slash", async () => {
    const db = readerDb({
      sources: [{ id: SOURCE, name: "a16z", feed_url: "https://a16z.com/feed/", active: true }],
    });
    feedParses();

    expect(await follow(db, "https://a16z.com/feed/")).toEqual({
      ok: true,
      sourceId: SOURCE,
      name: "a16z",
      shared: true,
    });

    expect(fetchFeed).not.toHaveBeenCalled();
    expect(db.rows("sources")).toHaveLength(1);
  });

  it("finds it in the other direction too: slashed submission, unslashed row", async () => {
    const db = readerDb({
      sources: [{ id: SOURCE, name: "GitHub", feed_url: "https://github.blog/feed", active: true }],
    });
    feedParses();

    expect(await follow(db, "https://github.blog/feed/")).toMatchObject({
      ok: true,
      sourceId: SOURCE,
      shared: true,
    });

    expect(db.rows("sources")).toHaveLength(1);
  });
});

describe("following a feed nyuz does not watch", () => {
  it("proves the feed parses before anything is written", async () => {
    const db = readerDb({});
    feedParses("Acme Changelog");

    const result = await follow(db, "https://acme.test/changelog.xml");

    expect(result).toMatchObject({ ok: true, shared: false, name: "Acme Changelog" });
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed).toHaveBeenCalledWith("https://acme.test/changelog.xml");
  });

  it("stores it shared, demand-covered and private to the readers who asked", async () => {
    const db = readerDb({});
    feedParses();

    const result = (await follow(db, "https://acme.test/changelog.xml")) as {
      ok: true;
      sourceId: string;
    };

    // One global row, not one per reader: that is what makes two readers who
    // want the same feed share one crawler, one clustering pass and one
    // analysis.
    expect(db.rows("sources")).toEqual([
      {
        id: result.sourceId,
        name: "Acme Changelog",
        feed_url: "https://acme.test/changelog.xml",
        homepage: "https://acme.test",
        kind: "rss",
        // Demand coverage by definition: it exists because somebody asked.
        coverage_mode: "demand",
        // Never in another reader's catalogue until somebody promotes it.
        listed: false,
        origin: "user",
      },
    ]);
  });

  it("says an address that is not a feed, rather than failing", async () => {
    // A pasted web page parses as `unknown`; that is the most common mistake
    // and it needs a different sentence from "I could not reach it".
    const db = readerDb({});
    parseFeed.mockReturnValue({ format: "unknown", title: null, items: [] });
    fetchFeed.mockResolvedValue({ ok: true, body: "<html/>" });

    expect(await follow(db, "https://acme.test/blog")).toMatchObject({
      ok: false,
      reason: "not-a-feed",
    });
    expect(db.rows("sources")).toHaveLength(0);
  });

  it("reports an unreachable address as unreachable, and writes nothing", async () => {
    const db = readerDb({});
    fetchFeed.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await follow(db, "https://acme.test/feed.xml")).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(db.rows("sources")).toHaveLength(0);
  });
});

describe("a submitted address is hostile until proven otherwise", () => {
  // This is the one place a stranger's string becomes a fetch() target for a
  // Worker holding the service-role key.
  it.each([
    ["loopback", "http://127.0.0.1/feed.xml"],
    ["localhost", "http://localhost:8080/feed.xml"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["a private network", "http://10.0.0.5/feed.xml"],
    ["a file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
  ])("refuses %s without touching the network", async (_label, feedUrl) => {
    const db = readerDb({});
    feedParses();

    expect(await follow(db, feedUrl)).toMatchObject({ ok: false, reason: "unreachable" });
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(db.rows("sources")).toHaveLength(0);
  });
});

describe("who is allowed to add one", () => {
  it("refuses an Uno reader before spending a probe", async () => {
    // Uno consumes the already-active shared network. Adding a source creates
    // a new crawler, which is the one thing free growth must not be able to do.
    const db = readerDb({ probe: "plan", plan: "uno" });
    feedParses();

    expect(await follow(db, "https://acme.test/feed.xml")).toMatchObject({
      ok: false,
      reason: "limit",
    });
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("reports the probe rate limit as itself, not as a plan limit", async () => {
    // Five new feeds an hour. Five failures in a row told a reader to upgrade
    // when the answer was "try again later".
    const db = readerDb({ probe: "rate" });
    feedParses();

    const result = await follow(db, "https://acme.test/feed.xml");
    expect(result).toMatchObject({ ok: false, reason: "rate" });
    expect(result.ok === false && result.detail).toMatch(/hour/i);
  });

  it("does not follow a feed the database refused to claim", async () => {
    const db = readerDb({ claim: "limit" });
    feedParses();

    expect(await follow(db, "https://acme.test/feed.xml")).toMatchObject({
      ok: false,
      reason: "limit",
    });
  });

  it("treats an existing follow as success rather than an error", async () => {
    // `claim_custom_source` answers 'exists' when the reader already follows
    // it. That is not a failure and must not read like one.
    const db = readerDb({
      sources: [{ id: SOURCE, name: "a16z", feed_url: "https://a16z.com/feed", active: true }],
      claim: "exists",
    });

    expect(await follow(db, "https://a16z.com/feed")).toMatchObject({ ok: true, shared: true });
  });
});

describe("losing the insert race", () => {
  it("follows the row the winner created instead of failing", async () => {
    // Two readers add the same new feed in the same instant. One insert wins,
    // the loser gets 23505 and must re-read the winner's row -- reporting a
    // failure here would tell a reader their feed was not added when it was.
    const winner = {
      id: SOURCE,
      name: "Acme Changelog",
      feed_url: "https://acme.test/changelog.xml",
      active: true,
    };
    const reads: Record<string, unknown[]> = { sources: [] };
    const db = {
      rpc: (fn: string) =>
        Promise.resolve({ data: fn === "claim_source_probe" ? "ok" : "ok", error: null }),
      from: (table: string) => ({
        select: () => ({
          in: () => ({
            then: (resolve: (value: unknown) => void) =>
              resolve({ data: reads[table] ?? [], error: null }),
            maybeSingle: () => Promise.resolve({ data: reads[table]?.[0] ?? null, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            maybeSingle: () => {
              // 23505, and the winner's row is now visible to the re-read.
              reads["sources"] = [winner];
              return Promise.resolve({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              });
            },
          }),
        }),
      }),
    };
    feedParses("Acme Changelog");

    const result = (await (
      followCustomSource as unknown as (input: unknown) => Promise<FollowOutcome>
    )({
      context: { actor: { id: READER, db: db as never } },
      data: { feedUrl: "https://acme.test/changelog.xml" },
    })) as FollowOutcome;

    expect(result).toEqual({ ok: true, sourceId: SOURCE, name: "Acme Changelog", shared: false });
  });
});

describe("the reader's source list", () => {
  it("counts what they follow and reports the plan they are on", async () => {
    const db = readerDb({ plan: "omni" });
    db.rows("user_custom_sources").push({
      user_id: READER,
      source_id: SOURCE,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      sources: {
        name: "Acme Changelog",
        feed_url: "https://acme.test/changelog.xml",
        homepage: "https://acme.test",
        kind: "rss",
        active: true,
        failure_count: 0,
      },
    });

    expect(await list(db)).toMatchObject({
      plan: "omni",
      limit: 15,
      used: 1,
      sources: [{ sourceId: SOURCE, name: "Acme Changelog", healthy: true }],
    });
  });

  it("says a feed that stopped answering, rather than showing it as working", async () => {
    const db = readerDb({});
    db.rows("user_custom_sources").push({
      user_id: READER,
      source_id: SOURCE,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      sources: {
        name: "Dead Changelog",
        feed_url: "https://dead.test/feed.xml",
        homepage: null,
        kind: "rss",
        // Switched off by the ingester.
        active: false,
        failure_count: 9,
      },
    });

    const result = (await list(db)) as { sources: { healthy: boolean }[] };
    expect(result.sources[0]?.healthy).toBe(false);
  });

  it("reports a feed the ingester is backing off from", async () => {
    const db = readerDb({});
    db.rows("user_custom_sources").push({
      user_id: READER,
      source_id: SOURCE,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      sources: {
        name: "Flaky",
        feed_url: "https://flaky.test/feed.xml",
        homepage: null,
        kind: "rss",
        active: true,
        failure_count: 3,
      },
    });

    const result = (await list(db)) as { sources: { healthy: boolean }[] };
    expect(result.sources[0]?.healthy).toBe(false);
  });
});

describe("removing one", () => {
  it("drops only this reader's follow", async () => {
    const db = readerDb({});
    db.rows("user_custom_sources").push(
      { user_id: READER, source_id: SOURCE, active: true, created_at: "2026-01-01T00:00:00Z" },
      { user_id: OTHER, source_id: SOURCE, active: true, created_at: "2026-01-01T00:00:00Z" },
    );

    await unfollow(db, SOURCE);

    expect(db.rows("user_custom_sources")).toEqual([
      { user_id: OTHER, source_id: SOURCE, active: true, created_at: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("leaves the shared source in place", async () => {
    // Articles reference the source, and zero followers is a demand problem
    // (pause collection, with a grace period) rather than a reason to destroy
    // shared history.
    const db = readerDb({
      sources: [{ id: SOURCE, name: "Acme", feed_url: "https://acme.test/feed.xml", active: true }],
    });
    db.rows("user_custom_sources").push({
      user_id: READER,
      source_id: SOURCE,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
    });

    await unfollow(db, SOURCE);

    expect(db.rows("sources")).toHaveLength(1);
  });
});
