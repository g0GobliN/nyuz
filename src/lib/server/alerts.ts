/**
 * Reading breaking alerts back.
 *
 * Its own module rather than another export from briefing.ts, because alert
 * history and briefing history are separate product surfaces that happen to
 * share a table. Keeping the read paths apart is what makes it possible to
 * change one entitlement later without reading the other's code to find out
 * what broke.
 *
 * The storage stays shared on purpose: an alert is a `digests` row with
 * `kind = 'alert'` (0009), because deliveries require a digest_id and one table
 * means one purge and one delivery ledger. What is NOT shared is the number —
 * see `alert_window_start` in 0073.
 */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInput } from "@/lib/server/validate";
import {
  ALERT_CANDIDATE_FACTOR,
  ALERT_HISTORY_PAGE,
  RECENT_ALERT_LIMIT,
  isAlertCursor,
  selectDeliveredAlerts,
  type AlertPage,
  type SentAlert,
} from "@/lib/alerts-recent";
import type { Database } from "@/lib/supabase/types";
import { signedInOnly } from "./guard";

type Db = SupabaseClient<Database>;

export type { AlertPage, SentAlert };

/**
 * The oldest alert this reader may read, as the database sees it.
 *
 * Throws rather than falling back, for the reason `historyWindowStart` does:
 * an unavailable entitlement boundary reads as "no alerts right now", never as
 * "all of them". These handlers run on the service-role client, where RLS is
 * bypassed, so this call IS the boundary on this path — the policy in 0073 is
 * the backstop for anything querying as the reader.
 */
export async function alertWindowStart(db: Db, userId: string): Promise<string> {
  const { data, error } = await db.rpc("alert_window_start", { p_user: userId });
  if (error) throw new Error(`reading alert window: ${error.message}`);
  if (typeof data !== "string") throw new Error("reading alert window: no window returned");
  return data;
}

/**
 * One eligibility rule, two limits.
 *
 * Recent alerts and alert history differ in how many rows they return and in
 * nothing else. Sharing this is what stops the two lists disagreeing about
 * whether a given alert exists.
 */
async function readAlerts(
  db: Db,
  userId: string,
  limit: number,
  before?: string | undefined,
): Promise<AlertPage> {
  const windowStart = await alertWindowStart(db, userId);

  // The cursor narrows the read; the window still bounds it. A `before` from an
  // edited URL can only ever ask for LESS than the entitlement, never more.
  //
  // Deliberately no `digests.status` filter. The status column conflates the
  // generation lifecycle with delivery (an alert whose email arrived and whose
  // push failed stays `ready` forever), so it is not a test of whether an alert
  // was delivered. The honest state is `selectDeliveredAlerts`, which reads the
  // per-channel `deliveries` rows — the same rows this query fetches below —
  // and shows only alerts a channel actually reached. Alert digests are only
  // ever `ready`, `sent` or `failed`, so the wider read costs nothing and the
  // delivery-based filter is the whole of the truth.
  let query = db
    .from("digests")
    .select("digest_id, scheduled_for")
    .eq("user_id", userId)
    .eq("kind", "alert")
    .gte("scheduled_for", windowStart);
  if (before) query = query.lt("scheduled_for", before);

  const { data: rows, error } = await query
    .order("scheduled_for", { ascending: false })
    .limit(limit * ALERT_CANDIDATE_FACTOR);
  if (error) throw new Error(`reading alerts: ${error.message}`);

  const digests = rows ?? [];
  if (digests.length === 0) return { alerts: [], hasMore: false, nextBefore: null };

  const ids = digests.map((row) => row.digest_id);
  const [{ data: items, error: itemError }, { data: deliveries, error: deliveryError }] =
    await Promise.all([
      db
        .from("digest_items")
        .select("digest_id, event_id, why_it_matters, events ( title )")
        .in("digest_id", ids),
      db.from("deliveries").select("digest_id, status, delivered_at").in("digest_id", ids),
    ]);
  if (itemError) throw new Error(`reading alert items: ${itemError.message}`);
  if (deliveryError) throw new Error(`reading alert deliveries: ${deliveryError.message}`);

  return selectDeliveredAlerts({
    digests,
    deliveries: deliveries ?? [],
    items: (items ?? []).map((row) => ({
      digest_id: row.digest_id,
      event_id: row.event_id,
      title: (row.events as { title?: string } | null)?.title ?? "",
      why: row.why_it_matters,
    })),
    limit,
  });
}

/** The latest twenty delivered alerts, for the Alerts page. */
export const loadRecentAlerts = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<AlertPage> =>
    readAlerts(context.actor.db, context.actor.id, RECENT_ALERT_LIMIT),
  );

/** One page of alert history, its oldest boundary given by the previous page. */
export const loadAlertHistory = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(
      z.object({
        before: z.string().refine(isAlertCursor, "That is not a valid time.").optional(),
      }),
      input ?? {},
    ),
  )
  .handler(async ({ context, data }): Promise<AlertPage> =>
    readAlerts(context.actor.db, context.actor.id, ALERT_HISTORY_PAGE, data.before),
  );
