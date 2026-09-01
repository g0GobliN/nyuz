import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly, audit } from "@/lib/server/guard";
import { DEFAULT_AI_MONTHLY_COST_USD } from "@/lib/ai/budget";
import {
  computeUnitEconomics,
  COST_PROVIDERS,
  type EconomicsAiRow,
  type EconomicsBillingRow,
  type OperatingCost,
  type UnitEconomics,
} from "@/lib/unit-economics";

/**
 * What the pipeline is costing, and what the V2 work measurably changed
 * (docs/plan2.md phase 10, §77–79).
 *
 * Every figure is counted from rows. Nothing is modelled or extrapolated, and
 * there is deliberately no "tokens saved" or "money saved" number — the
 * honest version needs to know what the skipped calls *would* have cost,
 * which is unknowable, and the dishonest version is a plausible figure nobody
 * computed. plan2 §79: "Do not claim savings that cannot be measured."
 *
 * Returns null rather than throwing when 0035 is not applied, so the page
 * degrades to "not measured yet" instead of locking an operator out of the
 * console. Same fallback `listSourceDemand` uses for 0020.
 */

export type CostIntelligence = {
  window_days: number;
  sources: {
    total: number;
    active: number;
    core: number;
    demand: number;
    hot: number;
    normal: number;
    low: number;
    cold: number;
    paused_tier: number;
    no_demand: number;
  };
  articles: { total: number; in_window: number; unclustered: number };
  events: {
    total: number;
    analysed: number;
    awaiting: number;
    failed: number;
    analysis_tokens: number;
    tokens_per_event: number | null;
  };
  impacts: { total: number; complete: number; failed: number; tokens: number };
  digest_items_total: number;
  translations: {
    total: number;
    complete: number;
    failed: number;
    languages: number;
    tokens: number;
  };
  cluster_shadow: {
    decided: number;
    agreed: number;
    same_decided: number;
    same_agreed: number;
    diff_decided: number;
    diff_agreed: number;
  };
  ai_usage: Record<string, number>;
  flags: Record<string, boolean>;
};

export const getCostIntelligence = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ days: z.number().int().min(1).max(365) }), input),
  )
  .handler(async ({ context, data }): Promise<CostIntelligence | null> => {
    const { data: row, error } = await context.actor.db.rpc("admin_cost_intelligence", {
      p_days: data.days,
    });
    if (error) return null;
    return (row as CostIntelligence | null) ?? null;
  });

/**
 * Month-to-date AI spend against the configured ceiling.
 *
 * Exists because the ceiling is otherwise invisible until it bites: a refused
 * reservation throws inside a cron, `scheduled.ts` logs it, and the first
 * outward sign is that the news quietly stops. An operator watching one number
 * finds that out days earlier — and the number that matters is the projection,
 * not the balance, because "38% used" on the 5th of the month is a problem
 * wearing the costume of good news.
 */
export type AiSpend = {
  spentUsd: number;
  settledUsd: number;
  inFlightUsd: number;
  ceilingUsd: number;
  usedPct: number;
  tokens: number;
  calls: number;
  /** Calls the rate card could not price. Spend is understated by their cost. */
  unpricedCalls: number;
  /** Straight-line burn to month end. Null before there is a day to divide by. */
  projectedUsd: number | null;
  /** When the projection crosses the ceiling, if it does within this month. */
  exhaustionDate: string | null;
  /**
   * False when `AI_MONTHLY_COST_USD` could not be read here and the built-in
   * default is being displayed instead. The Worker reserving tokens reads the
   * same variable from its own env, so an unresolved read means the page cannot
   * prove which ceiling is enforced — and must say so rather than assert one.
   */
  ceilingResolved: boolean;
};

export const getAiSpend = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AiSpend | null> => {
    const { data, error } = await context.actor.db.rpc("ai_spend_this_month");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;

    // `globalThis.process?.env`, never a bare `process.env`: on Workers the
    // binding may not exist at all, and a bare reference is a ReferenceError
    // that would take the console page down rather than degrade it. Same
    // reasoning as `createAdminClient` and `readEnv` in email/send.ts.
    const configured = globalThis.process?.env?.["AI_MONTHLY_COST_USD"];
    const resolved =
      configured && Number.isFinite(Number(configured)) && Number(configured) > 0
        ? Number(configured)
        : null;
    const ceilingUsd = resolved ?? DEFAULT_AI_MONTHLY_COST_USD;

    const spentUsd = row.spent_microusd / 1_000_000;
    const now = new Date();
    const monthStart = new Date(row.month_start);
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    );
    const elapsedMs = now.getTime() - monthStart.getTime();
    const totalMs = monthEnd.getTime() - monthStart.getTime();

    // An hour of history extrapolated over a month is noise, not a forecast.
    const perMs = elapsedMs >= 3_600_000 ? spentUsd / elapsedMs : null;
    const projectedUsd = perMs === null ? null : perMs * totalMs;

    let exhaustionDate: string | null = null;
    if (perMs !== null && perMs > 0 && spentUsd < ceilingUsd) {
      const at = new Date(now.getTime() + (ceilingUsd - spentUsd) / perMs);
      if (at < monthEnd) exhaustionDate = at.toISOString();
    }

    return {
      spentUsd,
      settledUsd: row.settled_microusd / 1_000_000,
      inFlightUsd: row.in_flight_microusd / 1_000_000,
      ceilingUsd,
      usedPct: ceilingUsd > 0 ? (spentUsd / ceilingUsd) * 100 : 0,
      tokens: row.tokens,
      calls: row.calls,
      unpricedCalls: row.unpriced_calls,
      projectedUsd,
      exhaustionDate,
      ceilingResolved: resolved !== null,
    };
  });

const unitEconomicsInput = z.object({ days: z.number().int().min(1).max(365) });
const PAGE_SIZE = 1_000;

function migrationMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export const getUnitEconomics = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(unitEconomicsInput, input))
  .handler(async ({ context, data }): Promise<UnitEconomics | null> => {
    const now = new Date();
    const from = new Date(now.getTime() - data.days * 86_400_000).toISOString();
    const to = now.toISOString();
    const billing: EconomicsBillingRow[] = [];
    const allTimeBilling: Pick<EconomicsBillingRow, "user_id" | "livemode">[] = [];
    const ai: EconomicsAiRow[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: rows, error } = await context.actor.db
        .from("billing_ledger")
        .select(
          "user_id, plan, currency, gross_cents, refunded_cents, stripe_fee_amount, stripe_fee_currency, period_start, period_end, livemode",
        )
        .eq("livemode", true)
        .lt("period_start", to)
        .gt("period_end", from)
        .range(offset, offset + PAGE_SIZE - 1);
      if (migrationMissing(error)) return null;
      if (error) throw new Error(`Reading billing ledger: ${error.message}`);
      billing.push(...(rows as EconomicsBillingRow[]));
      if (!rows || rows.length < PAGE_SIZE) break;
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: rows, error } = await context.actor.db
        .from("billing_ledger")
        .select("user_id, livemode")
        .eq("livemode", true)
        .range(offset, offset + PAGE_SIZE - 1);
      if (migrationMissing(error)) return null;
      if (error) throw new Error(`Counting paying customers: ${error.message}`);
      allTimeBilling.push(...(rows as Pick<EconomicsBillingRow, "user_id" | "livemode">[]));
      if (!rows || rows.length < PAGE_SIZE) break;
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: rows, error } = await context.actor.db
        .from("ai_usage_ledger")
        .select("user_id, plan, cost_microusd")
        .gte("created_at", from)
        .lte("created_at", to)
        .range(offset, offset + PAGE_SIZE - 1);
      if (migrationMissing(error)) return null;
      if (error) throw new Error(`Reading AI cost ledger: ${error.message}`);
      ai.push(...(rows as EconomicsAiRow[]));
      if (!rows || rows.length < PAGE_SIZE) break;
    }

    const { data: costRows, error: costError } = await context.actor.db
      .from("operating_cost_settings")
      .select("provider, monthly_cents, updated_at");
    if (migrationMissing(costError)) return null;
    if (costError) throw new Error(`Reading operating costs: ${costError.message}`);

    return computeUnitEconomics({
      days: data.days,
      now,
      billing,
      allTimeBilling,
      ai,
      operatingCosts: (costRows ?? []) as OperatingCost[],
    });
  });

const operatingCostsInput = z.object({
  costs: z.object(
    Object.fromEntries(
      COST_PROVIDERS.map((provider) => [provider, z.number().int().min(0).max(100_000_000)]),
    ) as Record<(typeof COST_PROVIDERS)[number], z.ZodNumber>,
  ),
});

export const saveOperatingCosts = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(operatingCostsInput, input))
  .handler(async ({ context, data }) => {
    const updatedAt = new Date().toISOString();
    const rows = COST_PROVIDERS.map((provider) => ({
      provider,
      monthly_cents: data.costs[provider],
      updated_by: context.actor.id,
      updated_at: updatedAt,
    }));
    const { error } = await context.actor.db.from("operating_cost_settings").upsert(rows);
    if (error) throw new Error(`Saving operating costs: ${error.message}`);
    await audit(
      context.actor,
      "cost.overhead.save",
      { type: "unit_economics", id: "operating_costs" },
      data.costs,
    );
    return { ok: true };
  });
