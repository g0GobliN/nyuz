import { FakeDb } from "./fake-db";
export const READER_ID = "11111111-1111-4111-8111-111111111111";
export const EVENT_ID = "22222222-2222-4222-8222-222222222222";
export function newsPipelineFixture(now = new Date()) {
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
  db.rpcs["finish_article_cluster"] = (a) => {
    const row = db.rows("articles").find((r) => r["id"] === a["p_article_id"]);
    if (!row || row["owner"] !== a["p_owner"]) return null;
    const target = a["p_event_id"] ?? EVENT_ID;
    if (!db.rows("events").some((e) => e["id"] === target))
      db.rows("events").push({
        id: target,
        title: row["title"],
        first_seen_at: at,
        status: "pending",
        analysed_at: null,
        classified_at: null,
        coverage_revision: 1,
        understand: null,
      });
    row["event_id"] = target;
    return target;
  };
  db.rpcs["claim_event_finalization"] = () => true;
  db.rpcs["finish_event_finalization"] = (a) => {
    const row = db.rows("events").find((e) => e["id"] === a["p_event_id"]);
    if (!row) return false;
    Object.assign(row, a["p_metadata"], {
      status: "complete",
      analysed_at: at,
      last_updated_at: at,
    });
    for (const topic_id of a["p_topics"] as string[])
      db.rows("event_topics").push({ event_id: row["id"], topic_id, topics: { label: "OpenAI" } });
    return true;
  };
  db.rpcs["fail_event_finalization"] = () => null;
  return db;
}

export function seedPendingNews(db: FakeDb, now = new Date()) {
  db.rows("events").push({
    id: EVENT_ID,
    title: "OpenAI releases new model for developers",
    first_seen_at: now.toISOString(),
    status: "pending",
    analysed_at: null,
    classified_at: null,
    coverage_revision: 1,
    understand: null,
  });
  db.rows("articles").push({
    id: "a",
    event_id: EVENT_ID,
    title: "OpenAI releases new model for developers",
    excerpt:
      "OpenAI released a new model for developers, with documentation and availability details published today. The company says the release is available to its existing customers. Independent performance measurements have not yet been published, according to the report.",
    source_id: "s",
    sources: { name: "OpenAI News" },
    published_at: now.toISOString(),
    url: "https://news.example.com/report",
  });
}
