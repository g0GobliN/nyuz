import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly, audit } from "@/lib/server/guard";
import {
  configuredCeiling,
  DEFAULT_AI_MONTHLY_COST_USD,
  MICROUSD_PER_USD,
  MIN_AI_MONTHLY_COST_USD,
} from "@/lib/ai/budget";
import { ambientEnv } from "@/lib/runtime-env";
import {
  computeAiCredit,
  SPEND_WINDOW_KEYS,
  type AiCredit,
  type SpendWindow,
} from "@/lib/ai/credit";
import type { AiCreditTopup } from "@/lib/supabase/types";
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

    // `ambientEnv()`, never a bare `process.env`: on Workers that binding does
    // not exist at all, and a bare reference is a ReferenceError that would take
    // the console page down rather than degrade it. Same reasoning as
    // `createAdminClient` and `readEnv` in email/send.ts.
    // A value below the floor is treated as unset, so `configuredCeiling` stays
    // false and the page says the built-in default is in force — rather than
    // reporting a typo'd $0.10 as the operator's deliberate ceiling.
    const resolved = configuredCeiling(
      ambientEnv()["AI_MONTHLY_COST_USD"],
      MIN_AI_MONTHLY_COST_USD,
    );
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

/**
 * The prepaid balance, and the burn rate that says when to recharge.
 *
 * Reads two RPCs rather than one because they answer different questions and
 * failing to get the second must not cost you the first: an operator staring
 * at an empty balance because a window aggregate errored is worse off than one
 * looking at a balance with no burn rate beside it.
 *
 * Returns null when 0048 is not applied, matching `getUnitEconomics` — the page
 * says "not measured yet" rather than locking the console.
 */
export type AiCreditView = { credit: AiCredit; windows: SpendWindow[] };

export const getAiCredit = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AiCreditView | null> => {
    const [balance, windows] = await Promise.all([
      context.actor.db.rpc("ai_credit_balance"),
      context.actor.db.rpc("ai_spend_windows"),
    ]);
    if (migrationMissing(balance.error)) return null;
    if (balance.error) throw new Error(`Reading AI credit: ${balance.error.message}`);
    const row = Array.isArray(balance.data) ? balance.data[0] : null;
    if (!row) return null;

    const rows = windows.error ? [] : (windows.data ?? []);
    const parsed: SpendWindow[] = SPEND_WINDOW_KEYS.flatMap((key) => {
      const match = rows.find((w) => w.window_key === key);
      return match
        ? [
            {
              key,
              since: match.since,
              spentUsd: match.spent_microusd / MICROUSD_PER_USD,
              settledUsd: match.settled_microusd / MICROUSD_PER_USD,
              inFlightUsd: match.in_flight_microusd / MICROUSD_PER_USD,
              tokens: match.tokens,
              calls: match.calls,
            },
          ]
        : [];
    });

    // The week window feeds the burn rate. Zero when the aggregate failed, which
    // suppresses the rate rather than inventing one — see `computeAiCredit`.
    const week = parsed.find((w) => w.key === "week");

    return {
      credit: computeAiCredit({
        toppedUpMicrousd: row.topped_up_microusd,
        topups: row.topups,
        firstTopupAt: row.first_topup_at,
        lastTopupAt: row.last_topup_at,
        lastTopupMicrousd: row.last_topup_microusd,
        spentMicrousd: row.spent_microusd,
        settledMicrousd: row.settled_microusd,
        inFlightMicrousd: row.in_flight_microusd,
        unfundedSpentMicrousd: row.unfunded_spent_microusd,
        calls: row.calls,
        unpricedCalls: row.unpriced_calls,
        weekSpentMicrousd: week ? Math.round(week.spentUsd * MICROUSD_PER_USD) : 0,
        now: new Date(),
      }),
      windows: parsed,
    };
  });

export const listAiTopups = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AiCreditTopup[] | null> => {
    const { data, error } = await context.actor.db
      .from("ai_credit_topups")
      .select("id, amount_microusd, note, occurred_at, created_by, created_at")
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (migrationMissing(error)) return null;
    if (error) throw new Error(`Reading AI top-ups: ${error.message}`);
    return (data ?? []) as AiCreditTopup[];
  });

// Dollars in, microdollars stored. The input is a string because a $0.10 top-up
// typed into a number field is a float, and float dollars are how a ledger ends
// up a cent short of the invoice it is supposed to reconcile against.
const topupInput = z.object({
  amountUsd: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,6})?$/, "Amount must be dollars, for example 5 or 5.50."),
  note: z.string().trim().max(200).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const addAiTopup = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(topupInput, input))
  .handler(async ({ context, data }) => {
    const [dollars, fraction = ""] = data.amountUsd.split(".");
    const amountMicrousd =
      Number(dollars) * MICROUSD_PER_USD + Number(fraction.padEnd(6, "0").slice(0, 6));
    if (amountMicrousd <= 0) throw new Error("A top-up must be more than zero.");

    const { data: row, error } = await context.actor.db
      .from("ai_credit_topups")
      .insert({
        amount_microusd: amountMicrousd,
        note: data.note && data.note.length > 0 ? data.note : null,
        occurred_at: data.occurredAt ?? new Date().toISOString(),
        created_by: context.actor.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Recording top-up: ${error.message}`);

    await audit(
      context.actor,
      "cost.topup.add",
      { type: "ai_credit", id: row.id },
      {
        amount_microusd: amountMicrousd,
        note: data.note ?? null,
      },
    );
    return { ok: true };
  });

/**
 * Removes a top-up that was entered wrongly.
 *
 * A hard delete rather than a reversing entry: this table records what was
 * paid, and a typo was never paid. The audit log keeps the amount, so the
 * correction is still traceable without leaving a fiction in the balance.
 */
export const deleteAiTopup = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.actor.db
      .from("ai_credit_topups")
      .delete()
      .eq("id", data.id)
      .select("amount_microusd, occurred_at")
      .single();
    if (error) throw new Error(`Removing top-up: ${error.message}`);

    await audit(
      context.actor,
      "cost.topup.delete",
      { type: "ai_credit", id: data.id },
      {
        amount_microusd: row.amount_microusd,
        occurred_at: row.occurred_at,
      },
    );
    return { ok: true };
  });
