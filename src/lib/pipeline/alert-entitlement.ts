import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PlanTier } from "../supabase/types";
import { PLAN_LIMITS } from "../plans";

/** Recheck queued alerts after subscription changes. Existing claims still count. */
export async function alertDeliveryAllowed(
  db: SupabaseClient<Database>,
  userId: string,
  digestId: string,
  plan: PlanTier,
  now: Date,
): Promise<boolean> {
  const { data: items, error: itemError } = await db
    .from("digest_items")
    .select("event_id")
    .eq("digest_id", digestId);
  if (itemError) throw new Error(itemError.message);
  const { data: claims, error } = await db
    .from("alert_claims")
    .select("event_id, created_at")
    .eq("user_id", userId)
    .gte("created_at", new Date(now.getTime() - 86_400_000).toISOString())
    .order("created_at")
    .order("event_id")
    .limit(PLAN_LIMITS[plan].alertDailyCap);
  if (error) throw new Error(error.message);
  const allowed = new Set((claims ?? []).map((c) => c.event_id));
  return (items?.length ?? 0) > 0 && (items ?? []).every((item) => allowed.has(item.event_id));
}
