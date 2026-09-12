/**
 * Rate cards for all AI providers.
 *
 * The result is snapshotted beside measured tokens, so a later price change
 * does not rewrite historical cost. Unknown providers/models return null and
 * make unit economics incomplete instead of silently pretending to cost zero.
 *
 * DeepSeek defines peak as weekdays 01:00–04:00 and 06:00–10:00 UTC.
 * Groq does not have peak/off-peak pricing — always uses the base rate.
 */

type UsageCostInput = {
  provider: string;
  model: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  at?: Date;
};

type Rates = { cachedInput: number; uncachedInput: number; output: number };

const PEAK_RATES: Record<string, Rates> = {
  "deepseek-v4-flash": { cachedInput: 0.014, uncachedInput: 0.44, output: 1.32 },
  "deepseek-v4-pro": { cachedInput: 0.044, uncachedInput: 1.32, output: 3.96 },
  "llama-3.1-8b": { cachedInput: 0.05, uncachedInput: 0.05, output: 0.08 },
};

const PROVIDER_PEAK = new Set(["deepseek"]);

function rateFor(provider: string, model: string): Rates | null {
  if (!(
    (provider === "deepseek" && model.startsWith("deepseek-v4-")) ||
    (provider === "groq" && model.startsWith("llama-3.1-8b"))
  ))
    return null;
  const key = Object.keys(PEAK_RATES).find((candidate) => model.startsWith(candidate));
  return key ? (PEAK_RATES[key] ?? null) : null;
}

function isPeakProvider(provider: string): boolean {
  return PROVIDER_PEAK.has(provider);
}

/**
 * Which model name to price a finished call by.
 *
 * A completion reports the model that served it, and that is normally the one
 * that was asked for. On 2026-09-10 it stopped being: DeepSeek began echoing
 * `deepseek-flash` for requests routed to `deepseek-v4-flash`. The rate card
 * has never heard of the short form, so every flash call that day priced to
 * null — 266 provider calls that were really billed and never settled, with
 * their pessimistic reservations left standing against the monthly ceiling.
 *
 * So: price by what the provider said when the rate card recognises it, and
 * fall back to the model the route actually selected when it does not. The
 * fallback is the honest answer rather than a guess — the route is the model
 * this app chose, requested and has a published price for, and an alias of it
 * coming back is not a reason to lose the number.
 *
 * Returns null when neither name is priceable. That is a real unpriced route
 * and the caller must not invent a cost for it.
 */
export function settlementRateModel(
  provider: string,
  reportedModel: string,
  routedModel: string,
): string | null {
  if (rateFor(provider, reportedModel)) return reportedModel;
  if (rateFor(provider, routedModel)) return routedModel;
  return null;
}

/** DeepSeek defines peak as weekdays 01:00–04:00 and 06:00–10:00 UTC. */
export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/**
 * The most this call could reasonably be billed at — the number a spending
 * ceiling must authorize against.
 *
 * Separate from `aiCostMicrousd` because the two answer different questions at
 * different times, and conflating them is how a ceiling silently becomes a
 * suggestion. Settlement asks "what did this cost", knows the real token counts,
 * the real cache hits and the real clock, and should answer precisely.
 * Reservation asks "how much am I about to authorize" and knows none of that:
 *
 *   - **Peak, always.** Off-peak is half price, so pricing a reservation by the
 *     current clock assumes a discount that a call starting at 00:59 and
 *     billing at 01:05 does not get. Assuming peak is wrong by at most 2x in
 *     the safe direction; assuming off-peak is wrong by 2x in the direction
 *     that overspends.
 *   - **No cache hits.** A cache hit is ~30x cheaper than a miss. Whether one
 *     occurs is the provider's decision, made after we have committed, so
 *     counting on it would be authorizing against a discount we cannot compel.
 *
 * The gap between this and the settled figure is not waste: `settle_ai_tokens`
 * overwrites the estimate with measured cost, so over-reservation only ever
 * constrains calls that are in flight at the same moment.
 */
export function aiCostCeilingMicrousd(input: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | null {
  const peak = rateFor(input.provider, input.model);
  if (!peak) return null;

  return Math.ceil(
    Math.max(0, input.promptTokens) * peak.uncachedInput +
      Math.max(0, input.completionTokens) * peak.output,
  );
}

export function aiCostMicrousd(input: UsageCostInput): number | null {
  const peak = rateFor(input.provider, input.model);
  if (!peak) return null;

  const multiplier =
    isPeakProvider(input.provider) && !isDeepSeekPeak(input.at ?? new Date()) ? 0.5 : 1;
  const prompt = Math.max(0, input.promptTokens);
  const cached = Math.min(prompt, Math.max(0, input.cachedPromptTokens));
  const uncached = prompt - cached;
  const completion = Math.max(0, input.completionTokens);

  // USD per million tokens numerically equals micro-USD per token.
  return Math.round(
    multiplier *
      (cached * peak.cachedInput + uncached * peak.uncachedInput + completion * peak.output),
  );
}
