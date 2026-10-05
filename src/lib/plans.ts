import { LAUNCH_PLANS } from "./launch-plans";
export { LAUNCH_PLANS, STANDARD_DELIVERY_TIME } from "./launch-plans";
import type { PlanTier } from "@/lib/supabase/types";

/**
 * Stripe product catalogue. Display, checkout copy and revenue arithmetic all
 * read these — not the admin override, which can only drift from what Stripe
 * actually charges.
 *
 *   nyuz plura          US$14.99 / month
 *   nyuz plura annual   US$149.90 / year
 *   nyuz omni           US$29.99 / month
 *   nyuz omni annual    US$299.90 / year
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
 *   2. `STRIPE_PRICE_PLURA_MONTHLY` and its three siblings point at them.
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
  uno: LAUNCH_PLANS.uno.monthly,
  plura: LAUNCH_PLANS.plura.monthly,
  omni: LAUNCH_PLANS.omni.monthly,
};

/**
 * Annual totals. Exactly two months free against twelve months of the monthly
 * price — Plura saves $29.98, Omni saves $59.98.
 *
 * The pricing page derives the saving from these numbers rather than printing a
 * fixed claim, so changing them here changes the copy with them.
 */
export const DEFAULT_ANNUAL_PRICES: Record<Exclude<PlanTier, "uno">, number> = {
  plura: LAUNCH_PLANS.plura.annual,
  omni: LAUNCH_PLANS.omni.annual,
};

/** "$7.00" — the same two-decimal form Stripe shows. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export const PLAN_TIERS: PlanTier[] = ["uno", "plura", "omni"];

export type DensityBand = "minimal" | "focused" | "broad" | "deep";
export type PlanModel = "flash" | "pro";
export type AlertAccess = "none" | "important" | "configurable";

export type PlanLimits = {
  monthly: number;
  annual: number;
  storiesPerBriefing: number;
  briefingsPerDay: number;
  customDeliveryTime: boolean;
  devices: number;
  email: boolean;
  push: boolean;
  telegram: boolean;
  notificationControl: "basic" | "standard" | "advanced";
  topics: number;
  prioritySources: number;
  /**
   * Sources this plan may ask nyuz to monitor on its behalf (plan2 §62).
   * Enforced in the database by `claim_custom_source`, not here — a number
   * in a bundle a browser can read is a display value, never a guard.
   */
  customSources: number;
  /**
   * Per-topic keyword terms this plan may store and apply, both directions
   * combined (prioritize + exclude share one pool, matching the topics-page
   * counter). Enforced at save time and clipped at match time; stored rows
   * are never truncated, so a downgrade only goes quiet, never destructive.
   */
  topicKeywords: number;
  retention: string;
  retentionDays: number;
  /**
   * Story Ask is not part of V1, so this is 0 on every tier and `askModel` is
   * null on every tier. Both are kept rather than deleted: they are the only
   * per-reader AI entitlement the product has ever had, and the tier table
   * reads more honestly with an explicit zero than with the concept missing.
   *
   * Nothing prices off these. `askStory` returns `disabled` before it reads a
   * plan at all, so raising one of these numbers grants nothing until the
   * endpoint is reinstated — which is deliberate.
   */
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
   * a target** — what actually governs the volume is `alerts`: Plura only
   * ever alerts on events scoring 6 or higher, so an ordinary day sends zero
   * or one and the cap is never approached.
   *
   * There used to be an `alertWeeklyCap` beside this, and Plura used it for
   * a ration of 3 per rolling 7 days. Two fields meant every caller had to
   * know which one applied to which plan, and the weekly one meant a busy
   * Tuesday silenced a paying reader until the following Tuesday. Both are
   * gone: one field, one window, enforced by `claim_alert` in 0037.
   */
  alertDailyCap: number;
  /**
   * Days of breaking-alert history this plan entitles.
   *
   * Deliberately its own field rather than a reuse of `retentionDays`, even
   * though the two agree for plura and omni. Alert history and the briefing
   * archive are separate things a plan sells, and the moment they share one
   * number, changing either means changing both.
   *
   * INVARIANT: this must stay <= `retentionDays` for every plan.
   * `purge_expired_digests` deletes alerts and briefings alike at the BRIEFING
   * window, so a longer alert window would promise history the daily purge then
   * deletes. Raising it above `retentionDays` means teaching that function
   * `kind` first. Asserted in src/lib/plans-limits.test.ts, and mirrored in SQL
   * by `plan_alert_days()` in 0073.
   */
  alertRetentionDays: number;
  inactivePauseDays: number | null;
  monthlyAiTokenCap: number;
};

/**
 * What each plan actually allows.
 *
 * One table, because these numbers decide two different things in two different
 * places: what the billing page advertises, and what the topics page lets a
 * reader do. They were only ever written down on the billing page, which is why
 * somebody could pick eight topics on the Uno plan and not discover until they
 * opened billing that five of them were inert.
 *
 * Every launch capability has a finite ceiling.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  uno: {
    ...LAUNCH_PLANS.uno,
    // Zero on purpose (plan2 §63): a free reader consumes the already-active
    // shared network. Adding a source creates a new crawler, which is the one
    // thing free growth must not be able to do.
    retention: "7-day history",
    asksPerDay: 0,
    askModel: null,
    digestModel: "flash",
    storyCaps: {
      minimal: LAUNCH_PLANS.uno.storiesPerBriefing,
      focused: LAUNCH_PLANS.uno.storiesPerBriefing,
      broad: LAUNCH_PLANS.uno.storiesPerBriefing,
      deep: LAUNCH_PLANS.uno.storiesPerBriefing,
    },
    alerts: "important",
    alertRetentionDays: LAUNCH_PLANS.uno.retentionDays,
    inactivePauseDays: 30,
    // Reduced to 50K tokens for student budget. 400K per free user could become expensive.
    monthlyAiTokenCap: 50_000,
  },
  plura: {
    ...LAUNCH_PLANS.plura,
    retention: "90-day history",
    asksPerDay: 0,
    askModel: null,
    digestModel: "pro",
    storyCaps: {
      minimal: LAUNCH_PLANS.plura.storiesPerBriefing,
      focused: LAUNCH_PLANS.plura.storiesPerBriefing,
      broad: LAUNCH_PLANS.plura.storiesPerBriefing,
      deep: LAUNCH_PLANS.plura.storiesPerBriefing,
    },
    alerts: "important",
    alertRetentionDays: LAUNCH_PLANS.plura.retentionDays,
    inactivePauseDays: null,
    // Reduced for student budget. Increase after covering costs with paid users.
    monthlyAiTokenCap: 200_000,
  },
  omni: {
    ...LAUNCH_PLANS.omni,
    retention: "1-year history",
    asksPerDay: 0,
    askModel: null,
    digestModel: "pro",
    storyCaps: {
      minimal: LAUNCH_PLANS.omni.storiesPerBriefing,
      focused: LAUNCH_PLANS.omni.storiesPerBriefing,
      broad: LAUNCH_PLANS.omni.storiesPerBriefing,
      deep: LAUNCH_PLANS.omni.storiesPerBriefing,
    },
    alerts: "configurable",
    alertRetentionDays: LAUNCH_PLANS.omni.retentionDays,
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

// The Ask ceiling moved to `ai.ask_max_tokens` (0056) so it can be tuned without
// a deploy; its default and bounds live in src/lib/ai/runtime-config.ts. Not
// re-exported from here as a constant, because a second copy nothing reads is
// the kind of dead weight that later reads as a bug.

export type AskDecision =
  { ok: true } | { ok: false; reason: "disabled" | "plan" | "quota" | "cooldown" };

/**
 * Whether this Ask is allowed. Pure, so the cap can be tested without a model.
 *
 * `flagOn` is fail-closed: missing or false both refuse. Uno has a zero cap,
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

/** Display a finite plan limit. */
export function formatTopicLimit(limit: number): string {
  return String(limit);
}

/** The next plan up, or null at the top. What an upgrade prompt offers. */
export function nextPlanUp(plan: PlanTier): PlanTier | null {
  const index = PLAN_TIERS.indexOf(plan);
  return index >= 0 && index < PLAN_TIERS.length - 1 ? (PLAN_TIERS[index + 1] ?? null) : null;
}

export const PLAN_NAMES: Record<PlanTier, string> = {
  uno: "nyuz Uno",
  plura: "nyuz Plura",
  omni: "nyuz Omni",
};

/**
 * Words currently on screen in the topic panel, both directions together —
 * prioritize and exclude are one allowance, so the counter counts them as one.
 */
export function keywordPoolUsed(keywords: string, excludeKeywords: string): number {
  return (
    keywords.split(",").filter((s) => s.trim()).length +
    excludeKeywords.split(",").filter((s) => s.trim()).length
  );
}

/**
 * The ladder the keyword panel tells — once, at the moment it matters. A
 * reader inside their pool gets no counter at all (a cap they are not touching
 * is noise); crossing it names what they have and what the next rung allows,
 * one quiet step, never a popup. Omni has no next rung, so the copy just
 * states the number.
 */
export function keywordCounterCopy(plan: PlanTier, used: number): string | null {
  const cap = PLAN_LIMITS[plan].topicKeywords;
  if (used <= cap) return null;
  const up = nextPlanUp(plan);
  return up
    ? `${used} of ${cap} · ${PLAN_NAMES[up]} allows ${PLAN_LIMITS[up].topicKeywords}`
    : `${used} of ${cap}`;
}

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
