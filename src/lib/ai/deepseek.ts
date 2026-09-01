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
    readonly promptTokens = 0,
    readonly completionTokens = reasoningTokens,
    readonly cachedTokens = 0,
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

export class CompletionUsageError extends Error {
  constructor(
    message: string,
    readonly usage: CompleteResult,
  ) {
    super(message);
    this.name = "CompletionUsageError";
  }
}

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
    throw new TruncatedCompletionError(
      model,
      reasoningTokens,
      maxTokens,
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? reasoningTokens,
      (usage?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0,
    );
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

/**
 * Strips the fencing a reasoning model adds to JSON despite being told not to.
 *
 * Also tolerates a preamble: these models occasionally narrate a sentence before
 * the object. Anything outside the outermost braces or brackets is discarded,
 * which is safe because the callers here all ask for a single JSON value.
 */
function unwrapJson(text: string): string {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const start = unfenced.search(/[[{]/);
  if (start === -1) return unfenced;

  const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
  return end > start ? unfenced.slice(start, end + 1) : unfenced.slice(start);
}

/** Adds two usage records, so a retried call still reports what it really spent. */
function addUsage(first: CompleteResult, second: CompleteResult): CompleteResult {
  return {
    content: second.content,
    model: second.model,
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    reasoningTokens: first.reasoningTokens + second.reasoningTokens,
    cachedTokens: first.cachedTokens + second.cachedTokens,
  };
}

/**
 * `complete()` with the response parsed as JSON, retried once on malformed output.
 *
 * The retry is worth its cost. A reasoning model that has just spent a thousand
 * tokens working something out and then formatted the answer badly has done the
 * expensive part correctly; throwing that away over a stray sentence means paying
 * for the reasoning again on the next scheduled run, and in the clustering stage it
 * means an article silently becoming its own event when it belonged to another. So
 * it is asked again, once, with the failure quoted back to it.
 *
 * The returned usage is the **sum of both attempts**. Nothing downstream may
 * under-report what it spent — `events.analysis_tokens` is the number the whole
 * cost argument for this product is audited against, and a retry that reported only
 * its second attempt would make the ledger quietly optimistic.
 */
export async function completeJson<T>(
  opts: CompleteOptions,
): Promise<{ data: T; usage: CompleteResult }> {
  const first = await complete(opts);

  try {
    return { data: JSON.parse(unwrapJson(first.content)) as T, usage: first };
  } catch {
    // Deliberately not a conversation: the same request again, plus the reason the
    // last reply was unusable. Replaying a multi-turn exchange would cost the
    // prompt twice over and give the model room to argue with itself.
    const second = await complete({
      ...opts,
      user:
        `${opts.user}\n\n---\nYour previous reply could not be parsed as JSON. ` +
        `Reply with the JSON value only — no prose, no explanation, no code fence.\n` +
        `What you sent began: ${first.content.trim().slice(0, 120)}`,
    });

    const usage = addUsage(first, second);
    try {
      return { data: JSON.parse(unwrapJson(second.content)) as T, usage };
    } catch {
      const text = second.content.trim();
      throw new CompletionUsageError(
        `${usage.model} returned unparseable JSON twice (${text.length} chars): ${text.slice(0, 200)}`,
        usage,
      );
    }
  }
}
