import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_TIERS } from "@/lib/plans";
import { canonicalUrl } from "@/lib/pipeline/canonical";

/**
 * The custom-source cap exists in two places and must agree in both
 * (docs/plan2.md §62, §91).
 *
 * `PLAN_LIMITS.customSources` is what the interface shows and what decides
 * whether the add form is even offered. `claim_custom_source` in
 * `0030_custom_sources.sql` is what actually enforces it, inside a
 * transaction, holding a lock.
 *
 * Only the second one is a guard. The first is a number in a bundle the
 * browser can read and therefore edit. These tests exist because the failure
 * mode of them drifting apart is silent and expensive in opposite directions:
 * a UI cap above the SQL cap tells a paying reader they can add sources that
 * are then refused, and a UI cap below it leaves entitlement unsold.
 */

const MIGRATION = readFileSync("supabase/migrations/0030_custom_sources.sql", "utf8");

describe("custom source entitlements", () => {
  it("gives Uno readers none", () => {
    // plan2 §63: an Uno reader consumes the already-active shared network.
    // Adding a source creates a new crawler, which Uno growth must not do.
    expect(PLAN_LIMITS.uno.customSources).toBe(0);
  });

  it("gives paid plans the caps the launch ruling specifies", () => {
    // Audit 33: the ladder widened the caps — the follow is still one real
    // crawler with its own schedule, so the number stays finite and the
    // shared-crawler budget (concurrency, backoff, probes) is untouched.
    expect(PLAN_LIMITS.plura.customSources).toBe(8);
    expect(PLAN_LIMITS.omni.customSources).toBe(20);
  });

  it("keeps every tier finite, including topics", () => {
    // Each custom source is a real crawler on a schedule. "Unlimited" here
    // would be an unbounded infrastructure commitment rather than a generous
    // row limit — plan2 §18, all tiers stay bounded.
    for (const tier of PLAN_TIERS) {
      expect(Number.isFinite(PLAN_LIMITS[tier].customSources)).toBe(true);
    }
    expect(PLAN_LIMITS.omni.topics).toBe(30);
  });

  it("matches the caps the database actually enforces", () => {
    // Reads the migration rather than trusting a comment in it. If somebody
    // changes one side, this fails — which is the whole point.
    const sql = readFileSync("supabase/migrations/0081_launch_plan_values.sql", "utf8");
    for (const tier of PLAN_TIERS)
      expect(sql).toContain(`"customSources":${PLAN_LIMITS[tier].customSources}`);
  });

  it("treats a missing subscription row as uno in the database, not as unlimited", () => {
    // A reader with no subscription row is not a reader with unlimited
    // crawlers. `coalesce(user_plan, 'uno')` is what makes that true.
    expect(MIGRATION).toContain("coalesce(user_plan, 'uno')");
  });

  it("has no INSERT policy on user_custom_sources", () => {
    // The cap is only a guard if the claim function is the only way in. An
    // insert policy would be a route around it.
    const policies = MIGRATION.match(/create policy[\s\S]*?;/g) ?? [];
    const inserts = policies.filter((p) => /for\s+insert/i.test(p));
    expect(inserts).toEqual([]);
  });

  it("revokes the claim function from the browser roles", () => {
    expect(MIGRATION).toContain(
      "revoke execute on function public.claim_custom_source(uuid, uuid) from anon, authenticated",
    );
  });

  it("serialises a single reader's concurrent adds", () => {
    // Two tabs, two simultaneous adds, four existing rows, cap of five: both
    // see room and both insert unless something serialises them.
    expect(MIGRATION).toContain("pg_advisory_xact_lock");
    expect(MIGRATION).toContain("'custom_source:' || p_user_id::text");
  });
});

/**
 * `sources.feed_url` is a lookup key, and three writers fill it.
 *
 * `followCustomSource` looks a submitted feed up by comparing `canonicalUrl`'s
 * output to that column, so a writer that stores something else makes the
 * lookup miss. The console's add form used to store the operator's keystrokes
 * verbatim, and 21 of the 87 seeded feeds carry the trailing slash that
 * `canonicalUrl` removes -- so a reader who copied a catalogue link got a
 * SECOND row for a feed nyuz already watched, and the UNIQUE constraint could
 * not catch it because the two strings genuinely differ.
 *
 * These assert the three writers agree, by reading them. A fourth writer added
 * later without canonicalising is the regression this is here to catch.
 */
describe("every writer of sources.feed_url stores the canonical form", () => {
  const WRITERS = [
    "src/lib/server/custom-sources.ts",
    "src/lib/discovery/register.ts",
    "src/lib/server/sources.ts",
  ];

  it("all three canonicalise before inserting", () => {
    for (const file of WRITERS) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/feed_url:\s*(storedUrl|canonical|feedUrl\b)/);
      // `data.feedUrl` is what the bug looked like: the submitted string,
      // uncanonicalised, written straight into the lookup key. Every writer must
      // name a canonicalised local instead.
      expect(source, file).not.toMatch(/feed_url:\s*data\.feedUrl/);
    }
  });

  it("looks a feed up through the variants, not one spelling of it", () => {
    for (const file of ["src/lib/server/custom-sources.ts", "src/lib/discovery/register.ts"]) {
      expect(readFileSync(file, "utf8"), file).toContain("feedUrlVariants");
    }
  });

  it("keeps the promise the canonicaliser makes about the two spellings", () => {
    // The rule the whole repair rests on: canonicalising a stored feed URL
    // changes at most its trailing slash, so the cleanup in 0107 can be done in
    // SQL without reimplementing the canonicaliser.
    for (const stored of [
      "https://a16z.com/feed/",
      "https://github.blog/feed",
      "https://export.arxiv.org/rss/cs.AI",
    ]) {
      const canonical = canonicalUrl(stored);
      expect(canonical, stored).not.toBeNull();
      expect(canonical!.replace(/\/$/, ""), stored).toBe(stored.replace(/\/$/, ""));
    }
  });
});
