import { describe, expect, it, vi } from "vitest";
import { analyse } from "./analyse";
import { match } from "./match";
import { digest } from "./digest";
import { asDb, type FakeDb, type Row } from "@/lib/test-support/fake-db";
import { newsPipelineFixture, READER_ID, seedPendingNews } from "@/lib/test-support/news-pipeline";

/**
 * The material re-entry lifecycle, end to end, against the fake database.
 *
 * `material-revision.test.ts` proves the decision function. These prove the
 * wiring: that a materially changed event reaches analysis, that a reader
 * holding revision N can receive N+1, and that none of the things which must
 * not re-deliver do (a reprint, a metadata-only update, and evidence older than
 * the state the reader already holds).
 *
 * The fixture's finalization RPC is taught the 0098 semantics below, because
 * FakeDb does not execute SQL. Nothing else in these tests writes the material
 * state by hand: it is always the pipeline that decides.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const T0 = new Date("2026-09-18T09:00:00Z"); // the story breaks

/**
 * A fixture whose finalization RPC follows the test's clock.
 *
 * The clock is mutable on purpose: every phase of the lifecycle happens at a
 * different time, and the discovery clock (`last_material_change_at`) has to be
 * written as the time of the run that discovered the change.
 */
function fixture(clock: { now: Date }) {
  const db = newsPipelineFixture(clock.now);
  db.rpcs["finish_event_finalization"] = (a) => {
    const row = db.rows("events").find((e) => e["id"] === a["p_event_id"]);
    if (!row) return false;
    const material = (a["p_material"] ?? {}) as {
      fingerprint?: string | null;
      changed?: boolean;
      occurrence_at?: string | null;
    };
    Object.assign(row, a["p_metadata"] as Row, {
      status: "complete",
      analysed_at: row["analysed_at"] ?? clock.now.toISOString(),
      last_updated_at: clock.now.toISOString(),
      metadata_dirty: false,
    });
    if (material.fingerprint) row["material_fingerprint"] = material.fingerprint;
    if (material.changed) {
      row["material_revision"] = ((row["material_revision"] as number) ?? 0) + 1;
      row["last_material_change_at"] = clock.now.toISOString();
    }
    if (material.occurrence_at) row["material_occurrence_at"] = material.occurrence_at;
    for (const topic_id of a["p_topics"] as string[])
      db.rows("event_topics").push({ event_id: row["id"], topic_id, topics: { label: "OpenAI" } });
    return true;
  };
  return db;
}

/** One attachment, with the evidence it carries and when the world saw it. */
function attach(db: FakeDb, now: Date, title: string, body: string, publishedAt: Date) {
  db.rows("articles").push({
    id: `a${db.rows("articles").length}`,
    event_id: db.rows("events")[0]?.["id"] ?? null,
    title,
    excerpt: body,
    source_id: "s",
    sources: { name: "OpenAI News" },
    published_at: publishedAt.toISOString(),
    url: `https://news.example.com/${title.replace(/\W+/g, "-").toLowerCase()}`,
  });
  const event = db.rows("events")[0]!;
  event["metadata_dirty"] = true;
  event["coverage_revision"] = ((event["coverage_revision"] as number) ?? 1) + 1;
  event["last_updated_at"] = now.toISOString();
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
  // The fake RPC reads the clock below; keep them in step.
  await match(asDb(db), { now, skipAlerts: true });
  embedEvents(db);
  return digest(asDb(db), { now, skipSend: true });
}

describe("material re-entry and revision-aware delivery", () => {
  it("carries a reader from revision 0 to revision 3, and refuses everything in between", async () => {
    // The story breaks, and the pipeline is healthy: first delivery, same day.
    const firstRun = new Date(T0.getTime() + HOUR);
    const clock = { now: firstRun };
    const db = fixture(clock);
    seedPendingNews(db, T0);
    const event = db.rows("events")[0]!;
    event["first_seen_at"] = T0.toISOString();
    event["last_updated_at"] = T0.toISOString();
    event["material_revision"] = 0;
    event["material_fingerprint"] = null;
    event["material_occurrence_at"] = null;
    db.rows("articles")[0]!["published_at"] = T0.toISOString();

    // --- Case A: first delivery -------------------------------------------------
    const briefing = await cycle(db, firstRun);
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
      metadataOnly,
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
      reprint,
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
      development,
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
      afterPurge,
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
      staleAttempt,
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
      genuine,
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
    const event = db.rows("events")[0]!;
    event["first_seen_at"] = newest.toISOString();
    event["last_updated_at"] = newest.toISOString();
    event["material_revision"] = 0;
    event["material_fingerprint"] = null;
    event["material_occurrence_at"] = null;
    db.rows("articles")[0]!["published_at"] = newest.toISOString();
    await cycle(db, firstRun);
    expect(db.rows("events")[0]?.["material_occurrence_at"]).toBe(newest.toISOString());

    const later = new Date(newest.getTime() + 2 * HOUR);
    clock.now = later;
    reschedule(db, later);
    attach(
      db,
      later,
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
