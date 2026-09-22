import { describe, expect, it } from "vitest";

import {
  ARCHIVE_LIMITS,
  archiveRowKey,
  forOfflineList,
  isFeedPayload,
  listKeyForQuery,
  pruneRows,
  rowKeysToDrop,
  slimListPayload,
  storyIdForQuery,
  type ArchiveRow,
} from "@/lib/offline/keys";
import type { Story } from "@/lib/story";

/**
 * The archive's decisions, without a database.
 *
 * IndexedDB is deliberately not exercised here — that half is a thin wrapper and
 * a browser test would prove more than a stubbed one would. What is worth
 * pinning down is the part that can be wrong in a way nobody notices until it
 * matters: which queries are archived at all, and how much of a story is kept.
 */

const STORY_ID = "11111111-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: STORY_ID,
    org: "The Verge",
    title: "A headline",
    what: "What happened, in one sentence.",
    why: "Why it matters to you.",
    importance: "High",
    score: { relevance: 87, importance: 60, novelty: 42 },
    sources: 4,
    topics: ["Technology"],
    time: "07:12",
    publishedAt: "2026-09-22T07:12:00.000Z",
    sourceList: [
      {
        articleId: "art-1",
        name: "The Verge",
        at: "07:12",
        url: "https://example.com/a",
        headline: "Headline",
        excerpt: "A very long excerpt that is the bulk of the bytes in a list payload.",
        enrichedEvidence: [
          { claim: "A structured fact", quote: "verbatim", source: "article-1" } as never,
        ],
      },
    ],
    before: "Before.",
    after: "After.",
    timeline: [{ at: "07:12", label: "First report" }],
    understand: { article: { body: "A long generated article." } } as never,
    relatedEvents: [{ id: "other", title: "Related" }],
    personalization: { heading: "Why you're seeing this", explanation: "You follow Technology." },
    ...overrides,
  };
}

function row(kind: "list" | "story", id: string, savedAt: number): ArchiveRow {
  return {
    key: archiveRowKey(USER, kind, id),
    kind,
    userId: USER,
    id,
    savedAt,
    payload: kind === "story" ? story() : [],
  };
}

describe("which queries are archived", () => {
  it("knows the four keys and nothing else", () => {
    expect(listKeyForQuery(["briefing", "home"])).toBe("home");
    expect(listKeyForQuery(["briefing", "saved"])).toBe("saved");
    expect(listKeyForQuery(["briefing", "today", "latest"])).toBe("today:latest");
    expect(listKeyForQuery(["briefing", "today", "some-digest-uuid"])).toBe(
      "today:some-digest-uuid",
    );
    expect(storyIdForQuery(["briefing", "story", STORY_ID])).toBe(STORY_ID);
  });

  it("refuses everything else, so nothing is archived by accident", () => {
    // A whitelist, not a rule: history, search, the viewer, the preferences and
    // the console all fall through to null and are never written to disk.
    for (const key of [
      ["briefing", "history", "2026-09"],
      ["briefing", "shell-search", "openai"],
      ["briefing", "story-preview", STORY_ID],
      ["viewer"],
      ["access", "state"],
      ["preferences"],
    ]) {
      expect(listKeyForQuery(key)).toBeNull();
      expect(storyIdForQuery(key)).toBeNull();
    }
  });

  it("keeps two days apart", () => {
    // Without the digest in the key, opening yesterday's briefing would
    // overwrite today's and the reader would find one day offline, not two.
    expect(listKeyForQuery(["briefing", "today", "monday"])).not.toBe(
      listKeyForQuery(["briefing", "today", "tuesday"]),
    );
  });

  it("will not address a story without an id", () => {
    expect(storyIdForQuery(["briefing", "story"])).toBeNull();
    expect(storyIdForQuery(["briefing", "story", 42])).toBeNull();
    expect(storyIdForQuery(["briefing", "story", ""])).toBeNull();
  });
});

describe("rows belong to one account", () => {
  it("puts the account in the key", () => {
    expect(archiveRowKey(USER, "story", STORY_ID)).toBe(`${USER}:story:${STORY_ID}`);
  });

  it("gives two accounts different keys for the same story", () => {
    // The whole reason the id is in the key rather than beside it: a read for one
    // account cannot land on the other's row.
    expect(archiveRowKey("user-a", "story", STORY_ID)).not.toBe(
      archiveRowKey("user-b", "story", STORY_ID),
    );
  });
});

describe("a list keeps the card, not the reading payload", () => {
  it("drops the material only the story page renders", () => {
    const slim = forOfflineList(story());
    expect(slim.understand).toBeUndefined();
    expect(slim.relatedEvents).toBeUndefined();
    expect(slim.sourceList[0]?.excerpt).toBeUndefined();
    expect(slim.sourceList[0]?.enrichedEvidence).toBeUndefined();
  });

  it("keeps every field a card prints", () => {
    // Checked against what the card actually reads (dashboard/story-card.tsx and
    // briefing-preview.tsx): dropping any of these would empty a line offline.
    const slim = forOfflineList(story());
    expect(slim.id).toBe(STORY_ID);
    expect(slim.org).toBe("The Verge");
    expect(slim.title).toBe("A headline");
    expect(slim.what).toContain("What happened");
    expect(slim.why).toContain("Why it matters");
    expect(slim.importance).toBe("High");
    expect(slim.sources).toBe(4);
    expect(slim.topics).toEqual(["Technology"]);
    expect(slim.publishedAt).toBe("2026-09-22T07:12:00.000Z");
    expect(slim.sourceList[0]?.name).toBe("The Verge");
    expect(slim.personalization?.explanation).toContain("Technology");
  });

  it("stays a structurally valid story", () => {
    // Not a partial object wearing the type: the fields the type requires are
    // all present, so nothing downstream has to guess.
    const slim = forOfflineList(story());
    for (const field of ["before", "after", "timeline", "score", "time", "sourceList"] as const) {
      expect(slim[field]).toBeDefined();
    }
  });

  it("slims a feed object and a bare array alike", () => {
    const feed = { stories: [story()], source: "digest", nextAt: null };
    const slimFeed = slimListPayload(feed) as unknown as { stories: Story[] };
    expect(slimFeed.stories[0]?.understand).toBeUndefined();
    expect((feed.stories[0] as Story).understand).toBeDefined();

    const slimList = slimListPayload([story()]);
    expect(slimList[0]?.understand).toBeUndefined();

    // Anything unrecognised is returned untouched rather than guessed at.
    expect(slimListPayload("not a list")).toBe("not a list");
    expect(slimListPayload(null)).toBeNull();
  });

  it("recognises a feed payload by its stories array", () => {
    expect(isFeedPayload({ stories: [] })).toBe(true);
    expect(isFeedPayload([])).toBe(false);
    expect(isFeedPayload({ stories: "no" })).toBe(false);
    expect(isFeedPayload(null)).toBe(false);
  });
});

describe("the caps", () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);

  it("keeps the newest lists and drops the rest", () => {
    const rows = Array.from({ length: ARCHIVE_LIMITS.lists + 3 }, (_, i) =>
      row("list", `list-${i}`, now - i * 60_000),
    );
    const kept = pruneRows(rows, now);
    expect(kept).toHaveLength(ARCHIVE_LIMITS.lists);
    expect(kept.map((r) => r.id)).toContain("list-0");
    expect(kept.map((r) => r.id)).not.toContain(`list-${ARCHIVE_LIMITS.lists + 2}`);
  });

  it("keeps the newest stories and drops the rest", () => {
    const rows = Array.from({ length: ARCHIVE_LIMITS.stories + 5 }, (_, i) =>
      row("story", `story-${i}`, now - i * 60_000),
    );
    expect(pruneRows(rows, now)).toHaveLength(ARCHIVE_LIMITS.stories);
  });

  it("counts lists and stories separately", () => {
    // Sharing one budget would mean a reader with a full shelf gets no briefing
    // lists at all, or the reverse.
    const rows = [
      ...Array.from({ length: ARCHIVE_LIMITS.lists }, (_, i) => row("list", `l${i}`, now - i)),
      ...Array.from({ length: ARCHIVE_LIMITS.stories }, (_, i) => row("story", `s${i}`, now - i)),
    ];
    expect(pruneRows(rows, now)).toHaveLength(ARCHIVE_LIMITS.lists + ARCHIVE_LIMITS.stories);
  });

  it("drops anything older than the window, however few there are", () => {
    const stale = now - (ARCHIVE_LIMITS.days + 1) * 86_400_000;
    expect(pruneRows([row("list", "home", stale)], now)).toEqual([]);
    expect(pruneRows([row("story", STORY_ID, stale)], now)).toEqual([]);
  });

  it("names exactly the rows a prune removes", () => {
    const rows = [row("list", "keep", now), row("list", "drop", now - 30 * 86_400_000)];
    expect(rowKeysToDrop(rows, now)).toEqual([archiveRowKey(USER, "list", "drop")]);
  });
});
