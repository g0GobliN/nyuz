/**
 * Out-of-schedule alerts, fired from matching — not from a second cron.
 *
 * A reader who asked for breaking news is owed a send the moment a new event
 * matches them, not at send_at. That send still needs a `digest_id` (deliveries
 * require one), so an alert is a digest of `kind = 'alert'`: one item, no model
 * call, `generation_tokens = 0`. The shared analysis already wrote what happened;
 * repeating it here as `why_it_matters` is honest rather than a second spend.
 *
 * Day-one backfill sets `skipAlerts`. Matching a backlog of old events must not
 * dump a week's worth of "breaking" mail into an inbox that just signed up.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailEnv } from "@/lib/server/email/send";
import type { TelegramEnv } from "@/lib/server/telegram/send";
import type { PushEnv } from "@/lib/server/push/send";
import type { BreakingMode, Database } from "@/lib/supabase/types";
import { allowedBreaking } from "@/lib/plans";
import { flushDeliveries, queuedChannels, deliveryTargets } from "./digest";

type Db = SupabaseClient<Database>;

/** Same floor as Minimal density: "only the things you would regret missing". */
export const IMPORTANT_FLOOR = 6;

/**
 * Personal's rolling 24-hour ceiling. `claim_alert` (0037) is authoritative;
 * this mirrors it so the UI can say how much room is left without a round trip.
 *
 * A ceiling rather than a ration. `IMPORTANT_FLOOR` is what keeps the number
 * near zero on an ordinary day — this only stops an extraordinary one, or a
 * scoring bug, from emptying itself into somebody's phone.
 *
 * It was 3 per rolling *seven days*, which meant three alerts on a busy Tuesday
 * bought silence until the following Tuesday, with nothing in the product
 * saying so. Quiet should mean nothing important happened, never that a quota
 * ran out days ago.
 */
export const IMPORTANT_DAILY_CAP = 10;

export type AlertHit = { eventId: string; importance: number };

export type AlertOptions = {
  userId: string;
  hits: AlertHit[];
  now?: Date | undefined;
  email?: EmailEnv | undefined;
  telegram?: TelegramEnv | undefined;
  push?: PushEnv | undefined;
};

export type AlertReport = {
  considered: number;
  queued: number;
  sent: number;
  skipped: number;
};

export function shouldAlert(breaking: BreakingMode, importance: number): boolean {
  if (breaking === "off") return false;
  if (breaking === "everything") return true;
  return importance >= IMPORTANT_FLOOR;
}

export function remainingImportantSlots(alreadyToday: number): number {
  return Math.max(0, IMPORTANT_DAILY_CAP - alreadyToday);
}

export async function fireAlerts(db: Db, options: AlertOptions): Promise<AlertReport> {
  const now = options.now ?? new Date();
  const empty: AlertReport = { considered: options.hits.length, queued: 0, sent: 0, skipped: 0 };
  if (options.hits.length === 0) return empty;

  const [{ data: prefs, error }, { data: subscription }] = await Promise.all([
    db
      .from("notification_preferences")
      .select("breaking, channels, paused")
      .eq("user_id", options.userId)
      .maybeSingle(),
    db.from("subscriptions").select("plan").eq("user_id", options.userId).maybeSingle(),
  ]);
  if (error) throw new Error(`reading alert prefs: ${error.message}`);
  const plan = subscription?.plan ?? "free";
  const breaking = prefs ? allowedBreaking(plan, prefs.breaking) : "off";
  if (!prefs || prefs.paused || breaking === "off") {
    return { ...empty, skipped: options.hits.length };
  }

  const { data: flag } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", "breaking_alerts")
    .maybeSingle();
  if (flag?.enabled !== true) {
    return { ...empty, skipped: options.hits.length };
  }

  const toQueue = queuedChannels(prefs.channels, await deliveryTargets(db, options.userId));
  if (toQueue.length === 0) return { ...empty, skipped: options.hits.length };

  const admitted = options.hits.filter((h) => shouldAlert(breaking, h.importance));
  if (admitted.length === 0) return { ...empty, skipped: options.hits.length };

  const known = await alreadyAlerted(
    db,
    options.userId,
    admitted.map((h) => h.eventId),
  );
  const fresh = admitted.filter((h) => !known.has(h.eventId));
  if (fresh.length === 0) {
    return { ...empty, skipped: options.hits.length };
  }

  const chosen: AlertHit[] = [];
  for (const hit of fresh) {
    const { data: claim, error: claimError } = await db.rpc("claim_alert", {
      p_user_id: options.userId,
      p_event_id: hit.eventId,
      p_importance: hit.importance,
    });
    if (claimError) throw new Error(`claiming alert: ${claimError.message}`);
    if (claim === "ok") chosen.push(hit);
  }
  if (chosen.length === 0) return { ...empty, skipped: options.hits.length };
  const events = await loadEvents(
    db,
    chosen.map((h) => h.eventId),
  );

  let queued = 0;
  for (let i = 0; i < chosen.length; i += 1) {
    const hit = chosen[i];
    if (!hit) continue;
    const event = events.get(hit.eventId);
    if (!event) continue;

    const scheduledFor = new Date(now.getTime() + i).toISOString();
    const { data: digest, error: writeError } = await db
      .from("digests")
      .insert({
        user_id: options.userId,
        scheduled_for: scheduledFor,
        generated_at: now.toISOString(),
        status: "ready",
        item_count: 1,
        generation_tokens: 0,
        kind: "alert",
      })
      .select("digest_id")
      .maybeSingle();
    if (writeError || !digest) {
      console.error(`alert digest for ${options.userId}: ${writeError?.message ?? "no row"}`);
      continue;
    }

    const { error: itemError } = await db.from("digest_items").insert({
      digest_id: digest.digest_id,
      event_id: hit.eventId,
      position: 0,
      why_it_matters: event.whatHappened || event.title,
    });
    if (itemError) {
      console.error(`alert item for ${digest.digest_id}: ${itemError.message}`);
      continue;
    }

    await db
      .from("user_events")
      .update({ briefed_at: now.toISOString() })
      .eq("user_id", options.userId)
      .eq("event_id", hit.eventId);

    const { error: queueError } = await db.from("deliveries").upsert(
      toQueue.map((channel) => ({
        digest_id: digest.digest_id,
        channel,
        status: "queued" as const,
      })),
      { onConflict: "digest_id,channel", ignoreDuplicates: true },
    );
    if (queueError) {
      console.error(`alert queue for ${digest.digest_id}: ${queueError.message}`);
      continue;
    }
    queued += toQueue.length;
  }

  let sent = 0;
  if (queued > 0) {
    const flushed = await flushDeliveries(db, {
      userIds: [options.userId],
      ...(options.email ? { email: options.email } : {}),
      ...(options.telegram ? { telegram: options.telegram } : {}),
      ...(options.push ? { push: options.push } : {}),
    });
    sent = flushed.sent;
  }

  return {
    considered: options.hits.length,
    queued,
    sent,
    skipped: options.hits.length - chosen.length,
  };
}

async function alreadyAlerted(db: Db, userId: string, eventIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (eventIds.length === 0) return found;

  const { data: digests, error } = await db
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .eq("kind", "alert");
  if (error) throw new Error(`reading alert digests: ${error.message}`);
  const ids = (digests ?? []).map((d) => d.digest_id);
  if (ids.length === 0) return found;

  const { data: items, error: itemError } = await db
    .from("digest_items")
    .select("event_id")
    .in("digest_id", ids)
    .in("event_id", eventIds);
  if (itemError) throw new Error(`reading alert items: ${itemError.message}`);
  for (const row of items ?? []) found.add(row.event_id);
  return found;
}

async function loadEvents(
  db: Db,
  eventIds: string[],
): Promise<Map<string, { title: string; whatHappened: string }>> {
  const out = new Map<string, { title: string; whatHappened: string }>();
  if (eventIds.length === 0) return out;
  const { data, error } = await db
    .from("events")
    .select("id, title, what_happened")
    .in("id", eventIds);
  if (error) throw new Error(`reading alert events: ${error.message}`);
  for (const row of data ?? []) {
    out.set(row.id, { title: row.title, whatHappened: row.what_happened });
  }
  return out;
}
