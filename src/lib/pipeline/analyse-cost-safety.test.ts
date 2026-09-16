import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { analyse } from "./analyse";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Forbidden provider call");
  }),
);
vi.mock("@/lib/ai/config", () => ({ completeRouted: paid, completeRoutedJson: paid }));
export function finalizationFixture(status = "pending") {
  const db = new FakeDb(
    {
      events: [
        {
          id: "e",
          title: "OpenAI releases new model",
          status,
          first_seen_at: new Date().toISOString(),
          analysed_at: null,
          coverage_revision: 1,
        },
      ],
      articles: [
        {
          id: "a",
          event_id: "e",
          title: "OpenAI releases new model",
          excerpt: "OpenAI released a new model today with documented performance improvements.",
          source_id: "s",
          published_at: new Date().toISOString(),
        },
      ],
      sources: [{ id: "s", name: "News", kind: "news", homepage: "https://news.example" }],
      topics: [{ id: "t", slug: "openai", label: "OpenAI", terms: ["openai"] }],
      event_topic_candidates: [{ event_id: "e", topic_id: "t" }],
    },
    {
      claim_event_finalization: () => true,
      finish_event_finalization: (args) => {
        Object.assign(db.rows("events")[0]!, args["p_metadata"], {
          status: "complete",
          analysed_at: new Date().toISOString(),
        });
        db.rows("event_topics").push(
          ...(args["p_topics"] as string[]).map((topic_id) => ({ event_id: "e", topic_id })),
        );
        return true;
      },
      fail_event_finalization: () => {
        db.rows("events")[0]!["status"] = "failed";
      },
    },
  );
  return db;
}
describe("free finalization preserves the stage contract", () => {
  it("completes pending and stranded analysing events with final topics, no reader article", async () => {
    for (const status of ["pending", "analysing"]) {
      const db = finalizationFixture(status);
      const r = await analyse(asDb(db));
      expect(r.analysed).toBe(1);
      expect(r.modelCalls).toBe(0);
      expect(db.rows("events")[0]).toMatchObject({
        status: "complete",
        publisher_count: 1,
        article_count: 1,
      });
      expect(db.rows("events")[0]?.["analysed_at"]).toBeTruthy();
      expect(db.rows("event_topics")).toContainEqual({ event_id: "e", topic_id: "t" });
      expect(db.rows("event_understanding")).toHaveLength(0);
    }
    expect(paid).not.toHaveBeenCalled();
  });
  it("losing a lease cannot persist or call a provider", async () => {
    const db = finalizationFixture();
    db.rpcs["claim_event_finalization"] = () => false;
    expect((await analyse(asDb(db))).claimed).toBe(1);
    expect(db.rpcCalls.some((c) => c.fn === "finish_event_finalization")).toBe(false);
    expect(paid).not.toHaveBeenCalled();
  });
  it("marks failed persistence as failed rather than stranded", async () => {
    const db = finalizationFixture();
    db.rpcs["finish_event_finalization"] = () => new Error("save failed");
    expect((await analyse(asDb(db))).failed).toBe(1);
    expect(db.rows("events")[0]?.["status"]).toBe("failed");
  });
  it("dry run cannot claim or persist", async () => {
    const db = finalizationFixture();
    await analyse(asDb(db), { dryRun: true });
    expect(db.rpcCalls).toHaveLength(0);
  });
  it("paginates full coverage instead of undercounting popular events", async () => {
    const db = finalizationFixture();
    const a = db.rows("articles")[0]!;
    db.tables["articles"] = Array.from({ length: 205 }, (_, i) => ({ ...a, id: String(i) }));
    expect((await analyse(asDb(db))).outcomes[0]?.articles).toBe(205);
  });
});
