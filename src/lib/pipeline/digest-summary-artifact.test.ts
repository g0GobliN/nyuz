import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";
import { composeFromSources } from "@/lib/editorial";
import { deliveredLine, deliveredSummary } from "@/lib/reader-summary";

/**
 * The delivered line the briefing build writes beside each shipped item.
 *
 * Two rulings govern this column, and the second replaced the first's rule:
 *
 *   * 2026-10-15 -- a summary line failing validation is **withheld, never
 *     replaced by the raw feed description**, and the line a reader receives is
 *     composed through the product's own composition path at build time. Before
 *     that slice every surface printed the raw column through a read-time join.
 *   * #11, 2026-10-18 (option 2) -- the delivered card and email carry **the
 *     composer's own opening sentence whenever the composer publishes a deck**,
 *     even when the stored line was perfectly admissible: one authoritative
 *     sentence at the point of delivery, so the card and the story page cannot
 *     open the same story on different sentences. The stored line remains the
 *     fallback for an item the composer never composed, and for every surface
 *     that is not the delivered briefing (the home feed, search, the archive).
 *
 * What these tests pin, in that order:
 *   1. the stored summary is the sentence the composition publishes, attribution
 *      frame included -- measured against the same `composeFromSources` call the
 *      story page composes with;
 *   2. that is true for an admissible stored line too, which is the reversal the
 *      second ruling made on purpose;
 *   3. an item the gate withholds is not written at all -- the override cannot
 *      make an ineligible story deliverable;
 *   4. an already-written item is never rewritten by a later build, so a
 *      historical delivery keeps what it said;
 *   5. nothing here calls a model: the composition is deterministic prose.
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

describe("the briefing build stores the delivered line", () => {
  it("stores the sentence the composition publishes, attribution frame included", async () => {
    // Fail-before for the withheld case: this assertion is about a column
    // `digest_items` did not have, so before the 2026-10-15 slice the item shipped
    // with no line and the reader got the refused description withheld.
    expect(deliveredSummary(REFUSED_RAW)).toBeNull();

    const db = await build(REFUSED_RAW);
    const item = db.rows("digest_items")[0];
    expect(item).toBeDefined();
    // Measured, not asserted loosely: this is the deck this coverage publishes,
    // and the frame the composer chose rides on it intact -- here a trailing
    // attribution, which the card prints exactly as the page does (ruling #11:
    // "preserve the composer's attribution framing", never strip it to recover a
    // superficially cleaner match).
    const deck = composeFromSources(
      "OpenAI ships a reasoning model",
      [{ name: "The Verge", excerpt: COVERAGE }],
      { publishedAt: minutesAgo(120) },
    ).article.deck.text;
    expect(item?.["summary"]).toBe(deck);
    expect(deck).toContain("according to The Verge");
    // Never the refused text, and a line the delivery boundary accepts.
    expect(deliveredSummary(item?.["summary"] as string)).toBe(item?.["summary"]);
    expect(item?.["summary"]).not.toBe(REFUSED_RAW);
    // Provenance, in the same statement: the revision the line was composed from.
    // Revision 0 is what an event that has never been revised carries.
    expect(item?.["delivered_revision"]).toBe(0);
  });

  it("stores the composer's sentence for an admissible line too -- the reversal ruling #11 made", async () => {
    const admissible = "OpenAI released a reasoning model this morning, the lab said.";
    const db = await build(admissible);
    const item = db.rows("digest_items")[0];
    expect(item).toBeDefined();
    // Before ruling #11 this item shipped with `summary` NULL and printed its own
    // stored line, which is a different sentence from the one the page opens on.
    // The ruling's words: "Do not substitute the producer's stored line merely
    // because it is non-empty or differs from the composed opening."
    const deck = composeFromSources(
      "OpenAI ships a reasoning model",
      [{ name: "The Verge", excerpt: COVERAGE }],
      { publishedAt: minutesAgo(120) },
    ).article.deck.text;
    expect(deliveredSummary(admissible)).toBe(admissible);
    expect(item?.["summary"]).toBe(deck);
    expect(item?.["summary"]).not.toBe(admissible);
    // And the line the card resolves is the deck, not the stored line.
    expect(deliveredLine({ summary: item?.["summary"] as string }, admissible)).toBe(deck);
  });

  it("writes no item at all for a story the gate withholds", async () => {
    // The override cannot make an ineligible story deliverable (ruling #11, "do
    // not relax readiness or withholding rules"). A photo credit is the measured
    // shape that composes no body.
    const { digest } = await withDoubles();
    const tablesWithCredit = tables(REFUSED_RAW);
    const articles = tablesWithCredit["articles"] as Row[];
    articles[0]![`excerpt`] = "Photograph: Josep Lago/AFP/Getty Images";
    const db = new FakeDb(tablesWithCredit);
    await digest(db as never, { now: NOW, skipSend: true });
    expect(db.rows("digest_items")).toHaveLength(0);
  });

  it("never rewrites an item an earlier build already delivered", async () => {
    // A delivered archive keeps saying what it said (ruling #11, boundary D). The
    // item below was written before the contract existed -- no summary artifact --
    // and a build that runs today must leave that row, and the line its reader
    // resolves from it, exactly as they were.
    const { digest } = await withDoubles();
    const seeded = tables(REFUSED_RAW);
    const delivered = "A stored line an earlier briefing delivered.";
    (seeded["digest_items"] as Row[]).push({
      digest_id: "digest-history",
      event_id: "event-history",
      position: 0,
      why_it_matters: "",
      summary: null,
      delivered_revision: 0,
    });
    (seeded["digests"] as Row[]).push({
      digest_id: "digest-history",
      user_id: "reader-1",
      scheduled_for: minutesAgo(60 * 24),
      status: "ready",
      kind: "briefing",
      generated_at: minutesAgo(60 * 24),
      generation_deferred_until: null,
    });
    const db = new FakeDb(seeded);
    await digest(db as never, { now: NOW, skipSend: true });
    const history = db.rows("digest_items").find((row) => row["digest_id"] === "digest-history");
    expect(history?.["summary"]).toBeNull();
    expect(deliveredLine({ summary: null }, delivered)).toBe(delivered);
  });

  it("buys nothing: the summary is deterministic prose, not a model call", async () => {
    const { digest, calls } = await withDoubles();
    const db = new FakeDb(tables(REFUSED_RAW));
    await digest(db as never, { now: NOW, skipSend: true });
    expect(calls).toEqual([]);
  });
});
