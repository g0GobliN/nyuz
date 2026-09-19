import { describe, expect, it } from "vitest";
import { deriveOperationsState } from "./operations";

const recent = () => new Date(Date.now() - 10 * 60_000).toISOString();
const stale = () => new Date(Date.now() - 3 * 60 * 60_000).toISOString();

describe("deriveOperationsState", () => {
  it("reports healthy when cron is recent and processing keeps up", () => {
    expect(
      deriveOperationsState({
        heartbeat: recent(),
        latestCron: recent(),
        backlog: 0,
        oldest: null,
        failures: 0,
        incoming: 10,
        processed: 12,
      }).state,
    ).toBe("healthy");
  });

  it("reports backlogged when input is faster than processing", () => {
    expect(
      deriveOperationsState({
        heartbeat: recent(),
        latestCron: recent(),
        backlog: 100,
        oldest: recent(),
        failures: 0,
        incoming: 120,
        processed: 40,
      }).state,
    ).toBe("backlogged");
  });

  it("reports a partial outage when the heartbeat is stale", () => {
    expect(
      deriveOperationsState({
        heartbeat: stale(),
        latestCron: recent(),
        backlog: 1,
        oldest: recent(),
        failures: 0,
        incoming: 0,
        processed: 0,
      }).state,
    ).toBe("partial_outage");
  });

  it("reports degraded when failures exist but the queues are not aged out", () => {
    expect(
      deriveOperationsState({
        heartbeat: recent(),
        latestCron: recent(),
        backlog: 1,
        oldest: recent(),
        failures: 2,
        incoming: 10,
        processed: 10,
      }).state,
    ).toBe("degraded");
  });
});
