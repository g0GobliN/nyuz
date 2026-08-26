import { createAdminClient } from "@/lib/supabase/admin";
import {
  complete,
  completeJson,
  type AiEnv,
  type CompleteOptions,
  type CompleteResult,
  type ModelTier,
} from "@/lib/ai/deepseek";

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
  return (globalThis.process?.env ?? {}) as SecretBag;
}

const ENV_FALLBACK: Record<ModelTier, { model: string; maxTokens: number }> = {
  cluster: { model: "deepseek-v4-flash", maxTokens: 4096 },
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
  const result = await complete(call);
  await settleUsage(opts, reservation, result);
  return { ...result, route };
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
): Promise<{ data: T; usage: CompleteResult; route: ResolvedRoute }> {
  const { route, call } = await prepare(opts);
  const reservation = await reserveUsage(opts, route, call, true);
  const { data, usage } = await completeJson<T>(call);
  await settleUsage(opts, reservation, usage);
  return { data, usage, route };
}

export class AiBudgetExceededError extends Error {
  constructor() {
    super("The configured monthly AI token budget has been reached.");
    this.name = "AiBudgetExceededError";
  }
}

async function reserveUsage(
  opts: RoutedOptions,
  route: ResolvedRoute,
  call: CompleteOptions,
  mayRetry: boolean,
): Promise<string | null> {
  const secrets = opts.secrets ?? secretsDefault();
  const configured = secrets["AI_MONTHLY_TOKEN_BUDGET"];
  if (!configured) return null;
  const globalCap = Number(configured);
  if (!Number.isFinite(globalCap) || globalCap <= 0) {
    throw new Error("AI_MONTHLY_TOKEN_BUDGET must be a positive token count.");
  }

  // A reasoning completion can consume its whole ceiling, and JSON gets one
  // repair retry. Approximate input conservatively at three characters/token.
  const prompt = Math.ceil(((call.system?.length ?? 0) + call.user.length) / 3);
  const completion = (call.maxTokens ?? route.maxTokens) * (mayRetry ? 2 : 1);
  const reserve = prompt + completion;
  const db = createAdminClient(secrets);
  const { data, error } = await db.rpc("reserve_ai_tokens", {
    p_user_id: opts.meterUserId ?? null,
    p_capability: route.capability,
    p_model: route.model,
    p_reserve: reserve,
    p_user_monthly_cap: opts.userMonthlyTokenCap ?? 0,
    p_global_monthly_cap: globalCap,
  });
  if (error) throw new Error(`reserving AI budget: ${error.message}`);
  if (!data) throw new AiBudgetExceededError();
  return data;
}

async function settleUsage(
  opts: RoutedOptions,
  reservation: string | null,
  usage: CompleteResult,
): Promise<void> {
  if (!reservation) return;
  const db = createAdminClient(opts.secrets ?? secretsDefault());
  const { error } = await db.rpc("settle_ai_tokens", {
    p_id: reservation,
    p_prompt_tokens: usage.promptTokens,
    p_completion_tokens: usage.completionTokens,
  });
  // The provider call already succeeded. Keep the reservation as a conservative
  // charge and surface the accounting failure without breaking the product.
  if (error) console.error(`settling AI budget: ${error.message}`);
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
