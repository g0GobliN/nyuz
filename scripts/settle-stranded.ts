/**
 * Repairs ledger rows that were billed by the provider but never settled.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/settle-stranded.ts          # dry run
 *   node --env-file=.env scripts/tsrun.mjs scripts/settle-stranded.ts --apply
 *
 * Between 2026-09-08 and 2026-09-11, DeepSeek began echoing `deepseek-flash`
 * for requests routed to `deepseek-v4-flash`. Settlement priced by the reported
 * model, the rate card did not recognise the short form, and `settleUsage`
 * threw before calling `settle_ai_tokens`. The provider call had already
 * happened, so the effect was: measured tokens discarded, and a pessimistic
 * reservation left standing against the monthly ceiling for the rest of the
 * month. `settlementRateModel` stops it recurring; this repairs what it did.
 *
 * Nothing is invented. `record_ai_attempt` had already written the real usage to
 * `request_meta.observed_usage` before settlement threw, so every number here is
 * one the provider reported — this only moves it into the columns it belongs in
 * and prices it through the same rate card the app uses. Rows without observed
 * usage are left alone: those are genuinely ambiguous charges and guessing at
 * them is what the reservation is for.
 */
import { aiCostMicrousd, isDeepSeekPeak, settlementRateModel } from "@/lib/ai/cost";
import type { AiFeature } from "@/lib/supabase/types";
import { db, heading, main, say } from "./lib/db";

const apply = process.argv.includes("--apply");

type ObservedUsage = {
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
};

type Row = {
  id: string;
  created_at: string;
  feature: AiFeature | null;
  capability: string | null;
  model: string | null;
  reserved_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_microusd: number | null;
  request_meta: Record<string, unknown> | null;
};

main(async () => {
  const client = db();

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("ai_usage_ledger")
      .select(
        "id, created_at, feature, capability, model, reserved_tokens, prompt_tokens, completion_tokens, estimated_cost_microusd, request_meta",
      )
      .gt("reserved_tokens", 0)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`ai_usage_ledger: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const stranded = rows.filter(
    (r) => (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0) === 0 && r.reserved_tokens,
  );
  say(
    `${apply ? "APPLY" : "DRY RUN"} — reserved rows: ${rows.length}, unsettled: ${stranded.length}`,
  );

  let repaired = 0;
  let skipped = 0;
  let freedEstimate = 0;
  let realCost = 0;

  heading("Repairs");
  for (const row of stranded) {
    const usage = row.request_meta?.["observed_usage"] as ObservedUsage | undefined;
    if (!usage || typeof usage.prompt_tokens !== "number") {
      skipped++;
      continue;
    }
    // The provider is DeepSeek for every affected row; read it back rather than
    // assumed, so this stays correct if it is ever run after a provider swap.
    const provider = (row.request_meta?.["provider"] as string | undefined) ?? "deepseek";
    const pricingModel = settlementRateModel(
      provider,
      usage.model ?? row.model ?? "",
      row.model ?? "",
    );
    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens ?? 0;
    const cachedTokens = usage.cached_tokens ?? 0;
    const cost =
      pricingModel === null
        ? null
        : aiCostMicrousd({
            provider,
            model: pricingModel,
            promptTokens,
            cachedPromptTokens: cachedTokens,
            completionTokens,
            // Priced at the hour the call was actually made, not the hour this
            // repair runs — the tariff depends on the clock.
            at: new Date(row.created_at),
          });

    freedEstimate += row.estimated_cost_microusd ?? 0;
    realCost += cost ?? 0;
    repaired++;

    if (repaired <= 5) {
      say(
        `  ${row.created_at.slice(0, 19)} ${String(row.feature).padEnd(8)} ` +
          `${String(usage.model).padEnd(18)} -> priced as ${String(pricingModel).padEnd(18)} ` +
          `${promptTokens}+${completionTokens} tok  ` +
          `est $${((row.estimated_cost_microusd ?? 0) / 1_000_000).toFixed(4)} ` +
          `-> actual $${((cost ?? 0) / 1_000_000).toFixed(4)}`,
      );
    }

    if (apply) {
      const { error } = await client.rpc("settle_ai_tokens", {
        p_id: row.id,
        p_prompt_tokens: promptTokens,
        p_cached_prompt_tokens: cachedTokens,
        p_completion_tokens: completionTokens,
        p_cost_microusd: cost,
        // Re-stamps whatever the reservation recorded. This script never
        // relabels a row: an unattributed one stays unattributed, because
        // guessing its provenance is exactly what 0053 refused to do.
        p_feature: row.feature ?? "unknown",
      });
      if (error) throw new Error(`settling ${row.id}: ${error.message}`);
    }
  }
  if (repaired > 5) say(`  … and ${repaired - 5} more`);

  heading("Summary");
  say(`rows repairable:                 ${repaired}`);
  say(`rows left reserved (no usage):   ${skipped}`);
  say(`estimate released from the cap:  $${(freedEstimate / 1_000_000).toFixed(2)}`);
  say(`true cost recorded instead:      $${(realCost / 1_000_000).toFixed(2)}`);
  say(`net headroom returned:           $${((freedEstimate - realCost) / 1_000_000).toFixed(2)}`);
  if (!apply) {
    say("");
    say("Dry run. Re-run with --apply to write these settlements.");
  }
});
