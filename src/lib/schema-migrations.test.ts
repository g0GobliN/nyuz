/**
 * Every migration in `supabase/migrations`, applied in order, on a scratch
 * PostgreSQL.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `npm run ci` typechecks the application and runs its tests, and none of that
 * reads a single line of SQL. A migration can therefore be committed, reviewed
 * and pushed while being unapplyable: a misspelled column, a function that
 * references one that a later migration replaces with a different signature, a
 * `references` clause pointing at a table that no longer exists by the time the
 * file runs. The only thing that would notice is a human running
 * `supabase db push`, on the environment where a failure costs the most.
 *
 * PGlite is a real PostgreSQL 16 compiled to WASM, so this is not a parser and
 * not a mock: `create trigger`, `security definer`, enums, partial unique
 * indexes, RLS policies and plpgsql function bodies are all executed. What it is
 * not is Supabase's own platform, so the handful of objects Supabase provides
 * before the first migration -- the three roles, `auth.users`, `auth.uid()` --
 * are bootstrapped here. That gap is the honest limit of this test, and it is
 * small: the migrations touch `auth.uid()`, `auth.users` and `auth.role()` and
 * nothing else of the platform's (no storage, no realtime, no pg_net).
 *
 * ---------------------------------------------------------------------------
 * The chain this was written for
 * ---------------------------------------------------------------------------
 *
 * `0096`–`0101` are the newest files here: discovery, then the material-revision
 * series. Applying them proves they run *after* the ninety-five that came
 * before, and the assertions below pin the specific columns and flags those two
 * workstreams depend on -- so a later edit that removes `discovery_jobs.method`
 * or `events.material_revision` fails here rather than in production.
 *
 * ---------------------------------------------------------------------------
 * What a green run does not prove
 * ---------------------------------------------------------------------------
 *
 * Three things, worth knowing before trusting it.
 *
 * The live project is not an input. This builds the schema these files
 * describe; the project already has one somewhere else, and where the two
 * disagree nothing here can see it. Both directions have already happened.
 * `0058` wrote `sources.updated_at`, a column only the live project had, so the
 * chain could not be applied to an empty database at all -- fixed there, and
 * the fix is the reason this file turned green. And the discovery tables exist
 * in the live project in the shape an earlier revision of `0096` created, with
 * `provider` and `queries` where this chain has `method` and `attempts`. A
 * green run says the files agree with each other, never that they agree with
 * what is deployed.
 *
 * A body is not a call. `create function` checks a plpgsql body when it is
 * created, but a `language sql` body is only parsed then -- planned when it is
 * first used, which for a helper no migration calls is never. Indexes,
 * constraints, enums, `references` clauses and plpgsql bodies are executed;
 * the body of an unused `language sql` function is read and not run.
 *
 * And nothing here is data. The database is empty, so a migration whose
 * statements act on existing rows performs its DDL and none of its
 * consequences: a backfill selects nothing, a conditional update matches
 * nothing. `0058`'s reclassification is the local example -- it runs, and no
 * source changes.
 */

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DIRECTORY = "supabase/migrations";

/** Sorted by filename, which is the order `supabase db push` applies them in. */
const MIGRATIONS = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/**
 * What Supabase has in place before the first migration runs.
 *
 * Deliberately minimal and deliberately ugly: every line here is a thing the
 * migrations are allowed to assume and the test has to provide. If a migration
 * ever needs more of the platform -- a `storage` schema, `net.http_post` --
 * adding it here is the decision point, and refusing to add it is a legitimate
 * answer (that migration then cannot be verified offline at all).
 */
const SUPABASE_BOOTSTRAP = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema auth;

  -- The columns the migrations actually read: 0003 selects from it, 0049 and
  -- others read \`banned_until\`, and the signup triggers read \`email\`.
  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text,
    created_at         timestamptz not null default now(),
    banned_until       timestamptz,
    last_sign_in_at    timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  -- Supabase reads the caller's identity out of the request's JWT. Off-platform
  -- there is no request, so these answer "nobody" -- which is exactly what a
  -- migration's own DDL should see while it is being applied.
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
  $$;
`;

type Failure = { file: string; message: string };

const failures: Failure[] = [];

let db: PGlite;

beforeAll(async () => {
  if (MIGRATIONS.length === 0) throw new Error(`no migrations found in ${DIRECTORY}`);

  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_BOOTSTRAP);

  for (const file of MIGRATIONS) {
    try {
      await db.exec(readFileSync(`${DIRECTORY}/${file}`, "utf8"));
    } catch (error) {
      // Collected rather than thrown: one broken file should report its own
      // message, not hide the ones behind it behind a first failure.
      failures.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
}, 300_000);

afterAll(async () => {
  await db?.close();
});

/** The column names of one table, as PostgreSQL reports them. */
async function columnsOf(table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function flagEnabled(key: string): Promise<boolean | undefined> {
  const { rows } = await db.query<{ enabled: boolean }>(
    "select enabled from public.feature_flags where key = $1",
    [key],
  );
  return rows[0]?.enabled;
}

describe("the migration chain", () => {
  it("applies every file in order without an error", () => {
    // Named individually, because "one of 101 migrations failed" is not a
    // report anyone can act on.
    expect(failures.map((failure) => `${failure.file}: ${failure.message}`)).toEqual([]);
  });

  it("is a numbered series whose order is that of the filenames", () => {
    // The filename is the only thing that orders the chain, so every claim here
    // is about the four digits and the order `readdirSync().sort()` produced.
    expect(MIGRATIONS.every((name) => /^\d{4}_\S+\.sql$/.test(name))).toBe(true);

    const numbers = MIGRATIONS.map((name) => Number(name.slice(0, 4)));

    // Non-decreasing. A file numbered below its predecessor still runs after it,
    // so anything it depends on may not exist yet -- and the opposite mistake,
    // reusing a number for something newer, hides the dependency by sorting the
    // newer file first.
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

    // Gapless among the distinct numbers. A gap is not a failure in itself, but
    // it is what a deleted migration looks like from here, and the next author
    // then reuses the number without knowing a version of it has already run
    // somewhere.
    const distinct = [...new Set(numbers)];
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers) - Math.min(...numbers) + 1).toBe(distinct.length);

    // Duplicate numbers are real in this history: `0056` and `0094` each carry
    // two files, and both pairs are old enough to have been applied in
    // filename order everywhere. That is the only reason they are tolerable --
    // the rest of the filename silently decides. Pinned by number so a *new*
    // collision fails here rather than changing an apply order in production.
    const counts = new Map<number, number>();
    for (const number of numbers) counts.set(number, (counts.get(number) ?? 0) + 1);
    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([number]) => number);
    expect(duplicated).toEqual([56, 94]);
  });
});

describe("what the discovery chain left behind (0096)", () => {
  it("gives a job its deterministic method, terms and link count", async () => {
    expect(await columnsOf("discovery_jobs")).toEqual([
      "attempt",
      "attempts",
      "created_at",
      "error",
      "finished_at",
      "id",
      "linked_count",
      "method",
      "next_attempt_at",
      "started_at",
      "status",
      "terms",
      "topic_id",
    ]);
  });

  it("records where a candidate came from, and remembers rejections", async () => {
    const columns = await columnsOf("source_candidates");
    expect(columns).toContain("method");
    expect(columns).toContain("reject_reason");
    expect(columns).toContain("next_attempt_at");
  });

  it("keeps both tables closed to readers and open to admins", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('discovery_jobs', 'source_candidates') order by relname`,
    );
    expect(rows).toEqual([
      { relname: "discovery_jobs", relrowsecurity: true },
      { relname: "source_candidates", relrowsecurity: true },
    ]);
  });

  it("ships the flag off and the retention sweep present", async () => {
    expect(await flagEnabled("source_discovery_enabled")).toBe(false);

    // Callable with no argument, which is how the dormant stage calls it.
    const { rows } = await db.query<{ purged: number }>(
      "select public.purge_expired_discovery() as purged",
    );
    expect(rows[0]?.purged).toBe(0);
  });
});

describe("what the material-revision chain left behind (0097–0101)", () => {
  it("records an event's material revision and when it was measured", async () => {
    const columns = await columnsOf("events");
    expect(columns).toEqual(
      expect.arrayContaining([
        "material_revision",
        "material_fingerprint",
        "last_material_change_at",
        "material_occurrence_at",
      ]),
    );
  });

  it("records which revision a reader was delivered, on both sides of the send", async () => {
    expect(await columnsOf("user_events")).toContain("delivered_revision");
    expect(await columnsOf("user_events")).toContain("subject_significance");
    expect(await columnsOf("digest_items")).toContain("delivered_revision");
  });

  it("gives a topic a match specification and ships its significance flag off", async () => {
    expect(await columnsOf("topics")).toEqual(
      expect.arrayContaining(["match_spec", "match_spec_source", "match_spec_updated_at"]),
    );
    expect(await flagEnabled("subject_significance_enabled")).toBe(false);
  });
});
