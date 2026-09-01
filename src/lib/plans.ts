import type { PlanTier } from "@/lib/supabase/types";

/**
 * Stripe product catalogue. Display, checkout copy and revenue arithmetic all
 * read these — not the admin override, which can only drift from what Stripe
 * actually charges.
 *
 *   nyuz personal         US$14.99 / month
 *   nyuz personal annual  US$149.90 / year
 *   nyuz pro              US$29.99 / month
 *   nyuz pro annual       US$299.90 / year
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE NUMBERS ARE DISPLAY ONLY. THE CHARGE IS THE STRIPE PRICE OBJECT.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Raising the figures here raises what the pricing page *says*. What a customer
 * is actually billed is the Price object identified by `STRIPE_PRICE_*` in
 * src/lib/server/stripe/prices.ts, and Stripe prices are immutable — a
 * repricing is new Price objects, never an edit to the existing ones.
 *
 * So this table is only true once, in the Stripe account:
 *
 *   1. New prices exist at $14.99/$149.90 and $29.99/$299.90.
 *   2. `STRIPE_PRICE_PERSONAL_MONTHLY` and its three siblings point at them.
 *   3. The previous ids ($7/$69, $15/$149) have been moved to the matching
 *      `*_LEGACY` variables, so existing subscribers keep billing against the
 *      price they signed up on and nobody is repriced without agreeing to it.
 *
 * Miss step 3 and every current subscriber's next webhook resolves to no plan
 * and silently loses their entitlements. Miss step 2 and the page advertises
 * $14.99 while checkout charges $7 — the disagreement between the page and the
 * invoice that this whole module exists to prevent.
 *
 * Targets come from docs/plan2.md §55–56. §57's $39 Intelligence tier is
 * deliberately not here: that section says not to expose it at launch.
 */
export const DEFAULT_PLAN_PRICES: Record<PlanTier, number> = {
  free: 0,
  personal: 14.99,
  pro: 29.99,
};

/**
 * Annual totals. Exactly two months free against twelve months of the monthly
 * price — Personal saves $29.98, Pro saves $59.98.
 *
 * The pricing page derives the saving from these numbers rather than printing a
 * fixed claim, so changing them here changes the copy with them.
 */
export const DEFAULT_ANNUAL_PRICES: Record<Exclude<PlanTier, "free">, number> = {
  personal: 149.9,
  pro: 299.9,
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
  /**
   * Sources this plan may ask nyuz to monitor on its behalf (plan2 §62).
   * Enforced in the database by `claim_custom_source`, not here — a number
   * in a bundle a browser can read is a display value, never a guard.
   */
  customSources: number;
  retention: string;
  retentionDays: number;
  asksPerDay: number;
  askModel: PlanModel | null;
  /**
   * Vestigial, and kept only so the tier table stays readable beside `askModel`.
   *
   * It described a per-reader digest call that no longer exists: `digest.ts`
   * assembles `why_it_matters` from the shared `event_impacts` written once per
   * event, so no model call scales with reader count and there is nothing left
   * for a per-plan model to select. `digestCapabilityFor` has no production
   * caller for the same reason.
   *
   * Deliberately flagged rather than deleted, because the misreading it invites
   * is a costly one: it looks like free readers are served by a cheap model, and
   * a cost estimate built on that assumption would be wrong in the expensive
   * direction. Per-reader AI is Ask, and Ask alone — that is what `askModel`,
   * `asksPerDay` and `monthlyAiTokenCap` govern.
   */
  digestModel: PlanModel;
  storyCaps: Record<DensityBand, number>;
  alerts: AlertAccess;
  /**
   * The most alerts a plan may receive in a rolling 24 hours. A **ceiling, not
   * a target** — what actually governs the volume is `alerts`: Personal only
   * ever alerts on events scoring 6 or higher, so an ordinary day sends zero
   * or one and the cap is never approached.
   *
   * There used to be an `alertWeeklyCap` beside this, and Personal used it for
   * a ration of 3 per rolling 7 days. Two fields meant every caller had to
   * know which one applied to which plan, and the weekly one meant a busy
   * Tuesday silenced a paying reader until the following Tuesday. Both are
   * gone: one field, one window, enforced by `claim_alert` in 0037.
   */
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
    // Zero on purpose (plan2 §63): a free reader consumes the already-active
    // shared network. Adding a source creates a new crawler, which is the one
    // thing free growth must not be able to do.
    customSources: 0,
    retention: "7-day history",
    retentionDays: 7,
    asksPerDay: 0,
    askModel: null,
    digestModel: "flash",
    storyCaps: { minimal: 3, focused: 6, broad: 10, deep: 18 },
    alerts: "none",
    alertDailyCap: 0,
    inactivePauseDays: 30,
    // Reduced to 50K tokens for student budget. 400K per free user could become expensive.
    monthlyAiTokenCap: 50_000,
  },
  personal: {
    topics: 15,
    prioritySources: 15,
    customSources: 5,
    retention: "90-day history",
    retentionDays: 90,
    asksPerDay: 10,
    askModel: "flash",
    digestModel: "pro",
    storyCaps: { minimal: 5, focused: 10, broad: 18, deep: 30 },
    alerts: "important",
    alertDailyCap: 10,
    inactivePauseDays: null,
    // Reduced for student budget. Increase after covering costs with paid users.
    monthlyAiTokenCap: 200_000,
  },
  pro: {
    topics: Infinity,
    prioritySources: Infinity,
    // Finite where topics are not: each one is a real crawler on a schedule,
    // so "unlimited" here would be an unbounded infrastructure commitment
    // rather than a generous row limit (plan2 §18 — all tiers stay bounded).
    customSources: 25,
    retention: "1-year history",
    retentionDays: 365,
    asksPerDay: 15,
    askModel: "pro",
    digestModel: "pro",
    storyCaps: { minimal: 8, focused: 16, broad: 30, deep: 50 },
    alerts: "configurable",
    alertDailyCap: 25,
    inactivePauseDays: null,
    // Reduced for student budget. Increase after covering costs with paid users.
    monthlyAiTokenCap: 500_000,
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
