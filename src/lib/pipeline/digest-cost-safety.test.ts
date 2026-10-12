import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * What stage 7 refuses to pay for.
 *
 * Briefing assembly reads shared analysis and cached translations. It must not
 * buy either an impact or a translation, regardless of dormant flag state.
 * These tests count calls at both former paid boundaries.
 *
 * The briefing itself is free, and that matters for the concurrency case: a
 * digest row left `generating` by a crashed worker IS taken back, deliberately,
 * because resuming it costs nothing.
 */

const NOW = new Date();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

type Spy = { impactCalls: number; translateCalls: number; features: string[] };

async function withDoubles(): Promise<{ spy: Spy; digest: typeof import("./digest").digest }> {
  const spy: Spy = { impactCalls: 0, translateCalls: 0, features: [] };

  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      completeRoutedJson: async (opts: { feature: string }) => {
        spy.impactCalls += 1;
        spy.features.push(opts.feature);
        return {
          data: {
            items: [{ event_id: "event-1", why_it_matters: "Because it changes the rules." }],
          },
          usage: {
            content: "{}",
            model: "deepseek-v4-pro",
            promptTokens: 80,
            completionTokens: 20,
            reasoningTokens: 0,
            cachedTokens: 0,
            attempt_count: 1,
          },
          route: { capability: "digest", model: "deepseek-v4-pro" },
        };
      },
    };
  });

  // Counted at the module boundary: the question is whether the briefing calls
  // the translator at all, not what the translator would then do.
  vi.doMock("./translate", () => ({
    translateEvents: async () => {
      spy.translateCalls += 1;
      return { byEventId: new Map(), cacheHits: 0, generated: 0, tokens: 0 };
    },
  }));

  const { digest } = await import("./digest");
  return { spy, digest };
}

function tables(over: {
  language?: string;
  translationFlag?: boolean;
  impact?: Row | null;
}): Record<string, Row[]> {
  return {
    notification_preferences: [
      {
        user_id: "reader-1",
        send_at: "08:00",
        timezone: "UTC",
        days: [1, 2, 3, 4, 5, 6, 7],
        channels: [],
        frequency: "daily",
        density: 35,
        paused: false,
        instructions: "",
        language: over.language ?? "ja",
      },
    ],
    digests: [
      {
        digest_id: "digest-1",
        user_id: "reader-1",
        scheduled_for: minutesAgo(30),
        status: "scheduled",
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
        // FakeDb does not resolve embedded resources — the nested object is
        // seeded instead, which is what `loadMatches` reads for the freshness
        // ranking. Ninety minutes old, so this is unambiguously today's news
        // and these tests stay about cost rather than about the clock.
        events: {
          first_seen_at: minutesAgo(90),
          importance: 7,
          novelty: 6,
        },
      },
    ],
    events: [
      {
        id: "event-1",
        title: "OpenAI ships a reasoning model",
        what_happened: "The lab released it this morning.",
        // Two-word states on purpose: `changeLine` refuses them, so no rung has
        // anything story-specific to say and Q4 withholds the item — which is
        // what the two tests below are about.
        before_state: "Nothing shipped.",
        after_state: "Something shipped.",
        importance: 7,
        novelty: 6,
        first_seen_at: minutesAgo(90),
      },
    ],
    event_topics: [],
    event_impacts:
      over.impact === null
        ? []
        : [
            over.impact ?? {
              event_id: "event-1",
              status: "complete",
              text: "Because it changes the rules.",
              updated_at: minutesAgo(120),
              deferred_until: null,
            },
          ],
    digest_items: [],
    // The event's coverage. A story cannot reach a reader without articles --
    // matching runs over them -- so a fixture that seeds an event and no
    // articles describes something the pipeline cannot produce. It used to pass
    // because selection never looked at coverage; the briefability contract
    // does, and a story with no source evidence has no body to publish.
    articles: [
      {
        id: "article-1",
        event_id: "event-1",
        title: "OpenAI ships a reasoning model",
        source_id: "s1",
        sources: { name: "The Verge" },
        excerpt:
          "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page. The lab said the model is available to existing customers today.",
      },
    ],
    subscriptions: [{ user_id: "reader-1", plan: "uno" }],
    telegram_accounts: [],
    push_subscriptions: [],
    deliveries: [],
    feature_flags: [{ key: "story_translation_enabled", enabled: over.translationFlag === true }],
  };
}

const run = (db: FakeDb, digest: typeof import("./digest").digest) =>
  digest(db as never, { now: NOW, skipSend: true });

beforeEach(() => {
  vi.resetModules();
});

describe("story translation is off, and the briefing does not notice", () => {
  it("never calls the translator, and still delivers the briefing", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ translationFlag: false }));

    const report = await run(db, digest);

    expect(spy.translateCalls).toBe(0);
    expect(spy.impactCalls).toBe(0);
    // The reader still gets their briefing, in English.
    expect(report.generated).toBe(1);
    expect(db.rows("digest_items")).toHaveLength(1);
    expect(db.rows("digests")[0]?.["status"]).toBe("ready");
  });

  it("does not let the retired flag restore translation generation", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ translationFlag: true }));

    const report = await run(db, digest);

    expect(spy.translateCalls).toBe(0);
    expect(report.generated).toBe(1);
  });

  it("does not call the translator for an English reader either way", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ translationFlag: true, language: "en" }));

    await run(db, digest);

    expect(spy.translateCalls).toBe(0);
  });
});

describe("shared explanations are read, never bought by a briefing", () => {
  it("uses the explanation that already exists, without calling anything", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({}));

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
  });

  it("derives a money consequence from the story's own stored evidence", async () => {
    // 0090's evidence is the one free, story-specific source left for the
    // inclusion ladder, and this is the whole path: the article's own stored
    // sentence, selected deterministically at generation time, stored on the
    // item, with nothing bought at either former paid boundary.
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ impact: null }));
    db.rows("article_evidence").push({
      article_id: "article-1",
      status: "enriched",
      evidence: [
        {
          kind: "fact",
          text: "In a filing on Thursday, the publisher asks for damages of more than $250 million, alleging unauthorized use of its content.",
        },
      ],
    });

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
    expect(db.rows("digest_items")[0]?.["why_it_matters"]).toBe(
      "The publisher asks for damages of more than $250 million.",
    );
  });

  it("withholds the story when no rung can say anything story-specific (Q4)", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ impact: null }));

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
    expect(spy.features).toEqual([]);
    expect(db.rows("event_impacts")).toHaveLength(0);
    // Ruled Q4: no rung had a story-specific line, so the item does not ship —
    // and its disposition is recorded with the reason and the event id.
    expect(db.rows("digest_items")).toHaveLength(0);
    const note = String(db.rows("digests")[0]?.["generation_failure_reason"] ?? "");
    expect(note).toContain("missing_story_specific_why_it_matters");
    expect(note).toContain("event-1");
  });

  it("does not buy an explanation another worker is generating", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "generating",
          text: null,
          updated_at: minutesAgo(2),
          deferred_until: null,
        },
      }),
    );

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
  });

  it("still does not buy it once that claim is older than the stale window", async () => {
    // The requirement, on stage 7's own paid work: an aged `generating` row is
    // not free work waiting to be redone. It is a call that may well have
    // happened, and the ledger — not the clock — is what settles that.
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "generating",
          text: null,
          updated_at: minutesAgo(240),
          deferred_until: null,
        },
      }),
    );

    const report = await run(db, digest);

    expect(spy.impactCalls).toBe(0);
    // The row is left exactly as it was, for an operator, not silently retaken.
    expect(db.rows("event_impacts")[0]?.["status"]).toBe("generating");
    // And the reader is not harmed. This used to read `report.skipped === 1` —
    // the story was held over and the briefing went out empty. Holding the
    // story over is the right answer for the *ledger* and the wrong one for the
    // reader, who had matched it and was owed it at a time they chose. Since
    // 0077 the briefing ships the story with an empty explanation rather than
    // shipping nothing; the claim above is still what proves nothing was
    // bought twice.
    // The reader outcome Q4 chooses: the story is withheld — no rung could say
    // anything story-specific — and the disposition is recorded rather than an
    // empty line shipping. The claim above still proves nothing was bought.
    expect(report.generated).toBe(0);
    expect(db.rows("digest_items")).toHaveLength(0);
    const note = String(db.rows("digests")[0]?.["generation_failure_reason"] ?? "");
    expect(note).toContain("missing_story_specific_why_it_matters");
  });

  it("does not retry an explanation that permanently failed", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "failed",
          text: null,
          updated_at: minutesAgo(240),
          deferred_until: null,
        },
      }),
    );

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
  });

  it("never buys a deferred explanation, before or after its retry time", async () => {
    const early = await withDoubles();
    const notYet = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "pending",
          text: null,
          updated_at: minutesAgo(10),
          deferred_until: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
        },
      }),
    );
    await run(notYet, early.digest);
    expect(early.spy.impactCalls).toBe(0);

    vi.resetModules();
    const due = await withDoubles();
    const ready = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "pending",
          text: null,
          updated_at: minutesAgo(10),
          deferred_until: minutesAgo(1),
        },
      }),
    );
    await run(ready, due.digest);
    expect(due.spy.impactCalls).toBe(0);
    expect(ready.rows("event_impacts")[0]?.["status"]).toBe("pending");
  });
});
