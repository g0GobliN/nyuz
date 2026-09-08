import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly, audit, superadminOnly, AdminAuthError } from "@/lib/server/guard";
import { invalidateRouteCache } from "@/lib/ai/config";
import { ambientEnv } from "@/lib/runtime-env";
import { loadAiRuntimeConfig } from "@/lib/ai/runtime-config";
import type { AiCapability } from "@/lib/supabase/types";

/**
 * AI provider configuration.
 *
 * The point of this file is that swapping DeepSeek for something else is a
 * database edit, not a deploy. What makes that safe rather than reckless is the
 * split below:
 *
 *   - Reading config is `adminOnly`. Editing prompt wording is `adminOnly`,
 *     because a badly worded prompt produces a worse briefing and nothing more.
 *   - Changing a provider or a route is `superadminOnly`, because it changes
 *     where every article the pipeline touches gets sent, and which secret pays
 *     for it. That is a different category of mistake.
 *
 * Keys never appear here in either direction. The console writes and reads the
 * NAME of an env var; `secretPresent` is computed server-side by checking
 * whether that name resolves, so an operator can see "configured / not
 * configured" without the value ever being sent to a browser.
 */

/* ---------------------------------------------------------------------- */
/* Shapes                                                                 */
/* ---------------------------------------------------------------------- */

export type ProviderView = {
  id: string;
  slug: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  active: boolean;
  notes: string;
  /** Whether the named env var actually resolves in this environment. */
  secretPresent: boolean;
  updatedAt: string;
};

export type RouteView = {
  capability: AiCapability;
  providerId: string;
  providerSlug: string;
  model: string;
  maxTokens: number;
  temperature: number | null;
  updatedAt: string;
};

export type PromptView = {
  key: string;
  label: string;
  systemPrompt: string;
  updatedAt: string;
};

export type AiConfigView = {
  providers: ProviderView[];
  routes: RouteView[];
  prompts: PromptView[];
  /** How long a change takes to reach every isolate. Surfaced in the UI. */
  cacheSeconds: number;
  usage: {
    monthTokens: number;
    reservedTokens: number;
    calls: number;
    budgetTokens: number;
    byCapability: Record<AiCapability, number>;
  };
};

function secretPresent(name: string): boolean {
  const value = ambientEnv()[name];
  return typeof value === "string" && value.length > 0;
}

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AiConfigView> => {
    const db = context.actor.db;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [providers, routes, prompts, usage] = await Promise.all([
      db.from("ai_providers").select("*").order("slug"),
      db.from("ai_model_routes").select("*"),
      db.from("ai_prompts").select("*").order("key"),
      db
        .from("ai_usage_ledger")
        .select("capability, prompt_tokens, completion_tokens, reserved_tokens")
        .gte("created_at", monthStart.toISOString()),
    ]);

    if (providers.error) throw new AdminAuthError(`Providers: ${providers.error.message}`, 500);
    if (routes.error) throw new AdminAuthError(`Routes: ${routes.error.message}`, 500);
    if (prompts.error) throw new AdminAuthError(`Prompts: ${prompts.error.message}`, 500);
    if (usage.error) throw new AdminAuthError(`AI usage: ${usage.error.message}`, 500);

    const slugById = new Map((providers.data ?? []).map((p) => [p.id, p.slug]));

    const byCapability: Record<AiCapability, number> = { cluster: 0, digest: 0, reason: 0 };
    let monthTokens = 0;
    let reservedTokens = 0;
    for (const row of usage.data ?? []) {
      const tokens = Math.max(row.reserved_tokens, row.prompt_tokens + row.completion_tokens);
      monthTokens += tokens;
      reservedTokens += row.reserved_tokens;
      byCapability[row.capability] += tokens;
    }
    // The resolver clamps to the bounds in runtime-config.ts and falls back
    // through env to the code default, so this can no longer be NaN and no
    // longer disagrees with the ceiling the reserve path enforces (0056).
    const { monthlyTokenBudget: budgetTokens } = await loadAiRuntimeConfig(db);

    return {
      providers: (providers.data ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        label: p.label,
        baseUrl: p.base_url,
        apiKeyEnv: p.api_key_env,
        active: p.active,
        notes: p.notes,
        secretPresent: secretPresent(p.api_key_env),
        updatedAt: p.updated_at,
      })),
      routes: (routes.data ?? []).map((r) => ({
        capability: r.capability,
        providerId: r.provider_id,
        providerSlug: slugById.get(r.provider_id) ?? "unknown",
        model: r.model,
        maxTokens: r.max_tokens,
        temperature: r.temperature,
        updatedAt: r.updated_at,
      })),
      prompts: (prompts.data ?? []).map((p) => ({
        key: p.key,
        label: p.label,
        systemPrompt: p.system_prompt,
        updatedAt: p.updated_at,
      })),
      cacheSeconds: 60,
      usage: {
        monthTokens,
        reservedTokens,
        calls: usage.data?.length ?? 0,
        budgetTokens: Number.isFinite(budgetTokens) ? budgetTokens : 0,
        byCapability,
      },
    };
  });

/* ---------------------------------------------------------------------- */
/* Validation                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Env var names only: uppercase, digits, underscore. Two reasons this is strict.
 *
 * A lowercase or hyphenated name is almost always a typo that would silently
 * resolve to nothing. And more importantly, this field is a common place to
 * paste the key itself by mistake — which would put a live provider credential
 * into a table the console can read back. The `looksLikeKey` check below makes
 * that specific slip loud instead of silent.
 */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Detects a pasted credential in the env-name field.
 *
 * `ENV_NAME_RE` would reject these anyway — the point of this check is purely
 * the error message. "That looks like a key" tells the operator what they did;
 * "must be uppercase letters and underscores" leaves them guessing. Checked
 * first for that reason.
 */
function looksLikeKey(value: string): boolean {
  if (/^(sk|pk|rk|gsk|api|xai|hf|key)[-_]/i.test(value)) return true;
  if (value.length > 64) return true;
  // A long run of mixed case and digits with no underscore is a token, not a name.
  return value.length > 24 && /[a-z]/.test(value) && /\d/.test(value) && !value.includes("_");
}

/**
 * Base URLs are restricted to https and to public hosts.
 *
 * Only a superadmin reaches this, and a superadmin can already do a great deal
 * of damage — but this field turns into a server-side `fetch()` target, so a
 * stolen superadmin session would otherwise be a way to make the Worker request
 * internal addresses and return the response. Blocking loopback, link-local and
 * private ranges costs nothing and closes that pivot.
 */
const BLOCKED_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)|\.internal$|\.local$/i;

function checkBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AdminAuthError("Base URL is not a valid URL.", 400);
  }
  if (url.protocol !== "https:") {
    throw new AdminAuthError("Base URL must use https.", 400);
  }
  if (BLOCKED_HOST_RE.test(url.hostname)) {
    throw new AdminAuthError("Base URL must be a public host.", 400);
  }
  // Trailing slashes produce "//chat/completions" once a path is appended, which
  // some gateways reject. Normalise now rather than debugging it later.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/* ---------------------------------------------------------------------- */
/* Providers                                                              */
/* ---------------------------------------------------------------------- */

const providerInput = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Slug must be lowercase letters, digits and hyphens."),
  label: z.string().min(1).max(80),
  baseUrl: z.string().min(8).max(300),
  apiKeyEnv: z.string().min(3).max(64),
  active: z.boolean().optional().default(true),
  notes: z.string().max(500).optional().default(""),
});

export const saveProvider = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) => providerInput.parse(input))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const { actor } = context;

    const apiKeyEnv = data.apiKeyEnv.trim();
    if (looksLikeKey(apiKeyEnv)) {
      throw new AdminAuthError(
        "That looks like an API key, not an environment variable name. Store the key with `wrangler secret put` and put the variable's NAME here.",
        400,
      );
    }
    if (!ENV_NAME_RE.test(apiKeyEnv)) {
      throw new AdminAuthError(
        "Environment variable names must be uppercase letters, digits and underscores, e.g. OPENAI_API_KEY.",
        400,
      );
    }

    const baseUrl = checkBaseUrl(data.baseUrl.trim());

    const fields = {
      slug: data.slug,
      label: data.label,
      base_url: baseUrl,
      api_key_env: apiKeyEnv,
      active: data.active,
      notes: data.notes,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await actor.db.from("ai_providers").update(fields).eq("id", data.id);
      if (error) throw providerError(error, "Update provider");
      invalidateRouteCache();
      await audit(
        actor,
        "ai.provider.update",
        { type: "ai_provider", id: data.id },
        { slug: data.slug, active: data.active },
      );
      return { id: data.id };
    }

    const { data: created, error } = await actor.db
      .from("ai_providers")
      .insert(fields)
      .select("id")
      .single();
    if (error) throw providerError(error, "Create provider");

    invalidateRouteCache();
    await audit(
      actor,
      "ai.provider.create",
      { type: "ai_provider", id: created.id },
      { slug: data.slug },
    );
    return { id: created.id };
  });

function providerError(error: { code?: string; message: string }, what: string): AdminAuthError {
  if (error.code === "23505") {
    return new AdminAuthError("A provider with that slug already exists.", 409);
  }
  return new AdminAuthError(`${what}: ${error.message}`, 500);
}

export const deleteProvider = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.actor.db.from("ai_providers").delete().eq("id", data.id);
    // The schema uses `on delete restrict` on ai_model_routes.provider_id, so
    // Postgres refuses to orphan a live route. Translate 23503 rather than
    // showing the operator a foreign-key message.
    if (error?.code === "23503") {
      throw new AdminAuthError(
        "This provider is still routing traffic. Point every capability at another provider first.",
        409,
      );
    }
    if (error) throw new AdminAuthError(`Delete provider: ${error.message}`, 500);

    invalidateRouteCache();
    await audit(context.actor, "ai.provider.delete", { type: "ai_provider", id: data.id });
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Routes                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * A floor on the token ceiling.
 *
 * Reasoning models spend completion tokens on hidden reasoning before any
 * visible content appears — a "reply ok" probe once burned 27 of 29 tokens that
 * way. Set a route to 256 and every call returns HTTP 200 with empty content
 * and `finish_reason: "length"`, which reads as "the AI produced nothing" rather
 * than "the ceiling is too low". Refusing the value is kinder than debugging it.
 */
const MIN_MAX_TOKENS = 1024;

const routeInput = z.object({
  capability: z.enum(["cluster", "digest", "reason"]),
  providerId: z.string().uuid(),
  model: z.string().min(1).max(120),
  maxTokens: z.number().int().min(1).max(200_000),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

export const setRoute = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) => routeInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    if (data.maxTokens < MIN_MAX_TOKENS) {
      throw new AdminAuthError(
        `Max tokens must be at least ${MIN_MAX_TOKENS}. Reasoning models spend completion tokens on hidden reasoning before producing any visible output, so a low ceiling returns empty content instead of an error.`,
        400,
      );
    }

    const { data: provider, error: providerLookup } = await actor.db
      .from("ai_providers")
      .select("slug, active, api_key_env")
      .eq("id", data.providerId)
      .maybeSingle();
    if (providerLookup) throw new AdminAuthError(`Provider lookup: ${providerLookup.message}`, 500);
    if (!provider) throw new AdminAuthError("That provider no longer exists.", 404);
    if (!provider.active) {
      throw new AdminAuthError(
        "That provider is inactive. Activate it before routing traffic to it.",
        400,
      );
    }
    // Routing to a provider whose secret was never set would fall straight back
    // to the env default on the next call, which looks like the save silently
    // failed. Say so at save time instead.
    if (!secretPresent(provider.api_key_env)) {
      throw new AdminAuthError(
        `${provider.api_key_env} is not set in this environment. Run \`wrangler secret put ${provider.api_key_env}\` first — until then this route would fall back to the default provider.`,
        400,
      );
    }

    const { error } = await actor.db.from("ai_model_routes").upsert({
      capability: data.capability,
      provider_id: data.providerId,
      model: data.model.trim(),
      max_tokens: data.maxTokens,
      temperature: data.temperature ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new AdminAuthError(`Save route: ${error.message}`, 500);

    invalidateRouteCache();
    await audit(
      actor,
      "ai.route.set",
      { type: "ai_route", id: data.capability },
      {
        provider: provider.slug,
        model: data.model,
        maxTokens: data.maxTokens,
      },
    );
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Prompts                                                                */
/* ---------------------------------------------------------------------- */

const promptInput = z.object({
  key: z.string().min(1).max(60),
  label: z.string().max(120).optional().default(""),
  systemPrompt: z.string().max(20_000),
});

export const savePrompt = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => promptInput.parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;
    const { data: existing } = await actor.db
      .from("ai_prompts")
      .select("label")
      .eq("key", data.key)
      .maybeSingle();

    const { error } = await actor.db.from("ai_prompts").upsert({
      key: data.key,
      label: data.label || existing?.label || data.key,
      system_prompt: data.systemPrompt,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new AdminAuthError(`Save prompt: ${error.message}`, 500);

    // The length, not the text: prompts can run to thousands of characters and
    // the audit log is not the place to keep every revision of them.
    await audit(
      actor,
      "ai.prompt.save",
      { type: "ai_prompt", id: data.key },
      {
        length: data.systemPrompt.length,
      },
    );
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Connection test                                                        */
/* ---------------------------------------------------------------------- */

export type ProbeResult = {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  modelEcho: string;
  finishReason: string;
  contentChars: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Plain-language verdict. The whole point of the probe. */
  diagnosis: string;
};

const probeInput = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1).max(120),
  maxTokens: z.number().int().min(1).max(200_000).optional().default(2048),
});

/**
 * Calls the provider for real before production traffic does.
 *
 * This is the most useful button in the AI tab. Swapping providers blind means
 * discovering at 6am that every briefing is empty, and the failure mode that
 * matters is not an HTTP error — it is a 200 response with empty content
 * because the model spent the whole ceiling on reasoning. So the probe reports
 * `finish_reason` and the reasoning token count and names that case explicitly
 * rather than just showing a green tick for "connected".
 *
 * Uses `fetch` rather than the OpenAI SDK so a non-200 is data to report, not
 * an exception to catch.
 */
export const probeProvider = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) => probeInput.parse(input))
  .handler(async ({ context, data }): Promise<ProbeResult> => {
    const { actor } = context;
    const { data: provider, error } = await actor.db
      .from("ai_providers")
      .select("slug, base_url, api_key_env")
      .eq("id", data.providerId)
      .maybeSingle();
    if (error) throw new AdminAuthError(`Provider lookup: ${error.message}`, 500);
    if (!provider) throw new AdminAuthError("That provider no longer exists.", 404);

    const key = ambientEnv()[provider.api_key_env];
    if (!key) {
      return {
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        modelEcho: "",
        finishReason: "",
        contentChars: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        diagnosis: `${provider.api_key_env} is not set in this environment. Run \`wrangler secret put ${provider.api_key_env}\` and redeploy.`,
      };
    }

    const url = `${checkBaseUrl(provider.base_url)}/chat/completions`;
    const started = Date.now();

    let res: Response;
    let body: ProbeBody = {};
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: data.model,
          max_tokens: data.maxTokens,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      body = (await res.json().catch(() => ({}))) as ProbeBody;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await audit(
        actor,
        "ai.provider.probe",
        { type: "ai_provider", id: data.providerId },
        {
          ok: false,
          model: data.model,
        },
      );
      return {
        ok: false,
        httpStatus: 0,
        latencyMs: Date.now() - started,
        modelEcho: "",
        finishReason: "",
        contentChars: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        diagnosis: `Could not reach ${provider.slug}: ${message}`,
      };
    }

    const latencyMs = Date.now() - started;
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason ?? "";
    const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const contentChars = content.trim().length;

    let diagnosis: string;
    let ok = false;

    if (!res.ok) {
      const detail = body.error?.message ?? `HTTP ${res.status}`;
      diagnosis =
        res.status === 401 || res.status === 403
          ? `Rejected the key in ${provider.api_key_env} (${detail}). Check the secret's value and that it belongs to this provider.`
          : res.status === 404
            ? `${provider.slug} does not recognise the model "${data.model}" or the path ${url} (${detail}). List the provider's models and check the exact id.`
            : res.status === 429
              ? `Rate limited (${detail}). The credentials work; the account is throttled or out of quota.`
              : `${provider.slug} returned ${res.status}: ${detail}`;
    } else if (contentChars === 0 && finishReason === "length") {
      diagnosis = `Connected, but the model spent all ${data.maxTokens} tokens on reasoning (${reasoningTokens} reasoning tokens) and returned no visible content. Raise max tokens for this route — this is the failure that produces blank briefings with no error.`;
    } else if (contentChars === 0) {
      diagnosis = `Connected, but the response contained no content (finish_reason: "${finishReason || "none"}"). Check whether this model needs different parameters.`;
    } else {
      ok = true;
      diagnosis = `Working. ${provider.slug} answered in ${latencyMs} ms with ${contentChars} characters${reasoningTokens ? `, after ${reasoningTokens} reasoning tokens` : ""}.`;
    }

    await audit(
      actor,
      "ai.provider.probe",
      { type: "ai_provider", id: data.providerId },
      {
        ok,
        model: data.model,
        httpStatus: res.status,
        latencyMs,
      },
    );

    return {
      ok,
      httpStatus: res.status,
      latencyMs,
      modelEcho: body.model ?? "",
      finishReason,
      contentChars,
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      reasoningTokens,
      diagnosis,
    };
  });

type ProbeBody = {
  model?: string;
  error?: { message?: string };
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};
