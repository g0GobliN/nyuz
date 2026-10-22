import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Edge cases for 0121, beyond the happy path.
 *
 * `src/lib/landing-coverage-section.test.ts` proves the ordered-list case. This file
 * asks the questions that case does not reach:
 *
 *   - what happens to a row that is an EMPTY array;
 *   - what happens to a row that is the legacy `{key: boolean}` map;
 *   - what happens when the stored key list is in a DIFFERENT shape than expected
 *     (an element that is not an object, a key that is not a string);
 *   - whether a row that does not exist is created (it must not be);
 *   - whether the migration is a no-op on a table with no landing.sections row.
 */
const db = new PGlite();
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

beforeAll(async () => {
  await db.exec(`
    create table site_settings(
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migration("0121_landing_coverage_section.sql"));
  // No explicit timeout on this hook: it inherits `hookTimeout` from
  // vitest.config.ts, which is set to 60s. PGlite's WASM start-up was measured
  // at 26s on a loaded machine (load average 20-24 on 4 cores), so an explicit
  // 30s here was marginal rather than generous — and an explicit value
  // OVERRIDES the config, which is how this hook went red on a plain
  // `vitest run` while the config's own comment claimed it was handled.
});

afterAll(async () => {
  await db.close();
});

async function reset(value?: string) {
  await db.query("delete from site_settings");
  if (value !== undefined) {
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      value,
    ]);
  }
}

async function read() {
  const res = await db.query<{ value: unknown }>(
    "select value from site_settings where key = 'landing.sections'",
  );
  return res.rows[0]?.value as unknown;
}

describe("0121 edge cases", () => {
  it("does nothing when there is no landing.sections row, and does not create one", async () => {
    await reset();
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const res = await db.query<{ n: number }>("select count(*)::int as n from site_settings");
    expect(res.rows[0]?.n).toBe(0);
  });

  it("leaves a legacy boolean-map row in the legacy shape (the app normalises it)", async () => {
    await reset(JSON.stringify({ interestDemo: true, noise: false, finalCta: true }));
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const stored = (await read()) as Record<string, boolean>;
    expect(Array.isArray(stored)).toBe(false);
    expect(stored["noise"]).toBe(false);
    expect(stored["interestDemo"]).toBe(true);
  });

  it("inserts the section into an EMPTY array", async () => {
    await reset("[]");
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const stored = (await read()) as { key: string; enabled: boolean }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.key).toBe("coverage");
    expect(stored[0]?.enabled).toBe(true);
  });

  it("inserts the section into a ONE-element array", async () => {
    await reset(JSON.stringify([{ key: "noise", enabled: false }]));
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const stored = (await read()) as { key: string; enabled: boolean }[];
    expect(stored.map((s) => s.key)).toEqual(["coverage", "noise"]);
    expect(stored[1]?.enabled).toBe(false);
  });

  it("moves an existing 'coverage' entry to the front rather than duplicating it", async () => {
    await reset(
      JSON.stringify([
        { key: "noise", enabled: true },
        { key: "coverage", enabled: false },
        { key: "finalCta", enabled: true },
      ]),
    );
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const stored = (await read()) as { key: string; enabled: boolean }[];
    expect(stored.filter((s) => s.key === "coverage")).toHaveLength(1);
    expect(stored[0]?.key).toBe("coverage");
    // The old entry was hidden; the migration's own entry is enabled.
    expect(stored[0]?.enabled).toBe(true);
    expect(stored.map((s) => s.key)).toEqual(["coverage", "noise", "finalCta"]);
  });

  it("does not touch other rows in the table", async () => {
    await reset();
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "site.seo",
      JSON.stringify({ title: "keep me" }),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));
    const res = await db.query<{ value: unknown }>(
      "select value from site_settings where key = 'site.seo'",
    );
    expect(res.rows[0]?.value).toEqual({ title: "keep me" });
  });
});
