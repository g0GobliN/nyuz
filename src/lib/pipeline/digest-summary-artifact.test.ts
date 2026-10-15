import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";
import { deliveredSummary } from "@/lib/reader-summary";

/**
 * The composed half of the arbiter's 2026-10-15 ruling, at the point the
 * pipeline writes the item.
 *
 * The ruling's contract is that a summary line failing validation is withheld
 * rather than replaced by the raw feed description, and that the line the reader
 * receives is *composed* through the product's existing composition path at build
 * time and stored with the revision it came from. Before this slice the build
 * stored no summary at all -- `digest_items` had none -- so every surface printed
 * the raw description through a read-time join, and a line the delivery boundary
 * refused left the reader with nothing.
 *
 * What these tests pin, in that order:
 *   1. a refused stored line makes the build compose and store a valid one;
 *   2. the artifact is stored with its provenance, in the same statement;
 *   3. a line nobody objected to is not composed for, and not replaced -- the
 *      slice cannot change what a reader sees for a line that passed;
 *   4. nothing here calls a model: the composition is deterministic prose.
 */

const NOW = new Date("2026-10-15T06:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

/** A delivered line the boundary refuses: the unresolved-context class, verbatim. */
const REFUSED_RAW =
  "Explore more than 20 announcements from OpenAI DevDay 2026 and see what we are building next.";

const COVERAGE =
  "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page. The lab said the model is available to existing customers today.";

/** The event's coverage, and the composition it publishes -- the same excerpt
 * `digest-cost-safety.test.ts` ships a card from. */
function tables(whatHappened: string): Record<string, Row[]> {
  return {
    notification_preferences: [
      {
        user_id: "reader-1",
        send_at: "08:00",
        timezone: "UTC",
        days: [1, 2, 3, 4, 5, 6, 7],
        channels: [],
        frequency: "daily",
        density: 100,
        paused: false,
        instructions: "",
        language: "en",
      },
    ],
    digests: [
      {
        digest_id: "digest-1",
        user_id: "reader-1",
        scheduled_for: minutesAgo(30),
        status: "scheduled",
        kind: "briefing",
        generation_deferred_until: null,
        generated_at: null,
      },
    ],
    user_events: [
      {
        user_id: "reader-1",
        event_id: "event-1",
        relevance: 0.9,
        matched_at: minutesAgo(60),
        briefed_at: null,
        expired_at: null,
        delivered_revision: 0,
        // FakeDb does not resolve embedded resources; the nested object is seeded
        // instead, which is what `loadMatches` reads for the freshness ranking.
        events: { first_seen_at: minutesAgo(90), importance: 7, novelty: 6 },
      },
    ],
    events: [
      {
        id: "event-1",
        title: "OpenAI ships a reasoning model",
        what_happened: whatHappened,
        before_state: "No reasoning model was available.",
        after_state: "A reasoning model is available.",
        importance: 7,
        novelty: 6,
        first_seen_at: minutesAgo(90),
        material_revision: 0,
      },
    ],
    event_topics: [],
    event_impacts: [
      {
        event_id: "event-1",
        status: "complete",
        text: "The lab's pricing change resets what rivals can charge.",
        updated_at: minutesAgo(120),
        deferred_until: null,
      },
    ],
    articles: [
      {
        id: "article-1",
        event_id: "event-1",
        title: "OpenAI ships a reasoning model",
        source_id: "s1",
        sources: { name: "The Verge", kind: "news" },
        excerpt: COVERAGE,
        published_at: minutesAgo(120),
        url: "https://news.example.com/model",
      },
    ],
    subscriptions: [{ user_id: "reader-1", plan: "uno" }],
    telegram_accounts: [],
    push_subscriptions: [],
    deliveries: [],
    digest_items: [],
    feature_flags: [{ key: "story_translation_enabled", enabled: false }],
  };
}

/** Against the real path, with a double that fails the test if anything is bought. */
async function withDoubles(): Promise<{
  digest: typeof import("./digest").digest;
  calls: number[];
}> {
  const calls: number[] = [];
  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      completeRouted: async () => {
        calls.push(1);
        throw new Error("the briefing must not buy a summary");
      },
      completeRoutedJson: async () => {
        calls.push(1);
        throw new Error("the briefing must not buy a summary");
      },
    };
  });
  const { digest } = await import("./digest");
  return { digest, calls };
}

beforeEach(() => {
  vi.resetModules();
});

async function build(whatHappened: string): Promise<FakeDb> {
  const { digest } = await withDoubles();
  const db = new FakeDb(tables(whatHappened));
  await digest(db as never, { now: NOW, skipSend: true });
  return db;
}

describe("the briefing build stores the composed summary artifact", () => {
  it("composes and stores a valid line for a stored line the boundary refuses", async () => {
    // Fail-before: this assertion is about a column `digest_items` did not have,
    // so before this slice the item shipped with no line and the reader got the
    // refused description withheld -- the measured 10 of 289 delivered lines.
    expect(deliveredSummary(REFUSED_RAW)).toBeNull();

    const db = await build(REFUSED_RAW);
    const item = db.rows("digest_items")[0];
    expect(item).toBeDefined();
    expect(item?.["summary"]).toBe(
      "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page, according to The Verge.",
    );
    // A line the delivery boundary accepts, and never the refused text.
    expect(deliveredSummary(item?.["summary"] as string)).toBe(item?.["summary"]);
    expect(item?.["summary"]).not.toBe(REFUSED_RAW);
    // Provenance, in the same statement: the revision the artifact was composed
    // from. Revision 0 is what an event that has never been revised carries.
    expect(item?.["delivered_revision"]).toBe(0);
  });

  it("composes nothing for a line a reader may already read, and replaces nothing", async () => {
    const admissible = "OpenAI released a reasoning model this morning, the lab said.";
    const db = await build(admissible);
    const item = db.rows("digest_items")[0];
    expect(item).toBeDefined();
    // No artifact, so the surface resolves the item's own line -- which is the
    // line this reader saw before the slice, unchanged.
    expect(item?.["summary"]).toBeNull();
    expect(deliveredSummary(admissible)).toBe(admissible);
  });

  it("buys nothing: the summary is deterministic prose, not a model call", async () => {
    const { digest, calls } = await withDoubles();
    const db = new FakeDb(tables(REFUSED_RAW));
    await digest(db as never, { now: NOW, skipSend: true });
    expect(calls).toEqual([]);
  });
});
