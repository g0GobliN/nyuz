import { describe, expect, it } from "vitest";
import { capFor } from "@/lib/density";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import {
  alertWasOpened,
  nextAttemptAt,
  queuedChannels,
  selectItems,
  type MatchRow,
} from "./digest";

/**
 * A fixed "now" so these assertions are about the ranking rather than about the
 * day the suite happens to run. Every fixture below is dated relative to it.
 */
const NOW = new Date("2026-09-08T06:00:00Z");

/** Hours before NOW, as an ISO timestamp. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function match(
  id: string,
  relevance: number,
  opts: {
    ageHours?: number;
    importance?: number;
    novelty?: number;
    materialRevision?: number;
    deliveredRevision?: number;
  } = {},
): MatchRow {
  const age = opts.ageHours ?? 2;
  return {
    eventId: id,
    relevance,
    matchedAt: hoursAgo(age),
    eventAt: hoursAgo(age),
    importance: opts.importance ?? 5,
    novelty: opts.novelty ?? 5,
    materialRevision: opts.materialRevision ?? 0,
    deliveredRevision: opts.deliveredRevision ?? 0,
  };
}

describe("selectItems", () => {
  it("uses the agreed per-plan density caps", () => {
    expect(capFor(100, "uno")).toBe(5);
    expect(capFor(100, "plura")).toBe(15);
    expect(capFor(100, "omni")).toBe(25);
  });
  it("keeps the most relevant stories up to the density cap", () => {
    const picked = selectItems(
      [match("a", 4), match("b", 9), match("c", 6)],
      new Map(),
      capFor(35),
      NOW,
    );
    expect(picked.map((p) => p.eventId)).toEqual(["b", "c", "a"]);
    expect(picked).toHaveLength(3);
  });

  it("drops events already in a previous briefing", () => {
    const picked = selectItems([match("a", 9), match("b", 8)], new Map([["a", 0]]), 6, NOW);
    expect(picked.map((p) => p.eventId)).toEqual(["b"]);
  });

  it("re-admits an event whose material revision has moved past what was delivered", () => {
    const picked = selectItems(
      [match("a", 9, { materialRevision: 2 }), match("b", 8, { materialRevision: 1 })],
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
      6,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).toEqual(["a"]);
  });

  it("keeps suppressing a revised event the reader has not fallen behind on", () => {
    const picked = selectItems(
      [match("a", 9, { materialRevision: 2, deliveredRevision: 2 })],
      new Map([["a", 2]]),
      6,
      NOW,
    );
    expect(picked).toEqual([]);
  });

  it("returns nothing rather than padding", () => {
    expect(selectItems([], new Map(), 6, NOW)).toEqual([]);
    expect(selectItems([match("a", 1)], new Map([["a", 0]]), 6, NOW)).toEqual([]);
  });

  it("leaves a story scored zero out, however much room the cap has left", () => {
    const picked = selectItems([match("a", 4), match("b", 0), match("c", 0.5)], new Map(), 18, NOW);
    expect(picked.map((p) => p.eventId)).toEqual(["a", "c"]);
  });

  it("would rather send a short briefing than one the model tells you to skip", () => {
    expect(selectItems([match("a", 0), match("b", 0)], new Map(), 18, NOW)).toEqual([]);
  });

  it("does not open the 72h backstop when the day already has enough fresh items", () => {
    // Six fresh items is the thin-day threshold. With that many already present,
    // the daily briefing should not reach back to 60h for a significant story.
    const picked = selectItems(
      [
        match("fresh-1", 3, { ageHours: 2 }),
        match("fresh-2", 3, { ageHours: 4 }),
        match("fresh-3", 3, { ageHours: 8 }),
        match("fresh-4", 3, { ageHours: 12 }),
        match("fresh-5", 3, { ageHours: 18 }),
        match("fresh-6", 3, { ageHours: 24 }),
        match("old-sig", 6, { ageHours: 60, importance: 9 }),
      ],
      new Map(),
      20,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).not.toContain("old-sig");
  });

  it("does not open the 72h backstop when the day already has exactly the threshold of fresh items", () => {
    // At the threshold the day is not thin. The backstop should stay closed even
    // for a significant 60h story.
    const picked = selectItems(
      [
        match("fresh-1", 3, { ageHours: 2 }),
        match("fresh-2", 3, { ageHours: 4 }),
        match("fresh-3", 3, { ageHours: 8 }),
        match("fresh-4", 3, { ageHours: 12 }),
        match("fresh-5", 3, { ageHours: 18 }),
        match("fresh-6", 3, { ageHours: 24 }),
        match("old-sig", 9, { ageHours: 60, importance: 10 }),
      ],
      new Map(),
      20,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).not.toContain("old-sig");
  });

  it("does open the 72h backstop when the day is thin and the story is significant", () => {
    // Only two fresh items. The daily briefing still should not reach back for an
    // ordinary 60h story, but it may reach back for a significant one.
    const picked = selectItems(
      [
        match("fresh-1", 3, { ageHours: 2 }),
        match("fresh-2", 3, { ageHours: 4 }),
        match("old-ordinary", 7, { ageHours: 60, importance: 5 }),
        match("old-sig", 6, { ageHours: 60, importance: 9 }),
      ],
      new Map(),
      20,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).toContain("old-sig");
    expect(picked.map((p) => p.eventId)).not.toContain("old-ordinary");
  });

  it("never opens the 72h backstop for a story past the daily ceiling", () => {
    const picked = selectItems(
      [match("fresh-1", 3, { ageHours: 2 }), match("old-sig", 9, { ageHours: 73, importance: 10 })],
      new Map(),
      20,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).not.toContain("old-sig");
  });

  it("keeps the 72h backstop gated for weekly briefings too, by ceiling not by thin day", () => {
    // Weekly briefings use the full cadence horizon, so a 60h story is ordinary
    // allowed material for them. The point here is only that the daily thin-day
    // rule is not applied to weekly frequency.
    const picked = selectItems(
      [
        match("fresh-1", 3, { ageHours: 2 }),
        match("old-ordinary", 7, { ageHours: 60, importance: 5 }),
      ],
      new Map(),
      20,
      NOW,
      "weekly",
    );
    expect(picked.map((p) => p.eventId)).toContain("old-ordinary");
  });

  it("counts primary-band items as the fresh count for the thin-day gate", () => {
    // A 24h item is still primary. A 25h item is the first allowed-band item.
    // With six primary items plus one allowed item, the backstop should stay
    // closed for a significant 60h story.
    const picked = selectItems(
      [
        match("p1", 3, { ageHours: 2 }),
        match("p2", 3, { ageHours: 4 }),
        match("p3", 3, { ageHours: 8 }),
        match("p4", 3, { ageHours: 12 }),
        match("p5", 3, { ageHours: 18 }),
        match("p6", 3, { ageHours: 24 }),
        match("allowed", 3, { ageHours: 25 }),
        match("old-sig", 9, { ageHours: 60, importance: 10 }),
      ],
      new Map(),
      20,
      NOW,
    );
    expect(picked.map((p) => p.eventId)).not.toContain("old-sig");
  });
});

describe("queuedChannels", () => {
  it("queues email whenever it is selected", () => {
    expect(queuedChannels(["email"], { telegram: false, push: false })).toEqual(["email"]);
  });

  it("queues telegram only when a chat is linked", () => {
    expect(queuedChannels(["telegram"], { telegram: false, push: false })).toEqual([]);
    expect(queuedChannels(["telegram"], { telegram: true, push: false })).toEqual(["telegram"]);
  });

  it("queues push only when a device is subscribed", () => {
    expect(queuedChannels(["push"], { telegram: false, push: false })).toEqual([]);
    expect(queuedChannels(["push"], { telegram: false, push: true })).toEqual(["push"]);
  });

  it("never queues whatsapp", () => {
    expect(
      queuedChannels(["email", "telegram", "whatsapp", "push"], { telegram: true, push: true }),
    ).toEqual(["email", "telegram", "push"]);
  });
});

describe("alertWasOpened", () => {
  it("suppresses a push retry after the reader opened its story", async () => {
    const db = new FakeDb({
      user_events: [
        { user_id: "reader-1", event_id: "event-1", opened_at: "2026-09-08T06:00:00Z" },
      ],
    });

    await expect(alertWasOpened(asDb(db), "reader-1", [{ eventId: "event-1" }])).resolves.toBe(
      true,
    );
    await expect(alertWasOpened(asDb(db), "reader-1", [{ eventId: "event-2" }])).resolves.toBe(
      false,
    );
  });
});

describe("nextAttemptAt", () => {
  const AT = Date.parse("2026-09-03T09:00:00Z");
  const minutesLater = (iso: string): number => (Date.parse(iso) - AT) / 60_000;

  it("stretches the five attempts across roughly eighty minutes", () => {
    // The bug this pins: with no deadline at all, every retry landed on the
    // next five-minute tick, so all five attempts were spent inside
    // twenty-five minutes and a half-hour provider outage failed the batch.
    const total = [1, 2, 3, 4].reduce((sum, n) => sum + minutesLater(nextAttemptAt(n, AT)), 0);
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(120);
  });

  it("waits longer after each successive failure", () => {
    // Compared at the jitter floor and ceiling so the bands cannot overlap.
    for (const [earlier, later] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ] as const) {
      const most = Math.max(
        ...Array.from({ length: 40 }, () => minutesLater(nextAttemptAt(earlier, AT))),
      );
      const least = Math.min(
        ...Array.from({ length: 40 }, () => minutesLater(nextAttemptAt(later, AT))),
      );
      expect(most).toBeLessThan(least);
    }
  });

  it("jitters so a batch that failed together does not retry together", () => {
    const deadlines = new Set(Array.from({ length: 25 }, () => nextAttemptAt(2, AT)));
    expect(deadlines.size).toBeGreaterThan(1);
  });

  it("holds the last delay for an attempt past the end of the schedule", () => {
    expect(minutesLater(nextAttemptAt(9, AT))).toBeGreaterThan(30);
  });

  it("never returns a deadline in the past", () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(minutesLater(nextAttemptAt(n, AT))).toBeGreaterThan(0);
    }
  });
});
