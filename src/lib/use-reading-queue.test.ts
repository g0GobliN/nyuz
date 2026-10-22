import { describe, expect, it } from "vitest";
import { asQueueSource, QUEUE_SOURCES } from "@/lib/use-reading-queue";

/**
 * The story page reads `?from=` from the URL and narrows it to one of the
 * reading queues the pager knows how to walk. One wrong value and the pager
 * silently falls back to the feed — the exact shape the briefing follow-up
 * (2026-10-21, task `t_b571870e`) was filed to keep from coming back.
 */
describe("queue source narrowing", () => {
  it("accepts every queue source the link contract names", () => {
    for (const source of QUEUE_SOURCES) {
      expect(asQueueSource(source)).toBe(source);
    }
  });

  it("treats 'briefing' as a queue source", () => {
    // The 2026-10-21 fix: a story opened from today's briefing must walk
    // through the briefing, not the feed — see `src/lib/use-reading-queue.ts`
    // for the source config and `docs/design-signoff-2026-10-21.md` for the
    // measure that found "1 of 24 in your nyuz" against a 25-story briefing.
    expect(asQueueSource("briefing")).toBe("briefing");
  });

  it("refuses anything that is not a queue source", () => {
    // A hand-edited URL is not a licence to name a list. A bad source returns
    // undefined and the story page defaults to "home", which is the only
    // fallback that cannot lie about what the reader sees on the page they
    // arrived from.
    expect(asQueueSource("home")).toBe("home");
    expect(asQueueSource("alerts")).toBe("alerts");
    expect(asQueueSource("saved")).toBeUndefined();
    expect(asQueueSource("archive")).toBeUndefined();
    expect(asQueueSource("")).toBeUndefined();
    expect(asQueueSource(undefined)).toBeUndefined();
    expect(asQueueSource(42)).toBeUndefined();
    expect(asQueueSource({ from: "briefing" })).toBeUndefined();
  });
});
