import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";

/**
 * What stage 4 refuses to pay for.
 *
 * Every test here answers one question with a number: after this run, how many
 * provider calls were made and how many reservations were written? Both are
 * counted by the double that stands in for `completeRoutedJson`, which reserves
 * before it "calls" exactly as the real one does — so `reservations: 0` means
 * the stage never reached the routed call at all, and `reservations: 1,
 * providerCalls: 0` would mean a budget refused it. Anything that claims to
 * save money and cannot show a zero here is not saving money.
 *
 * The rule under test, stated once:
 *
 *   A row does not become eligible for another paid call because it has been
 *   `analysing` for a while. Age is not evidence that the first call did not
 *   happen. Abandoned *budget* is recovered by the reservation reaper (0047);
 *   abandoned *work* is recovered by an operator naming the event.
 */

/**
 * Anchored to the real clock, not a fixed instant, because `claimEvent`
 * measures the stale window with `Date.now()`. A frozen `options.now` in the
 * future would make every seeded row look freshly claimed and quietly turn the
 * recovery tests green for the wrong reason.
 */
const NOW = new Date();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

type Spy = {
  providerCalls: number;
  reservations: number;
  features: string[];
};

/**
 * Installs the module doubles and returns the counters.
 *
 * `completeRoutedJson` is replaced rather than stubbed at the transport, so the
 * count is "calls this stage decided to make". The reservation is incremented
 * first, because that is the real order: `reserveUsage` writes the ledger row
 * before the provider is contacted, and a test that counted them the other way
 * round could not tell "blocked by a gate" from "blocked by a budget".
 */
async function withDoubles(): Promise<{ spy: Spy; analyse: typeof import("./analyse").analyse }> {
  const spy: Spy = { providerCalls: 0, reservations: 0, features: [] };

  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("./../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      resolvePrompt: async () => "SYSTEM PROMPT",
      completeRoutedJson: async (opts: { feature: string }) => {
        spy.reservations += 1;
        spy.providerCalls += 1;
        spy.features.push(opts.feature);
        return {
          data: {
            title: "A title",
            what_happened: "Something happened.",
            before_state: "Before.",
            after_state: "After.",
            importance: 6,
            novelty: 5,
            topics: ["ai"],
            impact: "It matters.",
          },
          usage: {
            content: "{}",
            model: "deepseek-v4-pro",
            promptTokens: 100,
            completionTokens: 50,
            reasoningTokens: 0,
            cachedTokens: 0,
            attempt_count: 1,
          },
          route: { capability: "reason", model: "deepseek-v4-pro" },
        };
      },
    };
  });

  const { analyse } = await import("./analyse");
  return { spy, analyse };
}

function event(over: Partial<Row> = {}): Row {
  return {
    id: "event-1",
    title: "OpenAI ships a reasoning model",
    status: "pending",
    analysis_tokens: 0,
    analysed_at: null,
    analysis_deferred_until: null,
    last_updated_at: minutesAgo(60),
    first_seen_at: minutesAgo(60),
    understand: null,
    ...over,
  };
}

function baseTables(events: Row[]): Record<string, Row[]> {
  return {
    events,
    articles: [
      {
        id: "article-1",
        event_id: "event-1",
        title: "OpenAI ships a reasoning model",
        excerpt: "The lab released it this morning.",
        published_at: minutesAgo(90),
        source_id: "source-1",
      },
      {
        id: "article-2",
        event_id: "event-1",
        title: "Reaction to OpenAI's new model",
        excerpt: "Rivals respond.",
        published_at: minutesAgo(80),
        source_id: "source-2",
      },
    ],
    topics: [{ id: "topic-ai", slug: "ai", label: "AI", kind: "predefined" }],
    sources: [
      { id: "source-1", name: "The Verge" },
      { id: "source-2", name: "Ars Technica" },
    ],
    feature_flags: [],
    event_topics: [],
    event_impacts: [],
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("an aged claim is not permission to spend again", () => {
  it("makes no call when another worker claims the event between select and claim", async () => {
    const { spy, analyse } = await withDoubles();

    // Worker A wins the race: the row is `pending` when worker B selects it and
    // `analysing` a moment later, which is exactly the window the conditional
    // update exists to close.
    const db = new FakeDb(
      baseTables([event()]),
      {},
      {
        afterSelect: (table, rows) => {
          if (table !== "events" || rows.length === 0) return;
          const row = db.rows("events")[0];
          if (row && row["status"] === "pending") {
            row["status"] = "analysing";
            row["last_updated_at"] = minutesAgo(1);
          }
        },
      },
    );

    const report = await analyse(db as never, { now: NOW });

    expect(report.claimed).toBe(1);
    expect(report.analysed).toBe(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });

  it("still makes no call once that claim is older than the stale window", async () => {
    // The whole point. Fifteen minutes have passed, worker A is gone, and a
    // normal cron worker must STILL not buy this analysis a second time.
    const { spy, analyse } = await withDoubles();

    const db = new FakeDb(
      baseTables([event({ status: "analysing", last_updated_at: minutesAgo(45) })]),
    );
    const report = await analyse(db as never, { now: NOW });

    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
    expect(report.considered).toBe(0);
    expect(db.rows("events")[0]?.["status"]).toBe("analysing");
  });

  it("makes no call even when the aged row is handed straight to the claim", async () => {
    // Belt and braces: `selectEvents` already filters `analysing` out, so this
    // drives the claim itself, with a row that is aged past the stale window
    // and offered to the batch anyway. If the claim ever grows a
    // "...or it is old" branch, this is the test that fails.
    const { spy, analyse } = await withDoubles();

    const db = new FakeDb(
      baseTables([event({ status: "pending", last_updated_at: minutesAgo(45) })]),
      {},
      {
        afterSelect: (table) => {
          if (table !== "events") return;
          const row = db.rows("events")[0];
          if (row && row["status"] === "pending") {
            row["status"] = "analysing";
            row["last_updated_at"] = minutesAgo(45);
          }
        },
      },
    );

    const report = await analyse(db as never, { now: NOW });

    expect(report.claimed).toBe(1);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });

  it("lets an operator naming the event recover it, and that costs exactly one call", async () => {
    // The test that stops the four above from passing vacuously: the recovery
    // path still works, and it is a deliberate act, not a cron.
    const { spy, analyse } = await withDoubles();

    const db = new FakeDb(
      baseTables([event({ status: "analysing", last_updated_at: minutesAgo(45) })]),
    );
    const report = await analyse(db as never, { now: NOW, eventIds: ["event-1"] });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
    expect(spy.reservations).toBe(1);
    expect(db.rows("events")[0]?.["status"]).toBe("complete");
  });

  it("refuses even the operator when a live worker is holding the event", async () => {
    const { spy, analyse } = await withDoubles();

    const db = new FakeDb(
      baseTables([event({ status: "analysing", last_updated_at: minutesAgo(2) })]),
    );
    const report = await analyse(db as never, { now: NOW, eventIds: ["event-1"] });

    expect(report.claimed).toBe(1);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });

  it("never re-analyses an event that already has an analysis", async () => {
    const { spy, analyse } = await withDoubles();

    const db = new FakeDb(
      baseTables([event({ status: "complete", analysed_at: minutesAgo(200) })]),
    );
    const report = await analyse(db as never, { now: NOW, eventIds: ["event-1"] });

    expect(report.analysed).toBe(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });
});

describe("work that is explicitly retryable does retry, when it is due", () => {
  it("analyses a pending event", async () => {
    const { spy, analyse } = await withDoubles();
    const db = new FakeDb(baseTables([event()]));

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
    expect(spy.reservations).toBe(1);
    expect(spy.features).toEqual(["analyse"]);
  });

  it("waits for a deferred event's retry time and then takes it", async () => {
    const notYet = await withDoubles();
    const early = new FakeDb(
      baseTables([
        event({ analysis_deferred_until: new Date(NOW.getTime() + 30 * 60_000).toISOString() }),
      ]),
    );
    const before = await notYet.analyse(early as never, { now: NOW });
    expect(before.considered).toBe(0);
    expect(notYet.spy.providerCalls).toBe(0);
    expect(notYet.spy.reservations).toBe(0);

    vi.resetModules();
    const due = await withDoubles();
    const later = new FakeDb(baseTables([event({ analysis_deferred_until: minutesAgo(5) })]));
    const after = await due.analyse(later as never, { now: NOW });
    expect(after.analysed).toBe(1);
    expect(due.spy.providerCalls).toBe(1);
  });

  it("leaves a failed event alone unless the run asks for failures", async () => {
    const skipped = await withDoubles();
    const db = new FakeDb(baseTables([event({ status: "failed" })]));
    await skipped.analyse(db as never, { now: NOW });
    expect(skipped.spy.providerCalls).toBe(0);
    expect(skipped.spy.reservations).toBe(0);

    vi.resetModules();
    const asked = await withDoubles();
    const retry = new FakeDb(baseTables([event({ status: "failed" })]));
    const report = await asked.analyse(retry as never, { now: NOW, retryFailed: true });
    expect(report.analysed).toBe(1);
    expect(asked.spy.providerCalls).toBe(1);
  });
});

describe("the demand gate decides before any money is committed", () => {
  const gateOn = (): Row[] => [{ key: "pre_analysis_demand_gate", enabled: true }];

  it("spends nothing when no reader anywhere is reached by this event", async () => {
    const { spy, analyse } = await withDoubles();

    const tables = baseTables([event()]);
    tables["feature_flags"] = gateOn();
    // Zero readers: the demand-aware selector returns nothing at all.
    const db = new FakeDb(tables, { pending_events_with_demand: () => [] });

    const report = await analyse(db as never, { now: NOW });

    expect(report.considered).toBe(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });

  it("analyses an event a matching reader reaches", async () => {
    const { spy, analyse } = await withDoubles();

    const tables = baseTables([event()]);
    tables["feature_flags"] = gateOn();
    const db = new FakeDb(tables, {
      pending_events_with_demand: () => [
        {
          id: "event-1",
          title: "OpenAI ships a reasoning model",
          status: "pending",
          analysis_tokens: 0,
        },
      ],
      events_with_demand: () => [{ event_id: "event-1", has_demand: true }],
    });

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
    expect(spy.reservations).toBe(1);
  });

  it("skips an event whose only readers do not match it", async () => {
    const { spy, analyse } = await withDoubles();

    const tables = baseTables([event()]);
    tables["feature_flags"] = gateOn();
    // The selector offered it, the per-event check says nobody is reached.
    const db = new FakeDb(tables, {
      pending_events_with_demand: () => [
        {
          id: "event-1",
          title: "OpenAI ships a reasoning model",
          status: "pending",
          analysis_tokens: 0,
        },
      ],
      events_with_demand: () => [{ event_id: "event-1", has_demand: false }],
    });

    const report = await analyse(db as never, { now: NOW });

    expect(report.noDemand).toBe(1);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
    // Left pending, so it becomes eligible the moment a reader does match.
    expect(db.rows("events")[0]?.["status"]).toBe("pending");
  });

  it("becomes eligible when a new reader arrives, without an operator touching it", async () => {
    // The backfill case: same event, same row, second run, demand now exists.
    const first = await withDoubles();
    const tables = baseTables([event()]);
    tables["feature_flags"] = gateOn();

    let demanded = false;
    const db = new FakeDb(tables, {
      pending_events_with_demand: () => [
        {
          id: "event-1",
          title: "OpenAI ships a reasoning model",
          status: "pending",
          analysis_tokens: 0,
        },
      ],
      events_with_demand: () => [{ event_id: "event-1", has_demand: demanded }],
    });

    await first.analyse(db as never, { now: NOW });
    expect(first.spy.providerCalls).toBe(0);

    demanded = true;
    vi.resetModules();
    const second = await withDoubles();
    const report = await second.analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(second.spy.providerCalls).toBe(1);
    expect(second.spy.reservations).toBe(1);
  });

  it("spends nothing when the demand check itself fails", async () => {
    const { spy, analyse } = await withDoubles();

    const tables = baseTables([event()]);
    tables["feature_flags"] = gateOn();
    const db = new FakeDb(tables, {
      pending_events_with_demand: () => [
        {
          id: "event-1",
          title: "OpenAI ships a reasoning model",
          status: "pending",
          analysis_tokens: 0,
        },
      ],
      events_with_demand: () => new Error("connection reset"),
    });

    const report = await analyse(db as never, { now: NOW });

    expect(report.demandCheckFailed).toBe(1);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });
});

describe("a core source is not a reader (0054)", () => {
  /**
   * `coverage_mode = 'core'` used to satisfy the demand gate on its own, which
   * meant an instance with nobody signed up still paid for Pro analysis on
   * every event a core outlet produced. 0054 removes that branch from the two
   * gate functions and nowhere else: core sources are still fetched, ingested,
   * deduplicated, clustered and stored.
   *
   * The demand SQL cannot run in this suite, so the two RPC doubles below
   * evaluate 0054's predicate over the seeded rows rather than returning a
   * fixed answer. A double that just said "no demand" would pass whatever the
   * migration did; this one has to be given a reader before it says yes, and
   * `demandsCore` flips it back to the pre-0054 behaviour so the tests can be
   * shown to fail against the version being replaced.
   */
  type Reader = { topics: string[]; customSources: string[]; reachable: boolean };

  function demandRpcs(
    tables: Record<string, Row[]>,
    readers: Reader[],
    options: { demandsCore?: boolean } = {},
  ) {
    // Reads the same arrays `FakeDb` was handed, so a row written during the
    // run is visible to the gate on the next call, as it would be in Postgres.
    const rows = (table: string): Row[] => tables[table] ?? [];

    const hasDemand = (eventId: string): boolean => {
      const sourceIds = rows("articles")
        .filter((a) => a["event_id"] === eventId)
        .map((a) => String(a["source_id"]));
      const sources = rows("sources").filter((s) => sourceIds.includes(String(s["id"])));

      // The branch 0054 deletes. Off by default; on to reproduce the old gate.
      if (options.demandsCore === true && sources.some((s) => s["coverage_mode"] === "core")) {
        return true;
      }

      const topics = rows("source_topics")
        .filter((st) => sourceIds.includes(String(st["source_id"])))
        .map((st) => String(st["topic_id"]));

      return readers.some(
        (r) =>
          r.reachable &&
          (r.topics.some((t) => topics.includes(t)) ||
            r.customSources.some((id) => sourceIds.includes(id))),
      );
    };

    return {
      events_with_demand: (args: Record<string, unknown>) =>
        (args["p_event_ids"] as string[]).map((id) => ({
          event_id: id,
          has_demand: hasDemand(id),
        })),
      pending_events_with_demand: () =>
        rows("events")
          .filter(
            (e) =>
              e["analysed_at"] === null && e["status"] === "pending" && hasDemand(String(e["id"])),
          )
          .map((e) => ({
            id: e["id"],
            title: e["title"],
            status: e["status"],
            analysis_tokens: e["analysis_tokens"],
          })),
    };
  }

  function coreTables(): Record<string, Row[]> {
    const tables = baseTables([event()]);
    tables["feature_flags"] = [{ key: "pre_analysis_demand_gate", enabled: true }];
    tables["sources"] = [
      { id: "source-1", name: "Core Outlet", coverage_mode: "core" },
      { id: "source-2", name: "Core Outlet Two", coverage_mode: "core" },
    ];
    tables["source_topics"] = [
      { source_id: "source-1", topic_id: "topic-ai" },
      { source_id: "source-2", topic_id: "topic-ai" },
    ];
    return tables;
  }

  const reader = (over: Partial<Reader> = {}): Reader => ({
    topics: ["topic-ai"],
    customSources: [],
    reachable: true,
    ...over,
  });

  it("makes no Pro call and no reservation for a core-source event with zero readers", async () => {
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, []));

    const report = await analyse(db as never, { now: NOW });

    expect(report.considered).toBe(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
    // Stored, clustered and left pending — not failed, not deleted.
    expect(db.rows("events")[0]?.["status"]).toBe("pending");
    expect(db.rows("events")[0]?.["analysed_at"]).toBeNull();
  });

  it("would have paid for that same event under the pre-0054 gate", async () => {
    // The control that gives the zero above its meaning: nothing else about the
    // fixture changes, only whether `coverage_mode = 'core'` counts as demand.
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, [], { demandsCore: true }));

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
  });

  it("analyses a core-source event once a matching reader exists", async () => {
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, [reader()]));

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
    expect(spy.reservations).toBe(1);
    expect(spy.features).toEqual(["analyse"]);
  });

  it("analyses a non-core event for a matching reader, exactly as before", async () => {
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    tables["sources"] = [
      { id: "source-1", name: "Demand Outlet", coverage_mode: "demand" },
      { id: "source-2", name: "Demand Outlet Two", coverage_mode: "demand" },
    ];
    const db = new FakeDb(tables, demandRpcs(tables, [reader()]));

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
  });

  it("makes a pending core event eligible when a new reader arrives", async () => {
    // Same row, untouched between runs: the gate is re-evaluated every run, so
    // nothing has to go back and mark the event eligible.
    const readers: Reader[] = [];
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, readers));

    const before = await withDoubles();
    const first = await before.analyse(db as never, { now: NOW });
    expect(first.considered).toBe(0);
    expect(before.spy.providerCalls).toBe(0);

    readers.push(reader());

    vi.resetModules();
    const after = await withDoubles();
    const second = await after.analyse(db as never, { now: NOW });

    expect(second.analysed).toBe(1);
    expect(after.spy.providerCalls).toBe(1);
    expect(after.spy.reservations).toBe(1);
  });

  it("does not count a reader who could not be sent the briefing", async () => {
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, [reader({ reachable: false })]));

    const report = await analyse(db as never, { now: NOW });

    expect(report.considered).toBe(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
  });

  it("counts a reader who added the source themselves, whatever its topics", async () => {
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    tables["source_topics"] = [];
    const db = new FakeDb(
      tables,
      demandRpcs(tables, [reader({ topics: [], customSources: ["source-1"] })]),
    );

    const report = await analyse(db as never, { now: NOW });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
  });

  it("still analyses an operator-named event, which is how backfill works", async () => {
    // `--event <id>` and the new-reader backfill both bypass the gate: they are
    // a decision to spend on named events, not a cron.
    const { spy, analyse } = await withDoubles();
    const tables = coreTables();
    const db = new FakeDb(tables, demandRpcs(tables, []));

    const report = await analyse(db as never, { now: NOW, eventIds: ["event-1"] });

    expect(report.analysed).toBe(1);
    expect(spy.providerCalls).toBe(1);
  });
});

describe("the enrichment pass is off, and off means nothing is bought", () => {
  const enrichable = (): Row =>
    event({
      id: "event-2",
      status: "complete",
      analysed_at: minutesAgo(300),
      understand: { analysisMeta: { sourceCountAtAnalysis: 1 } },
    });

  function enrichmentTables(flagOn: boolean): Record<string, Row[]> {
    const tables = baseTables([enrichable()]);
    tables["articles"] = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `article-${n}`,
      event_id: "event-2",
      title: `Coverage ${n}`,
      excerpt: "More reporting arrived.",
      published_at: minutesAgo(100 - n),
      source_id: `source-${n}`,
    }));
    tables["feature_flags"] = [{ key: "enrichment_pass_enabled", enabled: flagOn }];
    return tables;
  }

  it("makes no provider call and no reservation while the flag is off", async () => {
    const { spy, analyse } = await withDoubles();
    const db = new FakeDb(enrichmentTables(false));

    const report = await analyse(db as never, { now: NOW });

    expect(report.outcomes.filter((o) => o.decision === "enriched")).toHaveLength(0);
    expect(spy.providerCalls).toBe(0);
    expect(spy.reservations).toBe(0);
    // The already-analysed document is untouched.
    expect(db.rows("events")[0]?.["status"]).toBe("complete");
  });

  it("does enrich when the flag is on, which is what makes the zero above meaningful", async () => {
    const { spy, analyse } = await withDoubles();
    const db = new FakeDb(enrichmentTables(true));

    const report = await analyse(db as never, { now: NOW });

    expect(report.outcomes.some((o) => o.decision === "enriched")).toBe(true);
    expect(spy.providerCalls).toBe(1);
    expect(spy.reservations).toBe(1);
    expect(spy.features).toEqual(["enrich"]);
  });
});
