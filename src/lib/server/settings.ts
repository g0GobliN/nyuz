import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminOnly, audit, superadminOnly, AdminAuthError } from "@/lib/server/guard";
import { countOrThrow } from "@/lib/supabase/count";
import {
  ANNOUNCEMENT_DEFAULT,
  FOOTER_DEFAULT,
  HERO_DEFAULT,
  MEDIA_DEFAULT,
  ACCESS_DEFAULT,
  PRICES_DEFAULT,
  PUBLIC_CONTENT_FALLBACK,
  SECTIONS_DEFAULT,
  SEO_DEFAULT,
  SETTING_SCHEMAS,
  announcementSchema,
  footerSchema,
  heroSchema,
  isSettingKey,
  mediaSchema,
  parseSetting,
  accessSchema,
  pricesSchema,
  sectionsSchema,
  seoSchema,
  type PublicSiteContent,
  type SettingKey,
} from "@/lib/site-content";
import type { Json } from "@/lib/supabase/types";

/**
 * Site settings, feature flags and the audit log.
 *
 * The read path here is the one that has to be bulletproof, because it runs on
 * every render of the public marketing site. It therefore:
 *
 *   - runs with no middleware, so it works for a signed-out visitor;
 *   - never throws — a database problem yields the bundled default copy, not a
 *     500 on the home page;
 *   - validates every stored blob against the schema the components expect, so
 *     a hand-edited jsonb row cannot put `undefined` where a headline goes.
 *
 * The write path is the opposite: strict, validated against the same schemas,
 * and audited.
 */

/* ---------------------------------------------------------------------- */
/* Public read                                                            */
/* ---------------------------------------------------------------------- */

/**
 * `PublicSiteContent` and `PUBLIC_CONTENT_FALLBACK` are defined in
 * src/lib/site-content.ts, not here, because the nav and footer take them as prop
 * defaults and no browser component should import from src/lib/server. They are
 * re-exported so that a caller who only needs the read path can get the function
 * and its return type from one place.
 */
export type { PublicSiteContent } from "@/lib/site-content";
export { PUBLIC_CONTENT_FALLBACK } from "@/lib/site-content";

export const getPublicSiteContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSiteContent> => {
    try {
      const db = createAdminClient();
      const [settings, flags] = await Promise.all([
        db.from("site_settings").select("key, value"),
        db.from("feature_flags").select("key, enabled, rollout_percent"),
      ]);

      const byKey = new Map<string, unknown>(
        (settings.data ?? []).map((row) => [row.key, row.value as unknown]),
      );

      const [hero, heroSet] = parseSetting(heroSchema, byKey.get("landing.hero"), HERO_DEFAULT);
      const [announcement, annSet] = parseSetting(
        announcementSchema,
        byKey.get("landing.announcement"),
        ANNOUNCEMENT_DEFAULT,
      );
      const [sections, secSet] = parseSetting(
        sectionsSchema,
        byKey.get("landing.sections"),
        SECTIONS_DEFAULT,
      );
      const [media, medSet] = parseSetting(mediaSchema, byKey.get("landing.media"), MEDIA_DEFAULT);
      const [seo, seoSet] = parseSetting(seoSchema, byKey.get("site.seo"), SEO_DEFAULT);
      const [footer, footSet] = parseSetting(
        footerSchema,
        byKey.get("site.footer"),
        FOOTER_DEFAULT,
      );
      const [prices, priceSet] = parseSetting(
        pricesSchema,
        byKey.get("billing.prices"),
        PRICES_DEFAULT,
      );
      // Not folded into `customised`: whether the doors are open is operational
      // state, not an edit to the marketing copy, and the console reports those
      // separately.
      const [access] = parseSetting(accessSchema, byKey.get("site.access"), ACCESS_DEFAULT);

      // Anonymous visitors have no stable identifier to bucket on, so a partial
      // rollout resolves to OFF for them rather than being rounded up to ON.
      // Marketing flags are the wrong place to be optimistic: showing a nav link
      // to half of logged-out traffic at random is worse than not shipping it.
      const resolved: Record<string, boolean> = {};
      for (const flag of flags.data ?? []) {
        if (flag.key === "blog") {
          resolved[flag.key] = flag.enabled && flag.rollout_percent >= 100;
        }
      }

      return {
        hero,
        announcement,
        sections,
        media,
        seo,
        footer,
        prices,
        access,
        flags: resolved,
        customised: heroSet || annSet || secSet || medSet || seoSet || footSet || priceSet,
      };
    } catch {
      // Bundled copy. The site renders; the console will show that nothing is
      // overridden, which is the truthful state from the page's point of view.
      return PUBLIC_CONTENT_FALLBACK;
    }
  },
);

/**
 * Deterministic 0–99 bucket for a flag and a user.
 *
 * FNV-1a rather than a crypto hash because this runs on every flag check and
 * has no security role — it only needs to be stable and evenly spread. Keying on
 * `flag:user` and not just the user means two flags at 10% do not hit the same
 * 10% of people, which would make partial rollouts useless for isolating cause.
 */
export function flagBucket(flagKey: string, userId: string): number {
  const input = `${flagKey}:${userId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime with shifts to stay inside 32 bits.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash % 100;
}

/** Flag state for a signed-in user, honouring partial rollout. Never throws. */
export async function evaluateFlags(userId: string): Promise<Record<string, boolean>> {
  try {
    const db = createAdminClient();
    const { data } = await db.from("feature_flags").select("key, enabled, rollout_percent");
    const out: Record<string, boolean> = {};
    for (const flag of data ?? []) {
      out[flag.key] =
        flag.enabled &&
        (flag.rollout_percent >= 100 || flagBucket(flag.key, userId) < flag.rollout_percent);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Launch cost-safety flags (0053). No user bucketing — these control whether
 * AI is allowed at all, so partial rollout would be meaningless.
 *
 * Returns null when the database is unreachable; the caller should treat that
 * as "off" for the two disabled-by-default flags and "on" for the two that
 * gate existing functionality.
 */
export type LaunchFlagsView = {
  aiKillSwitch: boolean;
  askNyuz: boolean;
  storyTranslation: boolean;
  enrichmentPass: boolean;
};

export const getLaunchFlags = createServerFn({ method: "GET" }).handler(
  async (): Promise<LaunchFlagsView> => {
    try {
      const db = createAdminClient();
      const { data } = await db
        .from("feature_flags")
        .select("key, enabled")
        .in("key", [
          "ai_kill_switch",
          "ask_nyuz_enabled",
          "story_translation_enabled",
          "enrichment_pass_enabled",
        ]);
      const byKey = new Map((data ?? []).map((f) => [f.key, f.enabled === true]));
      return {
        aiKillSwitch: byKey.get("ai_kill_switch") ?? false,
        askNyuz: byKey.get("ask_nyuz_enabled") ?? false,
        storyTranslation: byKey.get("story_translation_enabled") ?? false,
        enrichmentPass: byKey.get("enrichment_pass_enabled") ?? false,
      };
    } catch {
      return {
        aiKillSwitch: false,
        askNyuz: false,
        storyTranslation: false,
        enrichmentPass: false,
      };
    }
  },
);

/* ---------------------------------------------------------------------- */
/* Admin read                                                             */
/* ---------------------------------------------------------------------- */

export type SettingRow = {
  key: string;
  value: Json;
  /** False when the stored blob fails its schema — shown as a warning. */
  valid: boolean;
  known: boolean;
  updatedAt: string;
};

export type FlagRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  updatedAt: string;
};

export type AdminSettingsView = {
  settings: SettingRow[];
  flags: FlagRow[];
  /** Keys with no row yet — the console offers to create them from defaults. */
  missingKeys: string[];
};

export const getAdminSettings = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<AdminSettingsView> => {
    const db = context.actor.db;
    const [settings, flags] = await Promise.all([
      db.from("site_settings").select("key, value, updated_at").order("key"),
      db.from("feature_flags").select("*").order("key"),
    ]);

    if (settings.error) throw new AdminAuthError(`Settings: ${settings.error.message}`, 500);
    if (flags.error) throw new AdminAuthError(`Flags: ${flags.error.message}`, 500);

    const rows: SettingRow[] = (settings.data ?? []).map((row) => {
      const known = isSettingKey(row.key);
      const schema = known ? SETTING_SCHEMAS[row.key as SettingKey] : null;
      return {
        key: row.key,
        value: row.value,
        valid: schema ? schema.safeParse(row.value).success : true,
        known,
        updatedAt: row.updated_at,
      };
    });

    const present = new Set(rows.map((r) => r.key));

    return {
      settings: rows,
      flags: (flags.data ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        enabled: f.enabled,
        rolloutPercent: f.rollout_percent,
        updatedAt: f.updated_at,
      })),
      missingKeys: Object.keys(SETTING_SCHEMAS).filter((k) => !present.has(k)),
    };
  });

/* ---------------------------------------------------------------------- */
/* Writes                                                                 */
/* ---------------------------------------------------------------------- */

export const saveSetting = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ key: z.string().max(60), value: z.unknown() }), input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    // Unknown keys are refused rather than stored. A key nothing reads is dead
    // weight that later looks like a bug ("I changed it and nothing happened").
    if (!isSettingKey(data.key)) {
      throw new AdminAuthError(`"${data.key}" is not a setting this build reads.`, 400);
    }

    const parsed = SETTING_SCHEMAS[data.key].safeParse(data.value);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.join(".") || "value";
      throw new AdminAuthError(`${where}: ${first?.message ?? "invalid value"}`, 400);
    }

    const { error } = await actor.db.from("site_settings").upsert({
      key: data.key,
      value: parsed.data as Json,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new AdminAuthError(`Save setting: ${error.message}`, 500);

    await audit(actor, "settings.save", { type: "site_setting", id: data.key });
    return { ok: true };
  });

/**
 * Deletes the row so the site falls back to the copy in the bundle.
 *
 * Kept separate from "save the default value" on purpose: an absent row means
 * "whatever the code ships", which keeps tracking future copy changes. A row
 * holding today's default silently freezes it.
 */
export const resetSetting = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ key: z.string().max(60) }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.actor.db.from("site_settings").delete().eq("key", data.key);
    if (error) throw new AdminAuthError(`Reset setting: ${error.message}`, 500);
    await audit(context.actor, "settings.reset", { type: "site_setting", id: data.key });
    return { ok: true };
  });

export const setFlag = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        key: z.string().min(1).max(60),
        enabled: z.boolean(),
        rolloutPercent: z.number().int().min(0).max(100).optional().default(100),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    // Toggling an existing flag is an admin action; inventing one is not, so an
    // unknown key is refused here and created through `createFlag` instead.
    const { data: existing, error: lookup } = await actor.db
      .from("feature_flags")
      .select("key")
      .eq("key", data.key)
      .maybeSingle();
    if (lookup) throw new AdminAuthError(`Flag lookup: ${lookup.message}`, 500);
    if (!existing) throw new AdminAuthError(`No flag named "${data.key}".`, 404);

    const { error } = await actor.db
      .from("feature_flags")
      .update({
        enabled: data.enabled,
        rollout_percent: data.rolloutPercent,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      })
      .eq("key", data.key);
    if (error) throw new AdminAuthError(`Save flag: ${error.message}`, 500);

    await audit(
      actor,
      "flag.set",
      { type: "feature_flag", id: data.key },
      {
        enabled: data.enabled,
        rollout: data.rolloutPercent,
      },
    );
    return { ok: true };
  });

/**
 * Superadmin-only, because a flag key is a contract with the code. Adding one
 * nothing reads is harmless clutter; the restriction is really about keeping the
 * flag list short enough that every entry still means something.
 */
export const createFlag = createServerFn({ method: "POST" })
  .middleware([superadminOnly])
  .validator((input: unknown) =>
    z
      .object({
        key: z
          .string()
          .min(2)
          .max(60)
          .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, digits and underscores."),
        label: z.string().max(120).optional().default(""),
        description: z.string().max(500).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;
    const { error } = await actor.db.from("feature_flags").insert({
      key: data.key,
      label: data.label || data.key,
      description: data.description,
      enabled: false,
      rollout_percent: 100,
      updated_by: actor.id,
    });
    if (error?.code === "23505") {
      throw new AdminAuthError("A flag with that key already exists.", 409);
    }
    if (error) throw new AdminAuthError(`Create flag: ${error.message}`, 500);

    await audit(actor, "flag.create", { type: "feature_flag", id: data.key });
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Audit log                                                              */
/* ---------------------------------------------------------------------- */

export type AuditRow = {
  id: number;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Json;
  createdAt: string;
};

export type AuditResult = { rows: AuditRow[]; total: number; page: number; pageSize: number };

export const listAudit = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        action: z.string().max(60).optional().default(""),
        actorEmail: z.string().max(200).optional().default(""),
        page: z.number().int().min(0).optional().default(0),
        pageSize: z.number().int().min(1).max(100).optional().default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<AuditResult> => {
    const from = data.page * data.pageSize;
    let query = context.actor.db
      .from("admin_audit_log")
      .select("id, actor_email, action, target_type, target_id, meta, created_at", {
        count: "exact",
      });

    // The same character strip as the user search: these values land in a
    // PostgREST filter, where commas and parentheses are syntax.
    const action = data.action.replace(/[,()*\\]/g, "").trim();
    const email = data.actorEmail.replace(/[,()*\\]/g, "").trim();
    if (action) query = query.eq("action", action);
    if (email) query = query.ilike("actor_email", `%${email}%`);

    const {
      data: rows,
      count,
      error,
    } = await query.order("created_at", { ascending: false }).range(from, from + data.pageSize - 1);

    if (error) throw new AdminAuthError(`Audit log: ${error.message}`, 500);

    return {
      rows: (rows ?? []).map((r) => ({
        id: r.id,
        actorEmail: r.actor_email,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        meta: r.meta,
        createdAt: r.created_at,
      })),
      // The audit log is already a failure surface: the line above throws on
      // an unreadable read, and a total of zero on a page full of rows is the
      // kind of number an operator would believe.
      total: countOrThrow("admin audit log", { count, error }),
      page: data.page,
      pageSize: data.pageSize,
    };
  });

/** Distinct action names, for the filter dropdown. */
export const listAuditActions = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<string[]> => {
    // No DISTINCT in PostgREST. The action vocabulary is small and fixed by the
    // code, so scanning the recent window and de-duplicating in memory is both
    // cheap and bounded — unlike a full-table distinct as the log grows.
    const { data, error } = await context.actor.db
      .from("admin_audit_log")
      .select("action")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new AdminAuthError(`Audit actions: ${error.message}`, 500);
    return [...new Set((data ?? []).map((r) => r.action))].sort();
  });
