import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_TIERS } from "@/lib/plans";

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

  it("gives paid plans the caps plan2 §62 specifies", () => {
    expect(PLAN_LIMITS.plura.customSources).toBe(5);
    expect(PLAN_LIMITS.omni.customSources).toBe(25);
  });

  it("keeps every tier finite, unlike topics", () => {
    // Each custom source is a real crawler on a schedule. "Unlimited" here
    // would be an unbounded infrastructure commitment rather than a generous
    // row limit — plan2 §18, all tiers stay bounded.
    for (const tier of PLAN_TIERS) {
      expect(Number.isFinite(PLAN_LIMITS[tier].customSources)).toBe(true);
    }
    expect(PLAN_LIMITS.omni.topics).toBe(Infinity);
  });

  it("matches the caps the database actually enforces", () => {
    // Reads the migration rather than trusting a comment in it. If somebody
    // changes one side, this fails — which is the whole point.
    const claim = MIGRATION.slice(
      MIGRATION.indexOf("cap := case"),
      MIGRATION.indexOf("end;", MIGRATION.indexOf("cap := case")),
    );

    expect(claim).toContain(`when 'omni'      then ${PLAN_LIMITS.omni.customSources}`);
    expect(claim).toContain(`when 'plura' then ${PLAN_LIMITS.plura.customSources}`);
    expect(claim).toContain(`else ${PLAN_LIMITS.uno.customSources}`);
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
