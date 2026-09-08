import { describe, expect, it } from "vitest";
import { capFor } from "@/lib/density";
import { nextAttemptAt, queuedChannels, readWhys, selectItems, type MatchRow } from "./digest";

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
  opts: { ageHours?: number; importance?: number; novelty?: number } = {},
): MatchRow {
  const age = opts.ageHours ?? 2;
  return {
    eventId: id,
    relevance,
    matchedAt: hoursAgo(age),
    eventAt: hoursAgo(age),
    importance: opts.importance ?? 5,
    novelty: opts.novelty ?? 5,
  };
}

describe("selectItems", () => {
  it("uses the agreed per-plan density caps", () => {
    expect(capFor(100, "uno")).toBe(18);
    expect(capFor(100, "plura")).toBe(30);
    expect(capFor(100, "omni")).toBe(50);
  });
  it("keeps the most relevant stories up to the density cap", () => {
    const picked = selectItems(
      [match("a", 4), match("b", 9), match("c", 6)],
      new Set(),
      capFor(35),
      NOW,
    );
    expect(picked.map((p) => p.eventId)).toEqual(["b", "c", "a"]);
    expect(picked).toHaveLength(3);
  });

  it("drops events already in a previous briefing", () => {
    const picked = selectItems([match("a", 9), match("b", 8)], new Set(["a"]), 6, NOW);
    expect(picked.map((p) => p.eventId)).toEqual(["b"]);
  });

  it("returns nothing rather than padding", () => {
    expect(selectItems([], new Set(), 6, NOW)).toEqual([]);
    expect(selectItems([match("a", 1)], new Set(["a"]), 6, NOW)).toEqual([]);
  });

  it("leaves a story scored zero out, however much room the cap has left", () => {
    const picked = selectItems([match("a", 4), match("b", 0), match("c", 0.5)], new Set(), 18, NOW);
    expect(picked.map((p) => p.eventId)).toEqual(["a", "c"]);
  });

  it("would rather send a short briefing than one the model tells you to skip", () => {
    expect(selectItems([match("a", 0), match("b", 0)], new Set(), 18, NOW)).toEqual([]);
  });
});

describe("readWhys", () => {
  const ids = ["e1", "e2"];

  it("reads one paragraph per requested event", () => {
    const items = readWhys(
      {
        items: [
          { event_id: "e1", why_it_matters: "Your Next.js cache model just changed." },
          { event_id: "e2", why_it_matters: "The chip allocation affects your GPU budget." },
        ],
      },
      ids,
    );
    expect(items).toEqual([
      { eventId: "e1", why: "Your Next.js cache model just changed." },
      { eventId: "e2", why: "The chip allocation affects your GPU budget." },
    ]);
  });

  it("refuses a reply that silently drops a story", () => {
    expect(readWhys({ items: [{ event_id: "e1", why_it_matters: "Only one." }] }, ids)).toBeNull();
  });

  it("refuses an empty paragraph rather than inventing one", () => {
    expect(
      readWhys(
        {
          items: [
            { event_id: "e1", why_it_matters: "Real." },
            { event_id: "e2", why_it_matters: "  " },
          ],
        },
        ids,
      ),
    ).toBeNull();
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
