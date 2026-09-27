import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/0095_economics_operations.sql", "utf8");

describe("economics operations migration", () => {
  it("stores provider sync attempts and immutable FX captures", () => {
    expect(SQL).toContain("create table if not exists public.economics_sync_runs");
    expect(SQL).toContain("create table if not exists public.economics_fx_rates");
    expect(SQL).toContain("unique (base_currency, quote_currency, rate_date, source)");
  });

  it("keeps operations data out of browser roles", () => {
    expect(SQL).toContain(
      "revoke all on table public.economics_sync_runs, public.economics_fx_rates from public, anon, authenticated",
    );
  });
});

const ROUTE = readFileSync("src/routes/admin/economics.tsx", "utf8");

describe("economics dashboard hierarchy", () => {
  it("puts operating economics before AI details", () => {
    expect(ROUTE.indexOf('label="Operating cost · JPY"')).toBeGreaterThan(-1);
    expect(ROUTE.indexOf('title="Cost composition"')).toBeGreaterThan(-1);
    expect(ROUTE.indexOf('title="AI details"')).toBeGreaterThan(-1);
    expect(ROUTE.indexOf('title="AI details"')).toBeGreaterThan(
      ROUTE.indexOf('title="Cost composition"'),
    );
    expect(ROUTE).toContain('title="Free-user economics"');
    expect(ROUTE).toContain('label="Storage growth"');
    expect(ROUTE).not.toContain("AI provider status: {data.ai.killSwitchOn");
    expect(ROUTE).toContain('value={data.ai.tokens === null ? "Unavailable"');
    expect(ROUTE).toContain('title="Data quality"');
    expect(ROUTE).toContain('label="Known direct costs"');
  });
});

const COST_INTELLIGENCE = readFileSync("src/lib/server/cost-intelligence.ts", "utf8");

describe("unit economics query contract", () => {
  // History: this page once passed `{ unitWindow }` to a validator that names
  // its input `days`. Zod strips unknown keys, so `days` went missing and the
  // request failed at runtime - invisible to types and to the build. These
  // assertions pin both halves of the contract so a rename cannot repeat it.
  it("server validates a days input and wires it to getUnitEconomics", () => {
    expect(COST_INTELLIGENCE).toContain(
      "const unitEconomicsInput = z.object({ days: z.number().int().min(1).max(365) })",
    );
    const fnStart = COST_INTELLIGENCE.indexOf("export const getUnitEconomics");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = COST_INTELLIGENCE.indexOf("export const", fnStart + 1);
    const body = COST_INTELLIGENCE.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(body).toContain("parseInput(unitEconomicsInput");
  });

  it("route passes days from the same variable its cache key tracks", () => {
    const call = "getUnitEconomics({ data: { days: unitWindow } })";
    const first = ROUTE.indexOf(call);
    expect(first).toBeGreaterThanOrEqual(0);
    // Exactly one call site on this page, so a second one cannot drift.
    expect(ROUTE.indexOf(call, first + 1)).toBe(-1);
    // A different variable here than in the input means switching windows
    // refetches with the wrong value or serves a stale window.
    expect(ROUTE).toContain('queryKey: ["admin", "unit-economics", unitWindow]');
  });
});
