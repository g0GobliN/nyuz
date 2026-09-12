import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The cost contract for on-demand Understand.
 *
 * Every test here is a statement about money: how many provider calls a given
 * sequence of reader actions is allowed to buy. A regression in this file is a
 * regression in the bill, which is why the assertions count calls rather than
 * inspect prose.
 */

type Row = Record<string, unknown>;

/**
 * A database stand-in with just enough behaviour to be wrong in the ways that
 * matter: the claim really is single-flight, and reads really do see writes.
 */
function fakeDb(options: { legacy?: unknown; rows?: Row[] } = {}) {
  const understanding: Row[] = [...(options.rows ?? [])];
  const calls: string[] = [];

  const api = {
    understanding,
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name !== "claim_event_understanding") return { data: null, error: null };
      const existing = understanding.find(
        (r) =>
          r["event_id"] === args["p_event_id"] &&
          r["content_version"] === args["p_content_version"],
      );
      if (!existing) {
        understanding.push({
          event_id: args["p_event_id"],
          content_version: args["p_content_version"],
          status: "generating",
          attempts: 1,
          payload: null,
        });
        return { data: "won", error: null };
      }
      if (existing["status"] === "ready") return { data: "ready", error: null };
      if (existing["status"] === "failed") return { data: "failed", error: null };
      return { data: "generating", error: null };
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const filters: Row = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table !== "event_understanding") return { data: null, error: null };
          const match = understanding.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        then: undefined,
        upsert: async (row: Row) => {
          const exists = understanding.find(
            (r) =>
              r["event_id"] === row["event_id"] && r["content_version"] === row["content_version"],
          );
          if (!exists) understanding.push({ ...row });
          return { data: null, error: null };
        },
        update: (patch: Row) => {
          const applied: Row = {};
          const chain: Record<string, unknown> = {
            eq: (column: string, value: unknown) => {
              applied[column] = value;
              return chain;
            },
          };
          // The update lands when the chain is awaited.
          (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
            for (const row of understanding) {
              if (Object.entries(applied).every(([k, v]) => row[k] === v))
                Object.assign(row, patch);
            }
            resolve({ data: null, error: null });
          };
          return chain;
        },
      };
      // A ready-row read that filters on status uses the same maybeSingle path.
      return builder as never;
    },
  };
  return api;
}

const ARTICLES = [
  {
    id: "a1",
    title: "Acme confirms Widget deal",
    excerpt: "Acme has confirmed it will acquire Widget Co for $2 billion.",
    published_at: "2026-09-12T00:00:00Z",
    source_id: "s1",
  },
];

/** A minimal but *valid* EventIntelligence payload, so parsing succeeds. */
const PAYLOAD = {
  coverage: "normal",
  one_sentence: "Acme is buying Widget Co.",
  article: {
    deck: { text: "Acme has confirmed a deal for Widget Co.", evidence: [1] },
    paragraphs: [{ text: "The acquisition was confirmed on Friday.", evidence: [1] }],
  },
};

let provider: ReturnType<typeof vi.fn>;

async function load(db: unknown) {
  vi.doMock("@/lib/ai/config", () => ({
    completeRoutedJson: provider,
    AiBudgetExceededError: class extends Error {},
  }));
  vi.doMock("@/lib/ai/runtime-config", () => ({
    loadAiRuntimeConfig: async () => ({ analyseMaxTokens: 4096 }),
  }));
  vi.doMock("@/lib/server/ops", () => ({ recordOps: async () => {} }));
  const mod = await import("./understanding");
  return { ...mod, db: db as never };
}

beforeEach(() => {
  vi.resetModules();
  provider = vi.fn(async () => ({
    data: PAYLOAD,
    usage: { model: "deepseek-v4-pro", promptTokens: 900, completionTokens: 500 },
    usageId: "ledger-1",
    route: {},
  }));
});

describe("the first open pays, and nobody else does", () => {
  it("makes exactly one provider call on the first uncached open", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const result = await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme confirms Widget deal", understand: null },
      ARTICLES,
    );
    expect(result.status).toBe("generated");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("makes zero provider calls on the second open", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const event = { id: "e1", title: "Acme confirms Widget deal", understand: null };
    await ensureUnderstanding(db as never, event, ARTICLES);
    provider.mockClear();
    const second = await ensureUnderstanding(db as never, event, ARTICLES);
    expect(second.status).toBe("cached");
    expect(provider).not.toHaveBeenCalled();
  });

  it("makes zero further calls for a hundred more readers", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const event = { id: "e1", title: "Acme confirms Widget deal", understand: null };
    await ensureUnderstanding(db as never, event, ARTICLES);
    provider.mockClear();
    for (let reader = 0; reader < 100; reader++) {
      await ensureUnderstanding(db as never, event, ARTICLES);
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it("labels the call understand_generation and never leaves it unattributed", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme confirms Widget deal", understand: null },
      ARTICLES,
    );
    const sent = provider.mock.calls[0]?.[0] as { feature?: string; eventIds?: string[] };
    expect(sent.feature).toBe("understand_generation");
    expect(sent.eventIds).toStrictEqual(["e1"]);
  });
});

describe("existing content is reused, never regenerated", () => {
  it("serves legacy events.understand without calling the provider", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const result = await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme confirms Widget deal", understand: PAYLOAD },
      ARTICLES,
    );
    expect(result.status).toBe("cached");
    expect(provider).not.toHaveBeenCalled();
  });

  it("adopts legacy content at the current version so later changes are detectable", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme confirms Widget deal", understand: PAYLOAD },
      ARTICLES,
    );
    expect(db.understanding).toHaveLength(1);
    expect(db.understanding[0]?.["prompt_version"]).toBe("legacy:analysis");
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not regenerate when another outlet publishes the same facts", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const event = { id: "e1", title: "Acme confirms Widget deal", understand: PAYLOAD };
    await ensureUnderstanding(db as never, event, ARTICLES);
    provider.mockClear();
    await ensureUnderstanding(db as never, event, [
      ...ARTICLES,
      {
        id: "a2",
        title: "Acme to buy Widget Co",
        excerpt: "Acme has confirmed it will acquire Widget Co for $2 billion.",
        published_at: "2026-09-12T01:00:00Z",
        source_id: "s2",
      },
    ]);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  it("buys one generation when two readers open the same uncached story at once", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const event = { id: "e1", title: "Acme confirms Widget deal", understand: null };
    const [first, second] = await Promise.all([
      ensureUnderstanding(db as never, event, ARTICLES),
      ensureUnderstanding(db as never, event, ARTICLES),
    ]);

    // The assertion that matters. Which of the two won the claim is a race and
    // not worth pinning; that only one of them paid is the whole point.
    expect(provider).toHaveBeenCalledTimes(1);

    // The loser must still end up with words — either by waiting for the
    // winner's row or by finding it already written. What it must never be is
    // a second generation or a failure.
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toContain("generated");
    expect(outcomes.some((outcome) => outcome === "cached" || outcome === "waited")).toBe(true);
  });

  it("waits for an in-flight generation rather than starting a second one", async () => {
    const db = fakeDb();
    // A generation slow enough that the second reader genuinely arrives while
    // the claim is still held, which is the case the single-flight exists for.
    // Initialised to a no-op rather than null so control-flow analysis keeps it
    // callable: TypeScript cannot see that the Promise executor runs eagerly.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    provider = vi.fn(async () => {
      await held;
      return {
        data: PAYLOAD,
        usage: { model: "deepseek-v4-pro", promptTokens: 900, completionTokens: 500 },
        usageId: "ledger-1",
        route: {},
      };
    });
    const { ensureUnderstanding } = await load(db);
    const event = { id: "e1", title: "Acme confirms Widget deal", understand: null };

    const winner = ensureUnderstanding(db as never, event, ARTICLES);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const loser = ensureUnderstanding(db as never, event, ARTICLES);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();

    const [a, b] = await Promise.all([winner, loser]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("generated");
    expect(b.status).toBe("waited");
    expect(b.status === "waited" ? b.understanding : null).not.toBeNull();
  });
});

describe("failure is bounded", () => {
  it("does not spend when the claim returns an unexpected result", async () => {
    const db = fakeDb();
    db.rpc = async () => ({ data: "unexpected", error: null });
    const { ensureUnderstanding } = await load(db);
    const result = await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme", understand: null },
      ARTICLES,
    );
    expect(result.status).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not retry an event whose generation already failed too often", async () => {
    const db = fakeDb({
      rows: [
        {
          event_id: "e1",
          content_version: "does-not-matter",
          status: "failed",
          attempts: 3,
          payload: null,
        },
      ],
    });
    const { ensureUnderstanding } = await load(db);
    // Force the stored row onto the version this event will compute by asking
    // the claim to report 'failed' for anything it sees.
    db.rpc = async () => ({ data: "failed", error: null });
    const result = await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Acme confirms Widget deal", understand: null },
      ARTICLES,
    );
    expect(result.status).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
  });

  it("never generates for an event with no coverage", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    const result = await ensureUnderstanding(
      db as never,
      { id: "e1", title: "Nothing", understand: null },
      [],
    );
    expect(result.status).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("material changes and citations", () => {
  it.each([null, PAYLOAD])(
    "generates once for a material change after adopting or generating content",
    async (legacy) => {
      const db = fakeDb();
      const { ensureUnderstanding } = await load(db);
      const event = { id: "e1", title: "Acme deal", understand: legacy };
      await ensureUnderstanding(db as never, event, ARTICLES);
      provider.mockClear();
      const changed = [
        {
          ...ARTICLES[0]!,
          excerpt: "Acme has confirmed it will acquire Widget Co for $30 billion.",
        },
      ];
      expect((await ensureUnderstanding(db as never, event, changed)).status).toBe("generated");
      expect((await ensureUnderstanding(db as never, event, changed)).status).toBe("cached");
      expect(provider).toHaveBeenCalledTimes(1);
      expect(db.understanding).toHaveLength(2);
    },
  );

  it("stores article IDs in prompt order for citation remapping", async () => {
    const db = fakeDb();
    const { ensureUnderstanding } = await load(db);
    await ensureUnderstanding(db as never, { id: "e1", title: "Acme", understand: null }, ARTICLES);
    expect(db.understanding[0]?.["payload"]).toMatchObject({
      analysisMeta: { sourceArticleIds: ["a1"], sourceCountAtAnalysis: 1 },
    });
  });
});
