/**
 * Shared plumbing for the operator scripts in scripts/.
 *
 * These run on a laptop against the live project, not on Cloudflare, so they may
 * use `process.env` freely — which is why they live here and not in src/. The
 * client itself is the same `createAdminClient` the Worker uses; it falls back to
 * `process.env` when handed no env bag, so `node --env-file=.env` is enough.
 *
 * Everything here holds the service-role key, which bypasses row-level security.
 * Nothing in this directory may be imported from application code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type Db = SupabaseClient<Database>;

let client: Db | undefined;

/** One client per process. Building several would just open several sockets. */
export function db(): Db {
  client ??= createAdminClient();
  return client;
}

/** Every table the pipeline touches, in the order data flows through them. */
export const PIPELINE_TABLES = [
  "sources",
  "topics",
  "articles",
  "events",
  "event_topics",
  "user_events",
  "digests",
  "digest_items",
  "deliveries",
] as const;

export type PipelineTable = (typeof PIPELINE_TABLES)[number];

/**
 * `select count(*)`, as close as PostgREST gets to it.
 *
 * The count arrives in the Content-Range header, so this is one round trip and
 * at most one row of payload. `head: true` was the obvious way to ask for that
 * and it is deliberately not used, because it makes a *missing relation*
 * indistinguishable from an empty one: a HEAD response has no body, so
 * `postgrest-js` cannot read the 404 PostgREST sent, and `res.text()` comes
 * back `""`. Its error branch then sees `status === 404 && body === ""` and
 * rewrites the whole thing as `{ status: 204, count: null, error: null }` — a
 * success. Measured against the live project:
 *
 *   ops_status             status 200 count 16   error null
 *   sources (no rows)      status 200 count 0    error null
 *   missing relation       status 204 count null error null    <- was "0"
 *   missing column         status 400 count null error ""      <- message lost
 *
 * So `head: true` both hides a missing table behind a zero and throws away the
 * real message on a missing column. Without it the server's own error survives,
 * and `n === null` on a successful response means one of those two happened.
 * `limit(1)` keeps the payload bounded.
 */
export async function count(table: PipelineTable): Promise<number> {
  const { count: n, error } = await db().from(table).select("*", { count: "exact" }).limit(1);
  if (error) throw new Error(`count(${table}): ${error.message}`);
  if (n === null) throw new Error(`count(${table}): the server returned no count`);
  return n;
}

/* ---------------------------------------------------------------------- */
/* Output                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Plain stdout, deliberately. These scripts are read in a terminal and pasted
 * into commit messages and docs/status.md as evidence that something really ran,
 * so the output has to survive being copied — no spinners, no cursor tricks, no
 * colour.
 */
export function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function heading(text: string): void {
  say();
  say(text);
  say("─".repeat(text.length));
}

/** Right-aligns numbers so a column of counts can be read down. */
export function row(label: string, value: string | number, width = 22): string {
  return `${label.padEnd(width)} ${String(value).padStart(8)}`;
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Exits non-zero on an unhandled rejection instead of Node's default warning.
 * A seed script that half-worked and exited 0 is worse than one that stops.
 */
export function main(run: () => Promise<void>): void {
  run().catch((error: unknown) => {
    fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
  });
}
