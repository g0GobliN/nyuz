import { describe, expect, it } from "vitest";
import { asQueueSource, QUEUE_SOURCES, SOURCES } from "@/lib/use-reading-queue";

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

/**
 * The two halves of the pager that have to agree with each other: the label a
 * reader checks their briefing against, and the list the position is counted
 * in. A source that counts one list and names another prints a number a reader
 * can disprove by looking at the list they came from — which is exactly the
 * `1 of 24 in your nyuz` under a 25-story briefing this file exists to keep
 * from returning.
 */
describe("queue sources", () => {
  it("names every source it can walk", () => {
    for (const source of QUEUE_SOURCES) {
      expect(SOURCES[source].label).not.toBe("");
    }
    expect(SOURCES.briefing.label).toBe("your briefing");
  });

  it("reads the briefing from the briefing page's own cache entry", () => {
    // The key has to be the one `/dashboard/briefing` writes for its Today
    // tab, or a reader who has just read the briefing pays a second request
    // for a list they already have.
    expect(SOURCES.briefing.queryKey).toEqual(["briefing", "today", "latest"]);
  });

  it("counts the delivered briefing, not the filtered feed", () => {
    // The briefing is what the reader was sent; its page does not filter it
    // against dismissals or muted topics. Filtering it here would put a
    // "3 of 18" under a briefing the reader can count to 25.
    expect(SOURCES.briefing.respectsFeedback).toBe(false);
    expect(SOURCES.home.respectsFeedback).toBe(true);
  });

  it("projects each briefing story to what the pager reads", () => {
    // A missing field is a silent pager: an id-only projection gives Next and
    // Previous no headline, and the decision at the foot of a story is whether
    // the next one is worth the time.
    const projected = SOURCES.briefing.select([
      { id: "a", title: "First", topics: ["ai"], org: "The Register" },
      { id: "b", title: "Second", topics: [], org: "Reuters" },
    ]);
    expect(projected).toEqual([
      { id: "a", title: "First", topics: ["ai"] },
      { id: "b", title: "Second", topics: [] },
    ]);
  });
});
