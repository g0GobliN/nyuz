import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Push subscription identity, pinned against the source.
 *
 * A reader turned out to have two rows for one Firefox profile and the obvious
 * reading was a registration bug — `refreshPush` runs from a `useEffect` on
 * every dashboard mount, so a plain insert there would grow a row per visit.
 * It is not that: the endpoint is unique in the schema and the write is an
 * upsert on it, and the two rows held two different endpoints created a day
 * apart, which is the browser rotating its subscription.
 *
 * These assertions exist because the correct behaviour here is invisible. A
 * change from `upsert` to `insert`, or a migration that dropped the unique
 * constraint, would break nothing at typecheck, pass every other test, and only
 * show up as somebody's phone buzzing once per visit they ever made.
 *
 * Source text rather than a live database, as in `security-invariants.test.ts`:
 * these are properties of the code, and a test that needs Postgres to state
 * them would not run where it matters.
 */
describe("push subscription registration is idempotent", () => {
  it("makes the endpoint the row identity in the schema", () => {
    const sql = readFileSync("supabase/migrations/0014_push.sql", "utf8");
    expect(sql).toMatch(/endpoint\s+text\s+unique\s+not\s+null/);
  });

  it("upserts on that endpoint instead of inserting", () => {
    // Re-registering the same browser must land on the same row. `refreshPush`
    // fires on every dashboard mount, so this is the difference between one
    // row per device and one row per page view.
    const account = readFileSync("src/lib/server/push/account.ts", "utf8");
    expect(account).toContain(".upsert(");
    expect(account).toContain('onConflict: "endpoint"');
    expect(account).not.toMatch(/from\("push_subscriptions"\)\s*\.insert\(/);
  });

  it("deletes endpoints the push service has retired", () => {
    // 404 and 410 are the service saying the subscription is gone. A row that
    // survives them is a permanent failure on every future send, so delivery
    // collects them as `dropIds` and removes them.
    const send = readFileSync("src/lib/server/push/send.ts", "utf8");
    expect(send).toMatch(/status === 404 \|\| res\.status === 410/);
    expect(send).toContain("dropIds.push(sub.id)");

    const digest = readFileSync("src/lib/pipeline/digest.ts", "utf8");
    expect(digest).toMatch(
      /from\("push_subscriptions"\)\s*\.delete\(\)\s*\.in\("id", result\.dropIds\)/,
    );
  });
});
