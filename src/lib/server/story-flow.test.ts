import { describe, expect, it, vi } from "vitest";
import {
  newsPipelineFixture,
  seedPendingNews,
  READER_ID,
  EVENT_ID,
} from "@/lib/test-support/news-pipeline";
import { asDb, type FakeDb } from "@/lib/test-support/fake-db";
import * as readerEvidence from "@/lib/reader-evidence";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Unexpected AI");
  }),
);
vi.mock("@/lib/ai/config", () => ({
  completeRouted: paid,
  completeRoutedJson: paid,
  isDefinitelyUnbilledAiError: () => false,
}));
vi.mock("./guard", () => ({ signedInOnly: {} }));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => {
    const builder = {
      middleware: () => builder,
      server: (fn: unknown) => fn,
    };
    return builder;
  },
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));
import { loadDigestStories, loadHomeFeed, loadStory, startFirstBriefing } from "./briefing";
import { composeArticle } from "@/lib/editorial";
import type { Story } from "@/lib/story";
/**
 * The test double for `match_candidate_bundle` (0116): the RPC's lanes and
 * link rules evaluated over the fixture's live tables, so reader flows that
 * match (first briefing, backfill, fresh-match verdicts) see the candidates
 * the chunked reads used to assemble.
 */
function bundleRows(db: FakeDb): Record<string, unknown>[] {
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

/** The pipeline fixture with the bundle seam attached. */
function bundledDb(...args: Parameters<typeof newsPipelineFixture>): FakeDb {
  const db = newsPipelineFixture(...args);
  db.rpcs["match_candidate_bundle"] = () => bundleRows(db);
  return db;
}
const run = async (fn: unknown, db: FakeDb, data?: unknown) => {
  const result = await (fn as (input: unknown) => Promise<unknown>)({
    context: { actor: { id: READER_ID, db: asDb(db) } },
    data,
  });
  // Mirror the database default that FakeDb does not supply on inserts.
  for (const row of db.rows("user_events")) row["matched_at"] ??= new Date().toISOString();
  return result;
};
describe("reader flows never buy background synthesis", () => {
  it("new reader preferences -> first briefing -> deterministic backfill invokes no provider", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    expect(await run(startFirstBriefing, db)).toMatchObject({ analysed: 1, matched: 1 });
    expect(db.rows("events")[0]?.["status"]).toBe("complete");
    expect(paid).not.toHaveBeenCalled();
  });
  it("story hydration returns source-backed content without querying stored AI prose", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    await run(startFirstBriefing, db);
    const loaded = await run(loadStory, db, { id: EVENT_ID });
    expect(loaded).toMatchObject({
      id: EVENT_ID,
      title: "OpenAI releases new model for developers",
    });
    expect(loaded).not.toHaveProperty("understand");
    expect(db.rpcCalls.some((c) => c.fn === "claim_shared_story")).toBe(false);
    expect(paid).not.toHaveBeenCalled();
  });
  it("never returns generated-understanding cache content", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    await run(startFirstBriefing, db);
    db.rows("event_understanding").push({
      event_id: EVENT_ID,
      payload: {
        version: 2,
        coverage: "normal",
        oneSentence: "The model says a bridge collapsed.",
        article: { deck: { text: "A generated bridge story.", evidence: [1] }, paragraphs: [] },
      },
      status: "ready",
      updated_at: new Date().toISOString(),
    });
    db.rows("events")[0]!["understand"] = {
      version: 2,
      coverage: "normal",
      oneSentence: "The legacy model says a bridge collapsed.",
    };

    const story = (await run(loadStory, db, { id: EVENT_ID })) as Story;
    expect(story).not.toHaveProperty("understand");
    expect(story.what).not.toContain("bridge");
    expect(paid).not.toHaveBeenCalled();
  });

  it("hydrates a full briefing without running article-level evidence selection", async () => {
    const db = bundledDb();
    const now = new Date().toISOString();
    db.rows("digests")[0]!["status"] = "ready";
    db.rows("digests")[0]!["item_count"] = 25;

    const excerpt = Array.from(
      { length: 24 },
      (_, index) =>
        `OpenAI announced a new service for developers and will expand access to customers in ${2026 + (index % 2)}.`,
    ).join(" ");
    for (let index = 0; index < 25; index += 1) {
      const suffix = String(index + 1).padStart(12, "0");
      const id = `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${suffix}`;
      const title = `OpenAI announces developer service ${index + 1}`;
      db.rows("events").push({
        id,
        title,
        what_happened: `OpenAI announced developer service ${index + 1} for customers.`,
        importance: 5,
        novelty: 4,
        publisher_count: 1,
        before_state: null,
        after_state: null,
        first_seen_at: now,
        last_updated_at: now,
        analysed_at: now,
        understand: null,
      });
      db.rows("articles").push({
        id: `article-${index + 1}`,
        event_id: id,
        url: `https://news.example.com/story-${index + 1}`,
        title,
        published_at: now,
        excerpt,
        sources: { name: "OpenAI News" },
      });
      db.rows("event_topics").push({
        event_id: id,
        topic_id: "t",
        topics: { label: "OpenAI" },
      });
      db.rows("digest_items").push({
        digest_id: "d",
        event_id: id,
        position: index,
        why_it_matters: "It affects developers.",
      });
    }

    const selector = vi.spyOn(readerEvidence, "selectReaderEvidence");
    try {
      const feed = (await run(loadHomeFeed, db)) as { stories: Story[] };
      expect(feed.stories).toHaveLength(25);
      expect(feed.stories[0]?.sourceList[0]?.excerpt).toBe(excerpt);
      expect(selector).not.toHaveBeenCalled();

      db.rows("user_events").push({
        user_id: READER_ID,
        event_id: feed.stories[0]!.id,
        relevance: 1,
        matched_at: now,
      });
      selector.mockClear();
      const loaded = await run(loadStory, db, { id: feed.stories[0]!.id });
      expect(loaded).toMatchObject({ id: feed.stories[0]!.id, sourceList: [{ excerpt }] });
      expect(selector).not.toHaveBeenCalled();
    } finally {
      selector.mockRestore();
    }
  });

  it("shows a fresh match instead of a stale skipped-briefing verdict", async () => {
    // user follows a predefined topic, an event is complete with that topic,
    // and it is within the matching freshness window -- the production case
    // traced live: match.ts wrote the user_events row correctly, but the
    // homepage kept showing "nothing matched" because the most recent
    // resolved digest was `skipped` from before this match existed.
    const db = bundledDb();
    seedPendingNews(db);
    expect(await run(startFirstBriefing, db)).toMatchObject({ analysed: 1, matched: 1 });

    const digestRow = db.rows("digests")[0]!;
    digestRow["status"] = "skipped";
    digestRow["scheduled_for"] = new Date(Date.now() - 24 * 3_600_000).toISOString();
    digestRow["item_count"] = 0;

    const matchRow = db.rows("user_events").find((r) => r["user_id"] === READER_ID)!;
    matchRow["matched_at"] = new Date().toISOString();
    matchRow["briefed_at"] = null;

    const feed = (await run(loadHomeFeed, db)) as {
      stories: { id: string }[];
      source: string;
      digestStatus: string | null;
    };
    expect(feed.source).toBe("matches");
    expect(feed.digestStatus).toBe("skipped");
    expect(feed.stories.map((s) => s.id)).toContain(EVENT_ID);
  });

  it("keeps a stored significance line and retires the archived filler shapes", async () => {
    // The archive is what the email said, so a real line survives verbatim —
    // but the follow fallback and the subject line are shapes the ladder
    // stopped writing on 2026-10-08 (inclusion.ts). An older briefing holding
    // one gets the ladder's own answer instead, even when that answer is
    // nothing at all.
    const db = bundledDb();
    seedPendingNews(db);
    await run(startFirstBriefing, db);
    const digestId = db.rows("digests")[0]!["digest_id"] as string;
    const eventId = db.rows("user_events")[0]!["event_id"] as string;
    const item: Record<string, unknown> = {
      digest_id: digestId,
      event_id: eventId,
      position: 0,
      why_it_matters: "",
    };
    db.rows("digest_items").push(item);

    item["why_it_matters"] = "It moves the deadline the whole industry is working to.";
    const kept = (await run(loadDigestStories, db, { digestId })) as Story[];
    expect(kept[0]?.why).toBe("It moves the deadline the whole industry is working to.");

    for (const retired of [
      "You follow OpenAI.",
      "This is a funding story from The Register.",
      "A funding and cybersecurity story from The Register, in your OpenAI topics.",
    ]) {
      item["why_it_matters"] = retired;
      const recomputed = (await run(loadDigestStories, db, { digestId })) as Story[];
      expect(recomputed[0]?.why).not.toBe(retired);
      // The fixture's event has one publisher and no figure, before or after —
      // so the honest answer is an empty line, not a replacement filler.
      expect(recomputed[0]?.why).toBe("");
    }
  });

  it("still shows the quiet-day empty state when nothing matched since the skip", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    await run(startFirstBriefing, db);

    const digestRow = db.rows("digests")[0]!;
    digestRow["status"] = "skipped";
    digestRow["item_count"] = 0;

    const matchRow = db.rows("user_events").find((r) => r["user_id"] === READER_ID)!;
    // Matched before the skipped briefing ran, so it was already considered
    // and correctly found nothing -- not a fresh, un-briefed match.
    matchRow["matched_at"] = new Date(Date.now() - 48 * 3_600_000).toISOString();
    digestRow["scheduled_for"] = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const feed = (await run(loadHomeFeed, db)) as { source: string; stories: unknown[] };
    expect(feed.source).toBe("empty");
    expect(feed.stories).toHaveLength(0);
  });
});

describe("Read never depends on a live AI call", () => {
  it("renders a substantial deterministic article when AI is completely unavailable", async () => {
    paid.mockClear();
    const db = bundledDb();
    seedPendingNews(db);
    db.rows("articles").push({
      id: "a2",
      event_id: EVENT_ID,
      title: "OpenAI releases new model for developers",
      excerpt:
        "OpenAI's new model is available today through the API and ChatGPT, the company said. Pricing starts at $20 per million tokens, a 40% reduction from the prior release, according to the announcement.",
      source_id: "s2",
      sources: { name: "Second Outlet" },
      published_at: new Date().toISOString(),
      url: "https://second.example.com/report",
    });
    await run(startFirstBriefing, db);

    const story = (await run(loadStory, db, { id: EVENT_ID })) as Story;
    expect(story).toBeTruthy();
    expect(story.understand?.article).toBeUndefined();

    const article = composeArticle(story);
    const words = [article.deck.text, ...article.paragraphs.map((p) => p.text)]
      .join(" ")
      .trim()
      .split(/\s+/).length;

    expect(article.paragraphs.length).toBeGreaterThan(0);
    expect(words).toBeGreaterThanOrEqual(60);
    expect(paid).not.toHaveBeenCalled();
  });

  it("attaches prior coverage that shares the story's actor and figure", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    // The background rule requires the same actor *and* the same figure: two
    // OpenAI stories with no shared number cannot be told apart from two
    // different OpenAI stories, and the corpus read is that a wrong
    // "Previously," costs more than the sentence is worth (see
    // `related-events.ts`).
    const seeded = db.rows("articles").find((row) => row["id"] === "a")!;
    seeded["excerpt"] =
      "OpenAI released a new model for developers at $10 per million tokens, with documentation published today. The company says the release is available to its existing customers.";
    await run(startFirstBriefing, db);

    const priorId = "33333333-3333-4333-8333-333333333333";
    db.rows("events").push({
      id: priorId,
      title: "OpenAI cut prices for its coding tool at $10 per million tokens",
      what_happened:
        "OpenAI cut prices for its coding tool at $10 per million tokens last quarter.",
      first_seen_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      status: "complete",
      analysed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      classified_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      coverage_revision: 1,
      understand: null,
    });
    db.rows("event_topics").push({ event_id: priorId, topic_id: "t", topics: { label: "OpenAI" } });

    const story = (await run(loadStory, db, { id: EVENT_ID })) as Story;
    expect(story.relatedEvents?.some((r) => r.id === priorId)).toBe(true);

    const body = composeArticle(story)
      .paragraphs.map((p) => p.text)
      .join(" ");
    expect(body).toContain("OpenAI cut prices for its coding tool at $10 per million tokens");
  });

  it("does not attach related coverage when no other event shares a topic", async () => {
    const db = bundledDb();
    seedPendingNews(db);
    await run(startFirstBriefing, db);

    const story = (await run(loadStory, db, { id: EVENT_ID })) as Story;
    expect(story.relatedEvents ?? []).toEqual([]);
  });
});
