import { describe, expect, it } from "vitest";
import { isDue } from "./ingest";
import type { Source } from "@/lib/supabase/types";

/**
 * When a source is allowed a request (docs/plan2.md phase 6, §19).
 *
 * The interesting part is the interaction between two independent
 * mechanisms that both delay a fetch and mean opposite things: the learned
 * **cadence**, which says how often this source usually publishes, and the
 * **backoff**, which says whether it is currently answering at all. Getting
 * the precedence wrong in one direction hammers a dead feed; in the other it
 * starves a live one.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-30T12:00:00Z");

const source = (over: Partial<Source> = {}): Source => ({
  id: "s1",
  name: "Example",
  homepage: null,
  feed_url: "https://example.com/feed.xml",
  kind: "rss",
  active: true,
  last_fetched_at: new Date(NOW.getTime() - HOUR).toISOString(),
  failure_count: 0,
  created_at: NOW.toISOString(),
  coverage_mode: "core",
  listed: true,
  origin: "curated",
  last_demand_at: NOW.toISOString(),
  last_new_content_at: NOW.toISOString(),
  polling_tier: "normal",
  enrichment_allowed: null,
  robots_checked_at: null,
  enrichment_failure_count: 0,
  enrichment_last_success: null,
  enrichment_last_attempt_at: null,
  enrichment_last_failure_reason: null,
  ...over,
});

describe("isDue", () => {
  it("always fetches a source that has never been read", () => {
    // What makes the very first run collect everything.
    expect(isDue(source({ last_fetched_at: null }), NOW)).toBe(true);
    expect(isDue(source({ last_fetched_at: null }), NOW, 1440)).toBe(true);
  });

  it("treats an unparseable timestamp as due rather than never-due", () => {
    // A corrupt value must not silently take a source out of collection
    // forever. Erring toward one extra fetch is the cheap direction.
    expect(isDue(source({ last_fetched_at: "not a date" }), NOW)).toBe(true);
  });

  describe("without adaptive polling", () => {
    it("uses one interval for every source", () => {
      const fetched30 = new Date(NOW.getTime() - 30 * 60_000).toISOString();
      const fetched20 = new Date(NOW.getTime() - 20 * 60_000).toISOString();
      expect(isDue(source({ last_fetched_at: fetched30 }), NOW)).toBe(true);
      expect(isDue(source({ last_fetched_at: fetched20 }), NOW)).toBe(false);
    });

    it("ignores the tier entirely", () => {
      // The tier is computed either way (so it can be inspected), but with
      // the flag off no cadence is passed and it must not change behaviour.
      const fetched20 = new Date(NOW.getTime() - 20 * 60_000).toISOString();
      for (const tier of ["hot", "cold", "paused"] as const) {
        expect(isDue(source({ last_fetched_at: fetched20, polling_tier: tier }), NOW)).toBe(false);
      }
    });
  });

  describe("with adaptive polling", () => {
    it("reads a hot source more often than the uniform interval allowed", () => {
      const fetched20 = new Date(NOW.getTime() - 20 * 60_000).toISOString();
      // 20 minutes is not due at the uniform 30, but is at hot's 15.
      expect(isDue(source({ last_fetched_at: fetched20 }), NOW)).toBe(false);
      expect(isDue(source({ last_fetched_at: fetched20 }), NOW, 15)).toBe(true);
    });

    it("leaves a cold source alone for its much longer interval", () => {
      const fetchedSixHours = new Date(NOW.getTime() - 6 * HOUR).toISOString();
      expect(isDue(source({ last_fetched_at: fetchedSixHours }), NOW, 1440)).toBe(false);

      const fetchedTwoDays = new Date(NOW.getTime() - 48 * HOUR).toISOString();
      expect(isDue(source({ last_fetched_at: fetchedTwoDays }), NOW, 1440)).toBe(true);
    });
  });

  describe("backoff versus cadence", () => {
    it("makes a failing source wait its backoff even when its tier says hot", () => {
      // The tier describes how often the source *publishes*; the backoff
      // describes whether it currently *answers*. A feed that has failed four
      // times is not one to poll every fifteen minutes because it used to be
      // busy.
      const fetched20 = new Date(NOW.getTime() - 20 * 60_000).toISOString();
      const failing = source({ last_fetched_at: fetched20, failure_count: 3, polling_tier: "hot" });
      expect(isDue(failing, NOW, 15)).toBe(false);
    });

    it("does not let a long cadence shorten an even longer backoff", () => {
      // max(), not min(): whichever says "wait longer" wins.
      const fetchedOneHour = new Date(NOW.getTime() - HOUR).toISOString();
      const healthy = source({ last_fetched_at: fetchedOneHour, failure_count: 0 });
      expect(isDue(healthy, NOW, 360)).toBe(false);
    });

    it("resumes normal cadence once a source stops failing", () => {
      const fetched20 = new Date(NOW.getTime() - 20 * 60_000).toISOString();
      const recovered = source({
        last_fetched_at: fetched20,
        failure_count: 0,
        polling_tier: "hot",
      });
      expect(isDue(recovered, NOW, 15)).toBe(true);
    });
  });
});
