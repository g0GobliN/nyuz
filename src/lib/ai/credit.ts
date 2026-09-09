import { MICROUSD_PER_USD } from "@/lib/ai/budget";

/**
 * Estimated provider credit from manually recorded top-ups and ledger spend.
 *
 * The provider is paid in one-off top-ups, so the question an operator actually
 * has is "how many days until I have to recharge", and that question has three
 * inputs: what went in, what has come out since, and how fast it is leaving.
 * Only the third is a rate, and rates are where a cost display usually starts
 * lying — so the burn rate here is refused rather than guessed whenever the
 * measured window is too short to mean anything.
 *
 * Separate from `budget.ts` because that file holds the monthly *ceiling*,
 * which resets on the 1st. A balance does not reset. Conflating them is the
 * mistake this module exists to keep out of the console.
 */

/** Under an hour of history extrapolated to a day is noise, not a forecast. */
const MIN_MEASURED_MS = 3_600_000;

/** Burn is measured over the trailing week; longer averages react too slowly. */
const BURN_WINDOW_MS = 7 * 86_400_000;

/** Below this share of everything deposited, the balance is called low. */
const LOW_FRACTION = 0.2;

/** A recharge that has to happen sooner than this is worth warning about. */
const LOW_DAYS = 7;

export type AiCreditInput = {
  toppedUpMicrousd: number;
  topups: number;
  firstTopupAt: string | null;
  lastTopupAt: string | null;
  lastTopupMicrousd: number;
  spentMicrousd: number;
  settledMicrousd: number;
  inFlightMicrousd: number;
  unfundedSpentMicrousd: number;
  calls: number;
  unpricedCalls: number;
  /** Spend over the trailing 7 days, from `ai_spend_windows()`. */
  weekSpentMicrousd: number | null;
  now: Date;
};

export type AiCreditStatus = "unrecorded" | "ok" | "low" | "exhausted";

export type AiCredit = {
  toppedUpUsd: number;
  topups: number;
  firstTopupAt: string | null;
  lastTopupAt: string | null;
  lastTopupUsd: number;
  spentUsd: number;
  settledUsd: number;
  inFlightUsd: number;
  remainingUsd: number;
  usedPct: number;
  /** Spend that predates the first recorded top-up. Excluded from the balance. */
  unfundedSpentUsd: number;
  calls: number;
  unpricedCalls: number;
  /** Null when there is not yet an hour of measured history to divide by. */
  burnUsdPerDay: number | null;
  /** Null when burn is unknown, or when nothing is being spent. */
  daysRemaining: number | null;
  runsOutAt: string | null;
  status: AiCreditStatus;
};

export function computeAiCredit(input: AiCreditInput): AiCredit {
  const toppedUpUsd = usd(input.toppedUpMicrousd);
  const spentUsd = usd(input.spentMicrousd);
  const remainingUsd = toppedUpUsd - spentUsd;

  // For a younger balance, attributable lifetime spend covers the entire window
  // without importing pre-top-up spend into a shorter denominator.
  const firstAt = input.firstTopupAt ? new Date(input.firstTopupAt).getTime() : null;
  const sinceFirstMs =
    firstAt === null || !Number.isFinite(firstAt) ? 0 : input.now.getTime() - firstAt;
  const measuredMs = Math.min(BURN_WINDOW_MS, Math.max(0, sinceFirstMs));
  const measuredSpend =
    sinceFirstMs < BURN_WINDOW_MS ? input.spentMicrousd : input.weekSpentMicrousd;
  const burnUsdPerDay =
    measuredMs >= MIN_MEASURED_MS && measuredSpend !== null
      ? (usd(measuredSpend) / measuredMs) * 86_400_000
      : null;

  const draining = burnUsdPerDay !== null && burnUsdPerDay > 0;
  const daysRemaining = draining ? Math.max(0, remainingUsd) / burnUsdPerDay : null;
  const runsOutAt =
    daysRemaining === null
      ? null
      : new Date(input.now.getTime() + daysRemaining * 86_400_000).toISOString();

  return {
    toppedUpUsd,
    topups: input.topups,
    firstTopupAt: input.firstTopupAt,
    lastTopupAt: input.lastTopupAt,
    lastTopupUsd: usd(input.lastTopupMicrousd),
    spentUsd,
    settledUsd: usd(input.settledMicrousd),
    inFlightUsd: usd(input.inFlightMicrousd),
    remainingUsd,
    usedPct: toppedUpUsd > 0 ? (spentUsd / toppedUpUsd) * 100 : 0,
    unfundedSpentUsd: usd(input.unfundedSpentMicrousd),
    calls: input.calls,
    unpricedCalls: input.unpricedCalls,
    burnUsdPerDay,
    daysRemaining,
    runsOutAt,
    status: statusOf(input.topups, remainingUsd, toppedUpUsd, daysRemaining),
  };
}

function usd(microusd: number): number {
  return microusd / MICROUSD_PER_USD;
}

/**
 * No top-ups recorded is `unrecorded`, never `exhausted`.
 *
 * The two are indistinguishable in the arithmetic — both are a zero balance —
 * and telling an operator their credit has run out because they have not typed
 * anything in yet is the kind of false alarm that teaches people to ignore the
 * real one.
 */
function statusOf(
  topups: number,
  remainingUsd: number,
  toppedUpUsd: number,
  daysRemaining: number | null,
): AiCreditStatus {
  if (topups === 0) return "unrecorded";
  if (remainingUsd <= 0) return "exhausted";
  const nearlyGone = toppedUpUsd > 0 && remainingUsd <= toppedUpUsd * LOW_FRACTION;
  const soon = daysRemaining !== null && daysRemaining <= LOW_DAYS;
  return nearlyGone || soon ? "low" : "ok";
}

export const SPEND_WINDOW_KEYS = ["hour", "day", "week", "month"] as const;
export type SpendWindowKey = (typeof SPEND_WINDOW_KEYS)[number];

export type SpendWindow = {
  key: SpendWindowKey;
  since: string;
  spentUsd: number;
  settledUsd: number;
  inFlightUsd: number;
  tokens: number;
  calls: number;
};

export const SPEND_WINDOW_LABELS: Record<SpendWindowKey, string> = {
  hour: "Last hour",
  day: "Last 24 hours",
  week: "Last 7 days",
  month: "Last 30 days",
};
