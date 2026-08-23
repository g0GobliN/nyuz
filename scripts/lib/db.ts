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
 * `head: true` sends no rows back — the count arrives in the Content-Range
 * header, so counting three million articles costs one round trip and no
 * payload.
 */
export async function count(table: PipelineTable): Promise<number> {
  const { count: n, error } = await db().from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return n ?? 0;
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
