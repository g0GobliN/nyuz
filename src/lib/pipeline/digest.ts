import { PLAN_LIMITS, STANDARD_DELIVERY_TIME } from "../plans";
import { alertDeliveryAllowed } from "./alert-entitlement";
/**
 * Stage 7 — building a briefing, then sending it.
 *
 * ---------------------------------------------------------------------------
 * Deterministic assembly, not a per-reader model call (docs/track.md phase 2)
 * ---------------------------------------------------------------------------
 *
 * Stages 3 and 4 understood an event once, for everybody. Stage 5 decided who
 * sees it, with no model. This stage used to write one short paragraph per
 * person per story; it now assembles `digest_items.why_it_matters` from
 * `event_impacts` — the shared explanation written once per event during
 * analysis — and deterministic facts already stored on the event. Missing
 * impact rows fall back to the event's after-state, a factual coverage line,
 * a figure or subject rung, and only then to the reader's follow graph.
 * Briefing assembly never calls a model.
 *
 * A quiet day is a real outcome: `status = 'skipped'`, zero items, and a short
 * email that says so rather than a padded briefing. Paused readers are not
 * scheduled at all.
 *
 * ---------------------------------------------------------------------------
 * Idempotence
 * ---------------------------------------------------------------------------
 *
 * `(user_id, scheduled_for)` is unique, so creating the next slot twice writes
 * nothing the second time. An event already in a digest_item for this reader
 * is never selected again. A delivery is unique on `(digest_id, channel)`, and
 * the Resend call carries the same pair as an idempotency key, so a retry of a
 * send whose response was lost does not land twice in the inbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  suppressDeliveredDuplicates,
  suppressDeliveredTwins,
  suppressStoryTwins,
} from "./duplicates";
import { capitalised } from "./news-signals";
import type { SecretBag } from "@/lib/ai/config";
import { countOrThrow } from "@/lib/supabase/count";
import { capFor } from "@/lib/density";
import { reasonFor } from "./inclusion";
import { assessReadiness } from "./readiness";
import type { ReaderSource } from "../reader-evidence";
import { composedSummaryArtifact, deliveredTranslatedLine } from "../reader-summary";
import { needsTranslation, toLanguageTag, type LanguageTag } from "@/lib/languages";
import { translateEvents, type TranslatableEvent, type TranslatedText } from "./translate";
import { mailGrafs } from "@/lib/article-body";
import { briefingEmail, breakingEmail } from "@/lib/email/templates";
import { findRecipient } from "@/lib/server/email/lifecycle";
import { sendEmail, siteUrl, type EmailEnv } from "@/lib/server/email/send";
import { unsubscribeUrl } from "@/lib/server/email/unsubscribe";
import { recordOps } from "@/lib/server/ops";
import { sendTelegramMessage, type TelegramEnv } from "@/lib/server/telegram/send";
import { sendStoryPushes, type PushEnv } from "@/lib/server/push/send";
import { formatTelegramAlert, formatTelegramBriefing } from "@/lib/telegram/format";
import { briefingPush, partOfDay, storyPush } from "@/lib/push/payload";
import type {
  Database,
  DeliveryChannel,
  DigestFrequency,
  DigestStatus,
  ImpactStatus,
  PlanTier,
} from "@/lib/supabase/types";
import { hourInZone, nextSlot } from "./schedule";
import {
  bandFor,
  policyFor,
  rankDailyBriefing,
  rankIntoLanes,
  rankableFromMatch,
} from "./freshness";

type Db = SupabaseClient<Database>;

/** Eight readers keep a synchronized 1,000-reader cohort within the 130-minute slot window. */
const BATCH = 8;

/** Email, Telegram and push are the supported channels; bound queued sends too. */
const MAX_DELIVERY_CHANNELS = 3;

/** Smaller than Supabase's default PostgREST row cap. */
const SCHEDULE_PAGE_SIZE = 500;
const SCHEDULE_USER_CHUNK = 100;

/** How long a `generating` claim is honoured before another run may take it. */
const STALE_MINUTES = 15;

/** Send attempts before a queued delivery is marked failed for good. */
const MAX_ATTEMPTS = 5;

/**
 * How long to wait after each failed attempt, indexed by attempt number.
 *
 * The retryable errors are the ones where the far side is asking for less
 * traffic — a Resend or Telegram 429, a push service 503. Retrying every reader
 * on the next one-minute tick would answer a rate limit with a synchronised
 * burst against whoever just rate limited us. Backoff spreads retries across
 * the provider incident rather than exhausting them during a short outage.
 *
 * These four delays stretch the same five attempts across roughly eighty
 * minutes, which is long enough to sit out a typical provider incident, while
 * the jitter below spreads a batch that failed together across the window
 * rather than re-converging on it.
 */
const RETRY_BACKOFF_MINUTES = [2, 6, 18, 54];

/**
 * How far ahead of `scheduled_for` generation may start.
 *
 * This is the whole of the timing fix. `scheduled_for` is a *delivery*
 * deadline — the reader picked 07:30, so 07:30 is when the briefing must be in
 * their hands, not when a worker may begin paying for model calls. Opening the
 * generation window early means a retryable failure has somewhere to retry to
 * that is not the reader's morning: a 429 at T-10 is retried at T-5 and the
 * briefing still lands at T.
 *
 * Ten minutes rather than an hour because the other half of the promise is that
 * the briefing is current. Everything matched between T-10 and T misses this
 * briefing and leads the next one, which is the same trade `selectItems`
 * already makes at T; widening the window widens that gap for no extra
 * resilience, since the retries that matter all fit inside two cron ticks.
 */
const PREPARE_LEAD_MINUTES = 10;

/**
 * How late a briefing may be delivered before it is abandoned instead.
 *
 * A briefing is a claim about a moment. Production has sent one three hours and
 * twenty minutes after its slot and parked another for three weeks, and neither
 * is a briefing — the first is a surprise and the second is an artefact. Past
 * this bound the slot is closed with a recorded reason and nothing is sent.
 *
 * Nothing is lost by that. `briefed_at` is written at delivery, so every story
 * an abandoned slot would have carried is still unbriefed and leads the
 * reader's next briefing, which is the same "store, don't force" rule the
 * pre-analysis demand gate uses.
 */
const MAX_LATENESS_MINUTES = 120;

/**
 * The lease a scheduled delivery is claimed under.
 *
 * Two minutes, against `STALE_MINUTES`' fifteen, because the two leases are
 * protecting different things. Fifteen minutes is right for generation, where a
 * live worker really can hold a claim that long and re-entering would buy the
 * same model call twice. A send is seconds of work, and a worker that dies
 * mid-send leaves a briefing the reader is already owed locked behind a claim
 * nobody holds — which is exactly how an on-time 22:30:26 briefing was
 * delivered at 22:50:14.
 *
 * Re-attempting after two minutes is safe because both channels that carry a
 * briefing are idempotent: the email is sent under
 * `Idempotency-Key: digest:<id>:email` and the push carries the digest id as
 * its `tag`, so a duplicate collapses at the provider and in the reader's
 * notification centre rather than arriving twice.
 */
const DELIVERY_LEASE_MINUTES = 2;

/**
 * How far before the deadline a delivery may still be treated as due.
 *
 * Cron ticks are not exact. A trigger scheduled for 07:30:00 can be handed to
 * the Worker at 07:29:59, and a strict `deadline > now` comparison reads that
 * as "not yet" and makes the reader wait a whole extra tick for the sake of one
 * second. The window is two seconds because that is the size of the jitter, not
 * a tolerance for early delivery: at two seconds nobody perceives the briefing
 * as early, and at a minute they would.
 */
const DELIVERY_TICK_GRACE_MS = 2_000;

/**
 * Claims a digest may take before the slot is given up on.
 *
 * Only reached by failures that are *not* the model's — a model that will not
 * answer no longer fails a briefing at all (see `generateOne`). This bounds the
 * genuinely broken case, a database that will not accept the items, so a
 * poisoned row cannot be retried on every tick until its slot expires.
 */
const MAX_GENERATION_ATTEMPTS = 3;

/**
 * How long a `generating` claim on a digest is honoured.
 *
 * Five minutes, not `STALE_MINUTES`' fifteen, and the reason it can be this
 * short is that re-entering a digest buys nothing. Briefing assembly reads
 * shared analysis and existing translation cache rows; it generates neither.
 *
 * Fifteen was survivable while generation began at the deadline, because by
 * then the briefing was late whatever happened. It is not survivable now that
 * generation begins at `scheduled_for - PREPARE_LEAD_MINUTES`: a worker that
 * dies at T-10 holding a fifteen-minute claim would block the retry until T+5,
 * turning the head start into a delay. At five minutes the crash is retried at
 * T-5 and the reader still gets their briefing at T.
 */
const GENERATION_LEASE_MINUTES = 5;

/**
 * When a delivery that has just failed its `attempts`th try may be tried again.
 *
 * The ±25% jitter is the point of the function, not a detail: without it every
 * delivery queued in the same cron run shares a deadline and the herd stays a
 * herd for all five attempts.
 */
export function nextAttemptAt(attempts: number, now: number = Date.now()): string {
  const index = Math.min(Math.max(attempts, 1), RETRY_BACKOFF_MINUTES.length) - 1;
  const minutes = RETRY_BACKOFF_MINUTES[index] ?? RETRY_BACKOFF_MINUTES[0] ?? 2;
  const jittered = minutes * (0.75 + Math.random() * 0.5);
  return new Date(now + jittered * 60_000).toISOString();
}

export type DigestOptions = {
  userIds?: string[] | undefined;
  /** Generate the current slot immediately, even if send_at is still ahead. */
  now?: Date | undefined;
  /** Decide and report, write nothing. */
  dryRun?: boolean | undefined;
  /** Digests to generate this run. Absent means `BATCH`. */
  limit?: number | undefined;
  secrets?: SecretBag | undefined;
  email?: EmailEnv | undefined;
  telegram?: TelegramEnv | undefined;
  push?: PushEnv | undefined;
  /** Skip sending after generating. */
  skipSend?: boolean | undefined;
  /**
   * Create a slot due right now for `--user`, instead of waiting for send_at.
   * For checking a known reader, not for the cron.
   */
  immediate?: boolean | undefined;
};

export type DigestDecision =
  "generated" | "skipped" | "failed" | "paused" | "held" | "deferred" | "expired";

export type DigestOutcome = {
  userId: string;
  digestId: string | null;
  scheduledFor: string | null;
  decision: DigestDecision;
  items: number;
  tokens: number;
  sent: number;
  detail: string;
};

export type DigestReport = {
  startedAt: string;
  finishedAt: string;
  /**
   * Rows the stage looked at: everything `loadDue` returned for this tick.
   *
   * Carried because its absence was actively misleading. `recordRunLifecycle`
   * reads a missing metric as 0, so every digest receipt in `pipeline_runs`
   * recorded `considered: 0` and the column read as "the stage saw nothing" on
   * ticks that were generating briefings. That is the failure this repo keeps
   * meeting -- a count that cannot see the thing being judged -- and it cost real
   * time twice: once while investigating why a 22:30 briefing was never built
   * (2026-10-12), where 285 consecutive runs at `considered: 0` looked like
   * starvation and were an artifact.
   *
   * `due.length`, not the delivered count: this answers "how much work did the
   * tick have", and `generated`/`skipped`/`failed` answer what became of it.
   */
  considered: number;
  scheduled: number;
  generated: number;
  skipped: number;
  failed: number;
  paused: number;
  deferred: number;
  expired: number;
  sent: number;
  retried: number;
  tokens: number;
  outcomes: DigestOutcome[];
};

export type MatchRow = {
  eventId: string;
  relevance: number;
  matchedAt: string;
  /**
   * When the story the reader is being shown actually happened, which is the
   * material *occurrence* clock for a revised event and `first_seen_at`
   * otherwise (0097). Not when we matched it: those diverge by exactly the
   * amount the pipeline was behind, and for a material update they can diverge
   * further still -- a development reported a week ago and discovered today is
   * dated a week ago, so it can re-enter the pipeline without arriving as
   * today's newest item. Null when the event row could not be read; treated as
   * undateable and therefore not current.
   */
  eventAt: string | null;
  /** 0..10 shared significance, for the ranking's significance term. */
  importance: number;
  /** 0..10 shared novelty. */
  novelty: number;
  /**
   * Accepted material transitions (0097). The unit of re-delivery: a row is
   * suppressible only while the reader's delivered revision is at or above it.
   */
  materialRevision: number;
  /**
   * The revision this reader last received, from `user_events` (0099). Durable
   * across digest purging, unlike the delivery history read below.
   */
  deliveredRevision: number;
  /**
   * The event's headline, for the per-subject diversity cap. Empty when the
   * event row could not be read — a card with no title has no entities to
   * count and is never suppressed by the cap.
   */
  matchedTitle?: string;
};

/**
 * The briefing's ranking: today first, older material only in the room today
 * left, and nothing past the cadence's ceiling at any cap.
 *
 * Exported because this is the decision a quiet day hangs on, and it must be
 * the same decision in a test as in a run.
 *
 * ---------------------------------------------------------------------------
 * Why this stopped being `relevance DESC`
 * ---------------------------------------------------------------------------
 *
 * It used to be `relevance DESC, matched_at DESC`, which has no term for time
 * at all — `matched_at` is a tie-break, and a tie between two floats almost
 * never happens. That is fine while the pipeline is healthy and every candidate
 * is a few hours old, and it fails completely the moment it is not: after the
 * September stall, the 8 September briefing led with 1 September and carried 25
 * August, because those rows genuinely did have the highest relevance. Relevance
 * is a statement about the reader, and it is silent about whether the news is
 * news.
 *
 * The fix is not to sort by date instead. A reader who follows Formula 1 and not
 * politics does not want the newest thing, they want their thing, today. So
 * relevance still leads and `freshness.ts` decays it by age, and on top of that
 * the bands make "today first" structural rather than merely preferred — see
 * that module for why a decay alone is a preference and not a guarantee.
 *
 * For the daily cadence, the 72h band is a quiet-day backstop, not a normal
 * third band. It opens only when the fresh material available for this briefing
 * has not already filled it, and only for significant stories. That is what makes
 * 72h "today was thin, and this is still worth knowing" rather than "this is
 * still current".
 *
 * The bands also mean this can return fewer items than the cap allows, and that
 * is the intended outcome rather than a shortfall to be corrected. On a quiet
 * day a fourteen-story briefing is the honest one; reaching back past two days
 * for ordinary material to make it thirty is how a briefing turns into a
 * backlog.
 *
 * A relevance of exactly 0 is dropped whatever the cap still has room for. By
 * `relevanceOf` in match.ts that score is an importance-0 event with no novelty,
 * one matching topic and no priority source — nothing on any axis the matcher
 * measures. Even Deep, the band that admits "everything with a plausible claim
 * on your attention", is admitting a claim; zero is the absence of one. Carrying
 * it produces a paragraph in which the model tells the reader the story does not
 * affect them, which is a worse briefing than one three stories shorter.
 */
export const DAILY_FRESH_THRESHOLD = 6;

/**
 * Importance at which a story escapes the per-subject diversity ceiling.
 *
 * Eight is the same bar the 72h backstop uses (`SIGNIFICANT_IMPORTANCE`): big
 * news is big news whoever it is about, and both gates use one definition of
 * "big" so the briefing's exceptions have one story.
 */
const DIVERSITY_ESCAPE = 8;

/**
 * Stories loaded beyond the cap so a dropped twin does not shorten the briefing.
 * Large enough for the worst observed split (one IPO filing held as five events)
 * and small enough that the extra reads stay bounded.
 */
const TWIN_HEADROOM = 12;

export function selectItems(
  matches: MatchRow[],
  already: ReadonlyMap<string, number>,
  cap: number,
  now: Date = new Date(),
  frequency: DigestFrequency = "daily",
): MatchRow[] {
  const policy = policyFor(frequency);
  // Delivery is revision-aware (0099). The question is no longer "was this event
  // ever sent" but "has it moved since what this reader received": an event the
  // reader holds at revision N is suppressed while the event is at revision N,
  // and sendable again once a material change takes it to N+1. Two sources of
  // the delivered revision are consulted because one of them is durable
  // (`user_events.delivered_revision`) and the other survives a purge of the
  // digest itself (`digest_items.delivered_revision`), and a reader must not
  // re-receive an unchanged story because one of them went away.
  const eligible = matches.filter((row) => {
    if (row.relevance <= 0) return false;
    const delivered = Math.max(row.deliveredRevision, already.get(row.eventId) ?? 0);
    const deliveredBefore = already.has(row.eventId) || delivered > 0;
    return !deliveredBefore || delivered < row.materialRevision;
  });

  // For the daily cadence, the 72h backstop is gated on how much fresh material
  // the briefing already has. "Fresh" here means primary-band material: today's
  // news, not yesterday's, not the quiet-day backstop.
  const dailyFreshCount =
    frequency === "daily"
      ? eligible.filter((row) => bandFor(rankableFromMatch(row), now, policy) === "primary").length
      : 0;

  const { priority, backfill } =
    frequency === "daily"
      ? rankDailyBriefing(eligible, now, DAILY_FRESH_THRESHOLD, dailyFreshCount)
      : rankIntoLanes(eligible, now, policy);

  // Topical diversity: one subject must not own a third of the briefing.
  // On 2026-10-01 thirteen of twenty-five cards were AI-industry stories, five
  // of them OpenAI alone — correct per-item, monotonous as a briefing. The cap
  // works on shared proper nouns, which is what "the same subject" means here:
  // it counts matches against the reader's interest, not against a topic label.
  const ordered = [...priority, ...backfill];
  return capEntitiesPerSubject(ordered, cap, (item) => item.matchedTitle ?? "");
}

/**
 * How many stories one proper noun may claim in a single briefing.
 *
 * A third of the cap, at least two — a cap of 25 allows 8 stories per entity,
 * a cap of 5 allows 2. "Shares a proper noun" is the test because entity
 * names are what a reader experiences as "another one about them": two cards
 * about different OpenAI products read as a themed digest, and the reader did
 * not ask for a themed digest.
 */
export function perSubjectLimit(cap: number): number {
  return Math.max(2, Math.ceil(cap / 3));
}

/**
 * Enforce the per-subject ceiling over a ranked list.
 *
 * Ranked order is preserved and the best stories keep their places; an item
 * that would push an entity past the ceiling is skipped and the next story
 * takes the slot. An item at least as important as `DIVERSITY_ESCAPE` is never
 * skipped: the diversity preference must not be able to bury a nine — a big
 * story about a followed company is exactly what the reader is here for, and
 * the ceiling is a preference about the *mix*, not a veto about any one story.
 */
export function capEntitiesPerSubject<
  T extends { eventAt: string | null; importance: number; matchedTitle?: string },
>(ordered: readonly T[], cap: number, titleOf: (item: T) => string): T[] {
  const limit = perSubjectLimit(cap);
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of ordered) {
    if (out.length >= Math.max(0, cap)) break;
    const entities = [...capitalised(titleOf(item))];
    const dominant = entities.filter((e) => (counts.get(e) ?? 0) >= limit);
    // Escapes the cap only when it is genuinely big news; see the docstring.
    if (dominant.length > 0 && item.importance < DIVERSITY_ESCAPE) continue;
    for (const entity of entities) counts.set(entity, (counts.get(entity) ?? 0) + 1);
    out.push(item);
  }
  return out;
}

export async function digest(db: Db, options: DigestOptions = {}): Promise<DigestReport> {
  const started = options.now ?? new Date();
  const startedAt = started.toISOString();
  const outcomes: DigestOutcome[] = [];

  const scheduled = await scheduleUpcoming(db, started, options);

  const due = await loadDue(db, started, options);
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let paused = 0;
  let deferred = 0;
  let expired = 0;
  let sent = 0;
  let retried = 0;
  let tokens = 0;

  for (const row of due) {
    const outcome = await generateOne(db, row, options);
    outcomes.push(outcome);
    tokens += outcome.tokens;
    if (outcome.decision === "generated") generated += 1;
    else if (outcome.decision === "skipped") skipped += 1;
    else if (outcome.decision === "failed") failed += 1;
    else if (outcome.decision === "paused") paused += 1;
    else if (outcome.decision === "deferred") deferred += 1;
    else if (outcome.decision === "expired") expired += 1;

    // Dispatch this slot before another reader's generation or the retry
    // backlog can turn a 07:30 promise into a later five-minute cron slot.
    if (
      options.skipSend !== true &&
      options.dryRun !== true &&
      outcome.digestId &&
      (outcome.decision === "generated" || outcome.decision === "skipped")
    ) {
      const delivery = await deliverDue(db, options, [outcome.digestId]);
      sent += delivery.sent;
      retried += delivery.retried;
      outcome.sent = delivery.byDigest.get(outcome.digestId) ?? 0;
    }
  }

  if (options.skipSend !== true && options.dryRun !== true) {
    const delivery = await deliverDue(db, options);
    sent += delivery.sent;
    retried += delivery.retried;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: due.length,
    scheduled,
    generated,
    skipped,
    failed,
    paused,
    deferred,
    expired,
    sent,
    retried,
    tokens,
    outcomes,
  };
}

type PrefRow = {
  user_id: string;
  send_at: string;
  timezone: string;
  days: number[];
  channels: DeliveryChannel[];
  frequency: DigestFrequency;
  density: number;
  paused: boolean;
  instructions: string;
  language: string;
};

const PREF_COLUMNS =
  "user_id, send_at, timezone, days, channels, frequency, density, paused, instructions, language";

async function scheduleUpcoming(db: Db, now: Date, options: DigestOptions): Promise<number> {
  let scheduledCount = 0;
  const userBatches: (string[] | undefined)[] = options.userIds
    ? chunked(options.userIds, SCHEDULE_USER_CHUNK)
    : [undefined];
  for (const userIds of userBatches) {
    for (let offset = 0; ; offset += SCHEDULE_PAGE_SIZE) {
      let query = db
        .from("notification_preferences")
        .select(PREF_COLUMNS)
        .order("user_id")
        .range(offset, offset + SCHEDULE_PAGE_SIZE - 1);
      if (userIds) query = query.in("user_id", userIds);

      const { data, error } = await query;
      if (error) throw new Error(`reading notification_preferences: ${error.message}`);
      const rows = (data ?? []) as PrefRow[];
      if (rows.length === 0) break;

      const pageUserIds = rows.map((row) => row.user_id);
      const { data: subscriptions, error: planError } = await db
        .from("subscriptions")
        .select("user_id, plan")
        .in("user_id", pageUserIds)
        .order("user_id")
        .range(0, pageUserIds.length - 1);
      if (planError) throw new Error(`Reading schedule plans: ${planError.message}`);
      const plans = new Map((subscriptions ?? []).map((row) => [row.user_id, row.plan]));
      const scheduled: { user_id: string; scheduled_for: string; status: "scheduled" }[] = [];

      for (const row of rows) {
        if (row.paused) continue;
        const plan = plans.get(row.user_id) ?? "uno";
        const slot = options.immediate
          ? now
          : nextSlot(
              {
                sendAt: PLAN_LIMITS[plan].customDeliveryTime ? row.send_at : STANDARD_DELIVERY_TIME,
                timezone: row.timezone,
                days: row.days,
                frequency: "daily",
              },
              now,
            );
        if (slot === null) continue;
        scheduled.push({
          user_id: row.user_id,
          scheduled_for: slot.toISOString(),
          status: "scheduled",
        });
      }

      if (options.dryRun !== true && scheduled.length > 0) {
        const { error: writeError } = await db.from("digests").upsert(scheduled, {
          onConflict: "user_id,scheduled_for",
          ignoreDuplicates: true,
        });
        if (writeError) throw new Error(`scheduling digest: ${writeError.message}`);
      }
      scheduledCount += scheduled.length;
      if (rows.length < SCHEDULE_PAGE_SIZE) break;
    }
  }

  return scheduledCount;
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

type DueRow = {
  digest_id: string;
  user_id: string;
  scheduled_for: string;
  status: DigestStatus;
  generation_deferred_until: string | null;
  generation_attempts: number;
  kind: string | null;
  generation_started_at: string | null;
};

/**
 * Digests whose *generation* window is open.
 *
 * The window opens `PREPARE_LEAD_MINUTES` before `scheduled_for` and this is
 * the only place that lead is applied. Delivery is gated separately, on
 * `scheduled_for` itself, in `deliverDue` — the two used to be one instant, and
 * fusing them is what let a failure after 07:30 move the reader's 07:30.
 */
async function loadDue(db: Db, now: Date, options: DigestOptions): Promise<DueRow[]> {
  const stale = new Date(now.getTime() - GENERATION_LEASE_MINUTES * 60_000).toISOString();
  const windowOpen = new Date(now.getTime() + PREPARE_LEAD_MINUTES * 60_000).toISOString();
  let query = db
    .from("digests")
    .select(
      "digest_id, user_id, scheduled_for, status, generation_deferred_until, generation_attempts, kind, generation_started_at",
    )
    .lte("scheduled_for", windowOpen)
    .or(`status.eq.scheduled,and(status.eq.generating,generated_at.is.null)`)
    .or(`generation_deferred_until.is.null,generation_deferred_until.lte.${now.toISOString()}`)
    .order("scheduled_for", { ascending: true })
    .limit(options.limit ?? BATCH);

  if (options.userIds) query = query.in("user_id", options.userIds);

  const { data, error } = await query;
  if (error) throw new Error(`reading due digests: ${error.message}`);

  return ((data ?? []) as DueRow[]).filter((row) => {
    if (row.status === "scheduled") return true;
    if (row.status !== "generating") return false;
    // `generating` with no `generated_at` is a claim whose worker has not come
    // back. Whether it may be retaken is a question about the *claim's* age, and
    // `generation_started_at` is when the claim was made — the column exists
    // because this used to be answered with `scheduled_for`, which is a
    // different question and a worse answer: it could not tell a claim taken
    // ten minutes early from one taken an hour late, and it left early
    // generation unable to recover before the deadline it was meant to protect.
    // Rows written before that column existed still fall back to it.
    const claimedAt = row.generation_started_at ?? row.scheduled_for;
    return claimedAt < stale;
  });
}

type EventBrief = {
  eventId: string;
  title: string;
  whatHappened: string;
  /**
   * Carried so the translation `content_version` hashed at generation time
   * matches the one hashed at delivery time. Both sides must hash exactly
   * the same fields, or every lookup is a permanent cache miss that looks
   * identical to a cold cache.
   */
  beforeState: string | null;
  afterState: string | null;
  importance: number;
  novelty: number;
  topics: string[];
  relevance: number;
  matchedAt: string;
  /**
   * Independent outlets on the event. Feeds the deterministic inclusion line
   * (inclusion.ts) that replaced the per-briefing impact model call.
   */
  sourceCount: number;
  /**
   * `sources.kind` for every feed behind the story, for the readiness gate's
   * primary-source rung. A single-source `research` or `github` item is not a
   * briefing candidate (operator decision, 2026-10-08); it still reaches the
   * feed and history.
   */
  sourceKinds: string[];
  /**
   * The story's own stored article evidence (0090): the short facts the
   * enrichment stage extracted from the articles' own pages. Read for the
   * inclusion ladder's consequence rung (inclusion.ts) — the only free,
   * story-specific material left that the readiness gate has not already
   * spent — and never generated here. Empty for most stories, because the
   * stage is bounded and only touches articles a reader can reach.
   */
  evidence: string[];
  /**
   * The story's own source evidence, exactly as the Read composer receives it.
   *
   * Carried so the readiness gate can apply the briefability contract at
   * selection time. A story whose evidence cannot fill a paragraph is not a
   * briefing item, and the composer that would discover this is one render
   * away — too late, because by then the reader has a card with a title, a
   * deck and no article. The list is loaded once for the whole considered set
   * and shared with the email path, which needed the excerpts anyway.
   */
  sources: ReaderSource[];
  /**
   * The event's clock, so the readiness gate can compose the same article the
   * reader's page composes.
   *
   * A source's relative time ("this year") is anchored to it. Composed without
   * it, a fact the delivery path publishes is refused instead, and the gate
   * withholds a story it should have shipped -- measured on the frozen corpus,
   * where one story's only body fact was date-anchored.
   */
  publishedAt: string | null;
};

async function generateOne(db: Db, due: DueRow, options: DigestOptions): Promise<DigestOutcome> {
  const base = {
    userId: due.user_id,
    digestId: due.digest_id,
    scheduledFor: due.scheduled_for,
    items: 0,
    tokens: 0,
    sent: 0,
  };

  const now = options.now ?? new Date();
  const lateByMs = now.getTime() - Date.parse(due.scheduled_for);

  // A briefing far enough past its own slot is no longer the thing the reader
  // asked for. Close it, record why, and send nothing — its stories keep
  // `briefed_at` unset and lead the next briefing. Alerts are exempt: their
  // `scheduled_for` is the instant they were raised, not a promise about a
  // clock time, and a late alert is still the alert.
  if (due.kind !== "alert" && lateByMs > MAX_LATENESS_MINUTES * 60_000) {
    const lateMinutes = Math.round(lateByMs / 60_000);
    if (options.dryRun !== true) await expireSlot(db, due.digest_id, lateMinutes);
    return {
      ...base,
      decision: "expired",
      detail: `slot missed by ${lateMinutes} minutes; stories roll into the next briefing`,
    };
  }

  const prefs = await loadPref(db, due.user_id);
  if (prefs === null) {
    return { ...base, decision: "failed", detail: "no preferences row" };
  }

  if (prefs.paused) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0);
    }
    return { ...base, decision: "paused", detail: "briefings paused" };
  }

  const claimed = await claimDigest(db, due, options);
  if (claimed !== "held") {
    return { ...base, decision: "held", detail: claimed };
  }

  const plan = await planFor(db, due.user_id);
  const cap = capFor(prefs.density, plan);
  const matches = await loadMatches(db, due.user_id);
  const already = await alreadyBriefed(db, due.user_id);
  const ranked = selectItems(matches, already, matches.length, options.now ?? new Date(), "daily");
  const distinct = await suppressDeliveredDuplicates(
    db,
    due.user_id,
    ranked.map((r) => r.eventId),
    now,
    "briefing",
    // Revision-aware same-event suppression: a materially revised event is not
    // a repeat of the one this reader already received.
    new Map(ranked.map((r) => [r.eventId, r.materialRevision] as const)),
  );
  // Headroom beyond the cap. A story the corpus split across several events is
  // dropped by `suppressStoryTwins` below, and the next story takes its place —
  // a briefing that deduplicates itself must not also come out shorter than the
  // reader asked for.
  const considered = ranked.filter((r) => distinct.has(r.eventId)).slice(0, cap + TWIN_HEADROOM);

  // The digest cache (0061) is deliberately not consulted. Skipping generation on
  // an unchanged event set is a P1 optimization; the table and RPCs stay dormant
  // in the database so it can be switched back on after P0.

  if (considered.length === 0) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0);
      await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);
    }
    return { ...base, decision: "skipped", detail: "nothing matched since the last briefing" };
  }

  const loaded = await loadBriefs(db, considered);
  // One story per briefing. The corpus can hold the same event as four events
  // when four outlets phrase it differently and the paraphrase predicate — which
  // is precise and refuses them — has not joined them; showing the reader four
  // cards about one IPO filing is worse than showing one.
  //
  // The second pass is the cross-day twin check: `suppressDeliveredDuplicates`
  // knows the events this reader was sent, but a *different* event carrying the
  // same story — the corpus split one event into two, the reader received one —
  // passes it and reads as a repeat. The twins test against the delivered
  // titles is what stops yesterday's telling suppressing today's fresh event and
  // then reappearing under a new headline. Headroom still applies: the cap has
  // the last word below, so a dropped twin is replaced, never missed.
  const deliveredTwins = await deliveredTwinTitles(db, due.user_id);
  const briefs = suppressDeliveredTwins(suppressStoryTwins(loaded), deliveredTwins);

  // Reader-readiness gate (readiness.ts). Rejects only provably non-news
  // shapes — empty summaries, build numbers, commit messages, bylines,
  // newsletter containers, commerce posts — never short real news. Withheld
  // items are stamped `briefed_at` below alongside the shipped ones so a
  // machine artifact does not resurface on every cycle, but no `digest_items`
  // row is written for them and they count toward nothing.
  let ready: EventBrief[] = [];
  const withheld: { eventId: string; kind: string }[] = [];
  for (const brief of briefs) {
    const verdict = assessReadiness({
      title: brief.title,
      whatHappened: brief.whatHappened,
      sourceCount: brief.sourceCount,
      sources: brief.sources,
      sourceKinds: brief.sourceKinds,
      publishedAt: brief.publishedAt,
    });
    if (verdict.ready) ready.push(brief);
    else withheld.push({ eventId: brief.eventId, kind: verdict.kind });
  }
  // The twin drop and the gate both run after the cap, so the cap has the last
  // word: the reader asked for `cap` stories, never more.
  if (ready.length > cap) ready.splice(cap);
  // Recomputed after the Q4 gate below: the gate adds to `withheld`, and the
  // note must carry every disposition or the record is incomplete.
  let withheldNote = withheldNoteOf(withheld);
  if (ready.length === 0 && briefs.length > 0) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0);
      await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);
    }
    return {
      ...base,
      decision: "skipped",
      detail: withheldNote ? `nothing reader-ready (${withheldNote})` : "nothing readable matched",
    };
  }

  // ---------------------------------------------------------------------------
  // Enrichment is optional. The briefing is not.
  // ---------------------------------------------------------------------------
  //
  // `why_it_matters` is one shared sentence per story. It used to be able to
  // stop a briefing three ways — a provider 429 deferred the whole digest
  // fifteen minutes, an exhausted monthly budget deferred it to the first of
  // the next month, and an impact still being written elsewhere dropped every
  // story and turned the briefing into a quiet day that was not quiet.
  //
  // None of those are reasons the reader's 07:30 should move. A model that will
  // not answer costs the sentence, never the slot: whatever impacts exist are
  // used, and an item no rung can say something story-specific about is
  // **withheld from this briefing** — Q4, ruled 2026-10-12: "the remedy is
  // withholding, not filler, generic explanations, or unsupported claims".
  // The reason is recorded so the lateness that did not happen is still
  // visible. Read, never generate (0078 follow-up).
  //
  // This used to call a model for any event without a stored impact, which made
  // the daily briefing job itself a reason to spend money. It is not the source
  // of this text and never was: `analyse.ts` writes `event_impacts` from the
  // `impact` field of the analysis it is already doing, so almost every event
  // arrives here with a shared explanation already paid for. What remains is a
  // read plus `reasonFor`, which builds a line from the event's own stored
  // fields — see inclusion.ts for the ladder and why rung 3 is a sentence.
  //
  // `tokens` stays in the outcome shape rather than being removed: it is
  // reported by the pipeline CLI and asserted in the digest tests, and a
  // briefing that now spends nothing should say so with a zero rather than by
  // the field disappearing.
  const tokens = 0;
  const impacts = await completedImpacts(db, ready);

  const stored = new Map(impacts.map((item) => [item.eventId, item.text] as const));
  // The whole ladder from one call, over the event's own stored fields — see
  // inclusion.ts for the contract. No reader-specific inputs: a significance
  // line states a fact about the story, and the reader's own follow graph is
  // rendered separately, under `personalizationFor`.
  const byImpact = new Map(
    ready.map((brief) => {
      const reason = reasonFor({
        storedImpact: stored.get(brief.eventId) ?? null,
        beforeState: brief.beforeState,
        afterState: brief.afterState,
        sourceCount: brief.sourceCount,
        evidence: brief.evidence,
        title: brief.title,
        whatHappened: brief.whatHappened,
      });
      return [brief.eventId, reason.text] as const;
    }),
  );

  // Q4 quality gate, ruled 2026-10-12: an item without a story-specific
  // why-line does not ship. It is withheld exactly like a readiness-gate item —
  // no `digest_items` row, stamped alongside the rest so it does not loop — and
  // recorded as `skipped` with the canonical reason `missing_story_specific_why_it_matters`
  // and its event id, so the disposition is auditable and no item ever
  // disappears silently. Not a confirmed violation of the ladder (rung 6 stays
  // honest silence); a stricter shipping decision at the final quality gate.
  for (const brief of ready) {
    if ((byImpact.get(brief.eventId) ?? "") === "") {
      withheld.push({ eventId: brief.eventId, kind: GATED_KIND });
    }
  }
  ready = ready.filter((brief) => (byImpact.get(brief.eventId) ?? "") !== "");
  withheldNote = withheldNoteOf(withheld);

  const unexplained = ready.filter((brief) => !stored.get(brief.eventId)).length;
  // How many shipped cards carry no stored shared impact and are riding on a
  // derived rung. The "without a specific line" count is gone with the old
  // honesty-bar measurement: it measured exactly the items Q4 now withholds,
  // and a count of what cannot ship is a count of nothing.
  const enrichment =
    unexplained > 0
      ? `${unexplained} story${unexplained === 1 ? "" : "s"} using a derived inclusion line`
      : null;

  // Withholding can empty a briefing the readiness gate passed. That is the
  // quiet morning the ruling accepts — it takes the same path as a briefing
  // nothing was ready for.
  if (ready.length === 0) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0, noteOf(enrichment, withheldNote));
      await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);
    }
    return {
      ...base,
      tokens,
      decision: "skipped",
      detail: `nothing carried a story-specific line (${withheldNote ?? ""})`,
    };
  }

  if (options.dryRun === true) {
    return {
      ...base,
      items: ready.length,
      tokens,
      decision: "generated",
      detail:
        withheldNote !== null
          ? `${ready.length} stories (dry run, ${withheldNote})`
          : `${ready.length} stories (dry run)`,
    };
  }

  // The translation prewarm that used to stand here is gone (V1).
  //
  // It read `story_translation_enabled` and, when set, generated translations
  // for every story entering this briefing. That was the second way the daily
  // job could spend money simply by running. Translation is not in V1, so the
  // prewarm is removed rather than left behind a flag an operator could switch
  // on by accident.
  //
  // Delivery still reads the translation cache (`readTranslations` below), so
  // a reader whose language already has rows keeps seeing them. Nothing is
  // deleted and nothing new is written.

  // Every story the matcher chose, in its ranked position. A story with no
  // shared explanation yet carries an empty one — `why_it_matters` is
  // `not null default ''`, and the templates already render a story without it.
  const revisionOf = new Map(
    considered.map((match) => [match.eventId, match.materialRevision] as const),
  );
  // The composed summary artifact -- the composed half of the arbiter's ruling,
  // written beside the item it belongs to (0118).
  //
  // This is the only place a stored summary is *composed*, and it is the point
  // where the pipeline already composes the article for the item: the readiness
  // gate above composed the same story through the same path from the same
  // inputs, and the readiness verdict is what admitted this item. Composing here
  // rather than at read time is deliberate: the reader's request path runs on the
  // same free-plan CPU budget the cron does, and recovery costs 150-220 ms per
  // story, so a read-time composition would be paid by whoever opened a briefing
  // (the card pays it only for a refused card, and says so at
  // `src/components/dashboard/story-card.tsx`).
  //
  // Only an item whose own stored line the delivery boundary refuses pays for it.
  // An item carrying an admissible line needs no artifact and keeps printing what
  // it always printed, so this cannot change a line nobody objected to. Where the
  // composition publishes nothing acceptable the artifact is null and the item
  // ships with no line at all -- the ruling's trade, and the raw feed description
  // is never substituted for it.
  const rows = ready.map((brief, position) => ({
    digest_id: due.digest_id,
    event_id: brief.eventId,
    position,
    why_it_matters: byImpact.get(brief.eventId) ?? "",
    // Stamped per item, so delivery history answers "which revision did this
    // reader get" without a join and without depending on the event still
    // being in the corpus. It is also the artifact's provenance: the line below
    // is composed from the material as it stands in this same write, and the two
    // fields are written together.
    delivered_revision: revisionOf.get(brief.eventId) ?? 0,
    summary: composedSummaryArtifact({
      title: brief.title,
      sources: brief.sources,
      publishedAt: brief.publishedAt,
      whatHappened: brief.whatHappened,
    }),
  }));

  const { error } = await db
    .from("digest_items")
    .upsert(rows, { onConflict: "digest_id,event_id" });
  if (error) {
    const outcome = await failGeneration(db, due, `writing items: ${error.message}`, tokens);
    return {
      ...base,
      tokens,
      decision: outcome === "failed" ? "failed" : "deferred",
      detail: `writing items: ${error.message}`,
    };
  }

  // One statement per distinct revision rather than per event: almost every
  // briefing is all revision 0, and a briefing containing a material update is
  // one extra statement. The durable marker and the revision it refers to are
  // always written together.
  // Stamped over every brief the matcher picked, withheld included: the gate
  // only withholds provable non-news, so nothing here is a developing story
  // waiting for corroboration, and stamping keeps it from looping forever.
  // `loaded`, not `briefs`: a story dropped as a twin shipped under the event
  // that kept its slot, and stamping it stops it returning tomorrow as a
  // different-looking duplicate.
  const briefedAt = new Date().toISOString();
  const byRevision = new Map<number, string[]>();
  for (const brief of loaded) {
    const revision = revisionOf.get(brief.eventId) ?? 0;
    const bucket = byRevision.get(revision);
    if (bucket) bucket.push(brief.eventId);
    else byRevision.set(revision, [brief.eventId]);
  }
  for (const [revision, eventIds] of byRevision) {
    await db
      .from("user_events")
      .update({ briefed_at: briefedAt, delivered_revision: revision })
      .eq("user_id", due.user_id)
      .in("event_id", eventIds);
  }

  await finish(db, due.digest_id, "ready", ready.length, tokens, noteOf(enrichment, withheldNote));
  await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);

  const notes = [enrichment, withheldNote].filter((note): note is string => note !== null);
  return {
    ...base,
    items: ready.length,
    tokens,
    decision: "generated",
    detail:
      notes.length > 0
        ? `${ready.length} stories (${notes.join("; ")})`
        : `${ready.length} stories`,
  };
}

/**
 * The shared explanations that already exist for these events.
 *
 * A read that fails yields nothing rather than propagating. The briefing still
 * ships, using the deterministic inclusion ladder for every event.
 */
async function completedImpacts(db: Db, briefs: EventBrief[]): Promise<ImpactResult[]> {
  try {
    const rows = await loadImpacts(
      db,
      briefs.map((brief) => brief.eventId),
    );
    const out: ImpactResult[] = [];
    for (const brief of briefs) {
      const row = rows.get(brief.eventId);
      if (row?.status === "complete" && row.text) {
        out.push({ eventId: brief.eventId, text: row.text });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The exact shape a translation is keyed on, built one way.
 *
 * Generation and delivery both go through this. They must, because
 * `content_version` is a hash of these fields: if the two callsites built the
 * object differently — a null where the other had text — every lookup would
 * miss, translations would regenerate on every send, and the symptom would be
 * indistinguishable from a cache that was simply cold.
 */
function translatable(
  event: {
    eventId: string;
    title: string;
    whatHappened: string;
    beforeState: string | null;
    afterState: string | null;
  },
  impact: string | null,
): TranslatableEvent {
  return {
    eventId: event.eventId,
    title: event.title,
    whatHappened: event.whatHappened,
    beforeState: event.beforeState,
    afterState: event.afterState,
    impact,
  };
}

export type ImpactResult = { eventId: string; text: string };

type ImpactRow = {
  event_id: string;
  status: ImpactStatus;
  text: string | null;
};

async function loadImpacts(db: Db, eventIds: string[]): Promise<Map<string, ImpactRow>> {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await db
    .from("event_impacts")
    .select("event_id, status, text")
    .in("event_id", eventIds);
  if (error) throw new Error(`reading event_impacts: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.event_id, row]));
}

/**
 * What this reader was already sent, for the twin test.
 *
 * Reads the same 48h delivery window `suppressDeliveredDuplicates` uses, via
 * `digest_items` joined to their events' titles and summaries. Kept narrow on
 * purpose — titles plus summaries for one reader's recent items — and a failed
 * read returns nothing rather than raising: the twin pass is a polish layer,
 * and an outage must cost one repeated story, never the briefing.
 */
async function deliveredTwinTitles(
  db: Db,
  userId: string,
): Promise<{ title: string; whatHappened: string | null }[]> {
  try {
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data, error } = await db
      .from("digests")
      .select("digest_id")
      .eq("user_id", userId)
      .eq("kind", "briefing")
      .gte("generated_at", since);
    if (error) return [];
    const digestIds = (data ?? []).map((row) => row.digest_id);
    if (digestIds.length === 0) return [];
    const { data: items, error: itemsError } = await db
      .from("digest_items")
      .select("events ( title, what_happened )")
      .in("digest_id", digestIds);
    if (itemsError) return [];
    return (items ?? []).flatMap((row) => {
      const event = row.events as { title?: string; what_happened?: string | null } | null;
      return event?.title
        ? [{ title: event.title, whatHappened: event.what_happened ?? null }]
        : [];
    });
  } catch {
    return [];
  }
}

async function claimDigest(db: Db, due: DueRow, options: DigestOptions): Promise<"held" | string> {
  if (options.dryRun === true) return "held";

  const { data, error } = await db
    .from("digests")
    .update({ status: "generating", generation_started_at: new Date().toISOString() })
    .eq("digest_id", due.digest_id)
    .in("status", ["scheduled", "generating"])
    .select("digest_id");

  if (error) return `claiming: ${error.message}`;
  if ((data?.length ?? 0) === 0) return "already claimed";
  return "held";
}

/** The Q4 quality-gate disposition reason, one spelling everywhere. */
const GATED_KIND = "missing_story_specific_why_it_matters";

/**
 * The withheld dispositions as the digest row records them: count and kinds,
 * then — for the Q4 quality gate — the item ids beside the reason, so the
 * disposition is auditable and no item disappears silently.
 */
function withheldNoteOf(entries: { eventId: string; kind: string }[]): string | null {
  if (entries.length === 0) return null;
  const gated = entries.filter((w) => w.kind === GATED_KIND);
  return (
    `${entries.length} withheld (${[...new Set(entries.map((w) => w.kind))].join(", ")})` +
    (gated.length > 0 ? `; skipped ${GATED_KIND}: ${gated.map((w) => w.eventId).join(" ")}` : "")
  );
}

/** Join the notes a digest row carries, dropping the absent ones. */
function noteOf(...parts: (string | null)[]): string | null {
  const joined = parts.filter((part): part is string => part !== null).join("; ");
  return joined === "" ? null : joined;
}

async function finish(
  db: Db,
  digestId: string,
  status: DigestStatus,
  itemCount: number,
  tokens: number,
  note: string | null = null,
): Promise<void> {
  const { error } = await db
    .from("digests")
    .update({
      status,
      item_count: itemCount,
      generation_tokens: tokens,
      generation_deferred_until: null,
      // Kept even on success when enrichment was degraded: a briefing that went
      // out without its shared explanations is not a failure, but it is the
      // thing to look at when a reader asks why theirs read thin.
      generation_failure_reason: note,
      generated_at: new Date().toISOString(),
    })
    .eq("digest_id", digestId);

  if (error) throw new Error(`finishing digest: ${error.message}`);
}

/**
 * A generation attempt that produced nothing, recorded without moving the
 * deadline.
 *
 * The replaced `deferDigest` wrote `generation_deferred_until`, and the value
 * it wrote came from `aiCapacityRetryAt`: fifteen minutes for a 429, and the
 * first of the next month for an exhausted budget. That policy is right for
 * background impact generation, which has no deadline, and wrong for a
 * briefing, which is nothing but a deadline. So there is no deferral window
 * here at all — the row goes back to `scheduled` and the next tick retries it,
 * against the same `scheduled_for` it has always had.
 *
 * Only genuinely broken attempts reach this: a model that will not answer no
 * longer fails a briefing. `MAX_GENERATION_ATTEMPTS` stops a poisoned row from
 * being retried on every tick until its slot expires.
 */
async function failGeneration(
  db: Db,
  due: DueRow,
  reason: string,
  tokens: number,
): Promise<"failed" | "requeued"> {
  const attempts = (due.generation_attempts ?? 0) + 1;
  const exhausted = attempts >= MAX_GENERATION_ATTEMPTS;

  const { error } = await db
    .from("digests")
    .update({
      status: exhausted ? "failed" : "scheduled",
      generation_attempts: attempts,
      generation_failure_reason: reason,
      generation_tokens: tokens,
      generated_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("digest_id", due.digest_id);
  if (error) throw new Error(`recording digest failure: ${error.message}`);

  return exhausted ? "failed" : "requeued";
}

/**
 * Closes a slot whose moment has passed, so nothing is sent for it.
 *
 * `scheduled_for` is deliberately untouched here as everywhere else: the record
 * of what the reader was promised is what makes the miss measurable.
 */
async function expireSlot(db: Db, digestId: string, lateMinutes: number): Promise<void> {
  const { error } = await db
    .from("digests")
    .update({
      status: "failed",
      generated_at: new Date().toISOString(),
      generation_failure_reason: `missed slot by ${lateMinutes} minutes; not sent`,
    })
    .eq("digest_id", digestId);
  if (error) throw new Error(`expiring digest: ${error.message}`);
}

async function loadPref(db: Db, userId: string): Promise<PrefRow | null> {
  const { data, error } = await db
    .from("notification_preferences")
    .select(PREF_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`reading preferences: ${error.message}`);
  return (data as PrefRow | null) ?? null;
}

/**
 * This reader's briefable matches, with the freshness the ranking needs.
 *
 * The event is embedded rather than fetched in a second pass: ranking cannot be
 * done without `first_seen_at`, and a briefing that loaded every candidate and
 * then went back for their dates would be two round trips to answer one
 * question. `expired_at` is filtered here rather than in `selectItems` because
 * an expired candidate is not a low-scoring candidate — it is not a candidate,
 * and it should not be counted, ranked or reported as one.
 */
async function loadMatches(db: Db, userId: string): Promise<MatchRow[]> {
  // `events ( title )` rides along for the diversity cap: "one subject may not
  // own a third of the briefing" is a question about headline entities, and
  // without the title in hand it could not be asked at selection time.
  const { data, error } = await db
    .from("user_events")
    .select(
      "event_id, relevance, matched_at, delivered_revision, events ( title, first_seen_at, material_occurrence_at, material_revision, importance, novelty )",
    )
    .eq("user_id", userId)
    .is("briefed_at", null)
    .is("expired_at", null)
    .order("relevance", { ascending: false });
  if (error) throw new Error(`reading user_events: ${error.message}`);
  return (data ?? []).map((row) => {
    const event = row.events as {
      title?: string;
      first_seen_at?: string;
      material_occurrence_at?: string | null;
      material_revision?: number;
      importance?: number;
      novelty?: number;
    } | null;
    return {
      eventId: row.event_id,
      relevance: row.relevance,
      matchedAt: row.matched_at,
      // The occurrence clock for a revised event, `first_seen_at` otherwise.
      // This one line is what keeps a late-discovered development from being
      // presented as today's news; see MatchRow.eventAt.
      eventAt: event?.material_occurrence_at ?? event?.first_seen_at ?? null,
      importance: event?.importance ?? 0,
      novelty: event?.novelty ?? 0,
      materialRevision: event?.material_revision ?? 0,
      deliveredRevision: row.delivered_revision ?? 0,
      matchedTitle: event?.title ?? "",
    };
  });
}

/**
 * What this reader has already been delivered, by event, as a revision.
 *
 * The highest revision in the reader's delivery history per event. A map rather
 * than a set because "delivered" stopped being a boolean when material revisions
 * arrived: the reader holds revision N, and the question is whether the event is
 * still at N.
 *
 * History is a second opinion, not the authority -- `user_events.delivered_revision`
 * is durable and this read is not (see the column comment in 0099). The caller
 * takes the maximum of the two.
 */
async function alreadyBriefed(db: Db, userId: string): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id")
    .eq("user_id", userId)
    .in("status", ["ready", "sent", "generating"]);
  if (error) throw new Error(`reading prior digests: ${error.message}`);

  const ids = (data ?? []).map((d) => d.digest_id);
  const found = new Map<string, number>();
  if (ids.length === 0) return found;

  const { data: items, error: itemError } = await db
    .from("digest_items")
    .select("event_id, delivered_revision")
    .in("digest_id", ids);
  if (itemError) throw new Error(`reading prior digest_items: ${itemError.message}`);
  for (const item of items ?? []) {
    const revision = item.delivered_revision ?? 0;
    found.set(item.event_id, Math.max(found.get(item.event_id) ?? 0, revision));
  }
  return found;
}

/**
 * Article ids per `.in()` on `article_evidence`.
 *
 * A briefing's picked set is small, but each event carries several articles and
 * one `id` is 36 characters, so the whole set in a single filter string starts
 * approaching the request-URL limit at exactly the moment the briefing is
 * longest. Chunking keeps the read one round trip per briefing in practice
 * (most windows fit in one) without a failure mode at the top of the cap.
 */
const EVIDENCE_ARTICLE_CHUNK = 150;

async function loadBriefs(db: Db, picked: MatchRow[]): Promise<EventBrief[]> {
  const ids = picked.map((p) => p.eventId);
  const { data, error } = await db
    .from("events")
    .select(
      "id, title, what_happened, before_state, after_state, importance, novelty, publisher_count, tags, first_seen_at, material_occurrence_at",
    )
    .in("id", ids);
  if (error) throw new Error(`reading events: ${error.message}`);

  const { data: links, error: linkError } = await db
    .from("event_topics")
    .select("event_id, topics ( label )")
    .in("event_id", ids);
  if (linkError) throw new Error(`reading event_topics: ${linkError.message}`);

  const topics = new Map<string, string[]>();
  for (const link of links ?? []) {
    const label = (link.topics as { label?: string } | null)?.label;
    if (!label) continue;
    topics.set(link.event_id, [...(topics.get(link.event_id) ?? []), label]);
  }

  // Distinct outlets, not article count: two pieces from one publisher are one
  // outlet's worth of corroboration, and the inclusion line says "independent".
  const { data: coverage, error: coverageError } = await db
    .from("articles")
    .select("id, event_id, source_id, title, excerpt, sources ( name, kind )")
    .in("event_id", ids);
  if (coverageError) throw new Error(`reading coverage: ${coverageError.message}`);

  const outlets = new Map<string, Set<string>>();
  // The reader's evidence per event, for the readiness gate's briefability
  // contract. Built in the same pass as the outlet counts because it is the
  // same rows; a second query for material already selected would be the kind
  // of drift that makes a gate disagree with the composer it guards.
  const evidence = new Map<string, ReaderSource[]>();
  // Names as well as ids, because the count is not the whole question: the
  // inclusion line has to be able to say who has a single-source story, or it
  // falls back to the reader's topics and repeats itself. Collected separately
  // so the count keeps counting ids exactly as it did.
  // The feeds behind the story, by `sources.kind`, for the readiness gate's
  // primary-source rung: a single-source preprint or code release is not a
  // briefing item (operator decision, 2026-10-08).
  const kinds = new Map<string, Set<string>>();
  // The article-page evidence (0090) behind those same rows, keyed by article
  // and folded onto the event below. The inclusion ladder's consequence rung
  // reads it and nothing else does — no model, no cost, and the same table the
  // Read page's composer selects from, so the line and the article agree about
  // what the story says.
  const unitTexts = new Map<string, string[]>();
  const articleIds = (coverage ?? []).flatMap((row) => (row.id ? [row.id] : []));
  for (let from = 0; from < articleIds.length; from += EVIDENCE_ARTICLE_CHUNK) {
    const { data: units, error: evidenceError } = await db
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", articleIds.slice(from, from + EVIDENCE_ARTICLE_CHUNK))
      .eq("status", "enriched");
    if (evidenceError) throw new Error(`reading article evidence: ${evidenceError.message}`);
    for (const unit of units ?? []) {
      const texts = (Array.isArray(unit.evidence) ? unit.evidence : [])
        .map((item) => (item as { text?: unknown }).text)
        .filter((text): text is string => typeof text === "string" && text.trim() !== "");
      if (texts.length > 0) unitTexts.set(unit.article_id, texts);
    }
  }
  const storyEvidence = new Map<string, string[]>();
  for (const row of coverage ?? []) {
    if (!row.event_id) continue;
    const texts = unitTexts.get(row.id ?? "");
    if (texts !== undefined) {
      storyEvidence.set(row.event_id, [...(storyEvidence.get(row.event_id) ?? []), ...texts]);
    }
    const seen = outlets.get(row.event_id) ?? new Set<string>();
    seen.add(row.source_id ?? "unknown");
    outlets.set(row.event_id, seen);

    const kind = (row.sources as { kind?: string } | null)?.kind;
    if (kind) {
      const kindsHere = kinds.get(row.event_id) ?? new Set<string>();
      kindsHere.add(kind);
      kinds.set(row.event_id, kindsHere);
    }

    // The reader's evidence for this story, in the shape `selectReaderEvidence`
    // expects. The gate reads the same list the composer will, so a story is
    // never admitted here and refused there for want of the same material.
    const sourceList = evidence.get(row.event_id) ?? [];
    sourceList.push({
      name: (row.sources as { name?: string } | null)?.name ?? "Unattributed",
      ...(row.title ? { headline: row.title } : {}),
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
    });
    evidence.set(row.event_id, sourceList);
  }

  const byId = new Map((data ?? []).map((e) => [e.id, e] as const));
  return picked.flatMap((row) => {
    const event = byId.get(row.eventId);
    if (!event) return [];
    return [
      {
        eventId: row.eventId,
        title: event.title,
        whatHappened: event.what_happened,
        beforeState: event.before_state,
        afterState: event.after_state,
        importance: event.importance,
        novelty: event.novelty,
        topics: topics.get(row.eventId) ?? [],
        sourceCount: event.publisher_count || outlets.get(row.eventId)?.size || 0,
        sources: evidence.get(row.eventId) ?? [],
        evidence: storyEvidence.get(row.eventId) ?? [],
        sourceKinds: [...(kinds.get(row.eventId) ?? [])],
        relevance: row.relevance,
        matchedAt: row.matchedAt,
        // The occurrence clock for a revised event, `first_seen_at` otherwise --
        // the same choice the reader's page makes when it dates a story.
        publishedAt: event.material_occurrence_at ?? event.first_seen_at ?? null,
      },
    ];
  });
}

async function planFor(db: Db, userId: string): Promise<PlanTier> {
  const { data } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan ?? "uno";
}

export function queuedChannels(
  channels: DeliveryChannel[],
  linked: { telegram: boolean; push: boolean },
): DeliveryChannel[] {
  const out: DeliveryChannel[] = [];
  if (channels.includes("email")) out.push("email");
  if (channels.includes("telegram") && linked.telegram) out.push("telegram");
  if (channels.includes("push") && linked.push) out.push("push");
  return out;
}

export async function deliveryTargets(
  db: Db,
  userId: string,
): Promise<{ telegram: boolean; push: boolean }> {
  const [{ data: telegram }, pushCountProbe] = await Promise.all([
    db.from("telegram_accounts").select("chat_id").eq("user_id", userId).maybeSingle(),
    db
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  const pushCount = countOrThrow("push subscriptions", pushCountProbe);
  const plan = await planFor(db, userId);
  return {
    telegram: PLAN_LIMITS[plan].telegram && Boolean(telegram?.chat_id),
    push: pushCount > 0,
  };
}

async function queueDeliveries(
  db: Db,
  digestId: string,
  userId: string,
  channels: DeliveryChannel[],
): Promise<void> {
  const toQueue = queuedChannels(channels, await deliveryTargets(db, userId));
  if (toQueue.length === 0) return;

  const { error } = await db.from("deliveries").upsert(
    toQueue.map((channel) => ({ digest_id: digestId, channel, status: "queued" as const })),
    { onConflict: "digest_id,channel", ignoreDuplicates: true },
  );
  if (error) throw new Error(`queueing delivery: ${error.message}`);
}

export type DeliveryReport = { sent: number; retried: number; byDigest: Map<string, number> };

/**
 * Sends every queued email and Telegram delivery, optionally for one set of readers.
 *
 * Exported so a breaking alert can flush the row it just queued without waiting
 * for the digest cron, using the same retry and idempotency path.
 */
export async function flushDeliveries(db: Db, options: DigestOptions): Promise<DeliveryReport> {
  return deliverDue(db, options);
}

async function deliverDue(
  db: Db,
  options: DigestOptions,
  digestIds?: string[],
): Promise<DeliveryReport> {
  // `next_attempt_at` is null for a delivery that has never been deferred — a
  // first attempt is not a retry — so "due" is null or in the past.
  let query = db
    .from("deliveries")
    .select("id, digest_id, channel, status, attempts, last_error")
    .eq("status", "queued")
    .in("channel", ["email", "telegram", "push"])
    .lt("attempts", MAX_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("id")
    .limit((options.limit ?? BATCH) * MAX_DELIVERY_CHANNELS);
  if (digestIds) query = query.in("digest_id", digestIds);

  const { data, error } = await query;
  if (error) throw new Error(`reading deliveries: ${error.message}`);

  const rows = data ?? [];
  const deadlines = await deliveryDeadlines(
    db,
    rows.map((row) => row.digest_id),
  );
  const now = options.now ?? new Date();

  const byDigest = new Map<string, number>();
  let sent = 0;
  let retried = 0;

  for (const row of rows) {
    // `scheduled_for` is the delivery deadline, and this is the only gate on
    // it. Generation may have finished up to PREPARE_LEAD_MINUTES ago; a
    // reader who asked for 07:30 must not be woken at 07:20 because the
    // briefing happened to be ready early. A digest we cannot find a deadline
    // for is let through, so the missing-digest path below still marks it.
    const deadline = deadlines.get(row.digest_id);
    if (deadline !== undefined && deadline - DELIVERY_TICK_GRACE_MS > now.getTime()) continue;

    if (options.userIds) {
      const { data: digestRow } = await db
        .from("digests")
        .select("user_id")
        .eq("digest_id", row.digest_id)
        .maybeSingle();
      if (!digestRow || !options.userIds.includes(digestRow.user_id)) continue;
    }

    const { data: claimed, error: claimError } = await db.rpc("claim_delivery", {
      p_id: row.id,
      p_lease_minutes: DELIVERY_LEASE_MINUTES,
    });
    if (claimError) throw new Error(`claiming delivery: ${claimError.message}`);
    if (claimed !== true) continue;

    // Claiming is not attempting. Stamped here, in its own statement, so that
    // the gap between "a worker took this row" and "a provider was actually
    // called" stays visible: a row claimed but never attempted is a worker that
    // died holding it, and a row attempted but never delivered may have reached
    // the provider. Collapsing the two would make those indistinguishable.
    const { error: attemptError } = await db.rpc("mark_delivery_attempt", { p_id: row.id });
    if (attemptError) throw new Error(`recording delivery attempt: ${attemptError.message}`);

    let result: "sent" | "retried" | "failed";
    try {
      result = await sendOne(db, row, options);
    } catch (error) {
      const attempts = row.attempts + 1;
      const detail = error instanceof Error ? error.message : String(error);
      const retry = attempts < MAX_ATTEMPTS;
      await markDelivery(db, row.id, attempts, retry ? "queued" : "failed", detail, now);
      result = retry ? "retried" : "failed";
    }
    if (result === "sent") {
      sent += 1;
      byDigest.set(row.digest_id, (byDigest.get(row.digest_id) ?? 0) + 1);
    } else if (result === "retried") {
      retried += 1;
    }
  }

  return { sent, retried, byDigest };
}

/**
 * `scheduled_for` for each digest behind a batch of queued deliveries.
 *
 * One query for the batch rather than one per row: this runs on every
 * one-minute tick, and the Workers subrequest budget is the reason every other
 * read in this file is batched too.
 */
async function deliveryDeadlines(db: Db, digestIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(digestIds)];
  if (ids.length === 0) return new Map();

  const { data, error } = await db
    .from("digests")
    .select("digest_id, scheduled_for")
    .in("digest_id", ids);
  if (error) throw new Error(`reading delivery deadlines: ${error.message}`);

  const out = new Map<string, number>();
  for (const row of data ?? []) out.set(row.digest_id, Date.parse(row.scheduled_for));
  return out;
}

/**
 * Settles a `ready` digest the moment its last delivery leg resolves
 * terminally, however the legs ordered themselves. A digest with an accepted
 * leg is `sent`; a digest no leg could deliver is `failed` here with a reason
 * that names the cause, instead of sitting `ready` until the sweeper expires
 * it two hours later with built items attached. Runs only on terminal
 * resolution — a leg back in `queued` still owns the digest's future — and
 * never touches a digest that already left `ready`.
 */
async function reconcileDigestAfterTerminal(
  db: Db,
  digest: { digest_id: string; status: string },
): Promise<void> {
  if (digest.status !== "ready") return;
  const { count: queued, error: queuedError } = await db
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("digest_id", digest.digest_id)
    .eq("status", "queued");
  if (countOrThrow("queued deliveries", { count: queued, error: queuedError }) !== 0) return;
  const { count: accepted, error: acceptedError } = await db
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("digest_id", digest.digest_id)
    .eq("status", "sent");
  if (countOrThrow("sent deliveries", { count: accepted, error: acceptedError }) === 0) {
    await db
      .from("digests")
      .update({
        status: "failed",
        generation_failure_reason: "all deliveries failed; not sent",
      })
      .eq("digest_id", digest.digest_id);
  } else {
    await db.from("digests").update({ status: "sent" }).eq("digest_id", digest.digest_id);
  }
}

async function sendOne(
  db: Db,
  row: { id: string; digest_id: string; channel: DeliveryChannel; attempts: number },
  options: DigestOptions,
): Promise<"sent" | "retried" | "failed"> {
  const now = options.now ?? new Date();
  const { data: digestRow, error } = await db
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status, item_count, kind")
    .eq("digest_id", row.digest_id)
    .maybeSingle();
  if (error) throw new Error(`reading delivery digest: ${error.message}`);
  if (!digestRow) throw new Error("delivery digest is missing");

  if (digestRow.status !== "ready" && digestRow.status !== "skipped") {
    throw new Error(`digest is ${digestRow.status}`);
  }

  // The reader's language is read at send time rather than carried on the
  // digest: generation prewarmed the cache, this reads it. A reader who
  // changed language between the two gets the newer choice, and any story
  // whose translation is missing falls back to English per story rather
  // than failing the send.
  const { data: langRow } = await db
    .from("notification_preferences")
    .select("language, timezone")
    .eq("user_id", digestRow.user_id)
    .maybeSingle();

  const plan = await planFor(db, digestRow.user_id);
  if (
    digestRow.kind === "alert" &&
    !(await alertDeliveryAllowed(db, digestRow.user_id, row.digest_id, plan, now))
  ) {
    await db
      .from("deliveries")
      .update({ status: "failed", last_error: "Alert allowance changed or expired." })
      .eq("id", row.id);
    await reconcileDigestAfterTerminal(db, digestRow);
    return "failed";
  }
  if (row.channel === "telegram" && !PLAN_LIMITS[plan].telegram) {
    await db
      .from("deliveries")
      .update({ status: "failed", last_error: "Telegram is not included in the current plan." })
      .eq("id", row.id);
    await reconcileDigestAfterTerminal(db, digestRow);
    return "failed";
  }
  const items = await loadMailItems(db, row.digest_id, "en");
  const origin = siteUrl(options.email);
  const first = items[0];

  const result =
    row.channel === "telegram"
      ? await sendTelegramDelivery(db, digestRow, items, first, origin, options)
      : row.channel === "push"
        ? await sendPushDelivery(db, digestRow, items, origin, options, langRow?.timezone ?? null)
        : await sendEmailDelivery(db, digestRow, items, first, origin, options);

  const attempts = row.attempts + 1;
  if (result.ok) {
    await markDelivery(db, row.id, attempts, "sent", null, now);
    if (digestRow.status === "ready") {
      const { count, error } = await db
        .from("deliveries")
        .select("id", { count: "exact", head: true })
        .eq("digest_id", row.digest_id)
        .eq("status", "queued");
      // A digest is marked sent only on a count the server really sent. This
      // used to read an unreadable count as "nothing left to deliver", which
      // marks the digest sent while deliveries are still queued.
      if (countOrThrow("queued deliveries", { count, error }) === 0) {
        await db.from("digests").update({ status: "sent" }).eq("digest_id", row.digest_id);
      }
    }
    return "sent";
  }

  if (result.retryable && attempts < MAX_ATTEMPTS) {
    await markDelivery(db, row.id, attempts, "queued", result.error, now);
    return "retried";
  }

  await markDelivery(db, row.id, attempts, "failed", result.error, now);
  await reconcileDigestAfterTerminal(db, digestRow);
  return "failed";
}

async function sendEmailDelivery(
  db: Db,
  digestRow: { digest_id: string; user_id: string; scheduled_for: string; kind: string | null },
  items: MailItem[],
  first: MailItem | undefined,
  origin: string,
  options: DigestOptions,
) {
  const recipient = await findRecipient(db, digestRow.user_id);
  if (!recipient) return { ok: false as const, error: "no email on profile", retryable: false };
  let unsubscribe: string;
  try {
    unsubscribe = await unsubscribeUrl(digestRow.user_id, origin, options.email);
  } catch (error) {
    return { ok: false as const, error: (error as Error).message, retryable: false };
  }

  const message =
    digestRow.kind === "alert" && first
      ? breakingEmail({
          name: recipient.name,
          baseUrl: origin,
          title: first.title,
          why: first.why,
          grafs: first.grafs,
          href: `${origin}/dashboard/story/${first.eventId}`,
          unsubscribeUrl: unsubscribe,
        })
      : briefingEmail({
          name: recipient.name,
          baseUrl: origin,
          scheduledFor: new Date(digestRow.scheduled_for),
          items: items.map((item) => ({
            title: item.title,
            why: item.why,
            grafs: item.grafs,
            href: `${origin}/dashboard/story/${item.eventId}`,
          })),
          unsubscribeUrl: unsubscribe,
        });

  return sendEmail({
    to: recipient.email,
    message,
    unsubscribeUrl: unsubscribe,
    idempotencyKey: `digest:${digestRow.digest_id}:email`,
    env: options.email,
  });
}

async function sendTelegramDelivery(
  db: Db,
  digestRow: { user_id: string; scheduled_for: string; kind: string | null; digest_id: string },
  items: MailItem[],
  first: MailItem | undefined,
  origin: string,
  options: DigestOptions,
) {
  const { data: account } = await db
    .from("telegram_accounts")
    .select("chat_id")
    .eq("user_id", digestRow.user_id)
    .maybeSingle();
  if (!account?.chat_id) {
    return { ok: false as const, error: "telegram not linked", retryable: false };
  }

  const html =
    digestRow.kind === "alert" && first
      ? formatTelegramAlert({
          title: first.title,
          why: first.why,
          href: `${origin}/dashboard/story/${first.eventId}`,
        })
      : formatTelegramBriefing({
          scheduledFor: new Date(digestRow.scheduled_for),
          items: items.map((item) => ({
            title: item.title,
            why: item.why,
            href: `${origin}/dashboard/story/${item.eventId}`,
          })),
          briefingHref: `${origin}/dashboard/briefing`,
        });

  const result = await sendTelegramMessage({
    chatId: account.chat_id,
    html,
    env: options.telegram,
  });

  // A blocked bot used to leave the link in place for ever: every future
  // briefing and alert failed its Telegram delivery after one attempt, while
  // the reader's settings page went on saying "Linked". Removing the row is
  // what makes the two agree — the reader sees Telegram is disconnected and can
  // reconnect, and nothing is queued for a chat that will never accept it.
  if (!result.ok && result.gone) {
    await db.from("telegram_accounts").delete().eq("user_id", digestRow.user_id);
    await recordOps(db, "delivery:telegram-unlinked", "warning", {
      user_id: digestRow.user_id,
      detail: result.error,
    });
  }

  return result;
}

/**
 * One OS notice for a briefing; one per story for an alert.
 *
 * `sendStoryPushes` raises a notification per story it is given, and this used
 * to hand it the entire digest — fifty stories on Omni at Deep density, per
 * device, at 07:30. The briefing is not the notification: it is in the email
 * and on the dashboard, and the notice exists to be worth opening. So a
 * briefing sends one notice naming its lead stories, and the reader taps
 * through to the feed.
 *
 * Alerts keep a notice each. An alert digest holds exactly one item (see
 * `create_alert_delivery`), and the whole point of one is that it is a single
 * event worth interrupting somebody for — folding it into a summary would
 * describe it as part of a set it is not part of.
 */
async function sendPushDelivery(
  db: Db,
  digestRow: { user_id: string; kind: string | null; digest_id: string; scheduled_for: string },
  items: MailItem[],
  origin: string,
  options: DigestOptions,
  timezone: string | null,
) {
  const alert = digestRow.kind === "alert";
  if (alert && (await alertWasOpened(db, digestRow.user_id, items))) {
    return { ok: true as const };
  }

  const plan = await planFor(db, digestRow.user_id);
  const { data: devices, error: deviceError } = await db
    .from("registered_devices")
    .select("install_id")
    .eq("user_id", digestRow.user_id)
    .order("first_seen")
    .order("install_id")
    .limit(PLAN_LIMITS[plan].devices);
  if (deviceError) throw new Error(deviceError.message);
  const active = (devices ?? []).map((d) => d.install_id);
  const { data: rows } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", digestRow.user_id)
    .in("install_id", active);
  const subscriptions = rows ?? [];
  if (subscriptions.length === 0) {
    return { ok: false as const, error: "no push subscription", retryable: false };
  }

  const stories = alert
    ? items.map((item) =>
        storyPush({
          title: item.title,
          why: item.why,
          href: `${origin}/dashboard/story/${item.eventId}`,
          eventId: item.eventId,
          breaking: true,
        }),
      )
    : [
        briefingPush({
          titles: items.map((item) => item.title),
          total: items.length,
          href: `${origin}/dashboard`,
          tag: digestRow.digest_id,
          when: partOfDay(
            timezone ? hourInZone(new Date(digestRow.scheduled_for), timezone) : null,
          ),
        }),
      ];

  const result = await sendStoryPushes({
    subscriptions,
    stories,
    urgency: alert ? "high" : "normal",
    env: options.push,
  });

  if (result.dropIds.length > 0) {
    await db.from("push_subscriptions").delete().in("id", result.dropIds);
  }

  if (result.ok) {
    // The reader was reached, but a device was not and never will be. Recorded
    // rather than returned, because failing the delivery over it would mark
    // every future briefing failed while the reader keeps receiving them.
    if (result.partialError) {
      await recordOps(db, "delivery:push-partial", "warning", {
        user_id: digestRow.user_id,
        digest_id: digestRow.digest_id,
        detail: result.partialError,
      });
    }
    return { ok: true as const };
  }
  return { ok: false as const, error: result.error, retryable: result.retryable };
}

export async function alertWasOpened(
  db: Db,
  userId: string,
  items: { eventId: string }[],
): Promise<boolean> {
  const eventId = items[0]?.eventId;
  if (!eventId) return false;

  const { data, error } = await db
    .from("user_events")
    .select("opened_at")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`checking alert read state: ${error.message}`);
  return data?.opened_at != null;
}

async function markDelivery(
  db: Db,
  id: string,
  attempts: number,
  status: "queued" | "sent" | "failed",
  lastError: string | null,
  /**
   * The run's clock, for scheduling the retry only.
   *
   * `delivered_at` below deliberately stays on the wall clock: it is the number
   * the timing contract is measured against, so it has to be when the send
   * actually happened and not when the invocation believes it is.
   */
  now: Date = new Date(),
): Promise<void> {
  const { error } = await db
    .from("deliveries")
    .update({
      attempts,
      status,
      last_error: lastError,
      processing_started_at: null,
      // Only a re-queue carries a deadline. Clearing it on the terminal
      // statuses keeps a row that later gets requeued by hand from inheriting
      // a stale one and sitting out its first attempt.
      next_attempt_at: status === "queued" ? nextAttemptAt(attempts, now.getTime()) : null,
      delivered_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`updating delivery: ${error.message}`);
  if (status === "failed") {
    await recordOps(db, "delivery:failure", "error", {
      delivery_id: id,
      attempts,
      error: lastError,
    });
  }
}

type MailEvent = {
  title?: string;
  what_happened?: string;
  before_state?: string | null;
  after_state?: string | null;
};

type MailItem = { eventId: string; title: string; why: string; grafs: string[] };

async function loadMailItems(db: Db, digestId: string, language: LanguageTag): Promise<MailItem[]> {
  const { data, error } = await db
    .from("digest_items")
    .select(
      "event_id, position, why_it_matters, summary, events ( title, what_happened, before_state, after_state )",
    )
    .eq("digest_id", digestId)
    .order("position", { ascending: true });
  if (error) throw new Error(`reading digest_items: ${error.message}`);

  const rows = data ?? [];
  const excerpts = await excerptsFor(
    db,
    rows.map((row) => row.event_id),
  );

  // Cache-only: generation already prewarmed this. A story missing here is
  // one whose translation failed or is still being written — it falls back
  // to English below rather than blocking the send or paying at send time.
  const translations = await readTranslationsForDelivery(
    db,
    rows.map((row) => ({
      eventId: row.event_id,
      events: row.events,
      // `why_it_matters` holds the shared impact (phase 2), which is what
      // generation hashed. Reading it back here is what keeps the two
      // content_versions identical.
      impact: row.why_it_matters,
    })),
    language,
  );

  return rows.flatMap((row) => {
    const joined = row.events as MailEvent | MailEvent[] | null;
    const event = Array.isArray(joined) ? joined[0] : joined;
    const title = event?.title;
    if (!title) return [];
    const translated = translations.get(row.event_id);
    return [
      {
        eventId: row.event_id,
        title: translated?.title ?? title,
        why: translated?.impact ?? row.why_it_matters,
        grafs: mailGrafs({
          // Resolved through the delivery seam, so this path cannot print a
          // refused line: the composed artifact leads, a translation is printed
          // only for a line the boundary admits, and a refused one is withheld in
          // every language (reader-summary.ts).
          what: deliveredTranslatedLine(row, event?.what_happened, translated?.whatHappened),
          before: translated?.beforeState ?? event?.before_state ?? "",
          after: translated?.afterState ?? event?.after_state ?? "",
          excerpts: excerpts.get(row.event_id) ?? [],
        }),
      },
    ];
  });
}

/**
 * Cached translations for a delivery, or an empty map.
 *
 * `cacheOnly` on purpose: paying for a translation inside the send path
 * would put a model call between a queued delivery and an inbox, where a
 * timeout becomes a failed send rather than a slower one. Generation warms
 * this; delivery only reads it.
 */
async function readTranslationsForDelivery(
  db: Db,
  rows: { eventId: string; events: unknown; impact: string | null }[],
  language: LanguageTag,
): Promise<Map<string, TranslatedText>> {
  if (!needsTranslation(language) || rows.length === 0) return new Map();

  const events = rows.flatMap((row) => {
    const joined = row.events as MailEvent | MailEvent[] | null;
    const event = Array.isArray(joined) ? joined[0] : joined;
    if (!event?.title) return [];
    return [
      translatable(
        {
          eventId: row.eventId,
          title: event.title,
          whatHappened: event.what_happened ?? "",
          beforeState: event.before_state ?? null,
          afterState: event.after_state ?? null,
        },
        row.impact,
      ),
    ];
  });

  const result = await translateEvents(db, events, language, { cacheOnly: true });
  return result.byEventId;
}

async function excerptsFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  const { data, error } = await db
    .from("articles")
    .select("event_id, excerpt")
    .in("event_id", eventIds)
    .order("published_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`reading article excerpts: ${error.message}`);

  for (const row of data ?? []) {
    if (!row.event_id) continue;
    const excerpt = (row.excerpt ?? "").trim();
    if (excerpt.length < 40) continue;
    const list = out.get(row.event_id) ?? [];
    if (list.length >= 6) continue;
    list.push(excerpt);
    out.set(row.event_id, list);
  }
  return out;
}

export function describeDigest(report: DigestReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);
  return (
    `digest: ${report.considered} considered, ${report.generated} generated, ` +
    `${report.skipped} skipped, ` +
    `${report.failed} failed, ${report.paused} paused, ${report.deferred} retrying, ` +
    `${report.expired} expired, ` +
    `${report.sent} sent, ${report.retried} retrying, ` +
    `${report.tokens} tokens, ${seconds}s`
  );
}
