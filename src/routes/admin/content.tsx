import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  formatDateTime,
  inputClass,
  useConsoleMutation,
  useViewer,
} from "@/components/admin/shell";
import { Button, Chip } from "@/components/kit";
import {
  createFlag,
  getAdminSettings,
  resetSetting,
  saveSetting,
  setFlag,
  type FlagRow,
  type SettingRow,
} from "@/lib/server/settings";
import {
  ANNOUNCEMENT_DEFAULT,
  FOOTER_DEFAULT,
  HERO_DEFAULT,
  MEDIA_DEFAULT,
  MEDIA_LABELS,
  MEDIA_SLOTS,
  PRICES_DEFAULT,
  SECTIONS_DEFAULT,
  SECTION_LABELS,
  SEO_DEFAULT,
  SETTING_LABELS,
  announcementSchema,
  footerSchema,
  heroSchema,
  mediaSchema,
  moveSection,
  parseSetting,
  pricesSchema,
  sectionsSchema,
  seoSchema,
  type Announcement,
  type Footer,
  type Hero,
  type Media,
  type MediaItem,
  type MediaSlot,
  type Prices,
  type Sections,
  type Seo,
  type SettingKey,
} from "@/lib/site-content";

export const Route = createFileRoute("/admin/content")({ component: ContentPage });

type Tab = "landing" | "site" | "flags";

function ContentPage() {
  const [tab, setTab] = useState<Tab>("landing");

  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => getAdminSettings(),
    staleTime: 30_000,
  });

  if (settings.isLoading) return <Loading label="Loading site content" />;

  const data = settings.data;
  const byKey = new Map<string, SettingRow>((data?.settings ?? []).map((s) => [s.key, s]));

  // A row that fails its own schema is the one state the forms cannot explain by
  // themselves: the public site is quietly rendering bundled copy while the
  // console shows the key as overridden. Say so once, at the top, with names.
  const broken = (data?.settings ?? []).filter((s) => !s.valid);

  // `missingKeys` from the server is deliberately not shown as a to-do list. A key
  // with no row is not missing — it means "use the copy shipped with this build",
  // which is the right state for anything nobody has edited, and each form below
  // already says so in its own footer.

  return (
    <>
      <ConsoleHeader
        title="Site content"
        sub="Copy on the public pages, and the flags that decide which of them are visible. Every value here is validated against the same schema the components render from, so a value that saves is a value that renders."
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        <Chip active={tab === "landing"} onClick={() => setTab("landing")}>
          Landing page
        </Chip>
        <Chip active={tab === "site"} onClick={() => setTab("site")}>
          Site and pricing
        </Chip>
        <Chip active={tab === "flags"} onClick={() => setTab("flags")}>
          Feature flags
        </Chip>
      </div>

      <ErrorNote error={settings.error} />

      {broken.length > 0 ? (
        <p className="mb-5 rounded-2xl border border-border bg-surface-2 px-5 py-4 text-[13px] leading-relaxed">
          {broken.length === 1 ? "One stored value does" : `${broken.length} stored values do`} not
          match the shape this build expects ({broken.map((b) => b.key).join(", ")}). The public
          site is rendering the bundled copy for {broken.length === 1 ? "it" : "them"} rather than
          failing. Saving from this page repairs the row.
        </p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          {tab === "landing" ? (
            <>
              <HeroForm row={byKey.get("landing.hero")} />
              <AnnouncementForm row={byKey.get("landing.announcement")} />
              <SectionsForm row={byKey.get("landing.sections")} />
              <MediaForm row={byKey.get("landing.media")} />
            </>
          ) : null}

          {tab === "site" ? (
            <>
              <SeoForm row={byKey.get("site.seo")} />
              <FooterForm row={byKey.get("site.footer")} />
              <PricesForm row={byKey.get("billing.prices")} />
            </>
          ) : null}

          {tab === "flags" ? <Flags flags={data.flags} /> : null}
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Shared form scaffolding                                                */
/* ---------------------------------------------------------------------- */

/**
 * Every form on this page has the same three states — overridden, bundled, or
 * malformed — and the same two actions, so the wrapper owns both. In particular
 * the copy explaining what "reset" does is written once and cannot drift between
 * forms.
 */
function SettingForm<T>({
  settingKey,
  row,
  note,
  value,
  defaults,
  onReset,
  blocked,
  children,
}: {
  settingKey: SettingKey;
  row: SettingRow | undefined;
  note: string;
  value: T;
  defaults: T;
  onReset: () => void;
  /** When set, saving is disabled and this replaces the status line. */
  blocked?: string | undefined;
  children: ReactNode;
}) {
  const save = useConsoleMutation(saveSetting, [
    ["admin", "settings"],
    ["site", "content"],
  ]);
  const reset = useConsoleMutation(resetSetting, [
    ["admin", "settings"],
    ["site", "content"],
  ]);

  const overridden = row !== undefined;
  const edited = stable(value) !== stable(defaults);

  return (
    <Panel title={SETTING_LABELS[settingKey]} note={note}>
      {children}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending || blocked !== undefined}
          onClick={() => save.mutate({ data: { key: settingKey, value } })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>

        {overridden ? (
          <Button
            size="sm"
            variant="outline"
            disabled={reset.isPending}
            onClick={() => reset.mutate({ data: { key: settingKey } }, { onSuccess: onReset })}
          >
            <RotateCcw className="h-4 w-4" />
            {reset.isPending ? "Resetting…" : "Reset to bundled copy"}
          </Button>
        ) : null}

        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {blocked !== undefined ? (
            blocked
          ) : overridden ? (
            <>
              Overridden · saved {formatDateTime(row.updatedAt)}
              {row.valid ? "" : " · stored value is malformed"}
            </>
          ) : edited ? (
            "Not saved — the site is still showing the bundled copy"
          ) : (
            "Using the copy shipped with this build"
          )}
        </span>
      </div>

      {overridden ? (
        <p className="mt-3 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground">
          Reset deletes the row rather than storing today&rsquo;s default. An absent row means
          &ldquo;whatever the code ships&rdquo;, so the page keeps tracking future copy changes; a
          row holding the current default would silently freeze it.
        </p>
      ) : null}

      <ErrorNote error={save.error} />
      <ErrorNote error={reset.error} />
    </Panel>
  );
}

/**
 * Key-order-independent serialisation, used only to tell "edited but unsaved"
 * apart from "untouched".
 *
 * `JSON.stringify` would do if both sides always came from the same declaration,
 * but one side has been through a zod parse and a spread. A spurious "not saved"
 * badge is the kind of small lie that trains an operator to stop reading badges.
 */
function stable(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${stable(v)}`)
    .join(",")}}`;
}

/* ---------------------------------------------------------------------- */
/* Landing                                                                */
/* ---------------------------------------------------------------------- */

function HeroForm({ row }: { row: SettingRow | undefined }) {
  const [hero, setHero] = useState<Hero>(
    () => parseSetting(heroSchema, row?.value ?? null, HERO_DEFAULT)[0],
  );
  const set = <K extends keyof Hero>(k: K, v: Hero[K]) => setHero({ ...hero, [k]: v });

  return (
    <SettingForm
      settingKey="landing.hero"
      row={row}
      note="The first thing a visitor reads. A newline in the headline splits it across two lines in the display face — that break is deliberate typography, not an accident of width."
      value={hero}
      defaults={HERO_DEFAULT}
      onReset={() => setHero(HERO_DEFAULT)}
    >
      <div className="space-y-4">
        <Field label="Headline" hint="One newline allowed. Two lines is the design.">
          <textarea
            value={hero.headline}
            onChange={(e) => set("headline", e.target.value)}
            rows={2}
            className={`${inputClass} resize-y font-serif text-[17px]`}
          />
        </Field>

        <Field label="Subheading">
          <textarea
            value={hero.sub}
            onChange={(e) => set("sub", e.target.value)}
            rows={2}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary button">
            <input
              value={hero.ctaLabel}
              onChange={(e) => set("ctaLabel", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Primary link">
            <input
              value={hero.ctaHref}
              onChange={(e) => set("ctaHref", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Secondary button" hint="Leave blank to hide it.">
            <input
              value={hero.secondaryLabel}
              onChange={(e) => set("secondaryLabel", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Secondary link">
            <input
              value={hero.secondaryHref}
              onChange={(e) => set("secondaryHref", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Footnote"
          hint="The small line under the buttons. Keep it factual — it reads as a claim, and the source count in it is the number visitors check first."
        >
          <input
            value={hero.footnote}
            onChange={(e) => set("footnote", e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="rounded-2xl border border-hairline bg-surface-2 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Preview
          </p>
          <h3 className="display mt-3 whitespace-pre-line text-[clamp(1.6rem,4vw,2.4rem)]">
            {hero.headline || "Headline"}
          </h3>
          {hero.sub ? (
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
              {hero.sub}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
            <span className="rounded-full bg-primary px-4 py-1.5 text-primary-foreground">
              {hero.ctaLabel || "Button"}
            </span>
            {hero.secondaryLabel ? (
              <span className="text-muted-foreground underline decoration-hairline underline-offset-4">
                {hero.secondaryLabel}
              </span>
            ) : null}
          </div>
          {hero.footnote ? (
            <p className="mt-3 text-[11.5px] text-muted-foreground">{hero.footnote}</p>
          ) : null}
        </div>
      </div>
    </SettingForm>
  );
}

function AnnouncementForm({ row }: { row: SettingRow | undefined }) {
  const [ann, setAnn] = useState<Announcement>(
    () => parseSetting(announcementSchema, row?.value ?? null, ANNOUNCEMENT_DEFAULT)[0],
  );
  const set = <K extends keyof Announcement>(k: K, v: Announcement[K]) =>
    setAnn({ ...ann, [k]: v });

  return (
    <SettingForm
      settingKey="landing.announcement"
      row={row}
      note="A single strip above the nav. Clearing the text is the off switch — there is no separate enabled flag that could fall out of sync with it."
      value={ann}
      defaults={ANNOUNCEMENT_DEFAULT}
      onReset={() => setAnn(ANNOUNCEMENT_DEFAULT)}
    >
      <div className="space-y-4">
        <Field label="Text" hint="Blank hides the bar entirely.">
          <input
            value={ann.text}
            onChange={(e) => set("text", e.target.value)}
            className={inputClass}
            placeholder="Now watching 40 new sources"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Link label">
            <input
              value={ann.linkLabel}
              onChange={(e) => set("linkLabel", e.target.value)}
              className={inputClass}
              placeholder="Read more"
            />
          </Field>
          <Field label="Link target">
            <input
              value={ann.href}
              onChange={(e) => set("href", e.target.value)}
              className={inputClass}
              placeholder="/blog/new-sources"
            />
          </Field>
        </div>

        {ann.text ? (
          <div className="rounded-2xl border border-hairline bg-surface-2 px-5 py-3 text-center text-[12.5px]">
            {ann.text}
            {ann.linkLabel ? (
              <span className="ml-2 underline decoration-signal underline-offset-4">
                {ann.linkLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">The bar is off.</p>
        )}
      </div>
    </SettingForm>
  );
}

function SectionsForm({ row }: { row: SettingRow | undefined }) {
  const [sections, setSections] = useState<Sections>(
    () => parseSetting(sectionsSchema, row?.value ?? null, SECTIONS_DEFAULT)[0],
  );

  const toggle = (index: number, on: boolean) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, enabled: on } : s)));

  const move = (index: number, delta: -1 | 1) => setSections(moveSection(sections, index, delta));

  const hidden = sections.filter((s) => !s.enabled).length;
  const reordered = sections.some((s, i) => s.key !== SECTIONS_DEFAULT[i]?.key);

  return (
    <SettingForm
      settingKey="landing.sections"
      row={row}
      note="Which blocks the landing page renders, and in what order. The hero is always first and is edited above; everything else here can be reordered or switched off."
      value={sections}
      defaults={SECTIONS_DEFAULT}
      onReset={() => setSections(SECTIONS_DEFAULT)}
    >
      <ul className="divide-y divide-[var(--hairline)]">
        {sections.map((section, i) => (
          <li key={section.key} className="flex items-center gap-3 py-2.5">
            <span className="w-5 shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
              {i + 1}
            </span>

            <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(e) => toggle(i, e.target.checked)}
                className="h-4 w-4 accent-[var(--signal)]"
              />
              <span className={section.enabled ? "" : "text-muted-foreground line-through"}>
                {SECTION_LABELS[section.key]}
              </span>
            </label>

            {section.enabled ? null : <Pill tone="outline">hidden</Pill>}

            {/* Buttons rather than drag-and-drop. Ten items is a short list, and
                a pair of arrows is keyboard-reachable and screen-reader-legible
                for free, which a drag handle is not without a great deal of
                work that this list does not justify. */}
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label={`Move ${SECTION_LABELS[section.key]} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${SECTION_LABELS[section.key]} down`}
                disabled={i === sections.length - 1}
                onClick={() => move(i, 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[12.5px] text-muted-foreground">
        {hidden > 0 ? `${hidden} of ${sections.length} sections hidden. ` : null}
        {reordered ? "Order differs from the shipped page." : null}
        {hidden === 0 && !reordered ? "Shipped order, nothing hidden." : null}
      </p>
    </SettingForm>
  );
}

/* ---------------------------------------------------------------------- */
/* Landing media                                                          */
/* ---------------------------------------------------------------------- */

/**
 * Three fixed slots, each with a live preview.
 *
 * The preview loads the real URL rather than drawing a placeholder box, so a
 * typo, a hotlink that 403s, or an image that is secretly 4MB is visible here
 * instead of on the landing page. `onError` swaps in an explicit failure note —
 * a broken-image icon inside a rounded card reads as a design choice.
 */
function MediaForm({ row }: { row: SettingRow | undefined }) {
  const [media, setMedia] = useState<Media>(
    () => parseSetting(mediaSchema, row?.value ?? null, MEDIA_DEFAULT)[0],
  );

  const set = (slot: MediaSlot, patch: Partial<MediaItem>) =>
    setMedia({ ...media, [slot]: { ...media[slot], ...patch } });

  const missingAlt = MEDIA_SLOTS.filter((s) => media[s].url && !media[s].alt.trim());
  const filled = MEDIA_SLOTS.filter((s) => media[s].url).length;

  return (
    <SettingForm
      settingKey="landing.media"
      row={row}
      note="Images for the three places on the landing page that take one. Leave a slot empty and that place renders as it does today — the hero keeps its animation, the bands do not appear."
      value={media}
      defaults={MEDIA_DEFAULT}
      onReset={() => setMedia(MEDIA_DEFAULT)}
      // Alt text is not optional for an image on a public marketing page, and
      // catching it here means the operator fixes it while looking at the
      // picture rather than reading a validation error from the server.
      blocked={missingAlt.length > 0 ? "Every image needs alt text." : undefined}
    >
      <div className="space-y-6">
        {MEDIA_SLOTS.map((slot) => {
          const item = media[slot];
          const meta = MEDIA_LABELS[slot];

          return (
            <div key={slot} className="rounded-2xl border border-hairline bg-surface-2 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-medium">{meta.label}</p>
                {item.url ? <Pill tone="signal">set</Pill> : <Pill tone="outline">empty</Pill>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{meta.hint}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Image URL" hint="A path like /hero.jpg, or an https:// URL.">
                  <input
                    value={item.url}
                    onChange={(e) => set(slot, { url: e.target.value.trim() })}
                    placeholder="/hero.jpg"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Alt text"
                  hint={
                    item.url && !item.alt.trim()
                      ? "Required — describe what the image shows."
                      : "What the image shows, for screen readers."
                  }
                >
                  <input
                    value={item.alt}
                    onChange={(e) => set(slot, { alt: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Caption" hint="Optional. Shown under the image.">
                  <input
                    value={item.caption}
                    onChange={(e) => set(slot, { caption: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>

              {item.url ? <MediaPreview url={item.url} /> : null}
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-[12.5px] text-muted-foreground">
        {filled === 0
          ? "No slots filled — the landing page renders exactly as it ships."
          : `${filled} of ${MEDIA_SLOTS.length} slots filled.`}
      </p>
    </SettingForm>
  );
}

function MediaPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt: without the key, React keeps the DOM
  // node and the stale `failed` state, so correcting a typo would still show
  // the error.
  return (
    <div key={url} className="mt-4">
      {failed ? (
        <p className="rounded-xl border border-dashed border-destructive/40 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          That URL did not load. Check the path, or whether the host allows hotlinking.
        </p>
      ) : (
        <img
          src={url}
          alt=""
          onError={() => setFailed(true)}
          className="max-h-44 w-full rounded-xl border border-hairline object-cover"
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Site and pricing                                                       */
/* ---------------------------------------------------------------------- */

function SeoForm({ row }: { row: SettingRow | undefined }) {
  const [seo, setSeo] = useState<Seo>(
    () => parseSetting(seoSchema, row?.value ?? null, SEO_DEFAULT)[0],
  );
  const set = <K extends keyof Seo>(k: K, v: Seo[K]) => setSeo({ ...seo, [k]: v });

  return (
    <SettingForm
      settingKey="site.seo"
      row={row}
      note="The title and description search engines and chat apps show. The social image is fetched by other people's servers, so it has to be a path this site actually serves — one that 404s renders as a blank card, not as no card."
      value={seo}
      defaults={SEO_DEFAULT}
      onReset={() => setSeo(SEO_DEFAULT)}
    >
      <div className="space-y-4">
        <Field label="Title" hint="Around 60 characters before search results truncate it.">
          <input
            value={seo.title}
            onChange={(e) => set("title", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Description" hint="Around 155 characters.">
          <textarea
            value={seo.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <Field label="Social image" hint="1200×630. A path under /public, or an absolute URL.">
          <input
            value={seo.ogImage}
            onChange={(e) => set("ogImage", e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="rounded-2xl border border-hairline bg-surface-2 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Search result
          </p>
          <p className="mt-3 text-[15px] text-signal underline decoration-signal/40 underline-offset-2">
            {truncate(seo.title, 60)}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {truncate(seo.description, 155)}
          </p>
          <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
            {seo.title.length} and {seo.description.length} characters
          </p>
        </div>
      </div>
    </SettingForm>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function FooterForm({ row }: { row: SettingRow | undefined }) {
  const [footer, setFooter] = useState<Footer>(
    () => parseSetting(footerSchema, row?.value ?? null, FOOTER_DEFAULT)[0],
  );
  const set = <K extends keyof Footer>(k: K, v: Footer[K]) => setFooter({ ...footer, [k]: v });

  return (
    <SettingForm
      settingKey="site.footer"
      row={row}
      note="The blurb is the honest-limits statement that appears on every page. It is the one piece of copy worth keeping conservative: it is what a reader points at when a summary gets something wrong."
      value={footer}
      defaults={FOOTER_DEFAULT}
      onReset={() => setFooter(FOOTER_DEFAULT)}
    >
      <div className="space-y-4">
        <Field label="Blurb">
          <textarea
            value={footer.blurb}
            onChange={(e) => set("blurb", e.target.value)}
            rows={3}
            className={`${inputClass} resize-y`}
          />
        </Field>
        <Field label="Tagline">
          <input
            value={footer.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
    </SettingForm>
  );
}

/**
 * Prices are editable here, behind an acknowledgement.
 *
 * This value changes the number on the pricing page and the MRR estimate. It
 * does not change what the payment provider charges. A pricing page that
 * disagrees with the invoice is worse than a stale one, so saving stays disabled
 * until the operator confirms billing has already been updated. The checkbox is
 * not a permission — it is a place to stop and think.
 */
function PricesForm({ row }: { row: SettingRow | undefined }) {
  const [prices, setPrices] = useState<Prices>(
    () => parseSetting(pricesSchema, row?.value ?? null, PRICES_DEFAULT)[0],
  );
  const [acknowledged, setAcknowledged] = useState(false);

  // `free` is absent from the editable keys because the schema pins it to 0.
  const set = (k: Exclude<keyof Prices, "free">, raw: string) => {
    const n = Math.trunc(Number(raw));
    setPrices({ ...prices, [k]: Number.isFinite(n) && n >= 0 ? n : 0 });
  };

  const changed = stable(prices) !== stable(PRICES_DEFAULT);

  return (
    <SettingForm
      settingKey="billing.prices"
      row={row}
      note="Must match the Stripe catalogue: nyuz personal $19.00/mo and $190.00/yr, nyuz pro $29.00/mo and $290.00/yr. Checkout charges Stripe, not this form."
      value={prices}
      defaults={PRICES_DEFAULT}
      onReset={() => {
        setPrices(PRICES_DEFAULT);
        setAcknowledged(false);
      }}
      blocked={acknowledged ? undefined : "Confirm billing already charges these amounts"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Personal, monthly">
          <input
            type="number"
            min={0}
            max={999}
            value={prices.personal}
            onChange={(e) => set("personal", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field
          label="Personal, annual total"
          hint={annualHint(prices.personal, prices.personalAnnual)}
        >
          <input
            type="number"
            min={0}
            max={9999}
            value={prices.personalAnnual}
            onChange={(e) => set("personalAnnual", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field label="Pro, monthly">
          <input
            type="number"
            min={0}
            max={999}
            value={prices.pro}
            onChange={(e) => set("pro", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field label="Pro, annual total" hint={annualHint(prices.pro, prices.proAnnual)}>
          <input
            type="number"
            min={0}
            max={9999}
            value={prices.proAnnual}
            onChange={(e) => set("proAnnual", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
      </div>

      <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
        Free is pinned to zero by the schema rather than left editable. The ceilings — $999 monthly,
        $9,999 annual — are a fat-finger guard, not a business rule: a stray keystroke turning $7
        into $7,000 on a public pricing page is worth making impossible.
      </p>

      <label className="mt-4 flex max-w-2xl cursor-pointer items-start gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--signal)]"
        />
        <span>
          Billing is already configured to charge these amounts.
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
            {changed
              ? "Existing subscribers keep the price they signed up at. This affects the page and new checkouts only."
              : "These are the shipped prices, so saving would only pin them against future changes."}
          </span>
        </span>
      </label>
    </SettingForm>
  );
}

/** Expresses the annual discount as months free, which is how the page phrases it. */
function annualHint(monthly: number, annual: number): string {
  if (annual === 0) return "Zero hides the annual option.";
  if (monthly === 0) return "Set a monthly price first.";
  const months = annual / monthly;
  if (months >= 12) return "No saving against monthly.";
  return `${months.toFixed(1)} months of the monthly price — ${(12 - months).toFixed(1)} free.`;
}

/* ---------------------------------------------------------------------- */
/* Flags                                                                  */
/* ---------------------------------------------------------------------- */

function Flags({ flags }: { flags: FlagRow[] }) {
  const { data: viewer } = useViewer();
  const isSuper = viewer?.role === "superadmin";
  const create = useConsoleMutation(createFlag, [["admin", "settings"]]);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  return (
    <>
      <Panel
        title="Feature flags"
        note="A flag decides whether a piece of the product is visible. Partial rollout buckets on a hash of the flag key and the user id, so a person's bucket is stable and two flags at 10% do not land on the same tenth of people. Signed-out visitors have nothing to bucket on, so anything below 100% is off for them rather than shown at random."
      >
        {flags.length === 0 ? (
          <p className="py-6 text-[13.5px] text-muted-foreground">
            No flags defined. The public blog link is gated on one called{" "}
            <code className="font-mono text-[12.5px]">blog</code>.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {flags.map((flag) => (
              <FlagRowEditor key={flag.key} flag={flag} />
            ))}
          </ul>
        )}
      </Panel>

      {isSuper ? (
        <Panel
          title="New flag"
          note="Superadmin only. A key here is a contract with the code — a flag nothing reads is clutter that later reads as a bug — so the restriction is really about keeping the list short enough that every entry still means something. New flags start off."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Field label="Key" hint="Lowercase letters, digits and underscores.">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className={`${inputClass} font-mono`}
                  placeholder="blog"
                />
              </Field>
            </div>
            <div className="min-w-[180px] flex-1">
              <Field label="Label">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className={inputClass}
                  placeholder="Public blog"
                />
              </Field>
            </div>
            <Button
              variant="outline"
              disabled={create.isPending || key.trim() === ""}
              onClick={() =>
                create.mutate(
                  { data: { key: key.trim(), label: label.trim(), description: "" } },
                  {
                    onSuccess: () => {
                      setKey("");
                      setLabel("");
                    },
                  },
                )
              }
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
          <ErrorNote error={create.error} />
        </Panel>
      ) : null}
    </>
  );
}

/**
 * The slider writes on release, not on every input event. Dragging from 0 to 60
 * would otherwise produce a dozen updates and a dozen audit entries for one
 * decision, which makes the log useless for answering "who changed this".
 */
function FlagRowEditor({ flag }: { flag: FlagRow }) {
  const save = useConsoleMutation(setFlag, [
    ["admin", "settings"],
    ["site", "content"],
  ]);
  const [rollout, setRollout] = useState(flag.rolloutPercent);

  const commit = (enabled: boolean, percent: number) =>
    save.mutate({ data: { key: flag.key, enabled, rolloutPercent: percent } });

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {flag.label || flag.key}
            <code className="font-mono text-[11.5px] font-normal text-muted-foreground">
              {flag.key}
            </code>
            {!flag.enabled ? (
              <Pill tone="outline">off</Pill>
            ) : flag.rolloutPercent >= 100 ? (
              <Pill tone="signal">on</Pill>
            ) : (
              <Pill tone="neutral">{flag.rolloutPercent}% of signed-in users</Pill>
            )}
          </p>

          {flag.description ? (
            <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
              {flag.description}
            </p>
          ) : null}

          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Changed {formatDateTime(flag.updatedAt)}
            {rollout !== flag.rolloutPercent ? " · release the slider to apply" : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="sr-only">{flag.key} rollout percentage</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={rollout}
              disabled={save.isPending}
              onChange={(e) => setRollout(Number(e.target.value))}
              onPointerUp={() => commit(flag.enabled, rollout)}
              onKeyUp={() => commit(flag.enabled, rollout)}
              className="w-28 accent-[var(--signal)]"
            />
            <span className="w-9 shrink-0 text-right tabular-nums">{rollout}%</span>
          </label>

          <Button
            size="sm"
            variant={flag.enabled ? "outline" : "primary"}
            disabled={save.isPending}
            onClick={() => commit(!flag.enabled, rollout)}
          >
            {save.isPending ? "…" : flag.enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </div>
      <ErrorNote error={save.error} />
    </li>
  );
}
