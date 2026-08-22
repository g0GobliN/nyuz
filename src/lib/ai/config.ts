import { createAdminClient } from "@/lib/supabase/admin";
import { complete, type AiEnv, type CompleteResult, type ModelTier } from "@/lib/ai/deepseek";

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
    const db = createAdminClient();
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
export async function resolvePrompt(key: string): Promise<string> {
  try {
    const db = createAdminClient();
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
};

export type RoutedResult = CompleteResult & { route: ResolvedRoute };

/**
 * The call every part of the app should use. Resolves the route, then hands the
 * transport in `deepseek.ts` a synthetic env so it targets whichever
 * OpenAI-compatible provider the console selected.
 */
export async function completeRouted(opts: RoutedOptions): Promise<RoutedResult> {
  const secrets = opts.secrets ?? secretsDefault();
  const route = await resolveRoute(opts.capability, secrets);

  const system = opts.system ?? (opts.promptKey ? await resolvePrompt(opts.promptKey) : undefined);

  // The transport keys off MODEL_<TIER> and DEEPSEEK_*, so the resolved route is
  // expressed in those terms. That keeps one code path for every provider
  // instead of a branch per vendor — they all speak the OpenAI dialect.
  //
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

  const result = await complete({
    tier: route.capability,
    user: opts.user,
    ...(system ? { system } : {}),
    maxTokens: opts.maxTokens ?? route.maxTokens,
    ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
    env: synthetic,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  return { ...result, route };
}
