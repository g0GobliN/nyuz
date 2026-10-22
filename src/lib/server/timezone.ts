import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { isSupportedTimezone } from "@/lib/timezones";

/**
 * The reader's own timezone, stored from the first account row.
 *
 * ---------------------------------------------------------------------------
 * Why this exists alongside the signup trigger
 * ---------------------------------------------------------------------------
 *
 * `handle_new_user` reads the browser's zone out of
 * `auth.users.raw_user_meta_data`, which is how the email one-time-code path
 * carries one into the signup row. Google and GitHub cannot: those accounts are
 * created at the provider callback, before any of this project's code runs, so
 * their `notification_preferences` row is seeded with the `'UTC'` column
 * default. A reader who signed up with either and never opened the schedule
 * step would be served at 07:30 UTC.
 *
 * So this is the writer for those two paths, and for any account whose row
 * predates this migration. It is called once on the first authenticated load
 * that sees the stored zone differ from the browser's.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 *
 * It cannot overwrite a reader's choice, and the guard is in the database
 * rather than here on purpose. `onboarded_at` is the product's own record that
 * a reader has been through the schedule step, and it is stamped by the same
 * save that writes their timezone -- `onboarding.tsx` sends one
 * `update({ ...draft, onboarded: true })`, and `savePreferences` writes both
 * from it. A reader who has not onboarded cannot have chosen a zone through the
 * product at all -- `/dashboard` redirects to `/onboarding` until `onboarded`
 * is true, and the schedule step is the first place a zone can be chosen -- so
 * for them the stored zone is still the default this is here to correct.
 *
 * Deciding that in TypeScript would mean a read-then-write across two round
 * trips, which is the shape that loses the race: a reader who finishes
 * onboarding between the read and the write has their choice overwritten.
 * `capture_signup_timezone` does the check and the write in one statement, so
 * either the guard sees `onboarded_at` set and matches nothing, or onboarding's
 * own save lands after this one.
 *
 * The zone is validated twice on purpose. `isSupportedTimezone` here is the
 * transport guard; `usable_timezone` in the database is the one that matters,
 * because it is the same gate the trigger uses and it cannot be reached around.
 *
 * The caller is told the zone the account now holds, not the one it offered:
 * an onboarded reader gets their own zone back, so a refusal cannot be
 * mistaken for a write.
 */

const captureInput = z.object({
  timezone: z.string().max(64).refine(isSupportedTimezone, "Not a timezone this system knows."),
});

export type CapturedTimezone = { timezone: string };

export const captureSignupTimezone = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => captureInput.parse(input))
  .handler(async ({ data, context }): Promise<CapturedTimezone> => {
    const { actor } = context;

    const { data: stored, error } = await actor.db.rpc("capture_signup_timezone", {
      p_user: actor.id,
      p_zone: data.timezone,
    });
    if (error) throw new Error(`Saving your timezone: ${error.message}`);

    return { timezone: typeof stored === "string" && stored ? stored : "UTC" };
  });
