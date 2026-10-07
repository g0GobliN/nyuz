/**
 * The run receipt: opened before the work, closed after it (Audit 47).
 *
 * `pipeline_runs` is the only record that a stage ran, and until this change it
 * was written *after* the work. A stage that exhausts its subrequest budget
 * mid-run then lost the record of the run it had just done, and from the rows
 * alone the loss was indistinguishable from a scheduler that never fired: Audit
 * 45 read a 25% shortfall in recorded slots and found the crons were firing on
 * ~100% of them, because two stages' first database call is a failing RPC whose
 * error the database logs.
 *
 * These tests pin the three properties that fix depends on:
 *
 *   - the row exists while the work is still running, so a run that dies keeps
 *     a record of having started;
 *   - the closing write says what the run did, and a failed run closes as
 *     `error` exactly once;
 *   - no ledger write can fail the run. A client that throws, an insert that
 *     returns an error, a close that never lands -- all of it is logged and
 *     swallowed, which is the ruling's constraint: observability must not
 *     become a source of pipeline failure.
 */

import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { recordRunLifecycle, type ScheduledResult } from "./cron";

/** A report shaped like the ones stages actually return. */
function enrichReport(overrides: Record<string, unknown> = {}) {
  return {
    considered: 75,
    processed: 3,
    skipped: 72,
    failed: 0,
    probe: { decision: "gate_closed" as const },
    ...overrides,
  };
}

function lifecycleDb(): FakeDb {
  return new FakeDb({ pipeline_runs: [] }, {}, {}, { generatedIds: ["pipeline_runs"] });
}

function cronRows(db: FakeDb) {
  return db.rows("pipeline_runs");
}

describe("a scheduled run's receipt", () => {
  it("exists while the work is still running, and closes with what the run did", async () => {
    const db = lifecycleDb();
    let during: Record<string, unknown> | undefined;

    const result = await recordRunLifecycle(asDb(db), "0,2,4 * * * *", "enrich", async () => {
      // The whole point: a receipt that exists before the task returns is one
      // a killed invocation leaves behind. Copied, because the closing write
      // mutates this row in place.
      during = { ...cronRows(db)[0] };
      return { stage: "enrich", report: enrichReport() } as unknown as ScheduledResult;
    });

    expect(result.stage).toBe("enrich");

    // Open: running, no finish time, the stage the invocation was planned for.
    expect(during).toMatchObject({
      stage: "enrich",
      trigger: "cron:stages",
      finished_at: null,
      status: "running",
    });

    // Closed once, in place: same row, same start, now with the metrics.
    expect(cronRows(db)).toHaveLength(1);
    expect(cronRows(db)[0]).toMatchObject({
      stage: "enrich",
      trigger: "cron:stages",
      started_at: during?.["started_at"],
      status: "warning",
      considered: 75,
      processed: 3,
      skipped: 72,
      failed: 0,
      reason_counts: { metrics_recorded: ["considered", "processed", "skipped", "failed"] },
    });
    expect(typeof cronRows(db)[0]!["finished_at"]).toBe("string");
  });

  it("keeps the probe decision on the same row, rather than a second one", async () => {
    const db = lifecycleDb();
    await recordRunLifecycle(asDb(db), "* * * * *", "digest", async () => {
      return { stage: "enrich", report: enrichReport() } as unknown as ScheduledResult;
    });

    // A closed row carries the stage the run *turned out* to be, and the digest
    // trigger is labelled as one: `runDigest` reports `digest`, its sending
    // half reports `delivery`, and both come from the per-minute trigger.
    expect(cronRows(db)).toHaveLength(1);
    expect(cronRows(db)[0]).toMatchObject({
      stage: "enrich",
      trigger: "cron:digest",
      status: "warning",
    });
  });

  it("closes a failed run as an error, with the message, and still throws", async () => {
    const db = lifecycleDb();

    await expect(
      recordRunLifecycle(asDb(db), "0,2,4 * * * *", "cluster", async () => {
        throw new Error("selecting unclustered articles: connection reset");
      }),
    ).rejects.toThrow("connection reset");

    expect(cronRows(db)).toHaveLength(1);
    expect(cronRows(db)[0]).toMatchObject({
      stage: "cluster",
      status: "error",
      failed: 1,
      reason_counts: {
        metrics_recorded: ["failed"],
        error: "selecting unclustered articles: connection reset",
      },
    });
  });

  it("runs the stage even when the ledger cannot be written at all", async () => {
    // A client that throws on every call is the worst case: a Worker whose
    // database is unreachable. The stage must still run and report.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      from: () => {
        throw new Error("network connection lost");
      },
    } as never;

    const result = await recordRunLifecycle(broken, "0,2,4 * * * *", "impact", async () => {
      return { stage: "impact", report: { written: 0, failed: 0 } } as unknown as ScheduledResult;
    });

    expect(result.stage).toBe("impact");
    // Logged, because a silent loss of the ledger is the defect being repaired.
    expect(error.mock.calls.flat().join(" ")).toContain("network connection lost");
    error.mockRestore();
  });

  it("does not throw when the closing write is refused", async () => {
    const db = lifecycleDb();
    // The budget is spent by the time the run closes: the update returns an
    // error, exactly as the ingest invocation's heartbeat did.
    db.hooks.failWrite = (_table, mode) =>
      mode === "update" ? "Too many subrequests by single Worker invocation." : null;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recordRunLifecycle(asDb(db), "*/15 * * * *", "ingest", async () => {
      return {
        stage: "ingest",
        report: { considered: 80, processed: 0 },
      } as unknown as ScheduledResult;
    });

    expect(result.stage).toBe("ingest");
    expect(error.mock.calls.flat().join(" ")).toContain("Too many subrequests");
    error.mockRestore();
  });
});
