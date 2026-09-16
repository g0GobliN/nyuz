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
import { generateStory, loadStory, startFirstBriefing } from "./briefing";
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
});
