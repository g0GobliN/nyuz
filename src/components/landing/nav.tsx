import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/kit";
import { ThemeToggle } from "@/components/theme-toggle";
import { PUBLIC_CONTENT_FALLBACK, type PublicSiteContent } from "@/lib/site-content";

/**
 * The nyuz mark, inline so it inherits the theme: the glyph takes currentColor
 * and the terminal dot takes --signal, so it stays correct in light and dark
 * without shipping two files. viewBox is the mark's exact bounding box.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 27.48 30" className={className} role="img" aria-label="nyuz" fill="none">
      <path
        d="M1.77 30V13.77a11.97 11.97 0 0 1 23.94 0V24.3"
        stroke="currentColor"
        strokeWidth="3.53"
        strokeLinecap="butt"
      />
      <circle cx="25.71" cy="28" r="1.8" fill="var(--signal)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={"flex items-center gap-2.5 " + (className ?? "")}>
      <LogoMark className="h-[22px] w-auto text-foreground" />
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
];

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
          (scrolled ? "glass border-b border-hairline" : "")
        }
      >
        {bar ? (
          <div className={`${BAR_HEIGHT} bg-foreground text-background`}>
            <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-5 text-[12.5px] sm:px-8">
              {/* One line, always. The strip's height is hard-coded so a spacer can
                  match it, and text that wrapped to two lines would leave the page
                  content overlapped by exactly the amount it wrapped. */}
              <p className="min-w-0 flex-1 truncate">{bar.text}</p>
              {bar.href && bar.linkLabel ? (
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

        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
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
            <Link
              to="/auth"
              className="px-3 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <LinkButton to="/onboarding" size="sm">
              Get started
            </LinkButton>
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
          <div className="glass border-b border-hairline px-5 pb-6 pt-2 md:hidden">
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
              <Link
                to="/auth"
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-[15px] hover:bg-muted"
              >
                Sign in
              </Link>
              <LinkButton to="/onboarding" className="mt-2 w-full" onClick={() => setOpen(false)}>
                Build my nyuz
              </LinkButton>
            </div>
          </div>
        ) : null}
      </header>

      {/* The header is fixed, so its children take no flow space and every page's
          top padding is measured from y=0. Rather than teach each page about the
          strip, push the document down by exactly the strip's height — and by
          nothing at all when there is no strip, which keeps existing layouts
          pixel-identical until someone turns the bar on. */}
      {bar ? <div className={BAR_HEIGHT} aria-hidden="true" /> : null}
    </>
  );
}
