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
