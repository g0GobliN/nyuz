/**
 * Applies the INSERT statements of a migration through PostgREST.
 *
 *   npm run db:seed                                  -- 0006, the feeds and topics
 *   npm run db:seed -- supabase/migrations/0006_sources.sql
 *   npm run db:seed -- --dry-run supabase/migrations/0006_sources.sql
 *
 * ---------------------------------------------------------------------------
 * Why this exists, and what it deliberately cannot do
 * ---------------------------------------------------------------------------
 *
 * `supabase db push` is the real way to apply a migration, and it needs either a
 * linked project (there is no supabase/config.toml here) or the database
 * password (which is not in .env, and is not the service-role key). Neither is
 * available, so a data-only migration would otherwise sit in the repo unapplied
 * while docs/plan.md asks for a row count as proof it ran.
 *
 * The service-role key can write rows, though — that is what the pipeline uses it
 * for. So this reads the migration, extracts its INSERTs, and replays them as
 * PostgREST upserts. `on conflict (col) do nothing` maps exactly onto
 * `Prefer: resolution=ignore-duplicates`, so re-running is as safe here as
 * re-running the migration would be.
 *
 * **It refuses anything that is not an INSERT.** A file containing `create
 * function`, `alter table` or `grant` is reported and nothing is applied — no
 * partial run, no silent skip. DDL genuinely needs a Postgres connection, and a
 * tool that quietly ignored half a migration would be worse than one that cannot
 * run it at all: the operator would believe the schema had changed.
 *
 * This is a stopgap with a clear edge. Once the CLI is linked, use it instead.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, fail, heading, main, say } from "./lib/db.ts";
import { parseInserts, type SqlValue } from "./lib/sql-inserts.ts";

const DEFAULT_FILES = ["supabase/migrations/0006_sources.sql"];

/** Big enough that the seed is one round trip, small enough for a huge file. */
const BATCH = 500;

main(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const files = args.filter((a) => !a.startsWith("--"));
  const targets = files.length > 0 ? files : DEFAULT_FILES;

  for (const file of targets) {
    await applyFile(file, dryRun);
  }
  say();
});

async function applyFile(file: string, dryRun: boolean): Promise<void> {
  const absolute = path.resolve(process.cwd(), file);
  const sql = await readFile(absolute, "utf8");

  heading(path.basename(file));

  const parsed = parseInserts(sql);

  if (parsed.rejected.length > 0) {
    say("This file contains statements that only a Postgres connection can run:");
    say();
    for (const statement of parsed.rejected) say(`  ${statement}`);
    say();
    fail(
      [
        "Nothing was applied.",
        "",
        "Run it with the Supabase CLI or paste it into the SQL editor at",
        "https://supabase.com/dashboard/project/<ref>/sql — a service-role key",
        "cannot change the schema, only the rows in it.",
      ].join("\n"),
    );
  }

  if (parsed.inserts.length === 0) {
    say("No INSERT statements found. Nothing to do.");
    return;
  }

  for (const statement of parsed.inserts) {
    if (!statement.onConflict) {
      fail(
        `insert into ${statement.table}: no "on conflict (col) do nothing" clause. ` +
          "Refusing to replay an insert that is not re-runnable — a second run would " +
          "duplicate every row.",
      );
    }

    const rows = statement.rows.map((values) =>
      Object.fromEntries(statement.columns.map((column, i) => [column, values[i] ?? null])),
    );

    if (dryRun) {
      say(
        `${statement.table}: ${rows.length} rows would be upserted on ${statement.onConflict} (dry run)`,
      );
      continue;
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      inserted += await upsert(statement.table, rows.slice(i, i + BATCH), statement.onConflict);
    }

    // Skipped rows are the normal case on a second run, not a warning. Saying
    // both numbers is the whole point: "0 inserted, 66 already there" is how an
    // operator learns the seed had already been applied.
    say(
      `${statement.table}: ${inserted} inserted, ${rows.length - inserted} already present ` +
        `(matched on ${statement.onConflict})`,
    );
  }
}

/**
 * One upsert, returning how many rows were genuinely new.
 *
 * With `ignoreDuplicates` PostgREST returns only the rows it actually inserted,
 * so the length of the response is the insert count rather than a guess.
 */
async function upsert(
  table: string,
  rows: Record<string, SqlValue>[],
  onConflict: string,
): Promise<number> {
  const { data, error } = await loose()
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: true })
    .select("*");

  if (error) throw new Error(`insert into ${table}: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * The Supabase client, with its table names widened to `string`.
 *
 * `Database` types every table name as a literal, which is exactly what you want
 * everywhere else and exactly what cannot work here — the table comes out of a
 * file at runtime. The cast is confined to this one function so the rest of the
 * script keeps its types.
 */
type LooseDb = {
  from: (table: string) => {
    upsert: (
      rows: Record<string, SqlValue>[],
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => {
      select: (
        columns: string,
      ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
};

function loose(): LooseDb {
  return db() as unknown as LooseDb;
}
