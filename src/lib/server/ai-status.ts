/**
 * AI operational status derivation.
 *
 * This is the single source of truth for "is AI running?" used by both
 * the admin UI and the pipeline. It mirrors the exact checks in
 * `reserve_ai_tokens` (migration 0053) so the admin page and the pipeline
 * always agree on the blocker.
 */

import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly } from "@/lib/server/guard";
import { DEFAULT_PRO_CAP_MICROUSD } from "@/lib/ai/launch-flags";
import { computeAiCredit } from "@/lib/ai/credit";
import { loadAiRuntimeConfig, type ValueSource } from "@/lib/ai/runtime-config";

// ── Types ──

export type AiBlocker =
  | { kind: "none" }
  | { kind: "kill_switch" }
  | { kind: "monthly_usd"; spentUsd: number; ceilingUsd: number }
  | { kind: "monthly_tokens"; usedTokens: number; budgetTokens: number }
  | { kind: "daily_cap"; daySpent: number; dayCap: number; model: string }
  | { kind: "user_budget"; userUsed: number; userCap: number }
  | { kind: "provider_capacity" }
  | { kind: "unknown" };

export type AiStatus =
  "healthy" | "warning" | "near_limit" | "blocked" | "provider_degraded" | "unknown";

/**
 * What the console should offer to do about a blocker.
 *
 * `settingKey` is the point of this type. The status card used to end in prose
 * — "raise AI_MONTHLY_COST_USD in Cloudflare" — which was both a chore and, once
 * 0056 landed, wrong: the env var is no longer where the number lives. Naming
 * the setting instead lets the card render a button that opens the very control
 * that unblocks it, and keeps the copy honest without anyone remembering to
 * update two places.
 */
export type AiRuntimeAction = {
  /** Button text. Imperative, names the thing being changed. */
  label: string;
  /** The `ai_runtime_config` key to open, or null for a blocker with no setting. */
  settingKey: string | null;
};

export type AiRuntimeStatus = {
  status: AiStatus;
  blocker: AiBlocker;
  blockerLabel: string;
  action: AiRuntimeAction | null;
  /** Where each monthly ceiling in `usage` came from. Shown as a source chip. */
  ceilingSource: ValueSource;
  tokenBudgetSource: ValueSource;
  usage: {
    spentUsd: number;
    ceilingUsd: number;
    usedPct: number;
    tokensUsed: number;
    tokensBudget: number;
    inFlightUsd: number;
    daySpentPro: number;
    dayCapPro: number;
    killSwitchOn: boolean;
  };
  credit: {
    remainingUsd: number;
    burnUsdPerDay: number | null;
    daysRemaining: number | null;
  };
};

/**
 * The kill switch is a `feature_flags` row, not an `ai_runtime_config` one.
 *
 * Deliberately left where it is. `reserveUsage` has read and enforced that flag
 * since 0053, before any request is priced; moving the storage would mean two
 * places that could disagree about whether AI is off, which is the single worst
 * thing for this particular switch to be ambiguous about. The AI Runtime page
 * renders and toggles it alongside the numeric settings, so it is one screen for
 * the operator even though it is two tables underneath.
 */
export const KILL_SWITCH_SETTING_KEY = "flag.ai_kill_switch";

// ── Thresholds ──

const WARNING_PCT = 70;
const NEAR_LIMIT_PCT = 90;

// ── Pure derivation function ──

export function deriveAiStatus(params: {
  spentUsd: number;
  ceilingUsd: number;
  tokensUsed: number;
  tokensBudget: number;
  inFlightUsd: number;
  daySpentPro: number;
  dayCapPro: number;
  killSwitchOn: boolean;
  creditRemainingUsd: number;
  creditBurnUsdPerDay: number | null;
  creditDaysRemaining: number | null;
  ceilingSource: ValueSource;
  tokenBudgetSource: ValueSource;
}): AiRuntimeStatus {
  const { spentUsd, ceilingUsd, tokensUsed, tokensBudget, daySpentPro, dayCapPro, killSwitchOn } =
    params;
  const usedPct = ceilingUsd > 0 ? (spentUsd / ceilingUsd) * 100 : 0;

  if (killSwitchOn) {
    return makeStatus(
      "blocked",
      { kind: "kill_switch" },
      "AI kill switch is enabled",
      { label: "Manage AI runtime", settingKey: KILL_SWITCH_SETTING_KEY },
      usedPct,
      params,
    );
  }

  if (spentUsd >= ceilingUsd) {
    return makeStatus(
      "blocked",
      { kind: "monthly_usd", spentUsd, ceilingUsd },
      `Monthly USD budget exceeded: ${formatUsd(spentUsd)} / ${formatUsd(ceilingUsd)}`,
      { label: "Increase budget", settingKey: "ai.monthly_cost_usd" },
      usedPct,
      params,
    );
  }

  if (tokensBudget > 0 && tokensUsed >= tokensBudget) {
    return makeStatus(
      "blocked",
      { kind: "monthly_tokens", usedTokens: tokensUsed, budgetTokens: tokensBudget },
      `Monthly token budget exceeded: ${formatTokens(tokensUsed)} / ${formatTokens(tokensBudget)}`,
      { label: "Adjust token budget", settingKey: "ai.monthly_token_budget" },
      usedPct,
      params,
    );
  }

  if (daySpentPro > 0 && daySpentPro >= dayCapPro) {
    return makeStatus(
      "blocked",
      { kind: "daily_cap", daySpent: daySpentPro, dayCap: dayCapPro, model: "deepseek-v4-pro" },
      `Daily model cap exceeded: ${formatUsd(daySpentPro)} / ${formatUsd(dayCapPro)}`,
      { label: "Manage AI runtime", settingKey: null },
      usedPct,
      params,
    );
  }

  if (params.inFlightUsd > dayCapPro * 0.5 && dayCapPro > 0) {
    return makeStatus(
      "provider_degraded",
      { kind: "provider_capacity" },
      "Provider temporary capacity issue",
      { label: "Manage AI runtime", settingKey: null },
      usedPct,
      params,
    );
  }

  let status: AiStatus = "healthy";
  if (usedPct >= NEAR_LIMIT_PCT) status = "near_limit";
  else if (usedPct >= WARNING_PCT) status = "warning";

  return {
    status,
    blocker: { kind: "none" },
    blockerLabel: "No blocker",
    action: null,
    ceilingSource: params.ceilingSource,
    tokenBudgetSource: params.tokenBudgetSource,
    usage: {
      spentUsd,
      ceilingUsd,
      usedPct,
      tokensUsed,
      tokensBudget,
      inFlightUsd: params.inFlightUsd,
      daySpentPro,
      dayCapPro,
      killSwitchOn: false,
    },
    credit: {
      remainingUsd: params.creditRemainingUsd,
      burnUsdPerDay: params.creditBurnUsdPerDay,
      daysRemaining: params.creditDaysRemaining,
    },
  };
}

function makeStatus(
  status: AiStatus,
  blocker: AiBlocker,
  blockerLabel: string,
  action: AiRuntimeAction | null,
  usedPct: number,
  params: {
    spentUsd: number;
    ceilingUsd: number;
    tokensUsed: number;
    tokensBudget: number;
    inFlightUsd: number;
    daySpentPro: number;
    dayCapPro: number;
    killSwitchOn: boolean;
    creditRemainingUsd: number;
    creditBurnUsdPerDay: number | null;
    creditDaysRemaining: number | null;
    ceilingSource: ValueSource;
    tokenBudgetSource: ValueSource;
  },
): AiRuntimeStatus {
  return {
    status,
    blocker,
    blockerLabel,
    action,
    ceilingSource: params.ceilingSource,
    tokenBudgetSource: params.tokenBudgetSource,
    usage: {
      spentUsd: params.spentUsd,
      ceilingUsd: params.ceilingUsd,
      usedPct,
      tokensUsed: params.tokensUsed,
      tokensBudget: params.tokensBudget,
      inFlightUsd: params.inFlightUsd,
      daySpentPro: params.daySpentPro,
      dayCapPro: params.dayCapPro,
      killSwitchOn: params.killSwitchOn,
    },
    credit: {
      remainingUsd: params.creditRemainingUsd,
      burnUsdPerDay: params.creditBurnUsdPerDay,
      daysRemaining: params.creditDaysRemaining,
    },
  };
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

// ── Server function ──

export const getAiStatus = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({}).optional(), input))
  .handler(async ({ context }): Promise<AiRuntimeStatus> => {
    const db = context.actor.db;

    // The same resolver the reserve path uses, so the number this page shows is
    // by construction the number that stops the pipeline. Before 0056 this read
    // `AI_MONTHLY_COST_USD` out of the console's own environment — which, on a
    // deployment where the Worker and the local pipeline had drifted, meant the
    // status card could report a ceiling neither runtime was enforcing.
    const runtime = await loadAiRuntimeConfig(db);

    // 1. Monthly spend
    const { data: spendRow } = await db.rpc("ai_spend_this_month");
    const row = Array.isArray(spendRow) ? spendRow[0] : null;
    const spentUsd = row ? row.spent_microusd / 1_000_000 : 0;
    const inFlightUsd = row ? row.in_flight_microusd / 1_000_000 : 0;
    const tokensUsed = row ? row.tokens : 0;

    // 2. Configured ceilings, DB -> env -> default
    const ceilingUsd = runtime.monthlyCostUsd;
    const tokensBudget = runtime.monthlyTokenBudget;

    // 4. Kill switch
    const { data: killFlag } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "ai_kill_switch")
      .maybeSingle();
    const killSwitchOn = killFlag?.enabled === true;

    // 5. Daily pro cap
    const { data: dailyCaps } = await db
      .from("site_settings")
      .select("key, value")
      .in("key", ["ai.daily_pro_cap_microusd"]);
    const storedCaps = new Map<string, unknown>(
      ((dailyCaps ?? []) as { key: string; value: { value?: unknown } | null }[]).map((r) => [
        r.key,
        r.value?.value,
      ]),
    );
    const dayCapPro =
      Number(storedCaps.get("ai.daily_pro_cap_microusd") ?? DEFAULT_PRO_CAP_MICROUSD) ||
      DEFAULT_PRO_CAP_MICROUSD;

    // 6. Day spent for deepseek-v4-pro
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const staleBefore = new Date(now.getTime() - 60 * 60 * 1000);
    const { data: ledgerRows } = await db
      .from("ai_usage_ledger")
      .select(
        "reserved_tokens, prompt_tokens, completion_tokens, cost_microusd, estimated_cost_microusd, model, created_at",
      )
      .gte("created_at", dayStart.toISOString());

    let daySpentPro = 0;
    if (ledgerRows) {
      for (const r of ledgerRows) {
        const isStale =
          r.reserved_tokens > 0 &&
          r.cost_microusd === null &&
          r.prompt_tokens === 0 &&
          r.completion_tokens === 0 &&
          r.created_at < staleBefore.toISOString();
        if (!isStale && r.model?.startsWith("deepseek-v4-pro")) {
          daySpentPro += r.cost_microusd ?? r.estimated_cost_microusd ?? 0;
        }
      }
    }

    // 7. Credit
    let creditRemainingUsd = 0;
    let creditBurnUsdPerDay: number | null = null;
    let creditDaysRemaining: number | null = null;
    try {
      const { data: creditRow } = await db.rpc("ai_credit_balance");
      const cr = Array.isArray(creditRow) ? creditRow[0] : null;
      if (cr) {
        const creditInput = {
          toppedUpMicrousd: cr.topped_up_microusd ?? 0,
          topups: cr.topups ?? 0,
          firstTopupAt: cr.first_topup_at,
          lastTopupAt: cr.last_topup_at,
          lastTopupMicrousd: cr.last_topup_microusd ?? 0,
          spentMicrousd: cr.spent_microusd ?? 0,
          settledMicrousd: cr.settled_microusd ?? 0,
          inFlightMicrousd: cr.in_flight_microusd ?? 0,
          unfundedSpentMicrousd: cr.unfunded_spent_microusd ?? 0,
          calls: cr.calls ?? 0,
          unpricedCalls: cr.unpriced_calls ?? 0,
          weekSpentMicrousd: 0,
          now,
        };
        const credit = computeAiCredit(creditInput);
        creditRemainingUsd = credit.remainingUsd;
        creditBurnUsdPerDay = credit.burnUsdPerDay;
        creditDaysRemaining = credit.daysRemaining;
      }
    } catch {
      // Credit not measured yet
    }

    return deriveAiStatus({
      spentUsd,
      ceilingUsd,
      tokensUsed,
      tokensBudget,
      inFlightUsd,
      daySpentPro,
      dayCapPro,
      killSwitchOn,
      creditRemainingUsd,
      creditBurnUsdPerDay,
      creditDaysRemaining,
      ceilingSource: runtime.resolved["ai.monthly_cost_usd"].source,
      tokenBudgetSource: runtime.resolved["ai.monthly_token_budget"].source,
    });
  });
