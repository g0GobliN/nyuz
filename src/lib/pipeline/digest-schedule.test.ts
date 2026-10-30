import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { scheduleUpcoming } from "./digest";
import { clockInZone, nextSlots } from "./schedule";
import { deliveryTimesFor } from "@/lib/briefing-slots";
import { DEFAULT_PREFS } from "@/lib/prefs";

/**
 * Who is scheduled when -- now twice a day, in the reader's own zone.
 *
 * ---------------------------------------------------------------------------
 * What this pins
 * ---------------------------------------------------------------------------
 *
 * Owner ruling, 2026-10-30: "change 7:30 to 9:30 and 20:30 to 16:30 thats all
 * permanently everyday." So the claim this file defends is sharper than the one
 * it replaced: every reader gets **two** rows per day, the morning one at 09:30
 * and the evening one at 16:30 **on their own clock**, seven days a week.
 *
 * Three things can silently break that and none of them is visible in a
 * typecheck:
 *
 *   - one slot used for everybody (the morning row exists, the evening one does
 *     not, and no page notices);
 *   - the zone read from UTC or from a column default instead of the row, which
 *     makes two readers on one clock share an instant;
 *   - a fixed UTC offset that happens to be right until a DST boundary.
 *
 * The assertions are pinned to exact instants rather than relative distances,
 * because a change that moves both slots by the same amount would keep their
 * distance and still be wrong.
 */

const TOKYO = "11111111-1111-4111-8111-111111111111";
const NEW_YORK = "22222222-2222-4222-8222-222222222222";
const KOLKATA = "33333333-3333-4333-8333-333333333333";

/**
 * Monday 2 March 2026, 00:00 UTC -- 09:00 in Tokyo, 05:30 in Kolkata and the
 * previous Sunday evening in New York. All three readers still have both slots
 * of their own day ahead of them, which is the ordinary case rather than a
 * boundary being engineered.
 */
const NOW = new Date("2026-03-02T00:00:00.000Z");

function prefRow(user_id: string, timezone: string, send_at = "09:30:00") {
  return {
    user_id,
    send_at,
    timezone,
    days: [1, 2, 3, 4, 5, 6, 7],
    channels: ["email"],
    frequency: "daily",
    density: 35,
    paused: false,
    instructions: "",
    language: "en",
  };
}

function dbWith(
  readers: { id: string; timezone: string; plan?: "uno" | "plura" | "omni"; sendAt?: string }[],
): FakeDb {
  return new FakeDb({
    notification_preferences: readers.map((reader) =>
      prefRow(reader.id, reader.timezone, reader.sendAt ?? "09:30:00"),
    ),
    subscriptions: readers.map((reader) => ({
      user_id: reader.id,
      plan: reader.plan ?? "uno",
      status: "active",
    })),
  });
}

/** The digest rows the scheduler wrote, as `user_id → sorted instants`. */
async function schedule(
  readers: { id: string; timezone: string; plan?: "uno" | "plura" | "omni"; sendAt?: string }[],
  now: Date = NOW,
) {
  const db = dbWith(readers);
  const count = await scheduleUpcoming(asDb(db), now, {});
  const written = (db.tables["digests"] ?? []) as { user_id: string; scheduled_for: string }[];
  const byUser = new Map<string, string[]>();
  for (const row of written) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.scheduled_for].sort());
  }
  return { count, byUser };
}

function clocks(instants: string[] | undefined, zone: string): string[] {
  return (instants ?? []).map((iso) => clockInZone(new Date(iso), zone));
}

describe("the reader's day is two slots, in their own zone", () => {
  it("gives a Tokyo reader 09:30 and 16:30 JST", async () => {
    const { count, byUser } = await schedule([{ id: TOKYO, timezone: "Asia/Tokyo" }]);

    // Two rows, not one: this is the whole change.
    expect(count).toBe(2);
    expect(clocks(byUser.get(TOKYO), "Asia/Tokyo")).toEqual(["09:30", "16:30"]);

    // Pinned, so a shared offset cannot pass by being consistently wrong.
    expect(byUser.get(TOKYO)).toEqual([
      "2026-03-02T00:30:00.000Z", // 09:30 JST on the 2nd
      "2026-03-02T07:30:00.000Z", // 16:30 JST on the 2nd
    ]);
  });

  it("gives an IST reader 09:30 and 16:30 at a half-hour offset", async () => {
    const { byUser } = await schedule([{ id: KOLKATA, timezone: "Asia/Kolkata" }]);

    expect(clocks(byUser.get(KOLKATA), "Asia/Kolkata")).toEqual(["09:30", "16:30"]);
    expect(byUser.get(KOLKATA)).toEqual([
      "2026-03-02T04:00:00.000Z", // 09:30 IST (+05:30) on the 2nd
      "2026-03-02T11:00:00.000Z", // 16:30 IST on the 2nd
    ]);
  });

  it("gives a New York reader 09:30 and 16:30 EST", async () => {
    const { byUser } = await schedule([{ id: NEW_YORK, timezone: "America/New_York" }]);

    expect(clocks(byUser.get(NEW_YORK), "America/New_York")).toEqual(["09:30", "16:30"]);
    expect(byUser.get(NEW_YORK)).toEqual([
      "2026-03-02T14:30:00.000Z", // 09:30 EST (-05:00) on the 2nd
      "2026-03-02T21:30:00.000Z", // 16:30 EST on the 2nd
    ]);
  });

  it("is the stored zone that decides the instants, not the reader", async () => {
    // The same two accounts with their zones swapped: the instants swap with
    // them. A constant, or an id used as a key, could not follow the column.
    const { byUser } = await schedule([
      { id: TOKYO, timezone: "America/New_York" },
      { id: NEW_YORK, timezone: "Asia/Tokyo" },
    ]);

    expect(byUser.get(TOKYO)).toEqual(["2026-03-02T14:30:00.000Z", "2026-03-02T21:30:00.000Z"]);
    expect(byUser.get(NEW_YORK)).toEqual(["2026-03-02T00:30:00.000Z", "2026-03-02T07:30:00.000Z"]);
  });

  it("gives two readers in the same zone the same two instants", async () => {
    // The converse, so the difference above is attributable to the zone.
    const { byUser } = await schedule([
      { id: TOKYO, timezone: "Asia/Tokyo" },
      { id: NEW_YORK, timezone: "Asia/Tokyo" },
    ]);

    expect(byUser.get(TOKYO)).toEqual(byUser.get(NEW_YORK));
  });
});

describe("the day the clocks go forward", () => {
  /**
   * America/New_York switches at 02:00 local on 8 March 2026. The reader's day
   * that contains the switch still has to read 09:30 and 16:30 on its own
   * clock, which means both instants shift an hour earlier in UTC -- and the
   * evening slot must land after the jump even though the morning slot of the
   * day before did not.
   */
  const DAY_BEFORE = new Date("2026-03-07T05:00:00.000Z"); // 00:00 EST, 7 March
  const DAY_OF = new Date("2026-03-08T05:00:00.000Z"); // 00:00 EST, 8 March
  const DAY_AFTER = new Date("2026-03-09T04:00:00.000Z"); // 00:00 EDT, 9 March

  it("still fires at 09:30 and 16:30 local on both sides of the change", async () => {
    for (const [now, expected] of [
      [DAY_BEFORE, ["2026-03-07T14:30:00.000Z", "2026-03-07T21:30:00.000Z"]],
      [DAY_OF, ["2026-03-08T13:30:00.000Z", "2026-03-08T20:30:00.000Z"]],
      [DAY_AFTER, ["2026-03-09T13:30:00.000Z", "2026-03-09T20:30:00.000Z"]],
    ] as const) {
      const { byUser } = await schedule([{ id: NEW_YORK, timezone: "America/New_York" }], now);
      expect(clocks(byUser.get(NEW_YORK), "America/New_York")).toEqual(["09:30", "16:30"]);
      expect(byUser.get(NEW_YORK)).toEqual([...expected]);
    }
  });
});

describe("every day of the week", () => {
  it("schedules both editions on all seven days, weekends included", async () => {
    // Walk one local day per tick from Monday 2 March to Sunday 8 March and
    // collect what each tick booked. A five-day default shows up here as
    // Saturday and Sunday with no rows.
    const seen = new Map<string, string[]>();
    for (let offset = 0; offset < 7; offset += 1) {
      const now = new Date(NOW.getTime() + offset * 86_400_000);
      const { byUser } = await schedule([{ id: TOKYO, timezone: "Asia/Tokyo" }], now);
      for (const iso of byUser.get(TOKYO) ?? []) {
        const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
        seen.set(day, [...(seen.get(day) ?? []), clockInZone(new Date(iso), "Asia/Tokyo")]);
      }
    }

    expect([...seen.keys()]).toHaveLength(7);
    for (const [day, times] of seen) {
      expect(times.sort(), day).toEqual(["09:30", "16:30"]);
    }
    // Saturday and Sunday are in the set, not just the five weekdays.
    expect(seen.has("2026-03-07")).toBe(true);
    expect(seen.has("2026-03-08")).toBe(true);
  });

  it("ships a default schedule that covers seven days", () => {
    // The stored rows here are all seven already; the default a new reader
    // starts from is the other half of the promise, and it used to be Mon-Fri.
    expect(DEFAULT_PREFS.days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(DEFAULT_PREFS.time).toBe("09:30");
  });
});

describe("what each plan's day looks like", () => {
  it("gives a free reader the standard 09:30 even when the row still stores another time", async () => {
    // Legacy rows carried 07:30 from before the ruling. A plan that cannot
    // customise is read against the standard slot, not against whatever the
    // column happens to hold.
    const { byUser } = await schedule(
      [{ id: TOKYO, timezone: "Asia/Tokyo", plan: "uno", sendAt: "07:30:00" }],
      NOW,
    );

    expect(clocks(byUser.get(TOKYO), "Asia/Tokyo")).toEqual(["09:30", "16:30"]);
  });

  it("keeps a paid reader's chosen morning time and still adds the fixed evening", () => {
    expect(deliveryTimesFor("plura", "06:15:00")).toEqual(["06:15", "16:30"]);
    expect(deliveryTimesFor("omni", "09:30:00")).toEqual(["09:30", "16:30"]);
    expect(deliveryTimesFor("uno", "06:15:00")).toEqual(["09:30", "16:30"]);
  });

  it("collapses to one slot when the morning time is the evening time", () => {
    // Two rows at one instant is not a second edition: it is the same briefing
    // booked twice, and the unique index would reject it anyway.
    expect(deliveryTimesFor("plura", "16:30")).toEqual(["16:30"]);
  });

  it("writes a paid reader's custom morning and the fixed evening", async () => {
    const { byUser } = await schedule(
      [{ id: TOKYO, timezone: "Asia/Tokyo", plan: "plura", sendAt: "06:15:00" }],
      NOW,
    );

    // 06:15 JST has already passed at 09:00 JST, so the custom morning is
    // tomorrow's and today's evening (16:30) is the next one booked. Both slots
    // exist; the order here is the clock's, not the array's.
    expect(clocks(byUser.get(TOKYO), "Asia/Tokyo")).toEqual(["16:30", "06:15"]);
  });
});

describe("re-running the scheduler", () => {
  it("does not book a second copy of the same slot", async () => {
    // The pipeline runs every minute, so this is the ordinary case rather than
    // an edge: the unique index on (user_id, scheduled_for) is what makes the
    // second tick a no-op.
    const db = dbWith([{ id: TOKYO, timezone: "Asia/Tokyo" }]);
    await scheduleUpcoming(asDb(db), NOW, {});
    await scheduleUpcoming(asDb(db), new Date(NOW.getTime() + 60_000), {});

    const written = (db.tables["digests"] ?? []) as { scheduled_for: string }[];
    expect(written.map((row) => row.scheduled_for).sort()).toEqual([
      "2026-03-02T00:30:00.000Z",
      "2026-03-02T07:30:00.000Z",
    ]);
  });
});

describe("nextSlots", () => {
  it("returns one instant per slot, earliest first", () => {
    const slots = nextSlots(
      { timezone: "Asia/Tokyo", days: [1, 2, 3, 4, 5, 6, 7], frequency: "daily" },
      NOW,
      ["16:30", "09:30"],
    );

    expect(slots.map((slot) => slot.toISOString())).toEqual([
      "2026-03-02T00:30:00.000Z",
      "2026-03-02T07:30:00.000Z",
    ]);
  });

  it("returns nothing when the day has no slots left to book", () => {
    expect(
      nextSlots({ timezone: "Asia/Tokyo", days: [], frequency: "daily" }, NOW, ["09:30"]),
    ).toEqual([]);
  });
});
