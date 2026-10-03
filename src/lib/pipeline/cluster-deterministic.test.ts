import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { cluster } from "./cluster";
const paid = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Forbidden provider call");
  }),
);
vi.mock("@/lib/ai/config", () => ({ completeRouted: paid, completeRoutedJson: paid }));
function fixture(
  candidate = "OpenAI releases new reasoning model today",
  kind = "news",
  outlets?: { sources: Record<string, unknown>[]; ids: [string | null, string | null] },
  headline = "OpenAI releases new reasoning model today",
) {
  const at = new Date().toISOString();
  let owner: string | null = null;
  const db = new FakeDb(
    {
      ...(outlets ? { sources: outlets.sources } : {}),
      articles: [
        {
          id: "a",
          title: headline,
          published_at: at,
          event_id: null,
          kind,
          source_id: outlets?.ids[0] ?? null,
        },
        {
          id: "b",
          title: candidate,
          published_at: at,
          event_id: "e",
          kind,
          source_id: outlets?.ids[1] ?? null,
        },
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

describe("paraphrases attach across outlets, and only across outlets", () => {
  const PARAPHRASE = "OpenAI launches Dots, its bubbly agentic avatar";
  const STORY = "OpenAI launches Dots, its Muse competitor";
  const verge = {
    id: "verge",
    name: "The Verge",
    homepage: "https://www.theverge.com",
    kind: "news",
  };
  const verge2 = {
    ...verge,
    id: "verge-2",
    name: "Verge (syndication)",
  };
  const crunch = {
    id: "tc",
    name: "TechCrunch",
    homepage: "https://techcrunch.com",
    kind: "news",
  };

  it("joins one event's coverage when two outlets report it", async () => {
    const db = fixture(
      PARAPHRASE,
      "news",
      {
        sources: [verge, crunch],
        ids: ["verge", "tc"],
      },
      STORY,
    );
    const report = await cluster(asDb(db), { articleIds: ["a"] });
    expect(report.attached).toBe(1);
    expect(report.outcomes[0]?.detail).toBe("Cross-outlet paraphrase");
    expect(paid).not.toHaveBeenCalled();
  });

  it("refuses the same outlet's next take, which is not a second source", async () => {
    const db = fixture(
      PARAPHRASE,
      "news",
      {
        // Two source rows, one homepage: `publisher_count` would still be 1.
        sources: [verge, verge2],
        ids: ["verge", "verge-2"],
      },
      STORY,
    );
    expect((await cluster(asDb(db), { articleIds: ["a"] })).alone).toBe(1);
    expect(paid).not.toHaveBeenCalled();
  });

  it("attaches to the best match when an article matches two events", async () => {
    // The three-card arrest: the third outlet's account matched both existing
    // events, and the old `ids.length === 1` rule answered that by creating a
    // third one. The article belongs on the best-ranked match; the events'
    // own merge is the backfill's job.
    const db = fixture(
      "US arrests tech CEO accused of smuggling $300M in Nvidia chips into China",
      "news",
      { sources: [verge, crunch], ids: ["verge", "tc"] },
      "Californian accused of shipping $300M worth of Nvidia chips to China without Uncle Sam's approval",
    );
    db.rows("articles").push({
      id: "c",
      title:
        "California tech CEO arrested, faces up to 20 years in prison for smuggling $300 million in Nvidia AI servers to China",
      published_at: new Date().toISOString(),
      event_id: "other",
      kind: "news",
      source_id: "tc",
    });
    const report = await cluster(asDb(db), { articleIds: ["a"] });
    expect(report.attached).toBe(1);
    expect(report.outcomes[0]?.detail).toBe("Cross-outlet paraphrase; 2 events matched");
    expect(db.rows("articles")[0]!["event_id"]).not.toBe("new");
    expect(paid).not.toHaveBeenCalled();
  });

  it("refuses when either article's publisher cannot be established", async () => {
    const db = fixture(PARAPHRASE, "news", undefined, STORY);
    expect((await cluster(asDb(db), { articleIds: ["a"] })).alone).toBe(1);
    expect(paid).not.toHaveBeenCalled();
  });
});
