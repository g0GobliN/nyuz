/**
 * Launch cost-safety knobs.
 *
 * Every value is read from the database feature_flags / site_settings so the
 * operator can toggle behaviour without a deploy. Callers inside the app
 * import this module and ask it "am I allowed?" — they never read env vars
 * directly and never bypass the gate.
 *
 * The file is deliberately free of provider/model code so it is cheap to
 * import from anywhere, including the browser bundle where needed for
 * conditional rendering.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ambientEnv } from "@/lib/runtime-env";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/* ---------------------------------------------------------------------- */
/* Feature enum                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Every AI call site, plus `unknown` for rows whose provenance we cannot
 * honestly map (pre-launch rows that pre-date feature tagging — confirmed on
 * 2026-09-12 to be history rather than a live untagged path: the newest such
 * row is 2026-09-04T03:42 and the first labelled one is 2026-09-04T08:10).
 *
 * Keep in step with the `ai_usage_ledger_feature_check` constraint, most
 * recently widened in migration 0078, and the `AiFeature` type in
 * `src/lib/supabase/types.ts`.
 */
export type AiFeature =
  | "cluster"
  | "analyse"
  | "enrich"
  | "translate"
  | "impact"
  | "ask"
  | "understand_generation"
  | "unknown";

/* ---------------------------------------------------------------------- */
/* Flag keys                                                              */
/* ---------------------------------------------------------------------- */

const KILL_SWITCH_KEY = "ai_kill_switch";
const ASK_KEY = "ask_nyuz_enabled";
const TRANSLATION_KEY = "story_translation_enabled";
const ENRICHMENT_KEY = "enrichment_pass_enabled";

const FLASH_CAP_KEY = "ai.daily_flash_cap_microusd";
const PRO_CAP_KEY = "ai.daily_pro_cap_microusd";

/** Mirrors the argument defaults of `reserve_ai_tokens` in migration 0053. */
export const DEFAULT_FLASH_CAP_MICROUSD = 1_000_000;
export const DEFAULT_PRO_CAP_MICROUSD = 5_000_000;

/* ---------------------------------------------------------------------- */
/* Reads                                                                  */
/* ---------------------------------------------------------------------- */

async function readFlag(db: Db, key: string): Promise<boolean> {
  const { data } = await db.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled === true;
}

/**
 * A number stored in `site_settings`.
 *
 * The column is jsonb and 0053 writes `{"value": 1000000}`, so the number is
 * one level in. Reading `data.value` directly and type-checking it against the
 * fallback compares an object to a number, always fails, and silently returns
 * the fallback — which looks exactly like a setting the operator never set.
 */
async function readNumberSetting(db: Db, key: string, fallback: number): Promise<number> {
  const { data } = await db.from("site_settings").select("value").eq("key", key).maybeSingle();
  const stored = (data?.value as { value?: unknown } | null)?.value;
  return typeof stored === "number" && Number.isFinite(stored) && stored > 0
    ? Math.round(stored)
    : fallback;
}

/* ---------------------------------------------------------------------- */
/* Public API                                                            */
/* ---------------------------------------------------------------------- */

/**
 * The per-model daily spend ceiling, in micro-USD.
 *
 * Read from `site_settings.ai.daily_flash_cap_microusd` /
 * `ai.daily_pro_cap_microusd`, falling back to conservative pre-launch
 * defaults ($1 Flash, $5 Pro per day). An environment variable overrides both,
 * for an operator who needs the cap changed faster than a console round trip.
 *
 * `reserve_ai_tokens` carries the same two defaults as SQL argument defaults,
 * so a caller that passes neither is still capped — these functions decide
 * whether the operator's number or the built-in one is used, never whether
 * there is a cap at all.
 */
export async function dailyFlashCapMicrousd(db: Db): Promise<number> {
  const env = ambientEnv();
  const raw = env["AI_DAILY_FLASH_CAP_MICROUSD"];
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return readNumberSetting(db, FLASH_CAP_KEY, DEFAULT_FLASH_CAP_MICROUSD);
}

export async function dailyProCapMicrousd(db: Db): Promise<number> {
  const env = ambientEnv();
  const raw = env["AI_DAILY_PRO_CAP_MICROUSD"];
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return readNumberSetting(db, PRO_CAP_KEY, DEFAULT_PRO_CAP_MICROUSD);
}

/**
 * Global kill switch. True means every paid AI provider call is blocked
 * before any reservation or model call. Deterministic work, fetching and
 * ingestion continue regardless.
 *
 * Default: false (AI allowed under normal rules).
 */
export async function isAiKillSwitchOn(db: Db): Promise<boolean> {
  return readFlag(db, KILL_SWITCH_KEY);
}

/**
 * Ask Nyuz. False means the per-story "Ask nyuz" panel is hidden in the UI
 * and the backend refuses to call a model before any reservation is made.
 *
 * Default: false (off for launch).
 */
export async function isAskNyuzEnabled(db: Db): Promise<boolean> {
  return readFlag(db, ASK_KEY);
}

/**
 * AI story translation. False means no model call is made to translate story
 * content. Normal application UI i18n is unaffected.
 *
 * Default: false (off for launch).
 */
export async function isStoryTranslationEnabled(db: Db): Promise<boolean> {
  return readFlag(db, TRANSLATION_KEY);
}

/**
 * Material-enrichment pass. False means `runEnrichment()` in analyse.ts does
 * not call a model, make a reservation, or spend tokens. The first-pass
 * analysis continues unchanged.
 *
 * Default: false (off for launch).
 */
export async function isEnrichmentPassEnabled(db: Db): Promise<boolean> {
  return readFlag(db, ENRICHMENT_KEY);
}

/**
 * Convenience: all flags in one object. Cache at the caller; these values
 * change only when an admin edits them.
 */
export type LaunchFlags = {
  aiKillSwitch: boolean;
  askNyuz: boolean;
  storyTranslation: boolean;
  enrichmentPass: boolean;
};

/**
 * Both caps in one round trip, for the reservation path.
 *
 * `reserveUsage` already makes one flag read per call; two more single-key
 * reads for the caps would be three, so the two settings are fetched together.
 */
export async function dailyCapsMicrousd(
  db: Db,
  env: Record<string, string | undefined> = ambientEnv(),
): Promise<{ flash: number; pro: number }> {
  const override = (key: string): number | null => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const flashOverride = override("AI_DAILY_FLASH_CAP_MICROUSD");
  const proOverride = override("AI_DAILY_PRO_CAP_MICROUSD");
  if (flashOverride !== null && proOverride !== null) {
    return { flash: flashOverride, pro: proOverride };
  }

  const { data } = await db
    .from("site_settings")
    .select("key, value")
    .in("key", [FLASH_CAP_KEY, PRO_CAP_KEY]);

  const stored = new Map<string, unknown>(
    ((data ?? []) as { key: string; value: { value?: unknown } | null }[]).map((row) => [
      row.key,
      row.value?.value,
    ]),
  );
  const read = (key: string, fallback: number): number => {
    const v = stored.get(key);
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  };

  return {
    flash: flashOverride ?? read(FLASH_CAP_KEY, DEFAULT_FLASH_CAP_MICROUSD),
    pro: proOverride ?? read(PRO_CAP_KEY, DEFAULT_PRO_CAP_MICROUSD),
  };
}

export async function loadLaunchFlags(db: Db): Promise<LaunchFlags> {
  const [aiKillSwitch, askNyuz, storyTranslation, enrichmentPass] = await Promise.all([
    isAiKillSwitchOn(db),
    isAskNyuzEnabled(db),
    isStoryTranslationEnabled(db),
    isEnrichmentPassEnabled(db),
  ]);
  return { aiKillSwitch, askNyuz, storyTranslation, enrichmentPass };
}
