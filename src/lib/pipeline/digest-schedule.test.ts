import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { scheduleUpcoming } from "./digest";
import { clockInZone } from "./schedule";

/**
 * Who is scheduled when.
 *
 * ---------------------------------------------------------------------------
 * What this pins
 * ---------------------------------------------------------------------------
 *
 * The delivery decision (`briefing-delivery-time.md`) keeps option B: one build
 * per reader, at `send_at` interpreted **in that reader's own zone**. The claim
 * is easy to state and easy to lose -- one `sendAt` used for everybody, a
 * column default read instead of the row, a constant anywhere in the path, and
 * every reader on the product is served at the same UTC instant while the code
 * still looks right.
 *
 * So this runs the real `scheduleUpcoming` over two real preference rows and
 * asserts the result two ways: each reader's own clock reads 07:30, and the two
 * UTC instants differ. The second half is the part a constant cannot pass.
 *
 * `uno` is deliberate. Its plan does not allow a custom delivery time, so
 * `send_at` is not read at all and the only thing that can move the instant is
 * the stored zone -- which is the fact under test.
 */

const TOKYO = "11111111-1111-4111-8111-111111111111";
const NEW_YORK = "22222222-2222-4222-8222-222222222222";

/**
 * A Monday, 09:00 in Tokyo and 19:00 the previous evening in New York. Both
 * readers' 07:30 has already passed, so each next slot is the following
 * morning -- which is the ordinary case, not a boundary being engineered.
 */
const NOW = new Date("2026-03-02T00:00:00.000Z");

function prefRow(user_id: string, timezone: string) {
  return {
    user_id,
    send_at: "07:30:00",
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

function dbWith(readers: { id: string; timezone: string }[]): FakeDb {
  return new FakeDb({
    notification_preferences: readers.map((reader) => prefRow(reader.id, reader.timezone)),
    subscriptions: readers.map((reader) => ({
      user_id: reader.id,
      plan: "uno",
      status: "active",
    })),
  });
}

/** The digest rows the scheduler wrote, as `user_id → scheduled_for`. */
async function schedule(readers: { id: string; timezone: string }[]) {
  const db = dbWith(readers);
  const count = await scheduleUpcoming(asDb(db), NOW, {});
  const written = (db.tables["digests"] ?? []) as { user_id: string; scheduled_for: string }[];
  return { count, byUser: new Map(written.map((row) => [row.user_id, row.scheduled_for])) };
}

describe("the briefing's delivery time", () => {
  it("is 07:30 in each reader's own zone, so two zones are two instants", async () => {
    const { count, byUser } = await schedule([
      { id: TOKYO, timezone: "Asia/Tokyo" },
      { id: NEW_YORK, timezone: "America/New_York" },
    ]);

    expect(count).toBe(2);

    const tokyo = byUser.get(TOKYO);
    const newYork = byUser.get(NEW_YORK);
    expect(tokyo).toBeDefined();
    expect(newYork).toBeDefined();

    // The reader's own clock, which is the promise the product makes.
    expect(clockInZone(new Date(tokyo!), "Asia/Tokyo")).toBe("07:30");
    expect(clockInZone(new Date(newYork!), "America/New_York")).toBe("07:30");

    // And the same promise seen from the scheduler: one 07:30 is not the other.
    expect(tokyo).not.toBe(newYork);

    // Pinned rather than only relative, so a change that moves both slots by
    // the same amount cannot pass by keeping their distance.
    expect(tokyo).toBe("2026-03-02T22:30:00.000Z"); // 07:30 JST on the 3rd
    expect(newYork).toBe("2026-03-02T12:30:00.000Z"); // 07:30 EST on the 2nd
  });

  it("is the stored zone that decides it, not the reader", async () => {
    // The same two accounts with their zones swapped: the instants swap with
    // them. A constant, or an id used as a key, could not follow the column.
    const { byUser } = await schedule([
      { id: TOKYO, timezone: "America/New_York" },
      { id: NEW_YORK, timezone: "Asia/Tokyo" },
    ]);

    expect(byUser.get(TOKYO)).toBe("2026-03-02T12:30:00.000Z");
    expect(byUser.get(NEW_YORK)).toBe("2026-03-02T22:30:00.000Z");
  });

  it("gives two readers in the same zone the same instant", async () => {
    // The converse, so the difference above is attributable to the zone and not
    // to anything else about the two rows.
    const { byUser } = await schedule([
      { id: TOKYO, timezone: "Asia/Tokyo" },
      { id: NEW_YORK, timezone: "Asia/Tokyo" },
    ]);

    expect(byUser.get(TOKYO)).toBe(byUser.get(NEW_YORK));
  });
});
