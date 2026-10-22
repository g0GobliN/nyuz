import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";

/**
 * The save path's copy of the reader's zone.
 *
 * `notification_preferences.timezone` is what the scheduler reads, and it is
 * asserted against a real PostgreSQL in `schema-migrations.test.ts`. What can
 * only be asserted here is that a save keeps the *other* column holding the same
 * fact. `profiles.timezone` is what the signup trigger writes and what the admin
 * console's user page shows, so a save that updated only the schedule row would
 * leave an operator looking at the zone the reader signed up in.
 *
 * The fake evaluates the PostgREST filters rather than ignoring them, so a write
 * that reached the wrong row would fail here instead of passing.
 */

vi.mock("./guard", () => ({ signedInOnly: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));

import { savePreferences } from "./preferences";

const READER = "11111111-1111-4111-8111-111111111111";

type Result = { ok: boolean };

/** Calls the handler the way the middleware would. */
const save = (db: FakeDb, data: Record<string, unknown>): Promise<Result> =>
  (savePreferences as unknown as (input: unknown) => Promise<Result>)({
    context: { actor: { id: READER, db: asDb(db) } },
    data,
  });

/** A reader the trigger has just written, still on the `'UTC'` default. */
function readerDb(hooks: ConstructorParameters<typeof FakeDb>[2] = {}): FakeDb {
  return new FakeDb(
    {
      subscriptions: [{ user_id: READER, plan: "uno", status: "active" }],
      profiles: [{ id: READER, display_name: "Asha", timezone: "UTC", onboarded_at: null }],
      notification_preferences: [
        {
          user_id: READER,
          send_at: "07:30:00",
          timezone: "UTC",
          days: [1, 2, 3, 4, 5],
          channels: ["email"],
          frequency: "daily",
          density: 35,
          instructions: "",
          language: "en",
          paused: false,
        },
      ],
    },
    {},
    hooks,
  );
}

const zoneIn = (db: FakeDb, table: string): unknown => db.rows(table)[0]?.["timezone"];

describe("saving a reader's timezone", () => {
  it("writes it to the schedule row the pipeline reads", async () => {
    const db = readerDb();

    await expect(save(db, { timezone: "Asia/Kathmandu" })).resolves.toEqual({ ok: true });

    expect(zoneIn(db, "notification_preferences")).toBe("Asia/Kathmandu");
  });

  it("writes it to the profile row the admin console shows", async () => {
    // The same fact in two columns. If this drifts, an operator reads the zone
    // the reader signed up in rather than the one they chose.
    const db = readerDb();

    await save(db, { timezone: "Asia/Kathmandu" });

    expect(zoneIn(db, "profiles")).toBe("Asia/Kathmandu");
  });

  it("leaves both rows alone when the save carries no zone", async () => {
    // A density slider or a topic change must not rewrite a schedule from the
    // defaults the request never mentioned.
    const db = readerDb();

    await save(db, { density: 70 });

    expect(zoneIn(db, "notification_preferences")).toBe("UTC");
    expect(zoneIn(db, "profiles")).toBe("UTC");
  });

  it("surfaces a refused profile write instead of reporting a save that did not happen", async () => {
    const db = readerDb({
      failWrite: (table, mode) =>
        table === "profiles" && mode === "update" ? "permission denied" : null,
    });

    await expect(save(db, { timezone: "Asia/Kathmandu" })).rejects.toThrow(/permission denied/);
  });
});
