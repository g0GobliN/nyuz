import { describe, expect, it, vi } from "vitest";
import {
  newsPipelineFixture,
  seedPendingNews,
  READER_ID,
  EVENT_ID,
} from "@/lib/test-support/news-pipeline";
import { asDb, type FakeDb } from "@/lib/test-support/fake-db";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Unexpected AI");
  }),
);
vi.mock("@/lib/ai/config", () => ({
  completeRouted: paid,
  completeRoutedJson: paid,
  isDefinitelyUnbilledAiError: () => false,
}));
vi.mock("./guard", () => ({ signedInOnly: {} }));
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
import { generateStory, loadHomeFeed, loadStory, startFirstBriefing } from "./briefing";
const run = async (fn: unknown, db: FakeDb, data?: unknown) => {
  const result = await (fn as (input: unknown) => Promise<unknown>)({
    context: { actor: { id: READER_ID, db: asDb(db) } },
    data,
  });
  // Mirror the database default that FakeDb does not supply on inserts.
  for (const row of db.rows("user_events")) row["matched_at"] ??= new Date().toISOString();
  return result;
};
describe("reader flows never buy background synthesis", () => {
  it("new reader preferences -> first briefing -> deterministic backfill invokes no provider", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    expect(await run(startFirstBriefing, db)).toMatchObject({ analysed: 1, matched: 1 });
    expect(db.rows("events")[0]?.["status"]).toBe("complete");
    expect(paid).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "story metadata prefetch=%s returns content without generation",
    async (prefetch) => {
      const db = newsPipelineFixture();
      seedPendingNews(db);
      await run(startFirstBriefing, db);
      const story = await run(loadStory, db, { id: EVENT_ID, prefetch });
      expect(story).toMatchObject({
        id: EVENT_ID,
        title: "OpenAI releases new model for developers",
      });
      expect(db.rpcCalls.some((c) => c.fn === "claim_shared_story")).toBe(false);
      expect(paid).not.toHaveBeenCalled();
    },
  );
  it("returns paid prose without requiring a database reload after a save outage", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    await run(startFirstBriefing, db);
    db.rpcs["claim_shared_story"] = () => "won";
    db.rpcs["begin_shared_story_attempt"] = () => true;
    db.rpcs["stage_shared_story"] = () => {
      throw new Error("Storage write outage");
    };
    const response = {
      content: JSON.stringify({
        deck: { text: "A supported introduction.", evidence: [1] },
        paragraphs: [{ text: "Source-supported details.", evidence: [1] }],
      }),
    };
    paid.mockImplementationOnce((async (options: {
      beforeProvider: (id: string) => Promise<void>;
    }) => {
      await options.beforeProvider("usage");
      db.hooks.afterSelect = () => {
        throw new Error("No database reload after paid output");
      };
      return response;
    }) as never);
    expect(await run(generateStory, db, { id: EVENT_ID, explicitOpen: true })).toMatchObject({
      status: "generated",
      story: {
        id: EVENT_ID,
        understand: { article: { deck: { text: "A supported introduction." } } },
      },
    });
    expect(paid).toHaveBeenCalledTimes(1);
  });

  it("shows a fresh match instead of a stale skipped-briefing verdict", async () => {
    // user follows a predefined topic, an event is complete with that topic,
    // and it is within the matching freshness window -- the production case
    // traced live: match.ts wrote the user_events row correctly, but the
    // homepage kept showing "nothing matched" because the most recent
    // resolved digest was `skipped` from before this match existed.
    const db = newsPipelineFixture();
    seedPendingNews(db);
    expect(await run(startFirstBriefing, db)).toMatchObject({ analysed: 1, matched: 1 });

    const digestRow = db.rows("digests")[0]!;
    digestRow["status"] = "skipped";
    digestRow["scheduled_for"] = new Date(Date.now() - 24 * 3_600_000).toISOString();
    digestRow["item_count"] = 0;

    const matchRow = db.rows("user_events").find((r) => r["user_id"] === READER_ID)!;
    matchRow["matched_at"] = new Date().toISOString();
    matchRow["briefed_at"] = null;

    const feed = (await run(loadHomeFeed, db)) as {
      stories: { id: string }[];
      source: string;
      digestStatus: string | null;
    };
    expect(feed.source).toBe("matches");
    expect(feed.digestStatus).toBe("skipped");
    expect(feed.stories.map((s) => s.id)).toContain(EVENT_ID);
  });

  it("still shows the quiet-day empty state when nothing matched since the skip", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    await run(startFirstBriefing, db);

    const digestRow = db.rows("digests")[0]!;
    digestRow["status"] = "skipped";
    digestRow["item_count"] = 0;

    const matchRow = db.rows("user_events").find((r) => r["user_id"] === READER_ID)!;
    // Matched before the skipped briefing ran, so it was already considered
    // and correctly found nothing -- not a fresh, un-briefed match.
    matchRow["matched_at"] = new Date(Date.now() - 48 * 3_600_000).toISOString();
    digestRow["scheduled_for"] = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const feed = (await run(loadHomeFeed, db)) as { source: string; stories: unknown[] };
    expect(feed.source).toBe("empty");
    expect(feed.stories).toHaveLength(0);
  });
});
