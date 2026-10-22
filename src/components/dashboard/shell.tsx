import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Clock, Search, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MaintenanceScreen } from "@/components/access";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { AppShell } from "@/components/dashboard/app-shell";
import { SearchOverlay } from "@/components/dashboard/search-overlay";
import { OfflineNotice } from "@/components/dashboard/offline-notice";
import { UpdateNotice } from "@/components/dashboard/update-notice";
import { Logo } from "@/components/landing/nav";
import { PanelLoading } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { focusRing } from "@/components/kit";
import { useDisplayName } from "@/lib/auth";
import { MOBILE, NAV, NAV_FOOT, NAV_STAFF } from "@/lib/dashboard-nav";
import { useStandalone } from "@/lib/display-mode";
import { usePrefs } from "@/lib/prefs-store";
import { pingPresence } from "@/lib/server/account";
import { getSignupState } from "@/lib/server/access";
import { refreshPush } from "@/lib/push/client";
import { cn } from "@/lib/utils";
// From src/lib/viewer.ts rather than the console shell: importing it from there
// would pull the entire admin console into this bundle for the sake of one
// boolean.
import { isAdmin, useViewer } from "@/lib/viewer";

/**
 * The dashboard's chrome, in two shapes.
 *
 * The destinations themselves live in src/lib/dashboard-nav.ts, shared with the
 * installed app's bottom strip, and the account menu and search overlay are their
 * own modules for the same reason: this file used to hold four nav arrays and
 * both of those components, and the app shell needs all of them.
 *
 * Which shape is drawn is decided here, once, by `useStandalone()`. Every page
 * renders `<DashboardShell title="…">` and none of them knows the difference —
 * which is the only reason a second chrome was affordable.
 */

function useActive(to: string, exact?: boolean) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return exact ? path === to : path === to || path.startsWith(to + "/");
}

function NavItem({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}) {
  const active = useActive(to, exact);
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors duration-200",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
        focusRing,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

/** Survives the one reload that follows a restored account (0074). */
const RESTORED_KEY = "nyuz.account-restored";

export function DashboardShell({ children, title }: { children: ReactNode; title?: string }) {
  const { prefs } = usePrefs();
  const [search, setSearch] = useState(false);
  const [restored, setRestored] = useState(false);
  // Read on the client only. This component is never server-rendered: the guard
  // in src/routes/dashboard.tsx holds the whole route back until it knows who is
  // asking, and the session lives in browser storage. So there is no server
  // markup to disagree with, and no flash of the wrong chrome on launch.
  const standalone = useStandalone();
  // Shares the `["viewer"]` query key with the console shell, so moving between
  // the two does not re-ask who you are.
  const { data: viewer } = useViewer();
  const staff = isAdmin(viewer);
  // Falls back to the mark rather than a letter from an invented name — an
  // avatar showing a stranger's initial is worse than one showing none.
  const who = useDisplayName(prefs.name);

  // Maintenance closes the dashboard for readers and not for staff — the whole
  // point of the switch is that somebody can still get in and fix whatever
  // caused it. Reuses `getSignupState`, which already reports maintenance, so
  // this adds no new endpoint. A failed read reports open: locking everybody
  // out because one query wobbled is the worse failure.
  const access = useQuery({
    queryKey: ["access", "state"],
    queryFn: () => getSignupState(),
    staleTime: 60_000,
  });
  const closed = access.data?.reason === "maintenance" && !staff;

  useEffect(() => {
    void pingPresence()
      .then(({ restored }) => {
        // Reload once so preference hooks that raced the restore do not keep
        // rendering the temporary deletion pause from their local cache. The
        // flag survives that reload so the reader is told their account came
        // back — an account silently un-deleting itself is the one outcome
        // nobody asked for.
        if (restored) {
          window.sessionStorage.setItem(RESTORED_KEY, "1");
          window.location.reload();
        }
      })
      .catch(() => {
        // A missed ping must not take the dashboard down. The next load retries.
      });
  }, []);

  useEffect(() => {
    if (window.sessionStorage.getItem(RESTORED_KEY) === null) return;
    window.sessionStorage.removeItem(RESTORED_KEY);
    setRestored(true);
  }, []);

  useEffect(() => {
    // Not gated on `prefs.channels.push`. That preference belongs to the
    // account, so gating on it both skipped devices that are subscribed while
    // the channel is off and ran on devices that never subscribed. refreshPush
    // reads this browser's own subscription and does nothing when there is
    // none, which is the per-device question being asked here.
    const refresh = () => {
      void refreshPush().catch(() => {});
    };

    // Initial refresh on mount so a newly-enabled or rotated subscription
    // is picked up before the user does anything else.
    refresh();

    // Refresh when the user returns to the tab — the main moment a
    // silently-rotated endpoint can be caught without polling.
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    // Fallback: once per day, in case the endpoint rotated while the tab
    // was open and the user never backgrounded it. This is one cheap
    // upsert per device per day, not 1 440 of them.
    const fallback = setInterval(refresh, 86_400_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(fallback);
    };
  }, []);

  // The maintenance screen replaces the chrome in both modes rather than sitting
  // inside it. It is a full page with its own header, the logo and the theme
  // toggle, and a dashboard frame around it would promise pages that every
  // request behind them is refusing to serve.
  if (closed) return <MaintenanceScreen />;

  if (standalone) {
    return (
      <AppShell>
        <OfflineNotice />
        <UpdateNotice />
        {restored ? <RestoredNotice onDismiss={() => setRestored(false)} /> : null}
        {children}
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hairline bg-surface px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo className={focusRing} />
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          <div className="my-4 h-px bg-[var(--hairline)]" />
          {NAV_FOOT.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          {staff ? (
            <>
              <div className="my-4 h-px bg-[var(--hairline)]" />
              <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Staff
              </p>
              {NAV_STAFF.map((n) => (
                <NavItem key={n.to} {...n} />
              ))}
            </>
          ) : null}
        </nav>

        <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Next briefing
          </p>
          <p className="mt-2 text-[14px] font-medium tabular-nums">
            {prefs.paused ? "Paused" : `Tomorrow · ${prefs.time}`}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">{prefs.timezone}</p>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="glass sticky top-0 z-30 border-b border-hairline">
          <div className="gutter-x sm:gutter-x-md flex h-16 items-center gap-3">
            <div className="lg:hidden">
              <Logo className={focusRing} />
            </div>
            {/* A wayfinding cue for sighted readers, not the document title.
                `PageHeader` below already renders this page's own <h1>, so
                promoting the label made every desktop dashboard page carry two
                of them and "what page is this?" answer twice. Kept as a <p>
                with the class string byte-identical: the label is still read,
                just not as a heading. The h1 stays inside PageHeader, which is
                the one that belongs to the page. */}
            {title ? <p className="hidden text-[15px] font-medium lg:block">{title}</p> : null}

            <div className="ml-auto flex items-center gap-1">
              <button
                aria-label="Search"
                onClick={() => setSearch(true)}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                <Search className="h-4 w-4" />
              </button>
              <Link
                to="/dashboard/alerts"
                aria-label="Notifications"
                className={cn(
                  "relative inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-signal" />
              </Link>
              <ThemeToggle className={focusRing} />
              <AccountMenu staff={staff} name={who} className={focusRing} />
            </div>
          </div>
        </header>

        <main className="gutter-x pb-28 pt-8 sm:gutter-x-md lg:pb-16">
          <div className="mx-auto w-full max-w-5xl">
            <OfflineNotice />
            <UpdateNotice />
            {restored ? <RestoredNotice onDismiss={() => setRestored(false)} /> : null}
            {children}
          </div>
        </main>
      </div>

      <nav
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-hairline will-change-transform lg:hidden"
        style={{ transform: "translateZ(0)" }}
      >
        {/* Same rule as the app shell: the inset replaces the strip's own
            bottom padding rather than stacking on it, so an installed phone
            does not carry both. A browser tab (inset 0) keeps the 0.375rem. */}
        <div className="gutter-x-xs flex touch-pan-x items-stretch overflow-x-auto overscroll-x-contain pb-[max(0.375rem,env(safe-area-inset-bottom)_-_0.375rem)] scrollbar-hide">
          {MOBILE.map((m) => (
            <MobileItem key={m.to} {...m} />
          ))}
        </div>
      </nav>

      {search ? <SearchOverlay onClose={() => setSearch(false)} /> : null}
    </div>
  );
}

/**
 * Told once, after an account that had asked to be deleted comes back.
 *
 * Split out of the layout above so the installed app's shell can show it too —
 * signing in on a phone from a Home Screen icon is exactly how a reader cancels
 * a scheduled deletion, and it is the one moment they have to be told it
 * happened.
 */
function RestoredNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-hairline bg-surface-2 p-4">
      <p className="flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Welcome back.</span> Signing in cancelled the
        deletion of your account, and your briefing settings are exactly as you left them.
      </p>
      <button
        onClick={onDismiss}
        className={cn(
          "text-[12.5px] text-muted-foreground transition-colors hover:text-foreground",
          focusRing,
        )}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Wraps a staff-only dashboard page.
 *
 * Hiding a sidebar link stops nobody from typing the URL, so pages that are only
 * meant for staff render this instead of their body. It is still not a security
 * boundary — anything sensitive on such a page must come from a server function
 * behind `adminOnly`, which checks the role in the database rather than trusting
 * what the browser believes about itself.
 *
 * The loading branch shows nothing rather than the page, because flashing an
 * operator view for 200ms and then withdrawing it is worse than a short blank.
 */
export function StaffOnly({ children, title }: { children: ReactNode; title: string }) {
  const { data: viewer, isLoading } = useViewer();

  if (isLoading) {
    return (
      <DashboardShell title={title}>
        <PanelLoading label="Checking your access" />
      </DashboardShell>
    );
  }

  if (!isAdmin(viewer)) {
    return (
      <DashboardShell title={title}>
        <EmptyState
          title="Not your floor."
          body="This page is an internal operator view. If you think you should have access to it, ask whoever set up your account."
          action={
            <Link
              to="/dashboard"
              className={cn(
                "text-[13.5px] text-muted-foreground transition-colors hover:text-foreground",
                focusRing,
              )}
            >
              Back to your briefing
            </Link>
          }
        />
      </DashboardShell>
    );
  }

  return <>{children}</>;
}

function MobileItem({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}) {
  const active = useActive(to, exact);
  const ref = useRef<HTMLAnchorElement>(null);

  // The bar is wider than a phone and scrolls sideways, so the tab you are on
  // is often off-screen — the bar then highlights nothing and reads as if the
  // page you are looking at is not one of its destinations. Pull the active one
  // into view instead, which also puts its neighbours where they can be found.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <Link
      ref={ref}
      to={to}
      className={cn(
        "flex min-h-13 shrink-0 flex-col items-center gap-1 px-[18px] py-3 text-[11px] transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
        focusRing,
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="display mt-2 text-[clamp(1.5rem,4.5vw,2.75rem)]">{title}</h1>
        {sub ? (
          <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border px-6 py-12 text-center sm:px-8 sm:py-16">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-7 flex justify-center">{action}</div> : null}
    </div>
  );
}
