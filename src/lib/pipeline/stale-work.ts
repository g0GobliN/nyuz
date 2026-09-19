import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

export type StaleWorkOptions = {
  now?: Date;
  limit?: number;
  dryRun?: boolean;
};

export type StaleWorkReport = {
  startedAt: string;
  finishedAt: string;
  limit: number;
  dryRun: boolean;
  expiredBriefings: number;
  expiredDeliveries: number;
  detail: string;
};

const BRIEFING_GRACE_MS = 120 * 60_000;
const DELIVERY_GRACE_MS = 24 * 60 * 60_000;

export async function expireStaleWork(
  db: Db,
  options: StaleWorkOptions = {},
): Promise<StaleWorkReport> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5_000));
  const briefingBefore = new Date(now.getTime() - BRIEFING_GRACE_MS).toISOString();
  const deliveryBefore = new Date(now.getTime() - DELIVERY_GRACE_MS).toISOString();

  const [briefings, deliveries] = await Promise.all([
    db
      .from("digests")
      .select("digest_id", { count: "exact", head: true })
      .eq("kind", "briefing")
      .eq("status", "ready")
      .lt("scheduled_for", briefingBefore)
      .limit(limit),
    db
      .from("deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("created_at", deliveryBefore)
      .limit(limit),
  ]);
  if (briefings.error) throw new Error(`reading stale briefings: ${briefings.error.message}`);
  if (deliveries.error) throw new Error(`reading stale deliveries: ${deliveries.error.message}`);

  if (options.dryRun === true) {
    return {
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      limit,
      dryRun: true,
      expiredBriefings: briefings.count ?? 0,
      expiredDeliveries: deliveries.count ?? 0,
      detail: "dry run; no rows were changed",
    };
  }

  const { data, error } = await db.rpc("expire_stale_work", { p_limit: limit });
  if (error) throw new Error(`expiring stale work: ${error.message}`);
  const result = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Json & {
    expired_briefings?: unknown;
    expired_deliveries?: unknown;
  };
  const expiredBriefings =
    typeof result.expired_briefings === "number" ? result.expired_briefings : 0;
  const expiredDeliveries =
    typeof result.expired_deliveries === "number" ? result.expired_deliveries : 0;

  return {
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    limit,
    dryRun: false,
    expiredBriefings,
    expiredDeliveries,
    detail: "rows retained; stale active work was closed",
  };
}
