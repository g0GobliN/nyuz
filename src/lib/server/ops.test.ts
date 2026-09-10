import { describe, expect, it } from "vitest";
import { briefingReadinessStatus, type BriefingReadiness } from "./ops";

function readiness(underSupplied: number): BriefingReadiness {
  return {
    upcoming_briefings: 1,
    fresh_matching_stories_ready: 1,
    fresh_relevant_waiting_clustering: 2,
    fresh_relevant_waiting_analysis: 3,
    under_supplied_briefings: underSupplied,
    next_deadline: "2026-09-10T22:30:00.000Z",
  };
}

describe("briefingReadinessStatus", () => {
  it("warns when an upcoming briefing is under-supplied by the pipeline", () => {
    expect(briefingReadinessStatus(readiness(1))).toBe("warning");
  });

  it("keeps genuinely quiet briefings healthy", () => {
    expect(briefingReadinessStatus(readiness(0))).toBe("healthy");
  });
});
