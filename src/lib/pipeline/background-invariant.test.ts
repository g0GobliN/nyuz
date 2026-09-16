import { afterEach, describe, expect, it, vi } from "vitest";
import { ingest } from "./ingest";
import { classify } from "./classify";
import { cluster } from "./cluster";
import { analyse } from "./analyse";
import { match } from "./match";
import { digest, queuedChannels } from "./digest";
import { fireAlerts, shouldAlert } from "./alerts";
import { asDb } from "@/lib/test-support/fake-db";
import { newsPipelineFixture, READER_ID } from "@/lib/test-support/news-pipeline";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Background attempted AI");
  }),
);
vi.mock("@/lib/ai/config", () => ({ completeRouted: paid, completeRoutedJson: paid }));
afterEach(() => vi.unstubAllGlobals());
describe("full background pipeline", () => {
  it("ingests, normalizes, clusters, classifies, finalizes, matches and prepares a briefing with zero provider invocations", async () => {
    const now = new Date();
    const db = newsPipelineFixture(now);
    const xml = `<rss version="2.0"><channel><title>News</title><item><title>OpenAI releases new model for developers</title><link>https://news.example.com/report?utm_source=feed</link><description>OpenAI released a new model for developers with published documentation and availability details. The announcement was made today.</description><pubDate>${now.toUTCString()}</pubDate></item></channel></rss>`;
    const feeds = vi.fn(
      async () => new Response(xml, { headers: { "content-type": "application/rss+xml" } }),
    );
    vi.stubGlobal("fetch", feeds);
    expect((await ingest(asDb(db), { force: true, now })).inserted).toBe(1);
    // Model database defaults; business stages below run unchanged.
    for (const [i, a] of db.rows("articles").entries())
      Object.assign(a, { id: `a${i}`, event_id: null });
    expect((await cluster(asDb(db), { articleIds: ["a0"], now })).alone).toBe(1);
    const classified = await classify(asDb(db), { now });
    expect(classified.classified).toBe(1);
    expect((await analyse(asDb(db), { now })).analysed).toBe(1);
    const matched = await match(asDb(db), { now });
    expect(matched.inserted).toBe(1);
    // FakeDb seeds embedded resources instead of implementing PostgREST joins.
    for (const row of db.rows("user_events"))
      Object.assign(row, {
        matched_at: now.toISOString(),
        briefed_at: null,
        expired_at: null,
        events: db.rows("events")[0],
      });
    const briefing = await digest(asDb(db), { now, skipSend: true });
    expect(briefing.generated).toBe(1);
    expect(db.rows("digest_items")).toHaveLength(1);
    expect(shouldAlert("important", 8)).toBe(true);
    const alerts = await fireAlerts(asDb(db), {
      userId: READER_ID,
      now,
      hits: [
        {
          eventId: String(db.rows("events")[0]?.["id"]),
          importance: 8,
          eventAt: now.toISOString(),
        },
      ],
    });
    expect(alerts.considered).toBe(1);
    expect(
      queuedChannels(["email", "push", "telegram"], { push: true, telegram: true }),
    ).toHaveLength(3);
    expect(feeds).toHaveBeenCalledTimes(1);
    expect(paid).not.toHaveBeenCalled();
  });
});
