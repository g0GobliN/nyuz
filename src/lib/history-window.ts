import { PLAN_LIMITS, PLAN_NAMES, PLAN_TIERS } from "@/lib/plans";
import type { PlanTier } from "@/lib/supabase/types";

/**
 * History entitlement, expressed as dates and labels.
 *
 * ---------------------------------------------------------------------------
 * What this file is and is not
 * ---------------------------------------------------------------------------
 *
 * It is NOT the access boundary. Nothing here decides what a reader may open —
 * that is `history_window_start()` in 0067, applied by the digests policy and
 * by every server function that touches personal history. A number computed in
 * a browser bundle can never be an entitlement.
 *
 * What it does is turn the date metadata the database hands back into the words
 * on the History page: whether a month is fully readable, partly readable or
 * locked, and — for a locked one — which plan would genuinely bring it back.
 * Presentation, derived from facts, with no access decision anywhere in it.
 *
 * ---------------------------------------------------------------------------
 * Exact dates, never month names
 * ---------------------------------------------------------------------------
 *
 * A 90-day window lands in the middle of a month far more often than it lands
 * on the first of one. So a month is never classified by its name or by its
 * position in a list; every judgement below comes from comparing a real
 * timestamp against a real window. June can be half readable, and the page has
 * to be able to say so rather than rounding it to a lie in either direction.
 */

/**
 * How long a downgraded reader's older history survives before it is deleted.
 *
 * Thirty days is the product decision (docs/history-retention.md): long enough
 * that cancelling by accident, or on the wrong month, is recoverable by
 * re-subscribing, and short enough that the storage it holds open is a rounding
 * error. It is stated here and in `apply_history_grace()`; the trigger is the
 * one that enforces it.
 */
export const HISTORY_GRACE_DAYS = 30;

export type MonthState = "available" | "partially_available" | "locked";

/** What `history_months()` returns for one month, before any labelling. */
export type MonthFacts = {
  monthKey: string;
  /** Briefings in this month the reader may still open. */
  available: number;
  /** Newest retained-but-unreadable briefing, or null if none. */
  lockedNewestAt: string | null;
  /** Oldest retained-but-unreadable briefing, or null if none. */
  lockedOldestAt: string | null;
};

export type HistoryMonth = {
  key: string;
  label: string;
  state: MonthState;
  /** Readable briefings. Deliberately not a count of the locked ones. */
  count: number;
  /**
   * The cheapest plan whose window reaches any of this month's locked days, or
   * null when nothing on sale reaches them.
   */
  restorePlan: PlanTier | null;
  /** True when `restorePlan` reaches only part of what is locked here. */
  restorePartial: boolean;
};

/** The window a plan entitles, in days. Display copy reads the same table. */
export function retentionDaysFor(plan: PlanTier): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno).retentionDays;
}

/** Whole and fractional days between `at` and `now`. Negative for the future. */
export function ageInDays(at: string | Date, now: Date): number {
  const then = at instanceof Date ? at.getTime() : Date.parse(at);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/**
 * The cheapest plan that could read something of this age, or null if none can.
 *
 * `>=` rather than `>`: a row exactly 90.0 days old is inside a 90-day window,
 * which is the same comparison `history_window_start` makes in SQL. The two
 * must agree, or the page offers an upgrade that would not actually work.
 *
 * Null is not a bug. Beyond 365 days nothing is readable on any plan, and the
 * honest answer is to offer no plan rather than the most expensive one.
 */
export function planForAgeDays(ageDays: number): PlanTier | null {
  for (const tier of PLAN_TIERS) {
    if (retentionDaysFor(tier) >= ageDays) return tier;
  }
  return null;
}

/** "2026-09" → "September 2026". */
export function monthLabel(key: string, locale?: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "nyuz Plura" → "Plura", for inline copy like "Restore with Plura". */
export function shortPlanName(plan: PlanTier): string {
  return (PLAN_NAMES[plan] ?? plan).replace(/^nyuz\s+/i, "");
}

/**
 * One month's facts, turned into what the page says about it.
 *
 * The restore plan is derived from the NEWEST locked day, because that is the
 * first one any upgrade would recover — offering the plan that covers the
 * oldest day instead would push everyone to Omni for a month whose first week
 * Plura already reaches. When the chosen plan does not also reach the oldest
 * locked day, `restorePartial` says so, and the page says "restores part of
 * this month" rather than implying the whole of it comes back.
 */
export function describeMonth(facts: MonthFacts, now: Date, locale?: string): HistoryMonth {
  const hasLocked = facts.lockedNewestAt !== null;
  const state: MonthState =
    facts.available === 0 ? "locked" : hasLocked ? "partially_available" : "available";

  let restorePlan: PlanTier | null = null;
  let restorePartial = false;

  if (facts.lockedNewestAt) {
    restorePlan = planForAgeDays(ageInDays(facts.lockedNewestAt, now));
    if (restorePlan && facts.lockedOldestAt) {
      restorePartial = retentionDaysFor(restorePlan) < ageInDays(facts.lockedOldestAt, now);
    }
  }

  return {
    key: facts.monthKey,
    label: monthLabel(facts.monthKey, locale),
    state,
    count: facts.available,
    restorePlan,
    restorePartial,
  };
}

/**
 * Which month the page should open on.
 *
 * The newest month with something readable in it, so a reader who downgraded
 * yesterday lands on the days they still have rather than on a locked wall.
 * Falls back to the newest month of any kind, then to nothing at all.
 */
export function defaultMonthKey(months: HistoryMonth[]): string | null {
  return months.find((m) => m.count > 0)?.key ?? months[0]?.key ?? null;
}
