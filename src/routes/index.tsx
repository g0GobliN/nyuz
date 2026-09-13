import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LinkButton, Section } from "@/components/kit";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { HeroPipeline, InterestDemo } from "@/components/landing/hero";
import { HeroReaders } from "@/components/landing/readers";
import { NoiseSection } from "@/components/landing/noise";
import { HowItWorksRail, Comparison } from "@/components/landing/how-it-works";
import { ProfileDemo, WhyDifferent, AiTrust, Infrastructure } from "@/components/landing/sections";
import { SourceTransparency, FinalCta } from "@/components/landing/closing";
import { getPublicSiteContent } from "@/lib/server/settings";
import { MaintenanceScreen } from "@/components/access";
import type { MediaItem, SectionKey } from "@/lib/site-content";
import { useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";

/**
 * The landing page reads its copy from the console via a route loader, not a
 * React Query hook.
 *
 * This project has no React Query SSR integration, so a `useQuery` here would
 * server-render the bundled headline and then swap it for the edited one after
 * hydration — a visible flash on the highest-traffic page, and a hydration
 * mismatch. Loader data is serialised into the SSR payload and is present on the
 * client's first render, so both sides agree.
 *
 * `getPublicSiteContent` is safe to call from a loader precisely because it runs
 * with no middleware and never throws: it does not need a browser session, and a
 * database outage costs the bundled copy rather than a 500 on the front door.
 */
export const Route = createFileRoute("/")({
  loader: () => getPublicSiteContent(),
  head: ({ loaderData }) => {
    const seo = loaderData?.seo;
    // `loaderData` is undefined while the loader is in flight, so every field
    // needs a literal fallback rather than an optional chain into a template.
    if (!seo) return { meta: [] };
    const image = seo.ogImage
      ? new URL(seo.ogImage, "https://nyuz.app").toString()
      : "https://nyuz.app/og-image.png";
    return {
      meta: [
        { title: seo.title },
        { name: "description", content: seo.description },
        { property: "og:title", content: seo.title },
        { property: "og:description", content: seo.description },
        { property: "og:image", content: image },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: "https://nyuz.app/" }],
    };
  },
  component: Index,
});

/**
 * Which component each section key draws, and how.
 *
 * A registry rather than a hand-written run of `{sections.x ? <X/> : null}`,
 * because the order now comes from the database: the page renders whatever
 * order the console saved, so it cannot be spelled out in JSX. `reveal` opts a
 * section into the scroll animation; `bare` skips the standard `<Section>`
 * padding for the closing CTA, which brings its own.
 *
 * Adding a section means a key in SECTION_KEYS, a label in SECTION_LABELS, and
 * an entry here. Missing any of the three is a type error rather than a blank
 * space on the page.
 */
const SECTION_COMPONENTS: Record<
  SectionKey,
  { node: ReactNode; reveal?: boolean; bare?: boolean }
> = {
  interestDemo: { node: <InterestDemo />, reveal: true },
  noise: { node: <NoiseSection /> },
  howItWorks: { node: <HowItWorksRail />, reveal: true },
  comparison: { node: <Comparison /> },
  profileDemo: { node: <ProfileDemo /> },
  whyDifferent: { node: <WhyDifferent />, reveal: true },
  aiTrust: { node: <AiTrust /> },
  infrastructure: { node: <Infrastructure /> },
  sourceTransparency: { node: <SourceTransparency /> },
  finalCta: { node: <FinalCta />, bare: true },
};

/**
 * A filled media slot. Renders nothing at all when the slot is empty, so an
 * unused slot costs no markup and no layout.
 *
 * `loading="lazy"` on everything below the hero, and an explicit aspect ratio,
 * because these are operator-supplied images of unknown weight — without a
 * reserved box, dropping one in shifts the whole page as it decodes.
 */
function MediaBand({
  item,
  ratio,
  className,
}: {
  item: MediaItem;
  ratio: string;
  className?: string;
}) {
  if (!item.url) return null;
  return (
    <figure className={className}>
      <img
        src={item.url}
        alt={item.alt}
        loading="lazy"
        decoding="async"
        style={{ aspectRatio: ratio }}
        className="w-full rounded-3xl border border-hairline object-cover"
      />
      {item.caption ? (
        <figcaption className="mt-3 text-center text-[12.5px] text-muted-foreground">
          {item.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Index() {
  const content = Route.useLoaderData();
  const { hero, sections, media } = content;
  const ref = useReveal<HTMLDivElement>();

  // The front door is the one page where maintenance has to be unmissable.
  // `access` rides along on the content every public route already loads, so
  // this costs no extra query.
  if (content.access.maintenance) {
    return <MaintenanceScreen access={content.access} />;
  }

  const visible = sections.filter((s) => s.enabled);
  // The mid-page band goes after the third visible section, or last if the page
  // is shorter than that. Anchoring it to a count rather than to a named
  // section means reordering cannot strand it against a hard-coded neighbour.
  const bandAfter = Math.min(3, visible.length) - 1;

  return (
    <div ref={ref} className="min-h-screen bg-background">
      <SiteNav content={content} />

      <main>
        {/* Hero */}
        <section className="veil relative px-5 pb-14 pt-24 sm:px-8 sm:pb-20 sm:pt-32">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="animate-rise">
              {/* The headline is one editable string; a newline in it breaks the
                  line, which is why this renders with pre-line rather than two
                  hard-coded lines and a <br>. The console preview uses the same
                  class, so what an editor sees is what ships. */}
              <h1 className="display whitespace-pre-line text-[clamp(2.125rem,8vw,5rem)]">
                {hero.headline}
              </h1>
              {hero.sub ? (
                <p className="mt-7 max-w-md text-[16.5px] leading-relaxed text-muted-foreground">
                  {hero.sub}
                </p>
              ) : null}
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <LinkButton to={hero.ctaHref} size="lg">
                  {hero.ctaLabel} <ArrowRight className="h-4 w-4" />
                </LinkButton>
                {hero.secondaryLabel && hero.secondaryHref ? (
                  <Link
                    to={hero.secondaryHref}
                    className="px-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {hero.secondaryLabel}
                  </Link>
                ) : null}
              </div>
              {hero.footnote ? (
                <p className="mt-8 text-[12.5px] text-muted-foreground">{hero.footnote}</p>
              ) : null}
            </div>

            <div className="animate-rise [animation-delay:180ms]">
              {/* An operator-supplied hero image replaces the animation
                  outright rather than sitting beside it — two competing focal
                  points in one column is worse than either alone. Not lazy and
                  fetched eagerly: this one is above the fold. */}
              {media.hero.url ? (
                <figure>
                  <img
                    src={media.hero.url}
                    alt={media.hero.alt}
                    fetchPriority="high"
                    decoding="async"
                    style={{ aspectRatio: "4 / 3" }}
                    className="w-full rounded-3xl border border-hairline object-cover"
                  />
                  {media.hero.caption ? (
                    <figcaption className="mt-3 text-[12.5px] text-muted-foreground">
                      {media.hero.caption}
                    </figcaption>
                  ) : null}
                </figure>
              ) : (
                <HeroPipeline />
              )}
            </div>
          </div>
          <div className="hero-readers -mx-5 -mb-14 sm:-mx-8 sm:-mb-20" aria-hidden="true">
            <HeroReaders />
          </div>
        </section>

        {/* Order and visibility both come from the console. The page renders the
            saved list; the registry above says what each key draws.

            The top border is computed rather than baked into each section: it
            separates one section from the previous one, so whichever section
            happens to be first must not have it, and that is no longer known at
            authoring time. */}
        {visible.map((section, i) => {
          const entry = SECTION_COMPONENTS[section.key];
          const divider = i > 0 ? "border-t border-hairline" : "";

          return (
            <Fragment key={section.key}>
              {entry.bare ? (
                <div className={divider}>{entry.node}</div>
              ) : (
                <Section className={cn(entry.reveal && "reveal", divider)}>{entry.node}</Section>
              )}

              {i === bandAfter && media.midpage.url ? (
                <div className="border-t border-hairline px-5 py-12 sm:px-8 sm:py-16">
                  <div className="mx-auto w-full max-w-6xl">
                    <MediaBand item={media.midpage} ratio="3 / 1" />
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}

        {media.closing.url ? (
          <div className="border-t border-hairline px-5 py-12 sm:px-8 sm:py-16">
            <div className="mx-auto w-full max-w-4xl">
              <MediaBand item={media.closing} ratio="16 / 9" />
            </div>
          </div>
        ) : null}
      </main>

      <SiteFooter content={content} />
    </div>
  );
}
