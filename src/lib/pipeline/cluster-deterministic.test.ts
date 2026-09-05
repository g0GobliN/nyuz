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
  // `resetModules` clears the module registry but not the mock registry, so a
  // `doMock` from an earlier test would still apply to the next dynamic import.
  // `withDoublesForDifferent` replaces `shortlist` and `verdictFor` wholesale,
  // and leaking those into "the free paths stay free" gives an article with no
  // headline tokens a two-candidate shortlist — which is how a test asserting
  // zero model calls sees one.
  vi.doUnmock("@/lib/pipeline/shortlist");
  vi.doUnmock("@/lib/pipeline/confidence");
  vi.doUnmock("@/lib/ai/config");
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

/**
 * 0057. The promotion decision needs a rate, and a rate needs a denominator.
 *
 * Before 0057 a row was written only where `agreed` was non-null, so every
 * ambiguous verdict — the ones that would still cost a call — was absent. On
 * 2026-09-05 the live table held 98 rows against 884 real clustering calls, and
 * read alone it said the deterministic layer was confident on 94.9% of calls
 * when the true figure was 11.1%. These tests pin the fix: a row per shortlisted
 * article, whatever happened.
 */
describe("every shortlisted article is on the record", () => {
  it("records the ambiguous verdicts that make up the denominator", async () => {
    const { cluster } = await withDoubles();
    const db = new FakeDb(
      tables({ v2: true, skip: false }, [
        twin(),
        { ...twin({ id: "near", title: "OpenAI on California AI safety, explained" }) },
      ]),
    );

    await cluster(db as never, { now: NOW });

    const logged = db.rows("cluster_shadow_log");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      shadow_verdict: "ambiguous",
      // The model was called and paid for, which is exactly why this row has to
      // exist: it is one unit of the cost a bypass would have to beat.
      model_called: true,
      bypass_reason: null,
      agreed: null,
    });
  });

  it("stamps the decision the article actually received, not the verdict alone", async () => {
    const { cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: false }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    expect(db.rows("cluster_shadow_log")[0]).toMatchObject({
      decision: "attached",
      model_called: true,
    });
  });

  it("groups a run under one run_id so it can be read back whole", async () => {
    const { cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: false }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    const runId = db.rows("cluster_shadow_log")[0]?.["run_id"];
    expect(typeof runId).toBe("string");
    expect(runId).not.toBe("");
  });

  it("writes nothing when shadow mode is off, so the flag still means something", async () => {
    const { cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: false, skip: false }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    expect(db.rows("cluster_shadow_log")).toHaveLength(0);
  });
});

/**
 * The asymmetry this whole stage is built around: a wrongly split event costs
 * one extra analysis, a wrongly merged event misinforms every reader who gets
 * it. Every test here is about the second kind.
 */
describe("false merges", () => {
  it("never bypasses the model on a 'same' verdict, even with skip on", async () => {
    // The measured agreement on 'same' is 3 of 5. Acting on that would merge two
    // unrelated stories two times in five, so the skip path must not touch it
    // however confident the deterministic layer claims to be.
    const { spy, cluster } = await withDoubles();
    const db = new FakeDb(tables({ v2: true, skip: true }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    expect(spy.flashCalls).toBe(1);
    expect(db.rows("cluster_shadow_log")[0]).toMatchObject({
      shadow_verdict: "same",
      model_called: true,
      bypass_reason: null,
    });
  });

  it("a bypassed article starts its own event and joins nothing", async () => {
    // The failure mode of the 'different' fast path has to stay the cheap one.
    // If a skipped article could still be attached to something, a wrong verdict
    // would merge rather than split, and the safety argument would be void.
    const { spy, cluster } = await withDoublesForDifferent();
    const db = new FakeDb(tables({ v2: true, skip: true }, [twin(), unrelated()]));

    const report = await cluster(db as never, { now: NOW });

    expect(spy.flashCalls).toBe(0);
    expect(report.aiSkipped).toBe(1);
    const fresh = db.rows("articles").find((a) => a["id"] === "fresh");
    expect(fresh?.["event_id"]).not.toBe("event-twin");
    expect(fresh?.["event_id"]).not.toBe("event-other");
    expect(report.outcomes[0]?.decision).toBe("alone");
  });

  it("records a bypass with its reason, so a skipped call is auditable", async () => {
    const { cluster } = await withDoublesForDifferent();
    const db = new FakeDb(tables({ v2: true, skip: true }, [twin(), unrelated()]));

    await cluster(db as never, { now: NOW });

    expect(db.rows("cluster_shadow_log")[0]).toMatchObject({
      shadow_verdict: "different",
      model_called: false,
      bypass_reason: "deterministic:different",
      // No model ran, so there is no ledger row and nothing to compare against.
      usage_id: null,
      agreed: null,
    });
  });

  it("two plausible candidates are ambiguous, never a coin-flip merge", async () => {
    // `verdictFor` refuses to pick when more than one candidate looks confidently
    // the same, because attaching to the wrong one of two is a false merge that
    // no later stage can detect. Asserted directly: the unit that would have to
    // be wrong for the fast path to corrupt an event.
    const { verdictFor } = await import("./confidence");
    const verdict = verdictFor("Nvidia agrees $13 billion Hugging Face acquisition", [
      { id: "a", title: "Nvidia agrees $13 billion Hugging Face acquisition" },
      { id: "b", title: "Nvidia agrees $13 billion Hugging Face acquisition" },
    ]);

    expect(verdict.verdict).toBe("ambiguous");
    expect(verdict.matchedId).toBeNull();
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
