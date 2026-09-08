import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/server/validate";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import { ambientEnv } from "@/lib/runtime-env";
import { invalidateAiRuntimeConfig, loadAiRuntimeConfig } from "@/lib/ai/runtime-config";
import {
  AI_RUNTIME_CACHE_MS,
  AI_RUNTIME_SETTINGS,
  aiSettingSpec,
  MAX_AI_MONTHLY_COST_USD,
  type AiSettingKey,
  type AiSettingSpec,
  type ResolvedSetting,
  type ValueSource,
} from "@/lib/ai/runtime-config";
import { KILL_SWITCH_SETTING_KEY } from "@/lib/server/ai-status";
import type { Json } from "@/lib/supabase/types";

/**
 * The admin console's read and write path for AI runtime settings.
 *
 * The read is deliberately more than "here are the stored rows". An operator
 * looking at this page is usually trying to answer "why is the pipeline doing
 * X", and the stored value alone cannot answer that — a blank row means the env
 * var is in force, and the env var they are thinking of may be the *other*
 * runtime's. So every setting comes back with the configured value, the
 * effective value, and which of the three sources produced it. That triple is
 * the whole reason this page beats reading a `.env` file.
 *
 * The write is `adminOnly` rather than `superadminOnly`, unlike provider and
 * route changes in ai-config.ts. The distinction there was "does this change
 * where articles get sent and which secret pays for it" — these settings change
 * how much is spent and how long an answer may be, within bounds the code
 * refuses to exceed. That is operations, not a change of vendor.
 */

/* ---------------------------------------------------------------------- */
/* Read                                                                   */
/* ---------------------------------------------------------------------- */

export type AiSettingView = {
  key: string;
  label: string;
  description: string;
  /** Small technical help text. Never the primary label. */
  envVar: string;
  kind: "number" | "boolean" | "enum";
  unit: "usd" | "tokens" | "count" | null;
  min: number | null;
  max: number | null;
  options: string[] | null;
  /** What this deployment's database holds, or null when there is no row. */
  dbValue: number | boolean | string | null;
  /** What is actually in force after precedence and clamping. */
  effectiveValue: number | boolean | string;
  source: ValueSource;
  /** Set when a configured value was out of bounds and skipped. */
  invalid: { value: string; source: "database" | "environment"; reason: string } | null;
  /** The env var's raw value, when one is set. Never a secret — these are numbers. */
  envValue: string | null;
  dangerous: boolean;
  changedAt: string | null;
  changedBy: string | null;
};

export type AiRuntimeView = {
  settings: AiSettingView[];
  /** How long a save takes to reach every isolate. Stated, not implied. */
  cacheSeconds: number;
};

function viewFor(
  spec: AiSettingSpec,
  resolved: ResolvedSetting,
  changedByName: string | null,
  env: Record<string, string | undefined>,
): AiSettingView {
  const raw = env[spec.envVar];
  return {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    envVar: spec.envVar,
    kind: spec.kind,
    unit: spec.kind === "number" ? spec.unit : null,
    min: spec.kind === "number" ? spec.min : null,
    max: spec.kind === "number" ? spec.max : null,
    options: spec.kind === "enum" ? [...spec.options] : null,
    dbValue: resolved.dbValue,
    effectiveValue: resolved.value,
    source: resolved.source,
    invalid: resolved.invalid
      ? {
          value: String(resolved.invalid.value),
          source: resolved.invalid.source,
          reason: resolved.invalid.reason,
        }
      : null,
    envValue: raw !== undefined && raw.trim() !== "" ? raw : null,
    dangerous: spec.dangerous,
    changedAt: resolved.changedAt,
    changedBy: changedByName,
  };
}

export const getAiRuntimeSettings = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AiRuntimeView> => {
    const db = context.actor.db;
    const env = ambientEnv();

    // `fresh` on purpose. Everywhere else the sixty-second memo is what keeps a
    // config read off the hot path; here the operator has just navigated to a
    // page whose entire job is to say what is in force, and showing them a value
    // up to a minute stale — quite possibly the one they just replaced — would
    // make the page look broken in exactly the moment it needs to be trusted.
    const runtime = await loadAiRuntimeConfig(db, env, { fresh: true });

    const { data: killFlag } = await db
      .from("feature_flags")
      .select("enabled, updated_at, updated_by")
      .eq("key", "ai_kill_switch")
      .maybeSingle();

    // One lookup for every actor named across the settings, rather than one per
    // row. Display names, never emails: this page is read by every admin, and
    // "who changed the budget" does not require handing out addresses.
    const actorIds = new Set<string>();
    for (const spec of AI_RUNTIME_SETTINGS) {
      const by = runtime.resolved[spec.key].changedBy;
      if (by) actorIds.add(by);
    }
    if (killFlag?.updated_by) actorIds.add(killFlag.updated_by);

    const names = new Map<string, string>();
    if (actorIds.size > 0) {
      const { data: profiles } = await db
        .from("profiles")
        .select("id, display_name")
        .in("id", [...actorIds]);
      for (const p of profiles ?? []) names.set(p.id, p.display_name);
    }

    const settings = AI_RUNTIME_SETTINGS.map((spec) => {
      const resolved = runtime.resolved[spec.key];
      return viewFor(
        spec,
        resolved,
        resolved.changedBy ? (names.get(resolved.changedBy) ?? null) : null,
        env,
      );
    });

    // The kill switch is a feature_flags row (see KILL_SWITCH_SETTING_KEY), but
    // it belongs on this screen: an operator asking "why is AI off" should find
    // every answer in one place. Presented in the same shape as the rest so the
    // page renders one list rather than special-casing a row.
    settings.push({
      key: KILL_SWITCH_SETTING_KEY,
      label: "AI kill switch",
      description:
        "Blocks every paid AI provider call before any reservation is made. Fetching, ingestion and all deterministic processing continue.",
      envVar: "",
      kind: "boolean",
      unit: null,
      min: null,
      max: null,
      options: null,
      dbValue: killFlag ? killFlag.enabled : null,
      effectiveValue: killFlag?.enabled === true,
      // No env fallback exists for this one: an absent row means "not killed",
      // which is the code default, so the source is never "environment".
      source: killFlag ? "database" : "default",
      envValue: null,
      dangerous: true,
      invalid: null,
      changedAt: killFlag?.updated_at ?? null,
      changedBy: killFlag?.updated_by ? (names.get(killFlag.updated_by) ?? null) : null,
    });

    return { settings, cacheSeconds: Math.round(AI_RUNTIME_CACHE_MS / 1000) };
  });

/* ---------------------------------------------------------------------- */
/* Write                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Changes that need the operator to say "yes, I mean it".
 *
 * Deliberately a short list. Confirming every token tweak teaches people to
 * dismiss confirmations without reading them, which costs you the one that
 * mattered. Two cases qualify:
 *
 *   - Turning the kill switch on, or provider fallback off. Both stop briefings
 *     being produced, and the symptom looks like a provider outage rather than a
 *     setting somebody changed.
 *   - Taking the monthly budget into the top fifth of what the code permits.
 *     Not because $40 is wrong, but because a fat-fingered extra zero is
 *     indistinguishable from a deliberate raise until the invoice arrives, and
 *     this is the only place the two can be told apart.
 */
const CONFIRM_BUDGET_FRACTION = 0.8;

function needsConfirmation(key: string, value: number | boolean | string): string | null {
  if (key === KILL_SWITCH_SETTING_KEY && value === true) {
    return "This stops every paid AI call: no analysis, no digests, no Story Ask. Ingestion and deterministic processing carry on.";
  }
  if (key === "ai.provider_fallback" && value === false) {
    return "With fallback off, a route whose provider is inactive or whose secret is missing will stop the pipeline instead of using the built-in DeepSeek route.";
  }
  if (
    key === "ai.monthly_cost_usd" &&
    typeof value === "number" &&
    value >= MAX_AI_MONTHLY_COST_USD * CONFIRM_BUDGET_FRACTION
  ) {
    return `$${value.toFixed(2)} is near the $${MAX_AI_MONTHLY_COST_USD} ceiling this build allows. Confirm this is the monthly spend you intend.`;
  }
  return null;
}

const changeInput = z.object({
  changes: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        value: z.union([z.number(), z.boolean(), z.string()]),
      }),
    )
    .min(1)
    .max(AI_RUNTIME_SETTINGS.length + 1),
  /** Set by the console once the operator has acknowledged a dangerous change. */
  confirmed: z.boolean().optional().default(false),
});

export type SaveAiRuntimeResult = {
  ok: boolean;
  /** Present when the save was refused pending confirmation. */
  confirmations: { key: string; label: string; message: string }[];
  saved: string[];
};

export const saveAiRuntimeSettings = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(changeInput, input))
  .handler(async ({ context, data }): Promise<SaveAiRuntimeResult> => {
    const { actor } = context;

    // Validate everything before writing anything. A batch that is half applied
    // and half rejected leaves the operator guessing which half, and these
    // values interact — a token budget without the cost ceiling that was meant
    // to go with it is a worse state than neither.
    const confirmations: { key: string; label: string; message: string }[] = [];
    const numeric: { spec: AiSettingSpec; value: number | boolean | string }[] = [];
    let killSwitch: boolean | null = null;

    for (const change of data.changes) {
      if (change.key === KILL_SWITCH_SETTING_KEY) {
        if (typeof change.value !== "boolean") {
          throw new AdminAuthError("The kill switch is on or off.", 400);
        }
        killSwitch = change.value;
        const why = needsConfirmation(change.key, change.value);
        if (why) confirmations.push({ key: change.key, label: "AI kill switch", message: why });
        continue;
      }

      const spec = aiSettingSpec(change.key);
      if (!spec) {
        throw new AdminAuthError(`"${change.key}" is not a setting this build reads.`, 400);
      }

      const value = validate(spec, change.value);
      numeric.push({ spec, value });
      const why = needsConfirmation(spec.key, value);
      if (why) confirmations.push({ key: spec.key, label: spec.label, message: why });
    }

    if (confirmations.length > 0 && !data.confirmed) {
      return { ok: false, confirmations, saved: [] };
    }

    const now = new Date().toISOString();
    for (const { spec, value } of numeric) {
      const { error } = await actor.db.from("ai_runtime_config").upsert({
        key: spec.key,
        // Wrapped as {"value": ...} to match the `site_settings` convention 0053
        // set for `ai.daily_*_cap_microusd`. See the column comment in 0056.
        value: { value } as Json,
        changed_by: actor.id,
        changed_at: now,
      });
      if (error) throw new AdminAuthError(`Saving ${spec.label}: ${error.message}`, 500);
    }

    if (killSwitch !== null) {
      const { error } = await actor.db
        .from("feature_flags")
        .update({ enabled: killSwitch, updated_by: actor.id, updated_at: now })
        .eq("key", "ai_kill_switch");
      if (error) throw new AdminAuthError(`Saving the kill switch: ${error.message}`, 500);
    }

    // This isolate is correct immediately; every other one catches up within
    // `AI_RUNTIME_CACHE_MS`, which the page states rather than glossing over.
    invalidateAiRuntimeConfig();

    const saved = [
      ...numeric.map((n) => n.spec.key),
      ...(killSwitch === null ? [] : [KILL_SWITCH_SETTING_KEY]),
    ];
    await audit(
      actor,
      "ai.runtime.save",
      { type: "ai_runtime_config", id: saved.join(",") },
      Object.fromEntries([
        ...numeric.map((n) => [n.spec.key, n.value] as const),
        ...(killSwitch === null ? [] : [[KILL_SWITCH_SETTING_KEY, killSwitch] as const]),
      ]),
    );

    return { ok: true, confirmations: [], saved };
  });

/**
 * Refuses a value rather than clamping it.
 *
 * The resolver clamps on read, which is what stops a hand-written row from
 * breaking the pipeline. Here the operator is watching, so silently storing 50
 * when they typed 500 would be the worse behaviour — they would leave believing
 * the ceiling is 500. Say what the bound is and let them decide.
 */
function validate(spec: AiSettingSpec, raw: number | boolean | string): number | boolean | string {
  if (spec.kind === "boolean") {
    if (typeof raw !== "boolean") throw new AdminAuthError(`${spec.label} is on or off.`, 400);
    return raw;
  }
  if (spec.kind === "enum") {
    if (typeof raw !== "string" || !spec.options.includes(raw)) {
      throw new AdminAuthError(`${spec.label} must be one of: ${spec.options.join(", ")}.`, 400);
    }
    return raw;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new AdminAuthError(`${spec.label} must be a number.`, 400);
  }
  if (n < spec.min || n > spec.max) {
    throw new AdminAuthError(
      `${spec.label} must be between ${format(spec.min, spec.unit)} and ${format(spec.max, spec.unit)}. ` +
        `These are ceilings in code, not preferences — the console cannot raise them.`,
      400,
    );
  }
  if (spec.unit !== "usd" && !Number.isInteger(n)) {
    throw new AdminAuthError(`${spec.label} must be a whole number.`, 400);
  }
  return n;
}

function format(value: number, unit: "usd" | "tokens" | "count"): string {
  if (unit === "usd") return `$${value.toFixed(2)}`;
  return value.toLocaleString("en-US");
}

/**
 * Deletes the row so the setting falls back down the chain.
 *
 * Kept separate from "save the current default" for the same reason
 * `resetSetting` is in settings.ts: an absent row means "whatever env or the
 * code says", which keeps tracking future changes to either. A row holding
 * today's default silently freezes it and looks identical in the UI.
 */
export const resetAiRuntimeSetting = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ key: z.string().min(1).max(60) }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const spec = aiSettingSpec(data.key);
    if (!spec) throw new AdminAuthError(`"${data.key}" is not a setting this build reads.`, 400);

    const { error } = await context.actor.db
      .from("ai_runtime_config")
      .delete()
      .eq("key", spec.key satisfies AiSettingKey);
    if (error) throw new AdminAuthError(`Reset ${spec.label}: ${error.message}`, 500);

    invalidateAiRuntimeConfig();
    await audit(context.actor, "ai.runtime.reset", { type: "ai_runtime_config", id: spec.key });
    return { ok: true };
  });
