import { describe, expect, it, vi } from "vitest";
import { analyse } from "./analyse";
import { match } from "./match";
import { digest } from "./digest";
import { activeCutoff } from "./freshness";
import { asDb, type FakeDb } from "@/lib/test-support/fake-db";
import {
  attachArticle,
  newsPipelineFixture,
  READER_ID,
  seedPendingNews,
  type FakeClock,
} from "@/lib/test-support/news-pipeline";

/**
 * The material re-entry lifecycle, end to end, against the fake database.
 *
 * `material-revision.test.ts` proves the decision function. These prove the
 * wiring: that a materially changed event reaches analysis, that a reader
 * holding revision N can receive N+1, and that none of the things which must
 * not re-deliver do (a reprint, a metadata-only update, and evidence older than
 * the state the reader already holds).
 *
 * The fixture's RPCs and its trigger emulation reproduce the SQL
 * (`test-support/news-pipeline.ts`), because FakeDb does not execute SQL. No
 * test here writes a timestamp or a material column by hand: every clock is
 * moved by the production write that moves it, and `schema-migrations.test.ts`
 * runs that write on real PostgreSQL.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const T0 = new Date("2026-09-18T09:00:00Z"); // the story breaks

/**
 * The shared pipeline fixture, on a clock the test moves.
 *
 * Finalization writes the material state and nothing else, and attaching an
 * article is what moves the coverage clock -- the production semantics.
 */
function fixture(clock: FakeClock) {
  const db = newsPipelineFixture(clock.now, clock);
  // Candidates arrive through `match_candidate_bundle` (0116): the RPC's
  // lanes and link rules evaluated over the live tables, so later cycles see
  // revisions and attachments exactly as the chunked reads did.
  db.rpcs["match_candidate_bundle"] = () => bundleRows(db);
  return db;
}

function bundleRows(db: FakeDb): Record<string, unknown>[] {
  // A fixed wide window: every event these cases create is in scope, so the
  // lanes select on status/analysis/revision exactly as production does.
  const windowSince = "2020-01-01T00:00:00.000Z";
  const inWindow = (ts: unknown): boolean => typeof ts === "string" && ts >= windowSince;
  const laneA = db
    .rows("events")
    .filter(
      (e) => e["analysed_at"] != null && e["status"] === "complete" && inWindow(e["first_seen_at"]),
    );
  const laneB = db
    .rows("events")
    .filter(
      (e) =>
        e["analysed_at"] != null &&
        e["status"] === "complete" &&
        (e["material_revision"] as number) > 0 &&
        inWindow(e["material_occurrence_at"]),
    );
  const merged = new Map<string, Record<string, unknown>>();
  for (const e of [...laneA, ...laneB]) merged.set(e["id"] as string, e as Record<string, unknown>);
  const topicById = new Map(db.rows("topics").map((t) => [t["id"] as string, t]));
  const sourceById = new Map(db.rows("sources").map((s) => [s["id"] as string, s]));
  return [...merged.values()].map((e) => ({
    id: e["id"],
    title: e["title"],
    what_happened: e["what_happened"],
    importance: e["importance"],
    novelty: e["novelty"],
    tags: e["tags"] ?? [],
    analysed_at: e["analysed_at"],
    first_seen_at: e["first_seen_at"],
    material_revision: e["material_revision"] ?? 0,
    material_occurrence_at: e["material_occurrence_at"] ?? null,
    last_material_change_at: e["last_material_change_at"] ?? null,
    topics: db
      .rows("event_topics")
      .filter((l) => l["event_id"] === e["id"])
      .flatMap((l) => {
        const t = topicById.get(l["topic_id"] as string);
        return t ? [{ id: t["id"], slug: t["slug"], label: t["label"] }] : [];
      }),
    sources: db
      .rows("articles")
      .filter((a) => a["event_id"] === e["id"])
      .flatMap((a) => {
        if (a["source_id"] === null) return [];
        const s = sourceById.get(a["source_id"] as string);
        return s ? [{ id: s["id"], name: s["name"] }] : [];
      }),
    has_articles: db.rows("articles").some((a) => a["event_id"] === e["id"]),
  }));
}

/**
 * One attachment, with the evidence it carries and when the world saw it.
 *
 * Goes through `attachArticle`, the emulation of the 0085/0102 trigger -- the
 * only thing that marks the event dirty and stamps `coverage_changed_at`, exactly
 * as `update articles set event_id = ...` does in production.
 */
function attach(db: FakeDb, clock: FakeClock, title: string, body: string, publishedAt: Date) {
  attachArticle(
    db,
    {
      id: `a${db.rows("articles").length}`,
      event_id: db.rows("events")[0]?.["id"] ?? null,
      title,
      excerpt: body,
      source_id: "s",
      sources: { name: "OpenAI News" },
      published_at: publishedAt.toISOString(),
      url: `https://news.example.com/${title.replace(/\W+/g, "-").toLowerCase()}`,
    },
    clock,
  );
}

/** FakeDb does not resolve embedded selects; mirror what PostgREST would return. */
function embedEvents(db: FakeDb) {
  for (const row of db.rows("user_events")) row["events"] = db.rows("events")[0];
}

/**
 * Schedule the next briefing slot, the way a later cadence would.
 *
 * A new digest row per slot, because that is what production does and because
 * `digest_items` is keyed on `(digest_id, event_id)`: reusing one digest id would
 * overwrite the previous item rather than record a second delivery.
 */
function reschedule(db: FakeDb, now: Date) {
  db.rows("digests").push({
    digest_id: `slot-${db.rows("digests").length + 1}`,
    user_id: READER_ID,
    scheduled_for: now.toISOString(),
    status: "scheduled",
    kind: "briefing",
    generated_at: null,
    generation_deferred_until: null,
  });
}

/** Run the three stages a reader's delivery depends on, in order. */
async function cycle(db: FakeDb, now: Date) {
  await analyse(asDb(db), { now });
  await match(asDb(db), { now, skipAlerts: true });
  embedEvents(db);
  return digest(asDb(db), { now, skipSend: true });
}

/** The story, broken at T0 and delivered once, the way every case below starts. */
async function deliveredAtT0() {
  const firstRun = new Date(T0.getTime() + HOUR);
  const clock = { now: firstRun };
  const db = fixture(clock);
  seedPendingNews(db, T0);
  const briefing = await cycle(db, firstRun);
  return { db, clock, briefing };
}

describe("material re-entry and revision-aware delivery", () => {
  it("carries a reader from revision 0 to revision 3, and refuses everything in between", async () => {
    // --- Case A: first delivery -------------------------------------------------
    const { db, clock, briefing } = await deliveredAtT0();
    const firstRun = clock.now;
    expect(briefing.generated).toBe(1);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(0);
    expect(db.rows("events")[0]?.["material_fingerprint"]).toBeTruthy();
    expect(db.rows("events")[0]?.["material_occurrence_at"]).toBe(T0.toISOString());
    const delivered = db.rows("user_events")[0]!;
    expect(delivered["briefed_at"]).toBeTruthy();
    expect(delivered["delivered_revision"]).toBe(0);
    expect(db.rows("digest_items")).toHaveLength(1);
    expect(db.rows("digest_items")[0]?.["delivered_revision"]).toBe(0);
    const eventId = db.rows("events")[0]?.["id"];
    await match(asDb(db), { now: firstRun, skipAlerts: true });

    // --- Case D: a metadata-only update, four days later ------------------------
    const metadataOnly = new Date(T0.getTime() + 4 * DAY);
    clock.now = metadataOnly;
    reschedule(db, metadataOnly);
    attach(
      db,
      clock,
      "OpenAI model coverage continues",
      "The model remains available to existing customers.",
      metadataOnly,
    );
    expect((await cycle(db, metadataOnly)).generated).toBe(0);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(0);
    expect(db.rows("user_events")[0]?.["briefed_at"]).toBeTruthy();

    // --- Case C: a reprint, five days later -------------------------------------
    const reprint = new Date(T0.getTime() + 5 * DAY);
    clock.now = reprint;
    reschedule(db, reprint);
    attach(
      db,
      clock,
      "OpenAI model still available",
      "The model remains available to existing customers.",
      reprint,
    );
    expect((await cycle(db, reprint)).generated).toBe(0);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(0);
    expect(db.rows("digest_items")).toHaveLength(1);

    // --- Case B: a genuine material development, seven days later ---------------
    const development = new Date(T0.getTime() + 7 * DAY);
    clock.now = development;
    reschedule(db, development);
    attach(
      db,
      clock,
      "OpenAI 2.0 release candidate published",
      "The first OpenAI 2.0 release candidate is now available for testing.",
      development,
    );
    expect((await cycle(db, development)).generated).toBe(1);
    const revised = db.rows("events")[0]!;
    expect(revised["material_revision"]).toBe(1);
    expect(revised["last_material_change_at"]).toBe(development.toISOString());
    // The world clock is the evidence's publication time, not the run's.
    expect(revised["material_occurrence_at"]).toBe(development.toISOString());
    // Reopening is exactly what match.ts may do here: the durable markers clear,
    // and only because the revision moved past what the reader held.
    expect(db.rows("user_events")[0]?.["briefed_at"]).toBeTruthy();
    expect(db.rows("user_events")[0]?.["delivered_revision"]).toBe(1);
    expect(db.rows("digest_items")).toHaveLength(2);
    expect(db.rows("digest_items")[1]?.["event_id"]).toBe(eventId);
    expect(db.rows("digest_items")[1]?.["delivered_revision"]).toBe(1);

    // --- Case E: digest history purged, then another revision -------------------
    const afterPurge = new Date(T0.getTime() + 8 * DAY);
    clock.now = afterPurge;
    db.tables["digests"] = [];
    db.tables["digest_items"] = [];
    db.rows("digests").push({
      digest_id: "after-purge",
      user_id: READER_ID,
      scheduled_for: afterPurge.toISOString(),
      status: "scheduled",
      kind: "briefing",
      generated_at: null,
      generation_deferred_until: null,
    });
    attach(
      db,
      clock,
      "OpenAI 2.0 released",
      "OpenAI 2.0 is now available to download.",
      afterPurge,
    );
    expect((await cycle(db, afterPurge)).generated).toBe(1);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(2);
    // Delivery history is gone; the durable revision on the relationship is not,
    // and that is what keeps the reader from being told twice.
    expect(db.rows("user_events")[0]?.["delivered_revision"]).toBe(2);

    // --- Case F: an expired relationship, and evidence older than the state -----
    const staleAttempt = new Date(T0.getTime() + 9 * DAY);
    clock.now = staleAttempt;
    reschedule(db, staleAttempt);
    db.rows("user_events")[0]!["expired_at"] = staleAttempt.toISOString();
    db.rows("user_events")[0]!["briefed_at"] = staleAttempt.toISOString();
    attach(
      db,
      clock,
      "OpenAI 2.0 patch available",
      "A patch for OpenAI 2.0 is available now.",
      new Date(staleAttempt.getTime() - 3 * DAY),
    );
    expect((await cycle(db, staleAttempt)).generated).toBe(0);
    // Evidence older than the occurrence the current revision was built from is
    // rejected as stale: the event does not move and the row stays closed.
    expect(db.rows("events")[0]?.["material_revision"]).toBe(2);
    expect(db.rows("user_events")[0]?.["expired_at"]).toBeTruthy();

    // A development dated now is a revision, and it reopens the relationship.
    const genuine = new Date(staleAttempt.getTime() + 2 * HOUR);
    clock.now = genuine;
    reschedule(db, genuine);
    attach(
      db,
      clock,
      "OpenAI 2.0.1 released",
      "OpenAI 2.0.1 is now available and fixes the reported issue.",
      genuine,
    );
    expect((await cycle(db, genuine)).generated).toBe(1);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(3);
    expect(db.rows("user_events")[0]?.["expired_at"]).toBeNull();
    expect(db.rows("user_events")[0]?.["delivered_revision"]).toBe(3);
  });

  it("refuses evidence older than the revision the reader holds, even when the fingerprint moves", async () => {
    // The late-arrival case: the pipeline already saw the newer article, and an
    // older one turns up afterwards. Its content moves the fingerprint, but the
    // event's current state is built on later evidence, so this is not a
    // development -- it is a sentence we already had, arriving second.
    const newest = new Date(T0.getTime() + 5 * DAY);
    const firstRun = new Date(newest.getTime() + HOUR);
    const clock = { now: firstRun };
    const db = fixture(clock);
    seedPendingNews(db, newest);
    await cycle(db, firstRun);
    expect(db.rows("events")[0]?.["material_occurrence_at"]).toBe(newest.toISOString());

    const later = new Date(newest.getTime() + 2 * HOUR);
    clock.now = later;
    reschedule(db, later);
    attach(
      db,
      clock,
      "OpenAI 2.0 release candidate published",
      "The first OpenAI 2.0 release candidate is now available for testing.",
      new Date(T0.getTime() + 2 * DAY), // published before the state we hold
    );
    const report = await cycle(db, later);
    expect(db.rows("events")[0]?.["material_revision"]).toBe(0);
    expect(db.rows("user_events")[0]?.["delivered_revision"]).toBe(0);
    expect(report.generated).toBe(0);
    expect(db.rows("digest_items")).toHaveLength(1);
  });

  it("never buys a provider call while deciding materiality", async () => {
    const now = new Date("2026-09-25T09:00:00Z");
    const clock = { now };
    const db = fixture(clock);
    seedPendingNews(db, now);
    await cycle(db, now);
    // The suite-wide invariant test asserts this structurally; here it is at the
    // stage level, on the request path that now writes material state.
    expect(db.rpcCalls.some((call) => call.fn === "finish_event_finalization")).toBe(true);
    expect(vi.isMockFunction(fetch)).toBe(false);
  });
});

/**
 * The case the re-entry lane exists for, past the window the old query happened
 * to cover.
 *
 * The previous version of the lane read `last_updated_at`, which nothing in
 * production moves after the insert, so its "attachment lookback" was an event
 * *creation* lookback: fourteen days after the story broke, no new coverage could
 * reach analysis. The nine-day case above never noticed, because nine days is
 * inside fourteen. These are fifteen and thirty.
 */
describe("re-entry is driven by coverage activity, not by how old the event is", () => {
  it.each([15, 30])(
    "re-enters, revises and re-delivers an event %i days after it was created",
    async (days) => {
      const { db, clock, briefing } = await deliveredAtT0();
      expect(briefing.generated).toBe(1);
      const createdAt = db.rows("events")[0]?.["coverage_changed_at"];

      const later = new Date(T0.getTime() + days * DAY);
      clock.now = later;
      reschedule(db, later);
      attach(
        db,
        clock,
        "OpenAI 2.0 release candidate published",
        "The first OpenAI 2.0 release candidate is now available for testing.",
        later,
      );

      const event = db.rows("events")[0]!;
      // The live lane cannot take it: it was first seen long before the horizon.
      expect(Date.parse(event["first_seen_at"] as string)).toBeLessThan(
        activeCutoff(later).getTime(),
      );
      // What makes it eligible is the attachment's own write, and nothing else.
      expect(event["coverage_changed_at"]).toBe(later.toISOString());
      expect(event["coverage_changed_at"]).not.toBe(createdAt);
      expect(event["last_updated_at"]).toBe(T0.toISOString());

      const analysed = await analyse(asDb(db), { now: later });
      expect(analysed.outcomes.map((o) => [o.eventId, o.decision])).toEqual([
        [event["id"], "analysed"],
      ]);
      expect(event["material_revision"]).toBe(1);
      expect(event["last_material_change_at"]).toBe(later.toISOString());
      expect(event["material_occurrence_at"]).toBe(later.toISOString());
      // Finalization is not coverage activity: it left the coverage clock alone.
      expect(event["coverage_changed_at"]).toBe(later.toISOString());

      await match(asDb(db), { now: later, skipAlerts: true });
      embedEvents(db);
      expect((await digest(asDb(db), { now: later, skipSend: true })).generated).toBe(1);
      expect(db.rows("user_events")[0]?.["delivered_revision"]).toBe(1);
    },
  );

  it("does not reach an old event whose coverage has not moved recently", async () => {
    // Coverage attached on day 2 and the pipeline never finalized it (a stall),
    // so the row is dirty -- but its coverage last moved fifteen days before the
    // run. The lane is bounded by coverage recency, which is what keeps it from
    // becoming a corpus scan of every stale dirty row.
    const { db, clock } = await deliveredAtT0();
    clock.now = new Date(T0.getTime() + 2 * DAY);
    attach(
      db,
      clock,
      "OpenAI 2.0 release candidate published",
      "The first OpenAI 2.0 release candidate is now available for testing.",
      clock.now,
    );
    const event = db.rows("events")[0]!;
    expect(event["metadata_dirty"]).toBe(true);

    clock.now = new Date(T0.getTime() + 17 * DAY);
    const analysed = await analyse(asDb(db), { now: clock.now });
    expect(analysed.outcomes).toEqual([]);
    expect(event["material_revision"]).toBe(0);
  });
});
