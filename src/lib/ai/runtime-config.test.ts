import { describe, expect, it } from "vitest";

import {
  AI_RUNTIME_SETTINGS,
  buildAiRuntimeConfig,
  MAX_AI_MONTHLY_COST_USD,
  MIN_COMPLETION_TOKENS,
  aiSettingSpec,
} from "./runtime-config";
import {
  DEFAULT_AI_MONTHLY_COST_USD,
  DEFAULT_AI_MONTHLY_TOKEN_BUDGET,
  MIN_AI_MONTHLY_COST_USD,
} from "./budget";

type Row = { key: string; value: unknown; changed_at: string; changed_by: string | null };

function row(key: string, value: unknown): Row {
  return { key, value: { value }, changed_at: "2026-09-01T00:00:00Z", changed_by: null };
}

describe("precedence", () => {
  it("uses the code default when nothing is configured anywhere", () => {
    const config = buildAiRuntimeConfig([], {});
    expect(config.monthlyCostUsd).toBe(DEFAULT_AI_MONTHLY_COST_USD);
    expect(config.monthlyTokenBudget).toBe(DEFAULT_AI_MONTHLY_TOKEN_BUDGET);
    expect(config.resolved["ai.monthly_cost_usd"].source).toBe("default");
  });

  it("prefers the environment variable over the code default", () => {
    const config = buildAiRuntimeConfig([], { AI_MONTHLY_COST_USD: "9" });
    expect(config.monthlyCostUsd).toBe(9);
    expect(config.resolved["ai.monthly_cost_usd"].source).toBe("environment");
  });

  it("prefers the database row over the environment variable", () => {
    const config = buildAiRuntimeConfig([row("ai.monthly_cost_usd", 8)], {
      AI_MONTHLY_COST_USD: "9",
    });
    expect(config.monthlyCostUsd).toBe(8);
    expect(config.resolved["ai.monthly_cost_usd"].source).toBe("database");
    expect(config.resolved["ai.monthly_cost_usd"].dbValue).toBe(8);
  });

  /**
   * The whole point of the migration: the two runtimes read different
   * environments, so a value that only exists in one of them cannot be the
   * source of truth. Once a row exists both runtimes agree by construction.
   */
  it("gives the same answer for two different environments once a row exists", () => {
    const rows = [row("ai.monthly_cost_usd", 8)];
    const worker = buildAiRuntimeConfig(rows, { AI_MONTHLY_COST_USD: "6" });
    const localPipeline = buildAiRuntimeConfig(rows, { AI_MONTHLY_COST_USD: "25" });
    expect(worker.monthlyCostUsd).toBe(localPipeline.monthlyCostUsd);
    expect(worker.monthlyCostUsd).toBe(8);
  });

  it("falls back per setting, not all-or-nothing", () => {
    const config = buildAiRuntimeConfig([row("ai.analyse_max_tokens", 2048)], {
      AI_MONTHLY_COST_USD: "9",
    });
    expect(config.resolved["ai.analyse_max_tokens"].source).toBe("database");
    expect(config.resolved["ai.monthly_cost_usd"].source).toBe("environment");
    expect(config.resolved["ai.digest_max_tokens"].source).toBe("default");
  });
});

describe("out-of-range values", () => {
  /**
   * The case the floors exist for: a slipped decimal is finite, positive, and a
   * ceiling no real call fits under. It must not become the ceiling, and it must
   * not be silently rounded up to one either.
   */
  it("refuses a slipped decimal rather than rounding it to the floor", () => {
    const config = buildAiRuntimeConfig([], { AI_MONTHLY_COST_USD: "0.10" });
    expect(config.monthlyCostUsd).not.toBe(0.1);
    expect(config.monthlyCostUsd).not.toBe(MIN_AI_MONTHLY_COST_USD);
    expect(config.resolved["ai.monthly_cost_usd"].invalid).toMatchObject({
      value: 0.1,
      source: "environment",
    });
  });

  it("refuses a database value above the hard ceiling", () => {
    const config = buildAiRuntimeConfig([row("ai.monthly_cost_usd", 5000)], {});
    expect(config.monthlyCostUsd).toBe(DEFAULT_AI_MONTHLY_COST_USD);
    expect(config.resolved["ai.monthly_cost_usd"].invalid).toMatchObject({
      value: 5000,
      source: "database",
    });
  });

  it("skips a rejected database row and uses a usable environment value", () => {
    const config = buildAiRuntimeConfig([row("ai.monthly_cost_usd", 0.1)], {
      AI_MONTHLY_COST_USD: "9",
    });
    expect(config.monthlyCostUsd).toBe(9);
    expect(config.resolved["ai.monthly_cost_usd"].source).toBe("environment");
    // Reports the database row, not the env var: that is the one to go and fix.
    expect(config.resolved["ai.monthly_cost_usd"].invalid?.source).toBe("database");
  });

  it("never returns a completion ceiling low enough to produce empty content", () => {
    for (const key of [
      "ai.cluster_max_tokens",
      "ai.analyse_max_tokens",
      "ai.digest_max_tokens",
      "ai.ask_max_tokens",
    ]) {
      const config = buildAiRuntimeConfig([row(key, 64)], {});
      const value = config.resolved[key as keyof typeof config.resolved].value;
      expect(value).toBeGreaterThanOrEqual(MIN_COMPLETION_TOKENS);
    }
  });

  it("cannot be pushed past the hard budget ceiling from any source", () => {
    const fromDb = buildAiRuntimeConfig([row("ai.monthly_cost_usd", 10_000)], {});
    const fromEnv = buildAiRuntimeConfig([], { AI_MONTHLY_COST_USD: "10000" });
    expect(fromDb.monthlyCostUsd).toBeLessThanOrEqual(MAX_AI_MONTHLY_COST_USD);
    expect(fromEnv.monthlyCostUsd).toBeLessThanOrEqual(MAX_AI_MONTHLY_COST_USD);
  });
});

/**
 * Every completion ceiling the pipeline runs on has to come from this table, or
 * an operator raising one in the console watches nothing change. Clustering was
 * the case that proved it: its ceiling was a constant in config.ts, so the only
 * way to move it was a deploy, and with no `cluster` row in `ai_model_routes`
 * the constant in force was the 1024 floor.
 */
describe("every completion ceiling is operator-settable", () => {
  const CEILINGS = [
    "ai.cluster_max_tokens",
    "ai.analyse_max_tokens",
    "ai.digest_max_tokens",
    "ai.ask_max_tokens",
  ] as const;

  it("reads each ceiling from the database in preference to anything else", () => {
    const rows = CEILINGS.map((key, i) => row(key, 2048 + i * 1024));
    const config = buildAiRuntimeConfig(rows, {
      CLUSTER_MAX_TOKENS: "1024",
      ANALYSE_MAX_TOKENS: "1024",
      DIGEST_MAX_TOKENS: "1024",
      ASK_MAX_TOKENS: "1024",
    });
    CEILINGS.forEach((key, i) => {
      expect(config.resolved[key].source).toBe("database");
      expect(config.resolved[key].value).toBe(2048 + i * 1024);
    });
    expect(config.clusterMaxTokens).toBe(2048);
    expect(config.analyseMaxTokens).toBe(3072);
  });

  /**
   * Raising analysis must not raise anything else. Each ceiling is held against
   * the monthly budget as a reservation on every call that uses it, so a global
   * raise spends the budget faster on stages that never needed the room.
   */
  it("raises one ceiling without moving the others", () => {
    const config = buildAiRuntimeConfig([row("ai.analyse_max_tokens", 6144)], {});
    expect(config.analyseMaxTokens).toBe(6144);
    expect(config.clusterMaxTokens).toBe(aiSettingSpec("ai.cluster_max_tokens")?.codeDefault);
    expect(config.digestMaxTokens).toBe(aiSettingSpec("ai.digest_max_tokens")?.codeDefault);
    expect(config.askMaxTokens).toBe(aiSettingSpec("ai.ask_max_tokens")?.codeDefault);
  });

  it("starts clustering above the floor that returned empty content", () => {
    const spec = aiSettingSpec("ai.cluster_max_tokens");
    expect(spec?.kind).toBe("number");
    expect(spec && "codeDefault" in spec ? spec.codeDefault : 0).toBeGreaterThan(
      MIN_COMPLETION_TOKENS,
    );
    expect(buildAiRuntimeConfig([], {}).clusterMaxTokens).toBeGreaterThan(MIN_COMPLETION_TOKENS);
  });

  /**
   * Clustering is the highest-volume call in the pipeline, so its bound is the
   * tightest of the four on purpose. A console field that could set it to 16384
   * would be a spending mistake one keystroke wide.
   */
  it("bounds clustering more tightly than the per-event and per-reader ceilings", () => {
    const cluster = aiSettingSpec("ai.cluster_max_tokens");
    const analyse = aiSettingSpec("ai.analyse_max_tokens");
    const clusterMax = cluster && "max" in cluster ? cluster.max : 0;
    const analyseMax = analyse && "max" in analyse ? analyse.max : 0;
    expect(clusterMax).toBeLessThan(analyseMax);
    expect(buildAiRuntimeConfig([row("ai.cluster_max_tokens", 32_768)], {}).clusterMaxTokens).toBe(
      cluster && "codeDefault" in cluster ? cluster.codeDefault : 0,
    );
  });
});

describe("coercion", () => {
  it("reads booleans from the several ways an env var spells them", () => {
    for (const raw of ["false", "0", "no", "off", "OFF"]) {
      expect(buildAiRuntimeConfig([], { AI_PROVIDER_FALLBACK: raw }).providerFallback).toBe(false);
    }
    for (const raw of ["true", "1", "yes", "on"]) {
      expect(buildAiRuntimeConfig([], { AI_PROVIDER_FALLBACK: raw }).providerFallback).toBe(true);
    }
  });

  it("treats an empty or unparseable env var as unset rather than as zero", () => {
    expect(buildAiRuntimeConfig([], { AI_MONTHLY_COST_USD: "" }).monthlyCostUsd).toBe(
      DEFAULT_AI_MONTHLY_COST_USD,
    );
    expect(buildAiRuntimeConfig([], { AI_MONTHLY_COST_USD: "$12" }).monthlyCostUsd).toBe(
      DEFAULT_AI_MONTHLY_COST_USD,
    );
  });

  it("ignores an unrecognised reasoning effort instead of sending it", () => {
    expect(buildAiRuntimeConfig([], { AI_REASONING_EFFORT: "extreme" }).reasoningEffort).toBe(
      "default",
    );
    expect(buildAiRuntimeConfig([], { AI_REASONING_EFFORT: "high" }).reasoningEffort).toBe("high");
  });

  it("rounds counts to whole numbers", () => {
    expect(buildAiRuntimeConfig([row("ai.analysis_batch_size", 8.7)], {}).analysisBatchSize).toBe(
      9,
    );
  });
});

describe("registry", () => {
  it("covers every setting the console can address", () => {
    for (const spec of AI_RUNTIME_SETTINGS) {
      expect(aiSettingSpec(spec.key)).toBe(spec);
      expect(spec.label).not.toBe("");
      expect(spec.description).not.toBe("");
    }
  });

  /**
   * The console leads with the human label. An env var name in the `label` field
   * would put it back in the place this page exists to get it out of.
   */
  it("never uses an env var name as a setting's label", () => {
    for (const spec of AI_RUNTIME_SETTINGS) {
      expect(spec.label).not.toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(spec.label).not.toBe(spec.envVar);
    }
  });

  it("keeps every code default inside its own bounds", () => {
    for (const spec of AI_RUNTIME_SETTINGS) {
      if (spec.kind !== "number") continue;
      expect(spec.codeDefault).toBeGreaterThanOrEqual(spec.min);
      expect(spec.codeDefault).toBeLessThanOrEqual(spec.max);
    }
  });
});
