/**
 * Ruling #12c's exemption, executed on a real PostgreSQL.
 *
 * The experiment is one sentence — *exactly eight dormant sources are exempted from the demand gate,
 * the other 18 stay withheld, for thirty days and no longer* — and every part of that sentence is a
 * property of SQL rather than of TypeScript. So it is tested where it lives: a scratch PGlite
 * database with the 26 withholds the live gate actually answers, then migration `0120` applied to it.
 *
 * What the three blocks pin down:
 *
 *   1. applying the migration changes no behaviour — the rows are granted but off, so the gate still
 *      withholds all 26;
 *   2. starting the window releases exactly the eight named sources, and says so in the reason the
 *      pipeline prints (`exempt: 12c-30d`), while the other 18 are still refused for the same demand
 *      reason as before;
 *   3. the window ends by itself — past `ends_at`, or enabled with no window written at all, the gate
 *      withholds again. "Bounded" is the property the arbiter approved; an exemption that outlives
 *      its window is a different ruling.
 *
 * The names and the 50-day demand gap are copied from the live gate's own output
 * (`npm run baseline:sources`, 2026-10-19), so a test that passes here is answering the question the
 * production database will be asked.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();

/** The eight the ruling selected, in the order the decision log lists them. */
const EIGHT = [
  "BBC Politics",
  "The Guardian Politics",
  "BBC Health",
  "NPR Health",
  "BBC Science",
  "The Guardian Environment",
  "Wired",
  "Engadget",
];

/** The other 18 the gate withholds. None of these may move while the experiment runs. */
const OTHER_WITHHELD = [
  "The Guardian Film",
  "Rock Paper Shotgun",
  "The Guardian Business",
  "The Robot Report",
  "Polygon",
  "Product Hunt",
  "BBC Entertainment",
  "Crunchbase News",
  "ESPN",
  "The Guardian Sport",
  "Y Combinator",
  "Eurogamer",
  "The Guardian Music",
  "Pitchfork",
  "BBC Sport",
  "IEEE Spectrum Robotics",
  "TechRadar Pro",
  "BBC Business",
];

type Verdict = { source_id: string; eligible: boolean; reason: string };

const gate = async (): Promise<Verdict[]> =>
  (await db.query<Verdict>("select * from public.sources_to_collect(72) order by source_id")).rows;

const nameOf = async (id: string): Promise<string> =>
  (await db.query<{ name: string }>("select name from public.sources where id = $1", [id])).rows[0]!
    .name;

const byName = async (): Promise<Map<string, Verdict>> => {
  const out = new Map<string, Verdict>();
  for (const verdict of await gate()) out.set(await nameOf(verdict.source_id), verdict);
  return out;
};

beforeAll(async () => {
  // The columns `sources_to_collect` and migration 0120 read, and nothing else: a minimal table is
  // what makes this a test of the migration rather than of the live schema.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.sources (
      id uuid primary key,
      name text not null,
      active boolean not null default true,
      coverage_mode text,
      last_demand_at timestamptz
    );
  `);

  const names = [...EIGHT, ...OTHER_WITHHELD];
  for (const [index, name] of names.entries()) {
    await db.query(
      `insert into public.sources (id, name, active, coverage_mode, last_demand_at)
       values ($1, $2, true, 'demand', now() - interval '50 days')`,
      [`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name],
    );
  }
  // One core source: exempt from the gate by coverage mode, so it must never be reported as exempt.
  await db.query(
    `insert into public.sources (id, name, active, coverage_mode, last_demand_at)
     values ('00000000-0000-4000-8000-000000000099', 'BBC News', true, 'core', null)`,
  );

  await db.exec(readFileSync("supabase/migrations/0120_source_experiment_exemptions.sql", "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

it("seeds the eight granted but off, and changes nobody's answer", async () => {
  const seeded = await db.query<{ experiment: string; enabled: boolean; starts_at: string | null }>(
    "select experiment, enabled, starts_at from public.source_exemptions order by source_id",
  );
  expect(seeded.rows).toHaveLength(8);
  expect(new Set(seeded.rows.map((row) => row.experiment))).toEqual(new Set(["12c-30d"]));
  expect(seeded.rows.every((row) => row.enabled === false && row.starts_at === null)).toBe(true);

  const verdicts = await gate();
  expect(verdicts.filter((verdict) => !verdict.eligible)).toHaveLength(26);
  expect(verdicts.filter((verdict) => verdict.reason.startsWith("exempt"))).toHaveLength(0);
});

it("releases exactly the eight once the window is started, and leaves the other 18 withheld", async () => {
  await db.exec(`
    update public.source_exemptions
       set enabled = true, starts_at = now() - interval '1 minute', ends_at = now() + interval '30 days';
  `);

  const verdicts = await byName();
  const exempt = [...verdicts.entries()].filter(([, verdict]) =>
    verdict.reason.startsWith("exempt"),
  );
  expect(new Set(exempt.map(([name]) => name))).toEqual(new Set(EIGHT));
  expect(exempt.every(([, verdict]) => verdict.eligible)).toBe(true);
  expect(new Set(exempt.map(([, verdict]) => verdict.reason))).toEqual(
    new Set(["exempt: 12c-30d"]),
  );

  for (const name of OTHER_WITHHELD) {
    const verdict = verdicts.get(name)!;
    expect(verdict.eligible, `${name} must stay withheld`).toBe(false);
    expect(verdict.reason).toMatch(/^no demand for \d+ days$/);
  }
  // The core source is collected for its own reason, not because of the experiment.
  expect(verdicts.get("BBC News")!.reason).toBe("core");
  expect(verdicts.get("BBC News")!.eligible).toBe(true);
});

it("withholds again when the window has passed or was never started", async () => {
  await db.exec(`
    update public.source_exemptions
       set starts_at = now() - interval '31 days', ends_at = now() - interval '1 day';
  `);
  expect((await gate()).filter((verdict) => !verdict.eligible)).toHaveLength(26);

  // Enabled with no window written is not an exemption. The check constraint makes this state
  // unreachable through the documented enable statement; the gate must not depend on that.
  await db.exec(`
    update public.source_exemptions set enabled = true, starts_at = null, ends_at = null;
  `);
  expect((await gate()).filter((verdict) => !verdict.eligible)).toHaveLength(26);
});
