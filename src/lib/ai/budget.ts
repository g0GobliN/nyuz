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

/** A forgotten binding must reduce capacity, never turn metering off. */
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
 * customers cover it — `/admin/cost` shows burn against this figure.
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
