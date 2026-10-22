import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * 0122 — the `site.seo` description sweep.
 *
 * `/` serves the stored `site.seo` description when the row exists, so the
 * positioning change needs a migration as well as the code change to
 * `SEO_DEFAULT`. The dangerous part is the `where` clause: the stored row is an
 * editorial decision, and a migration that rewrites it unconditionally would
 * silently revert an operator's own edit to the description on every deploy.
 *
 * So the guard is the thing under test:
 *
 *   - a row holding the value `0004_landing_copy.sql` seeded IS updated;
 *   - a row holding the pre-change `SEO_DEFAULT` IS updated;
 *   - a row an operator edited by hand is NOT touched;
 *   - a row with no `site.seo` at all is not created (the bundled fallback
 *     already carries the new wording, and creating the row would turn a
 *     fallback into an override);
 *   - the title is not touched — the brand line is not a positioning claim.
 */
const db = new PGlite();
const migration = readFileSync(
  "supabase/migrations/0122_site_seo_information_briefing.sql",
  "utf8",
);

const NEW =
  "Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized information briefing without the noise.";
const SEEDED_0004 =
  "You don't read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.";
const OLD_DEFAULT =
  "Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized news briefing without the noise.";

beforeAll(async () => {
  await db.exec(`
    create table site_settings(
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migration);
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

async function seed(description: string, title = "nyuz — Stop searching. Start knowing.") {
  await db.query("delete from site_settings");
  await db.query("insert into site_settings(key, value) values($1, $2)", [
    "site.seo",
    JSON.stringify({ title, description, ogImage: "/og-image.jpg" }),
  ]);
}

async function read() {
  const res = await db.query<{ value: { title: string; description: string; ogImage: string } }>(
    "select value from site_settings where key = 'site.seo'",
  );
  return res.rows[0]?.value;
}

describe("0122 — the site.seo description sweep is guarded", () => {
  it("updates a description holding the value 0004_landing_copy.sql seeded", async () => {
    await seed(SEEDED_0004);
    await db.exec(migration);
    expect((await read())?.description).toBe(NEW);
  });

  it("updates a description holding the pre-change SEO_DEFAULT", async () => {
    await seed(OLD_DEFAULT);
    await db.exec(migration);
    expect((await read())?.description).toBe(NEW);
  });

  it("leaves an operator's own description alone", async () => {
    const theirs = "Our own words about nyuz, written by a human in /admin/content.";
    await seed(theirs);
    await db.exec(migration);
    expect((await read())?.description).toBe(theirs);
  });

  it("does not create the row when there is none", async () => {
    await db.query("delete from site_settings");
    await db.exec(migration);
    const res = await db.query<{ n: number }>("select count(*)::int as n from site_settings");
    expect(res.rows[0]?.n).toBe(0);
  });

  it("does not touch the title — the brand line is not a positioning claim", async () => {
    await seed(SEEDED_0004);
    await db.exec(migration);
    expect((await read())?.title).toBe("nyuz — Stop searching. Start knowing.");
  });

  it("does not disturb other keys in the table", async () => {
    await seed(SEEDED_0004);
    await db.query("insert into site_settings(key, value) values($1, $2)", [
      "site.footer",
      JSON.stringify({ blurb: "keep me" }),
    ]);
    await db.exec(migration);
    const res = await db.query<{ value: unknown }>(
      "select value from site_settings where key = 'site.footer'",
    );
    expect(res.rows[0]?.value).toEqual({ blurb: "keep me" });
  });

  it("is idempotent — a re-run changes nothing and does not double-apply", async () => {
    await seed(SEEDED_0004);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(migration);
    const value = await read();
    expect(value?.description).toBe(NEW);
    expect(value?.description).not.toContain(NEW + NEW);
  });
});
