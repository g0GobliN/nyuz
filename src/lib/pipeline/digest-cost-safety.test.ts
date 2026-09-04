import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * What stage 7 refuses to pay for.
 *
 * Two paid things happen inside a briefing: the shared explanation of a story
 * (`event_impacts`, Pro) and the translation of that explanation into the
 * reader's language (Flash). Both are claimed before they are bought, and one
 * of them is switched off for launch. These tests count calls.
 *
 * The briefing itself is free, and that matters for the concurrency case: a
 * digest row left `generating` by a crashed worker IS taken back, deliberately,
 * because resuming it costs nothing — every paid step inside it is claimed
 * separately and only from `pending`.
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
      },
    ],
    events: [
      {
        id: "event-1",
        title: "OpenAI ships a reasoning model",
        what_happened: "The lab released it this morning.",
        before_state: "Nothing shipped.",
        after_state: "Something shipped.",
        importance: 7,
        novelty: 6,
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
    subscriptions: [{ user_id: "reader-1", plan: "free" }],
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

  it("calls the translator when the flag is on, which is what makes that zero mean something", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ translationFlag: true }));

    const report = await run(db, digest);

    expect(spy.translateCalls).toBe(1);
    expect(report.generated).toBe(1);
  });

  it("does not call the translator for an English reader either way", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ translationFlag: true, language: "en" }));

    await run(db, digest);

    expect(spy.translateCalls).toBe(0);
  });
});

describe("the shared explanation is bought once, by whoever claims it", () => {
  it("uses the explanation that already exists, without calling anything", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({}));

    await run(db, digest);

    expect(spy.impactCalls).toBe(0);
  });

  it("backfills a missing explanation exactly once", async () => {
    const { spy, digest } = await withDoubles();
    const db = new FakeDb(tables({ impact: null }));

    await run(db, digest);

    expect(spy.impactCalls).toBe(1);
    expect(spy.features).toEqual(["impact"]);
    expect(db.rows("event_impacts")[0]?.["status"]).toBe("complete");
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
    // And the reader is not harmed: the story is simply held over.
    expect(report.skipped).toBe(1);
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

  it("waits for a deferred explanation's retry time, then buys it", async () => {
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
    expect(due.spy.impactCalls).toBe(1);
  });
});
