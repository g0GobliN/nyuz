import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { OfflineNotice } from "@/components/dashboard/offline-notice";
import { SearchOverlay } from "@/components/dashboard/search-overlay";
import { UpdateNotice } from "@/components/dashboard/update-notice";
import { LogoMark } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useDisplayName } from "@/lib/auth";
import { TABS, type ShellTab } from "@/lib/dashboard-nav";
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
 * 2. **Four tabs, always visible.** The website's mobile nav is a horizontally
 *    scrolling strip of nine destinations, which is a list that happens to be at
 *    the bottom of the screen. Four fixed tabs are a promise that every item is
 *    somewhere you go often — see TABS in src/lib/dashboard-nav.ts for what that
 *    costs (a Profile hub for the rest, Alerts promoted to the top bar).
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

/** The tab bar's height, so the content padding below it cannot drift from it. */
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
              destination it would point at is already the first tab. */}
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
        {/* A single reading column, at every width. The tab bar stays at the
            bottom of a tablet too, so a wider window gets more margin rather
            than a second layout nobody asked for. */}
        <div className="mx-auto w-full max-w-2xl">
          <OfflineNotice />
          <UpdateNotice />
          {children}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-app-chrome text-app-chrome-foreground">
        <div className="gutter-x-xs flex items-stretch pb-[env(safe-area-inset-bottom)]">
          {TABS.map((tab) => (
            <Tab key={tab.label} tab={tab} />
          ))}
        </div>
      </nav>

      {search ? <SearchOverlay onClose={() => setSearch(false)} /> : null}
    </div>
  );
}

/**
 * One tab.
 *
 * Active state is worked out here rather than passed in, because the answer
 * depends on both the path and — for Saved — the search param that selects which
 * view of the briefing is showing.
 *
 * Saved stays inactive while the briefing is on its Today chip. That is
 * deliberate: the two chips are on the page, right under the bar, and highlighting
 * "Saved" while the reader is looking at today's stories is the bar telling them
 * something untrue about where they are. Nothing being highlighted is the honest
 * state for a screen that is not one of the four.
 */
function Tab({ tab }: { tab: ShellTab }) {
  // Two primitive selectors rather than one object: `useRouterState` re-renders
  // on the value its selector returns, and a fresh object every time would make
  // that check unsatisfiable.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const view = useRouterState({ select: (s) => String(s.location.search["tab"] ?? "today") });
  const TabIcon = tab.icon;

  const active = tab.tab
    ? path === tab.to && view === tab.tab
    : tab.exact
      ? path === tab.to
      : path === tab.to || path.startsWith(`${tab.to}/`);

  return (
    <Link
      to={tab.to}
      search={tab.tab ? { tab: tab.tab } : {}}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10.5px] transition-colors",
        active ? "text-app-chrome-foreground" : "text-app-chrome-foreground/60",
      )}
    >
      {/* The one place the accent appears in the shell, and it is 2px of it. */}
      {active ? (
        <span className="absolute top-0 h-[2px] w-7 rounded-full bg-signal" aria-hidden="true" />
      ) : null}
      <TabIcon className="h-[21px] w-[21px]" strokeWidth={active ? 2.2 : 1.8} />
      {tab.label}
    </Link>
  );
}
