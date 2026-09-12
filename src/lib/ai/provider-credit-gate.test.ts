import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0080, asserted against the migration itself — same reasoning as
 * launch-cost-safety.test.ts: this suite cannot reach a database, and the
 * properties below are properties of the SQL text and the safe-patch idiom it
 * follows (the same one 0070 and 0079 used on this same function). The
 * migration WAS run against a real PostgreSQL 17 before being reported as
 * done. What these tests do is notice if someone later edits a safety
 * property back out — an anchor removed, the idempotency guard dropped, the
 * loud failure turned into a silent skip, or the explicit flag turned back
 * into an implicit "skip when unfunded" inference.
 */

const SQL = readFileSync("supabase/migrations/0080_provider_credit_gate.sql", "utf8");
const CODE = SQL.replace(/^\s*--.*$/gm, "");

describe("the gate is an explicit, off-by-default flag", () => {
  it("creates provider_credit_gate_enabled, defaulting to off", () => {
    const insert = CODE.slice(
      CODE.indexOf("insert into public.feature_flags"),
      CODE.indexOf("on conflict (key) do nothing;") + "on conflict (key) do nothing;".length,
    );
    expect(insert).toContain("'provider_credit_gate_enabled'");
    // `false, 100` is (enabled, rollout_percent) for this one-row insert.
    expect(insert).toMatch(/false,\s*100\)/);
  });

  it("the enforcement check reads that same flag key, not table emptiness alone", () => {
    const check = CODE.slice(CODE.indexOf("credit_check text :="));
    expect(check).toContain("key = 'provider_credit_gate_enabled'");
    // Disabled must short-circuit to false regardless of any recorded top-up.
    expect(check).toContain("coalesce(");
    expect(check.indexOf("coalesce(")).toBeLessThan(check.indexOf("ai_credit_topups"));
  });
});

describe("the provider-credit gate is installed safely", () => {
  it("reads the installed definition rather than assuming a static one", () => {
    expect(CODE).toContain("pg_get_functiondef(p.oid)");
    expect(CODE).toContain("p.proname = 'reserve_ai_tokens'");
  });

  it("inserts under the same advisory lock every other cap in this function relies on", () => {
    const anchorIndex = CODE.indexOf("perform pg_advisory_xact_lock(18295, 1);");
    const checkIndex = CODE.indexOf("key = 'provider_credit_gate_enabled'");
    expect(anchorIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeGreaterThan(anchorIndex);
  });

  it("refuses when the new call would push spend past what was topped up", () => {
    const check = CODE.slice(CODE.indexOf("credit_check text :="));
    expect(check).toContain("p_estimated_cost_microusd");
    expect(check).toContain("return null;");
  });

  it("never touches ai_runtime_config or the monthly/daily cap parameters", () => {
    // The two ceilings must stay structurally independent: this migration
    // should not reference the safety-cap machinery at all.
    expect(CODE).not.toContain("ai_runtime_config");
    expect(CODE).not.toContain("p_global_monthly_cost_microusd");
    expect(CODE).not.toContain("p_daily_flash_cap_microusd");
    expect(CODE).not.toContain("p_daily_pro_cap_microusd");
  });

  it("is idempotent: a re-run recognises the gate is already installed", () => {
    const guardIndex = CODE.indexOf("position('provider_credit_gate_enabled' in definition) > 0");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(CODE.indexOf("definition := replace(definition, anchor"));
  });

  it("fails loudly, never silently, if the anchor line has moved", () => {
    expect(CODE).toContain("raise exception");
    const raiseIndex = CODE.indexOf(
      "raise exception",
      CODE.indexOf("position(anchor in definition) = 0"),
    );
    expect(raiseIndex).toBeGreaterThan(-1);
  });

  it("does not drop or recreate the function — same signature, comment only", () => {
    expect(CODE).not.toMatch(/drop function.*reserve_ai_tokens/);
    expect(CODE).not.toMatch(/create (or replace )?function public\.reserve_ai_tokens/);
    expect(CODE).toContain("comment on function public.reserve_ai_tokens(");
  });
});
