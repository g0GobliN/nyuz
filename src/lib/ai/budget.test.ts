import { describe, expect, it } from "vitest";
import { aiCostMicrousd } from "@/lib/ai/cost";
import { DEFAULT_AI_MONTHLY_COST_USD, MICROUSD_PER_USD } from "@/lib/ai/budget";

/**
 * The claim these tests exist to defend is a sizing claim, not a formatting one:
 * that a token ceiling and a money ceiling are not interchangeable, and that the
 * documented $10 default buys far less pipeline than the 500K token default
 * implies. Both numbers ship as defaults, so if the rate card moves and the two
 * stop disagreeing, the comments in `budget.ts` and `.env.example` are wrong and
 * somebody should find out here rather than from an invoice.
 */

/** Priced at a fixed off-peak instant so the peak multiplier cannot drift. */
const OFF_PEAK = new Date("2026-09-05T12:00:00Z");

describe("a token ceiling does not bound money", () => {
  it("prices the same token count about thirtyfold apart across routes", () => {
    const tokens = 1_000_000;
    const cheapest = aiCostMicrousd({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptTokens: tokens,
      cachedPromptTokens: tokens,
      completionTokens: 0,
      at: OFF_PEAK,
    });
    const dearest = aiCostMicrousd({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptTokens: 0,
      cachedPromptTokens: 0,
      completionTokens: tokens,
      at: OFF_PEAK,
    });

    expect(cheapest).not.toBeNull();
    expect(dearest).not.toBeNull();
    // The ratio `budget.ts` and `.env.example` both describe as "about thirtyfold".
    expect((dearest as number) / (cheapest as number)).toBeGreaterThan(30);
  });

  it("lets 500K tokens cost either cents or dollars depending on the route", () => {
    const budget = 500_000;
    const asCachedFlash = aiCostMicrousd({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptTokens: budget,
      cachedPromptTokens: budget,
      completionTokens: 0,
      at: OFF_PEAK,
    }) as number;
    const asProOutput = aiCostMicrousd({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptTokens: 0,
      cachedPromptTokens: 0,
      completionTokens: budget,
      at: OFF_PEAK,
    }) as number;

    expect(asCachedFlash / MICROUSD_PER_USD).toBeLessThan(0.01);
    expect(asProOutput / MICROUSD_PER_USD).toBeGreaterThan(0.9);
  });
});

describe("the $10 default against real pipeline shape", () => {
  it("does not cover a month of analyse at the seeded source count", () => {
    // `analyse` is one deepseek-v4-pro call per event: roughly 1,700 prompt and
    // 800 completion tokens, at the 288 events/day the cron's 6-per-run limit
    // permits. Deliberately the *documented* shape rather than a measurement, so
    // this fails if the rate card makes that shape affordable and the sizing
    // note in `.env.example` needs rewriting.
    const perCall = aiCostMicrousd({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptTokens: 1_700,
      cachedPromptTokens: 0,
      completionTokens: 800,
      at: OFF_PEAK,
    }) as number;

    const monthlyUsd = (perCall * 150 * 30) / MICROUSD_PER_USD;
    expect(monthlyUsd).toBeGreaterThan(DEFAULT_AI_MONTHLY_COST_USD);
  });

  it("prices an unknown model as unknown rather than as free", () => {
    expect(
      aiCostMicrousd({
        provider: "deepseek",
        model: "some-model-nobody-added-a-rate-for",
        promptTokens: 10_000,
        cachedPromptTokens: 0,
        completionTokens: 10_000,
        at: OFF_PEAK,
      }),
    ).toBeNull();

    expect(
      aiCostMicrousd({
        provider: "openai",
        model: "deepseek-v4-pro",
        promptTokens: 10_000,
        cachedPromptTokens: 0,
        completionTokens: 10_000,
        at: OFF_PEAK,
      }),
    ).toBeNull();
  });
});
