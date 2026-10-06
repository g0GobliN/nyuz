import { describe, expect, it } from "vitest";
import {
  deliveryHealthOf,
  modeOf,
  qualityOf,
  recordedMetric,
  scheduleForKey,
  suspiciousTitle,
} from "./operations-diagnostics";

describe("diagnostics semantics", () => {
  it("distinguishes deterministic reader modes from missing persisted analysis", () => {
    expect(modeOf(null, true, true)).toBe("deterministic_enriched");
    expect(modeOf(null, false, true)).toBe("deterministic_rss");
    expect(modeOf(null, false, false)).toBe("minimal");
    expect(
      modeOf(
        { article: { deck: { text: "AI", evidence: [] }, paragraphs: [] } } as never,
        false,
        false,
      ),
    ).toBe("ai_cached");
  });

  it("uses evidence and composed word count rather than absence of a DB payload", () => {
    expect(qualityOf(420, 9, 2)).toBe("rich");
    expect(qualityOf(120, 3, 1)).toBe("adequate");
    expect(qualityOf(0, 0, 0)).toBe("thin");
  });

  it("shows unrecorded run metrics as unavailable, not measured zero", () => {
    expect(recordedMetric({}, "processed", 0)).toBeNull();
    expect(recordedMetric({ metrics_recorded: ["processed"] }, "processed", 0)).toBe(0);
  });

  it("maps physical cron schedules to logical jobs", () => {
    expect(scheduleForKey("cron:*/15 * * * *").logicalJob).toBe("Source ingest");
    expect(scheduleForKey("cron:* * * * *").logicalJob).toBe("Digest / delivery dispatcher");
    expect(scheduleForKey("cron:0 12 * * *").logicalJob).toBe("Maintenance");
    expect(
      scheduleForKey("cron:0,2,8,9,14,17,23,24,29,32,38,39,44,47,53,54,59 * * * *").logicalJob,
    ).toBe("Pipeline stage dispatcher");
  });

  it("flags malformed and identifier-like recent titles without changing them", () => {
    expect(suspiciousTitle("b11050")).toBe("identifier-like");
    expect(suspiciousTitle("   ")).toBe("empty");
    expect(suspiciousTitle("A normal story title")).toBeNull();
  });
});

describe("delivery health (Audit 41)", () => {
  const NOW = new Date("2026-10-06T06:00:00Z");
  const hoursAgo = (hours: number): string =>
    new Date(NOW.getTime() - hours * 3_600_000).toISOString();
  const delivery = (
    status: string,
    hours: number,
    error: string | null = null,
    retry: boolean = true,
  ) => ({
    channel: "email",
    status,
    last_error: error,
    created_at: hoursAgo(hours),
    attempts: 1,
    next_attempt_at: retry ? hoursAgo(hours - 1) : null,
  });

  it("reads a terminal failure inside the window as failing", () => {
    // The outage this exists for: Resend 401, attempts=1, no retry scheduled.
    // Counts alone showed it as a number nobody opened; the terminal flag is
    // what makes it a verdict.
    const health = deliveryHealthOf(
      [delivery("failed", 2, "Resend 401: invalid API key", false), delivery("sent", 30 * 24)],
      NOW,
    );
    expect(health[0]?.verdict).toBe("failing");
    expect(health[0]?.latestTerminalError).toBe("Resend 401: invalid API key");
    expect(health[0]?.lastSuccessAt).toBe(hoursAgo(30 * 24));
  });

  it("reads a channel with attempts and no successes as failing even when a retry is scheduled", () => {
    const health = deliveryHealthOf([delivery("failed", 3, "provider 500")], NOW);
    expect(health[0]?.verdict).toBe("failing");
    expect(health[0]?.recent).toEqual({ attempts: 1, sent: 0, failed: 1 });
  });

  it("reads a live channel with a minority of failures as ok", () => {
    const health = deliveryHealthOf(
      [
        delivery("sent", 1),
        delivery("sent", 2),
        delivery("sent", 3),
        delivery("sent", 4),
        delivery("failed", 5, "provider 500"),
      ],
      NOW,
    );
    // One failure in five is 20%, under the 25% degraded boundary.
    expect(health[0]?.verdict).toBe("ok");
    expect(health[0]?.successRate).toBeCloseTo(0.8);
    expect(health[0]?.latestTerminalAt).toBeNull();
  });

  it("reads a quarter of recent attempts failing as degraded, not ok", () => {
    // The boundary is inclusive: 1 failure in 4 attempts is 25% and reads as a
    // channel worth opening. Pinned so the comparison cannot silently relax.
    const health = deliveryHealthOf(
      [
        delivery("sent", 1),
        delivery("sent", 2),
        delivery("sent", 3),
        delivery("failed", 4, "provider 500"),
      ],
      NOW,
    );
    expect(health[0]?.verdict).toBe("degraded");
  });

  it("reads a quiet channel as idle, not as failing", () => {
    const health = deliveryHealthOf([delivery("sent", 30 * 24)], NOW);
    expect(health[0]?.verdict).toBe("idle");
    expect(health[0]?.lastAttemptAt).toBe(hoursAgo(30 * 24));
  });

  it("keeps channels apart", () => {
    const health = deliveryHealthOf(
      [delivery("failed", 2, "boom", false), { ...delivery("sent", 2), channel: "push" }],
      NOW,
    );
    expect(health.map((row) => `${row.channel}:${row.verdict}`)).toEqual([
      "email:failing",
      "push:ok",
    ]);
  });
});
