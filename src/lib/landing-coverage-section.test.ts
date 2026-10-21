import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * The landing page's section order lives in the database, not in the code.
 *
 * That has a consequence this file exists to pin: a new section key shipped
 * in `SECTION_KEYS` is APPENDED to the end of the stored list by
 * `normaliseSections` (src/lib/site-content.ts). So "What nyuz covers" would
 * have appeared below the closing call to action — the one position where it
 * could not do its job — unless the stored row itself puts it first.
 *
 * `0121_landing_coverage_section.sql` is that row edit. It is run against a
 * real PostgreSQL here rather than asserted in prose, because the statement
 * is a `jsonb_agg` over an ordered union and the two things it could get
 * wrong — losing a section, or duplicating one — are exactly the two things
 * that break the page for every visitor.
 */
const db = new PGlite();
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

const KEYS = [
  "interestDemo",
  "noise",
  "howItWorks",
  "comparison",
  "profileDemo",
  "whyDifferent",
  "aiTrust",
  "infrastructure",
  "sourceTransparency",
  "finalCta",
] as const;

/** The list as 0003 seeds it. */
function seededValue() {
  return JSON.stringify(KEYS.map((key) => ({ key, enabled: true })));
}

/** Reads the stored row back as a plain list of {key, enabled}. */
async function readSections() {
  const res = await db.query<{ value: unknown }>(
    "select value from site_settings where key = 'landing.sections'",
  );
  return (res.rows[0]?.value ?? []) as { key: string; enabled: boolean }[];
}

async function writeSections(value: unknown) {
  await db.query("update site_settings set value = $2 where key = 'landing.sections'", [
    undefined,
    JSON.stringify(value),
  ]);
}

beforeAll(async () => {
  await db.exec(`
    create table site_settings(
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migration("0121_landing_coverage_section.sql"));
}, 30_000);

afterAll(async () => {
  await db.close();
});

describe("0121 — the coverage section goes first on the landing page", () => {
  it("puts the new section at the front of the stored list", async () => {
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      seededValue(),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const sections = await readSections();
    expect(sections[0]?.key).toBe("coverage");
    expect(sections[0]?.enabled).toBe(true);
  });

  it("keeps every other section, in the order it had", async () => {
    await db.query("delete from site_settings where key = 'landing.sections'");
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      seededValue(),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const sections = await readSections();
    expect(sections.map((s) => s.key)).toEqual(["coverage", ...KEYS]);
  });

  it("does not lose a section an operator had hidden, and keeps it hidden", async () => {
    await db.query("delete from site_settings where key = 'landing.sections'");
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      JSON.stringify([
        { key: "interestDemo", enabled: true },
        { key: "noise", enabled: false },
        { key: "howItWorks", enabled: true },
        { key: "finalCta", enabled: true },
      ]),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const sections = await readSections();
    expect(sections.map((s) => s.key)).toEqual([
      "coverage",
      "interestDemo",
      "noise",
      "howItWorks",
      "finalCta",
    ]);
    expect(sections.find((s) => s.key === "noise")?.enabled).toBe(false);
  });

  it("preserves an operator's own reordering of the rest of the page", async () => {
    await db.query("delete from site_settings where key = 'landing.sections'");
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      JSON.stringify([
        { key: "finalCta", enabled: true },
        { key: "noise", enabled: true },
        { key: "interestDemo", enabled: true },
      ]),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const sections = await readSections();
    expect(sections.map((s) => s.key)).toEqual(["coverage", "finalCta", "noise", "interestDemo"]);
  });

  it("is safe to run twice — the section is not duplicated", async () => {
    await db.query("delete from site_settings where key = 'landing.sections'");
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      seededValue(),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const sections = await readSections();
    expect(sections.filter((s) => s.key === "coverage")).toHaveLength(1);
    expect(sections).toHaveLength(KEYS.length + 1);
  });

  it("leaves a row in the legacy boolean-map form alone rather than corrupting it", async () => {
    // The schema accepts the old `{key: boolean}` shape and normalises it on
    // read. The migration guards on `jsonb_typeof(value) = 'array'`, so a
    // legacy row is left exactly as it was — the app's own normaliser handles
    // it, and the new section still appears (appended, per normaliseSections).
    await db.query("delete from site_settings where key = 'landing.sections'");
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "landing.sections",
      JSON.stringify({ interestDemo: true, noise: false, finalCta: true }),
    ]);
    await db.exec(migration("0121_landing_coverage_section.sql"));

    const res = await db.query<{ value: unknown }>(
      "select value from site_settings where key = 'landing.sections'",
    );
    const stored = res.rows[0]?.value as Record<string, boolean>;
    expect(typeof stored).toBe("object");
    expect(Array.isArray(stored)).toBe(false);
    expect(stored["noise"]).toBe(false);
  });
});
