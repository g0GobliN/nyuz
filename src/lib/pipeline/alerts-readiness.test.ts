import { describe, expect, it } from "vitest";
import { fireAlerts } from "./alerts";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * An alert must clear the gate a briefing story clears.
 *
 * The breach this file pins: `fireAlerts` fired on importance and the flash
 * window alone, so a story the briefing would have withheld — a newsletter
 * container, a story with no readable body — could still be pushed to a
 * reader's phone as breaking news. Measured on the alert history of
 * 2026-10-11 (`npm run audit:alerts`): 108 of the 205 alerts ever sent would
 * have been refused by this gate.
 *
 * The shapes below are the ones the audit charged most often, quoted from it:
 * `newsletter` (5), `primary-source` (31) and `unbriefable` (69). The good case
 * is the same fixture `readiness.test.ts` proves composes two facts, because a
 * test that only asserted the refusals would pass on a gate that refused
 * everything.
 */

const NOW = new Date("2026-10-11T09:00:00Z");
const READER = "11111111-1111-4111-8111-111111111111";

/** One hour old: inside `FLASH_POLICY`, so age is never the reason here. */
const FRESH = new Date(NOW.getTime() - 3_600_000).toISOString();

/** A story the composer can make a body from. Proven ready by the probe on `readiness`. */
const GOOD_EXCERPT =
  "The first Rust 2.0 release candidate is available for testing. It ships the edition-2027 syntax and a stabilised async trait. The final release is expected in December.";

type EventSeed = {
  id: string;
  title: string;
  whatHappened: string;
  importance: number;
  excerpt: string;
};

/** A newsletter container: the title announces the container, not the news. */
const NEWSLETTER: EventSeed = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "The Download: AI roadblocks for humanoids and portable rubble",
  whatHappened: "Our weekly newsletter rounds up the stories you may have missed.",
  importance: 10,
  excerpt:
    "Our weekly newsletter rounds up the stories you may have missed. This week: humanoid roadblocks and portable rubble.",
};

/** A story whose own coverage composes one fact, which is only a deck. */
const THIN: EventSeed = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "DoorDash launches an AI agent you can text to order food",
  whatHappened: "DoorDash launched an AI agent you can text to order food.",
  importance: 7,
  excerpt: "DoorDash launched an AI agent you can text to order food.",
};

/** Three publishable stories, so a burst worth of slots can be observed. */
const GOOD: EventSeed[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Rust 2.0 release candidate published",
    whatHappened: "The first Rust 2.0 release candidate is available for testing.",
    importance: 8,
    excerpt: GOOD_EXCERPT,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Rust 2.0 release candidate published for a second platform",
    whatHappened: "The first Rust 2.0 release candidate is available for a second platform.",
    importance: 8,
    excerpt: GOOD_EXCERPT,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Rust 2.0 release candidate published for a third platform",
    whatHappened: "The first Rust 2.0 release candidate is available for a third platform.",
    importance: 8,
    excerpt: GOOD_EXCERPT,
  },
];

function alertDb(seeds: EventSeed[]): FakeDb {
  const db = new FakeDb({
    notification_preferences: [
      { user_id: READER, breaking: "important", channels: ["email"], paused: false },
    ],
    subscriptions: [{ user_id: READER, plan: "omni" }],
    telegram_accounts: [],
    push_subscriptions: [],
    feature_flags: [
      { key: "breaking_alerts", enabled: true },
      { key: "subject_significance_enabled", enabled: false },
    ],
    digests: [],
    digest_items: [],
    events: seeds.map((seed) => ({
      id: seed.id,
      title: seed.title,
      what_happened: seed.whatHappened,
      importance: seed.importance,
      novelty: 1,
      tags: [],
      status: "complete",
      analysed_at: NOW.toISOString(),
      first_seen_at: FRESH,
      material_occurrence_at: null,
      material_revision: 0,
      publisher_count: 1,
    })),
    // The coverage the gate composes from, seeded as the embedded object the
    // fake expects rather than through PostgREST's join syntax.
    articles: seeds.map((seed, index) => ({
      id: `article-${index}`,
      event_id: seed.id,
      source_id: `source-${index}`,
      title: seed.title,
      excerpt: seed.excerpt,
      sources: { name: "InfoWorld", kind: "news" },
    })),
  });
  db.rpcs["create_alert_delivery"] = () => "ok:alert-1";
  return db;
}

function hits(seeds: EventSeed[]) {
  return seeds.map((seed) => ({
    eventId: seed.id,
    importance: seed.importance,
    eventAt: FRESH,
    revision: 0,
  }));
}

function created(db: FakeDb): Row[] {
  return db.rpcCalls.filter((call) => call.fn === "create_alert_delivery") as unknown as Row[];
}

describe("an alert clears the gate a briefing story clears", () => {
  it("sends a story the briefing would publish", async () => {
    const db = alertDb(GOOD.slice(0, 1));
    const report = await fireAlerts(asDb(db), {
      userId: READER,
      now: NOW,
      hits: hits(GOOD.slice(0, 1)),
    });
    expect(created(db)).toHaveLength(1);
    expect(report.withheld).toBe(0);
    expect(report.withheldKinds).toEqual([]);
  });

  it("withholds a newsletter container above the importance floor, and names the rule", async () => {
    // Importance 10, the top of the scale: this is the case that shows the floor
    // is not what was wrong. The score agreed with the reader; the *shape* of the
    // item is what a phone must not be interrupted for.
    const db = alertDb([NEWSLETTER]);
    const report = await fireAlerts(asDb(db), {
      userId: READER,
      now: NOW,
      hits: hits([NEWSLETTER]),
    });
    expect(created(db)).toHaveLength(0);
    expect(report.withheld).toBe(1);
    expect(report.withheldKinds).toEqual(["newsletter"]);
  });

  it("withholds a story with no readable body rather than alerting to an empty page", async () => {
    const db = alertDb([THIN]);
    const report = await fireAlerts(asDb(db), {
      userId: READER,
      now: NOW,
      hits: hits([THIN]),
    });
    expect(created(db)).toHaveLength(0);
    expect(report.withheldKinds).toEqual(["unbriefable"]);
  });

  it("counts a refusal as withheld, not as sent", async () => {
    const db = alertDb([NEWSLETTER]);
    const report = await fireAlerts(asDb(db), {
      userId: READER,
      now: NOW,
      hits: hits([NEWSLETTER]),
    });
    expect(report.sent).toBe(0);
    expect(report.queued).toBe(0);
    expect(report.withheld).toBe(1);
  });

  it("does not spend a burst slot on a hit it will refuse", async () => {
    // Four candidates for three burst slots, and the highest-scoring one is the
    // newsletter. Pacing admits the strongest few, so a gate that ran after it
    // would spend a slot on a story it then dropped, and the reader would get two
    // alerts where three publishable stories were waiting. Asserting three is what
    // pins the order, not just the outcome.
    const seeds = [NEWSLETTER, ...GOOD];
    const db = alertDb(seeds);
    const report = await fireAlerts(asDb(db), {
      userId: READER,
      now: NOW,
      hits: hits(seeds),
    });
    expect(created(db)).toHaveLength(3);
    expect(report.withheld).toBe(1);
    expect(report.withheldKinds).toEqual(["newsletter"]);
  });

  it("re-asks the gate on the next run rather than recording a silent refusal", async () => {
    // A refused hit is left unclaimed, so the next run weighs it again. That is
    // deliberate: `create_alert_delivery` is the only thing that records a claim,
    // and writing one for a story nobody received would spend the reader's plan
    // and the daily cap on nothing. The cost is that a refusal is re-decided every
    // run until `FLASH_POLICY` ages the event out, which is why the gate stays a
    // pure function of loaded rows -- no model call, no provider spend.
    const db = alertDb([THIN]);
    const first = await fireAlerts(asDb(db), { userId: READER, now: NOW, hits: hits([THIN]) });
    const second = await fireAlerts(asDb(db), { userId: READER, now: NOW, hits: hits([THIN]) });
    expect(first.withheld).toBe(1);
    expect(second.withheld).toBe(1);
    expect(created(db)).toHaveLength(0);
    expect(db.rows("digests")).toHaveLength(0);
  });
});
