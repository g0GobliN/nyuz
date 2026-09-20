/* eslint-disable prettier/prettier */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminOnly, audit } from "@/lib/server/guard";
import { parseInput } from "@/lib/server/validate";
import {
  calculateBreakEven,
  convertUsdToJpyMinor,
  projectPeriodCost,
  type Contribution,
  type EconomicsStatus,
} from "@/lib/economics";

import { envValue } from "@/lib/runtime-env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, EconomicsManualCost, EconomicsSnapshot, PlanTier } from "@/lib/supabase/types";

const periodInput = z.object({ days: z.number().int().min(1).max(365) });
const PAGE_SIZE = 1_000;

function missingFoundation(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

async function recordSyncRun(
  db: DatabaseClient,
  provider: string,
  days: number,
  status: "healthy" | "warning" | "error",
  importedCount: number,
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await db.from("economics_sync_runs").insert({
    provider,
    requested_days: days,
    finished_at: new Date().toISOString(),
    status,
    imported_count: importedCount,
    attempt: 1,
    error: errorMessage,
    source: "admin-triggered",
  });
  if (error && !missingFoundation(error)) console.error(`recording economics sync: ${error.message}`);
}

type DatabaseClient = ReturnType<typeof createAdminClient>;

async function captureJpyRate(db: DatabaseClient, currency: string, date: string): Promise<number | null> {
  if (currency === "JPY") return 1;
  const response = await fetch(`https://api.frankfurter.app/${date}?from=${encodeURIComponent(currency)}&to=JPY`, { headers: { Accept: "application/json" } });
  const payload = (await response.json().catch(() => null)) as { rates?: Record<string, number> } | null;
  const rate = payload?.rates?.["JPY"];
  if (!response.ok || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const { error } = await db.from("economics_fx_rates").upsert({ base_currency: currency, quote_currency: "JPY", rate, rate_date: date, source: "frankfurter.app" }, { onConflict: "base_currency,quote_currency,rate_date,source" });
  if (error && !missingFoundation(error)) console.error(`recording FX rate: ${error.message}`);
  return rate;
}

type BillingRow = {
  user_id: string | null;
  plan: PlanTier;
  currency: string;
  gross_cents: number;
  refunded_cents: number;
  stripe_fee_amount: number;
  stripe_fee_currency: string;
  period_start: string;
  period_end: string;
  livemode: boolean;
};

type AiRow = {
  user_id: string | null;
  plan: PlanTier | null;
  cost_microusd: number | null;
  estimated_cost_microusd: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  created_at: string;
};

type UsageValue = number | string | null;
type DeliveryMetricRow = { status: string; channel: string };
type ProviderAggregate = {
  services: Set<string>;
  latestSync: string | null;
  jpy: number;
  hasJpy: boolean;
  statuses: Set<EconomicsStatus>;
  scope: string;
  usage: Record<string, UsageValue>;
};

type ProviderRow = {
  provider: string;
  service: string;
  scope: EconomicsSnapshot["scope"];
  status: EconomicsStatus;
  jpy_amount_minor: number | null;
  original_amount_minor: number | null;
  original_currency: string | null;
  captured_at: string;
  classification: "fixed" | "variable" | "mixed";
  usage: unknown;
};

function usageObject(value: unknown): Record<string, UsageValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, UsageValue] =>
        typeof entry[1] === "number" || typeof entry[1] === "string" || entry[1] === null,
    ),
  );
}

export type EconomicsOverview = {
  period: { from: string; to: string; days: number; timezone: "UTC" };
  reportingCurrency: "JPY";
  foundationReady: boolean;
  revenue: {
    grossUsd: number;
    refundsUsd: number;
    netUsd: number;
    netJpy: number | null;
    stripeFeesUsd: number;
    status: "imported" | "unavailable";
  };
  costs: {
    aiUsd: number;
    aiJpy: number | null;
    manualJpy: number;
    providerJpy: number;
    infrastructureJpy: number;
    totalOperatingJpy: number | null;
    projectedOperatingJpy: number | null;
    fixedJpy: number;
    variableJpy: number;
    aiSharePct: number | null;
    operatingStatus: EconomicsStatus;
    projectedAiUsd: number | null;
    unpricedAiCalls: number;
    status: EconomicsStatus;
  };
  contributionUsd: Contribution | null;
  providers: Array<{
    provider: string;
    services: number;
    latestSync: string | null;
    actualJpy: number | null;
    statuses: EconomicsStatus[];
    scope: string;
    usage: Record<string, UsageValue>;
  }>;
  usage: {
    activeUsers: number;
    briefingsGenerated: number | null;
    articlesIngested: number | null;
    eventsCreated: number | null;
    deliveries: { attempted: number; sent: number; failed: number; bounced: number; email: number; push: number };
  };
  users: {
    freeTotal: number;
    activeFree: number;
    freeAiUsd: number;
    freeAiStatus: EconomicsStatus;
    freeCost: { computeJpy: number | null; databaseJpy: number | null; storageJpy: number | null; egressJpy: number | null; emailJpy: number | null; aiUsd: number; totalJpy: number | null; status: EconomicsStatus };
    paid: Record<"plura" | "omni", number>;
    plans: Record<"plura" | "omni", { revenueUsd: number; stripeFeesUsd: number; infrastructureJpy: number | null; deliveryUsd: number | null; aiUsd: number; contributionUsd: number | null; contributionStatus: EconomicsStatus }>;
  };
  ai: {
    killSwitchOn: boolean;
    calls: number;
    tokens: number | null;
    pricedCalls: number;
  };
  warnings: string[];
};

async function pageRows<T>(load: (from: number, to: number) => PromiseLike<{ rows: T[]; error: { code?: string; message: string } | null }>): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await load(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      if (missingFoundation(result.error)) return { rows: [], missing: true };
      throw new Error(result.error.message);
    }
    rows.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) return { rows, missing: false };
  }
}

function overlapFraction(row: BillingRow, from: number, to: number): number {
  const start = new Date(row.period_start).getTime();
  const end = new Date(row.period_end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
  return overlap / (end - start);
}

export const getEconomicsOverview = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(periodInput, input))
  .handler(async ({ context, data }): Promise<EconomicsOverview> => {
    const now = new Date();
    const to = now.getTime();
    const from = to - data.days * 86_400_000;
    const fromIso = new Date(from).toISOString();
    const toIso = now.toISOString();
    const db = context.actor.db;

    const [billing, ai, subscriptions, profileCount, activeFreeCount, deliveries, digests, articles, events, flags, fxRate, snapshotRows, manualRows, syncRuns] = await Promise.all([
      pageRows<BillingRow>((offset, end) =>
        db.from("billing_ledger")
          .select("user_id, plan, currency, gross_cents, refunded_cents, stripe_fee_amount, stripe_fee_currency, period_start, period_end, livemode")
          .eq("livemode", true)
          .lt("period_start", toIso)
          .gt("period_end", fromIso)
          .range(offset, end)
          .then((result) => ({ rows: (result.data ?? []) as BillingRow[], error: result.error })),
      ),
      pageRows<AiRow>((offset, end) =>
        db.from("ai_usage_ledger")
          .select("user_id, plan, cost_microusd, estimated_cost_microusd, prompt_tokens, completion_tokens, reasoning_tokens, created_at")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .range(offset, end)
          .then((result) => ({ rows: (result.data ?? []) as AiRow[], error: result.error })),
      ),
      db.from("subscriptions").select("plan, status"),
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", fromIso),
      db.from("deliveries").select("status, channel").gte("created_at", fromIso).lte("created_at", toIso).limit(50_000),
      db.from("digests").select("digest_id", { count: "exact", head: true }).not("generated_at", "is", null).gte("generated_at", fromIso).lte("generated_at", toIso),
      db.from("articles").select("id", { count: "exact", head: true }).gte("fetched_at", fromIso).lte("fetched_at", toIso),
      db.from("events").select("id", { count: "exact", head: true }).gte("first_seen_at", fromIso).lte("first_seen_at", toIso),
      db.from("feature_flags").select("key, enabled").eq("key", "ai_kill_switch").maybeSingle(),
      db.from("economics_fx_rates").select("rate, rate_date, source").eq("base_currency", "USD").eq("quote_currency", "JPY").order("rate_date", { ascending: false }).limit(1).maybeSingle(),
      pageRows<ProviderRow>((offset, end) =>
        db.from("economics_snapshots")
          .select("provider, service, scope, status, jpy_amount_minor, original_amount_minor, original_currency, captured_at, classification, usage")
          .lt("period_start", toIso)
          .gt("period_end", fromIso)
          .range(offset, end)
          .then((result) => ({ rows: (result.data ?? []) as ProviderRow[], error: result.error })),
      ),
      pageRows<EconomicsManualCost>((offset, end) =>
        db.from("economics_manual_costs")
          .select("id, provider, service, scope, period_start, period_end, amount_minor, currency, jpy_amount_minor, conversion_rate, conversion_date, conversion_source, classification, reference, notes, created_by, created_at, updated_at")
          .lt("period_start", toIso)
          .gt("period_end", fromIso)
          .range(offset, end)
          .then((result) => ({ rows: (result.data ?? []) as EconomicsManualCost[], error: result.error })),
      ),
      db.from("economics_sync_runs").select("id, provider, status").limit(50),
    ]);

    const warnings: string[] = [];
    const foundationReady = !snapshotRows.missing && !manualRows.missing;
    if (!foundationReady) warnings.push("Economics foundation migration 0094 is not applied; provider and manual cost data is unavailable.");
    if (billing.missing) warnings.push("Stripe billing ledger is unavailable.");
    if (ai.missing) warnings.push("AI usage ledger is unavailable.");
    if (fxRate.error && !missingFoundation(fxRate.error)) warnings.push("USD to JPY conversion data is unavailable.");
    if (digests.error) warnings.push("Briefing generation telemetry is unavailable.");
    if (articles.error) warnings.push("Article ingestion telemetry is unavailable.");
    if (events.error) warnings.push("Event processing telemetry is unavailable.");

    let grossUsd = 0;
    let refundsUsd = 0;
    let stripeFeesUsd = 0;
    const planRevenue = { plura: 0, omni: 0 };
    const planFees = { plura: 0, omni: 0 };
    for (const row of billing.rows) {
      const fraction = overlapFraction(row, from, to);
      if (!row.livemode || fraction === 0 || row.currency !== "usd") continue;
      grossUsd += (row.gross_cents / 100) * fraction;
      refundsUsd += (row.refunded_cents / 100) * fraction;
      if (row.stripe_fee_currency === row.currency) {
        stripeFeesUsd += (row.stripe_fee_amount / 100) * fraction;
        if (row.plan === "plura" || row.plan === "omni") planFees[row.plan] += (row.stripe_fee_amount / 100) * fraction;
      }
      if (row.plan === "plura" || row.plan === "omni") planRevenue[row.plan] += (row.gross_cents / 100) * fraction;
    }

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    let aiUsd = 0;
    let monthAiUsd = 0;
    let unpricedAiCalls = 0;
    let tokens = 0;
    let tokenTelemetryObserved = false;
    let pricedCalls = 0;
    let freeAiUsd = 0;
    const planAi = { plura: 0, omni: 0 };
    for (const row of ai.rows) {
      const cost = row.cost_microusd ?? row.estimated_cost_microusd;
      if (cost === null || cost === undefined) unpricedAiCalls++;
      else {
        const usd = cost / 1_000_000;
        aiUsd += usd;
        if (new Date(row.created_at) >= monthStart) monthAiUsd += usd;
        const rowTokens = row.prompt_tokens + row.completion_tokens + row.reasoning_tokens;
        tokens += rowTokens;
        if (rowTokens > 0) tokenTelemetryObserved = true;
        pricedCalls++;
        if (row.plan === "uno") freeAiUsd += usd;
        if (row.plan === "plura" || row.plan === "omni") planAi[row.plan] += usd;
      }
    }

    const usdToJpy = typeof fxRate.data?.rate === "number" ? fxRate.data.rate : null;
    const aiJpy = convertUsdToJpyMinor(aiUsd, usdToJpy);
    const netUsd = grossUsd - refundsUsd;
    // Zero revenue is exactly zero in every currency; an FX rate is only needed
    // when a non-zero amount must be converted.
    const netJpy = convertUsdToJpyMinor(netUsd, usdToJpy);
    const projection = projectPeriodCost({
      actualMinor: Math.round(monthAiUsd * 100),
      periodStart: monthStart,
      periodEnd: monthEnd,
      now,
    });
    if (unpricedAiCalls > 0) warnings.push(`${unpricedAiCalls} AI calls have no provider price and are excluded from actual cost.`);
    if (ai.rows.length > 0 && !tokenTelemetryObserved) warnings.push("AI token telemetry is unavailable for this period.");
    if (billing.rows.some((row) => row.currency !== "usd")) warnings.push("Non-USD Stripe rows are excluded from the USD revenue summary.");

    const providerMap = new Map<string, ProviderAggregate>();
    for (const [provider, status] of [["Stripe", "imported"], ["AI providers", "imported"], ["cloudflare", "unavailable"], ["supabase", "unavailable"], ["resend", "unavailable"], ["domain/registrar", "unavailable"], ["other/manual", "unavailable"]] as const) {
      providerMap.set(provider, { services: new Set(), latestSync: null, jpy: 0, hasJpy: false, statuses: new Set([status]), scope: "application", usage: {} });
    }
    for (const row of snapshotRows.rows) {
      const current = providerMap.get(row.provider) ?? { services: new Set(), latestSync: null, jpy: 0, hasJpy: false, statuses: new Set<EconomicsStatus>(), scope: row.scope, usage: {} };
      current.services.add(row.service);
      current.latestSync = !current.latestSync || row.captured_at > current.latestSync ? row.captured_at : current.latestSync;
      if (row.jpy_amount_minor !== null) { current.jpy += row.jpy_amount_minor; current.hasJpy = true; }
      current.statuses.delete("unavailable");
      current.statuses.add(row.status);
      for (const [key, value] of Object.entries(usageObject(row.usage))) {
        if (typeof value === "number") current.usage[key] = (typeof current.usage[key] === "number" ? current.usage[key] : 0) + value;
        else if (value !== null) current.usage[key] = value;
      }
      providerMap.set(row.provider, current);
    }
    let manualJpy = 0;
    for (const row of manualRows.rows) {
      if (row.jpy_amount_minor !== null) manualJpy += row.jpy_amount_minor;
      const current = providerMap.get(row.provider) ?? { services: new Set(), latestSync: null, jpy: 0, hasJpy: false, statuses: new Set<EconomicsStatus>(), scope: row.scope, usage: {} };
      current.services.add(row.service);
      if (row.jpy_amount_minor !== null) {
        current.jpy += row.jpy_amount_minor;
        current.hasJpy = true;
      }
      current.statuses.delete("unavailable");
      current.statuses.add("manual");
      providerMap.set(row.provider, current);
    }

    const providerJpy = snapshotRows.rows.reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0);
    const infrastructureJpy = snapshotRows.rows.filter((row) => row.provider.toLowerCase() !== "ai providers").reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0) + manualJpy;
    const fixedJpy = snapshotRows.rows.filter((row) => row.provider.toLowerCase() !== "ai providers" && row.classification !== "variable").reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0) + manualRows.rows.filter((row) => row.classification !== "variable").reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0);
    const variableJpy = Math.max(infrastructureJpy - fixedJpy, 0);
    const missingInfrastructure = ["cloudflare", "supabase", "resend", "domain/registrar", "other/manual"].some((provider) => providerMap.get(provider)?.statuses.has("unavailable") === true);
    const operatingJpy = aiJpy === null && aiUsd > 0 ? null : infrastructureJpy + (aiJpy ?? 0);
    const syncRunRows = (syncRuns.data ?? []) as Array<{ id: string; provider: string; status: string }>;
    for (const provider of ["cloudflare", "supabase", "resend", "domain/registrar", "other/manual"]) {
      if (providerMap.get(provider)?.statuses.has("unavailable")) {
        warnings.push(`${provider === "domain/registrar" ? "Domain/registrar" : provider} data unavailable.`);
      }
    }
    if (syncRuns.error && !missingFoundation(syncRuns.error)) warnings.push("Provider sync history is unavailable.");
    if (!syncRuns.error && syncRunRows.length === 0) warnings.push("No external provider sync has completed.");
    if (missingInfrastructure) warnings.push("Shared infrastructure coverage is incomplete.");
    const operatingStatus: EconomicsStatus = missingInfrastructure || (aiUsd > 0 && aiJpy === null) ? "incomplete" : "imported";
    const projectedOperatingJpy = operatingStatus === "imported" && operatingJpy !== null
      ? projectPeriodCost({ actualMinor: operatingJpy, periodStart: monthStart, periodEnd: monthEnd, now }).amountMinor
      : null;
    const plans = {
      // Do not publish a pseudo contribution number that subtracts only AI while
      // infrastructure and delivery attribution are unavailable. AI remains a
      // visible cost row, but it cannot stand in for the whole plan cost model.
      plura: { revenueUsd: planRevenue.plura, stripeFeesUsd: planFees.plura, infrastructureJpy: null, deliveryUsd: null, aiUsd: planAi.plura, contributionUsd: null, contributionStatus: "incomplete" as const },
      omni: { revenueUsd: planRevenue.omni, stripeFeesUsd: planFees.omni, infrastructureJpy: null, deliveryUsd: null, aiUsd: planAi.omni, contributionUsd: null, contributionStatus: "incomplete" as const },
    };
    const paid = { plura: 0, omni: 0 };
    for (const row of subscriptions.data ?? []) {
      if (row.status !== "active") continue;
      if (row.plan === "plura" || row.plan === "omni") paid[row.plan]++;
    }

    return {
      period: { from: fromIso, to: toIso, days: data.days, timezone: "UTC" },
      reportingCurrency: "JPY",
      foundationReady,
      revenue: { grossUsd, refundsUsd, netUsd: grossUsd - refundsUsd, netJpy, stripeFeesUsd, status: billing.missing ? "unavailable" : "imported" },
      costs: {
        aiUsd,
        aiJpy,
        manualJpy,
        providerJpy,
        infrastructureJpy,
        totalOperatingJpy: operatingJpy,
        projectedOperatingJpy,
        fixedJpy,
        variableJpy,
        aiSharePct: aiJpy !== null && operatingJpy !== null && operatingJpy > 0 ? (aiJpy / operatingJpy) * 100 : null,
        operatingStatus,
        projectedAiUsd: projection.amountMinor === null ? null : projection.amountMinor / 100,
        unpricedAiCalls,
        status: unpricedAiCalls > 0 ? "incomplete" : "imported",
      },
      // A whole-business contribution figure would be misleading while
      // delivery, infrastructure allocation, and shared costs are unavailable.
      // AI remains reported separately instead of becoming the proxy for all
      // variable cost.
      contributionUsd: null,
      providers: [...providerMap.entries()].map(([provider, value]) => ({ provider, services: value.services.size, latestSync: value.latestSync, actualJpy: value.hasJpy ? value.jpy : null, statuses: [...value.statuses], scope: value.scope, usage: value.usage })),
      usage: {
        activeUsers: activeFreeCount.count ?? 0,
        briefingsGenerated: digests.count ?? null,
        articlesIngested: articles.count ?? null,
        eventsCreated: events.count ?? null,
        deliveries: (() => {
          const rows = (deliveries.data ?? []) as DeliveryMetricRow[];
          return {
            attempted: rows.length,
            sent: rows.filter((row) => row.status === "sent").length,
            failed: rows.filter((row) => row.status === "failed").length,
            bounced: rows.filter((row) => row.status === "bounced").length,
            email: rows.filter((row) => row.channel === "email" && row.status === "sent").length,
            push: rows.filter((row) => row.channel === "push" && row.status === "sent").length,
          };
        })(),
      },
      users: { freeTotal: Math.max((profileCount.count ?? 0) - paid.plura - paid.omni, 0), activeFree: Math.max((activeFreeCount.count ?? 0) - paid.plura - paid.omni, 0), freeAiUsd, freeAiStatus: ai.rows.some((row) => row.plan === "uno") ? "allocated" : "unavailable", freeCost: { computeJpy: null, databaseJpy: null, storageJpy: null, egressJpy: null, emailJpy: null, aiUsd: freeAiUsd, totalJpy: null, status: "incomplete" }, paid, plans },
      ai: { killSwitchOn: flags.data?.enabled === true, calls: ai.rows.length, tokens: tokenTelemetryObserved ? tokens : null, pricedCalls },
      warnings: [
        ...warnings,
        ...(deliveries.error ? ["Delivery telemetry is unavailable."] : []),
      ],
    };
  });

export type EconomicsHistory = {
  snapshots: Array<Pick<EconomicsSnapshot, "id" | "provider" | "service" | "scope" | "period_start" | "period_end" | "captured_at" | "original_amount_minor" | "original_currency" | "jpy_amount_minor" | "classification" | "status" | "source" | "import_key">>;
  manualCosts: EconomicsManualCost[];
  syncRuns: Database["public"]["Tables"]["economics_sync_runs"]["Row"][];
  breakEven: {
    fixedJpy: number;
    plura: ReturnType<typeof calculateBreakEven>;
    omni: ReturnType<typeof calculateBreakEven>;
    assumptions: string[];
  };
};

export const getEconomicsHistory = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(periodInput, input))
  .handler(async ({ context, data }): Promise<EconomicsHistory> => {
    const to = new Date();
    const from = new Date(to.getTime() - data.days * 86_400_000);
    const db = context.actor.db;
    const [snapshots, manual, syncRuns, billing] = await Promise.all([
      db.from("economics_snapshots").select("id, provider, service, scope, period_start, period_end, captured_at, original_amount_minor, original_currency, jpy_amount_minor, classification, status, source, import_key").lt("period_start", to.toISOString()).gt("period_end", from.toISOString()).order("captured_at", { ascending: false }).limit(250),
      db.from("economics_manual_costs").select("*").lt("period_start", to.toISOString()).gt("period_end", from.toISOString()).order("period_start", { ascending: false }).limit(250),
      db.from("economics_sync_runs").select("*").order("started_at", { ascending: false }).limit(50),
      db.from("billing_ledger").select("plan, gross_cents, refunded_cents, stripe_fee_amount, currency, livemode, period_start, period_end").eq("livemode", true).eq("currency", "usd").lt("period_start", to.toISOString()).gt("period_end", from.toISOString()).limit(1_000),
    ]);
    if (snapshots.error && !missingFoundation(snapshots.error)) throw new Error(`Reading economics history: ${snapshots.error.message}`);
    if (manual.error && !missingFoundation(manual.error)) throw new Error(`Reading economics manual history: ${manual.error.message}`);
    if (syncRuns.error && !missingFoundation(syncRuns.error)) throw new Error(`Reading economics sync history: ${syncRuns.error.message}`);
    const snapshotRows = (snapshots.data ?? []) as EconomicsHistory["snapshots"];
    const manualRows = (manual.data ?? []) as EconomicsManualCost[];
    const syncRows = (syncRuns.data ?? []) as EconomicsHistory["syncRuns"];
    const fixedJpy = snapshotRows.filter((row) => row.classification !== "variable").reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0) + manualRows.filter((row) => row.classification !== "variable").reduce((sum, row) => sum + (row.jpy_amount_minor ?? 0), 0);
    const revenueByPlan = { plura: 0, omni: 0 };
    for (const row of billing.data ?? []) {
      if (row.plan === "plura" || row.plan === "omni") revenueByPlan[row.plan] += ((row.gross_cents - row.refunded_cents - row.stripe_fee_amount) / 100);
    }
    const assumptions = [
      "Fixed cost includes only captured JPY snapshots/manual costs classified fixed or mixed.",
      "Plan contribution uses imported USD Stripe net after fees and refunds; AI and delivery attribution are excluded from this model.",
      "This is a scenario model, not a forecast of future plan mix or provider invoices.",
    ];
    return {
      snapshots: snapshotRows,
      manualCosts: manualRows,
      syncRuns: syncRows,
      breakEven: {
        fixedJpy,
        plura: calculateBreakEven({ fixedCostMinor: fixedJpy, monthlyContributionMinor: Math.round(revenueByPlan.plura * 100) }),
        omni: calculateBreakEven({ fixedCostMinor: fixedJpy, monthlyContributionMinor: Math.round(revenueByPlan.omni * 100) }),
        assumptions,
      },
    };
  });

const manualCostInput = z.object({
  provider: z.string().trim().min(1).max(80),
  service: z.string().trim().min(1).max(120),
  scope: z.enum(["account", "organization", "project", "workspace", "application", "allocated", "unallocated"]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  amountMinor: z.number().int().min(0).max(9_000_000_000_000),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  jpyAmountMinor: z.number().int().min(0).nullable().optional(),
  conversionRate: z.number().positive().nullable().optional(),
  conversionDate: z.string().date().nullable().optional(),
  conversionSource: z.string().trim().max(120).nullable().optional(),
  classification: z.enum(["fixed", "variable", "mixed"]),
  reference: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
});

export const addEconomicsManualCost = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(manualCostInput, input))
  .handler(async ({ context, data }) => {
    if (new Date(data.periodEnd) <= new Date(data.periodStart)) throw new Error("Period end must be after period start.");
    if (data.jpyAmountMinor !== null && data.jpyAmountMinor !== undefined && (!data.conversionRate || !data.conversionDate || !data.conversionSource)) {
      throw new Error("JPY amount requires conversion rate, date, and source.");
    }
    const { data: row, error } = await context.actor.db.from("economics_manual_costs").insert({
      provider: data.provider,
      service: data.service,
      scope: data.scope,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      amount_minor: data.amountMinor,
      currency: data.currency,
      jpy_amount_minor: data.jpyAmountMinor ?? null,
      conversion_rate: data.conversionRate ?? null,
      conversion_date: data.conversionDate ?? null,
      conversion_source: data.conversionSource ?? null,
      classification: data.classification,
      reference: data.reference ?? null,
      notes: data.notes ?? null,
      created_by: context.actor.id,
    }).select("id").single();
    if (error) throw new Error(`Saving manual cost: ${error.message}`);
    await audit(context.actor, "economics.manual_cost.add", { type: "economics_manual_cost", id: row.id }, { provider: data.provider, service: data.service, amount_minor: data.amountMinor, currency: data.currency });
    return { ok: true, id: row.id };
  });

export const syncCloudflareBillableUsage = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(periodInput, input))
  .handler(async ({ context, data }) => {
    const accountId = envValue("CLOUDFLARE_ACCOUNT_ID");
    const token = envValue("CLOUDFLARE_API_TOKEN");
    if (!accountId || !token) {
      await recordSyncRun(context.actor.db, "cloudflare", data.days, "warning", 0, "credentials not configured");
      throw new Error("Cloudflare sync is unavailable until CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are configured.");
    }
    const now = new Date();
    const from = new Date(now.getTime() - data.days * 86_400_000);
    const params = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/billable-usage?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: Array<{ message?: string }> } | null;
    if (!response.ok || payload?.success === false) {
      throw new Error(`Cloudflare billable usage ${response.status}: ${payload?.errors?.[0]?.message ?? "request failed"}`);
    }
    if (!Array.isArray(payload?.result)) throw new Error("Cloudflare returned an unexpected billable-usage response.");

    const fxRates = new Map<string, number | null>();
    for (const raw of payload.result) {
      if (!raw || typeof raw !== "object") continue;
      const value = (raw as Record<string, unknown>)["BillingCurrency"];
      const currency = typeof value === "string" ? value.toUpperCase() : null;
      if (currency && !fxRates.has(currency)) fxRates.set(currency, await captureJpyRate(context.actor.db, currency, now.toISOString().slice(0, 10)));
    }
    const rows = payload.result.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const service = typeof item["ServiceName"] === "string" ? item["ServiceName"] : null;
      const start = typeof item["ChargePeriodStart"] === "string" ? item["ChargePeriodStart"] : null;
      const end = typeof item["ChargePeriodEnd"] === "string" ? item["ChargePeriodEnd"] : null;
      const currency = typeof item["BillingCurrency"] === "string" ? item["BillingCurrency"].toUpperCase() : null;
      const cost = typeof item["ContractedCost"] === "number" ? item["ContractedCost"] : null;
      if (!service || !start || !end || !currency || cost === null) return [];
      const importKey = [service, start, end, String(item["ZoneId"] ?? "account")].join(":");
      const conversionRate = fxRates.get(currency) ?? null;
      return [{
        provider: "cloudflare",
        service,
        scope: "account" as const,
        period_start: start,
        period_end: end,
        original_amount_minor: Math.round(cost * 100),
        original_currency: currency,
        jpy_amount_minor: conversionRate === null ? null : Math.round(cost * conversionRate * 100),
        conversion_rate: conversionRate,
        conversion_date: conversionRate === null ? null : now.toISOString().slice(0, 10),
        conversion_source: conversionRate === null ? null : "frankfurter.app",
        classification: "variable" as const,
        status: "imported" as const,
        source: "cloudflare-billable-usage-api",
        usage: {
          quantity: typeof item["ConsumedQuantity"] === "number" ? item["ConsumedQuantity"] : null,
          unit: typeof item["ConsumedUnit"] === "string" ? item["ConsumedUnit"] : null,
          zone: typeof item["ZoneName"] === "string" ? item["ZoneName"] : null,
          billing_period_start: typeof item["BillingPeriodStart"] === "string" ? item["BillingPeriodStart"] : null,
          cumulated_cost: typeof item["CumulatedContractedCost"] === "number" ? item["CumulatedContractedCost"] : null,
        },
        allowance: null,
        import_key: importKey,
      } satisfies Database["public"]["Tables"]["economics_snapshots"]["Insert"]];
    });
    if (rows.length > 0) {
      const { error } = await context.actor.db.from("economics_snapshots").upsert(rows, { onConflict: "provider,service,scope,period_start,period_end,import_key" });
      if (error) throw new Error(`Saving Cloudflare snapshots: ${error.message}`);
    }
    await recordSyncRun(context.actor.db, "cloudflare", data.days, "healthy", rows.length);
    await audit(context.actor, "economics.provider.sync", { type: "economics_provider", id: "cloudflare" }, { imported: rows.length, days: data.days });
    return { provider: "cloudflare", imported: rows.length, capturedAt: now.toISOString() };
  });

export const syncSupabaseUsage = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({}).optional(), input))
  .handler(async ({ context }) => {
    const projectRef = envValue("SUPABASE_PROJECT_REF");
    const token = envValue("SUPABASE_MANAGEMENT_TOKEN");
    if (!projectRef || !token) {
      await recordSyncRun(context.actor.db, "supabase", 1, "warning", 0, "credentials not configured");
      throw new Error("Supabase usage sync is unavailable until SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN are configured.");
    }
    const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/analytics/endpoints/usage.api-counts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!response.ok) throw new Error(`Supabase usage ${response.status}: ${payload?.error ?? "request failed"}`);
    if (!Array.isArray(payload?.result)) throw new Error("Supabase returned an unexpected usage response.");
    const rows = payload.result.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const timestamp = typeof item["timestamp"] === "string" ? item["timestamp"] : null;
      if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return [];
      const start = new Date(timestamp);
      const end = new Date(start.getTime() + 86_400_000);
      return [{
        provider: "supabase",
        service: "api-counts",
        scope: "project" as const,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        original_amount_minor: null,
        original_currency: null,
        jpy_amount_minor: null,
        conversion_rate: null,
        conversion_date: null,
        conversion_source: null,
        classification: "variable" as const,
        status: "imported" as const,
        source: "supabase-management-api",
        usage: {
          auth_requests: typeof item["total_auth_requests"] === "number" ? item["total_auth_requests"] : null,
          realtime_requests: typeof item["total_realtime_requests"] === "number" ? item["total_realtime_requests"] : null,
          rest_requests: typeof item["total_rest_requests"] === "number" ? item["total_rest_requests"] : null,
          storage_requests: typeof item["total_storage_requests"] === "number" ? item["total_storage_requests"] : null,
        },
        allowance: null,
        import_key: timestamp,
      } satisfies Database["public"]["Tables"]["economics_snapshots"]["Insert"]];
    });
    if (rows.length > 0) {
      const { error } = await context.actor.db.from("economics_snapshots").upsert(rows, { onConflict: "provider,service,scope,period_start,period_end,import_key" });
      if (error) throw new Error(`Saving Supabase snapshots: ${error.message}`);
    }
    await recordSyncRun(context.actor.db, "supabase", 1, "healthy", rows.length);
    await audit(context.actor, "economics.provider.sync", { type: "economics_provider", id: "supabase" }, { imported: rows.length, metric: "api-counts" });
    return { provider: "supabase", imported: rows.length, capturedAt: new Date().toISOString() };
  });

/** Daily scheduled health record. Provider syncs remain observational and fail closed when credentials are absent. */
export async function recordEconomicsScheduledHealth(env?: Record<string, string | undefined>): Promise<void> {
  const db = createAdminClient(env);
  for (const [provider, configured] of [["cloudflare", Boolean(envValue("CLOUDFLARE_ACCOUNT_ID", env) && envValue("CLOUDFLARE_API_TOKEN", env))], ["supabase", Boolean(envValue("SUPABASE_PROJECT_REF", env) && envValue("SUPABASE_MANAGEMENT_TOKEN", env))]] as const) {
    await recordSyncRun(db, provider, 1, configured ? "healthy" : "warning", 0, configured ? null : "credentials not configured");
  }
}

export const listEconomicsManualCosts = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<EconomicsManualCost[] | null> => {
    const { data, error } = await context.actor.db.from("economics_manual_costs").select("*").order("period_start", { ascending: false }).limit(100);
    if (missingFoundation(error)) return null;
    if (error) throw new Error(`Reading manual costs: ${error.message}`);
    return (data ?? []) as EconomicsManualCost[];
  });
