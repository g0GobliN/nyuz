import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

export async function recordOps(
  db: Db,
  key: string,
  status: "healthy" | "warning" | "error",
  detail: Record<string, Json> = {},
): Promise<void> {
  const { error } = await db.rpc("record_ops_status", {
    p_key: key,
    p_status: status,
    p_detail: detail,
  });
  if (error) console.error(`recording ops status ${key}: ${error.message}`);
}
