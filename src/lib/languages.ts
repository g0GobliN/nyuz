/**
 * The languages a reader can receive their briefing in.
 *
 * One list, used by the preference UI, the translation pipeline and the
 * validation on both — a language that can be selected is a language that can
 * be generated, because they read the same array.
 *
 * **English is canonical, not "one of six."** Analysis runs in English,
 * clustering compares English headlines, and `events` holds English text.
 * Everything else is a cached view of that (docs/plan2.md phase 39–45), which
 * is why `en` is special-cased everywhere rather than being a translation
 * target with an identity function.
 *
 * Tags are BCP-47. `zh-Hans` rather than bare `zh` deliberately: Simplified
 * and Traditional are not interchangeable to a reader, and a schema that
 * stored `zh` could not express the difference later without a migration of
 * every cached row. Adding Traditional later is a new entry here, not a
 * variant of this one.
 */

export const CANONICAL_LANGUAGE = "en" as const;

export type LanguageTag = "en" | "ja" | "hi" | "ne" | "ko" | "zh-Hans";

export type Language = {
  tag: LanguageTag;
  /** English name, for admin surfaces and logs. */
  name: string;
  /** The name in the language itself, for the reader's own picker. */
  endonym: string;
};

export const LANGUAGES: readonly Language[] = [
  { tag: "en", name: "English", endonym: "English" },
  { tag: "ja", name: "Japanese", endonym: "日本語" },
  { tag: "hi", name: "Hindi", endonym: "हिन्दी" },
  { tag: "ne", name: "Nepali", endonym: "नेपाली" },
  { tag: "ko", name: "Korean", endonym: "한국어" },
  { tag: "zh-Hans", name: "Chinese (Simplified)", endonym: "简体中文" },
];

const BY_TAG = new Map(LANGUAGES.map((l) => [l.tag, l]));

export function isLanguageTag(value: string): value is LanguageTag {
  return BY_TAG.has(value as LanguageTag);
}

/**
 * A stored value, clamped to something renderable.
 *
 * Reads never throw: a row carrying a language this build does not know about
 * — rolled back deploy, hand-edited row, a tag removed from the list — costs
 * one briefing in English rather than a failed digest run. Same reasoning as
 * `site-content.ts`'s malformed-row fallback.
 */
export function toLanguageTag(value: string | null | undefined): LanguageTag {
  return value && isLanguageTag(value) ? value : CANONICAL_LANGUAGE;
}

export function languageName(tag: LanguageTag): string {
  return BY_TAG.get(tag)?.name ?? tag;
}

/** Whether text in this language needs generating at all. */
export function needsTranslation(tag: LanguageTag): boolean {
  return tag !== CANONICAL_LANGUAGE;
}
