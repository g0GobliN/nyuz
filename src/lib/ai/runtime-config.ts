/**
 * DB-backed AI runtime configuration.
 *
 * ---------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------
 *
 * Tuning the AI used to mean editing two places that could not check each
 * other. `npm run pipeline -- analyse` reads `.env`; the deployed Worker reads
 * Cloudflare variables. Raising a budget in one and forgetting the other gives
 * you a pipeline that stops at $6 while the console insists the ceiling is $12,
 * and nothing anywhere says the two disagree. Three of the numbers were not even
 * env vars — they were `const`s, so changing an analysis ceiling was a deploy.
 *
 * Every value here is now read from `ai_runtime_config` (migration 0056) by both
 * runtimes, so one console edit moves both.
 *
 * ---------------------------------------------------------------------------
 * Precedence, and why it is that way round
 * ---------------------------------------------------------------------------
 *
 *     database row  ->  environment variable  ->  code default
 *
 * Env is bootstrap, not configuration. A fresh deployment with an empty table
 * behaves exactly as it did before 0056, which is what makes adopting this safe;
 * but the moment an operator sets a value in the console, that value wins
 * everywhere. Note this is the opposite of `dailyCapsMicrousd` in launch-flags.ts,
 * where env still overrides the stored setting — see the note on
 * `AI_DAILY_*_CAP_MICROUSD` in that file. The two are not reconciled here because
 * changing that precedence would change behaviour for an operator relying on the
 * env override as an emergency brake, which is a separate decision.
 *
 * ---------------------------------------------------------------------------
 * An out-of-range value is refused, never quietly rounded
 * ---------------------------------------------------------------------------
 *
 * A configured value outside its bounds does not become the nearest legal one.
 * `AI_MONTHLY_COST_USD=0.10` where `10` was meant is finite, positive, and a
 * ceiling no real call fits under; silently promoting it to the $1 floor would
 * be spending against a ceiling nobody chose, which is the exact failure the
 * floors exist to catch. Instead such a value is marked `invalid` and skipped in
 * the precedence chain, and the two consumers split the way they always have:
 *
 *   - the console still renders, showing the next usable source AND the fact
 *     that the configured value was rejected, because a settings page that
 *     500s is a settings page nobody can use to fix the setting;
 *   - the reserve path refuses to run — see `reserveUsage` in config.ts — for
 *     the same reason it did before 0056. A pipeline that spends against a
 *     number nobody meant is worse than one that stops and says so.
 *
 * The console also validates on save, so a bad value is normally refused with an
 * explanation at the moment it is typed. `invalid` is what holds when the write
 * did not come through the console.
 *
 * ---------------------------------------------------------------------------
 * Import safety
 * ---------------------------------------------------------------------------
 *
 * This module takes its database client as an argument and imports only types,
 * exactly like launch-flags.ts. It must stay that way: reaching for
 * `createAdminClient()` here would drag the service-role client toward the
 * browser bundle, and the admin page imports `AI_RUNTIME_SETTINGS` from this
 * file to render labels and bounds.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ambientEnv, type EnvBag } from "@/lib/runtime-env";
import type { Database } from "@/lib/supabase/types";
import {
  DEFAULT_AI_MONTHLY_COST_USD,
  DEFAULT_AI_MONTHLY_TOKEN_BUDGET,
  MIN_AI_MONTHLY_COST_USD,
  MIN_AI_MONTHLY_TOKEN_BUDGET,
} from "@/lib/ai/budget";

type Db = SupabaseClient<Database>;

/* ---------------------------------------------------------------------- */
/* Hard ceilings                                                          */
/* ---------------------------------------------------------------------- */

/**
 * The floor under every completion ceiling.
 *
 * Reasoning models spend completion tokens on hidden reasoning before any
 * visible content appears — a "reply ok" probe once burned 27 of 29 tokens that
 * way. Below roughly a thousand tokens the provider returns HTTP 200 with empty
 * content and `finish_reason: "length"`, which reads as "the AI produced
 * nothing" rather than "the ceiling is too low". Same number and same reason as
 * `MIN_MAX_TOKENS` in src/lib/server/ai-config.ts, which guards the per-route
 * ceilings.
 */
export const MIN_COMPLETION_TOKENS = 1024;

/**
 * The most the console may set the monthly invoice ceiling to.
 *
 * Not a statement about what nyuz can afford — it is a bound on how far a
 * mistyped or hostile console write can go. An operator who genuinely needs more
 * than $50/month is making a business decision that deserves a code change and a
 * review, not a text field. Raising this is one line; the point is that it is a
 * line someone reads.
 */
export const MAX_AI_MONTHLY_COST_USD = 50;

/** Same idea for the token ceiling. ~5x the recommended 20M production value. */
export const MAX_AI_MONTHLY_TOKEN_BUDGET = 100_000_000;

/* ---------------------------------------------------------------------- */
/* Registry                                                               */
/* ---------------------------------------------------------------------- */

export type AiSettingKey =
  | "ai.monthly_cost_usd"
  | "ai.monthly_token_budget"
  | "ai.cluster_max_tokens"
  | "ai.cluster_thinking"
  | "ai.analyse_max_tokens"
  | "ai.digest_max_tokens"
  | "ai.ask_max_tokens"
  | "ai.reasoning_effort"
  | "ai.analysis_batch_size"
  | "ai.provider_fallback"
  | "ai.analyse_thinking";

/**
 * "default" is not a value the provider understands — it is this codebase's name
 * for "send no `reasoning_effort` field at all". The four after it are the
 * OpenAI-dialect values the SDK types accept, so `ProviderReasoningEffort` is
 * exactly `ReasoningEffort` minus that first entry.
 */
export const REASONING_EFFORTS = ["default", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ProviderReasoningEffort = Exclude<ReasoningEffort, "default">;

type NumberSetting = {
  kind: "number";
  /** Whether the field is dollars (fractional) or a whole count. */
  unit: "usd" | "tokens" | "count";
  min: number;
  max: number;
  codeDefault: number;
};

type BooleanSetting = { kind: "boolean"; codeDefault: boolean };
type EnumSetting = { kind: "enum"; options: readonly string[]; codeDefault: string };

export type AiSettingSpec = (NumberSetting | BooleanSetting | EnumSetting) & {
  key: AiSettingKey;
  /** What an operator calls this. The primary label in the console. */
  label: string;
  /** One sentence on what moving it does. */
  description: string;
  /**
   * The env var this falls back to. Shown only as small technical help text —
   * the console leads with `label`, because an operator raising a budget should
   * not have to know the name of a Cloudflare variable to do it.
   */
  envVar: string;
  /**
   * Whether changing this can stop the product, and so needs a confirmation
   * step. Token and batch tuning is deliberately not marked — confirming every
   * small change trains people to click through confirmations.
   */
  dangerous: boolean;
};

export const AI_RUNTIME_SETTINGS: readonly AiSettingSpec[] = [
  {
    key: "ai.monthly_cost_usd",
    label: "Monthly safety cap",
    description:
      "Maximum nyuz may spend in one calendar month. This is an emergency guard and does not add provider credit. Set it above routine usage; top-ups do not change it. Settled spend and in-flight reservations count toward this cap.",
    envVar: "AI_MONTHLY_COST_USD",
    kind: "number",
    unit: "usd",
    min: MIN_AI_MONTHLY_COST_USD,
    max: MAX_AI_MONTHLY_COST_USD,
    codeDefault: DEFAULT_AI_MONTHLY_COST_USD,
    dangerous: true,
  },
  {
    key: "ai.monthly_token_budget",
    label: "Token safety cap",
    description:
      "A second ceiling counted in tokens, to catch a runaway loop generating enormous cheap traffic that the dollar ceiling would notice too late.",
    envVar: "AI_MONTHLY_TOKEN_BUDGET",
    kind: "number",
    unit: "tokens",
    min: MIN_AI_MONTHLY_TOKEN_BUDGET,
    max: MAX_AI_MONTHLY_TOKEN_BUDGET,
    codeDefault: DEFAULT_AI_MONTHLY_TOKEN_BUDGET,
    dangerous: true,
  },
  {
    key: "ai.cluster_max_tokens",
    label: "Cluster max tokens",
    description:
      "Output ceiling for one clustering decision. The answer is a few numbers, but the model reasons before it writes them, and at 1024 deepseek-v4-flash spent the whole allowance reasoning and returned nothing.",
    envVar: "CLUSTER_MAX_TOKENS",
    kind: "number",
    unit: "count",
    min: MIN_COMPLETION_TOKENS,
    // Deliberately the lowest ceiling of the four. Clustering is the highest-
    // volume call nyuz makes -- once per shortlisted article, against every
    // other stage's once per event or once per reader -- so a ceiling raised
    // here multiplies across the whole ingest. The reply is a JSON array of
    // integers; anything past 4096 is buying reasoning, not output, and if
    // clustering genuinely needs that much the answer is a better shortlist.
    max: 4096,
    codeDefault: 2048,
    dangerous: false,
  },
  {
    key: "ai.cluster_thinking",
    label: "Cluster extended thinking",
    description:
      "Whether deepseek cluster calls may use extended thinking. deepseek-v4-flash can spend the entire token allowance on hidden reasoning before writing any JSON; disabling extended thinking for clustering keeps the ceiling effective.",
    envVar: "AI_THINKING_CLUSTER",
    kind: "boolean",
    codeDefault: true,
    dangerous: false,
  },
  {
    key: "ai.analyse_max_tokens",
    label: "Analyse max tokens",
    description:
      "Output ceiling for one event analysis. Must cover the model's hidden reasoning as well as the JSON document it returns; below about 2048 deepseek-v4-pro spends the whole allowance reasoning and returns nothing.",
    envVar: "ANALYSE_MAX_TOKENS",
    kind: "number",
    unit: "count",
    min: MIN_COMPLETION_TOKENS,
    max: 8192,
    codeDefault: 4096,
    dangerous: false,
  },
  {
    key: "ai.digest_max_tokens",
    label: "Digest max tokens",
    description: "Output ceiling for one reader's briefing digest.",
    envVar: "DIGEST_MAX_TOKENS",
    kind: "number",
    unit: "count",
    min: MIN_COMPLETION_TOKENS,
    max: 16384,
    codeDefault: 8192,
    dangerous: false,
  },
  {
    key: "ai.ask_max_tokens",
    label: "Story Ask max tokens",
    description: "Output ceiling for one reader question in the per-story Ask nyuz panel.",
    envVar: "ASK_MAX_TOKENS",
    kind: "number",
    unit: "count",
    min: MIN_COMPLETION_TOKENS,
    max: 8192,
    codeDefault: 4096,
    dangerous: false,
  },
  {
    key: "ai.reasoning_effort",
    label: "Reasoning effort",
    description:
      "How much hidden reasoning to ask the model for. Sent only when set to something other than Default; providers that do not understand the parameter ignore it.",
    envVar: "AI_REASONING_EFFORT",
    kind: "enum",
    options: REASONING_EFFORTS,
    codeDefault: "default",
    dangerous: false,
  },
  {
    key: "ai.analysis_batch_size",
    label: "Analysis batch size",
    description:
      "Events analysed per pipeline run. Each one is a call to the strongest configured model, so this is the main lever on how fast a backlog drains and how fast it spends.",
    envVar: "ANALYSE_BATCH_SIZE",
    kind: "number",
    unit: "count",
    min: 1,
    max: 32,
    codeDefault: 8,
    dangerous: false,
  },
  {
    key: "ai.provider_fallback",
    label: "Provider fallback",
    description:
      "When a configured route is unusable — provider inactive, secret missing, table unreachable — fall back to the built-in DeepSeek env route rather than failing. Turning this off makes a broken route stop the pipeline instead of quietly routing elsewhere.",
    envVar: "AI_PROVIDER_FALLBACK",
    kind: "boolean",
    codeDefault: true,
    dangerous: true,
  },
  {
    key: "ai.analyse_thinking",
    label: "Analyse thinking",
    description:
      "Whether deepseek analysis calls may use extended thinking. When disabled, routine events use standard-no-thinking (thinking disabled) and only complex events use complex-thinking (thinking enabled). Set to true to restore always-enabled thinking.",
    envVar: "AI_THINKING_ANALYSE",
    kind: "boolean",
    codeDefault: true,
    dangerous: false,
  },
];

const BY_KEY = new Map<string, AiSettingSpec>(AI_RUNTIME_SETTINGS.map((s) => [s.key, s]));

export function aiSettingSpec(key: string): AiSettingSpec | undefined {
  return BY_KEY.get(key);
}

/* ---------------------------------------------------------------------- */
/* Resolution                                                             */
/* ---------------------------------------------------------------------- */

/** Where an effective value came from. Surfaced per-setting in the console. */
export type ValueSource = "database" | "environment" | "default";

/** A configured value that was rejected, and why. */
export type RejectedValue = {
  value: number | boolean | string;
  source: Exclude<ValueSource, "default">;
  reason: string;
};

export type ResolvedSetting = {
  key: AiSettingKey;
  /** The value in force, after precedence. Always within bounds. */
  value: number | boolean | string;
  source: ValueSource;
  /** What the database holds, or null when there is no row. */
  dbValue: number | boolean | string | null;
  /**
   * Set when a configured value was out of bounds and therefore skipped. The
   * console shows it; `reserveUsage` refuses to run on it for the two monthly
   * ceilings, where continuing would mean spending against a number nobody meant.
   */
  invalid: RejectedValue | null;
  changedAt: string | null;
  changedBy: string | null;
};

export type AiRuntimeConfig = {
  monthlyCostUsd: number;
  monthlyTokenBudget: number;
  clusterMaxTokens: number;
  clusterThinking: boolean;
  analyseMaxTokens: number;
  digestMaxTokens: number;
  askMaxTokens: number;
  reasoningEffort: ReasoningEffort;
  analysisBatchSize: number;
  providerFallback: boolean;
  analyseThinking: boolean;
  /** Per-setting provenance, for the console. Empty-safe for pipeline callers. */
  resolved: Record<AiSettingKey, ResolvedSetting>;
};

/** The bound a value falls outside, or null when it is usable. */
function outOfRange(spec: AiSettingSpec, value: number | boolean | string): string | null {
  if (spec.kind !== "number" || typeof value !== "number") return null;
  if (value < spec.min) {
    return `below the minimum of ${spec.min}, which is low enough to refuse every call`;
  }
  if (value > spec.max) return `above the maximum of ${spec.max} this build permits`;
  return null;
}

/**
 * One candidate value, or null when it cannot be one.
 *
 * Null covers unset, unparseable and wrong-typed alike, so the caller falls
 * through to the next source in the precedence chain rather than having to tell
 * those cases apart. A `"$8"` in an env var and a missing env var should both
 * mean "use the next source"; treating the first as `NaN` would produce a
 * ceiling no call fits under, which looks exactly like a provider outage.
 */
function coerce(spec: AiSettingSpec, raw: unknown): number | boolean | string | null {
  if (raw === null || raw === undefined) return null;
  if (spec.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(v)) return true;
      if (["false", "0", "no", "off"].includes(v)) return false;
    }
    return null;
  }
  if (spec.kind === "enum") {
    if (typeof raw !== "string") return null;
    const v = raw.trim().toLowerCase();
    return spec.options.includes(v) ? v : null;
  }
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (typeof raw === "string" && raw.trim() === "") return null;
  return Number.isFinite(n) ? n : null;
}

function resolveOne(
  spec: AiSettingSpec,
  row: { value: unknown; changed_at: string; changed_by: string | null } | undefined,
  env: EnvBag,
): ResolvedSetting {
  const dbRaw = coerce(spec, (row?.value as { value?: unknown } | null | undefined)?.value);
  const envRaw = coerce(spec, env[spec.envVar]);

  // Walked in precedence order, skipping anything out of bounds. The FIRST
  // rejection is the one reported: it is the one the operator most recently set
  // and is asking about, and reporting a rejected env var while a rejected
  // database row sits above it unmentioned would send them to fix the wrong file.
  let invalid: RejectedValue | null = null;
  const candidates: { value: number | boolean | string; source: ValueSource }[] = [
    ...(dbRaw !== null ? [{ value: dbRaw, source: "database" as const }] : []),
    ...(envRaw !== null ? [{ value: envRaw, source: "environment" as const }] : []),
    { value: spec.codeDefault, source: "default" as const },
  ];

  let picked = spec.codeDefault as number | boolean | string;
  let source: ValueSource = "default";
  for (const candidate of candidates) {
    const reason = outOfRange(spec, candidate.value);
    if (reason === null) {
      picked = candidate.value;
      source = candidate.source;
      break;
    }
    if (invalid === null && candidate.source !== "default") {
      invalid = { value: candidate.value, source: candidate.source, reason };
    }
  }

  // Whole numbers where the unit is a count. A `4096.5` token ceiling is a typo
  // that would otherwise reach the provider verbatim.
  if (spec.kind === "number" && spec.unit !== "usd" && typeof picked === "number") {
    picked = Math.round(picked);
  }

  return {
    key: spec.key,
    value: picked,
    source,
    dbValue: dbRaw,
    invalid,
    changedAt: row?.changed_at ?? null,
    changedBy: row?.changed_by ?? null,
  };
}

/* ---------------------------------------------------------------------- */
/* Cache                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Sixty seconds, matching the route cache in config.ts.
 *
 * The reserve path already makes one flag read per AI call; a settings round
 * trip on top of that would double the fixed cost of every call for a config
 * that changes maybe weekly. The console says this number out loud rather than
 * pretending a save is instant everywhere, and calls `invalidateAiRuntimeConfig`
 * so the isolate that handled the save is at least immediately correct.
 */
export const AI_RUNTIME_CACHE_MS = 60_000;

let cached: { config: AiRuntimeConfig; at: number } | null = null;

/** Drops the memo so a console save is visible immediately in this isolate. */
export function invalidateAiRuntimeConfig(): void {
  cached = null;
}

/**
 * Builds a config from rows and env. Pure, so precedence and clamping are
 * testable without a database.
 */
export function buildAiRuntimeConfig(
  rows: { key: string; value: unknown; changed_at: string; changed_by: string | null }[],
  env: EnvBag,
): AiRuntimeConfig {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const resolved = {} as Record<AiSettingKey, ResolvedSetting>;
  for (const spec of AI_RUNTIME_SETTINGS) {
    resolved[spec.key] = resolveOne(spec, byKey.get(spec.key), env);
  }
  return {
    monthlyCostUsd: resolved["ai.monthly_cost_usd"].value as number,
    monthlyTokenBudget: resolved["ai.monthly_token_budget"].value as number,
    clusterMaxTokens: resolved["ai.cluster_max_tokens"].value as number,
    clusterThinking: resolved["ai.cluster_thinking"].value as boolean,
    analyseMaxTokens: resolved["ai.analyse_max_tokens"].value as number,
    digestMaxTokens: resolved["ai.digest_max_tokens"].value as number,
    askMaxTokens: resolved["ai.ask_max_tokens"].value as number,
    reasoningEffort: resolved["ai.reasoning_effort"].value as ReasoningEffort,
    analysisBatchSize: resolved["ai.analysis_batch_size"].value as number,
    providerFallback: resolved["ai.provider_fallback"].value as boolean,
    analyseThinking: resolved["ai.analyse_thinking"].value as boolean,
    resolved,
  };
}

/**
 * The config in force, memoised per isolate for `AI_RUNTIME_CACHE_MS`.
 *
 * Never throws. A settings table that is unreachable must not stop briefings —
 * same reasoning as `resolveRoute`'s fallback in config.ts — so a failed read
 * degrades to env-and-defaults, which is the behaviour that shipped before 0056.
 */
export async function loadAiRuntimeConfig(
  db: Db,
  env: EnvBag = ambientEnv(),
  options: { fresh?: boolean } = {},
): Promise<AiRuntimeConfig> {
  if (!options.fresh && cached && Date.now() - cached.at < AI_RUNTIME_CACHE_MS) {
    return cached.config;
  }

  let rows: { key: string; value: unknown; changed_at: string; changed_by: string | null }[] = [];
  try {
    const { data, error } = await db
      .from("ai_runtime_config")
      .select("key, value, changed_at, changed_by");
    if (!error && data) rows = data;
  } catch {
    // Fall through to env and defaults.
  }

  const config = buildAiRuntimeConfig(rows, env);
  cached = { config, at: Date.now() };
  return config;
}
