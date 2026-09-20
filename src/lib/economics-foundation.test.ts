import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ECONOMICS_STATUSES } from "./economics";

const SQL = readFileSync("supabase/migrations/0094_economics_foundation.sql", "utf8");

describe("economics foundation migration", () => {
  it("stores every provenance status used by the application", () => {
    for (const status of ECONOMICS_STATUSES) {
      expect(SQL).toContain(`'${status}'`);
    }
  });

  it("makes provider imports idempotent and preserves conversion metadata", () => {
    expect(SQL).toContain(
      "unique (provider, service, scope, period_start, period_end, import_key)",
    );
    expect(SQL).toContain("original_amount_minor");
    expect(SQL).toContain("original_currency");
    expect(SQL).toContain("conversion_rate");
    expect(SQL).toContain("conversion_source");
  });

  it("does not allow browser roles to read or write accounting rows", () => {
    expect(SQL).toContain(
      "revoke all on table public.economics_snapshots, public.economics_manual_costs from public, anon, authenticated",
    );
    expect(SQL).toContain(
      "grant select on table public.economics_snapshots, public.economics_manual_costs to service_role",
    );
  });
});
