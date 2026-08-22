import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role Supabase client — pipeline use only.
 *
 * This key BYPASSES Row Level Security. It can read and write every row for
 * every user. It must never reach the browser, so this module must never be
 * imported from a component or anything reachable from client code.
 *
 * On Cloudflare Workers there is no ambient process.env at module scope, so the
 * client is built per call from whatever env the request hands us rather than
 * captured at import time.
 */

export type ServerEnv = {
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function readEnv(env?: ServerEnv): Required<ServerEnv> {
  const proc = globalThis.process?.env;
  const url = env?.VITE_SUPABASE_URL ?? proc?.["VITE_SUPABASE_URL"];
  const key = env?.SUPABASE_SERVICE_ROLE_KEY ?? proc?.["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url) throw new Error("Missing VITE_SUPABASE_URL");
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. In production set it with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.",
    );
  }
  return { VITE_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
}

export function createAdminClient(env?: ServerEnv): SupabaseClient<Database> {
  const { VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = readEnv(env);

  return createClient<Database>(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // No user session to keep. Persisting or refreshing here would be a bug:
      // this client is not acting on behalf of a person.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
