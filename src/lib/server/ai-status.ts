/**
 * AI operational status derivation.
 *
 * A snapshot of enforced limits, not authorization for a particular request.
 * The atomic reservation also checks the size and model of the next call.
 */

import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly } from "@/lib/server/guard";
import { dailyCapsMicrousd } from "@/lib/ai/launch-flags";
import type { AiCreditStatus } from "@/lib/ai/credit";
import { readAiCredit } from "@/lib/server/cost-intelligence";
import { loadAiRuntimeConfig, type ValueSource } from "@/lib/ai/runtime-config";

// ── Types ──

export type AiBlocker =
  | { kind: "none" }
  | { kind: "kill_switch" }
  | { kind: "monthly_usd"; spentUsd: number; ceilingUsd: number }
  | { kind: "monthly_tokens"; usedTokens: number; budgetTokens: number }
  | { kind: "credit_exhausted"; remainingUsd: number; toppedUpUsd: number }
  | { kind: "daily_cap"; daySpent: number; dayCap: number; model: string }
  | { kind: "user_budget"; userUsed: number; userCap: number }
  | { kind: "unknown" };

export type AiStatus =
  "healthy" | "warning" | "near_limit" | "blocked" | "provider_degraded" | "unknown";

/**
 * What the console should offer to do about a blocker.
 *
 * Naming the setting lets the card link directly to the relevant control.
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
    daySpentFlash: number;
    dayCapFlash: number;
    killSwitchOn: boolean;
  };
  credit: {
    status: AiCreditStatus | "unknown";
    remainingUsd: number;
    burnUsdPerDay: number | null;
    daysRemaining: number | null;
  };
  /**
   * Whether `provider_credit_gate_enabled` (0080) is actually enforcing
   * anything right now. Shown unconditionally — an operator needs to see this
   * is off even when nothing else is wrong, because off is a deliberate
   * exception (development, migration, emergency) and not a state a
   * production deployment should sit in unnoticed.
   */
  creditGateEnabled: boolean;
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
  daySpentFlash: number;
  dayCapFlash: number;
  killSwitchOn: boolean;
  creditRemainingUsd: number;
  creditToppedUpUsd: number;
  creditBurnUsdPerDay: number | null;
  creditDaysRemaining: number | null;
  creditStatus: AiCreditStatus | "unknown";
  creditGateEnabled: boolean;
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
      "AI kill switch enabled.",
      { label: "Manage AI runtime", settingKey: KILL_SWITCH_SETTING_KEY },
      usedPct,
      params,
    );
  }

  if (tokensBudget > 0 && tokensUsed >= tokensBudget) {
    return makeStatus(
      "blocked",
      { kind: "monthly_tokens", usedTokens: tokensUsed, budgetTokens: tokensBudget },
      `Token safety cap reached. ${formatTokens(tokensUsed)} / ${formatTokens(tokensBudget)} tokens this month. Increase the token safety cap or wait for the next month.`,
      { label: "Increase token safety cap", settingKey: "ai.monthly_token_budget" },
      usedPct,
      params,
    );
  }

  if (spentUsd >= ceilingUsd) {
    return makeStatus(
      "blocked",
      { kind: "monthly_usd", spentUsd, ceilingUsd },
      `Monthly safety cap reached. ${formatUsd(spentUsd)} / ${formatUsd(ceilingUsd)} this month. Increase the safety cap or wait for the next month.`,
      { label: "Increase safety cap", settingKey: "ai.monthly_cost_usd" },
      usedPct,
      params,
    );
  }

  // Independent of the safety cap above: recorded provider top-up credit
  // (0080) is an operating budget that does not reset monthly and that a
  // top-up, not this cap, refills. Only reported as an actual blocker while
  // `provider_credit_gate_enabled` is on — off is a deliberate, explicit
  // exception (development, migration, emergency), and an unfunded balance
  // must never look "blocked" for a deployment that opted out of the gate.
  //
  // "unrecorded" blocks here too when the gate is on: with no top-up ever
  // recorded, enforced available credit is exactly zero (see 0080), which is
  // the point of making this an explicit flag rather than an implicit skip —
  // a production deployment cannot spend by accident before someone funds it.
  if (
    params.creditGateEnabled &&
    (params.creditStatus === "exhausted" || params.creditStatus === "unrecorded")
  ) {
    const unfunded = params.creditStatus === "unrecorded";
    return makeStatus(
      "blocked",
      {
        kind: "credit_exhausted",
        remainingUsd: params.creditRemainingUsd,
        toppedUpUsd: params.creditToppedUpUsd,
      },
      unfunded
        ? "Provider-credit gate is on but no top-up has ever been recorded. Every AI call is being refused until you record one, or turn the gate off for development, migration or emergency use."
        : `Provider credit exhausted. ${formatUsd(Math.max(params.creditRemainingUsd, 0))} left of ${formatUsd(params.creditToppedUpUsd)} topped up. Record a top-up to resume — the monthly safety cap is separate and unaffected.`,
      null,
      usedPct,
      params,
    );
  }

  for (const [model, daySpent, dayCap] of [
    ["deepseek-v4-flash", params.daySpentFlash, params.dayCapFlash],
    ["deepseek-v4-pro", daySpentPro, dayCapPro],
  ] as const) {
    if (dayCap > 0 && daySpent >= dayCap) {
      return makeStatus(
        "warning",
        { kind: "daily_cap", daySpent, dayCap, model },
        `Daily model cap reached for ${model}. ${formatUsd(daySpent)} / ${formatUsd(dayCap)} today (UTC). Calls to this model are blocked; other models retain their own limits.`,
        null,
        usedPct,
        params,
      );
    }
  }

  // Reachable with "exhausted" only when the gate is off (already returned,
  // blocked, above otherwise) — still worth flagging as a warning, the same
  // advisory this reported before 0080 existed.
  let status: AiStatus = "healthy";
  const maxUsedPct = Math.max(usedPct, tokensBudget > 0 ? (tokensUsed / tokensBudget) * 100 : 0);
  if (maxUsedPct >= NEAR_LIMIT_PCT) status = "near_limit";
  else if (
    maxUsedPct >= WARNING_PCT ||
    params.creditStatus === "low" ||
    params.creditStatus === "exhausted"
  )
    status = "warning";

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
      daySpentFlash: params.daySpentFlash,
      dayCapFlash: params.dayCapFlash,
      killSwitchOn: false,
    },
    credit: {
      status: params.creditStatus,
      remainingUsd: params.creditRemainingUsd,
      burnUsdPerDay: params.creditBurnUsdPerDay,
      daysRemaining: params.creditDaysRemaining,
    },
    creditGateEnabled: params.creditGateEnabled,
  };
}

function makeStatus(
  status: AiStatus,
  blocker: AiBlocker,
  blockerLabel: string,
  action: AiRuntimeAction | null,
  usedPct: number,
  params: Parameters<typeof deriveAiStatus>[0],
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
      daySpentFlash: params.daySpentFlash,
      dayCapFlash: params.dayCapFlash,
      killSwitchOn: params.killSwitchOn,
    },
    credit: {
      status: params.creditStatus,
      remainingUsd: params.creditRemainingUsd,
      burnUsdPerDay: params.creditBurnUsdPerDay,
      daysRemaining: params.creditDaysRemaining,
    },
    creditGateEnabled: params.creditGateEnabled,
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
    const { data: spendRow, error: spendError } = await db.rpc("ai_spend_this_month");
    if (spendError) throw new Error(`Reading monthly safety caps: ${spendError.message}`);
    const row = Array.isArray(spendRow) ? spendRow[0] : null;
    if (!row) throw new Error("Monthly safety cap usage is unavailable.");
    const spentUsd = row ? row.spent_microusd / 1_000_000 : 0;
    const inFlightUsd = row ? row.in_flight_microusd / 1_000_000 : 0;
    const tokensUsed = row ? row.tokens : 0;

    // 2. Configured ceilings, DB -> env -> default
    const ceilingUsd = runtime.monthlyCostUsd;
    const tokensBudget = runtime.monthlyTokenBudget;

    // 4. Kill switch
    const { data: killFlag, error: killError } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "ai_kill_switch")
      .maybeSingle();
    if (killError) throw new Error(`Reading AI kill switch: ${killError.message}`);
    const killSwitchOn = killFlag?.enabled === true;

    // 0080: off unless a row says otherwise, same fail-safe shape as the kill
    // switch — a missing row must read as "not enforcing", never the reverse.
    const { data: creditGateFlag, error: creditGateError } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("key", "provider_credit_gate_enabled")
      .maybeSingle();
    if (creditGateError) {
      throw new Error(`Reading the provider-credit gate flag: ${creditGateError.message}`);
    }
    const creditGateEnabled = creditGateFlag?.enabled === true;

    const daily = await dailyCapsMicrousd(db);
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let daySpentPro = 0;
    let daySpentFlash = 0;
    // Page through all rows; the REST row limit must not hide a reached cap.
    // Unresolved reservations remain charged until reconciliation (0070).
    for (let offset = 0; ; offset += 1000) {
      const { data: ledgerRows, error } = await db
        .from("ai_usage_ledger")
        .select("cost_microusd, estimated_cost_microusd, model")
        .gte("created_at", dayStart.toISOString())
        .lte("created_at", now.toISOString())
        .order("created_at")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Reading daily model limits: ${error.message}`);
      if (!ledgerRows) throw new Error("Daily model usage is unavailable.");
      for (const r of ledgerRows) {
        const cost = (r.cost_microusd ?? r.estimated_cost_microusd ?? 0) / 1_000_000;
        if (r.model?.startsWith("deepseek-v4-pro")) daySpentPro += cost;
        if (r.model?.startsWith("deepseek-v4-flash")) daySpentFlash += cost;
      }
      if (ledgerRows.length < 1000) break;
    }

    // A missing advisory estimate must not hide an enforced safety-cap blocker.
    const credit = await readAiCredit(db)
      .then((view) => view?.credit)
      .catch(() => undefined);

    return deriveAiStatus({
      spentUsd,
      ceilingUsd,
      tokensUsed,
      tokensBudget,
      inFlightUsd,
      daySpentPro,
      dayCapPro: daily.pro / 1_000_000,
      daySpentFlash,
      dayCapFlash: daily.flash / 1_000_000,
      killSwitchOn,
      creditRemainingUsd: credit?.remainingUsd ?? 0,
      creditToppedUpUsd: credit?.toppedUpUsd ?? 0,
      creditBurnUsdPerDay: credit?.burnUsdPerDay ?? null,
      creditDaysRemaining: credit?.daysRemaining ?? null,
      creditStatus: credit?.status ?? "unknown",
      creditGateEnabled,
      ceilingSource: runtime.resolved["ai.monthly_cost_usd"].source,
      tokenBudgetSource: runtime.resolved["ai.monthly_token_budget"].source,
    });
  });
