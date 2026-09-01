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
