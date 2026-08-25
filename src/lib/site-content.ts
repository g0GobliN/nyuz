import { z } from "zod";
import { DEFAULT_ANNUAL_PRICES, DEFAULT_PLAN_PRICES } from "@/lib/plans";

/**
 * The shape of everything the console can change about the public site.
 *
 * This module is shared by three callers, which is why it holds no server
 * imports and no secrets:
 *
 *   - the public site, which renders it;
 *   - the admin console, which edits it;
 *   - the server functions in src/lib/server/settings.ts, which validate writes
 *     against these same schemas.
 *
 * One schema for all three means a value that saves is a value that renders.
 * The alternative — validating in the form and trusting the database on read —
 * puts a broken landing page one bad row away, because a jsonb column will
 * happily store `{"headline": 42}`.
 *
 * Every schema has a matching default that reproduces the copy currently bundled
 * in the components. So an empty `site_settings` table renders exactly what
 * ships today, and the console starts out showing real content rather than
 * blank fields.
 */

/* ---------------------------------------------------------------------- */
/* Hero                                                                   */
/* ---------------------------------------------------------------------- */

export const heroSchema = z.object({
  /** A newline splits the headline across two lines in the display face. */
  headline: z.string().min(1).max(160),
  sub: z.string().max(400),
  ctaLabel: z.string().min(1).max(40),
  ctaHref: z.string().min(1).max(200),
  secondaryLabel: z.string().max(40),
  secondaryHref: z.string().max(200),
  footnote: z.string().max(200),
});

export type Hero = z.infer<typeof heroSchema>;

export const HERO_DEFAULT: Hero = {
  headline: "Stop searching.\nStart knowing.",
  sub: "You don't read the news. It reports to you.",
  ctaLabel: "Build my nyuz",
  ctaHref: "/onboarding",
  secondaryLabel: "See how it works",
  secondaryHref: "/how-it-works",
  footnote: "Live sources · duplicates merged · one briefing",
};

/* ---------------------------------------------------------------------- */
/* Announcement bar                                                       */
/* ---------------------------------------------------------------------- */

/** Empty `text` means the bar does not render at all. That is the off switch. */
export const announcementSchema = z.object({
  text: z.string().max(200),
  href: z
    .string()
    .max(200)
    .refine(
      (v) => v === "" || v.startsWith("/") || v.startsWith("https://") || v.startsWith("mailto:"),
      {
        message: "Use a path beginning with /, an https:// URL, or mailto:.",
      },
    ),
  linkLabel: z.string().max(40),
});

export type Announcement = z.infer<typeof announcementSchema>;

export const ANNOUNCEMENT_DEFAULT: Announcement = { text: "", href: "", linkLabel: "" };

/* ---------------------------------------------------------------------- */
/* Section visibility                                                     */
/* ---------------------------------------------------------------------- */

/**
 * Which landing sections render, in the order the page lays them out. Keys are
 * fixed rather than free-form: a section has to exist in the bundle to be shown,
 * so an unknown key would be a silent no-op and a missing one would be a silent
 * disappearance. Both are worse than a validation error.
 */
export const SECTION_KEYS = [
  "interestDemo",
  "noise",
  "howItWorks",
  "comparison",
  "profileDemo",
  "whyDifferent",
  "aiTrust",
  "infrastructure",
  "sourceTransparency",
  "finalCta",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

const sectionKeySchema = z.enum(SECTION_KEYS);

/**
 * The stored form is an ORDERED list, because order is a real editorial
 * decision: whether the comparison table comes before or after the noise
 * argument changes what a first-time visitor is persuaded by, and that is not
 * something worth a deploy.
 *
 * The previous shape was `{ interestDemo: true, ... }` — a plain boolean map
 * with order fixed by the bundle. Rows in that form are still in the database
 * (0003 seeds one), so the schema below accepts either and normalises to the
 * list. That keeps this a code change rather than a code change plus a data
 * migration, and an old row keeps rendering the page it always rendered.
 */
const orderedSectionsSchema = z
  .array(z.object({ key: sectionKeySchema, enabled: z.boolean() }))
  .max(SECTION_KEYS.length * 2);

const legacySectionsSchema = z.record(sectionKeySchema, z.boolean());

export type SectionRow = { key: SectionKey; enabled: boolean };
export type Sections = SectionRow[];

/**
 * Annotated rather than inferred, because this schema's input and output types
 * differ: it accepts either stored form and always produces the list. Without
 * the annotation `z.infer` reports the input union, and every consumer would
 * have to narrow a shape that `parse` can never actually return.
 */
export const sectionsSchema: z.ZodType<Sections, z.ZodTypeDef, unknown> = z
  .union([orderedSectionsSchema, legacySectionsSchema])
  .transform(normaliseSections);

/**
 * Brings any accepted stored form up to a complete, duplicate-free list.
 *
 * Three things have to hold for the landing page to be safe to render from
 * this, and none of them can be expressed in the schema itself:
 *
 *   - every key appears exactly once, so a component cannot mount twice;
 *   - a key missing from storage still appears, defaulted to on, so shipping a
 *     new section does not require touching every existing row;
 *   - a key that no longer exists in the bundle is dropped rather than kept as
 *     a dangling reference.
 */
function normaliseSections(input: SectionRow[] | Partial<Record<SectionKey, boolean>>): Sections {
  const enabled = new Map<SectionKey, boolean>();
  const order: SectionKey[] = [];

  const rows: SectionRow[] = Array.isArray(input)
    ? input
    : SECTION_KEYS.filter((key) => key in input).map((key) => ({
        key,
        enabled: input[key] ?? true,
      }));

  for (const row of rows) {
    if (enabled.has(row.key)) continue;
    enabled.set(row.key, row.enabled);
    order.push(row.key);
  }

  // Anything the bundle knows about but the row did not mention goes at the
  // end, switched on. A new section is visible by default; an operator who
  // wants it hidden says so, rather than having to discover it exists.
  for (const key of SECTION_KEYS) {
    if (!enabled.has(key)) {
      enabled.set(key, true);
      order.push(key);
    }
  }

  return order.map((key) => ({ key, enabled: enabled.get(key) ?? true }));
}

export const SECTIONS_DEFAULT: Sections = SECTION_KEYS.map((key) => ({ key, enabled: true }));

/** Moves one section up or down. Returns the input unchanged at either end. */
export function moveSection(sections: Sections, index: number, delta: -1 | 1): Sections {
  const target = index + delta;
  if (index < 0 || index >= sections.length) return sections;
  if (target < 0 || target >= sections.length) return sections;

  const next = [...sections];
  const a = next[index];
  const b = next[target];
  if (!a || !b) return sections;
  next[index] = b;
  next[target] = a;
  return next;
}

/** Human labels for the console's checkbox list. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  interestDemo: "Interest picker demo",
  noise: "The noise problem",
  howItWorks: "How it works (summary)",
  comparison: "Comparison table",
  profileDemo: "Profile / briefing demo",
  whyDifferent: "Why nyuz is different",
  aiTrust: "AI trust and limits",
  infrastructure: "Infrastructure and scale",
  sourceTransparency: "Source transparency",
  finalCta: "Closing call to action",
};

/* ---------------------------------------------------------------------- */
/* Media slots                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Named places on the landing page where an operator can drop an image.
 *
 * Fixed slots rather than a free image library, for the same reason section
 * keys are fixed: a slot has one defined render site, a known aspect ratio and
 * a known fallback. A general "upload images and place them anywhere" feature
 * is a page builder, and a page builder is how a careful landing page becomes
 * an careless one.
 *
 *   hero    — the right-hand column of the hero. Falls back to the animated
 *             <HeroPipeline /> when empty, so the shipped page is the default.
 *   midpage — a full-width band between sections. Renders nothing when empty.
 *   closing — above the final call to action. Renders nothing when empty.
 */
export const MEDIA_SLOTS = ["hero", "midpage", "closing"] as const;

export type MediaSlot = (typeof MEDIA_SLOTS)[number];

/**
 * `url` is validated as a same-origin path or an https URL, and nothing else.
 * That rules out `javascript:` and `data:` in an attribute that ends up in the
 * DOM — the console is staff-only, but a stored value that reaches every
 * visitor deserves the check regardless of who typed it.
 */
const mediaUrlSchema = z
  .string()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), {
    message: "Use a path beginning with / or an https:// URL.",
  });

const mediaItemSchema = z.object({
  url: mediaUrlSchema,
  /** Required whenever a url is set — enforced below, not by the field. */
  alt: z.string().max(200),
  caption: z.string().max(200),
});

export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaSchema = z.object(
  MEDIA_SLOTS.reduce(
    (shape, slot) => {
      shape[slot] = mediaItemSchema.refine((m) => m.url === "" || m.alt.trim() !== "", {
        message: "Alt text is required when an image is set.",
      });
      return shape;
    },
    {} as Record<MediaSlot, z.ZodType<MediaItem>>,
  ),
);

export type Media = z.infer<typeof mediaSchema>;

const EMPTY_MEDIA: MediaItem = { url: "", alt: "", caption: "" };

export const MEDIA_DEFAULT: Media = MEDIA_SLOTS.reduce((all, slot) => {
  all[slot] = EMPTY_MEDIA;
  return all;
}, {} as Media);

export const MEDIA_LABELS: Record<MediaSlot, { label: string; hint: string }> = {
  hero: {
    label: "Hero visual",
    hint: "Replaces the animated pipeline graphic. Roughly 4:3. Leave empty to keep the animation.",
  },
  midpage: {
    label: "Mid-page band",
    hint: "Full-width, between sections. Wide crop — around 3:1. Empty means no band.",
  },
  closing: {
    label: "Closing visual",
    hint: "Above the final call to action. Empty means no image.",
  },
};

/* ---------------------------------------------------------------------- */
/* SEO and footer                                                         */
/* ---------------------------------------------------------------------- */

export const seoSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(300),
  ogImage: z.string().max(300),
});

export type Seo = z.infer<typeof seoSchema>;

export const SEO_DEFAULT: Seo = {
  title: "nyuz — Stop searching. Start knowing.",
  description:
    "You don't read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.",
  ogImage: "/og-image.png",
};

export const footerSchema = z.object({
  blurb: z.string().max(500),
  tagline: z.string().max(200),
});

export type Footer = z.infer<typeof footerSchema>;

export const FOOTER_DEFAULT: Footer = {
  blurb:
    "nyuz summarises and links to original reporting. Summaries are generated and can be wrong — every story keeps its sources one tap away.",
  tagline: "Less information. More relevance. Zero searching.",
};

/* ---------------------------------------------------------------------- */
/* Plan prices                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Prices live here as well as in src/lib/plans.ts because the console can
 * override them. `plans.ts` owns the shipped defaults and the revenue
 * arithmetic; this schema only describes what a valid override looks like.
 *
 * Whole dollars, and capped: the ceiling is not a business rule, it is a
 * fat-finger guard. A stray keystroke turning $7 into $7000 on a public pricing
 * page is the kind of mistake worth making impossible.
 */
export const pricesSchema = z.object({
  free: z.literal(0),
  personal: z.number().int().min(0).max(999),
  pro: z.number().int().min(0).max(999),
  /** Annual totals. Zero means "no annual option shown". */
  personalAnnual: z.number().int().min(0).max(9999),
  proAnnual: z.number().int().min(0).max(9999),
});

export type Prices = z.infer<typeof pricesSchema>;

/**
 * The prices the bundled pricing page actually renders today.
 *
 * Monthly figures come from `plans.ts` so that repricing there moves this default
 * too, rather than leaving the console showing last quarter's numbers as "the
 * bundled copy". Annual figures come from the same file: they are the Stripe
 * catalogue — $70 and $150, two months free against monthly.
 */
export const PRICES_DEFAULT: Prices = {
  free: 0,
  personal: DEFAULT_PLAN_PRICES.personal,
  pro: DEFAULT_PLAN_PRICES.pro,
  personalAnnual: DEFAULT_ANNUAL_PRICES.personal,
  proAnnual: DEFAULT_ANNUAL_PRICES.pro,
};

/* ---------------------------------------------------------------------- */
/* The resolved bundle the public site renders                             */
/* ---------------------------------------------------------------------- */

/**
 * Everything the public site needs in one object, already parsed.
 *
 * This type and its fallback live here rather than beside the server function
 * that produces them because the components that consume it — the nav, the
 * footer, the landing sections — render in a browser, and nothing that renders
 * in a browser should import from `src/lib/server`. Even though the bundler
 * strips server handlers, reaching across that line invites the day someone adds
 * a top-level side effect to a server module and ships a secret with it.
 *
 * `flags` is already resolved to booleans for the current visitor, so a
 * component asks `content.flags.blog` and never learns what a rollout percentage
 * is.
 */
export type PublicSiteContent = {
  hero: Hero;
  announcement: Announcement;
  sections: Sections;
  media: Media;
  seo: Seo;
  footer: Footer;
  prices: Prices;
  /** Resolved on/off per flag key for this visitor. Absent key means off. */
  flags: Record<string, boolean>;
  /** True when at least one value came from the database rather than the bundle. */
  customised: boolean;
};

/**
 * What the site renders when the database is unreachable, empty, or full of
 * malformed rows — which is to say, exactly what is bundled in this build.
 *
 * Components take this as their prop default too, so a component rendered
 * outside a route with a loader still shows real copy instead of empty strings.
 */
export const PUBLIC_CONTENT_FALLBACK: PublicSiteContent = {
  hero: HERO_DEFAULT,
  announcement: ANNOUNCEMENT_DEFAULT,
  sections: SECTIONS_DEFAULT,
  media: MEDIA_DEFAULT,
  seo: SEO_DEFAULT,
  footer: FOOTER_DEFAULT,
  prices: PRICES_DEFAULT,
  flags: {},
  customised: false,
};

/* ---------------------------------------------------------------------- */
/* The registry                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Every editable key in one table, so the console can render a form per key
 * without knowing what any of them mean, and `saveSetting` can look up the
 * right validator by key instead of carrying a switch statement.
 */
export const SETTING_KEYS = [
  "landing.hero",
  "landing.announcement",
  "landing.sections",
  "landing.media",
  "site.seo",
  "site.footer",
  "billing.prices",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

/** Schema per key. Used on write by the server and on read by the site. */
export const SETTING_SCHEMAS = {
  "landing.hero": heroSchema,
  "landing.announcement": announcementSchema,
  "landing.sections": sectionsSchema,
  "landing.media": mediaSchema,
  "site.seo": seoSchema,
  "site.footer": footerSchema,
  "billing.prices": pricesSchema,
} as const;

export const SETTING_LABELS: Record<SettingKey, string> = {
  "landing.hero": "Landing hero",
  "landing.announcement": "Announcement bar",
  "landing.sections": "Landing sections",
  "landing.media": "Landing media",
  "site.seo": "SEO and social preview",
  "site.footer": "Footer copy",
  "billing.prices": "Plan prices",
};

/**
 * Parses a stored value, returning the fallback when it is missing or malformed.
 *
 * Deliberately does not throw. These values feed the marketing site, and a
 * single bad row should cost one wrong headline, not the whole page. Callers
 * that need to know whether the stored value was used get that from the second
 * element of the tuple.
 */
export function parseSetting<T>(
  // Input typed as `unknown` rather than `T`: `stored` comes out of a jsonb
  // column and is genuinely unknown, and schemas that transform on the way in
  // (sections) have an input type that is not their output type.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  stored: unknown,
  fallback: T,
): [T, boolean] {
  if (stored === null || stored === undefined) return [fallback, false];
  const result = schema.safeParse(stored);
  return result.success ? [result.data, true] : [fallback, false];
}
