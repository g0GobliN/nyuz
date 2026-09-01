import { describe, expect, it } from "vitest";
import { aiCostCeilingMicrousd, aiCostMicrousd, isDeepSeekPeak } from "@/lib/ai/cost";

/**
 * The circuit breaker's contract, stated as tests.
 *
 * A spending ceiling is only worth the pessimism of the estimator behind it. If
 * reservation ever prices a call at less than it can actually be billed, "$10"
 * silently becomes "$10 if we get lucky on timing and caching" — the exact
 * failure these lock out. Every assertion here is about being wrong in the safe
 * direction, never the cheap one.
 */

const M = 1_000_000;

/** DeepSeek V4, official table effective 16 August 2026. */
const OFFICIAL = {
  "deepseek-v4-flash": {
    cachedInput: { off: 0.007, peak: 0.014 },
    uncachedInput: { off: 0.22, peak: 0.44 },
    output: { off: 0.66, peak: 1.32 },
  },
  "deepseek-v4-pro": {
    cachedInput: { off: 0.022, peak: 0.044 },
    uncachedInput: { off: 0.66, peak: 1.32 },
    output: { off: 1.98, peak: 3.96 },
  },
} as const;

const PEAK_AT = new Date("2026-09-02T02:00:00Z"); // Wednesday 02:00 UTC
const OFF_AT = new Date("2026-09-02T12:00:00Z"); // Wednesday 12:00 UTC

/** Prices exactly 1M tokens of one kind, so the result is USD per 1M tokens. */
function perMillion(
  model: string,
  kind: keyof (typeof OFFICIAL)[keyof typeof OFFICIAL],
  at: Date,
): number {
  const base = {
    provider: "deepseek",
    model,
    promptTokens: 0,
    cachedPromptTokens: 0,
    completionTokens: 0,
    at,
  };
  if (kind === "cachedInput") Object.assign(base, { promptTokens: M, cachedPromptTokens: M });
  if (kind === "uncachedInput") Object.assign(base, { promptTokens: M });
  if (kind === "output") Object.assign(base, { completionTokens: M });
  return (aiCostMicrousd(base) as number) / M;
}

describe("the rate card matches DeepSeek's published V4 table", () => {
  for (const [model, kinds] of Object.entries(OFFICIAL)) {
    for (const [kind, want] of Object.entries(kinds)) {
      it(`prices ${model} ${kind} at both tariffs`, () => {
        expect(perMillion(model, kind as never, PEAK_AT)).toBeCloseTo(want.peak, 9);
        expect(perMillion(model, kind as never, OFF_AT)).toBeCloseTo(want.off, 9);
      });
    }
  }

  it("puts peak at 01:00-04:00 and 06:00-10:00 UTC, weekdays only", () => {
    const wed = (h: number) => new Date(Date.UTC(2026, 8, 2, h));
    const sat = (h: number) => new Date(Date.UTC(2026, 8, 5, h));
    for (const h of [1, 2, 3, 6, 8, 9]) expect(isDeepSeekPeak(wed(h))).toBe(true);
    for (const h of [0, 4, 5, 10, 12, 23]) expect(isDeepSeekPeak(wed(h))).toBe(false);
    // A weekend hour inside the peak window is still off-peak.
    for (const h of [2, 7]) expect(isDeepSeekPeak(sat(h))).toBe(false);
  });
});

describe("reservation never authorizes less than the provider can bill", () => {
  const shapes = [
    { model: "deepseek-v4-pro", promptTokens: 1_700, completionTokens: 32_768 },
    { model: "deepseek-v4-flash", promptTokens: 400, completionTokens: 8_192 },
    { model: "deepseek-v4-pro", promptTokens: 12_000, completionTokens: 4_096 },
  ];

  it("is at least the settled cost under every tariff and cache outcome", () => {
    for (const shape of shapes) {
      const ceiling = aiCostCeilingMicrousd({ provider: "deepseek", ...shape }) as number;
      for (const at of [PEAK_AT, OFF_AT]) {
        // Cache hits only ever make a call cheaper, so zero hits is the worst
        // case and full hits the best. Both must sit at or under the ceiling.
        for (const cached of [0, shape.promptTokens]) {
          const settled = aiCostMicrousd({
            provider: "deepseek",
            ...shape,
            cachedPromptTokens: cached,
            at,
          }) as number;
          expect(settled).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it("does not take the off-peak discount a reservation cannot compel", () => {
    // The concrete regression: pricing by wall clock halves the authorization
    // for any call reserved outside peak hours, so a $10 ceiling authorizes
    // twice the work and invoices roughly $20 if those calls bill at peak.
    const shape = { model: "deepseek-v4-pro", promptTokens: 1_700, completionTokens: 32_768 };
    const byClock = aiCostMicrousd({
      provider: "deepseek",
      ...shape,
      cachedPromptTokens: 0,
      at: OFF_AT,
    }) as number;
    const ceiling = aiCostCeilingMicrousd({ provider: "deepseek", ...shape }) as number;

    // Not exactly 2: both sides round to whole micro-USD.
    expect(ceiling / byClock).toBeCloseTo(2, 3);

    const authorizedByClock = Math.floor((10 * M) / byClock);
    const billedAtPeak = (authorizedByClock * ceiling) / M;
    expect(billedAtPeak).toBeGreaterThan(19);

    // And the ceiling keeps that same worst case inside the limit.
    const authorizedByCeiling = Math.floor((10 * M) / ceiling);
    expect((authorizedByCeiling * ceiling) / M).toBeLessThanOrEqual(10);
  });

  it("refuses to price a route the rate card does not cover", () => {
    // Must be null, never 0. The console can route a capability at OpenAI,
    // Groq, OpenRouter or Together, and a zero here would let an unpriced
    // provider run with no money ceiling at all.
    expect(
      aiCostCeilingMicrousd({
        provider: "openai",
        model: "gpt-5",
        promptTokens: 100_000,
        completionTokens: 100_000,
      }),
    ).toBeNull();
    expect(
      aiCostCeilingMicrousd({
        provider: "deepseek",
        model: "deepseek-v5-unreleased",
        promptTokens: 100_000,
        completionTokens: 100_000,
      }),
    ).toBeNull();
  });
});
