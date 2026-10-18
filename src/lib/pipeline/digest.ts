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
import { hasStorySpecificLine, reasonFor } from "./inclusion";
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
  /** Where a build that spans several ticks got to (0119). `unknown` on
   * purpose: it is JSON off the wire and every read of it goes through
   * `readGenerationProgress`, which is total. */
  generation_progress?: unknown;
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
  // `*` rather than a column list on purpose. The code can be deployed before the
  // migration that backs it (migrations here are applied by hand), and a named
  // column the database does not have yet would fail the *read* -- the whole stage,
  // not one feature of it. Asking for the row asks for whatever the schema has, and
  // `generateOne` reads `generation_progress` being there as the schema's answer to
  // "does this database have 0119?".
  let query = db
    .from("digests")
    .select("*")
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
    // A build that has written its progress is due *now*, not after a lease:
    // `generation_progress` (0119) is the build's own cursor, and a cursor is
    // the statement that there is work left to do. Waiting `GENERATION_LEASE_MINUTES`
    // would turn a twenty-two-tick build into one that takes twice as long, and
    // the lease answers a different question anyway — it is there so a *claim*
    // whose worker never came back can be retaken, and a row with a cursor has
    // already come back.
    if (readGenerationProgress(row.generation_progress) !== null) return true;
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
  const base = outcomeOf(due);

  // The row is the schema's own answer to "does this database have 0119?" — see
  // `progressColumnPresent`. Read before anything writes, because every write that
  // names the column is guarded by it.
  progressColumnPresent = "generation_progress" in due;

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

  const carried = readGenerationProgress(due.generation_progress);

  // A dry run writes nothing, so it cannot be resumed on the next tick: it runs
  // the whole build in this invocation, exactly as it did before this slice.
  if (options.dryRun === true) {
    return advanceGeneration(db, due, prefs, carried ?? progressFor(now), options, false);
  }

  // A build that has written its progress is *resumed*, not claimed again. The
  // claim is what starts a build, and re-taking one would overwrite
  // `generation_started_at` — the clock the briefing's timing record is read
  // from, and the column the daily-briefing guard reads.
  if (carried === null) {
    const claimed = await claimDigest(db, due, options);
    if (claimed !== "held") {
      return { ...base, decision: "held", detail: claimed };
    }
  }

  return advanceGeneration(db, due, prefs, carried ?? progressFor(now), options, true);
}

/**
 * How many briefs one invocation may put through the readiness gate.
 *
 * The gate is where a briefing's CPU goes, and the reason a reader with a large
 * pool has been getting nothing. Measured 2026-10-16 on the reader whose 22:30Z
 * slot six nights running was killed: `assessReadiness` costs a **median 338 ms
 * of CPU per brief** (range 9.6 ms to 1,744 ms, tracking excerpt size) — 15.5 s
 * for the 37 candidates that briefing considered — against a Workers-free record
 * whose observed success ceiling is ~710 ms (`cpuTimeUs`, 2026-10-11: the kills
 * cluster in the 9.5–10 ms bucket and 767 scheduled invocations that day still
 * succeeded above 10 ms, the largest at 709,805 µs).
 *
 * One, since the gate was made cheap (2026-10-16, second measurement). Two medians
 * were the right whole number for the first measurement; the repair that followed
 * it cut the gate's own cost — `contains` and `repetitionBomb` were rebuilding a
 * regular expression and re-scanning every phrase window on every call, and now do
 * neither — so the whole gate over that reader's 37 candidates is **2.6 s of CPU
 * instead of 15.1 s, median 18 ms per brief, worst 435 ms** (measured 2026-10-16 on
 * the same harness, and proved output-identical: 200 frozen stories composed before
 * and after, **0 stories changed**). *Two* briefs a tick would put pairs of the
 * expensive head together — the worst pair is still ~670 ms — and a pair that
 * overruns the ceiling is a pair that is retried forever, because a killed tick
 * persists nothing. One brief cannot: 435 ms is the worst single brief observed,
 * well inside the ~710 ms grace.
 *
 * What it costs is latency, never correctness: a 25-story briefing becomes about
 * forty gate ticks, so it arrives twenty to forty minutes after its slot instead of
 * never — which the arbiter ruled acceptable on 2026-10-16, provided the delivery
 * is reliable and complete. Option B (a precomputed verdict per event) remains the
 * ruled target for the remainder; this is the mechanical repair that keeps every
 * gate exactly as it was.
 *
 * Deliberately not configurable. A briefing that ships faster by gating four
 * briefs a tick is a briefing that ships by overrunning the budget that was
 * killing it.
 */
const GATE_BRIEFS_PER_INVOCATION = 1;

/**
 * The set size past which a stage is a tick of its own.
 *
 * Every stage's cost is proportional to the set it had to look at, and the
 * measurements say by how much: on the reader whose 22:30Z slot six nights
 * running was killed (1,000 matches → 37 candidates, cap 25), the whole selection
 * stage measures **~250 ms** (33 ms parsing the rows, 194 ms of duplicate
 * suppression over a thousand candidates), screening **~200 ms**, and the
 * readiness gate a **median 18 ms per brief, worst 435 ms**. Twelve is where a set
 * that fits inside a tick and a set that does not are furthest apart — the largest
 * set any stage was measured to walk in one tick is the whole briefing, and the
 * smallest real reader's is a handful. Measured 2026-10-16, second measurement,
 * after the gate's own cost was repaired (see `GATE_BRIEFS_PER_INVOCATION`).
 *
 * A *count*, not a clock, and that is the point. A wall-clock budget in a
 * function this side of the database would make "did this briefing finish in one
 * invocation" depend on the machine that ran it, which is a property no test can
 * assert and no operator can reason about. A count of the set the stage already
 * walked is the same number everywhere, and it is the number that decides the
 * cost in the first place.
 *
 * What it buys, concretely, on that reader: selection and screening each take a
 * tick of their own — and now fit inside the ceiling when they do — and the gate
 * takes one brief a tick. A reader whose build already fitted in one invocation —
 * a handful of matches, a queue inside this limit — still finishes in one,
 * unchanged.
 */
const TICK_SET_LIMIT = 12;

/**
 * What the build records for a candidate it can no longer speak for.
 *
 * A story materially revised between two ticks is a different story from the one
 * the snapshot froze and the gate passed, so it is dropped from this briefing
 * rather than shipped with a line composed from newer material and a revision
 * that says older. It is never dropped silently: the kind is recorded on the
 * digest beside the readiness kinds, the item is not marked briefed, and the
 * story therefore leads the reader's next briefing.
 */
const CHANGED_KIND = "revised_since_generation_started";

/**
 * A briefing under construction, as the tick before this one left it.
 *
 * One column (0119) rather than a table, because this is a cursor and not a
 * record: the briefings it belongs to live in `digests` and `digest_items`, and
 * nothing else reads this. What it has to be is *complete*, because resuming is
 * only safe if it says exactly what has already been decided — the snapshot's
 * ranking, the verdicts taken against it, and the revision each verdict was
 * taken against.
 */
type GenerationCandidate = {
  eventId: string;
  relevance: number;
  matchedAt: string;
  /** `events.material_revision` when the snapshot was frozen. */
  revision: number;
};

type GenerationStage = "select" | "screen" | "gate" | "write";

type GenerationProgress = {
  v: 1;
  stage: GenerationStage;
  /**
   * The instant the snapshot was frozen. Ranking is a pure function of it, so
   * persisting it is what makes the order a later tick resumes against the same
   * order the first tick produced — the arbiter's "ranking must be deterministic
   * for a given generation snapshot".
   */
  snapshotAt: string;
  /**
   * How many matches selection ranked. Carried because it is the measure of
   * what selection cost, and therefore of whether the stage that ranked it gets
   * a tick of its own.
   */
  pool: number;
  /** The considered set, in ranked order: every story this briefing is about. */
  candidates: GenerationCandidate[];
  /** Twin survivors of `candidates`, in order. The gate walks this. */
  queue: GenerationCandidate[];
  /** Index into `queue` the gate resumes at. */
  cursor: number;
  /**
   * Verdicts so far: `kind` null means ready to ship, and a ready verdict carries
   * the sentence its composition published (`opening`).
   *
   * The opening rides here rather than being composed again at write time because
   * the gate is where the story is composed, and the write stage runs on the same
   * 10 ms CPU budget (arbiter ruling #11, 2026-10-18: the delivered briefing card
   * and email must carry the composer's own opening sentence). A record written
   * before this field existed reads as no opening, which falls back to the
   * previous artifact rule for that build and nothing else.
   */
  verdicts: { eventId: string; kind: string | null; opening?: string }[];
  /** Invocations that have advanced this build. */
  ticks: number;
  /** When this progress was last written. */
  heartbeatAt: string;
};

type StageStep =
  | { kind: "continue"; progress: GenerationProgress; detail: string }
  | { kind: "done"; outcome: DigestOutcome };

function progressFor(now: Date): GenerationProgress {
  return {
    v: 1,
    stage: "select",
    snapshotAt: now.toISOString(),
    pool: 0,
    candidates: [],
    queue: [],
    cursor: 0,
    verdicts: [],
    ticks: 0,
    heartbeatAt: now.toISOString(),
  };
}

function candidateOf(match: MatchRow): GenerationCandidate {
  return {
    eventId: match.eventId,
    relevance: match.relevance,
    matchedAt: match.matchedAt,
    revision: match.materialRevision,
  };
}

/**
 * The `MatchRow` a candidate rebuilds into, for the reads that take one.
 *
 * Only the three fields `loadBriefs` reads are carried. An event's significance,
 * clock and delivery revision are read from the database in that call, and
 * inventing them here would give every one of them a second source.
 */
function matchRowOf(candidate: GenerationCandidate): MatchRow {
  return {
    eventId: candidate.eventId,
    relevance: candidate.relevance,
    matchedAt: candidate.matchedAt,
    eventAt: null,
    importance: 0,
    novelty: 0,
    materialRevision: candidate.revision,
    deliveredRevision: 0,
  };
}

function jsonOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function candidatesOf(value: unknown): GenerationCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as Partial<GenerationCandidate> | null;
    if (row === null || typeof row !== "object" || typeof row.eventId !== "string") return [];
    return [
      {
        eventId: row.eventId,
        relevance: typeof row.relevance === "number" ? row.relevance : 0,
        matchedAt: typeof row.matchedAt === "string" ? row.matchedAt : "",
        revision: nonNegativeInt(row.revision),
      },
    ];
  });
}

function verdictsOf(value: unknown): { eventId: string; kind: string | null; opening?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as { eventId?: unknown; kind?: unknown; opening?: unknown } | null;
    if (row === null || typeof row !== "object" || typeof row.eventId !== "string") return [];
    // A verdict that cannot be read is a verdict to withhold on, never to ship
    // on: the one direction this must not fail in is admitting an ungated item.
    const kind = row.kind === null ? null : typeof row.kind === "string" ? row.kind : CHANGED_KIND;
    // An unreadable or absent opening is not an error: it means the build falls
    // back to the artifact rule that predates ruling #11 for this item. The key is
    // omitted rather than set to `undefined`, because this record is written to a
    // jsonb column and `undefined` is not JSON.
    return [
      {
        eventId: row.eventId,
        kind,
        ...(typeof row.opening === "string" ? { opening: row.opening } : {}),
      },
    ];
  });
}

/**
 * The progress a digest row carries, or null when it carries none.
 *
 * The read is total. A record this build cannot parse is *no record*, and the
 * briefing starts again rather than resuming from a cursor nothing can vouch
 * for — the failure that matters is a briefing resumed into a half-remembered
 * snapshot — and it cannot loop, because the restart writes a valid record over
 * the unreadable one.
 */
function readGenerationProgress(value: unknown): GenerationProgress | null {
  const raw = (
    typeof value === "string" ? jsonOrNull(value) : value
  ) as Partial<GenerationProgress> | null;
  if (raw === null || typeof raw !== "object") return null;
  if (raw.v !== 1) return null;
  const stage = raw.stage;
  if (stage !== "select" && stage !== "screen" && stage !== "gate" && stage !== "write")
    return null;
  return {
    v: 1,
    stage,
    snapshotAt: typeof raw.snapshotAt === "string" ? raw.snapshotAt : new Date().toISOString(),
    pool: nonNegativeInt(raw.pool),
    candidates: candidatesOf(raw.candidates),
    queue: candidatesOf(raw.queue),
    cursor: nonNegativeInt(raw.cursor),
    verdicts: verdictsOf(raw.verdicts),
    ticks: nonNegativeInt(raw.ticks),
    heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : new Date().toISOString(),
  };
}

/**
 * Records where a briefing got to, and keeps it claimable by the next tick.
 *
 * `status` is set back to `generating` here rather than left where it was: a
 * build whose stage failed goes back through `failGeneration`, which requeues a
 * digest as `scheduled` while keeping its progress — and a row that carries live
 * progress is a row whose build is in flight whatever its status says.
 */
async function writeGenerationProgress(
  db: Db,
  digestId: string,
  progress: GenerationProgress,
): Promise<boolean> {
  if (!progressColumnPresent) return false;
  const { error } = await db
    .from("digests")
    .update({
      status: "generating",
      generation_progress: {
        ...progress,
        ticks: progress.ticks + 1,
        heartbeatAt: new Date().toISOString(),
      },
    })
    .eq("digest_id", digestId);
  if (error) {
    if (missingProgressColumn(error.message)) {
      progressColumnPresent = false;
      return false;
    }
    throw new Error(`recording generation progress: ${error.message}`);
  }
  return true;
}

/**
 * Whether the database this tick read has 0119's column.
 *
 * Migrations in this project are applied by hand (`docs/database.md`), so the code
 * can be deployed before its migration is; a schema ahead of its code is harmless,
 * and the reverse must not be. `loadDue` asks for the whole row, so the row itself
 * answers the question: the column is there in what came back, or it is not. Set
 * false when it is not, and from then on this isolate builds a briefing exactly as
 * it did before the slice: one invocation, no cursor, and therefore killable —
 * slow, but never broken. A fresh isolate reads the row again, so the resume path
 * switches itself on as soon as the migration lands.
 *
 * Per-isolate and read from the row rather than probed: there is no schema cache to
 * invalidate, no extra query to pay for, and the only cost of being wrong in either
 * direction is that one isolate builds a briefing the old way once.
 */
let progressColumnPresent = true;

/** The database telling us 0119 has not been applied yet. */
function missingProgressColumn(message: string): boolean {
  return message.toLowerCase().includes("generation_progress");
}

/** The outcome a tick reports before it knows what became of the briefing. */
const outcomeOf = (due: DueRow): Omit<DigestOutcome, "decision" | "detail"> => ({
  userId: due.user_id,
  digestId: due.digest_id,
  scheduledFor: due.scheduled_for,
  items: 0,
  tokens: 0,
  sent: 0,
});

/**
 * Builds one reader's briefing, in bounded steps, across as many invocations as
 * it takes.
 *
 * ---------------------------------------------------------------------------
 * Why this is a state machine and not a function
 * ---------------------------------------------------------------------------
 *
 * A briefing used to be built by one invocation that did everything: rank the
 * reader's matches, drop the twins, gate every candidate through the readiness
 * check, compose the items and write them. Measured 2026-10-16, that costs about
 * 17.7 s of CPU on a reader with a thousand unbriefed matches, against a Workers
 * free-plan CPU budget whose observed success ceiling is ~710 ms. The build did
 * not fail — it was killed, every night, at the gate, and the reader received
 * nothing (six consecutive nights; see `decisions/reader-delivery.md`).
 *
 * So the build is cut at its own stage boundaries and each boundary is written
 * down: `select` ranks and freezes the snapshot, `screen` drops the twins,
 * `gate` decides a bounded number of briefs, `write` composes and stores the
 * items and queues the delivery. A tick advances as many stages as its budget
 * allows and leaves the rest to the next one, one minute later.
 *
 * ---------------------------------------------------------------------------
 * What resuming may not change
 * ---------------------------------------------------------------------------
 *
 * Every gate is the same code in the same order, over the same inputs: ranking
 * against the frozen snapshot instant, twin suppression over the same set, the
 * readiness gate on the same fields, the cap applied to the ready list before
 * the Q4 line gate, and `briefed_at` written only in the final stage, only for
 * stories this build actually decided about. A story the snapshot selected but
 * this build could not decide about — materially revised since the snapshot, or
 * unreadable — is recorded as withheld under its own kind and left unbriefed, so
 * it leads the next briefing instead of being lost.
 *
 * A full build of the same inputs therefore produces the same briefing the
 * single-tick build produced, which is what the resume tests assert.
 */
async function advanceGeneration(
  db: Db,
  due: DueRow,
  prefs: PrefRow,
  progress: GenerationProgress,
  options: DigestOptions,
  persist: boolean,
): Promise<DigestOutcome> {
  // Set false for two different reasons: a dry run writes nothing, so there is no
  // state for a later tick to resume from; and a database without 0119's column
  // cannot be resumed. Both mean the whole build happens in this invocation.
  let effectivePersist = persist;
  let state = progress;

  for (;;) {
    // The stage that is about to run. The tick boundary is asked about it rather
    // than about the state it leaves behind, because the boundary is a judgement
    // about the work just done.
    const running = state.stage;
    let step: StageStep;
    try {
      step = await generationStep(db, due, prefs, state, options);
    } catch (error) {
      if (persist !== true) throw error;
      // The failure is this tick's, not the build's: the progress stays where it
      // is and the next tick resumes at the same stage. `failGeneration` counts
      // it, and three of them is a build that is broken rather than unlucky.
      const detail = error instanceof Error ? error.message : String(error);
      const outcome = await failGeneration(db, due, `generation: ${detail}`, 0);
      return {
        ...outcomeOf(due),
        decision: outcome === "failed" ? "failed" : "deferred",
        detail: `generation: ${detail}`,
      };
    }

    if (step.kind === "done") return step.outcome;
    state = step.progress;

    if (effectivePersist !== true) continue;

    // Written after *every* stage, not only at the tick boundary: the boundary is
    // about how much one invocation may do, and a kill is not obliged to wait
    // for it. A tick that dies mid-build has still recorded every stage it
    // finished, so the next one resumes at the stage after it rather than losing
    // the whole tick's work.
    if ((await writeGenerationProgress(db, due.digest_id, state)) === false) {
      // No cursor to resume from — see `progressColumnPresent`. The briefing is
      // built here instead, in one invocation, which is what it was before the
      // slice. `effectivePersist` stays false for the rest of this build.
      effectivePersist = false;
      continue;
    }

    if (stageIsItsOwnTick(running, state)) {
      return { ...outcomeOf(due), decision: "deferred", detail: step.detail };
    }
  }
}

/**
 * Whether the stage that just ran looked at a set too large to share a tick.
 *
 * Asked of the state the stage produced, and by the set that stage walked: the
 * pool for selection, the considered set for screening, the queue for the gate.
 * "write" is never asked — it is the last stage, and the briefing is finished
 * when it returns.
 *
 * The gate is asked about the *queue*, not about its own chunk, because its
 * chunks are already bounded at `GATE_BRIEFS_PER_INVOCATION`: a queue inside the
 * limit means the whole gate fits in this tick and the briefing may as well be
 * finished in it, and a queue beyond it means one chunk a tick.
 */
function stageIsItsOwnTick(ran: GenerationStage, progress: GenerationProgress): boolean {
  switch (ran) {
    case "select":
      return progress.pool > TICK_SET_LIMIT;
    case "screen":
      return progress.candidates.length > TICK_SET_LIMIT;
    case "gate":
      return progress.queue.length > TICK_SET_LIMIT;
    case "write":
      return false;
  }
}

async function generationStep(
  db: Db,
  due: DueRow,
  prefs: PrefRow,
  progress: GenerationProgress,
  options: DigestOptions,
): Promise<StageStep> {
  switch (progress.stage) {
    case "select":
      return selectStage(db, due, prefs, progress, options);
    case "screen":
      return screenStage(db, due, progress);
    case "gate":
      return gateStage(db, due, progress);
    case "write":
      return writeStage(db, due, prefs, progress, options);
  }
}

/**
 * Stage 1 — the snapshot: who this briefing is about, in what order.
 *
 * Runs once per build. The instant it runs at is written into the progress, and
 * no later stage ranks anything, which is what makes the order a snapshot rather
 * than a moving target: relevance decays, the freshness bands move, and a build
 * that re-ranked between ticks could gate one set of stories and compose another.
 */
async function selectStage(
  db: Db,
  due: DueRow,
  prefs: PrefRow,
  progress: GenerationProgress,
  options: DigestOptions,
): Promise<StageStep> {
  const now = new Date(progress.snapshotAt);
  const plan = await planFor(db, due.user_id);
  const cap = capFor(prefs.density, plan);
  const matches = await loadMatches(db, due.user_id);
  const already = await alreadyBriefed(db, due.user_id);
  const ranked = selectItems(matches, already, matches.length, now, "daily");
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
    return {
      kind: "done",
      outcome: {
        ...outcomeOf(due),
        decision: "skipped",
        detail: "nothing matched since the last briefing",
      },
    };
  }

  return {
    kind: "continue",
    progress: {
      ...progress,
      stage: "screen",
      pool: matches.length,
      candidates: considered.map(candidateOf),
    },
    detail: `snapshot froze ${considered.length} candidates out of ${matches.length}`,
  };
}

/**
 * Stage 2 — twin suppression, once, over the whole considered set.
 *
 * Before this was a stage it shared a tick with selection, and the two together
 * cost about 2.1 s of CPU on a large pool: a tick of its own rather than a term
 * added to every tick that gates.
 */
async function screenStage(db: Db, due: DueRow, progress: GenerationProgress): Promise<StageStep> {
  const loaded = await loadBriefs(db, progress.candidates.map(matchRowOf));
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
  const kept = new Set(briefs.map((brief) => brief.eventId));
  // The queue is the twin survivors in snapshot order, which is what the gate
  // walks and what the cap is finally applied to.
  const queue = progress.candidates.filter((candidate) => kept.has(candidate.eventId));

  return {
    kind: "continue",
    progress: { ...progress, stage: "gate", queue, cursor: 0, verdicts: [] },
    detail: `${queue.length} of ${progress.candidates.length} stories survived twin suppression`,
  };
}

/**
 * Stage 3 — the readiness gate, a bounded number of briefs per invocation.
 *
 * Reader-readiness (readiness.ts) rejects only provably non-news shapes — empty
 * summaries, build numbers, commit messages, bylines, newsletter containers,
 * commerce posts — never short real news. It is also the most expensive thing
 * this stage does, which is why this loop is the one that is sliced.
 *
 * Withheld items are stamped `briefed_at` in the final stage alongside the
 * shipped ones, so a machine artifact does not resurface on every cycle; here
 * they are recorded as dispositions — the item count and the kinds — rather than
 * dropped.
 */
async function gateStage(db: Db, due: DueRow, progress: GenerationProgress): Promise<StageStep> {
  const chunk = progress.queue.slice(progress.cursor, progress.cursor + GATE_BRIEFS_PER_INVOCATION);
  const verdicts = [...progress.verdicts];

  const briefs = await loadBriefs(db, chunk.map(matchRowOf));
  const byId = new Map(briefs.map((brief) => [brief.eventId, brief] as const));
  // One read for the chunk, not one per candidate: this decides whether the
  // stories the snapshot froze are still the stories on the table.
  const revisions = await currentRevisions(
    db,
    due.user_id,
    chunk.map((candidate) => candidate.eventId),
  );

  for (const candidate of chunk) {
    const brief = byId.get(candidate.eventId);
    const revision = revisions.get(candidate.eventId);
    if (brief === undefined || revision === undefined || revision !== candidate.revision) {
      verdicts.push({ eventId: candidate.eventId, kind: CHANGED_KIND });
      continue;
    }
    const verdict = assessReadiness({
      title: brief.title,
      whatHappened: brief.whatHappened,
      sourceCount: brief.sourceCount,
      sources: brief.sources,
      sourceKinds: brief.sourceKinds,
      publishedAt: brief.publishedAt,
    });
    verdicts.push({
      eventId: candidate.eventId,
      kind: verdict.ready ? null : verdict.kind,
      ...(verdict.ready ? { opening: verdict.opening } : {}),
    });
  }

  const cursor = progress.cursor + chunk.length;
  return {
    kind: "continue",
    progress: {
      ...progress,
      stage: cursor >= progress.queue.length ? "write" : "gate",
      cursor,
      verdicts,
    },
    detail: `gated ${cursor} of ${progress.queue.length} stories`,
  };
}

/**
 * Stage 4 — the briefing: the cap, the shared lines, the stored artifact, and
 * the delivery.
 *
 * This is the single-tick build's tail, unchanged in what it decides: the cap
 * has the last word over the ready list, an item without a story-specific
 * why-line is withheld rather than filled (Q4, ruled 2026-10-12), the composed
 * summary artifact is written beside the item it belongs to (0118), `briefed_at`
 * is stamped here and only here, and the delivery is queued after `finish` — so
 * a briefing is dispatched the moment it is complete, even when that is a few
 * minutes after the slot it belongs to.
 */
async function writeStage(
  db: Db,
  due: DueRow,
  prefs: PrefRow,
  progress: GenerationProgress,
  options: DigestOptions,
): Promise<StageStep> {
  const base = outcomeOf(due);
  const plan = await planFor(db, due.user_id);
  const cap = capFor(prefs.density, plan);

  const verdictOf = new Map(progress.verdicts.map((v) => [v.eventId, v.kind] as const));
  /** The sentence each ready verdict's composition published (ruling #11). */
  const openingOf = new Map(
    progress.verdicts.flatMap((v) =>
      typeof v.opening === "string" && v.opening !== "" ? [[v.eventId, v.opening] as const] : [],
    ),
  );
  const ready: GenerationCandidate[] = [];
  const withheld: { eventId: string; kind: string }[] = [];
  for (const candidate of progress.queue) {
    const kind = verdictOf.get(candidate.eventId);
    // No verdict at all means the gate never reached this story — impossible on
    // a complete walk, and recorded rather than assumed away if it happens.
    if (kind === undefined) {
      withheld.push({ eventId: candidate.eventId, kind: CHANGED_KIND });
    } else if (kind === null) {
      ready.push(candidate);
    } else {
      withheld.push({ eventId: candidate.eventId, kind });
    }
  }
  // The twin drop and the gate both run after the cap, so the cap has the last
  // word: the reader asked for `cap` stories, never more.
  if (ready.length > cap) ready.splice(cap);

  // The gate decided each story against the revision the snapshot froze. A story
  // revised since then is a different story, and shipping it would put a line
  // composed from the new material under a `delivered_revision` that says old —
  // so it is dropped here, recorded, and left unbriefed to lead the next
  // briefing. One read for the whole ready set.
  const revisions = await currentRevisions(
    db,
    due.user_id,
    ready.map((candidate) => candidate.eventId),
  );
  const briefsById = new Map(
    (await loadBriefs(db, ready.map(matchRowOf))).map((brief) => [brief.eventId, brief] as const),
  );
  const carrying: EventBrief[] = [];
  // Stories this stage dropped for itself, as opposed to the ones the gate
  // already withheld. They are the ones whose verdict said *ready*, so the
  // stamping below has to be told about them separately or they would be marked
  // briefed here and never lead the next briefing.
  const dropped = new Set<string>();
  for (const candidate of ready) {
    const brief = briefsById.get(candidate.eventId);
    if (brief === undefined || revisions.get(candidate.eventId) !== candidate.revision) {
      withheld.push({ eventId: candidate.eventId, kind: CHANGED_KIND });
      dropped.add(candidate.eventId);
      continue;
    }
    carrying.push(brief);
  }
  let withheldNote = withheldNoteOf(withheld);

  if (carrying.length === 0 && progress.queue.length > 0) {
    if (options.dryRun !== true) {
      await finish(db, due.digest_id, "skipped", 0, 0, withheldNote);
      await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);
    }
    return {
      kind: "done",
      outcome: {
        ...base,
        decision: "skipped",
        detail: withheldNote
          ? `nothing reader-ready (${withheldNote})`
          : "nothing readable matched",
      },
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
  const impacts = await completedImpacts(db, carrying);

  const stored = new Map(impacts.map((item) => [item.eventId, item.text] as const));
  // The whole ladder from one call, over the event's own stored fields — see
  // inclusion.ts for the contract. No reader-specific inputs: a significance
  // line states a fact about the story, and the reader's own follow graph is
  // rendered separately, under `personalizationFor`.
  const byImpact = new Map(
    carrying.map((brief) => {
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

  // A story that passes readiness ships — **including one the ladder cannot
  // explain.** This reverses the Q4 gate of 2026-10-12, and the reason is a
  // ruling rather than a preference: on 2026-10-17 the owner ruled that nyuz is
  // not an AI product ("it should be pure code"), and the ladder's three
  // strongest rungs — the stored shared impact, the change, the after-state —
  // are written by the `analyse` pass. Under the code-first policy they are
  // therefore permanently empty: measured the same day, **0 of the reader's
  // 1,000 matches** had a stored impact and **0** had an after-state, leaving
  // only the money-consequence rung (0.7%), the figure rung and a coverage rung
  // that needs two outlets (2.7%). A gate that withholds every item the ladder
  // cannot explain withholds ~97% of a pure-code product's pool — that is what
  // took the reader's briefing from 25 stories to 1, and it would have taken it
  // to 0.
  //
  // Rung 6 is the honest shipping state, in the ladder's own words: "an empty
  // string, which `digest_items.why_it_matters` already defaults to and every
  // template already renders around — the email drops the whole line, the card
  // falls back to the reader's own follow explanation under its own heading".
  // So silence ships, and it is **counted** in the digest note rather than
  // withheld, so the disposition stays auditable and no signal is lost.
  const silentLines = carrying.filter(
    (brief) => !hasStorySpecificLine(byImpact.get(brief.eventId)),
  ).length;
  const shipping = carrying;
  withheldNote = withheldNoteOf(withheld);

  const unexplained = shipping.filter((brief) => !stored.get(brief.eventId)).length;
  // How many shipped cards carry no stored shared impact and are riding on a
  // derived rung. The "without a specific line" count is gone with the old
  // honesty-bar measurement: it measured exactly the items Q4 now withholds,
  // and a count of what cannot ship is a count of nothing.
  const enrichment =
    unexplained > 0
      ? `${unexplained} story${unexplained === 1 ? "" : "s"} using a derived inclusion line`
      : null;
  // The Q4 disposition, kept as a count now that it no longer withholds: a
  // briefing of silent cards is the pure-code normal, and the number is how a
  // reviewer sees the ladder's health without re-deriving it.
  const silentNote =
    silentLines > 0
      ? `${silentLines} story${silentLines === 1 ? "" : "s"} shipped with no story-specific line`
      : null;

  // Withholding can empty a briefing the readiness gate passed. That is the
  // quiet morning the ruling accepts — it takes the same path as a briefing
  // nothing was ready for.
  if (shipping.length === 0) {
    if (options.dryRun !== true) {
      await finish(
        db,
        due.digest_id,
        "skipped",
        0,
        0,
        noteOf(enrichment, silentNote, withheldNote),
      );
      await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);
    }
    return {
      kind: "done",
      outcome: {
        ...base,
        tokens,
        decision: "skipped",
        detail: `nothing passed the readiness gate (${withheldNote ?? ""})`,
      },
    };
  }

  if (options.dryRun === true) {
    return {
      kind: "done",
      outcome: {
        ...base,
        items: shipping.length,
        tokens,
        decision: "generated",
        detail:
          withheldNote !== null
            ? `${shipping.length} stories (dry run, ${withheldNote})`
            : `${shipping.length} stories (dry run)`,
      },
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
    ready.map((candidate) => [candidate.eventId, candidate.revision] as const),
  );
  // The delivered line -- the composed half of the arbiter's rulings, written
  // beside the item it belongs to (0118).
  //
  // The arbiter's ruling #11 (2026-10-18, option 2) is that the delivered
  // briefing card and email carry **the composer's own opening sentence**
  // whenever the composer publishes a deck: one authoritative sentence at the
  // point of delivery, so the card and the story page cannot open the same story
  // on different sentences. The sentence comes from the readiness gate, which
  // composed this story through the same path from the same inputs and admitted
  // it -- `openingOf` -- so nothing is composed here and the write stage pays
  // nothing for the contract. Composing here instead would cost 150-220 ms per
  // item on a stage that shares the free-plan 10 ms CPU budget per invocation
  // (`docs/decisions/cpu-killed-invocations.md`), and composing on the reader's
  // request path is ruled out for the same reason.
  //
  // When the composer published no deck -- a caller that did not compose, or a
  // story the gate never composed because coverage was not loaded -- the
  // artifact stays `null` and the read path resolves the item's own stored line,
  // guarded exactly as before. The recovery composition for a *refused* stored
  // line is kept for that case alone; the arbiter's boundary ("do not
  // manufacture a sentence") is honoured by never inventing text, and the raw
  // feed description is never substituted for a composed line.
  const rows = shipping.map((brief, position) => ({
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
      opening: openingOf.get(brief.eventId) ?? "",
    }),
  }));

  const { error } = await db
    .from("digest_items")
    .upsert(rows, { onConflict: "digest_id,event_id" });
  if (error) {
    const outcome = await failGeneration(db, due, `writing items: ${error.message}`, tokens);
    return {
      kind: "done",
      outcome: {
        ...base,
        tokens,
        decision: outcome === "failed" ? "failed" : "deferred",
        detail: `writing items: ${error.message}`,
      },
    };
  }

  // One statement per distinct revision rather than per event: almost every
  // briefing is all revision 0, and a briefing containing a material update is
  // one extra statement. The durable marker and the revision it refers to are
  // always written together.
  //
  // Stamped over every story the snapshot selected that this build actually
  // decided about — withheld included: the gate only withholds provable
  // non-news, so nothing here is a developing story waiting for corroboration,
  // and stamping keeps it from looping forever.
  //
  // `candidates`, not `shipping`: a story dropped as a twin shipped under the
  // event that kept its slot, and stamping it stops it returning tomorrow as a
  // different-looking duplicate. What is *not* stamped is a story this build
  // could not decide about — revised under the snapshot, or unreadable — which
  // stays unbriefed and leads the next briefing instead of disappearing.
  const briefedAt = new Date().toISOString();
  const byRevision = new Map<number, string[]>();
  for (const candidate of progress.candidates) {
    const kind = verdictOf.get(candidate.eventId);
    if (kind === undefined || kind === CHANGED_KIND || dropped.has(candidate.eventId)) continue;
    const bucket = byRevision.get(candidate.revision);
    if (bucket) bucket.push(candidate.eventId);
    else byRevision.set(candidate.revision, [candidate.eventId]);
  }
  for (const [revision, eventIds] of byRevision) {
    await db
      .from("user_events")
      .update({ briefed_at: briefedAt, delivered_revision: revision })
      .eq("user_id", due.user_id)
      .in("event_id", eventIds);
  }

  await finish(
    db,
    due.digest_id,
    "ready",
    shipping.length,
    tokens,
    noteOf(enrichment, silentNote, withheldNote),
  );
  await queueDeliveries(db, due.digest_id, due.user_id, prefs.channels);

  const notes = [enrichment, withheldNote].filter((note): note is string => note !== null);
  return {
    kind: "done",
    outcome: {
      ...base,
      items: shipping.length,
      tokens,
      decision: "generated",
      detail:
        notes.length > 0
          ? `${shipping.length} stories (${notes.join("; ")})`
          : `${shipping.length} stories`,
    },
  };
}

/**
 * `events.material_revision` for these candidates, as they stand now.
 *
 * The snapshot froze a revision per candidate and this is the read that notices
 * one moved. Deliberately the *event's* clock and nothing about the reader: a
 * story that was materially revised between two ticks is a different story from
 * the one the gate passed.
 */
async function currentRevisions(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (eventIds.length === 0) return found;
  const { data, error } = await db
    .from("user_events")
    .select("event_id, events ( material_revision )")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (error) throw new Error(`reading candidate revisions: ${error.message}`);
  for (const row of data ?? []) {
    const event = row.events as { material_revision?: number } | null;
    found.set(row.event_id, event?.material_revision ?? 0);
  }
  return found;
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

/**
 * The Q4 quality-gate disposition reason, one spelling everywhere. Exported for
 * the read-only instruments, which must name the same kind the digest row does.
 */
export const GATED_KIND = "missing_story_specific_why_it_matters";

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
      // The build is finished, so its cursor goes: a `ready` or `skipped` digest
      // that still carried one would be resumed by the next tick and build the
      // briefing a second time.
      ...(progressColumnPresent ? { generation_progress: null } : {}),
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
      // A requeued build keeps its cursor and resumes where it stopped; only a
      // build that is given up on loses it, and then only because the row can no
      // longer be resumed anyway.
      ...(exhausted && progressColumnPresent ? { generation_progress: null } : {}),
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
      // A closed slot has nothing left to resume: the stories are unbriefed and
      // lead the next briefing, which is what the failure reason says.
      ...(progressColumnPresent ? { generation_progress: null } : {}),
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
    .select("id, event_id, source_id, title, excerpt, url, sources ( name, kind )")
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
      // The article's own URL, for the paid-content rung: the lane a publisher
      // files under is the one thing the prose never says about itself.
      ...(row.url ? { url: row.url } : {}),
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
