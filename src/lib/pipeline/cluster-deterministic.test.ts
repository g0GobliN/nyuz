import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { cluster } from "./cluster";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Forbidden provider call");
  }),
);
vi.mock("@/lib/ai/config", () => ({ completeRouted: paid, completeRoutedJson: paid }));
function fixture(candidate = "OpenAI releases new reasoning model today", kind = "news") {
  const at = new Date().toISOString();
  let owner: string | null = null;
  const db = new FakeDb(
    {
      articles: [
        {
          id: "a",
          title: "OpenAI releases new reasoning model today",
          published_at: at,
          event_id: null,
          kind,
        },
        { id: "b", title: candidate, published_at: at, event_id: "e", kind },
      ],
    },
    {
      claim_article_cluster: (a) => {
        if (owner) return false;
        owner = String(a["p_owner"]);
        return true;
      },
      finish_article_cluster: (a) => {
        if (a["p_owner"] !== owner) return null;
        db.rows("articles")[0]!["event_id"] = a["p_event_id"] ?? "new";
        return a["p_event_id"] ?? "new";
      },
      release_article_cluster: () => {
        owner = null;
      },
    },
  );
  return db;
}
describe("clustering never falls through to paid inference", () => {
  it("attaches an obvious candidate without weak neighbors forcing separation", async () => {
    const db = fixture();
    db.rows("articles").push({
      id: "c",
      title: "OpenAI reasoning strategy remains uncertain",
      published_at: new Date().toISOString(),
      event_id: "other",
    });
    expect((await cluster(asDb(db), { articleIds: ["a"] })).attached).toBe(1);
    expect(paid).not.toHaveBeenCalled();
  });
  it("creates a separate event for ambiguous candidates", async () => {
    const db = fixture("OpenAI unveils a powerful new reasoning system");
    expect((await cluster(asDb(db), { articleIds: ["a"] })).alone).toBe(1);
    expect(paid).not.toHaveBeenCalled();
  });
  it("research can attach identical coverage but unrelated research stays separate", async () => {
    expect(
      (await cluster(asDb(fixture(undefined, "research")), { articleIds: ["a"] })).attached,
    ).toBe(1);
    expect(
      (
        await cluster(asDb(fixture("New research into reasoning systems", "research")), {
          articleIds: ["a"],
        })
      ).alone,
    ).toBe(1);
  });
  it("concurrent manual and cron-like workers share the database claim", async () => {
    const db = fixture();
    const results = await Promise.all([
      cluster(asDb(db), { articleIds: ["a"] }),
      cluster(asDb(db), { articleIds: ["a"] }),
    ]);
    expect(results.reduce((n, r) => n + r.attached, 0)).toBe(1);
    expect(db.rpcCalls.filter((c) => c.fn === "finish_article_cluster")).toHaveLength(1);
    expect(paid).not.toHaveBeenCalled();
  });
  it("dry runs never claim or mutate membership", async () => {
    const db = fixture();
    await cluster(asDb(db), { articleIds: ["a"], dryRun: true });
    expect(db.rpcCalls).toHaveLength(0);
  });
});
