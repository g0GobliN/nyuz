/**
 * Reader settings shape and the generic defaults.
 *
 * Lives here, not in `prefs-store`, because the store imports the browser
 * Supabase client. Pipeline scripts typecheck against Node, which has no
 * `import.meta.env` — pulling the store into that graph is a type error.
 */

import { CANONICAL_LANGUAGE, type LanguageTag } from "@/lib/languages";

export type Prefs = {
  name: string;
  topics: string[];
  exclusions: string[];
  time: string;
  timezone: string;
  days: string[];
  channels: { email: boolean; telegram: boolean; whatsapp: boolean; push: boolean };
  density: number; // 0 minimal .. 100 deep
  frequency: "daily" | "weekly";
  breaking: "important" | "everything" | "off";
  /**
   * Reading language for story content. BCP-47, one of `LANGUAGES` in
   * src/lib/languages.ts. Not the interface language — that is static i18n
   * and a separate concern (plan2 §44).
   */
  language: LanguageTag;
  /** Briefings stop entirely. Mirrors notification_preferences.paused. */
  paused: boolean;
  onboarded: boolean;
};

/**
 * What a brand-new visitor starts with.
 *
 * These must stay GENERIC. This object shipped with a real person's name,
 * timezone and interests baked in as prototype fixtures, so every visitor who
 * finished onboarding was greeted by somebody else's first name. Anything
 * added here is shown to strangers — if a value is personal, it belongs in the
 * account, not in a default.
 *
 * `name` is empty on purpose rather than "there" or "friend": the greeting is
 * written to work without one, and inventing a placeholder identity is what
 * caused the original bug.
 */
export const DEFAULT_PREFS: Prefs = {
  name: "",
  topics: [],
  exclusions: [],
  time: "07:30",
  // Overwritten with the browser's own zone on hydration. A literal is still
  // needed because this is read during SSR, where there is no browser.
  timezone: "UTC",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  channels: { email: true, telegram: false, whatsapp: false, push: false },
  density: 35,
  frequency: "daily",
  breaking: "important",
  // English is canonical, so this default costs no translation and matches
  // what every pre-0029 row was backfilled to.
  language: CANONICAL_LANGUAGE,
  paused: false,
  onboarded: false,
};
