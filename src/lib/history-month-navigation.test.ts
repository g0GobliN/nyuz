import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/0076_history_month_navigation.sql", "utf8");

describe("history month navigation", () => {
  it("generates every calendar month from the plan window through the current month", () => {
    expect(SQL).toContain("public.history_window_start(p_user)");
    expect(SQL).toMatch(
      /generate_series\([\s\S]*date_trunc\('month', r\.window_start[\s\S]*date_trunc\('month', now\(\)/i,
    );
    expect(SQL).toContain("interval '1 month'");
  });

  it("counts only briefing rows inside the allowed window", () => {
    expect(SQL).toMatch(/left join public\.digests d/i);
    expect(SQL).toMatch(/d\.scheduled_for >= r\.window_start/i);
    expect(SQL).toMatch(/d\.kind = 'briefing'/i);
    expect(SQL).toMatch(/null::timestamptz,\s*null::timestamptz/i);
  });

  it("does not duplicate plan durations and remains server-only", () => {
    expect(SQL).not.toMatch(/\b(7|90|365)\b/);
    expect(SQL).toMatch(/revoke all[^;]*from public, anon, authenticated/i);
    expect(SQL).toMatch(/grant execute[^;]*to service_role/i);
  });
});
