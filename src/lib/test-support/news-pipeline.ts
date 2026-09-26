import { FakeDb, type Row } from "./fake-db";
export const READER_ID = "11111111-1111-4111-8111-111111111111";
export const EVENT_ID = "22222222-2222-4222-8222-222222222222";

/**
 * The database's `now()`, for a fixture whose phases happen at different times.
 *
 * Every RPC and trigger emulated below reads this rather than capturing a
 * timestamp when the fixture was built, because in production each of them runs
 * `now()` inside its own transaction. A test that moves the clock between phases
 * is therefore moving exactly what production would move, and nothing else.
 */
export type FakeClock = { now: Date };

/**
 * `mark_event_metadata_dirty` (0085, 0102), the trigger on `articles`.
 *
 * FakeDb does not execute SQL, so the one production write that happens as a
 * side effect of attaching an article is reproduced here, column for column:
 * dirty, one more coverage revision, and the coverage clock the re-entry lane
 * reads. Nothing in the test suite may set `coverage_changed_at` any other way --
 * that was how the fixture used to hide that production never moved
 * `last_updated_at`. `schema-migrations.test.ts` runs the real trigger on
 * PostgreSQL and pins the same three columns, so this emulation and the SQL
 * cannot drift apart silently.
 */
export function markCoverageChanged(db: FakeDb, eventId: string, clock: FakeClock): void {
  const event = db.rows("events").find((row) => row["id"] === eventId);
  if (!event) return;
  event["metadata_dirty"] = true;
  event["coverage_revision"] = ((event["coverage_revision"] as number | undefined) ?? 0) + 1;
  event["coverage_changed_at"] = clock.now.toISOString();
}

/**
 * An article row arriving already attached, which fires the trigger the way an
 * `insert ... event_id` does in production.
 */
export function attachArticle(db: FakeDb, article: Row, clock: FakeClock): void {
  db.rows("articles").push(article);
  const eventId = article["event_id"];
  if (typeof eventId === "string") markCoverageChanged(db, eventId, clock);
}

/**
 * The columns `insert into events(title, status, first_seen_at)` leaves at their
 * defaults, spelled out so a seeded event looks like one production inserted.
 */
function insertedEvent(fields: Row, clock: FakeClock): Row {
  const at = clock.now.toISOString();
  return {
    status: "pending",
    analysed_at: null,
    classified_at: null,
    understand: null,
    metadata_dirty: false,
    coverage_revision: 0,
    last_updated_at: at,
    coverage_changed_at: at,
    material_revision: 0,
    material_fingerprint: null,
    last_material_change_at: null,
    material_occurrence_at: null,
    ...fields,
  };
}

/**
 * `finish_event_finalization` (0098), statement for statement.
 *
 * What it writes: the metadata, `status`, `analysed_at` (only if unset),
 * `metadata_dirty` from the coverage revision it finalized, and the material
 * state from `p_material`. What it does NOT write is as important and is why
 * this is spelled out: neither `last_updated_at` nor `coverage_changed_at`.
 * Finalization is not coverage activity.
 */
function finishEventFinalization(db: FakeDb, clock: FakeClock) {
  return (a: Record<string, unknown>) => {
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
      metadata_dirty: row["coverage_revision"] !== a["p_revision"],
    });
    if (material.fingerprint) row["material_fingerprint"] = material.fingerprint;
    if (material.changed) {
      row["material_revision"] = ((row["material_revision"] as number | undefined) ?? 0) + 1;
      row["last_material_change_at"] = clock.now.toISOString();
    }
    if (material.occurrence_at) row["material_occurrence_at"] = material.occurrence_at;
    for (const topic_id of a["p_topics"] as string[]) {
      const exists = db
        .rows("event_topics")
        .some((link) => link["event_id"] === row["id"] && link["topic_id"] === topic_id);
      if (!exists)
        db.rows("event_topics").push({
          event_id: row["id"],
          topic_id,
          topics: { label: "OpenAI" },
        });
    }
    return true;
  };
}

export function newsPipelineFixture(now = new Date(), clock: FakeClock = { now }) {
  const at = now.toISOString();
  const db = new FakeDb({
    sources: [
      {
        id: "s",
        name: "OpenAI News",
        homepage: "https://news.example.com",
        feed_url: "https://news.example.com/rss",
        kind: "news",
        active: true,
        failure_count: 0,
        last_fetched_at: null,
      },
    ],
    topics: [{ id: "t", slug: "openai", label: "OpenAI", terms: ["openai"], kind: "predefined" }],
    notification_preferences: [
      {
        user_id: READER_ID,
        density: 100,
        paused: false,
        breaking: "important",
        channels: [],
        language: "en",
        frequency: "daily",
        send_at: "08:00",
        timezone: "UTC",
        days: [0, 1, 2, 3, 4, 5, 6],
      },
    ],
    user_topics: [
      {
        user_id: READER_ID,
        topic_id: "t",
        muted: false,
        importance: "notable",
        weight: 1,
        keywords: [],
        exclude_keywords: [],
        created_at: at,
      },
    ],
    subscriptions: [{ user_id: READER_ID, plan: "omni" }],
    feature_flags: [
      { key: "breaking_alerts", enabled: true },
      { key: "understand_on_demand", enabled: true },
    ],
    digests: [
      {
        digest_id: "d",
        user_id: READER_ID,
        scheduled_for: at,
        status: "scheduled",
        kind: "briefing",
        generated_at: null,
        generation_deferred_until: null,
      },
    ],
  });
  db.rpcs["refresh_source_demand"] = () => 0;
  db.rpcs["history_window_start"] = () => new Date(now.getTime() - 7 * 86400000).toISOString();
  db.rpcs["claim_article_cluster"] = (a) => {
    const row = db.rows("articles").find((r) => r["id"] === a["p_article_id"]);
    if (!row || row["event_id"] || row["owner"]) return false;
    row["owner"] = a["p_owner"];
    return true;
  };
  // `finish_article_cluster` (0085): insert the event when there is no target,
  // then `update articles set event_id = ...`, which is what fires the trigger.
  db.rpcs["finish_article_cluster"] = (a) => {
    const row = db.rows("articles").find((r) => r["id"] === a["p_article_id"]);
    if (!row || row["owner"] !== a["p_owner"]) return null;
    const target = (a["p_event_id"] as string | null) ?? EVENT_ID;
    if (!db.rows("events").some((e) => e["id"] === target))
      db.rows("events").push(
        insertedEvent(
          {
            id: target,
            title: row["title"],
            first_seen_at: (row["published_at"] as string | null) ?? clock.now.toISOString(),
          },
          clock,
        ),
      );
    row["event_id"] = target;
    row["owner"] = null;
    markCoverageChanged(db, target, clock);
    return target;
  };
  db.rpcs["claim_event_finalization"] = () => true;
  db.rpcs["finish_event_finalization"] = finishEventFinalization(db, clock);
  db.rpcs["fail_event_finalization"] = () => null;
  return db;
}

/**
 * An event and its articles as clustering leaves them: the insert, then each
 * attachment through the trigger emulation. For tests that need more than the
 * single seeded story.
 */
export function seedEvent(
  db: FakeDb,
  event: { id: string; title: string },
  articles: { title: string; excerpt: string }[],
  clock: FakeClock,
): void {
  db.rows("events").push(
    insertedEvent({ ...event, first_seen_at: clock.now.toISOString() }, clock),
  );
  for (const article of articles) {
    attachArticle(
      db,
      {
        id: `${event.id}-a${db.rows("articles").length}`,
        event_id: event.id,
        title: article.title,
        excerpt: article.excerpt,
        source_id: null,
        published_at: clock.now.toISOString(),
        url: `https://news.example.com/${event.id}/${db.rows("articles").length}`,
      },
      clock,
    );
  }
}

/**
 * One pending event with one article, as clustering leaves it: the event
 * inserted at `now`, then the article attached (which is the trigger's write).
 */
export function seedPendingNews(db: FakeDb, now = new Date()) {
  const clock = { now };
  db.rows("events").push(
    insertedEvent(
      {
        id: EVENT_ID,
        title: "OpenAI releases new model for developers",
        first_seen_at: now.toISOString(),
      },
      clock,
    ),
  );
  attachArticle(
    db,
    {
      id: "a",
      event_id: EVENT_ID,
      title: "OpenAI releases new model for developers",
      excerpt:
        "OpenAI released a new model for developers, with documentation and availability details published today. The company says the release is available to its existing customers. Independent performance measurements have not yet been published, according to the report.",
      source_id: "s",
      sources: { name: "OpenAI News" },
      published_at: now.toISOString(),
      url: "https://news.example.com/report",
    },
    clock,
  );
}
