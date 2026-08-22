import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Clock,
  CreditCard,
  Gauge,
  History,
  Home,
  Radio,
  Search,
  Send,
  Settings,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/landing/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { STORIES } from "@/lib/sample-data";
import { useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";

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
  { to: "/dashboard/admin", label: "Pipeline", icon: Gauge },
] as const;

const MOBILE = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/briefing", label: "Briefing", icon: BookOpen },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
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

export function DashboardShell({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const { prefs } = useRadar();
  const [search, setSearch] = useState(false);

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
        </nav>

        <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Next briefing
          </p>
          <p className="mt-2 text-[14px] font-medium tabular-nums">Tomorrow · {prefs.time}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{prefs.timezone}</p>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="glass sticky top-0 z-30 border-b border-hairline">
          <div className="flex h-16 items-center gap-3 px-5 sm:px-7">
            <div className="lg:hidden">
              <Logo />
            </div>
            {title ? (
              <h1 className="hidden text-[15px] font-medium lg:block">{title}</h1>
            ) : null}

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
              <Link
                to="/dashboard/settings"
                aria-label="Profile"
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[12px] font-medium text-background"
              >
                {prefs.name.slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </div>
        </header>

        <main className="px-5 pb-28 pt-8 sm:px-7 lg:pb-16">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-hairline lg:hidden">
        <div className="flex items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {MOBILE.map((m) => (
            <MobileItem key={m.to} {...m} />
          ))}
        </div>
      </nav>

      {search ? <SearchOverlay onClose={() => setSearch(false)} /> : null}
    </div>
  );
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
        "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] transition-colors",
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

  const term = q.trim().toLowerCase();
  const results = term
    ? STORIES.filter(
        (s) =>
          s.title.toLowerCase().includes(term) ||
          s.org.toLowerCase().includes(term) ||
          s.topics.some((t) => t.toLowerCase().includes(term)),
      )
    : [];

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
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
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
          {term && results.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">
              Nothing in your archive matches that yet.
            </p>
          ) : null}
          {results.map((s) => (
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
        <h1 className="display mt-2 text-[clamp(1.9rem,4.5vw,2.75rem)]">{title}</h1>
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
    <div className="rounded-3xl border border-dashed border-border px-8 py-16 text-center">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-7 flex justify-center">{action}</div> : null}
    </div>
  );
}
