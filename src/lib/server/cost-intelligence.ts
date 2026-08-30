import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly } from "@/lib/server/guard";

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
