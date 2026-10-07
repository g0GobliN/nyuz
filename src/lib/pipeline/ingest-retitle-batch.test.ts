/**
 * Audit 49 — ingest retitle batching.
 *
 * Retitles used to cost one `update_retitled_articles` RPC per source per tick:
 * at SCHEDULED_LIMIT=12 that was ~12 subrequests, pushing the normal
 * demand-gated tick from ~43 to ~55 — past the Free Worker's 50-subrequest
 * ceiling, where it died during retitles before bookkeeping. Now every
 * source's already-stored rows go through one tick-level batch
 * (`applyTickRetitles`), normally a single RPC.
 *
 * These tests pin the properties the arbiter's ruling requires:
 *
 *   - one RPC for every source's rows, with the row-level behaviour unchanged
 *     (same payload rows, same SQL guards, same counted total);
 *   - a refused batch fails no source — upserts and bookkeeping already ran,
 *     and the next tick re-offers the same rows;
 *   - dry runs and all-new ticks call no RPC at all;
 *   - a burst still chunks at the payload cap.
 *
 * The RPC handler below emulates `0051_retitle_batch.sql` row for row: match
 * on url, skip attached articles, compare the hash with `is distinct from`
 * semantics, and return the changed count.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeDb } from "@/lib/test-support/fake-db";
import { asDb } from "@/lib/test-support/fake-db";
import { ingest } from "./ingest";

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date();

function rss(items: { title: string; link: string }[]): string {
  const entries = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>${item.link}</link>` +
        `<description>Summary of ${item.title}, with enough detail to be stored.</description>` +
        `<pubDate>${NOW.toUTCString()}</pubDate></item>`,
    )
    .join("");
  return `<rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

/** The SQL guards of `update_retitled_articles`, in TypeScript. */
function emulateRetitles(db: FakeDb) {
  return (a: Record<string, unknown>) => {
    const incoming = a["p_rows"] as {
      url: string;
      title: string;
      excerpt: string | null;
      author: string | null;
      content_hash: string;
    }[];
    let changed = 0;
    for (const row of incoming) {
      const stored = db.rows("articles").find((candidate) => candidate["url"] === row.url);
      if (!stored) continue;
      if (stored["event_id"] !== null && stored["event_id"] !== undefined) continue;
      if (stored["content_hash"] === row.content_hash) continue;
      Object.assign(stored, {
        title: row.title,
        excerpt: row.excerpt,
        author: row.author,
        content_hash: row.content_hash,
      });
      changed++;
    }
    return changed;
  };
}

function setup(
  ids: string[],
  opts: { stored: number; fresh: number; rpc?: (a: Record<string, unknown>) => unknown } = {
    stored: 1,
    fresh: 1,
  },
): FakeDb {
  const db = new FakeDb({
    sources: ids.map((id) => ({
      id,
      name: `Source ${id}`,
      homepage: `https://${id}.example.com`,
      feed_url: `https://${id}.example.com/rss`,
      kind: "news",
      active: true,
      failure_count: 0,
      last_fetched_at: null,
    })),
    articles: ids.flatMap((id) =>
      Array.from({ length: opts.stored }, (_, i) => ({
        source_id: id,
        url: `https://news.example.com/${id}/old-${i}`,
        title: `Old headline ${id}-${i}`,
        author: null,
        excerpt: `Stale excerpt ${id}-${i}.`,
        published_at: NOW.toISOString(),
        content_hash: "stale",
        event_id: null,
      })),
    ),
  });
  db.rpcs["update_retitled_articles"] = opts.rpc ?? emulateRetitles(db);
  vi.stubGlobal("fetch", async (url: unknown) => {
    const id = ids.find((candidate) => String(url).includes(`${candidate}.example.com`));
    if (!id) throw new Error(`unexpected fetch: ${String(url)}`);
    const items = [
      ...Array.from({ length: opts.stored }, (_, i) => ({
        title: `New headline ${id}-${i}`,
        link: `https://news.example.com/${id}/old-${i}`,
      })),
      ...Array.from({ length: opts.fresh }, (_, i) => ({
        title: `Fresh story ${id}-${i}`,
        link: `https://news.example.com/${id}/new-${i}`,
      })),
    ];
    return new Response(rss(items), { headers: { "content-type": "application/rss+xml" } });
  });
  return db;
}

function retitleCalls(db: FakeDb): { fn: string; args: Record<string, unknown> }[] {
  return db.rpcCalls.filter((call) => call.fn === "update_retitled_articles");
}

describe("tick-level retitle batching", () => {
  it("applies every source's retitles in a single RPC", async () => {
    const ids = ["s0", "s1", "s2"];
    const db = setup(ids);
    const report = await ingest(asDb(db), { force: true, now: NOW });

    expect(report.failed).toBe(0);
    expect(report.inserted).toBe(3);
    expect(report.retitled).toBe(3);

    const calls = retitleCalls(db);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args["p_rows"] as unknown[]).toHaveLength(3);

    // Inserts stay attributed per source; the retitle total lives on the report.
    for (const outcome of report.outcomes) {
      expect(outcome.inserted).toBe(1);
      expect(outcome.retitled).toBe(0);
      expect(outcome.state).toBe("ingested");
    }

    // And the rows were really rewritten, not just counted.
    for (const id of ids) {
      const row = db
        .rows("articles")
        .find((candidate) => candidate["url"] === `https://news.example.com/${id}/old-0`);
      expect(row?.["title"]).toBe(`New headline ${id}-0`);
    }
  });

  it("a refused retitle batch fails no source and retries once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const db = setup(["s0", "s1", "s2"], {
        stored: 1,
        fresh: 1,
        rpc: () => new Error("Too many subrequests by single Worker invocation"),
      });
      const report = await ingest(asDb(db), { force: true, now: NOW });

      expect(report.inserted).toBe(3);
      expect(report.retitled).toBe(0);
      expect(report.failed).toBe(0);
      for (const outcome of report.outcomes) expect(outcome.state).toBe("ingested");

      // One batch, one `storage()` retry — not one attempt per source.
      expect(retitleCalls(db)).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("a dry run writes nothing and calls no RPC", async () => {
    const db = setup(["s0", "s1", "s2"]);
    const report = await ingest(asDb(db), { force: true, dryRun: true, now: NOW });

    expect(report.inserted).toBe(6);
    expect(report.retitled).toBe(0);
    expect(db.rows("articles")).toHaveLength(3);
    expect(retitleCalls(db)).toHaveLength(0);
  });

  it("a tick with nothing already stored calls no RPC", async () => {
    const db = setup(["s0", "s1", "s2"], { stored: 0, fresh: 2 });
    const report = await ingest(asDb(db), { force: true, now: NOW });

    expect(report.inserted).toBe(6);
    expect(report.retitled).toBe(0);
    expect(retitleCalls(db)).toHaveLength(0);
  });

  it("chunks a burst across the payload cap", async () => {
    const db = setup(["s0", "s1"], { stored: 300, fresh: 0 });
    const report = await ingest(asDb(db), { force: true, now: NOW });

    expect(report.inserted).toBe(0);
    expect(report.retitled).toBe(600);

    const calls = retitleCalls(db);
    expect(calls).toHaveLength(2);
    expect(
      calls.reduce((total, call) => total + (call.args["p_rows"] as unknown[]).length, 0),
    ).toBe(600);
  });
});
