import OpenAI from "openai";
import { providerFetch, isTestRuntime } from "./transport";
import { envValue } from "@/lib/runtime-env";

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
  return envValue(key, e);
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
    apiKey: isTestRuntime() ? "test-only" : apiKey,
    fetch: providerFetch,
    baseURL: env(e, "DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
    // Each attempt must acquire its own reservation in the routed caller.
    maxRetries: 0,
  });
}

export class TruncatedCompletionError extends Error {
  usageSettled = false;
  constructor(
    readonly model: string,
    readonly reasoningTokens: number,
    readonly maxTokens: number,
    readonly promptTokens = 0,
    readonly completionTokens = reasoningTokens,
    readonly cachedTokens = 0,
    readonly usageReported = true,
  ) {
    super(
      `${model} returned truncated output at its ${maxTokens}-token ceiling (${reasoningTokens} reasoning tokens).`,
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
  /**
   * How much hidden reasoning to ask for, when the operator has chosen a value.
   *
   * Absent means "send nothing", which is not the same as sending a default:
   * a provider that has never heard of `reasoning_effort` rejects the whole
   * request rather than ignoring the field, so an unset knob must not put it on
   * the wire. `completeRouted` only passes this through when the console has
   * been moved off "default", so the pre-0056 request shape is byte-identical.
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  thinking?: "enabled" | "disabled";
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
  /** How many provider calls produced this result (1 = first attempt, 2 = retried). */
  attempt_count: number;
  usageReported?: boolean;
};

export class CompletionUsageError extends Error {
  constructor(
    message: string,
    readonly usage: CompleteResult,
    cause?: unknown,
  ) {
    super(message, { cause });
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
      // Not in the SDK's request type for every model, but accepted on the wire
      // by the reasoning models this routes to. Spread in only when set.
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      ...(opts.thinking ? { thinking: { type: opts.thinking } } : {}),
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

  if (choice?.finish_reason === "length") {
    throw new TruncatedCompletionError(
      model,
      reasoningTokens,
      maxTokens,
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? reasoningTokens,
      cachedInputTokens(usage),
      usage != null,
    );
  }

  return {
    content,
    model: res.model ?? model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    reasoningTokens,
    cachedTokens: cachedInputTokens(usage),
    attempt_count: 1,
    usageReported: usage != null,
  };
}

function cachedInputTokens(usage: unknown): number {
  const value = usage as {
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  return value?.prompt_cache_hit_tokens ?? value?.prompt_tokens_details?.cached_tokens ?? 0;
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
    attempt_count: first.attempt_count + second.attempt_count,
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
  attempt: (options: CompleteOptions, number: number) => Promise<CompleteResult> = complete,
): Promise<{ data: T; usage: CompleteResult }> {
  const first = await attempt(opts, 1);

  try {
    return {
      data: JSON.parse(unwrapJson(first.content)) as T,
      usage: { ...first, attempt_count: 1 },
    };
  } catch {
    // Deliberately not a conversation: the same request again, plus the reason the
    // last reply was unusable. Replaying a multi-turn exchange would cost the
    // prompt twice over and give the model room to argue with itself.
    let second: CompleteResult;
    try {
      second = await attempt(
        {
          ...opts,
          user:
            `${opts.user}\n\n---\nYour previous reply could not be parsed as JSON. ` +
            `Reply with the JSON value only — no prose, no explanation, no code fence.\n` +
            `What you sent began: ${first.content.trim().slice(0, 120)}`,
        },
        2,
      );
    } catch (error) {
      const extra =
        error instanceof CompletionUsageError
          ? error.usage
          : error instanceof TruncatedCompletionError
            ? {
                content: "",
                model: error.model,
                promptTokens: error.promptTokens,
                completionTokens: error.completionTokens,
                reasoningTokens: error.reasoningTokens,
                cachedTokens: error.cachedTokens,
                attempt_count: 1,
              }
            : null;
      throw new CompletionUsageError(
        "JSON repair failed after a billed first response",
        extra ? addUsage(first, extra) : first,
        error,
      );
    }

    const combined: CompleteResult = {
      content: second.content,
      model: second.model,
      promptTokens: first.promptTokens + second.promptTokens,
      completionTokens: first.completionTokens + second.completionTokens,
      reasoningTokens: first.reasoningTokens + second.reasoningTokens,
      cachedTokens: first.cachedTokens + second.cachedTokens,
      attempt_count: 2,
    };

    try {
      return { data: JSON.parse(unwrapJson(second.content)) as T, usage: combined };
    } catch {
      const text = second.content.trim();
      throw new CompletionUsageError(
        `${combined.model} returned unparseable JSON twice (${text.length} chars): ${text.slice(0, 200)}`,
        combined,
      );
    }
  }
}
