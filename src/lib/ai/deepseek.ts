import OpenAI from "openai";

/**
 * DeepSeek client. The API is OpenAI-compatible, so the `openai` SDK drives it
 * with a different base URL. Server-side only — the key must never reach the
 * browser.
 *
 * Both models on this account are REASONING models: completion tokens are spent
 * on hidden reasoning before any visible content appears. A "reply ok" probe
 * burned 27 of 29 completion tokens on reasoning. Two consequences the callers
 * here must live with:
 *
 *   1. max_tokens has to cover reasoning AND output. Size it for the reasoning,
 *      not for the sentence you expect back.
 *   2. Running out mid-reasoning returns HTTP 200 with content: "" and
 *      finish_reason: "length" — no exception, no error field. Unguarded, that
 *      surfaces as a silently blank briefing, so `complete()` treats it as the
 *      failure it is.
 */

export type ModelTier = "cluster" | "digest" | "reason";

export type AiEnv = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  MODEL_CLUSTER?: string;
  MODEL_DIGEST?: string;
  MODEL_REASON?: string;
};

const FALLBACK_MODELS: Record<ModelTier, string> = {
  cluster: "deepseek-v4-flash",
  digest: "deepseek-v4-pro",
  reason: "deepseek-v4-pro",
};

function env(e: AiEnv | undefined, key: keyof AiEnv): string | undefined {
  return e?.[key] ?? globalThis.process?.env?.[key];
}

export function modelFor(tier: ModelTier, e?: AiEnv): string {
  const key = `MODEL_${tier.toUpperCase()}` as keyof AiEnv;
  return env(e, key) ?? FALLBACK_MODELS[tier];
}

export function createDeepSeek(e?: AiEnv): OpenAI {
  const apiKey = env(e, "DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Missing DEEPSEEK_API_KEY. In production set it with `wrangler secret put DEEPSEEK_API_KEY`.",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: env(e, "DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
  });
}

export class TruncatedCompletionError extends Error {
  constructor(
    readonly model: string,
    readonly reasoningTokens: number,
    readonly maxTokens: number,
  ) {
    super(
      `${model} hit the token ceiling during reasoning (${reasoningTokens} reasoning tokens of ${maxTokens}) and returned no content. Raise maxTokens.`,
    );
    this.name = "TruncatedCompletionError";
  }
}

export type CompleteOptions = {
  tier: ModelTier;
  system?: string;
  user: string;
  /** Must cover reasoning plus output. Do not size this to the expected answer. */
  maxTokens?: number;
  temperature?: number;
  env?: AiEnv;
  signal?: AbortSignal;
};

export type CompleteResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

/**
 * One completion, with the empty-content trap turned into a thrown error.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const client = createDeepSeek(opts.env);
  const model = modelFor(opts.tier, opts.env);
  const maxTokens = opts.maxTokens ?? 4096;

  const res = await client.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.user },
      ],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  const choice = res.choices[0];
  const content = choice?.message?.content ?? "";
  const usage = res.usage;
  const reasoningTokens =
    (usage?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
      ?.reasoning_tokens ?? 0;

  if (choice?.finish_reason === "length" && content.trim() === "") {
    throw new TruncatedCompletionError(model, reasoningTokens, maxTokens);
  }

  return {
    content,
    model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    reasoningTokens,
    cachedTokens:
      (usage?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0,
  };
}

/** `complete()` with the response parsed as JSON, retried once on malformed output. */
export async function completeJson<T>(
  opts: CompleteOptions,
): Promise<{ data: T; usage: CompleteResult }> {
  const usage = await complete(opts);
  const text = usage.content.trim();

  // Reasoning models like to wrap JSON in ```json fences despite instructions.
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    return { data: JSON.parse(unfenced) as T, usage };
  } catch {
    throw new Error(
      `${usage.model} returned unparseable JSON (${text.length} chars): ${text.slice(0, 200)}`,
    );
  }
}
