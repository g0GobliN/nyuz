import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/test-support/fake-db";
import {
  digestInWindow,
  historyWindowStart,
  readHistoryDays,
  readHistoryMonths,
  storyVisible,
} from "./history";

/**
 * The server-side half of the history boundary.
 *
 * ---------------------------------------------------------------------------
 * Why these are worth writing against a fake
 * ---------------------------------------------------------------------------
 *
 * Server functions run with the service-role client, which bypasses row-level
 * security. So the policy added in 0067 does not protect any of this, and the
 * only thing standing between a downgraded reader and their old archive is
 * whether these queries carry the window. That is exactly the sort of claim a
 * fake can settle: `fake-db` evaluates PostgREST filters rather than ignoring
 * them, so a `.gte("scheduled_for", …)` that went missing turns a green test
 * red instead of quietly passing.
 *
 * What they cannot check is RLS itself, or that Postgres agrees with
 * `history_window_start`. Those live in the migration and in
 * `history-entitlement.test.ts`.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

/** What `history_window_start` returns for a seven-day plan. */
const UNO_WINDOW = daysAgo(7);

function dbWith(tables: Record<string, Record<string, unknown>[]>, window = UNO_WINDOW) {
  return new FakeDb(tables, {
    history_window_start: () => window,
  });
}

describe("the window comes from the database, never from a constant here", () => {
  it("returns whatever the boundary function says", async () => {
    const db = dbWith({});
    await expect(historyWindowStart(db as never, USER)).resolves.toBe(UNO_WINDOW);
    expect(db.rpcCalls[0]).toEqual({
      fn: "history_window_start",
      args: { p_user: USER },
    });
  });

  it("fails closed when the boundary cannot be read", async () => {
    // No history is a recoverable error page. All of it is not.
    const db = new FakeDb({}, {});
    await expect(historyWindowStart(db as never, USER)).rejects.toThrow(/history window/i);
  });
});

describe("a digest id is not a way around the plan", () => {
  const digests = [
    { digest_id: "d-recent", user_id: USER, scheduled_for: daysAgo(2), kind: "briefing" },
    { digest_id: "d-old", user_id: USER, scheduled_for: daysAgo(40), kind: "briefing" },
    { digest_id: "d-theirs", user_id: OTHER, scheduled_for: daysAgo(1), kind: "briefing" },
  ];

  it("returns a digest inside the window", async () => {
    const db = dbWith({ digests });
    const row = await digestInWindow(db as never, USER, "d-recent", UNO_WINDOW);
    expect(row?.digest_id).toBe("d-recent");
  });

  it("refuses one the reader owns but may no longer open", async () => {
    // The Plura-to-Uno case: still theirs, still in the table during grace,
    // and forty days beyond what their plan now entitles.
    const db = dbWith({ digests });
    await expect(digestInWindow(db as never, USER, "d-old", UNO_WINDOW)).resolves.toBeNull();
  });

  it("refuses somebody else's digest even inside the window", async () => {
    const db = dbWith({ digests });
    await expect(digestInWindow(db as never, USER, "d-theirs", UNO_WINDOW)).resolves.toBeNull();
  });

  it("hands the same digest back once an upgrade widens the window", async () => {
    // Nothing was restored: the row never moved. The window did.
    const db = dbWith({ digests });
    const row = await digestInWindow(db as never, USER, "d-old", daysAgo(90));
    expect(row?.digest_id).toBe("d-old");
  });
});

describe("a month of days is clamped to the window, not merely filtered by month", () => {
  const digests = [
    {
      digest_id: "d1",
      user_id: USER,
      scheduled_for: daysAgo(1),
      kind: "briefing",
      status: "sent",
      item_count: 4,
    },
    {
      digest_id: "d2",
      user_id: USER,
      scheduled_for: daysAgo(6),
      kind: "briefing",
      status: "sent",
      item_count: 2,
    },
    {
      digest_id: "d3",
      user_id: USER,
      scheduled_for: daysAgo(20),
      kind: "briefing",
      status: "sent",
      item_count: 9,
    },
    {
      digest_id: "alert",
      user_id: USER,
      scheduled_for: daysAgo(1),
      kind: "alert",
      status: "sent",
      item_count: 1,
    },
  ];
  const september = { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" };

  it("returns the readable days of the month asked for", async () => {
    const db = dbWith({ digests });
    const rows = await readHistoryDays(db as never, USER, {
      ...september,
      windowStart: UNO_WINDOW,
    });
    // Newest first, and d3 belongs to August rather than to this range.
    expect(rows.map((r) => r.digest_id)).toEqual(["d1", "d2"]);
  });

  it("keeps alerts out of the briefing archive", async () => {
    const db = dbWith({ digests });
    const rows = await readHistoryDays(db as never, USER, {
      ...september,
      windowStart: UNO_WINDOW,
    });
    expect(rows.some((r) => r.digest_id === "alert")).toBe(false);
  });

  const august = { startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-09-01T00:00:00.000Z" };

  it("returns nothing for a month that begins before the window", async () => {
    // The clamp, and the whole point of it. August is a real month with a real
    // briefing in it, the reader owns that briefing, and on seven days they may
    // not have it. Opening the month must not be the way round that.
    const db = dbWith({ digests });
    const rows = await readHistoryDays(db as never, USER, { ...august, windowStart: UNO_WINDOW });
    expect(rows).toEqual([]);
  });

  it("hands that same month back once an upgrade widens the window", async () => {
    const db = dbWith({ digests });
    const rows = await readHistoryDays(db as never, USER, { ...august, windowStart: daysAgo(90) });
    expect(rows.map((r) => r.digest_id)).toEqual(["d3"]);
  });

  it("does not reach into a neighbouring month even on a wide window", async () => {
    const db = dbWith({ digests });
    const rows = await readHistoryDays(db as never, USER, {
      ...september,
      windowStart: daysAgo(365),
    });
    expect(rows.map((r) => r.digest_id)).toEqual(["d1", "d2"]);
  });
});

describe("month navigation stays inside the current window", () => {
  it("keeps overlapping empty months but drops wholly older months", async () => {
    const db = new FakeDb(
      {},
      {
        history_months: () => [
          {
            month_key: "2026-09",
            starts_at: "2026-09-01T00:00:00.000Z",
            ends_at: "2026-10-01T00:00:00.000Z",
            available: 6,
            locked_newest_at: null,
            locked_oldest_at: null,
          },
          {
            month_key: "2026-08",
            starts_at: "2026-08-01T00:00:00.000Z",
            ends_at: "2026-09-01T00:00:00.000Z",
            available: 0,
            locked_newest_at: daysAgo(8),
            locked_oldest_at: daysAgo(38),
          },
          {
            month_key: "2026-07",
            starts_at: "2026-07-01T00:00:00.000Z",
            ends_at: "2026-08-01T00:00:00.000Z",
            available: 0,
            locked_newest_at: daysAgo(40),
            locked_oldest_at: daysAgo(68),
          },
        ],
      },
    );

    const months = await readHistoryMonths(db as never, USER, UNO_WINDOW);

    expect(months.map((m) => m.monthKey)).toEqual(["2026-09", "2026-08"]);
    expect(months[1]).toMatchObject({ available: 0, lockedNewestAt: null });
    // No retained briefing timestamps, titles or digest ids cross the window.
    expect(Object.keys(months[1] ?? {}).sort()).toEqual([
      "available",
      "endsAt",
      "lockedNewestAt",
      "lockedOldestAt",
      "monthKey",
      "startsAt",
    ]);
  });
});

describe("a story uuid is not a way around the plan either", () => {
  it("opens a story the reader matched inside the window", async () => {
    const db = dbWith({
      saved_stories: [],
      user_events: [{ user_id: USER, event_id: EVENT, matched_at: daysAgo(3) }],
      digest_items: [],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(true);
  });

  it("refuses a story whose only match has aged past the window", async () => {
    const db = dbWith({
      saved_stories: [],
      user_events: [{ user_id: USER, event_id: EVENT, matched_at: daysAgo(40) }],
      digest_items: [],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(false);
  });

  it("opens a saved story however old it is", async () => {
    // The deliberate exception. Saving is the reader's decision and expiry is
    // not allowed to quietly undo it.
    const db = dbWith({
      saved_stories: [{ user_id: USER, event_id: EVENT, saved_at: daysAgo(400) }],
      user_events: [{ user_id: USER, event_id: EVENT, matched_at: daysAgo(400) }],
      digest_items: [],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(true);
  });

  it("opens a story delivered in an in-window briefing even with no match row left", async () => {
    // `user_events` is pruned on the same cutoff, and a match recorded the day
    // before a briefing ages out a day before the briefing does. Without the
    // digest check the oldest readable day would list stories that refuse.
    const db = dbWith({
      saved_stories: [],
      user_events: [],
      digest_items: [
        {
          event_id: EVENT,
          "digests.user_id": USER,
          "digests.scheduled_for": daysAgo(6),
        },
      ],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(true);
  });

  it("refuses a story delivered only in a briefing beyond the window", async () => {
    const db = dbWith({
      saved_stories: [],
      user_events: [],
      digest_items: [
        {
          event_id: EVENT,
          "digests.user_id": USER,
          "digests.scheduled_for": daysAgo(40),
        },
      ],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(false);
  });

  it("refuses an event the reader has no relationship with at all", async () => {
    // A uuid typed into the address bar, or lifted from someone else's link.
    const db = dbWith({
      saved_stories: [{ user_id: OTHER, event_id: EVENT, saved_at: daysAgo(1) }],
      user_events: [{ user_id: OTHER, event_id: EVENT, matched_at: daysAgo(1) }],
      digest_items: [
        {
          event_id: EVENT,
          "digests.user_id": OTHER,
          "digests.scheduled_for": daysAgo(1),
        },
      ],
    });
    await expect(storyVisible(db as never, USER, EVENT, UNO_WINDOW)).resolves.toBe(false);
  });
});
