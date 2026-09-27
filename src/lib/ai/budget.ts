/**
 * Budget ceilings, kept free of dependencies on purpose.
 *
 * `config.ts` reaches for the service-role client at import time, so anything
 * that pulls it in is server-only by construction. The admin console needs to
 * *display* the same ceiling the pipeline enforces, and a page importing
 * `config.ts` for one number would drag the service-role client toward the
 * browser bundle. These are plain numbers with no imports, so both sides can
 * read them and neither has to restate the other's value.
 */

/**
 * A forgotten binding must reduce capacity, never turn metering off.
 *
 * ---------------------------------------------------------------------------
 * This default is a fail-safe, NOT a production setting
 * ---------------------------------------------------------------------------
 *
 * 500,000 tokens is deliberately far below what nyuz uses in a month, because
 * an unset `AI_MONTHLY_TOKEN_BUDGET` must not read as permission to spend. Left
 * at this value in production it binds long before `AI_MONTHLY_COST_USD` does,
 * and the symptom is the pipeline stopping mid-month while the cost dashboard
 * still shows dollars to spare.
 *
 * Measured against the current prompt shapes and rate card:
 *
 *   settled tokens per call   cluster (Flash)   ~849
 *                             analyse (Pro)   ~7,448
 *
 *   tokens consumed by the time $10 of cost is reached
 *     all analysis                6.1M
 *     10 clusterings per analysis 9.8M
 *     50 clusterings per analysis 15.3M
 *     all clustering              20.8M
 *
 * So for the dollar ceiling to be the primary limiter across every plausible
 * mix, the token budget has to sit above ~21M. **20,000,000 is the recommended
 * production starting value** alongside `AI_MONTHLY_COST_USD=10`: the invoice
 * governs normal operation, and the token cap still catches the anomaly it is
 * for — a runaway loop generating enormous cheap traffic, where cost per token
 * collapses and the dollar ceiling would notice too late.
 *
 * Headroom matters too. A reservation holds `prompt + maxTokens * 2` until it
 * settles, so one stalled batch of eight analyses pins ~315,000 tokens for up
 * to an hour (0047's stale window). That is 63% of this default and 1.6% of the
 * recommended value — the 2026-08-30 lockout in 0047 is what that looks like.
 *
 * The value is not raised here on purpose: the fail-safe must stay a fail-safe,
 * and production capacity belongs in the deployment's environment, where it is
 * visible and revocable. See docs/deployment.md.
 */
export const DEFAULT_AI_MONTHLY_TOKEN_BUDGET = 500_000;

/**
 * The monthly spend ceiling, in US dollars.
 *
 * A token cap and a money cap are not the same instrument and neither replaces
 * the other. A token is not a fixed price — a million `deepseek-v4-pro` output
 * tokens cost thirty times a million `deepseek-v4-flash` cached input tokens —
 * so a ceiling counted in tokens permits a bill that varies by an order of
 * magnitude with whichever route happens to run. The token cap bounds a runaway
 * loop; this bounds the invoice, which is the number the operator has to pay.
 *
 * Ten dollars because that is the stated starting budget. Raise it once paying
 * customers cover it — `/admin/ai/spend` shows burn against this figure.
 */
export const DEFAULT_AI_MONTHLY_COST_USD = 10;

export const MICROUSD_PER_USD = 1_000_000;

/**
 * Floors below which a configured ceiling is treated as a typo, not a choice.
 *
 * Both ceilings were validated as "finite and above zero", which a slipped
 * decimal passes: `AI_MONTHLY_COST_USD=0.10` is a perfectly valid number and a
 * ceiling no real call fits under, so every AI call is refused and the pipeline
 * stops producing briefings. From the outside that is indistinguishable from
 * the provider being down — the stages defer, the backlog grows, and nothing
 * says the cause is one character in a secret.
 *
 * These are deliberately far below any sane operating value rather than near
 * it. The job is to catch `0.10` where `10` was meant, not to second-guess an
 * operator who wants a genuinely tight budget.
 */
export const MIN_AI_MONTHLY_COST_USD = 1;
export const MIN_AI_MONTHLY_TOKEN_BUDGET = 10_000;

/**
 * A configured ceiling, or null when the value cannot be one.
 *
 * Null covers all three ways this goes wrong — unset, unparseable, and below
 * the floor — so callers decide once whether that means "fall back to the
 * default" (the console, which must still render) or "refuse to run" (the
 * pipeline, which must not spend against a ceiling nobody meant).
 */
export function configuredCeiling(raw: string | undefined, floor: number): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < floor) return null;
  return value;
}
