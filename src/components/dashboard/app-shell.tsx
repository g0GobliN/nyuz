import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { OfflineNotice } from "@/components/dashboard/offline-notice";
import { SearchOverlay } from "@/components/dashboard/search-overlay";
import { UpdateNotice } from "@/components/dashboard/update-notice";
import { LogoMark } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useDisplayName } from "@/lib/auth";
import { MOBILE, type NavDestination } from "@/lib/dashboard-nav";
import { usePrefs } from "@/lib/prefs-store";
import { isAdmin, useViewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";

/**
 * The chrome an installed Nyuz wears.
 *
 * Rendered instead of the website's sidebar-and-header layout when the window is
 * a Home Screen web app, and never in a browser tab. Three differences, and each
 * one is the reason a particular "it still feels like a website" complaint
 * exists:
 *
 * 1. **The bars are ink, in both themes.** A black bar under the status bar and
 *    under the content is what makes the window read as an app rather than a
 *    page with a toolbar; more practically, iOS draws the status-bar text white
 *    over a `black-translucent` window, so a light top bar in light mode would
 *    have invisible status ink. The reading surface between them stays themed.
 * 2. **The same strip the website has, scrolled sideways.** An earlier version of
 *    this shell drew four fixed tabs and pushed everything else into a Profile
 *    hub inside Settings, which meant the app and the website disagreed about
 *    where a destination lived — and that the app had a second navigation system
 *    to learn. Both chromes now render `MOBILE` in full: same destinations, same
 *    order, same scroll, only the surface differs. Nothing is behind a hub.
 * 3. **No title in the bar.** The plan for this shell said the top bar would
 *    carry the page title, and it does not: every dashboard page already renders
 *    its own `PageHeader` inside the content with a larger, better title, so a
 *    second copy up here would be either redundant or — since the guard can draw
 *    the shell before it knows which page this is — briefly wrong. The bar holds
 *    the wordmark instead, which never changes and never flashes.
 *
 * What is deliberately *absent*: no swipe gestures, no edge-drag drawer, no
 * custom scroll physics, no orientation lock, no artificial splash delay. The
 * point is to stop behaving like a web page, not to impersonate a native
 * application it is not.
 */

/** The bottom strip's height, so the content padding below it cannot drift from it. */
const TAB_BAR = "pb-[calc(env(safe-area-inset-bottom)+3.75rem)]";

export function AppShell({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(false);
  // The identity is read here rather than passed down from `DashboardShell`, so
  // the guard can draw this chrome for a route it has not resolved yet. Both
  // readers share one view: the queries below are the ones the website shell
  // already holds, so this costs a cache lookup, not a request.
  const { prefs } = usePrefs();
  const { data: viewer } = useViewer();
  const staff = isAdmin(viewer);
  const name = useDisplayName(prefs.name);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 bg-app-chrome pt-[env(safe-area-inset-top)] text-app-chrome-foreground">
        <div className="gutter-x sm:gutter-x-md flex h-14 items-center gap-0.5">
          {/* Not a link. The wordmark is a label for the window here, and the
              destination it would point at is already the first item in the
              strip below. */}
          <span className="mr-auto flex min-w-0 items-center gap-2">
            <LogoMark alt="" className="h-[18px] w-[18px]" />
            <span className="text-[15px] font-semibold tracking-tight">nyuz</span>
          </span>

          {/* The theme toggle lives in the bar because this shell has no other
              header, and nyuz does not follow the OS theme — without a control
              here, an installed reader would have no way to reach light mode. */}
          <ThemeToggle tone="chrome" />

          <Link
            to="/dashboard/alerts"
            aria-label="Alerts"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-app-chrome-foreground/75 transition-colors hover:bg-white/10 hover:text-app-chrome-foreground"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-signal" />
          </Link>

          <button
            aria-label="Search"
            onClick={() => setSearch(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-app-chrome-foreground/75 transition-colors hover:bg-white/10 hover:text-app-chrome-foreground"
          >
            <Search className="h-4 w-4" />
          </button>

          <AccountMenu staff={staff} name={name} />
        </div>
      </header>

      <main className={cn("gutter-x sm:gutter-x-md pt-6", TAB_BAR)}>
        {/* A single reading column, at every width. The strip stays at the bottom
            of a tablet too, so a wider window gets more margin rather than a
            second layout nobody asked for. */}
        <div className="mx-auto w-full max-w-2xl">
          <OfflineNotice />
          <UpdateNotice />
          {children}
        </div>
      </main>

      {/* The same destinations, the same order and the same sideways scroll as the
          website's strip — see MOBILE in src/lib/dashboard-nav.ts. Only the
          surface is the app's: ink here, glass there, because this bar sits under
          an ink top bar in both themes. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-app-chrome text-app-chrome-foreground">
        <div className="gutter-x-xs flex touch-pan-x items-stretch overflow-x-auto overscroll-x-contain pb-[calc(env(safe-area-inset-bottom)+0.375rem)] scrollbar-hide">
          {MOBILE.map((item) => (
            <StripItem key={item.to} item={item} />
          ))}
        </div>
      </nav>

      {search ? <SearchOverlay onClose={() => setSearch(false)} /> : null}
    </div>
  );
}

/**
 * One destination in the strip.
 *
 * The same item the website's strip draws — same size, same spacing, same
 * `shrink-0` so the row scrolls instead of compressing — with the app's chrome
 * colours in place of the page's. Active state is worked out here rather than
 * passed in, because it depends on the path.
 *
 * `/dashboard/briefing` is one destination and two views: its Today and Saved
 * chips are separate search params, and the strip's "Briefing" link opens the
 * delivered briefing. Saved is still a tap away on that page, which is where a
 * reader who wants it is already looking.
 */
function StripItem({ item }: { item: NavDestination }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const Icon = item.icon;
  const active = item.exact ? path === item.to : path === item.to || path.startsWith(`${item.to}/`);
  const ref = useRef<HTMLAnchorElement>(null);

  // The strip is wider than a phone and scrolls sideways, so the destination you
  // are on is often off-screen — the bar then highlights nothing, and reads as if
  // the page you are looking at is not one of its own. Pull the active one into
  // view instead, which also puts its neighbours where they can be found. The
  // website's strip does the same thing for the same reason.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <Link
      ref={ref}
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-13 shrink-0 flex-col items-center gap-1 px-[18px] py-3 text-[11px] transition-colors",
        active ? "text-app-chrome-foreground" : "text-app-chrome-foreground/60",
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
      {item.label}
    </Link>
  );
}
