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
import { aiCostCeilingMicrousd, aiCostMicrousd } from "@/lib/ai/cost";
import { dailyCapsMicrousd } from "@/lib/ai/launch-flags";
import {
  configuredCeiling,
  DEFAULT_AI_MONTHLY_COST_USD,
  DEFAULT_AI_MONTHLY_TOKEN_BUDGET,
  MICROUSD_PER_USD,
  MIN_AI_MONTHLY_COST_USD,
  MIN_AI_MONTHLY_TOKEN_BUDGET,
} from "@/lib/ai/budget";

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

const ENV_FALLBACK: Record<ModelTier, { model: string; maxTokens: number }> = {
  cluster: { model: "deepseek-v4-flash", maxTokens: 1024 },
  digest: { model: "deepseek-v4-pro", maxTokens: 8192 },
  reason: { model: "deepseek-v4-pro", maxTokens: 16384 },
};

function envRoute(capability: ModelTier, secrets: SecretBag): ResolvedRoute {
  const fallback = ENV_FALLBACK[capability];
  const key = `MODEL_${capability.toUpperCase()}`;
  return {
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
      route = envRoute(capability, secrets);
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
        route = envRoute(capability, secrets);
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
        route = resolved.missingSecret ? envRoute(capability, secrets) : resolved;
      }
    }
  } catch {
    route = envRoute(capability, secrets);
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
  feature: "cluster" | "analyse" | "enrich" | "translate" | "impact" | "ask";
};

export type RoutedResult = CompleteResult & { route: ResolvedRoute };

/**
 * The call every part of the app should use. Resolves the route, then hands the
 * transport in `deepseek.ts` a synthetic env so it targets whichever
 * OpenAI-compatible provider the console selected.
 */
export async function completeRouted(opts: RoutedOptions): Promise<RoutedResult> {
  const { route, call } = await prepare(opts);
  const reservation = await reserveUsage(opts, route, call, false);
  try {
    const result = await complete(call);
    await settleUsage(opts, reservation, result, route);
    return { ...result, route };
  } catch (error) {
    const usage = completionUsageFromError(error);
    if (usage) await settleUsage(opts, reservation, usage, route);
    else await releaseUnusedReservation(opts, reservation, error);
    throw error;
  }
}

/**
 * `completeRouted` for a caller that wants JSON back.
 *
 * Exists so the pipeline gets the routing and the parse-with-one-retry in a single
 * call. Written in terms of the same `prepare` as `completeRouted` rather than
 * wrapping it, because `completeJson` has to own the retry — it is the only place
 * that can see the malformed reply, and its returned usage is the sum of both
 * attempts, which a wrapper around a single completion could not report.
 */
export async function completeRoutedJson<T>(
  opts: RoutedOptions,
): Promise<{ data: T; usage: CompleteResult; route: ResolvedRoute; usageId: string | null }> {
  const { route, call } = await prepare(opts);
  const reservation = await reserveUsage(opts, route, call, true);
  try {
    const { data, usage } = await completeJson<T>(call);
    await settleUsage(opts, reservation, usage, route);
    // The ledger row id goes back to the caller so a stage can join its own
    // decision to the spend that bought it (0057) instead of copying token
    // counts into a second table that will eventually disagree with this one.
    return { data, usage, route, usageId: reservation };
  } catch (error) {
    const usage = completionUsageFromError(error);
    if (usage) await settleUsage(opts, reservation, usage, route);
    else await releaseUnusedReservation(opts, reservation, error);
    throw error;
  }
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
    };
  }
  return null;
}

export class AiBudgetExceededError extends Error {
  constructor() {
    super("The configured monthly AI budget has been reached.");
    this.name = "AiBudgetExceededError";
  }
}

let lastBudgetStatusAt = 0;

export function aiCapacityRetryAt(error: unknown, now = new Date()): Date | null {
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
  mayRetry: boolean,
): Promise<string | null> {
  const secrets = opts.secrets ?? secretsDefault();

  // Kill switch: if the operator has flipped the global kill switch, refuse
  // every call before a reservation is written and before a provider is
  // contacted. Deterministic processing continues regardless.
  const dbForFlags = createAdminClient(secrets);
  const { data: killFlag } = await dbForFlags
    .from("feature_flags")
    .select("enabled")
    .eq("key", "ai_kill_switch")
    .maybeSingle();
  if (killFlag?.enabled === true) {
    throw new AiBudgetExceededError();
  }

  const configured = secrets["AI_MONTHLY_TOKEN_BUDGET"];
  const globalCap =
    configured === undefined || configured.trim() === ""
      ? DEFAULT_AI_MONTHLY_TOKEN_BUDGET
      : configuredCeiling(configured, MIN_AI_MONTHLY_TOKEN_BUDGET);
  if (globalCap === null) {
    throw new Error(
      `AI_MONTHLY_TOKEN_BUDGET must be a token count of at least ${MIN_AI_MONTHLY_TOKEN_BUDGET}. Anything lower refuses every call and stops the pipeline.`,
    );
  }

  // A reasoning completion can consume its whole ceiling, and JSON gets one
  // repair retry. Input is approximated at 2.5 characters/token: English runs
  // nearer four, but Ask takes a free-text question and `translate.ts` handles
  // CJK, where a character can be most of a token. Erring low here would shrink
  // the very number the ceiling is computed from.
  const prompt = Math.ceil(((call.system?.length ?? 0) + call.user.length) / 2.5);
  const completion = (call.maxTokens ?? route.maxTokens) * (mayRetry ? 2 : 1);
  const reserve = prompt + completion;

  const configuredCost = secrets["AI_MONTHLY_COST_USD"];
  const costCapUsd =
    configuredCost === undefined || configuredCost.trim() === ""
      ? DEFAULT_AI_MONTHLY_COST_USD
      : configuredCeiling(configuredCost, MIN_AI_MONTHLY_COST_USD);
  if (costCapUsd === null) {
    throw new Error(
      `AI_MONTHLY_COST_USD must be a dollar amount of at least ${MIN_AI_MONTHLY_COST_USD}. A slipped decimal here refuses every call and looks like a provider outage.`,
    );
  }

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
    await recordOps(db, "ai:budget", ratio >= 0.8 ? "warning" : "healthy", {
      state: ratio >= 0.8 ? "nearing" : "available",
      spent_microusd: used,
      cap_microusd: cap,
      fraction: ratio,
    });
  }
  return data;
}

async function settleUsage(
  opts: RoutedOptions,
  reservation: string | null,
  usage: CompleteResult,
  route: ResolvedRoute,
): Promise<void> {
  if (!reservation) return;
  const db = createAdminClient(opts.secrets ?? secretsDefault());
  const { error } = await db.rpc("settle_ai_tokens", {
    p_id: reservation,
    p_prompt_tokens: usage.promptTokens,
    p_cached_prompt_tokens: usage.cachedTokens,
    p_completion_tokens: usage.completionTokens,
    p_cost_microusd: aiCostMicrousd({
      provider: route.providerSlug,
      model: usage.model,
      promptTokens: usage.promptTokens,
      cachedPromptTokens: usage.cachedTokens,
      completionTokens: usage.completionTokens,
    }),
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

  const system =
    opts.system ?? (opts.promptKey ? await resolvePrompt(opts.promptKey, secrets) : undefined);

  // Spelled out per tier rather than with a computed key because
  // `exactOptionalPropertyTypes` is on: an optional property must be absent, not
  // present-and-undefined, so each field is spread in only when it has a value.
  const apiKey = secrets[route.apiKeyEnv];
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
      env: synthetic,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  };
}
