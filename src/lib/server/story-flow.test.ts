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
import { composeArticle } from "@/lib/editorial";
import type { Story } from "@/lib/story";
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

describe("Read never depends on a live AI call", () => {
  it("renders a substantial deterministic article when AI is completely unavailable", async () => {
    paid.mockClear();
    const db = newsPipelineFixture();
    seedPendingNews(db);
    db.rows("articles").push({
      id: "a2",
      event_id: EVENT_ID,
      title: "OpenAI releases new model for developers",
      excerpt:
        "OpenAI's new model is available today through the API and ChatGPT, the company said. Pricing starts at $20 per million tokens, a 40% reduction from the prior release, according to the announcement.",
      source_id: "s2",
      sources: { name: "Second Outlet" },
      published_at: new Date().toISOString(),
      url: "https://second.example.com/report",
    });
    await run(startFirstBriefing, db);

    const story = (await run(loadStory, db, { id: EVENT_ID, prefetch: false })) as Story;
    expect(story).toBeTruthy();
    expect(story.understand?.article).toBeUndefined();

    const article = composeArticle(story);
    const words = [article.deck.text, ...article.paragraphs.map((p) => p.text)]
      .join(" ")
      .trim()
      .split(/\s+/).length;

    expect(article.paragraphs.length).toBeGreaterThan(0);
    expect(words).toBeGreaterThanOrEqual(60);
    expect(paid).not.toHaveBeenCalled();
  });

  it("still returns a usable story when the AI provider genuinely fails mid-generation", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    await run(startFirstBriefing, db);
    db.rpcs["claim_shared_story"] = () => "won";
    db.rpcs["begin_shared_story_attempt"] = () => true;
    db.rpcs["fail_shared_story"] = () => true;

    const result = (await run(generateStory, db, {
      id: EVENT_ID,
      explicitOpen: true,
    })) as { status: string; story: Story | null };

    expect(paid).toHaveBeenCalled();
    expect(result.story).toBeTruthy();
    const article = composeArticle(result.story!);
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it("attaches genuinely related prior coverage by shared topic, for background", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    await run(startFirstBriefing, db);

    const priorId = "33333333-3333-4333-8333-333333333333";
    db.rows("events").push({
      id: priorId,
      title: "OpenAI announced its previous model",
      first_seen_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      status: "complete",
      analysed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      classified_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      coverage_revision: 1,
      understand: null,
    });
    db.rows("event_topics").push({ event_id: priorId, topic_id: "t", topics: { label: "OpenAI" } });

    const story = (await run(loadStory, db, { id: EVENT_ID, prefetch: false })) as Story;
    expect(story.relatedEvents?.some((r) => r.id === priorId)).toBe(true);

    const body = composeArticle(story)
      .paragraphs.map((p) => p.text)
      .join(" ");
    expect(body).toContain("OpenAI announced its previous model");
  });

  it("does not attach related coverage when no other event shares a topic", async () => {
    const db = newsPipelineFixture();
    seedPendingNews(db);
    await run(startFirstBriefing, db);

    const story = (await run(loadStory, db, { id: EVENT_ID, prefetch: false })) as Story;
    expect(story.relatedEvents ?? []).toEqual([]);
  });
});
