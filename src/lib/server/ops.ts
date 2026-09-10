import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

export type BriefingReadiness = {
  upcoming_briefings: number;
  fresh_matching_stories_ready: number;
  fresh_relevant_waiting_clustering: number;
  fresh_relevant_waiting_analysis: number;
  under_supplied_briefings: number;
  next_deadline: string | null;
};

export function briefingReadinessStatus(readiness: BriefingReadiness): "healthy" | "warning" {
  return readiness.under_supplied_briefings > 0 ? "warning" : "healthy";
}

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

export async function recordBriefingReadiness(db: Db): Promise<void> {
  const { data, error } = await db.rpc("briefing_readiness", {
    p_horizon_minutes: 120,
    p_fresh_hours: 24,
    p_target: 3,
  });
  if (error) {
    console.error(`reading briefing readiness: ${error.message}`);
    return;
  }

  const readiness = data?.[0];
  if (!readiness) return;
  await recordOps(db, "briefing:readiness", briefingReadinessStatus(readiness), readiness);
}
