import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/kit";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { PUBLIC_CONTENT_FALLBACK, type PublicSiteContent } from "@/lib/site-content";

/**
 * The nyuz mark.
 *
 * Inline rather than an <img> so the letterform can take `currentColor` and the
 * dot the --signal token: the mark then follows the theme instead of carrying a
 * baked-in field, which is what made the old JPEG sit in a white box on every
 * dark surface. Geometry is the same path as public/logo.svg — edit both, or
 * neither.
 */
/**
 * The letterform, as one string. Exported so the loading mark in
 * `src/components/loading.tsx` traces exactly this path rather than carrying a
 * fourth copy of the geometry — the SVG files in public/ are the only other
 * places it appears, and `src/lib/brand-assets.test.ts` holds them together.
 *
 * The stem is one unbroken stroke from cap to foot; the shoulder springs off it
 * partway down. That overlap leaves the notch at the top left, which is the
 * letterform — do not merge them into a symmetric arch.
 */
export const MARK_PATH = "M7.89 34.95V5M7.89 18.85A12.11 12.11 0 0 1 32.11 18.85V29.7";

export function LogoMark({ className, alt = "nyuz" }: { className?: string; alt?: string }) {
  const label = alt.trim();
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      role={label ? "img" : "presentation"}
      aria-hidden={label ? undefined : true}
      {...(label ? { "aria-label": label } : {})}
    >
      {/* Geometry matches public/logo.svg; edit both, or neither. */}
      <path d={MARK_PATH} stroke="currentColor" strokeWidth="3.48" />
      <circle cx="32.11" cy="33.21" r="1.79" fill="var(--signal)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={"flex items-center gap-2.5 " + (className ?? "")}>
      <LogoMark alt="" className="h-[22px] w-[22px]" />
      <span className="text-[15px] font-semibold tracking-tight">nyuz</span>
    </Link>
  );
}

/** The strip's height, shared with the spacer below it so the two cannot drift. */
const BAR_HEIGHT = "h-9";

/**
 * `to` is a plain string rather than the router's path union because the blog
 * route is added conditionally and a union would have to be edited every time a
 * marketing page appears.
 */
type NavLink = { to: string; label: string };

const BASE_LINKS: NavLink[] = [
  { to: "/how-it-works", label: "How it works" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/support", label: "Support" },
];

function safeAnnouncementHref(href: string): boolean {
  return href.startsWith("/") || href.startsWith("https://") || href.startsWith("mailto:");
}

/**
 * The nav, and above it the announcement strip.
 *
 * `content` defaults to the bundled copy so this component still renders
 * correctly from a route with no loader. Routes that do load content pass it
 * down, which is what makes console edits show up in the server-rendered HTML
 * rather than appearing a moment after hydration.
 */
export function SiteNav({
  content = PUBLIC_CONTENT_FALLBACK,
}: {
  content?: PublicSiteContent | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // The session lives in browser storage, so SSR cannot know it. Treating the
  // first, still-loading check as signed out keeps the markup the server sent
  // and the markup the client hydrates into identical; the header swaps once.
  const { session, loading: sessionLoading } = useAuth();
  const signedIn = !sessionLoading && Boolean(session);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Empty announcement text is the off switch, per the schema. `flags` is a plain
  // record, so a key that was never created reads as undefined — compared against
  // true so "no such flag" and "flag off" behave identically.
  const bar = content.announcement.text.trim() !== "" ? content.announcement : null;
  const blogOn = content.flags["blog"] === true;
  const links: NavLink[] = blogOn ? [...BASE_LINKS, { to: "/blog", label: "Blog" }] : BASE_LINKS;

  return (
    <>
      <header
        className={
          "fixed inset-x-0 top-0 z-50 transition-all duration-500 " +
          // A phone that installed the site draws the page under its own status
          // bar, and `viewport-fit=cover` is what lets it reach there -- so the
          // strip itself has to start below it. This header is `fixed`, so the
          // padding grows the header downward rather than moving it, which is
          // why the document is given the same inset back below.
          "pt-[env(safe-area-inset-top)] " +
          (scrolled ? "glass border-b border-hairline" : "")
        }
      >
        {bar ? (
          <div className={`${BAR_HEIGHT} bg-foreground text-background`}>
            <div className="gutter-x sm:gutter-x-lg mx-auto flex h-full w-full max-w-6xl items-center gap-3 text-[12.5px]">
              {/* One line, always. The strip's height is hard-coded so a spacer can
                  match it, and text that wrapped to two lines would leave the page
                  content overlapped by exactly the amount it wrapped. */}
              <p className="min-w-0 flex-1 truncate">{bar.text}</p>
              {safeAnnouncementHref(bar.href) && bar.linkLabel ? (
                <a
                  href={bar.href}
                  className="shrink-0 underline decoration-background/40 underline-offset-4 transition-colors hover:decoration-background"
                >
                  {bar.linkLabel}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <nav className="gutter-x sm:gutter-x-lg mx-auto flex h-16 w-full max-w-6xl items-center justify-between">
          <Logo />
          <div className="hidden items-center gap-8 md:flex">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            {signedIn ? (
              <LinkButton to="/dashboard" size="sm">
                Dashboard
              </LinkButton>
            ) : (
              <>
                <Link
                  to="/auth"
                  className="px-3 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <LinkButton to="/onboarding" size="sm">
                  Get started
                </LinkButton>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              aria-label="Menu"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        {open ? (
          <div className="glass gutter-x border-b border-hairline pb-6 pt-2 md:hidden">
            <div className="flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-3 text-[15px] hover:bg-muted"
                >
                  {l.label}
                </Link>
              ))}
              {signedIn ? (
                <LinkButton to="/dashboard" className="mt-2 w-full" onClick={() => setOpen(false)}>
                  Dashboard
                </LinkButton>
              ) : (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-3 text-[15px] hover:bg-muted"
                  >
                    Sign in
                  </Link>
                  <LinkButton
                    to="/onboarding"
                    className="mt-2 w-full"
                    onClick={() => setOpen(false)}
                  >
                    Build my nyuz
                  </LinkButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      {/* The inset the header's own padding consumed. The header is fixed, so
          the padding that kept its row below the status bar did not move the
          page: without this the first screenful would start under the taller
          header instead. Zero in a browser tab, where the header keeps the
          height it always had. */}
      <div className="h-[env(safe-area-inset-top)]" aria-hidden="true" />

      {/* The header is fixed, so its children take no flow space and every page's
          top padding is measured from y=0. Rather than teach each page about the
          strip, push the document down by exactly the strip's height — and by
          nothing at all when there is no strip, which keeps existing layouts
          pixel-identical until someone turns the bar on. */}
      {bar ? <div className={BAR_HEIGHT} aria-hidden="true" /> : null}
    </>
  );
}
