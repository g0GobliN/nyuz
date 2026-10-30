/**
 * Freshness, as a product invariant rather than a sort order.
 *
 * ---------------------------------------------------------------------------
 * The failure this exists to make impossible
 * ---------------------------------------------------------------------------
 *
 * On 2026-09-08 a briefing led with a story from 1 September and carried items
 * from 25 August. Nothing was broken in the sense of throwing: every stage did
 * exactly what it was told. The digest ranked `relevance DESC, matched_at DESC`,
 * the analysis queue had no opinion about age at all, and a fortnight of
 * unbriefed matches had accumulated behind a stalled pipeline. So the highest
 * relevance rows won, and the highest relevance rows were two weeks old.
 *
 * A news product that does that is not a news product. "What is happening now"
 * is the entire proposition, and it cannot be an emergent property of a scoring
 * function that never mentions time — it has to be stated once, in one place,
 * and enforced by every queue that touches live news.
 *
 * ---------------------------------------------------------------------------
 * Why lanes rather than a decay term
 * ---------------------------------------------------------------------------
 *
 * The obvious fix is to multiply relevance by a decay and re-sort. That is here
 * (`recencyMultiplier`) and it is not enough on its own, because a decay is a
 * preference and the requirement is a guarantee. With a decay alone, a large
 * enough backlog of slightly-more-relevant stale rows still fills a briefing —
 * it just needs more of them. Partitioning into a priority lane and a backfill
 * lane makes "today first" structural: older material can only ever occupy the
 * slots today left empty, however much of it there is.
 *
 * The one exception is significance. A magnitude-7 earthquake from thirty hours
 * ago belongs in this morning's briefing even when there is fresh material to
 * fill it, so `SIGNIFICANT_IMPORTANCE` promotes genuinely large stories into the
 * priority lane rather than leaving them to the backfill they would never reach.
 *
 * Everything here is a pure function of numbers and timestamps. No model call,
 * no database, no per-reader classification — the ranking is arithmetic, and the
 * same arithmetic in a test as in a run.
 */

/**
 * ---------------------------------------------------------------------------
 * The bands
 * ---------------------------------------------------------------------------
 *
 * Every cadence has three of them, and the third is the one that carries the
 * product judgement:
 *
 *   primary      today. Ranked first, always eligible.
 *   allowed      recent. Ordinary material, decayed, may fill a briefing.
 *   exceptional  old. Only a genuinely significant story may reach back here.
 *
 * The `exceptional` band is not "allowed but ranked lower" — it is closed to
 * ordinary news. That is deliberate and it is the whole difference between a
 * briefing and a backlog: if someone reads nyuz every morning, an ordinary
 * article from two and a half days ago should not appear merely because today
 * was quiet. **Fourteen things worth knowing beats thirty padded with stale
 * material**, and a ranking that only ever sorts will always choose the thirty,
 * because it has no way to say "there simply is not more worth sending".
 *
 * So a short briefing is a correct briefing, and the density cap is a ceiling
 * rather than a target.
 */
export type FreshnessPolicy = {
  /** Today. Ranked first, always eligible. */
  primaryHours: number;
  /** Recent. Ordinary material, still eligible, decayed. */
  allowedHours: number;
  /** The hard ceiling. Between `allowedHours` and this, significance only. */
  maxHours: number;
};

/**
 * Breaking alerts. Out-of-schedule, so the bar is "is this happening".
 *
 * Twelve hours because an alert interrupts someone's day and its whole claim is
 * urgency; at half a day the next scheduled briefing is the honest channel. The
 * hard ceiling equals the allowed band, so there is no exceptional case at all —
 * an important old story is a briefing item, never an interruption.
 */
export const FLASH_POLICY: FreshnessPolicy = {
  primaryHours: 12,
  allowedHours: 24,
  maxHours: 24,
};

/**
 * The daily briefing.
 *
 * 24h primary because a reader on an 09:30 send has to be told about something
 * that broke at 20:00 yesterday. 48h allowed because a two-day-old story a
 * reader has not seen is still news to them.
 *
 * The normal ceiling is 48h. Past that, material is not "current" any more — it
 * is old enough that showing it would mean padding a thin day rather than serving
 * fresh news.
 *
 * The 72h backstop exists for exactly that case: a quiet day, with few enough
 * fresh items to leave real room, may reach back to 72h — and only for
 * significant stories. That is a different promise from freshness: not "this is
 * happening now", but "today was thin, and this is still worth knowing".
 */
export const DAILY_POLICY: FreshnessPolicy = {
  primaryHours: 24,
  allowedHours: 48,
  maxHours: 72,
};

/**
 * The weekly briefing.
 *
 * Eight days, not seven: a weekly briefing generated a few hours later than the
 * last one must still reach back to just before it, or the gap between two sends
 * silently drops whatever fell in it.
 *
 * `allowedHours === maxHours` on purpose, which leaves the exceptional band
 * empty. For a weekly reader everything since the last send IS the briefing —
 * a six-day-old story is not stale material padding a quiet day, it is the news
 * of their week — so there is nothing here for a significance gate to protect.
 * The decay still ranks the newest of it first.
 */
export const WEEKLY_POLICY: FreshnessPolicy = {
  primaryHours: 24,
  allowedHours: 8 * 24,
  maxHours: 8 * 24,
};

/** Kept as a name because the queues and the tests both reason about "today". */
export const FRESH_WINDOW_HOURS = DAILY_POLICY.primaryHours;
export const MAX_DAILY_AGE_HOURS = DAILY_POLICY.maxHours;
export const MAX_WEEKLY_AGE_HOURS = WEEKLY_POLICY.maxHours;

/**
 * Active work horizon for the current-news pipeline. This deliberately reuses
 * the daily policy's hard ceiling so the live pipeline and the reader face the
 * same news window.
 *
 * Records older than this remain historical data, but normal workers must not
 * select them as current work.
 */
export const ACTIVE_WORK_HORIZON_HOURS = MAX_DAILY_AGE_HOURS;

export function activeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVE_WORK_HORIZON_HOURS * 3_600_000);
}

export function isActiveWorkTimestamp(at: string | null, now: Date = new Date()): boolean {
  if (at === null) return false;
  const parsed = Date.parse(at);
  return !Number.isNaN(parsed) && parsed >= activeCutoff(now).getTime();
}

/**
 * Importance (0..10) at which a story may enter the exceptional band, and at
 * which an older story competes with today rather than waiting behind it.
 *
 * Eight is deliberately high. The bands are the guarantee; this is the escape
 * hatch, and an escape hatch that opens for ordinary news is just a wider door.
 */
export const SIGNIFICANT_IMPORTANCE = 8;

/**
 * The floor a decayed item can reach, at exactly the hard ceiling.
 *
 * Not zero, because an item at the ceiling is still worth more than an item
 * past it (which is excluded outright), and a multiplier that reached zero
 * would make the last hour before expiry indistinguishable from expired.
 */
const OLDEST_MULTIPLIER = 0.4;

/** Weight on shared significance, which is about the story, not the reader. */
const IMPORTANCE_WEIGHT = 0.35;

/** Weight on novelty — "we have not told you a version of this already". */
const NOVELTY_WEIGHT = 0.15;

/**
 * How much a candidate's relevance survives its age.
 *
 * Flat inside the primary band, then linear to `OLDEST_MULTIPLIER` at the hard
 * ceiling. Linear rather than exponential on purpose: an operator reading a
 * briefing has to be able to work out why item 4 beat item 5, and a half-life is
 * not something anyone does in their head.
 */
export function recencyMultiplier(ageHours: number, policy: FreshnessPolicy): number {
  if (ageHours <= policy.primaryHours) return 1;
  if (ageHours >= policy.maxHours) return OLDEST_MULTIPLIER;

  const span = policy.maxHours - policy.primaryHours;
  // A policy whose ceiling sits inside its own primary band is nonsense, but it
  // must not produce a nonsense score — treat everything past the band as fully
  // decayed rather than dividing by zero.
  if (span <= 0) return OLDEST_MULTIPLIER;

  const travelled = (ageHours - policy.primaryHours) / span;
  return 1 - travelled * (1 - OLDEST_MULTIPLIER);
}

/** The bands a reader's cadence buys them. */
export function policyFor(frequency: "daily" | "weekly"): FreshnessPolicy {
  return frequency === "weekly" ? WEEKLY_POLICY : DAILY_POLICY;
}

/**
 * The briefing score for a daily briefing that only reaches back to 72h when
 * the day is thin.
 *
 * This is the everyday call for the daily cadence: fresh first, recent material
 * only in the room fresh material left, and a 72h backstop that is both
 * significance-gated and thin-day-gated.
 *
 * Pass the fresh count so the backstop can actually stay closed on a non-thin
 * day. Without it, the thin-day rule is only a thin-day name, not a thin-day
 * gate.
 */
export function dailyBriefingScore(
  item: RankableItem,
  now: Date,
  thinThreshold = 6,
  freshCount = 0,
): number {
  return briefingScore(item, now, DAILY_POLICY, true, thinThreshold);
}

/**
 * Lane ranking for a daily briefing that only reaches back to 72h when the day
 * is thin.
 *
 * Pass the fresh count so the backstop can actually stay closed on a non-thin
 * day. Without it, the thin-day rule is only a thin-day name, not a thin-day
 * gate.
 */
export function rankDailyBriefing<T extends RankableItem>(
  items: readonly T[],
  now: Date,
  thinThreshold = 6,
  freshCount = 0,
): LaneSplit<T> {
  return rankIntoLanes(items, now, DAILY_POLICY, true, thinThreshold, freshCount);
}

/**
 * A RankableItem built from a digest MatchRow for the daily freshness pipeline.
 * The daily briefing cares about the canonical event clock, not the match clock.
 */
export function rankableFromMatch(row: {
  relevance: number;
  importance: number;
  novelty: number;
  eventAt: string | null;
}): RankableItem {
  return {
    relevance: row.relevance,
    importance: row.importance,
    novelty: row.novelty,
    eventAt: row.eventAt,
  };
}

/** Hours between two instants, floored at zero so a clock skew cannot boost. */
export function ageHours(at: string | null, now: Date): number {
  if (at === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - parsed) / 3_600_000);
}

export type RankableItem = {
  /** How much this reader cares, from stage 5. Higher is better. */
  relevance: number;
  /** 0..10 shared significance. */
  importance: number;
  /** 0..10 shared novelty. */
  novelty: number;
  /** When the world saw this, not when we matched it. */
  eventAt: string | null;
};

/**
 * Which band an item falls in, on age alone.
 *
 * Age only — significance is a separate question, asked by `isEligible`. Keeping
 * them apart is what lets the report say "refused: two days old and not big
 * enough" rather than the single undifferentiated "expired" that a combined
 * predicate would produce.
 */
export type FreshnessBand = "primary" | "allowed" | "exceptional" | "expired";

export function bandFor(item: RankableItem, now: Date, policy: FreshnessPolicy): FreshnessBand {
  const age = ageHours(item.eventAt, now);
  if (age <= policy.primaryHours) return "primary";
  if (age <= policy.allowedHours) return "allowed";
  if (age <= policy.maxHours) return "exceptional";
  return "expired";
}

/**
 * Whether an item may appear at all.
 *
 * The exceptional band is the only place significance is consulted, and it is
 * the rule that keeps a quiet day short instead of padded: an ordinary story
 * from two and a half days ago is refused even when the density cap has room
 * for thirty more.
 *
 * The exceptional band is still not automatic. For the daily cadence it only
 * opens when the day is thin, because otherwise 72h would stop being a
 * quiet-day backstop and become a normal third band. Thinness is a fresh-item
 * count: if the briefing already has enough fresh material, the backstop stays
 * closed.
 */
export function isEligible(
  item: RankableItem,
  now: Date,
  policy: FreshnessPolicy,
  /**
   * For the daily cadence: the exceptional band is available only when the fresh
   * material available for this briefing has not already filled it. Weekly
   * briefings ignore this, because for them the whole lookback is the briefing.
   */
  exceptionalOnlyWhenThin = false,
  /**
   * How few fresh items justify reaching back. Passed in so the caller decides
   * what "thin" means instead of hiding it here.
   */
  thinThreshold = 6,
  /**
   * How many fresh items are already available for this briefing. Only used when
   * `exceptionalOnlyWhenThin` is on.
   */
  freshCount = 0,
): boolean {
  const band = bandFor(item, now, policy);
  if (band === "expired") return false;
  if (band !== "exceptional") return true;
  if (!exceptionalOnlyWhenThin) return item.importance >= SIGNIFICANT_IMPORTANCE;
  return item.importance >= SIGNIFICANT_IMPORTANCE && freshCount < thinThreshold;
}

/**
 * The deterministic briefing score.
 *
 * Relevance decayed by age, plus a small shared-signal term. The shared term is
 * small on purpose: it breaks ties between comparably relevant stories and
 * nudges a big story up a place or two, but it must never be able to overturn
 * the reader's own interests — a reader who follows Formula 1 and not politics
 * does not want an important election above their race, and `importance` is
 * exactly the number that would do that if it were weighted freely.
 */
export function briefingScore(
  item: RankableItem,
  now: Date,
  policy: FreshnessPolicy,
  exceptionalOnlyWhenThin = false,
  thinThreshold = 6,
): number {
  // An ineligible item does not score low, it does not score. Returning a finite
  // number here would let a caller that ranks without `rankIntoLanes` quietly
  // re-admit exactly the stale material the bands exist to refuse, which is the
  // class of bug this whole module is a response to.
  if (!isEligible(item, now, policy, exceptionalOnlyWhenThin, thinThreshold))
    return Number.NEGATIVE_INFINITY;

  const decayed = item.relevance * recencyMultiplier(ageHours(item.eventAt, now), policy);
  const significance = IMPORTANCE_WEIGHT * (item.importance / 10);
  const novelty = NOVELTY_WEIGHT * (item.novelty / 10);
  return decayed + significance + novelty;
}

/**
 * The priority lane: today, plus anything big enough to belong beside today.
 *
 * An item with no usable date is neither fresh nor significant — `ageHours`
 * returns Infinity for one, so it lands in `expired` and never reaches a lane at
 * all. That is the safe reading: a story we cannot date is a story we cannot
 * promise is current.
 *
 * Significance may promote a recent story into the priority lane, but it may not
 * extend the daily window. A major story that is already past the ceiling is
 * still refused, so the priority lane is bounded by the same horizon as every
 * other lane.
 */
export function isPriority(item: RankableItem, now: Date, policy: FreshnessPolicy): boolean {
  if (bandFor(item, now, policy) === "primary") return true;
  if (bandFor(item, now, policy) === "expired") return false;
  return item.importance >= SIGNIFICANT_IMPORTANCE;
}

export type LaneSplit<T> = { priority: T[]; backfill: T[] };

/**
 * Rank a reader's candidates into the two lanes, each sorted by score.
 *
 * Ineligible items are gone before either lane sees them, so a caller that
 * concatenates `priority` then `backfill` and slices to a cap gets the whole
 * policy: today first, recent material only in the room today left, nothing
 * older unless the day is thin and the story is significant, and a short list
 * when that is all there honestly is.
 *
 * The `exceptionalOnlyWhenThin` flag is what makes 72h a quiet-day backstop
 * instead of a normal third band for the daily cadence. When that flag is on,
 * the caller must also pass the fresh count, because the backstop is not a
 * calendar band — it is a "not enough fresh material yet" band.
 */
export function rankIntoLanes<T extends RankableItem>(
  items: readonly T[],
  now: Date,
  policy: FreshnessPolicy,
  exceptionalOnlyWhenThin = false,
  thinThreshold = 6,
  freshCount = 0,
): LaneSplit<T> {
  const priority: T[] = [];
  const backfill: T[] = [];

  for (const item of items) {
    if (!isEligible(item, now, policy, exceptionalOnlyWhenThin, thinThreshold, freshCount))
      continue;
    (isPriority(item, now, policy) ? priority : backfill).push(item);
  }

  // Score descending, then age ascending as the tie-break. Two items a reader
  // cares about equally are ordered by which one is newer, which is the only
  // answer a news product can defend.
  const byScore = (a: T, b: T): number =>
    briefingScore(b, now, policy) - briefingScore(a, now, policy) ||
    ageHours(a.eventAt, now) - ageHours(b.eventAt, now);

  priority.sort(byScore);
  backfill.sort(byScore);
  return { priority, backfill };
}

/* ------------------------------------------------------------------------- */
/* Queue freshness — the same invariant, one stage earlier                    */
/* ------------------------------------------------------------------------- */

/**
 * The window the analysis queue treats as live news.
 *
 * This is the same horizon the daily briefing uses, because the queue that feeds
 * the briefing should not keep working material the briefing will not show. There
 * is still a separate backlog lane for older work, so narrowing this does not strand
 * history — it only stops live workers from treating old rows as current.
 */
export const LIVE_QUEUE_HOURS = ACTIVE_WORK_HORIZON_HOURS;

/**
 * The share of each analysis batch reserved for live news.
 *
 * Five in six rather than everything, because a queue that only ever looks at
 * the last two days can never finish a backlog — the 1,392 pending events from
 * August would sit there permanently, and any future incident that stalls the
 * pipeline for three days would strand its own backlog the same way. One slot
 * in six drains history at a bounded rate that today's news cannot notice.
 *
 * The split is expressed as a numerator and denominator rather than a
 * percentage so the SQL and the tests can agree exactly on the integer maths.
 */
export const LIVE_LANE_NUMERATOR = 5;
export const LIVE_LANE_DENOMINATOR = 6;

/** How many of a batch of `limit` go to the live lane. At least one. */
export function liveLaneSize(limit: number): number {
  if (limit <= 1) return Math.max(0, limit);
  return Math.max(1, Math.floor((limit * LIVE_LANE_NUMERATOR) / LIVE_LANE_DENOMINATOR));
}

/** How many of a batch of `limit` go to the backlog lane. May be zero. */
export function backlogLaneSize(limit: number): number {
  return Math.max(0, limit - liveLaneSize(limit));
}

/* ------------------------------------------------------------------------- */
/* Candidate expiry                                                           */
/* ------------------------------------------------------------------------- */

/**
 * When an unbriefed match stops being a briefing candidate.
 *
 * Ten days rather than the eight-day weekly ceiling, so expiry can never be the
 * thing that removes a row a weekly briefing was still entitled to pick. The two
 * numbers do the same job at different distances: the ceiling decides what a
 * briefing may show, expiry stops the table growing a permanent tail of rows no
 * briefing will ever show again.
 *
 * Expiry marks; it never deletes. `user_events` is the record of what reached
 * whom, and analytics, dedupe and the reader's own history all read it.
 */
export const CANDIDATE_EXPIRY_DAYS = 10;
