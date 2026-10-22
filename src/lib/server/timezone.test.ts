import { describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";

/**
 * The server half of the signup-zone correction.
 *
 * The behaviour that matters -- the guard on `onboarded_at`, the fallback for a
 * zone this database cannot schedule in, the grant -- is PostgreSQL's and is
 * executed in `schema-migrations.test.ts`. What is asserted here is the
 * contract between this function and that database: which procedure is called,
 * with whose id, and what the caller is told when the procedure refuses.
 *
 * The name and the argument spelling are the whole risk. `capture_signup_timezone`,
 * `p_user` and `p_zone` are strings in two files that nothing else ties
 * together, and a rename on one side is a runtime error on a path a reader
 * crosses exactly once.
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

import { captureSignupTimezone } from "./timezone";

const READER = "11111111-1111-4111-8111-111111111111";

type Result = { timezone: string };

/** Calls the handler the way the middleware would. */
const capture = (db: FakeDb, timezone: string): Promise<Result> =>
  (captureSignupTimezone as unknown as (input: unknown) => Promise<Result>)({
    context: { actor: { id: READER, db: asDb(db) } },
    data: { timezone },
  });

describe("captureSignupTimezone", () => {
  it("offers the reader's own zone for their own account", async () => {
    const db = new FakeDb({}, { capture_signup_timezone: (args) => args["p_zone"] });

    await expect(capture(db, "Asia/Kathmandu")).resolves.toEqual({
      timezone: "Asia/Kathmandu",
    });

    // The id is the verified actor's, never a value from the request body.
    expect(db.rpcCalls).toEqual([
      {
        fn: "capture_signup_timezone",
        args: { p_user: READER, p_zone: "Asia/Kathmandu" },
      },
    ]);
  });

  it("reports the account's zone when the database refused to overwrite a choice", async () => {
    // An onboarded reader: the procedure matches nothing and answers with what
    // is stored. The caller must be able to tell that from a write.
    const db = new FakeDb({}, { capture_signup_timezone: () => "Europe/Berlin" });

    await expect(capture(db, "Asia/Tokyo")).resolves.toEqual({ timezone: "Europe/Berlin" });
  });

  it("falls back to UTC when the account has no stored zone to report", async () => {
    // No preferences row and no profile: nothing was written and nothing is
    // stored. UTC is what the rest of the app already treats as the default.
    const db = new FakeDb({}, { capture_signup_timezone: () => null });

    await expect(capture(db, "Asia/Tokyo")).resolves.toEqual({ timezone: "UTC" });
  });

  it("surfaces a database failure instead of pretending the zone was stored", async () => {
    const db = new FakeDb(
      {},
      {
        capture_signup_timezone: () => new Error("permission denied for function"),
      },
    );

    await expect(capture(db, "Asia/Tokyo")).rejects.toThrow(
      /Saving your timezone: permission denied/,
    );
  });
});
