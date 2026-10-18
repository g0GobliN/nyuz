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
import { suppressDeliveredDuplicates } from "./duplicates";
import type { EmailEnv } from "@/lib/server/email/send";
import type { TelegramEnv } from "@/lib/server/telegram/send";
import type { PushEnv } from "@/lib/server/push/send";
import type { BreakingMode, Database } from "@/lib/supabase/types";
import { PLAN_LIMITS, allowedBreaking } from "@/lib/plans";
import { flushDeliveries, queuedChannels, deliveryTargets } from "./digest";
import { FLASH_POLICY, ageHours } from "./freshness";
import { IMPORTANT_FLOOR, assessAlertFloor } from "./alert-floor";
import { alertEligible } from "./subject-significance";
import { assessReadiness } from "./readiness";
import type { ReaderSource } from "../reader-evidence";

export { IMPORTANT_FLOOR };

type Db = SupabaseClient<Database>;

/**
 * Plura's rolling 24-hour ceiling. `claim_alert` (0037) is authoritative;
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
export const IMPORTANT_DAILY_CAP = PLAN_LIMITS.plura.alertDailyCap;

/**
 * Anti-burst pacing. Not a volume limit on breaking news.
 *
 * The failure this exists for is shape, not count. On one Tuesday a single
 * match run fired twenty-two alerts inside a minute, because a run sees every
 * event that became matchable since the last one and `fireAlerts` sent all of
 * them. Twenty-two notices arriving together are unreadable however important
 * each one is: the reader clears the tray without opening any, and the strong
 * story is lost among the ordinary ones for exactly the same reason as the
 * ordinary ones.
 *
 * Spread across the day the same twenty-two would be fine. So the rule is
 * bursts, not budgets:
 *
 *   - `ALERT_BURST` — the strongest few from any one run, so a run that
 *     matched forty events interrupts once with its best rather than forty
 *     times in event order. The rest are not rejected; they are not claimed,
 *     so a later run reconsiders them on their merits.
 *   - `ALERT_BURST_WINDOW_MINUTES` — a sliding window, read off the delivery
 *     ledger rather than a stored timer, that stops the next run refilling the
 *     tray immediately. `MATCH_CRON` fires at :25 and :55, so a 30-minute
 *     window would land exactly on the cadence and let every run through;
 *     45 blocks alternate runs, which paces a backlog at roughly three an
 *     hour and leaves an isolated event free to send the moment it appears.
 *   - `ALERT_DAILY_SAFETY_CAP` — an infrastructure ceiling, not a product
 *     limit. It is here for a matcher bug, a duplicated event or a source
 *     behaving badly, and a real day should never reach it. Twelve genuinely
 *     important developments in one day send twelve.
 *
 * What this deliberately does not do is impose a quiet period. An important
 * acquisition at 10:00 and a major announcement at 12:00 are two events, and
 * the second is not less urgent for the first having happened. The window is
 * measured in minutes for that reason.
 *
 * `claim_alert` (0037) still caps a rolling day at the reader's plan
 * entitlement, and that remains the authority on what a plan is sold. This is a
 * separate concern — the shape of an hour rather than the size of a day.
 */
export const ALERT_BURST = 3;
export const ALERT_BURST_WINDOW_MINUTES = 45;
export const ALERT_DAILY_SAFETY_CAP = 25;

export type AlertHit = {
  eventId: string;
  importance: number;
  /**
   * When the event's current state happened: `events.material_occurrence_at`
   * for a materially revised event, `first_seen_at` otherwise -- the occurrence
   * clock, never the discovery clock, so a development reported last week and
   * discovered today is not breaking news.
   *
   * Required rather than optional, and null-able rather than absent, because
   * "we do not know when this happened" has to be a decision this module makes
   * and not a field a caller can forget. An undated event is not breaking.
   */
  eventAt: string | null;
  /**
   * The event's `material_revision` at match time (0097). With it, a claim or
   * a delivered alert covers that revision and no later one: revision 1 alerted
   * suppresses revision 1 again, and leaves revision 2 to be reconsidered.
   * Absent means a caller that is not revision-aware, which keeps the id-only
   * suppression this module always had.
   */
  revision?: number | undefined;
  /**
   * The interest-conditional signals for this reader and event (P4), present
   * only when the match stage computed them. Read only while the
   * `subject_significance_enabled` flag is on.
   */
  significance?: AlertSignificance | undefined;
};

/**
 * One alertable event, as the send path needs it: what the alert says (`why`)
 * and everything the readiness gate judges it by.
 *
 * The gate's inputs travel with the event rather than being fetched by the gate,
 * because they come from the same rows — the composer's `sources`, the outlets
 * on the story, the feeds' kinds and the event's own clock.
 */
type AlertEventRow = {
  title: string;
  whatHappened: string | null;
  publishedAt: string | null;
  sourceCount: number;
  sourceKinds: string[];
  sources: ReaderSource[];
};

export type AlertSignificance = {
  /** Some admitting topic matched this event firmly (`relevanceStrength`). */
  relevanceStrong: boolean;
  /** The subject score of the firmest such topic (`subjectSignificance`). */
  subject: number;
  /** Reader novelty: 1 when this reader does not hold the current revision. */
  novelty: number;
};

/**
 * Which of this run's qualifying hits go out now.
 *
 * Pure, and given the ledger rather than a database, because this is the
 * judgement the feature is answerable for: it has to be the same judgement in a
 * test as in a run, and readable without standing up Postgres.
 *
 * Importance orders; it does not admit. `shouldAlert` has already decided what
 * qualifies under the reader's `breaking` mode, and this must not second-guess
 * it — a reader on `important` gets nothing when nothing cleared the floor, and
 * a reader on `everything` keeps the broad mode they chose. All this decides is
 * which of the already-qualifying events are worth the interruption first.
 *
 * Everything it leaves behind stays unclaimed, so nothing is silently dropped:
 * `alert_claims` is only written for events that actually reach
 * `create_alert_delivery`, and the tail is reconsidered by the next run.
 */
export function paceAlerts(input: { hits: AlertHit[]; recent: Date[]; now: Date }): AlertHit[] {
  const now = input.now.getTime();
  const sinceDay = now - 24 * 60 * 60 * 1000;
  const sinceBurst = now - ALERT_BURST_WINDOW_MINUTES * 60 * 1000;

  const dayRoom =
    ALERT_DAILY_SAFETY_CAP - input.recent.filter((at) => at.getTime() > sinceDay).length;
  if (dayRoom <= 0) return [];

  const burstRoom = ALERT_BURST - input.recent.filter((at) => at.getTime() > sinceBurst).length;
  if (burstRoom <= 0) return [];

  return [...input.hits]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, Math.min(burstRoom, dayRoom));
}

export type AlertOptions = {
  userId: string;
  hits: AlertHit[];
  /**
   * Whether the interest-conditional alert rule is in force (the
   * `subject_significance_enabled` flag, as the match stage read it). Absent or
   * false is the shipped rule, exactly: `shouldAlert` on importance alone.
   */
  subjectSignificance?: boolean | undefined;
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
  /**
   * Hits the readiness gate refused, and the distinct rules that refused them.
   *
   * Reported rather than silently counted in `skipped` because "nothing was
   * sent" has to be answerable: the dashboard's empty state says the same
   * sentence whether the day was quiet, no reader was listening, or the story
   * nothing could read was withheld. This is the third of those.
   */
  withheld: number;
  withheldKinds: string[];
};

export function shouldAlert(breaking: BreakingMode, importance: number): boolean {
  if (breaking === "off") return false;

  return importance >= IMPORTANT_FLOOR;
}

/**
 * The alert rule for one hit, with the flag's two states spelled out.
 *
 *   flag off, or no signals   `shouldAlert` -- the shipped rule, unchanged
 *   flag on                   `alertEligible`: importance at the floor, OR a
 *                             firmly matched interest carrying a subject
 *                             development this reader does not hold yet
 *
 * `subjectQualified` is true only for the second route. It travels to
 * `claim_alert` (0103), which re-reads the flag and is the authority: a hit
 * below the importance floor cannot be claimed while the flag is off, whatever
 * this function returns.
 */
export function alertDecision(
  breaking: BreakingMode,
  hit: Pick<AlertHit, "importance" | "significance">,
  subjectSignificance: boolean,
): { alert: boolean; subjectQualified: boolean } {
  if (breaking === "off") return { alert: false, subjectQualified: false };
  const shipped = shouldAlert(breaking, hit.importance);
  if (!subjectSignificance || !hit.significance) return { alert: shipped, subjectQualified: false };
  const eligible = alertEligible({ importance: hit.importance, ...hit.significance });
  return { alert: eligible, subjectQualified: eligible && !shipped };
}

/**
 * Whether an event is recent enough to interrupt someone's day.
 *
 * An alert had no age bound at all until now: `shouldAlert` asked only about
 * importance, and the pacing caps only about volume. That is survivable while
 * the pipeline is current and indefensible when it is not — after the September
 * stall, the first analysis run to catch up would have pushed five-day-old
 * stories to phones as breaking news, because the moment an event is *analysed*
 * is the moment it becomes alertable and nothing looked at when it happened.
 *
 * `FLASH_POLICY` is twelve hours preferred and twenty-four hard. Past that the
 * next scheduled briefing is the honest channel: an important old story is a
 * briefing item, never an interruption.
 */
export function withinFlashWindow(eventAt: string | null, now: Date): boolean {
  return ageHours(eventAt, now) <= FLASH_POLICY.maxHours;
}

export function remainingImportantSlots(alreadyToday: number): number {
  return Math.max(0, IMPORTANT_DAILY_CAP - alreadyToday);
}

export async function fireAlerts(db: Db, options: AlertOptions): Promise<AlertReport> {
  const now = options.now ?? new Date();
  const empty: AlertReport = {
    considered: options.hits.length,
    queued: 0,
    sent: 0,
    skipped: 0,
    withheld: 0,
    withheldKinds: [],
  };
  if (options.hits.length === 0) return empty;

  // Age first, before any preference read or provider call. A stale hit is not
  // a cheaper alert, it is not an alert — and the event stays in `user_events`,
  // so the reader still gets it in their next briefing if it is still worth
  // their time by then.
  const hits = options.hits.filter((hit) => withinFlashWindow(hit.eventAt, now));
  if (hits.length === 0) return { ...empty, skipped: options.hits.length };

  const [{ data: prefs, error }, { data: subscription }] = await Promise.all([
    db
      .from("notification_preferences")
      .select("breaking, channels, paused")
      .eq("user_id", options.userId)
      .maybeSingle(),
    db.from("subscriptions").select("plan").eq("user_id", options.userId).maybeSingle(),
  ]);
  if (error) throw new Error(`reading alert prefs: ${error.message}`);
  const plan = subscription?.plan ?? "uno";
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

  const qualified = new Set<string>();
  const admitted = hits.filter((h) => {
    const decision = alertDecision(breaking, h, options.subjectSignificance === true);
    if (decision.subjectQualified) qualified.add(h.eventId);
    return decision.alert;
  });
  if (admitted.length === 0) return { ...empty, skipped: options.hits.length };

  // Revision-aware when the caller is: an alert already delivered for this
  // event covers its revision and every earlier one, and nothing later. A hit
  // with no revision is suppressed by id, as it always was.
  const alerted = await alreadyAlerted(
    db,
    options.userId,
    admitted.map((h) => h.eventId),
  );
  const alreadySent = (h: AlertHit) => {
    const delivered = alerted.get(h.eventId);
    if (delivered === undefined) return false;
    return h.revision === undefined || delivered >= h.revision;
  };
  const revisionAware = admitted.filter((h) => h.revision !== undefined);
  const distinct = await suppressDeliveredDuplicates(
    db,
    options.userId,
    admitted
      .filter((h) => !alreadySent(h))
      .sort((a, b) => b.importance - a.importance)
      .map((h) => h.eventId),
    now,
    "alert",
    revisionAware.length > 0
      ? new Map(revisionAware.map((h) => [h.eventId, h.revision ?? 0] as const))
      : undefined,
  );
  const fresh = admitted.filter((h) => !alreadySent(h) && distinct.has(h.eventId));
  if (fresh.length === 0) {
    return { ...empty, skipped: options.hits.length };
  }

  /**
   * The gate every briefing story passes, which this path never asked.
   *
   * `assessReadiness` is what withholds the empty summary, the build number,
   * the commit message, the newsletter container, the single-source preprint
   * and the story whose own coverage composes no readable body. The briefing
   * has applied it since stage 4; alerts were fired on importance and the flash
   * window alone, so a story the briefing would have refused could still be
   * pushed to a reader's phone as breaking news. Measured on the alert history
   * of 2026-10-11 (`npm run audit:alerts`): **108 of the 205 alerts ever sent
   * would have been refused by this gate** — 69 with no publishable body, 31
   * single-source research items, 5 newsletter containers, 3 machine artifacts.
   *
   * An interruption is the one place the reader has no choice about, so the
   * cheaper failure here is not sending: the event stays in `user_events`, and
   * the next briefing still offers it if it is worth reading by then. The gate
   * runs before `paceAlerts` so a refused hit does not spend one of the burst
   * slots a story someone can actually read should have.
   */
  const events = await loadEvents(
    db,
    fresh.map((h) => h.eventId),
  );
  const withheldKinds = new Set<string>();
  const sendable = fresh.filter((hit) => {
    const event = events.get(hit.eventId);
    if (!event) return false;
    const verdict = assessReadiness({
      title: event.title,
      whatHappened: event.whatHappened,
      publishedAt: event.publishedAt,
      sourceCount: event.sourceCount,
      sourceKinds: event.sourceKinds,
      sources: event.sources,
    });
    if (verdict.ready) {
      // The shape floor, after the briefing's own gate. An alert is a stronger
      // claim than a briefing story: a shape the briefing would publish still
      // must not interrupt a phone when nothing developed (roadmap advertorial,
      // product newsletter, hobby hack, personal blog, price piece).
      const floor = assessAlertFloor({
        title: event.title,
        whatHappened: event.whatHappened,
      });
      if (floor.ready) return true;
      withheldKinds.add(floor.kind);
      return false;
    }
    withheldKinds.add(verdict.kind);
    return false;
  });
  const withheld = fresh.length - sendable.length;
  if (sendable.length === 0) {
    return {
      ...empty,
      skipped: options.hits.length,
      withheld,
      withheldKinds: [...withheldKinds].sort(),
    };
  }

  // The strongest few of what qualified, and only if this run is not refilling
  // a tray the last one just filled. What this drops is left unclaimed on
  // purpose — the next run weighs it again rather than it being lost.
  const sending = paceAlerts({
    hits: sendable,
    recent: await recentAlertTimes(db, options.userId, now),
    now,
  });
  if (sending.length === 0) {
    return {
      ...empty,
      skipped: options.hits.length,
      withheld,
      withheldKinds: [...withheldKinds].sort(),
    };
  }

  let queued = 0;
  let created = 0;
  for (let i = 0; i < sending.length; i += 1) {
    const hit = sending[i];
    if (!hit) continue;
    const event = events.get(hit.eventId);
    if (!event) continue;

    const scheduledFor = new Date(now.getTime() + i).toISOString();
    const { data: result, error: createError } = await db.rpc("create_alert_delivery", {
      p_user_id: options.userId,
      p_event_id: hit.eventId,
      p_importance: hit.importance,
      p_scheduled_for: scheduledFor,
      p_why: event.whatHappened || event.title,
      p_channels: toQueue,
      p_revision: hit.revision ?? 0,
      p_subject_qualified: qualified.has(hit.eventId),
    });
    if (createError) throw new Error(`creating alert: ${createError.message}`);
    if (!result?.startsWith("ok:")) continue;
    created += 1;
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
    skipped: options.hits.length - created,
    withheld,
    withheldKinds: [...withheldKinds].sort(),
  };
}

/**
 * When this reader's alerts actually went out over the last rolling day.
 *
 * `generated_at` rather than `scheduled_for`: both are written when the alert
 * is created, but `scheduled_for` comes from the caller's `now` — which tests
 * and `--now` runs set freely — while `generated_at` is `now()` inside
 * `create_alert_delivery`. Pacing has to read the clock the database kept.
 */
async function recentAlertTimes(db: Db, userId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("digests")
    .select("generated_at")
    .eq("user_id", userId)
    .eq("kind", "alert")
    .gte("generated_at", since);
  if (error) throw new Error(`reading recent alerts: ${error.message}`);
  return (data ?? [])
    .map((row) => (row.generated_at ? new Date(row.generated_at) : null))
    .filter((at): at is Date => at !== null);
}

/**
 * The highest revision of each event this reader has already been alerted to.
 *
 * Read from `digest_items.delivered_revision` on the reader's alert digests,
 * which `create_alert_delivery` stamps (0103). Rows from before that migration
 * carry 0, which is what every event alerted then was.
 */
async function alreadyAlerted(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
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
    .select("event_id, delivered_revision")
    .in("digest_id", ids)
    .in("event_id", eventIds);
  if (itemError) throw new Error(`reading alert items: ${itemError.message}`);
  for (const row of items ?? []) {
    const revision = row.delivered_revision ?? 0;
    found.set(row.event_id, Math.max(found.get(row.event_id) ?? 0, revision));
  }
  return found;
}

async function loadEvents(db: Db, eventIds: string[]): Promise<Map<string, AlertEventRow>> {
  const out = new Map<string, AlertEventRow>();
  if (eventIds.length === 0) return out;
  const { data, error } = await db
    .from("events")
    .select("id, title, what_happened, publisher_count, first_seen_at, material_occurrence_at")
    .in("id", eventIds);
  if (error) throw new Error(`reading alert events: ${error.message}`);

  // The coverage the readiness gate composes from, in the identical shape the
  // reader's page and the briefing hand it (`loadBriefs` in `digest.ts` builds
  // this in the same pass as its other inputs, for a whole briefing's worth of
  // events; the alert path asks for the same rows directly, for a handful).
  // Built the same way on purpose: a gate that judged a different story from
  // the one the reader's page composes would refuse prose that exists.
  const { data: coverage, error: coverageError } = await db
    .from("articles")
    .select("event_id, source_id, title, excerpt, url, sources ( name, kind )")
    .in("event_id", eventIds);
  if (coverageError) throw new Error(`reading alert coverage: ${coverageError.message}`);

  const outlets = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  const evidence = new Map<string, ReaderSource[]>();
  for (const row of coverage ?? []) {
    const eventId = row.event_id;
    if (!eventId) continue;

    const seen = outlets.get(eventId) ?? new Set<string>();
    seen.add(row.source_id ?? "unknown");
    outlets.set(eventId, seen);

    const kind = (row.sources as { kind?: string } | null)?.kind;
    if (kind) kinds.set(eventId, new Set([...(kinds.get(eventId) ?? []), kind]));

    const sourceList = evidence.get(eventId) ?? [];
    sourceList.push({
      name: (row.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(row.title ? { headline: row.title } : {}),
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
      // Carried for the paid-content rung (ruling #7): a gate shown no URL cannot
      // see that every outlet behind an alert is paid, and would send it.
      ...(row.url ? { url: row.url } : {}),
    });
    evidence.set(eventId, sourceList);
  }

  for (const row of data ?? []) {
    out.set(row.id, {
      title: row.title,
      whatHappened: row.what_happened,
      // The occurrence clock for a revised event, `first_seen_at` otherwise --
      // the same choice the reader's page makes when it dates a story, and the
      // date the composer anchors relative time with.
      publishedAt: row.material_occurrence_at ?? row.first_seen_at ?? null,
      sourceCount: row.publisher_count || outlets.get(row.id)?.size || 0,
      sourceKinds: [...(kinds.get(row.id) ?? [])],
      sources: evidence.get(row.id) ?? [],
    });
  }
  return out;
}
