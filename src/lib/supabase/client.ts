import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Browser-side Supabase client.
 *
 * This uses the anon key, which is public by design — it is compiled into the
 * bundle every visitor downloads. Row Level Security is what actually protects
 * the data, so any table reachable from here must have policies (0002_rls.sql).
 * Never swap this for the service-role key.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.",
  );
}

let browserClient: SupabaseClient<Database> | undefined;

/**
 * One client per browser session. A second instance would register its own
 * auth listener and the two would race on token refresh.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}
