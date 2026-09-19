import { describe, expect, it } from "vitest";
import {
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
