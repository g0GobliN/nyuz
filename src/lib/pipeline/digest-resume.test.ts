import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * The resumable briefing build (0119, ruled 2026-10-16).
 *
 * One invocation used to build a whole briefing, and on a reader with a large
 * pool that build costs about 17.7 s of CPU — 15.5 s of it the readiness gate —
 * against a Workers free-plan Cron Trigger budget whose observed success ceiling
 * is ~710 ms. It was killed every night at the gate and the reader received
 * nothing (six consecutive nights). So the build is cut at its own stage
 * boundaries, each boundary is written to `digests.generation_progress`, and the
 * next tick resumes.
 *
 * What these tests pin, in the arbiter's own words:
 *   1. "multiple ticks can resume and finish correctly" — and the briefing they
 *      produce is the one the single-invocation build produced: same items, same
 *      positions, same lines, same provenance, same stored artifacts;
 *   2. "no duplicate digest items are written", and "the briefing becomes
 *      visible only when complete" — the delivery is queued in the final stage;
 *   3. "unselected items must not be marked as briefed merely because a
 *      generation tick examined them", while the dispositions that existed
 *      before the slice are unchanged;
 *   4. "the implementation must define how material changes between ticks affect
 *      the snapshot" — the policy is a drop, recorded and left unbriefed, never a
 *      briefing carrying a line composed from newer material under an older
 *      revision;
 *   5. "a failed tick can recover without corrupting or restarting the entire
 *      build unnecessarily" — the cursor survives a stage that throws.
 *
 * The variants below exist so that (1) can be asserted directly: the same five
 * stories are built from a small pool in one invocation, from a large pool in
 * two, and from a large candidate set across eleven — and all three ship the
 * same briefing.
 */

const NOW = new Date("2026-10-16T06:00:00Z");
const DIGEST_ID = "digest-1";
const READER = "reader-1";
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

/** The five stories every variant briefs. */
const STORIES = [
  [
    "OpenAI ships a reasoning model",
    "OpenAI released a reasoning model with API documentation and pricing published the same day.",
    "The lab said the model is available to existing customers today.",
  ],
  [
    "Regulator opens an inquiry into cloud billing",
    "The regulator opened an inquiry into cloud billing practices at three providers on Wednesday.",
    "The inquiry covers contract terms and early termination fees.",
  ],
  [
    "Airline grounds part of its fleet",
    "The airline grounded part of its fleet after an inspection found corrosion in a wing component.",
    "Eleven routes were cancelled while the checks continue.",
  ],
  [
    "Hospital network restores its records system",
    "The hospital network restored its records system eleven days after the ransomware attack.",
    "Clinics had been working from paper records in the meantime.",
  ],
  [
    "Central bank holds its policy rate",
    "The central bank held its policy rate and said inflation was easing more slowly than expected.",
    "Two members of the committee voted for an increase.",
  ],
] as const;

/** Container headlines the readiness gate refuses, used to enlarge the queue. */
const CONTAINERS = [
  "Week in Review: chips and cloud billing",
  "Morning briefing: markets open lower",
  "The Download: what to read next",
  "This week on the developer blog",
  "Daily digest: five things to know",
  "Newsletter: the state of cloud pricing",
  "Coming soon: our annual hardware survey",
  "What to read: an interview with the chief executive",
  "Week in Review: regulation and rates",
] as const;

type Variant = {
  /** Matches nothing selects (relevance 0), to enlarge the pool alone. */
  filler?: number;
  /** Container stories, to enlarge the considered set. */
  containers?: number;
};

function storyRows(
  index: number,
  story: readonly [string, string, string],
  relevance: number,
  matchedMinutes: number,
): { userEvent: Row; event: Row; impact: Row; article: Row } {
  const id = `event-${index}`;
  return {
    userEvent: {
      user_id: READER,
      event_id: id,
      relevance,
      matched_at: minutesAgo(matchedMinutes),
      briefed_at: null,
      expired_at: null,
      delivered_revision: 0,
      // FakeDb does not resolve embedded resources; the nested object is seeded
      // instead, which is what `loadMatches` reads for the freshness ranking.
      events: {
        first_seen_at: minutesAgo(matchedMinutes + 30),
        importance: 7,
        novelty: 6,
        material_revision: 0,
      },
    },
    event: {
      id,
      title: story[0],
      what_happened: `${story[1]} ${story[2]}`,
      before_state: "The situation was unchanged.",
      after_state: "The situation has changed.",
      importance: 7,
      novelty: 6,
      first_seen_at: minutesAgo(matchedMinutes + 30),
      material_revision: 0,
    },
    impact: {
      event_id: id,
      status: "complete",
      text: `What ${story[0].toLowerCase()} means for the reader's own field.`,
      updated_at: minutesAgo(180),
      deferred_until: null,
    },
    article: {
      id: `article-${index}`,
      event_id: id,
      title: story[0],
      source_id: "s1",
      sources: { name: "The Verge", kind: "news" },
      excerpt: `${story[1]} ${story[2]}`,
      published_at: minutesAgo(matchedMinutes + 20),
      url: `https://news.example.com/${index}`,
    },
  };
}

function tables(variant: Variant = {}): Record<string, Row[]> {
  const userEvents: Row[] = [];
  const events: Row[] = [];
  const impacts: Row[] = [];
  const articles: Row[] = [];

  STORIES.forEach((story, position) => {
    const rows = storyRows(position + 1, story, 0.95 - position * 0.01, 60 + position * 5);
    userEvents.push(rows.userEvent);
    events.push(rows.event);
    impacts.push(rows.impact);
    articles.push(rows.article);
  });

  // Container stories: selected, gated, and withheld by the readiness gate.
  for (let i = 0; i < (variant.containers ?? 0); i += 1) {
    const title = CONTAINERS[i % CONTAINERS.length] ?? "Week in Review";
    const id = `container-${i + 1}`;
    userEvents.push({
      user_id: READER,
      event_id: id,
      relevance: 0.5 - i * 0.001,
      matched_at: minutesAgo(200 + i),
      briefed_at: null,
      expired_at: null,
      delivered_revision: 0,
      events: {
        first_seen_at: minutesAgo(210 + i),
        importance: 5,
        novelty: 4,
        material_revision: 0,
      },
    });
    events.push({
      id,
      title,
      what_happened:
        "A round-up of the week's releases, with links to each story and a short comment.",
      before_state: null,
      after_state: null,
      importance: 5,
      novelty: 4,
      first_seen_at: minutesAgo(210 + i),
      material_revision: 0,
    });
    articles.push({
      id: `container-article-${i + 1}`,
      event_id: id,
      title,
      source_id: "s1",
      sources: { name: "The Verge", kind: "news" },
      excerpt: "A round-up of the week's releases, with links to each story and a short comment.",
      published_at: minutesAgo(220 + i),
      url: `https://news.example.com/roundup-${i + 1}`,
    });
  }

  // Filler matches: relevance 0 is dropped by selection, so these enlarge the
  // pool — the set selection has to rank — and nothing else.
  for (let i = 0; i < (variant.filler ?? 0); i += 1) {
    const id = `filler-${i + 1}`;
    userEvents.push({
      user_id: READER,
      event_id: id,
      relevance: 0,
      matched_at: minutesAgo(300 + i),
      briefed_at: null,
      expired_at: null,
      delivered_revision: 0,
      events: {
        first_seen_at: minutesAgo(310 + i),
        importance: 0,
        novelty: 0,
        material_revision: 0,
      },
    });
    events.push({
      id,
      title: `Routine point release ${i + 1}`,
      what_happened: "A point release with nothing beyond the changelog.",
      before_state: null,
      after_state: null,
      importance: 0,
      novelty: 0,
      first_seen_at: minutesAgo(310 + i),
      material_revision: 0,
    });
  }

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
    user_events: userEvents,
    events,
    event_topics: [],
    event_impacts: impacts,
    articles,
    subscriptions: [{ user_id: READER, plan: "uno" }],
    telegram_accounts: [],
    push_subscriptions: [
      {
        install_id: "install-1",
        id: "push-1",
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

beforeEach(() => {
  vi.resetModules();
});

/** One Cron tick, one minute after the last. */
async function tick(engineRef: Engine, db: FakeDb, minute: number): Promise<Outcome | undefined> {
  const report = await engineRef.digest(db as never, {
    now: new Date(NOW.getTime() + minute * 60_000),
    skipSend: true,
  });
  return report.outcomes.find((outcome) => outcome.digestId === DIGEST_ID);
}

/** Ticks until this reader's digest leaves the building, and returns the trace. */
async function build(engineRef: Engine, db: FakeDb): Promise<Outcome[]> {
  const trace: Outcome[] = [];
  for (let minute = 0; minute < 40; minute += 1) {
    const outcome = await tick(engineRef, db, minute);
    if (outcome === undefined) throw new Error(`no due digest at minute ${minute}`);
    trace.push(outcome);
    if (outcome.decision !== "deferred") return trace;
  }
  throw new Error("the build did not finish inside forty ticks");
}

const itemsOf = (db: FakeDb) =>
  db
    .rows("digest_items")
    .map((row) => ({
      event_id: row["event_id"],
      position: row["position"],
      why_it_matters: row["why_it_matters"],
      delivered_revision: row["delivered_revision"],
      summary: row["summary"],
    }))
    .sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)));

const digestRow = (db: FakeDb) => db.rows("digests").find((row) => row["digest_id"] === DIGEST_ID);

const progressOf = (db: FakeDb) =>
  digestRow(db)?.["generation_progress"] as
    | {
        stage: string;
        pool: number;
        candidates: { eventId: string; revision: number }[];
        queue: { eventId: string }[];
        cursor: number;
        ticks: number;
      }
    | null
    | undefined;

describe("the briefing build resumes across ticks", () => {
  it("ships the same briefing from a large pool, across ticks, as from a small pool in one", async () => {
    const engineRef = await engine();

    // The baseline: five stories, nothing to rank, one invocation.
    const small = new FakeDb(tables());
    const oneShot = await build(engineRef, small);
    expect(oneShot).toHaveLength(1);
    expect(oneShot[0]?.decision).toBe("generated");
    expect(itemsOf(small)).toHaveLength(5);

    // The same five stories from a pool too large for one tick: selection takes
    // a tick, then the rest rides in the next one.
    const large = new FakeDb(tables({ filler: 10 }));
    const twoTicks = await build(engineRef, large);
    expect(twoTicks).toHaveLength(2);
    expect(twoTicks[0]?.decision).toBe("deferred");
    expect(twoTicks[1]?.decision).toBe("generated");
    expect(itemsOf(large)).toEqual(itemsOf(small));

    // And from a candidate set too large for one gate: eleven ticks, the gate two
    // briefs at a time, the same five stories on the other side.
    const crowded = new FakeDb(tables({ filler: 10, containers: 9 }));
    const manyTicks = await build(engineRef, crowded);
    expect(manyTicks.length).toBeGreaterThan(6);
    expect(manyTicks.slice(0, -1).map((outcome) => outcome.decision)).toEqual(
      manyTicks.slice(0, -1).map(() => "deferred"),
    );
    expect(itemsOf(crowded)).toEqual(itemsOf(small));

    // The containers were gated and withheld, and the digest says so.
    expect(digestRow(crowded)?.["generation_failure_reason"]).toContain("9 withheld");
    expect(digestRow(crowded)?.["generation_failure_reason"]).toContain("newsletter");
    expect(digestRow(crowded)?.["status"]).toBe("ready");
    expect(digestRow(crowded)?.["item_count"]).toBe(5);
    // One row per story, however many ticks it took to write it.
    expect(itemsOf(crowded)).toHaveLength(5);
    expect(digestRow(crowded)?.["generation_progress"]).toBeNull();
  });

  it("cuts at the stage whose set was too large, and nowhere else", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));

    await tick(engineRef, db, 0);
    const afterSelect = progressOf(db);
    expect(afterSelect?.stage).toBe("screen");
    expect(afterSelect?.pool).toBe(24);
    expect(afterSelect?.candidates).toHaveLength(14);

    await tick(engineRef, db, 1);
    const afterScreen = progressOf(db);
    expect(afterScreen?.stage).toBe("gate");
    expect(afterScreen?.queue).toHaveLength(14);

    await tick(engineRef, db, 2);
    // Two briefs a tick: the gate is the stage the budget was written for.
    expect(progressOf(db)?.cursor).toBe(2);
    await tick(engineRef, db, 3);
    expect(progressOf(db)?.cursor).toBe(4);
  });

  it("resumes rather than restarting: the snapshot and the claim clock survive", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));

    await tick(engineRef, db, 0);
    const claimedAt = digestRow(db)?.["generation_started_at"];
    const frozen = progressOf(db)?.candidates;

    await tick(engineRef, db, 1);
    const afterScreen = progressOf(db);
    // The same snapshot, a stage further on: the ranking is not re-derived — the
    // instant it was frozen at is carried in the record — and the claim was not
    // re-taken, so the briefing's own timing record still says when it started.
    expect(afterScreen?.candidates).toEqual(frozen);
    expect(digestRow(db)?.["generation_started_at"]).toBe(claimedAt);
    expect(afterScreen?.ticks).toBe(2);
  });

  it("queues the delivery only once the briefing is complete", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));

    await tick(engineRef, db, 0);
    await tick(engineRef, db, 1);
    await tick(engineRef, db, 2);
    // Half-built: no items exist until the final stage, so nothing is sent.
    expect(db.rows("digest_items")).toEqual([]);
    expect(db.rows("deliveries")).toEqual([]);

    await build(engineRef, db);
    const queued = db.rows("deliveries");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.["channel"]).toBe("push");
    expect(queued[0]?.["status"]).toBe("queued");
  });

  it("stamps only the stories it decided about", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));
    await build(engineRef, db);

    const stamped = (eventId: string) =>
      db.rows("user_events").find((row) => row["event_id"] === eventId)?.["briefed_at"];

    // Shipped.
    expect(stamped("event-1")).not.toBeNull();
    // Withheld by the readiness gate, and stamped all the same: the disposition
    // is recorded on the digest and the story must not resurface every cycle.
    expect(stamped("container-1")).not.toBeNull();
    // Never selected, so never examined, so never marked.
    expect(stamped("filler-1")).toBeNull();
  });

  it("drops a story revised after the gate instead of shipping the wrong provenance", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));

    // Select, screen, then six of the seven gate chunks — everything except the
    // chunk whose tick goes on to write the items.
    for (let minute = 0; minute < 7; minute += 1) {
      const outcome = await tick(engineRef, db, minute);
      expect(outcome?.decision).toBe("deferred");
    }
    expect(progressOf(db)?.stage).toBe("gate");
    expect(progressOf(db)?.cursor).toBe(10);

    // Now the story moves, between the gate that admitted it and the write that
    // would compose its line.
    const nested = db.rows("user_events").find((row) => row["event_id"] === "event-1");
    (nested?.["events"] as Row)["material_revision"] = 1;
    const event = db.rows("events").find((row) => row["id"] === "event-1");
    if (event) event["material_revision"] = 1;

    const trace = await build(engineRef, db);
    expect(trace[trace.length - 1]?.decision).toBe("generated");

    // It is not in the briefing and it carries no stamp, so it leads the next one
    // rather than disappearing.
    expect(itemsOf(db).map((item) => item.event_id)).not.toContain("event-1");
    expect(itemsOf(db)).toHaveLength(4);
    const stamp = db.rows("user_events").find((row) => row["event_id"] === "event-1")?.[
      "briefed_at"
    ];
    expect(stamp).toBeNull();
    expect(digestRow(db)?.["generation_failure_reason"]).toContain(
      "revised_since_generation_started",
    );
  });

  it("drops a story revised before the gate reaches it", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));

    await tick(engineRef, db, 0);
    await tick(engineRef, db, 1);
    // Revised after the snapshot and before the gate's first chunk.
    const nested = db.rows("user_events").find((row) => row["event_id"] === "event-1");
    (nested?.["events"] as Row)["material_revision"] = 2;

    await build(engineRef, db);
    expect(itemsOf(db).map((item) => item.event_id)).not.toContain("event-1");
    expect(digestRow(db)?.["generation_failure_reason"]).toContain(
      "revised_since_generation_started",
    );
  });

  it("keeps the cursor when a stage fails, and resumes at that stage", async () => {
    const engineRef = await engine();
    let failures = 0;
    const db = new FakeDb(
      tables({ filler: 10, containers: 9 }),
      {},
      {
        failSelect: (table) => {
          // `event_topics` is read by the brief loader, which is the screening
          // stage's read — not the selection stage's.
          if (table === "event_topics" && failures < 1) {
            failures += 1;
            return "the database is away";
          }
          return null;
        },
      },
    );

    await tick(engineRef, db, 0);
    const failed = await tick(engineRef, db, 1);
    expect(failed?.decision).toBe("deferred");
    expect(failed?.detail).toContain("the database is away");

    // The cursor is exactly where the screening stage left it, so the build is
    // not started again from the selection.
    expect(progressOf(db)?.stage).toBe("screen");
    expect(digestRow(db)?.["generation_attempts"]).toBe(1);

    const trace = await build(engineRef, db);
    expect(trace[trace.length - 1]?.decision).toBe("generated");
    expect(itemsOf(db)).toHaveLength(5);
  });

  it("writes nothing more once the briefing is complete", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables({ filler: 10, containers: 9 }));
    const trace = await build(engineRef, db);
    const before = itemsOf(db);

    // Extra ticks: a ready digest is not due again, so nothing is rebuilt, no
    // item is rewritten and no second delivery is queued.
    for (let minute = trace.length; minute < trace.length + 3; minute += 1) {
      expect(await tick(engineRef, db, minute)).toBeUndefined();
    }
    expect(itemsOf(db)).toEqual(before);
    expect(db.rows("deliveries")).toHaveLength(1);
  });

  it("reads an unreadable cursor as no cursor, and builds the briefing anyway", async () => {
    const engineRef = await engine();
    const db = new FakeDb(tables());
    const row = digestRow(db);
    if (row) {
      row["status"] = "generating";
      // A claim old enough to be retaken, carrying a cursor nothing can read: the
      // record is discarded and the briefing is built from the start rather than
      // resumed from a state no part of this build can vouch for.
      row["generation_started_at"] = minutesAgo(20);
      row["generation_progress"] = "{not json";
    }

    const trace = await build(engineRef, db);
    expect(trace[trace.length - 1]?.decision).toBe("generated");
    expect(itemsOf(db)).toHaveLength(5);
    expect(digestRow(db)?.["generation_progress"]).toBeNull();
  });
});
