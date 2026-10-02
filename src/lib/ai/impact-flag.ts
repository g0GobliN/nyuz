import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * Gate for the one metered background stage: the shared impact writer.
 *
 * Default is OFF. The code-first policy is zero provider calls unless an
 * operator turns this on deliberately — the briefing's deterministic ladder
 * ("why am I seeing this" from coverage counts and the reader's own follows)
 * is the behaviour that ships, and the writer only *upgrades* rung 3 into a
 * per-story sentence when someone chooses to spend on it.
 *
 * Deliberately not part of `loadLaunchFlags` and deliberately not a kill
 * switch: the kill switch is an emergency stop for every AI path at once,
 * while this is an enable switch for exactly one optional stage. When the
 * flag is off the stage is a no-op that reports itself as skipped — visible
 * in cron logs and the pipeline CLI, indistinguishable from an idle run.
 */
export async function isImpactWriterEnabled(db: Db): Promise<boolean> {
  const { data } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "impact_writer_enabled")
    .maybeSingle();
  return data?.enabled === true;
}
