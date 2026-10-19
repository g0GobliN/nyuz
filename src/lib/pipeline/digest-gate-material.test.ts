import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";
import { composeFromSources } from "@/lib/editorial";
import type { EvidenceUnit } from "@/lib/understand";

/**
 * The gate composes from the same material the reader's page does (ruling #11's
 * last gap, found 2026-10-19).
 *
 * Ruling #11 stores the composer's own opening as the delivered card line, so the
 * card and the story page cannot open one story on two sentences. It landed, and
 * the delivered 2026-10-18 briefing still carried three lines that differed from
 * their page — because the gate's `loadBriefs` built each source from the
 * article's **excerpt** while the page's loader (`briefing.ts` `articlesFor`)
 * passes the article's excerpt **and** its `article_evidence` units, and the
 * composer reads `enrichedEvidence`. Two producers, two inputs, two sentences.
 *
 * Measured on that briefing, before the change and on the same rows: the gate's
 * opening equalled the page's for **10 of 13** stories with the excerpt alone,
 * and **13 of 13** with the article's evidence attached — the three it missed
 * being exactly the three the delivery audit read as defects.
 *
 * This is the fixture for the extreme case of the same class: an excerpt whose
 * opening the deck rule refuses (a demonstrative with no antecedent, D2) and an
 * article whose own evidence opens on a sentence that stands on its own. With the
 * excerpt alone the gate finds no deck and withholds the story as `unbriefable`;
 * with the page's material it briefs it and stores that sentence.
 *
 * The assertion is written against the **page's** composition rather than a
 * literal, so the test cannot drift from the surface it is protecting.
 */

const NOW = new Date("2026-10-19T06:00:00Z");
const DIGEST_ID = "digest-material";
const READER = "reader-material";
const EVENT = "event-material";
const ARTICLE = "article-material";
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const TITLE = "Regulator opens an inquiry into cloud billing";

/** The article's excerpt: its opening needs an antecedent the page never supplies. */
const EXCERPT =
  "Those were among the descriptions filed with the regulator, which opened an inquiry into cloud billing on Wednesday.";

/** The article's own evidence, extracted from its page: the sentence the page opens on. */
const UNITS: EvidenceUnit[] = [
  {
    kind: "fact",
    text: "The regulator opened an inquiry into cloud billing practices at three providers on Wednesday.",
  },
  {
    kind: "fact",
    text: "The inquiry covers contract terms and the fees a customer pays to leave early.",
  },
];

function tables(): Record<string, Row[]> {
  return {
    notification_preferences: [
      {
        user_id: READER,
        send_at: "08:00",
        timezone: "UTC",
        days: [1, 2, 3, 4, 5, 6, 7],
        channels: ["push"],
        frequency: "daily",
        density: 100,
        paused: false,
        instructions: "",
        language: "en",
      },
    ],
    digests: [
      {
        digest_id: DIGEST_ID,
        user_id: READER,
        scheduled_for: minutesAgo(30),
        status: "scheduled",
        kind: "briefing",
        generated_at: null,
        generation_deferred_until: null,
        generation_started_at: null,
        generation_attempts: 0,
        generation_progress: null,
        generation_failure_reason: null,
        item_count: 0,
        generation_tokens: 0,
      },
    ],
    user_events: [
      {
        user_id: READER,
        event_id: EVENT,
        relevance: 0.9,
        matched_at: minutesAgo(60),
        briefed_at: null,
        expired_at: null,
        delivered_revision: 0,
        events: {
          first_seen_at: minutesAgo(90),
          importance: 7,
          novelty: 6,
          material_revision: 0,
        },
      },
    ],
    events: [
      {
        id: EVENT,
        title: TITLE,
        what_happened: EXCERPT,
        before_state: "The practice had been unregulated.",
        after_state: "Providers now have to answer questions about their contract terms.",
        importance: 7,
        novelty: 6,
        first_seen_at: minutesAgo(90),
        material_revision: 0,
      },
    ],
    event_topics: [],
    event_impacts: [
      {
        event_id: EVENT,
        status: "complete",
        text: "What the inquiry means for anyone on a cloud contract this year.",
        updated_at: minutesAgo(180),
        deferred_until: null,
      },
    ],
    articles: [
      {
        id: ARTICLE,
        event_id: EVENT,
        title: TITLE,
        source_id: "s1",
        sources: { name: "The Register", kind: "news" },
        excerpt: EXCERPT,
        published_at: minutesAgo(80),
        url: "https://example.com/inquiry",
      },
    ],
    article_evidence: [{ article_id: ARTICLE, evidence: UNITS, status: "enriched" }],
    subscriptions: [{ user_id: READER, plan: "uno" }],
    telegram_accounts: [],
    push_subscriptions: [
      {
        install_id: "install-material",
        id: "push-material",
        user_id: READER,
        endpoint: "https://push.example.com/sub",
        p256dh: "key",
        auth: "auth",
        created_at: minutesAgo(500),
      },
    ],
    deliveries: [],
    digest_items: [],
    feature_flags: [{ key: "story_translation_enabled", enabled: false }],
  };
}

type Engine = { digest: typeof import("./digest").digest };
type Outcome = import("./digest").DigestOutcome;

/** Against the real path, with a double that fails the test if anything is bought. */
async function engine(): Promise<Engine> {
  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      completeRouted: async () => {
        throw new Error("the briefing must not buy anything");
      },
      completeRoutedJson: async () => {
        throw new Error("the briefing must not buy anything");
      },
    };
  });
  const { digest } = await import("./digest");
  return { digest };
}

/** Ticks until this reader's digest leaves the building. */
async function build(engineRef: Engine, db: FakeDb): Promise<Outcome[]> {
  const trace: Outcome[] = [];
  for (let minute = 0; minute < 40; minute += 1) {
    const report = await engineRef.digest(db as never, {
      now: new Date(NOW.getTime() + minute * 60_000),
      skipSend: true,
    });
    const outcome = report.outcomes.find((entry) => entry.digestId === DIGEST_ID);
    if (outcome === undefined) throw new Error(`no due digest at minute ${minute}`);
    trace.push(outcome);
    if (outcome.decision !== "deferred") return trace;
  }
  throw new Error("the build did not finish inside forty ticks");
}

/** The sentence the reader's page opens on, composed from the page's own inputs. */
const pageOpening = () =>
  composeFromSources(TITLE, [
    {
      name: "The Register",
      url: "https://example.com/inquiry",
      headline: TITLE,
      excerpt: EXCERPT,
      enrichedEvidence: UNITS,
    },
  ]).article.deck.text;

beforeEach(() => {
  vi.resetModules();
});

describe("the gate composes from the article's own evidence", () => {
  it("briefs a story whose excerpt composes no deck but whose evidence does", async () => {
    const db = new FakeDb(tables());
    const engineRef = await engine();
    await build(engineRef, db);

    const item = db.rows("digest_items").find((row) => row["event_id"] === EVENT);
    expect(item, "the story the page can open was withheld").toBeDefined();

    // The stored line is the page's opening, character for character -- the
    // contract ruling #11 states, which the excerpt-only gate could not meet.
    const opening = pageOpening();
    expect(opening).toBe(
      "The regulator opened an inquiry into cloud billing practices at three providers on Wednesday.",
    );
    expect(item?.["summary"]).toBe(opening);
  });
});
