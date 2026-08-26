import type { PlanTier } from "@/lib/supabase/types";

/**
 * Stripe product catalogue (live, 23 Aug 2026). Display, checkout copy and
 * revenue arithmetic all read these — not the admin override, which can only
 * drift from what Stripe actually charges.
 *
 *   nyuz personal         US$7.00 / month
 *   nyuz personal annual  US$69.00 / year
 *   nyuz pro              US$15.00 / month
 *   nyuz pro annual       US$149.00 / year
 */
export const DEFAULT_PLAN_PRICES: Record<PlanTier, number> = {
  free: 0,
  personal: 7,
  pro: 15,
};

/**
 * Annual totals. A little over two months free against twelve months of the
 * monthly price — Personal saves $15 on $84, Pro saves $31 on $180.
 *
 * The pricing page derives the saving from these numbers rather than printing a
 * fixed claim, so changing them here changes the copy with them.
 */
export const DEFAULT_ANNUAL_PRICES: Record<Exclude<PlanTier, "free">, number> = {
  personal: 69,
  pro: 149,
};

/** "$7.00" — the same two-decimal form Stripe shows. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export const PLAN_TIERS: PlanTier[] = ["free", "personal", "pro"];

export type DensityBand = "minimal" | "focused" | "broad" | "deep";
export type PlanModel = "flash" | "pro";
export type AlertAccess = "none" | "important" | "configurable";

export type PlanLimits = {
  topics: number;
  prioritySources: number;
  retention: string;
  retentionDays: number;
  asksPerDay: number;
  askModel: PlanModel | null;
  digestModel: PlanModel;
  storyCaps: Record<DensityBand, number>;
  alerts: AlertAccess;
  alertWeeklyCap: number;
  alertDailyCap: number;
  inactivePauseDays: number | null;
  monthlyAiTokenCap: number;
};

/**
 * What each plan actually allows.
 *
 * One table, because these numbers decide two different things in two different
 * places: what the billing page advertises, and what the topics page lets a
 * reader do. They were only ever written down on the billing page, which is why
 * somebody could pick eight topics on the Free plan and not discover until they
 * opened billing that five of them were inert.
 *
 * `Infinity` rather than a large number or null: it compares correctly against a
 * count without any caller special-casing "unlimited", and it formats to
 * something obviously wrong if one ever forgets to.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    topics: 3,
    prioritySources: 3,
    retention: "7-day history",
    retentionDays: 7,
    asksPerDay: 0,
    askModel: null,
    digestModel: "flash",
    storyCaps: { minimal: 3, focused: 6, broad: 10, deep: 18 },
    alerts: "none",
    alertWeeklyCap: 0,
    alertDailyCap: 0,
    inactivePauseDays: 30,
    monthlyAiTokenCap: 400_000,
  },
  personal: {
    topics: 15,
    prioritySources: 15,
    retention: "90-day history",
    retentionDays: 90,
    asksPerDay: 10,
    askModel: "flash",
    digestModel: "pro",
    storyCaps: { minimal: 5, focused: 10, broad: 18, deep: 30 },
    alerts: "important",
    alertWeeklyCap: 3,
    alertDailyCap: 0,
    inactivePauseDays: null,
    monthlyAiTokenCap: 1_500_000,
  },
  pro: {
    topics: Infinity,
    prioritySources: Infinity,
    retention: "1-year history",
    retentionDays: 365,
    asksPerDay: 15,
    askModel: "pro",
    digestModel: "pro",
    storyCaps: { minimal: 8, focused: 16, broad: 30, deep: 50 },
    alerts: "configurable",
    alertWeeklyCap: 0,
    alertDailyCap: 10,
    inactivePauseDays: null,
    monthlyAiTokenCap: 4_000_000,
  },
};

/** The AI route used by a plan. `cluster` is the high-volume Flash route. */
export function askCapabilityFor(model: PlanModel | null): "cluster" | "reason" | null {
  if (model === null) return null;
  return model === "flash" ? "cluster" : "reason";
}

export function digestCapabilityFor(model: PlanModel): "cluster" | "digest" {
  return model === "flash" ? "cluster" : "digest";
}

/** Clamp a saved alert preference to what the current subscription can deliver. */
export function allowedBreaking<T extends "important" | "everything" | "off">(
  plan: PlanTier,
  requested: T,
): T | "important" | "off" {
  const access = PLAN_LIMITS[plan]?.alerts ?? "none";
  if (access === "none") return "off";
  if (access === "important" && requested === "everything") return "important";
  return requested;
}

/** Quiet gap so a loop cannot drain the reason tier. Follow-ups should still feel instant. */
export const ASK_COOLDOWN_MS = 8_000;

/** Reasoning plus a short answer. The route default is far larger than Ask needs. */
export const ASK_MAX_TOKENS = 4096;

export type AskDecision =
  { ok: true } | { ok: false; reason: "disabled" | "plan" | "quota" | "cooldown" };

/**
 * Whether this Ask is allowed. Pure, so the cap can be tested without a model.
 *
 * `flagOn` is fail-closed: missing or false both refuse. Free has a zero cap,
 * which is the same as "not on this plan" rather than a quota message.
 */
export function decideAsk(input: {
  flagOn: boolean | null;
  plan: PlanTier;
  usedToday: number;
  lastAt: Date | null;
  now: Date;
}): AskDecision {
  if (input.flagOn !== true) return { ok: false, reason: "disabled" };
  const cap = PLAN_LIMITS[input.plan]?.asksPerDay ?? 0;
  if (cap <= 0) return { ok: false, reason: "plan" };
  if (input.usedToday >= cap) return { ok: false, reason: "quota" };
  if (input.lastAt && input.now.getTime() - input.lastAt.getTime() < ASK_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true };
}

/** First `limit` items. `Infinity` means the whole list. */
export function clipLabels<T>(labels: T[], limit: number): T[] {
  if (!Number.isFinite(limit)) return labels;
  return labels.slice(0, Math.max(0, limit));
}

/** "3" or "unlimited" — never the literal Infinity. */
export function formatTopicLimit(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : "unlimited";
}

/** The next plan up, or null at the top. What an upgrade prompt offers. */
export function nextPlanUp(plan: PlanTier): PlanTier | null {
  const index = PLAN_TIERS.indexOf(plan);
  return index >= 0 && index < PLAN_TIERS.length - 1 ? (PLAN_TIERS[index + 1] ?? null) : null;
}

export const PLAN_NAMES: Record<PlanTier, string> = {
  free: "Free",
  personal: "Personal",
  pro: "Pro",
};

/**
 * Reads a stored override, ignoring anything malformed rather than throwing.
 * A bad row here would take down the whole overview page, and a wrong MRR
 * figure is less damaging than no page at all — but it is still wrong, so the
 * caller is told whether an override was applied.
 */
export function resolvePlanPrices(stored: unknown): {
  prices: Record<PlanTier, number>;
  overridden: boolean;
} {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return { prices: DEFAULT_PLAN_PRICES, overridden: false };
  }

  const record = stored as Record<string, unknown>;
  const prices = { ...DEFAULT_PLAN_PRICES };
  let overridden = false;

  for (const tier of PLAN_TIERS) {
    const value = record[tier];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      prices[tier] = value;
      overridden = true;
    }
  }

  return { prices, overridden };
}
