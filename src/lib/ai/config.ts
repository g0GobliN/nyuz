import { createAdminClient } from "@/lib/supabase/admin";
import { ambientEnv } from "@/lib/runtime-env";
import { recordOps } from "@/lib/server/ops";
import {
  complete,
  completeJson,
  CompletionUsageError,
  TruncatedCompletionError,
  type AiEnv,
  type CompleteOptions,
  type CompleteResult,
  type ModelTier,
} from "@/lib/ai/deepseek";
import { aiCostCeilingMicrousd, aiCostMicrousd, isDeepSeekPeak } from "@/lib/ai/cost";
import { dailyCapsMicrousd } from "@/lib/ai/launch-flags";
import { MICROUSD_PER_USD } from "@/lib/ai/budget";
import { loadAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai/runtime-config";
import {
  budgetThresholds,
  checkRequestBudget,
  operationThinking,
  requestTokenCeiling,
  requestTokens,
} from "./request-policy";

/**
 * Runtime AI routing.
 *
 * This file is the reason the admin console's AI tab is not decorative. Without
 * it, changing a provider in the database would change a row and nothing else —
 * the pipeline would carry on reading MODEL_* env vars and calling DeepSeek. So
 * every AI call in the app goes through `completeRouted()`, which resolves the
 * capability to a provider, model and token ceiling from `ai_model_routes` at
 * call time.
 *
 * Three constraints shaped it:
 *
 *   1. **Keys are never in the database.** `ai_providers.api_key_env` holds the
 *      NAME of an environment variable; the value stays in Worker secrets. So a
 *      leaked database is not a leaked provider account, and the console can
 *      show which providers are configured without ever being able to read a
 *      key. The cost is that adding a provider is two steps: insert the row,
 *      then `wrangler secret put <api_key_env>`.
 *
 *   2. **A config outage must not stop briefings.** If the table is
 *      unreachable, or the row is missing, or the named secret is absent, this
 *      falls back to the env-var behaviour that shipped before the console
 *      existed. A news product that stops producing news because a settings
 *      table hiccuped is a worse failure than one running slightly stale
 *      config, so the fallback is deliberate and reported in `source`.
 *
 *   3. **Reads are cached per isolate for a minute.** The pipeline resolves a
 *      route once per article batch, not once per app, and a database round
 *      trip per AI call would be pure overhead on a config that changes maybe
 *      monthly. Sixty seconds is the bounded staleness that buys that; a
 *      provider swap therefore takes up to a minute to reach every isolate,
 *      which the console says out loud rather than pretending is instant.
 *
 * Server-only. Importing this from a component would pull the service-role
 * client into the browser bundle.
 */

export type RouteSource = "database" | "env-fallback";

export type ResolvedRoute = {
  capability: ModelTier;
  providerSlug: string;
  providerLabel: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxTokens: number;
  temperature: number | undefined;
  source: RouteSource;
  /** Set when the route resolved but its secret is missing, so callers can say why. */
  missingSecret: boolean;
  /**
   * Why the env fallback was taken, when it was. Carried on the route rather
   * than logged at the point of the decision so `prepare` can name the actual
   * cause when `ai.provider_fallback` is off — "no route row" and "secret
   * missing" need different fixes, and by then the branch that knew is gone.
   */
  fallbackReason?: string;
};

/**
 * Where named secrets are read from. On Cloudflare the Worker `env` is not
 * `process.env`, so callers running inside a scheduled handler should pass
 * their bindings explicitly. Anything with string values will do.
 */
export type SecretBag = Record<string, string | undefined>;

function secretsDefault(): SecretBag {
  return ambientEnv();
}

/**
 * The route to use when the database cannot supply one.
 *
 * `maxTokens` here is a last-resort default, not the ceiling in force: every
 * stage passes its own from `ai_runtime_config`, which is the one place an
 * operator moves it. Cluster's entry was 1024 -- the floor -- and, with no
 * `cluster` row in `ai_model_routes`, that floor WAS the effective ceiling for
 * every clustering call. deepseek-v4-flash spent all of it reasoning and
 * returned empty content, which is the failure `ai.cluster_max_tokens` exists
 * to end. Kept in step with that setting's `codeDefault` so a config outage
 * degrades to the same number rather than back to the broken one.
 */
const ENV_FALLBACK: Record<ModelTier, { model: string; maxTokens: number }> = {
  cluster: { model: "deepseek-v4-flash", maxTokens: 2048 },
  digest: { model: "deepseek-v4-pro", maxTokens: 8192 },
  reason: { model: "deepseek-v4-pro", maxTokens: 16384 },
};

/**
 * Raised when a route is unusable and the operator has turned provider fallback
 * off.
 *
 * The default is to fall back, because a news product that stops producing news
 * because a settings table hiccuped is a worse failure than one running slightly
 * stale config. But that default also means a provider swap that was never going
 * to work — inactive row, missing secret — looks like it succeeded and quietly
 * keeps billing DeepSeek. An operator mid-migration wants the opposite: fail
 * loudly, so the misconfiguration surfaces now rather than on next month's
 * invoice. `ai.provider_fallback` picks which of those two failure modes to have.
 */
export class AiRouteUnavailableError extends Error {
  constructor(capability: ModelTier, why: string) {
    super(
      `No usable AI route for "${capability}": ${why}. Provider fallback is ` +
        `turned off in AI Runtime settings, so this call is refused rather than ` +
        `silently routed to the built-in DeepSeek route.`,
    );
    this.name = "AiRouteUnavailableError";
  }
}

function envRoute(capability: ModelTier, secrets: SecretBag, reason: string): ResolvedRoute {
  const fallback = ENV_FALLBACK[capability];
  const key = `MODEL_${capability.toUpperCase()}`;
  return {
    fallbackReason: reason,
    capability,
    providerSlug: "deepseek",
    providerLabel: "DeepSeek (env fallback)",
    baseUrl: secrets["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    model: secrets[key] ?? fallback.model,
    maxTokens: fallback.maxTokens,
    temperature: undefined,
    source: "env-fallback",
    missingSecret: !secrets["DEEPSEEK_API_KEY"],
  };
}

type CacheEntry = { route: ResolvedRoute; at: number };
const CACHE_MS = 60_000;
const cache = new Map<ModelTier, CacheEntry>();

/** Drops the memo so a console save is visible immediately in this isolate. */
export function invalidateRouteCache(): void {
  cache.clear();
}

export async function resolveRoute(
  capability: ModelTier,
  secrets: SecretBag = secretsDefault(),
): Promise<ResolvedRoute> {
  const hit = cache.get(capability);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.route;

  let route: ResolvedRoute;
  try {
    // The same bag the provider secret comes from. It has to be passed: on
    // Cloudflare there is no `process.env`, so `createAdminClient()` with no
    // argument cannot reach the database, the read below fails, and every route
    // silently resolves to the env fallback — which would make this whole file
    // decorative in exactly the environment it matters in, and the console's AI
    // tab a lie. A Worker env bag carries VITE_SUPABASE_URL and
    // SUPABASE_SERVICE_ROLE_KEY alongside the provider keys, so one bag serves both.
    const db = createAdminClient(secrets);
    const { data: row, error } = await db
      .from("ai_model_routes")
      .select("capability, model, max_tokens, temperature, provider_id")
      .eq("capability", capability)
      .maybeSingle();

    if (error || !row) {
      route = envRoute(
        capability,
        secrets,
        error ? `reading ai_model_routes failed (${error.message})` : "no route is configured",
      );
    } else {
      // Deliberately a second query rather than a PostgREST embed. The Database
      // type here is hand-written, so it carries no relationship metadata for
      // the client to infer an embedded shape from — an `ai_providers (...)`
      // join would type as loosely as a cast. Two round trips behind a 60-second
      // memo costs nothing and stays honestly typed.
      const { data: p } = await db
        .from("ai_providers")
        .select("slug, label, base_url, api_key_env, active")
        .eq("id", row.provider_id)
        .maybeSingle();

      if (!p || !p.active) {
        route = envRoute(
          capability,
          secrets,
          p
            ? `provider "${p.slug}" is marked inactive`
            : "the configured provider no longer exists",
        );
      } else {
        const resolved: ResolvedRoute = {
          capability,
          providerSlug: p.slug,
          providerLabel: p.label,
          baseUrl: p.base_url,
          apiKeyEnv: p.api_key_env,
          model: row.model,
          maxTokens: row.max_tokens,
          temperature: row.temperature ?? undefined,
          source: "database",
          missingSecret: !secrets[p.api_key_env],
        };
        // A configured provider whose secret was never set would fail on the
        // first real call. Prefer the known-good env path and let the console
        // surface the missing secret.
        route = resolved.missingSecret
          ? envRoute(capability, secrets, `${p.api_key_env} is not set in this environment`)
          : resolved;
      }
    }
  } catch (cause) {
    route = envRoute(
      capability,
      secrets,
      `the configuration database was unreachable (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }

  cache.set(capability, { route, at: Date.now() });
  return route;
}

/** The stored system prompt for a key, or "" when unset. Never throws. */
export async function resolvePrompt(
  key: string,
  secrets: SecretBag = secretsDefault(),
): Promise<string> {
  try {
    const db = createAdminClient(secrets);
    const { data } = await db
      .from("ai_prompts")
      .select("system_prompt")
      .eq("key", key)
      .maybeSingle();
    return data?.system_prompt ?? "";
  } catch {
    return "";
  }
}

export type RoutedOptions = {
  capability: ModelTier;
  user: string;
  /** Overrides the stored prompt. Omit to use `promptKey`, or neither for none. */
  system?: string;
  promptKey?: string;
  /** Overrides the route's ceiling. Remember it must cover reasoning tokens. */
  maxTokens?: number;
  secrets?: SecretBag;
  signal?: AbortSignal;
  /** Present on per-reader work so the monthly plan budget is enforced atomically. */
  meterUserId?: string;
  userMonthlyTokenCap?: number;
  /**
   * Which of the six call sites is making this call (0053). Required so the
   * ledger can answer "where exactly did my $X go?" per feature.
   */
  feature: "cluster" | "analyse" | "enrich" | "translate" | "impact" | "ask" | "probe";
  eventIds?: string[];
  articleId?: string;
  promptVersion?: string;
  evidenceCharacters?: number;
  sourceCount?: number;
  invocationReason?: string;
  budgetExceptionReason?: string;
  thinking?: "enabled" | "disabled";
};

export type RoutedResult = CompleteResult & { route: ResolvedRoute };

/**
 * The call every part of the app should use. Resolves the route, then hands the
 * transport in `deepseek.ts` a synthetic env so it targets whichever
 * OpenAI-compatible provider the console selected.
 */
export async function completeRouted(opts: RoutedOptions): Promise<RoutedResult> {
  const { route, call } = await prepare(opts);
  const { result } = await paidAttempt(opts, route, call, 1, crypto.randomUUID());
  return { ...result, route };
}

/** Meter the admin's explicit provider without replacing it with a configured route. */
export async function meterProviderProbe(
  route: ResolvedRoute,
  user: string,
  secrets: SecretBag,
  send: () => Promise<CompleteResult>,
): Promise<void> {
  await paidAttempt(
    {
      capability: route.capability,
      feature: "probe",
      user,
      secrets,
      promptVersion: "provider-probe-1",
      invocationReason: "admin_connection_test",
    },
    route,
    { tier: route.capability, user, maxTokens: route.maxTokens },
    1,
    crypto.randomUUID(),
    send,
  );
}

async function paidAttempt(
  opts: RoutedOptions,
  route: ResolvedRoute,
  call: CompleteOptions,
  attempt: number,
  requestId: string,
  send: (options: CompleteOptions) => Promise<CompleteResult> = complete,
): Promise<{ result: CompleteResult; reservation: string | null }> {
  if (opts.feature !== "ask") {
    try {
      checkRequestBudget(opts.feature, call.system ?? "", call.user, opts.budgetExceptionReason);
    } catch (error) {
      await recordOps(
        createAdminClient(opts.secrets ?? secretsDefault()),
        "ai:request-budget",
        "warning",
        {
          feature: opts.feature,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }
  const reservation = await reserveUsage(opts, route, call);
  const started = Date.now();
  // The metadata write is required before spending. Deploy the migration first.
  if (opts.feature !== "ask" && reservation) {
    const promptHash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(call.system ?? "")),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { error } = await createAdminClient(opts.secrets ?? secretsDefault()).rpc(
      "record_ai_attempt",
      {
        p_id: reservation,
        p_meta: {
          request_id: requestId,
          attempt,
          provider: route.providerSlug,
          model: route.model,
          event_ids: opts.eventIds ?? [],
          article_id: opts.articleId ?? null,
          prompt_version: opts.promptVersion ?? "legacy",
          source_count: opts.sourceCount ?? 0,
          system_prompt_hash: promptHash,
          evidence_characters: opts.evidenceCharacters ?? 0,
          request_token_estimate: requestTokens(call.system ?? "", call.user),
          request_token_ceiling: requestTokenCeiling(call.system ?? "", call.user),
          output_ceiling: call.maxTokens ?? route.maxTokens,
          thinking: call.thinking ?? "provider-default",
          cache: "miss",
          reason: opts.invocationReason ?? opts.feature,
          retry_reason: attempt > 1 ? "invalid_json" : null,
          budget_exception_reason: opts.budgetExceptionReason ?? null,
        },
      },
    );
    if (error) {
      // No provider call has occurred, so this particular reservation is unbilled.
      await releaseUnusedReservation(opts, reservation, { status: 400 });
      throw new Error(`recording AI attempt: ${error.message}`);
    }
  }
  let result: CompleteResult;
  try {
    result = await send(call);
  } catch (error) {
    const usage = completionUsageFromError(error);
    if (usage) {
      try {
        await settleUsage(opts, reservation, usage, route, started);
      } catch (settlementError) {
        throw new CompletionUsageError(
          "Failed completion could not be settled",
          usage,
          settlementError,
        );
      }
    } else await releaseUnusedReservation(opts, reservation, error);
    throw error;
  }
  try {
    await settleUsage(opts, reservation, result, route, started);
  } catch (error) {
    throw new CompletionUsageError("AI response received but settlement failed", result, error);
  }
  return { result, reservation };
}

/**
 * `completeRouted` for a caller that wants JSON back.
 *
 * Each attempt is reserved and settled independently. The returned usage is
 * combined for the event record; it must never be settled a second time.
 */
export async function completeRoutedJson<T>(
  opts: RoutedOptions,
): Promise<{ data: T; usage: CompleteResult; route: ResolvedRoute; usageId: string | null }> {
  const { route, call } = await prepare(opts);
  const requestId = crypto.randomUUID();
  let usageId: string | null = null;
  const { data, usage } = await completeJson<T>(call, async (attemptCall, number) => {
    const paid = await paidAttempt(opts, route, attemptCall, number, requestId);
    usageId ??= paid.reservation;
    return paid.result;
  });
  return { data, usage, route, usageId };
}

export function completionUsageFromError(error: unknown): CompleteResult | null {
  if (error instanceof CompletionUsageError) return error.usage;
  if (error instanceof TruncatedCompletionError) {
    return {
      content: "",
      model: error.model,
      promptTokens: error.promptTokens,
      completionTokens: error.completionTokens,
      reasoningTokens: error.reasoningTokens,
      cachedTokens: error.cachedTokens,
      attempt_count: 1,
      usageReported: error.usageReported,
    };
  }
  return null;
}

export class AiBudgetExceededError extends Error {
  constructor(
    message = "An AI safety limit refused this reservation. Check Admin → Cost for current limits.",
  ) {
    super(message);
    this.name = "AiBudgetExceededError";
  }
}

export async function optionalEnrichmentAllowed(
  db: ReturnType<typeof createAdminClient>,
  secrets: SecretBag = secretsDefault(),
): Promise<boolean> {
  const { degradation } = budgetThresholds(secrets);
  if (degradation === 1) return true;
  const runtime = await loadAiRuntimeConfig(db, secrets);
  const { data, error } = await db.rpc("ai_spend_this_month");
  const spent = data?.[0]?.spent_microusd ?? 0;
  const allowed = !error && spent < runtime.monthlyCostUsd * MICROUSD_PER_USD * degradation;
  if (!allowed)
    await recordOps(db, "ai:budget", "warning", {
      feature: "enrich",
      reason: error ? "spend_check_failed" : "optional_enrichment_threshold",
      spent_microusd: spent,
    });
  return allowed;
}

let lastBudgetStatusAt = 0;

export function aiCapacityRetryAt(error: unknown, now = new Date()): Date | null {
  if (error instanceof CompletionUsageError && error.cause)
    return aiCapacityRetryAt(error.cause, now);
  if (error instanceof AiBudgetExceededError) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5));
  }
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;
  const message = error instanceof Error ? error.message : String(error);
  if (
    [429, 500, 502, 503, 504, 529].includes(status) ||
    /network|fetch failed|timed? ?out|temporarily unavailable/i.test(message) ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new Date(now.getTime() + 15 * 60_000);
  }
  return null;
}

export function isDefinitelyUnbilledAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Missing .*API_KEY|invalid api key|authentication|unauthorized|402 Payment Required/i.test(
      message,
    )
  )
    return true;
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;
  return [400, 401, 402, 403, 404, 422, 429].includes(status);
}

// Re-exported so existing callers keep one import site for AI budgeting even
// though the values themselves must stay importable without this module.
export { DEFAULT_AI_MONTHLY_TOKEN_BUDGET, DEFAULT_AI_MONTHLY_COST_USD } from "@/lib/ai/budget";

/**
 * The spend this reservation authorizes, priced at the worst reasonable rate.
 *
 * Null when the rate card cannot price the route. That is not "free" and must
 * never be coerced to zero — see `AiUnpricedRouteError`.
 */
function estimatedCostMicrousd(
  route: ResolvedRoute,
  promptTokens: number,
  completionTokens: number,
): number | null {
  return aiCostCeilingMicrousd({
    provider: route.providerSlug,
    model: route.model,
    promptTokens,
    completionTokens,
  });
}

/**
 * Raised when a route resolves to a model `src/lib/ai/cost.ts` has no rate for.
 *
 * Fail-closed on purpose. A spending ceiling can only bound what it can price,
 * so an unpriceable call is not a call worth a small risk — it is a call of
 * unknown size against a limit that exists precisely to make size known. The
 * console can route a capability at OpenAI, Groq, OpenRouter or Together, none
 * of which have rates here, and treating those as costing nothing would let the
 * one provider swap nobody costed run without a ceiling at all.
 *
 * So adding a provider is three steps, not two: insert the row, set the secret,
 * add its rates. The first two already fail loudly when skipped; this makes the
 * third do the same instead of failing quietly on an invoice.
 */
export class AiUnpricedRouteError extends Error {
  constructor(provider: string, model: string) {
    super(
      `No rate card entry for ${provider}/${model}, so its spend cannot be ` +
        `bounded. Add it to src/lib/ai/cost.ts before routing traffic there.`,
    );
    this.name = "AiUnpricedRouteError";
  }
}

async function reserveUsage(
  opts: RoutedOptions,
  route: ResolvedRoute,
  call: CompleteOptions,
): Promise<string | null> {
  const secrets = opts.secrets ?? secretsDefault();

  // Kill switch: if the operator has flipped the global kill switch, refuse
  // every call before a reservation is written and before a provider is
  // contacted. Deterministic processing continues regardless.
  const dbForFlags = createAdminClient(secrets);
  const { data: killFlag, error: killError } = await dbForFlags
    .from("feature_flags")
    .select("enabled")
    .eq("key", "ai_kill_switch")
    .maybeSingle();
  if (killError) throw new Error(`Reading AI kill switch: ${killError.message}`);
  if (killFlag?.enabled === true) {
    throw new AiBudgetExceededError("AI kill switch enabled.");
  }

  // Both monthly ceilings come from `ai_runtime_config` first, then the env var,
  // then the code default (0056). Before that they were read straight off
  // `secrets` here, which meant the number this function enforced was whatever
  // the *current* runtime happened to have — `.env` under `npm run pipeline`, a
  // Cloudflare variable in the Worker — and the two could disagree indefinitely
  // with nothing reporting it. The resolver clamps to the hard bounds in
  // runtime-config.ts, so a value that used to have to be rejected here as a
  // suspected typo is now impossible to store or read in the first place.
  const runtime = await loadAiRuntimeConfig(dbForFlags, secrets);

  // Refuse rather than fall back. `loadAiRuntimeConfig` skips an out-of-bounds
  // ceiling so the console can still render, but the reserve path must not spend
  // against a number nobody meant: `AI_MONTHLY_COST_USD=0.10` where `10` was
  // intended is finite and positive, and quietly continuing on the $10 default
  // would spend a hundred times what was asked for. Stopping loudly is the whole
  // point of the floors — see MIN_AI_MONTHLY_* in budget.ts.
  refuseInvalidCeiling(runtime, "ai.monthly_token_budget", "AI_MONTHLY_TOKEN_BUDGET");
  refuseInvalidCeiling(runtime, "ai.monthly_cost_usd", "AI_MONTHLY_COST_USD");

  const globalCap = runtime.monthlyTokenBudget;
  const { warning } = budgetThresholds(secrets);

  // Reserve this attempt only. JSON repair acquires another reservation before
  // sending its larger prompt. UTF-8 bytes bound input conservatively.
  const prompt = requestTokenCeiling(call.system ?? "", call.user);
  const completion = call.maxTokens ?? route.maxTokens;
  const reserve = prompt + completion;

  const costCapUsd = runtime.monthlyCostUsd;

  // Priced before anything is spent, and refused outright when it cannot be
  // priced. `p_estimated_cost_microusd` is nullable in SQL for older callers,
  // and a null there would add zero to month spend — so a route with no rate
  // card would slip past the ceiling on every single call.
  const estimated = estimatedCostMicrousd(route, prompt, completion);
  if (estimated === null) throw new AiUnpricedRouteError(route.providerSlug, route.model);

  // Daily per-model caps: the operator's numbers from `site_settings`, or an
  // environment override, or the built-in defaults. Read here rather than left
  // to the SQL defaults, because a cap the console can display but not change
  // is worse than no console at all.
  const daily = await dailyCapsMicrousd(dbForFlags, secrets);

  const db = createAdminClient(secrets);
  const { data, error } = await db.rpc("reserve_ai_tokens", {
    p_user_id: opts.meterUserId ?? null,
    p_capability: route.capability,
    p_model: route.model,
    p_reserve: reserve,
    p_user_monthly_cap: opts.userMonthlyTokenCap ?? 0,
    p_global_monthly_cap: globalCap,
    p_estimated_cost_microusd: estimated,
    p_global_monthly_cost_microusd: Math.round(costCapUsd * MICROUSD_PER_USD),
    p_daily_flash_cap_microusd: daily.flash,
    p_daily_pro_cap_microusd: daily.pro,
    // Tagged here as well as at settlement: a call that never settles is
    // exactly the spend an operator most needs attributed, and `settleUsage`
    // is the thing that did not run.
    p_feature: opts.feature,
  });
  if (error) throw new Error(`reserving AI budget: ${error.message}`);
  if (!data) {
    await recordOps(db, "ai:budget", "error", {
      state: "exhausted",
      capability: route.capability,
      model: route.model,
    });
    throw new AiBudgetExceededError();
  }
  if (Date.now() - lastBudgetStatusAt >= 5 * 60_000) {
    lastBudgetStatusAt = Date.now();
    const { data: spend } = await db.rpc("ai_spend_this_month");
    const used = spend?.[0]?.spent_microusd ?? 0;
    const cap = Math.round(costCapUsd * MICROUSD_PER_USD);
    const ratio = cap > 0 ? used / cap : 1;
    await recordOps(db, "ai:budget", ratio >= warning ? "warning" : "healthy", {
      state: ratio >= warning ? "nearing" : "available",
      spent_microusd: used,
      cap_microusd: cap,
      fraction: ratio,
    });
  }
  return data;
}

/**
 * Stops the pipeline on a ceiling that cannot be one.
 *
 * The message names where the bad value came from, because the fix differs: a
 * rejected database row is fixed in AI Runtime settings, a rejected env var is
 * fixed in whichever environment this runtime reads — and after 0056 the second
 * of those is usually a leftover that should simply be deleted.
 */
function refuseInvalidCeiling(
  runtime: AiRuntimeConfig,
  key: "ai.monthly_token_budget" | "ai.monthly_cost_usd",
  envVar: string,
): void {
  const invalid = runtime.resolved[key].invalid;
  if (!invalid) return;
  const where =
    invalid.source === "database"
      ? "the value saved in AI Runtime settings"
      : `${envVar} in this environment`;
  throw new Error(
    `Refusing to run: ${where} is ${String(invalid.value)}, which is ${invalid.reason}. ` +
      `Correct it in AI Runtime settings rather than spending against a ceiling nobody meant.`,
  );
}

async function settleUsage(
  opts: RoutedOptions,
  reservation: string | null,
  usage: CompleteResult,
  route: ResolvedRoute,
  started = Date.now(),
): Promise<void> {
  if (!reservation) return;
  // Missing usage is an unknown charge, not a zero-dollar success.
  if (usage.usageReported === false) return;
  const db = createAdminClient(opts.secrets ?? secretsDefault());
  const cost = aiCostMicrousd({
    provider: route.providerSlug,
    model: usage.model,
    promptTokens: usage.promptTokens,
    cachedPromptTokens: usage.cachedTokens,
    completionTokens: usage.completionTokens,
    // A call crossing a tariff boundary is charged conservatively at peak.
    at: isDeepSeekPeak(new Date(started)) ? new Date(started) : new Date(),
  });
  if (opts.feature !== "ask") {
    const { error } = await db.rpc("record_ai_attempt", {
      p_id: reservation,
      p_meta: {},
      p_usage: {
        model: usage.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        cached_tokens: usage.cachedTokens,
        cost_microusd: cost,
        reasoning_tokens: usage.reasoningTokens,
        latency_ms: Date.now() - started,
      },
    });
    if (error) throw new Error(`recording AI usage: ${error.message}`);
  }
  if (cost === null) throw new AiUnpricedRouteError(route.providerSlug, usage.model);
  const { error } = await db.rpc("settle_ai_tokens", {
    p_id: reservation,
    p_prompt_tokens: usage.promptTokens,
    p_cached_prompt_tokens: usage.cachedTokens,
    p_completion_tokens: usage.completionTokens,
    p_cost_microusd: cost,
    p_feature: opts.feature,
  });
  if (error) {
    await recordOps(db, "ai:settle:error", "error", {
      reservation,
      capability: route.capability,
      model: route.model,
      feature: opts.feature,
    });
    console.error(
      `settle_ai_tokens error for reservation=${reservation} capability=${route.capability} feature=${opts.feature}: ${error.message}`,
    );
    throw new Error(`AI settlement failed: ${error.message}`);
  }
}

async function releaseUnusedReservation(
  opts: RoutedOptions,
  reservation: string | null,
  error: unknown,
): Promise<void> {
  if (!reservation || !isDefinitelyUnbilledAiError(error)) return;
  const db = createAdminClient(opts.secrets ?? secretsDefault());
  const { error: releaseError } = await db.rpc("release_ai_reservation", { p_id: reservation });
  if (releaseError) console.error(`releasing unused AI reservation: ${releaseError.message}`);
}

/**
 * Resolves the route and expresses it as a `complete()` call.
 *
 * The transport keys off MODEL_<TIER> and DEEPSEEK_*, so the resolved route is
 * expressed in those terms. That keeps one code path for every provider instead
 * of a branch per vendor — they all speak the OpenAI dialect.
 */
async function prepare(
  opts: RoutedOptions,
): Promise<{ route: ResolvedRoute; call: CompleteOptions }> {
  const secrets = opts.secrets ?? secretsDefault();
  const route = await resolveRoute(opts.capability, secrets);
  const runtime = await loadAiRuntimeConfig(createAdminClient(secrets), secrets);

  // The gate lives here rather than inside `resolveRoute` so the route is still
  // resolved, cached and inspectable when fallback is refused — the console's
  // probe and status pages want to show WHAT it fell back to, not just that it
  // did. `resolveRoute` reports; this decides.
  if (route.source === "env-fallback" && !runtime.providerFallback) {
    throw new AiRouteUnavailableError(opts.capability, route.fallbackReason ?? "route unavailable");
  }

  const system =
    opts.system ?? (opts.promptKey ? await resolvePrompt(opts.promptKey, secrets) : undefined);

  // Spelled out per tier rather than with a computed key because
  // `exactOptionalPropertyTypes` is on: an optional property must be absent, not
  // present-and-undefined, so each field is spread in only when it has a value.
  const apiKey = secrets[route.apiKeyEnv];
  const thinking =
    opts.feature !== "ask" && route.providerSlug === "deepseek"
      ? (opts.thinking ??
        (opts.feature === "cluster" && !runtime.clusterThinking
          ? "disabled"
          : operationThinking(opts.feature, secrets)))
      : undefined;
  const synthetic: AiEnv = {
    DEEPSEEK_BASE_URL: route.baseUrl,
    ...(apiKey !== undefined ? { DEEPSEEK_API_KEY: apiKey } : {}),
    ...(route.capability === "cluster" ? { MODEL_CLUSTER: route.model } : {}),
    ...(route.capability === "digest" ? { MODEL_DIGEST: route.model } : {}),
    ...(route.capability === "reason" ? { MODEL_REASON: route.model } : {}),
  };

  return {
    route,
    call: {
      tier: route.capability,
      user: opts.user,
      ...(system ? { system } : {}),
      maxTokens: opts.maxTokens ?? route.maxTokens,
      ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
      // "default" means send nothing, so the request shape is unchanged from
      // before this knob existed. See `reasoningEffort` in deepseek.ts.
      ...(runtime.reasoningEffort !== "default" && thinking !== "disabled"
        ? { reasoningEffort: runtime.reasoningEffort }
        : {}),
      ...(thinking ? { thinking } : {}),
      env: synthetic,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  };
}
