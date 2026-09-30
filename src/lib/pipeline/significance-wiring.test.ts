import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSignificanceContext,
  match,
  relevantTopics,
  type Candidate,
  type Reader,
  type ReaderTopic,
  type SubjectHistoryRow,
} from "./match";
import { alertDecision, fireAlerts, type AlertHit } from "./alerts";
import { MIN_BASELINE_EVENTS, SUBJECT_SIGNIFICANT_FLOOR } from "./subject-significance";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * P4, wired: the historical baseline, the admission rule, the alert rule and the
 * shadow, each through the production path that uses it.
 *
 * `subject-significance.test.ts` proves the scoring functions. This file proves
 * what the audit found missing: that the baseline is the subject's own history
 * rather than the current page of candidates, that the flag off is the shipped
 * behaviour exactly, that the flag on reaches the alert stage, and that the
 * shadow is a real run over real candidates.
 */

const NOW = new Date("2026-09-26T09:00:00Z");
const READER = "44444444-4444-4444-8444-444444444444";
const RUST = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const EVENT = "77777777-7777-4777-8777-777777777777";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    eventId: EVENT,
    title: "Rust 2.0 release candidate published",
    whatHappened: "The first Rust 2.0 release candidate is available for testing.",
    importance: 2,
    novelty: 1,
    firstSeenAt: NOW.toISOString(),
    materialRevision: 0,
    materialOccurrenceAt: null,
    topics: [{ id: RUST, slug: "rust", label: "Rust" }],
    tags: [],
    sources: [],
    ...overrides,
  };
}

function topic(overrides: Partial<ReaderTopic> = {}): ReaderTopic {
  return {
    topicId: RUST,
    slug: "rust",
    label: "Rust",
    kind: "predefined",
    terms: [],
    spec: null,
    importance: "notable",
    weight: 1,
    keywords: [],
    excludeKeywords: [],
    ...overrides,
  };
}

function reader(topics: ReaderTopic[] = [topic()]): Reader {
  return { userId: READER, density: 30, topics, exclusions: [], sourcePrefs: new Map() };
}

/** `count` past Rust releases, as `subject_history` returns them. */
function releases(count: number, topicId = RUST): SubjectHistoryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    topic_id: topicId,
    event_id: `past-${topicId}-${i}`,
    title: `Rust 1.8${i} released`,
    what_happened: `Rust 1.8${i} is now available.`,
  }));
}

const selections = new Map([[RUST, new Set([EVENT])]]);

/* -------------------------------------------------------------------------- */
/* The baseline                                                                */
/* -------------------------------------------------------------------------- */

describe("the baseline is the subject's own history, not the current page", () => {
  it("scores a development against the subject's past coverage", () => {
    const context = buildSignificanceContext([candidate()], selections, releases(5));
    expect(context.history.get(RUST)?.events).toBe(6);
    expect(context.significant(EVENT, RUST)).toBeGreaterThanOrEqual(SUBJECT_SIGNIFICANT_FLOOR);
  });

  it("scores nothing with only the current page to go on", () => {
    // The previous baseline: the event alone. Below MIN_BASELINE_EVENTS nothing
    // is claimed -- which is why a quiet subject could never be significant.
    const context = buildSignificanceContext([candidate()], selections, []);
    expect(context.significant(EVENT, RUST)).toBe(0);
    expect(MIN_BASELINE_EVENTS).toBeGreaterThan(1);
  });

  it("never counts an event in its own baseline, so a first occurrence is one", () => {
    // Four past releases plus the candidate is five events; with the candidate
    // counted, `release_candidate` would read as "seen once" rather than new.
    const context = buildSignificanceContext([candidate()], selections, releases(4));
    expect(context.members.get(RUST)?.has(EVENT)).toBe(true);
    expect(context.significant(EVENT, RUST)).toBeGreaterThanOrEqual(SUBJECT_SIGNIFICANT_FLOOR);
  });

  it("recognises a transition the subject carries rarely", () => {
    const ruled = (i: number): SubjectHistoryRow => ({
      topic_id: RUST,
      event_id: `ruling-${i}`,
      title: "The court ruled on the Rust trademark",
      what_happened: "A judge ruled on the dispute.",
    });
    const event = candidate({
      title: "The court ruled on the Rust foundation dispute",
      whatHappened: "A ruling was issued.",
    });
    const rare = buildSignificanceContext([event], selections, [...releases(6), ruled(0)]);
    expect(rare.significant(EVENT, RUST)).toBe(1);
    const habitual = buildSignificanceContext([event], selections, [
      ...releases(3),
      ruled(0),
      ruled(1),
      ruled(2),
    ]);
    expect(habitual.significant(EVENT, RUST)).toBe(0);
  });

  it("compares a magnitude within its own dimension", () => {
    const funding = (i: number): SubjectHistoryRow => ({
      topic_id: RUST,
      event_id: `funding-${i}`,
      title: `Rust foundation raised $${i + 1} million`,
      what_happened: "The foundation raised money.",
    });
    const history = Array.from({ length: 5 }, (_, i) => funding(i));
    const big = candidate({
      title: "Rust foundation raised $500 million",
      whatHappened: "The foundation raised money.",
    });
    expect(buildSignificanceContext([big], selections, history).significant(EVENT, RUST)).toBe(2);

    // A count has no history in its own dimension, so money says nothing about it.
    const count = candidate({
      title: "Rust conference drew 50000 attendees",
      whatHappened: "Attendance was high.",
    });
    expect(buildSignificanceContext([count], selections, history).significant(EVENT, RUST)).toBe(0);
  });
});

describe("the baseline is scoped to the topics that can be asked about", () => {
  it("indexes only followed topics that select a candidate", () => {
    const custom = topic({
      topicId: OTHER,
      slug: "zig",
      label: "Zig",
      kind: "custom",
      terms: ["zig"],
    });
    const unfollowedButLinked = candidate({
      eventId: "linked",
      topics: [{ id: "88888888-8888-4888-8888-888888888888", slug: "go", label: "Go" }],
    });
    const found = relevantTopics([candidate(), unfollowedButLinked], [reader([topic(), custom])]);
    // Rust selects the candidate; Zig follows nothing in this page; Go is not
    // followed by anybody, so it is never evaluated or read.
    expect([...found.keys()]).toEqual([RUST]);
  });
});

/* -------------------------------------------------------------------------- */
/* The stage, flag off and on                                                  */
/* -------------------------------------------------------------------------- */

function stageDb(options: { flag?: boolean; history?: SubjectHistoryRow[] } = {}) {
  const db = new FakeDb({
    notification_preferences: [
      {
        user_id: READER,
        density: 30,
        paused: false,
        breaking: "important",
        channels: ["email"],
      },
    ],
    user_topics: [
      {
        user_id: READER,
        topic_id: RUST,
        importance: "notable",
        weight: 1,
        keywords: [],
        exclude_keywords: [],
        muted: false,
        created_at: NOW.toISOString(),
      },
      {
        user_id: READER,
        topic_id: OTHER,
        importance: "notable",
        weight: 1,
        keywords: [],
        exclude_keywords: [],
        muted: false,
        created_at: NOW.toISOString(),
      },
    ],
    user_exclusions: [],
    user_source_prefs: [],
    subscriptions: [{ user_id: READER, plan: "omni" }],
    topics: [
      { id: RUST, slug: "rust", label: "Rust", kind: "predefined", terms: [], match_spec: {} },
      { id: OTHER, slug: "zig", label: "Zig", kind: "custom", terms: ["zig"], match_spec: {} },
    ],
    events: [
      {
        id: EVENT,
        title: candidate().title,
        what_happened: candidate().whatHappened,
        importance: 2,
        novelty: 1,
        tags: [],
        status: "complete",
        analysed_at: NOW.toISOString(),
        first_seen_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
        material_revision: 0,
        material_occurrence_at: null,
        last_material_change_at: null,
      },
    ],
    event_topics: [{ event_id: EVENT, topic_id: RUST }],
    // `match` refuses an event with no live article: a story with no coverage
    // has no sources to open and nothing to compose from, so it cannot reach a
    // reader. This fixture is about significance rather than clustering, and it
    // gets the one article that makes its event a story at all.
    articles: [
      {
        id: "99999999-9999-4999-9999-999999999999",
        event_id: EVENT,
        source_id: null,
        title: candidate().title,
        url: "https://blog.rust-lang.org/2026/09/rc1.html",
        published_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
      },
    ],
    sources: [],
    feature_flags: [
      { key: "subject_significance_enabled", enabled: options.flag ?? false },
      { key: "breaking_alerts", enabled: true },
    ],
    digests: [],
    digest_items: [],
    user_events: [],
  });
  db.rpcs["subject_history"] = () => options.history ?? releases(5);
  db.rpcs["create_alert_delivery"] = () => "ok:alert-1";
  return db;
}

describe("the flag off is the shipped behaviour, exactly", () => {
  it("admits on importance alone, and never reads a baseline", async () => {
    const db = stageDb({ flag: false });
    const report = await match(asDb(db), { now: NOW });
    expect(report.subjectSignificance).toBe(false);
    expect(report.significanceHistory).toBe("not-needed");
    expect(report.inserted).toBe(0);
    expect(db.rpcCalls.map((call) => call.fn)).not.toContain("subject_history");
    expect(db.rpcCalls.map((call) => call.fn)).not.toContain("create_alert_delivery");
  });
});

describe("the flag on admits a subject development and can alert on it", () => {
  it("lifts the event into the briefing, against the subject's history", async () => {
    const db = stageDb({ flag: true });
    const report = await match(asDb(db), { now: NOW, skipAlerts: true });
    expect(report.subjectSignificance).toBe(true);
    expect(report.significanceHistory).toBe("loaded");
    expect(db.rows("user_events").map((row) => row["event_id"])).toEqual([EVENT]);
    // The baseline read is scoped: only the topic that selected a candidate.
    const call = db.rpcCalls.find((c) => c.fn === "subject_history");
    expect(call?.args["p_topic_ids"]).toEqual([RUST]);
  });

  it("does not lift anything when the history cannot be read", async () => {
    const db = stageDb({ flag: true });
    db.rpcs["subject_history"] = () => new Error("function does not exist");
    const report = await match(asDb(db), { now: NOW, skipAlerts: true });
    expect(report.significanceHistory).toBe("unavailable");
    expect(report.inserted).toBe(0);
  });

  it("reaches the alert stage with the revision and a subject qualification", async () => {
    const db = stageDb({ flag: true });
    await match(asDb(db), { now: NOW });
    const created = db.rpcCalls.filter((call) => call.fn === "create_alert_delivery");
    expect(created).toHaveLength(1);
    expect(created[0]?.args).toMatchObject({
      p_event_id: EVENT,
      p_importance: 2,
      p_revision: 0,
      p_subject_qualified: true,
    });
  });

  it("reads the topic table once per run", async () => {
    const db = stageDb({ flag: true });
    let topicReads = 0;
    db.hooks.afterSelect = (table) => {
      if (table === "topics") topicReads += 1;
    };
    await match(asDb(db), { now: NOW, skipAlerts: true });
    expect(topicReads).toBe(1);
  });
});

describe("the shadow is a real run over the same candidates", () => {
  it("measures the rule without letting it decide anything", async () => {
    const db = stageDb({ flag: false });
    const report = await match(asDb(db), {
      now: NOW,
      dryRun: true,
      subjectSignificance: false,
      significanceShadow: true,
    });
    // Decisions were the shipped rule's: nothing admitted, nothing written.
    expect(report.matched).toBe(0);
    expect(db.rows("user_events")).toEqual([]);
    // And the shadow saw the pair the rule would have changed.
    expect(report.significanceHistory).toBe("loaded");
    expect(report.significanceShadow?.report.events).toBe(1);
    expect(report.significanceShadow?.changedAdmissions).toBe(1);
    expect(report.significanceShadow?.alertChanges.gained).toEqual([EVENT]);
    expect(report.significanceShadow?.alertChanges.lost).toEqual([]);
  });

  it("has an operator entry point that runs exactly that", () => {
    const script = readFileSync("scripts/significance-shadow.ts", "utf8");
    expect(script).toMatch(/significanceShadow: true/);
    expect(script).toMatch(/dryRun: true/);
    expect(script).toMatch(/subjectSignificance: false/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["shadow:significance"]).toContain("scripts/significance-shadow.ts");
  });
});

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

describe("the alert rule, flag by flag", () => {
  const strong = { relevanceStrong: true, subject: SUBJECT_SIGNIFICANT_FLOOR, novelty: 1 };

  it("is the shipped rule with the flag off, whatever the signals say", () => {
    expect(alertDecision("important", { importance: 3, significance: strong }, false)).toEqual({
      alert: false,
      subjectQualified: false,
    });
    expect(alertDecision("important", { importance: 7, significance: strong }, false)).toEqual({
      alert: true,
      subjectQualified: false,
    });
  });

  it("admits a firm subject development the reader does not hold, with the flag on", () => {
    expect(alertDecision("important", { importance: 3, significance: strong }, true)).toEqual({
      alert: true,
      subjectQualified: true,
    });
    // Revision-relative novelty: a reader who already holds this revision is
    // not interrupted for it again.
    expect(
      alertDecision("important", { importance: 3, significance: { ...strong, novelty: 0 } }, true),
    ).toEqual({ alert: false, subjectQualified: false });
    expect(
      alertDecision(
        "important",
        { importance: 3, significance: { ...strong, relevanceStrong: false } },
        true,
      ).alert,
    ).toBe(false);
    expect(alertDecision("off", { importance: 9, significance: strong }, true).alert).toBe(false);
  });
});

/** An alert stage with one alert already delivered for EVENT at `revision`. */
function alertedDb(revision: number) {
  const db = stageDb({ flag: false });
  const alertedAt = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
  db.rows("digests").push({
    digest_id: "earlier-alert",
    user_id: READER,
    kind: "alert",
    generated_at: alertedAt,
    scheduled_for: alertedAt,
  });
  db.rows("digest_items").push({
    digest_id: "earlier-alert",
    event_id: EVENT,
    delivered_revision: revision,
  });
  return db;
}

async function alertFor(db: FakeDb, hit: Partial<AlertHit>) {
  await fireAlerts(asDb(db), {
    userId: READER,
    now: NOW,
    hits: [{ eventId: EVENT, importance: 8, eventAt: NOW.toISOString(), ...hit }],
  });
  return db.rpcCalls.filter((call) => call.fn === "create_alert_delivery");
}

describe("alert suppression is revision-aware", () => {
  it("suppresses the revision that was already alerted", async () => {
    expect(await alertFor(alertedDb(1), { revision: 1 })).toHaveLength(0);
  });

  it("reconsiders a newer revision, and claims it as that revision", async () => {
    const created = await alertFor(alertedDb(1), { revision: 2 });
    expect(created).toHaveLength(1);
    expect(created[0]?.args["p_revision"]).toBe(2);
  });

  it("keeps id-only suppression for a caller that is not revision-aware", async () => {
    expect(await alertFor(alertedDb(1), {})).toHaveLength(0);
  });

  it("does not alert twice for a normal re-match of the same revision", async () => {
    const db = stageDb({ flag: false });
    (db.rows("events")[0] as Row)["importance"] = 8;
    await match(asDb(db), { now: NOW });
    expect(db.rpcCalls.filter((c) => c.fn === "create_alert_delivery")).toHaveLength(1);
    // What `create_alert_delivery` leaves behind (0103): the alert digest, its
    // item stamped with the revision, and the relationship marked delivered.
    db.rows("digests").push({
      digest_id: "alert-1",
      user_id: READER,
      kind: "alert",
      generated_at: NOW.toISOString(),
      scheduled_for: NOW.toISOString(),
    });
    db.rows("digest_items").push({ digest_id: "alert-1", event_id: EVENT, delivered_revision: 0 });
    await match(asDb(db), { now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(db.rpcCalls.filter((c) => c.fn === "create_alert_delivery")).toHaveLength(1);
  });
});
