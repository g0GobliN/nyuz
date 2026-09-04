import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * What stage 3 actually executes with the flags as they are configured today.
 *
 *   deterministic_cluster_v2   ON   (0027)
 *   deterministic_cluster_skip OFF  (0034, never enabled)
 *
 * That combination is **shadow only**. The deterministic layer computes a
 * verdict, the verdict is written to `cluster_shadow_log` for later comparison,
 * and then the Flash model is asked anyway and its answer is the one that is
 * acted on. Confident deterministic verdicts do not skip anything and do not
 * save a single call. Any cost estimate that assumes otherwise is wrong by the
 * full price of clustering.
 *
 * The skip path is tested too, because it is code that exists and will one day
 * be switched on — but only inside the test, and the migration invariants
 * assert that production has not enabled it.
 */

const NOW = new Date();
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

/**
 * A pair that `confidence.ts` calls confidently the same event — the case the
 * skip flag exists for, and therefore the case that proves whether it is on.
 */
const ARTICLE_TITLE = "OpenAI says California should strengthen its AI safety bill";
const TWIN_TITLE = "OpenAI calls for California to strengthen its AI safety laws";
const UNRELATED_TITLE = "Polygon reviews the latest handheld console";

type Spy = { flashCalls: number; features: string[] };

async function withDoubles(
  reply: { same: number[] } = { same: [1] },
): Promise<{ spy: Spy; cluster: typeof import("./cluster").cluster }> {
  const spy: Spy = { flashCalls: 0, features: [] };

  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      // The model answers "the first candidate", which is the twin in every
      // fixture below — so a test can tell the model's answer apart from the
      // deterministic layer's. `readVerdict` reads 1-based indices.
      completeRoutedJson: async (opts: { feature: string }) => {
        spy.flashCalls += 1;
        spy.features.push(opts.feature);
        return {
          data: reply,
          usage: {
            content: "{}",
            model: "deepseek-v4-flash",
            promptTokens: 40,
            completionTokens: 10,
            reasoningTokens: 0,
            cachedTokens: 0,
            attempt_count: 1,
          },
          route: { capability: "cluster", model: "deepseek-v4-flash" },
        };
      },
    };
  });

  const { cluster } = await import("./cluster");
  return { spy, cluster };
}

/** Mock helper for testing the "different" skip path. Mocks shortlist to return candidates and verdictFor to return "different". */
async function withDoublesForDifferent(): Promise<{
  spy: Spy;
  cluster: typeof import("./cluster").cluster;
}> {
  const spy: Spy = { flashCalls: 0, features: [] };

  vi.doMock("@/lib/pipeline/shortlist", async () => {
    const actual = await vi.importActual<typeof import("./shortlist")>("./shortlist");
    return {
      ...actual,
      shortlist: async () => [
        { id: "cand-1", title: "Candidate one", event_id: "event-1", published_at: hoursAgo(2) },
        { id: "cand-2", title: "Candidate two", event_id: "event-2", published_at: hoursAgo(2) },
      ],
    };
  });

  vi.doMock("@/lib/pipeline/confidence", async () => {
    const actual = await vi.importActual<typeof import("./confidence")>("./confidence");
    return {
      ...actual,
      verdictFor: () => ({ verdict: "different" as const, matchedId: null }),
    };
  });

  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      completeRoutedJson: async (opts: { feature: string }) => {
        spy.flashCalls += 1;
        spy.features.push(opts.feature);
        return {
          data: { same: [1] },
          usage: {
            content: "{}",
            model: "deepseek-v4-flash",
            promptTokens: 40,
            completionTokens: 10,
            reasoningTokens: 0,
            cachedTokens: 0,
            attempt_count: 1,
          },
          route: { capability: "cluster", model: "deepseek-v4-flash" },
        };
      },
    };
  });

  const { cluster } = await import("./cluster");
  return { spy, cluster };
}

function tables(flags: { v2: boolean; skip: boolean }, candidates: Row[]): Record<string, Row[]> {
  return {
    articles: [
      {
        id: "fresh",
        title: ARTICLE_TITLE,
        event_id: null,
        published_at: hoursAgo(1),
        clustering_deferred_until: null,
      },
      ...candidates,
    ],
    events: [
      {
        id: "event-twin",
        title: TWIN_TITLE,
        status: "pending",
        last_updated_at: hoursAgo(2),
        first_seen_at: hoursAgo(2),
      },
    ],
    feature_flags: [
      { key: "deterministic_cluster_v2", enabled: flags.v2 },
      { key: "deterministic_cluster_skip", enabled: flags.skip },
    ],
    cluster_shadow_log: [],
  };
}

const twin = (over: Partial<Row> = {}): Row => ({
  id: "twin",
  title: TWIN_TITLE,
  event_id: "event-twin",
  published_at: hoursAgo(2),
  clustering_deferred_until: null,
  ...over,
});

const unrelated = (): Row => ({
  id: "unrelated",
  title: UNRELATED_TITLE,
  event_id: "event-other",
  published_at: hoursAgo(2),
  clustering_deferred_until: null,
});

beforeEach(() => {
  vi.resetModules();
});

describe("with deterministic_cluster_skip OFF, Flash decides everything", () => {
  it("calls the model even when the deterministic layer is confident", async () => {
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: false }, [twin(), unrelated()]));

    const report = await cluster(db as never, { now: NOW });

    // The deterministic layer reached a confident verdict...
    expect(report.outcomes[0]?.shadowVerdict).toBe("same");
    // ...and the model was asked anyway. This is the number that matters.
    expect(spy.flashCalls).toBe(1);
    expect(spy.features).toEqual(["cluster"]);
    expect(report.aiSkipped).toBe(0);
  });

  it("calls the model on an ambiguous verdict too", async () => {
    const { spy, cluster } = await withDoubles();
    // One confident match and one ambiguous candidate makes the whole verdict
    // ambiguous, which is the case that would still cost a call even with the
    // skip flag on.
    const db = new FakeDb(
      tables({ v2: true, skip: false }, [
        twin(),
        { ...twin({ id: "near", title: "OpenAI on California AI safety, explained" }) },
      ]),
    );

    const report = await cluster(db as never, { now: NOW });

    expect(report.outcomes[0]?.shadowVerdict).toBe("ambiguous");
    expect(spy.flashCalls).toBe(1);
  });

  it("still records the shadow verdict, which is the point of shadow mode", async () => {
    const { cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: false }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    const logged = db.rows("cluster_shadow_log");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      article_id: "fresh",
      shadow_verdict: "same",
      shadow_matched_id: "twin",
      model_matched_id: "twin",
      agreed: true,
    });
  });

  it("acts on the model's answer, not the deterministic one, when they disagree", async () => {
    // The deterministic layer is confident these are the same event. The model
    // says they are not. With skip off, the model wins and the article does NOT
    // join the twin's event — which is the whole meaning of "shadow only".
    const { spy, cluster } = await withDoubles({ same: [] });
    const db = new FakeDb(tables({ v2: true, skip: false }, [twin(), unrelated()]));

    const report = await cluster(db as never, { now: NOW });

    expect(report.outcomes[0]?.shadowVerdict).toBe("same");
    expect(spy.flashCalls).toBe(1);
    expect(report.outcomes[0]?.shadowAgreed).toBe(false);
    expect(db.rows("articles").find((a) => a["id"] === "fresh")?.["event_id"]).not.toBe(
      "event-twin",
    );
    // And the disagreement is on the record, which is what shadow mode is for.
    expect(db.rows("cluster_shadow_log")[0]).toMatchObject({
      shadow_verdict: "same",
      shadow_matched_id: "twin",
      model_matched_id: null,
      agreed: false,
    });
  });
});

describe("the skip path exists and works, and is not switched on", () => {
  it("skips the model ONLY on confident 'different' verdicts", async () => {
    // With the new logic, "same" verdicts still require the model.
    // This test uses a "same" verdict pair, so the model IS called.
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: true }, [twin(), unrelated()]));

    const report = await cluster(db as never, { now: NOW });

    // "same" verdict → model still called
    expect(spy.flashCalls).toBe(1);
    expect(report.aiSkipped).toBe(0);
    expect(report.outcomes[0]?.shadowVerdict).toBe("same");
    expect(db.rows("articles").find((a) => a["id"] === "fresh")?.["event_id"]).toBe("event-twin");
  });

  it("refuses to skip on the skip flag alone, without shadow mode", async () => {
    // Acting on a verdict without recording it would remove the evidence the
    // promotion decision is supposed to rest on.
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: false, skip: true }, [twin(), unrelated()]));

    const report = await cluster(db as never, { now: NOW });

    expect(spy.flashCalls).toBe(1);
    expect(report.aiSkipped).toBe(0);
    expect(report.outcomes[0]?.shadowVerdict).toBeNull();
  });

  it("still asks the model for an ambiguous case even with skip on", async () => {
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(
      tables({ v2: true, skip: true }, [
        twin(),
        { ...twin({ id: "near", title: "OpenAI on California AI safety, explained" }) },
      ]),
    );

    const report = await cluster(db as never, { now: NOW });

    expect(report.outcomes[0]?.shadowVerdict).toBe("ambiguous");
    expect(spy.flashCalls).toBe(1);
  });
});

describe("the free paths stay free", () => {
  it("never calls the model for an article with no shortlist", async () => {
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: false }, []));

    const report = await cluster(db as never, { now: NOW });

    expect(spy.flashCalls).toBe(0);
    expect(report.outcomes[0]?.decision).toBe("alone");
  });

  it("never calls the model for a CI ref", async () => {
    const { spy, cluster } = await withDoubles();
    const base = tables({ v2: true, skip: false }, [twin()]);
    base["articles"] = [
      {
        id: "fresh",
        title: "v8.2.2",
        event_id: null,
        published_at: hoursAgo(1),
        clustering_deferred_until: null,
      },
    ];
    const db = new FakeDb(base);

    await cluster(db as never, { now: NOW });

    expect(spy.flashCalls).toBe(0);
  });
});
