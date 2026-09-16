import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, asDb, type Row } from "@/lib/test-support/fake-db";
import { ensureUnderstanding, storyEvidence } from "./understanding";
import type { RoutedOptions } from "@/lib/ai/config";
import { TruncatedCompletionError } from "@/lib/ai/deepseek";
const provider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/config", () => ({
  completeRouted: (opts: unknown) => provider(opts),
  isDefinitelyUnbilledAiError: (e: { status?: number }) =>
    [400, 401, 403, 429].includes(e?.status ?? 0),
}));
const prose = {
  deck: { text: "The council approved a new public library.", evidence: [1] },
  paragraphs: [
    {
      text: "The project includes a reading room and longer opening hours, according to the council announcement.",
      evidence: [1],
    },
  ],
};
const event = { id: "e", title: "Council approves public library", understand: null };
const articles = [
  {
    id: "a",
    title: event.title,
    source_id: "s",
    published_at: "2026-09-14T12:00:00Z",
    excerpt:
      "The council approved a new public library on Monday. The project includes a reading room and extended opening hours. Funding will come from the existing community development budget, according to the council's announcement. Construction is expected to begin next spring.",
  },
];
function fixture() {
  const db = new FakeDb({ event_understanding: [] });
  const find = (a: Row) =>
    db.rows("event_understanding").find((r) => r["content_version"] === a["p_version"]);
  db.rpcs["claim_shared_story"] = (a) => {
    const row = find(a);
    if (row)
      return row["phase"] === "persisting"
        ? "persisting"
        : row["status"] === "ready"
          ? "ready"
          : row["status"] === "failed"
            ? "cooldown"
            : "generating";
    db.rows("event_understanding").push({
      event_id: "e",
      content_version: a["p_version"],
      status: "generating",
      phase: "claimed",
      owner: a["p_owner"],
      attempts: 0,
    });
    return "won";
  };
  db.rpcs["begin_shared_story_attempt"] = (a) => {
    const r = find(a);
    if (!r || r["owner"] !== a["p_owner"]) return false;
    r["attempts"] = Number(r["attempts"]) + 1;
    r["phase"] = "requesting";
    return true;
  };
  db.rpcs["stage_shared_story"] = (a) => {
    const r = find(a);
    if (!r || r["owner"] !== a["p_owner"]) return false;
    r["payload"] = a["p_payload"];
    r["phase"] = "persisting";
    return true;
  };
  db.rpcs["finish_shared_story"] = (a) => {
    const r = find(a);
    if (!r || r["phase"] !== "persisting") return false;
    r["status"] = "ready";
    r["phase"] = "ready";
    r["prompt_version"] = "story:2";
    r["owner"] = null;
    return true;
  };
  db.rpcs["fail_shared_story"] = (a) => {
    const r = find(a);
    if (r && r["phase"] !== "persisting") {
      r["status"] = "failed";
      r["uncertain"] = a["p_uncertain"];
    }
    return null;
  };
  return db;
}
const open = (db: FakeDb, userId = "A", evidence = articles) =>
  ensureUnderstanding(asDb(db), event, evidence, { userId, explicitOpen: true });
beforeEach(() => {
  provider.mockReset();
  provider.mockImplementation(async (opts: RoutedOptions) => {
    await opts.beforeProvider?.("usage");
    const result = {
      content: JSON.stringify(prose),
      model: "fake",
      promptTokens: 200,
      completionTokens: 100,
      cachedTokens: 0,
      reasoningTokens: 0,
      attempt_count: 1,
    };
    try {
      await opts.onResponse?.(result);
    } catch {
      /* The real meter still settles invalid output. */
    }
    return result;
  });
});
describe("reader-initiated global story cache", () => {
  it("requests evidence-adaptive article length without imposing a minimum", async () => {
    await open(fixture());
    const options = provider.mock.calls[0]?.[0] as RoutedOptions;
    expect(options.system).toContain("250–400 words");
    expect(options.system).toContain("400–600 words");
    expect(options.system).toContain("up to about 700 words");
    expect(options.system).toContain("120–180 words");
    expect(options.system).toContain("targets, not minimum word counts");
    expect(options.system).toContain("never pad");
  });
  it("one generation serves a refresh and 100 later readers", async () => {
    const db = fixture();
    expect((await open(db)).status).toBe("generated");
    expect((await open(db)).status).toBe("cached");
    const readers = await Promise.all(Array.from({ length: 100 }, (_, i) => open(db, String(i))));
    expect(readers.every((r) => r.status === "cached")).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.rows("event_understanding")[0]?.["attempts"]).toBe(1);
  });
  it("simultaneous first readers do not start duplicate calls", async () => {
    const db = fixture();
    const result = await Promise.all(Array.from({ length: 100 }, (_, i) => open(db, String(i))));
    expect(result.filter((r) => r.status === "generated")).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("a material development earns one new version, not one per reader", async () => {
    const db = fixture();
    await open(db);
    const changed = [
      {
        ...articles[0]!,
        excerpt: articles[0]!.excerpt + " The court ruled against the development.",
      },
    ];
    expect((await open(db, "B", changed)).status).toBe("generated");
    await open(db, "C", changed);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("metadata/order/incidental company names do not repurchase coverage", async () => {
    const db = fixture();
    await open(db);
    await open(db, "B", [
      { ...articles[0]!, excerpt: articles[0]!.excerpt + " Apple declined to comment." },
    ]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each(["capacity", "cooldown", "rate", "exhausted", "reconciliation"])(
    "refuses %s without reaching the routed provider",
    async (state) => {
      const db = fixture();
      db.rpcs["claim_shared_story"] = () => state;
      expect((await open(db)).status).toBe("skipped");
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it("fails closed before transport if reservation is refused", async () => {
    const db = fixture();
    provider.mockRejectedValue(new Error("Budget exhausted"));
    await open(db);
    expect(db.rows("event_understanding")[0]?.["attempts"]).toBe(0);
    expect(db.rpcCalls.some((r) => r.fn === "begin_shared_story_attempt")).toBe(false);
  });
  it("cached stories bypass initiation and budget controls", async () => {
    const db = fixture();
    await open(db);
    db.rpcs["claim_shared_story"] = () => {
      throw new Error("Budget exhausted");
    };
    expect((await open(db)).status).toBe("cached");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("rejects thin evidence and non-explicit opens before claiming", async () => {
    const db = fixture();
    await open(db, "A", [{ ...articles[0]!, excerpt: "Brief update." }]);
    await ensureUnderstanding(asDb(db), event, articles, {
      userId: "A",
      explicitOpen: false as never,
    });
    expect(db.rpcCalls).toHaveLength(0);
    expect(provider).not.toHaveBeenCalled();
    expect(storyEvidence(articles)).toHaveLength(1);
  });
  it("failed provider requests cannot retry on refresh", async () => {
    const db = fixture();
    provider.mockImplementation(async (opts: RoutedOptions) => {
      await opts.beforeProvider?.("usage");
      throw Object.assign(new Error("Rejected"), { status: 429 });
    });
    expect((await open(db)).status).toBe("failed");
    expect((await open(db)).status).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.rows("event_understanding")[0]?.["uncertain"]).toBe(false);
  });
  it("timeouts are uncertain, not free failures", async () => {
    const db = fixture();
    provider.mockImplementation(async (opts: RoutedOptions) => {
      await opts.beforeProvider?.("usage");
      throw new Error("Timeout");
    });
    await open(db);
    await open(db);
    expect(db.rows("event_understanding")[0]?.["uncertain"]).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.rows("event_understanding")[0]?.["attempts"]).toBe(1);
  });
  it.each([true, false])(
    "classifies truncation with settled usage=%s without an immediate retry",
    async (usageSettled) => {
      const db = fixture();
      provider.mockImplementation(async (opts: RoutedOptions) => {
        await opts.beforeProvider?.("usage");
        const error = new TruncatedCompletionError(
          "deepseek-v4-pro",
          4000,
          4096,
          100,
          4096,
          0,
          usageSettled,
        );
        error.usageSettled = usageSettled;
        throw error;
      });
      expect((await open(db)).status).toBe("failed");
      expect((await open(db)).status).toBe("skipped");
      expect(db.rows("event_understanding")[0]?.["uncertain"]).toBe(!usageSettled);
      expect(db.rows("event_understanding")[0]?.["attempts"]).toBe(1);
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps paid prose for the current reader and reconciles a staged save later", async () => {
    const db = fixture();
    const finish = db.rpcs["finish_shared_story"]!;
    db.rpcs["finish_shared_story"] = () => new Error("DB write unavailable");
    const first = await open(db);
    expect(first.status).toBe("generated");
    expect("understanding" in first && first.understanding?.article?.deck.text).toBe(
      prose.deck.text,
    );
    db.rpcs["finish_shared_story"] = finish;
    expect((await open(db)).status).toBe("cached");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("retries only persistence when staging fails, never pays again", async () => {
    const db = fixture();
    db.rpcs["stage_shared_story"] = () => new Error("DB outage");
    expect((await open(db)).status).toBe("generated");
    await open(db);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("does not buy JSON repair for malformed output", async () => {
    const db = fixture();
    provider.mockImplementation(async (opts: RoutedOptions) => {
      await opts.beforeProvider?.("usage");
      return { content: "bad JSON" };
    });
    expect((await open(db)).status).toBe("failed");
    await open(db);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("returns already-paid output even if storage throws a network exception", async () => {
    const db = fixture();
    db.rpcs["stage_shared_story"] = () => {
      throw new Error("Storage network unavailable");
    };
    expect((await open(db)).status).toBe("generated");
    await open(db);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("repeated boilerplate cannot masquerade as sufficient evidence", () => {
    expect(storyEvidence([{ ...articles[0]!, excerpt: "A brief update. ".repeat(100) }])).toEqual(
      [],
    );
  });
});
