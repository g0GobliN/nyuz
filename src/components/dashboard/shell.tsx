import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Clock,
  CreditCard,
  Gauge,
  History,
  Home,
  LogOut,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/landing/nav";
import { PanelLoading } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePrefs } from "@/lib/prefs-store";
import { pingPresence } from "@/lib/server/account";
import { searchStories } from "@/lib/server/briefing";
import { refreshPush } from "@/lib/push/client";
import { cn } from "@/lib/utils";
// From src/lib/viewer.ts rather than the console shell: importing it from there
// would pull the entire admin console into this bundle for the sake of one
// boolean.
import { isAdmin, useViewer } from "@/lib/viewer";
import { getSignupState } from "@/lib/server/access";
import { MaintenanceScreen } from "@/components/access";
import { useAuth, useDisplayName } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/briefing", label: "My briefing", icon: BookOpen },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
  { to: "/dashboard/sources", label: "Sources", icon: Radio },
  { to: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { to: "/dashboard/delivery", label: "Delivery", icon: Send },
  { to: "/dashboard/history", label: "History", icon: History },
] as const;

const NAV_FOOT = [
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
] as const;

/**
 * Staff-only destinations.
 *
 * Both were previously reachable by every signed-in customer. Pipeline shows
 * internal queue depths and per-event scoring, and Console is the admin panel
 * — neither belongs in a subscriber's sidebar.
 *
 * Hiding them is cosmetic, not protective: the security boundary is `adminOnly`
 * in src/lib/server/guard.ts, which re-reads the role from the database on every
 * call. Someone who types /admin still gets a console whose every request is
 * refused. What this removes is the invitation.
 */
const NAV_STAFF = [
  { to: "/dashboard/admin", label: "Pipeline", icon: Gauge },
  { to: "/admin", label: "Console", icon: ShieldCheck },
] as const;

const MOBILE = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/briefing", label: "Briefing", icon: BookOpen },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
  { to: "/dashboard/sources", label: "Sources", icon: Radio },
  { to: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { to: "/dashboard/delivery", label: "Delivery", icon: Send },
  { to: "/dashboard/history", label: "History", icon: History },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

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
  icon: typeof Home;
  exact?: boolean;
}) {
  const active = useActive(to, exact);
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors duration-200",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

export function DashboardShell({ children, title }: { children: ReactNode; title?: string }) {
  const { prefs } = usePrefs();
  const [search, setSearch] = useState(false);
  // Shares the `["viewer"]` query key with the console shell, so moving between
  // the two does not re-ask who you are.
  const { data: viewer } = useViewer();
  const staff = isAdmin(viewer);
  // Falls back to the mark rather than a letter from an invented name — an
  // avatar showing a stranger's initial is worse than one showing none.
  const who = useDisplayName(prefs.name);
  const initial = who.trim().slice(0, 1).toUpperCase() || "·";

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
    void pingPresence().catch(() => {
      // A missed ping must not take the dashboard down. The next load retries.
    });
  }, []);

  useEffect(() => {
    if (!prefs.channels.push) return;
    const key = import.meta.env["VITE_VAPID_PUBLIC_KEY"];
    if (typeof key !== "string" || !key) return;

    const refresh = () => {
      void refreshPush(key).catch(() => {});
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
  }, [prefs.channels.push]);

  if (closed) return <MaintenanceScreen />;

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hairline bg-surface px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo />
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
          <div className="flex h-16 items-center gap-3 px-5 sm:px-7">
            <div className="lg:hidden">
              <Logo />
            </div>
            {title ? <h1 className="hidden text-[15px] font-medium lg:block">{title}</h1> : null}

            <div className="ml-auto flex items-center gap-1">
              <button
                aria-label="Search"
                onClick={() => setSearch(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Search className="h-4 w-4" />
              </button>
              <Link
                to="/dashboard/alerts"
                aria-label="Notifications"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-signal" />
              </Link>
              <ThemeToggle />
              <AccountMenu initial={initial} staff={staff} name={who} />
            </div>
          </div>
        </header>

        <main className="px-5 pb-28 pt-8 sm:px-7 lg:pb-16">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      <nav
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-hairline will-change-transform lg:hidden"
        style={{ transform: "translateZ(0)" }}
      >
        <div className="flex items-stretch overflow-x-auto px-2 pb-[env(safe-area-inset-bottom)] scrollbar-hide">
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
 * The avatar in the header.
 *
 * It used to be a plain link to Settings, which meant the app had no way to
 * sign out at all — `signOut` existed on the auth context and nothing in the
 * product ever called it. The avatar is where people look for that, so it opens
 * a menu instead, with Settings still one click away.
 *
 * It also carries the staff destinations, because it is the only navigation an
 * admin has on a phone. `NAV_STAFF` lives in the sidebar, and the sidebar is
 * `hidden lg:flex` — so below 1024px there was no link to the console anywhere
 * in the product, and the only way in was typing the URL. They are rendered at
 * every width rather than behind `lg:hidden`: a menu whose contents change
 * depending on how wide the window is is worse than one extra row on a desktop
 * that also has a sidebar.
 */
function AccountMenu({ initial, staff, name }: { initial: string; staff: boolean; name: string }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const out = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error(error);
    } finally {
      // Home either way. A sign-out that fails and leaves someone sitting on a
      // dashboard they believe they have left is the worse outcome; the auth
      // listener reconciles the real session state on the way.
      navigate({ to: "/" });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account"
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[12px] font-medium text-background transition-opacity hover:opacity-85"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Identifies the account before offering to leave it — on a shared
            machine, which account you are signing out of is the question. */}
        {name || user?.email ? (
          <>
            <div className="px-2 py-1.5">
              {name ? <p className="truncate text-[13px] font-medium">{name}</p> : null}
              {user?.email ? (
                <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>
              ) : null}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/billing">
            <CreditCard /> Billing
          </Link>
        </DropdownMenuItem>

        {staff ? (
          <>
            <DropdownMenuSeparator />
            {NAV_STAFF.map(({ to, label, icon: Icon }) => (
              <DropdownMenuItem key={to} asChild>
                <Link to={to}>
                  <Icon /> {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => void out()} disabled={signingOut}>
          <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
              className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
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
  icon: typeof Home;
  exact?: boolean;
}) {
  const active = useActive(to, exact);
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center gap-1 px-4 py-2.5 text-[10.5px] transition-colors shrink-0",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim();
  const results = useQuery({
    queryKey: ["briefing", "shell-search", term],
    queryFn: () => searchStories({ data: { q: term } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
  const hits = results.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 px-5 pt-[12vh] backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-hairline bg-surface shadow-[var(--shadow-float)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Show me everything about OpenAI"
            className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {term.length >= 2 && hits.length === 0 && !results.isFetching ? (
            <p className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">
              Nothing in your archive matches that yet.
            </p>
          ) : null}
          {hits.map((s) => (
            <Link
              key={s.id}
              to="/dashboard/story/$id"
              params={{ id: s.id }}
              onClick={onClose}
              className="block border-b border-hairline px-5 py-3.5 last:border-0 hover:bg-muted"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-signal">{s.org}</p>
              <p className="mt-1 text-[14px] font-medium leading-snug">{s.title}</p>
            </Link>
          ))}
          {!term ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Search your archive by company, topic or headline.
            </p>
          ) : null}
        </div>
      </div>
    </div>
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
