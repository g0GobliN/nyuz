import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  Coins,
  Cpu,
  DoorClosed,
  FileText,
  LayoutTemplate,
  Rss,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/landing/nav";
import { PageLoading } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { isAdmin, useViewer } from "@/lib/viewer";
import { humanError } from "@/lib/errors";

/**
 * The console shell.
 *
 * One structural decision runs through this whole directory: **console data is
 * fetched on the client, never in a route loader.** The caller's identity is an
 * access token that lives in browser storage, so a loader running during SSR has
 * nobody to be. Every query here therefore goes through React Query in a
 * component, and the loading state is real rather than cosmetic.
 *
 * The role check below decides what gets drawn and nothing more. It is not the
 * security boundary — that is `adminOnly` / `superadminOnly` in
 * src/lib/server/guard.ts, which re-reads the role from the database on every
 * single call. Someone who forces this component to render sees an empty console
 * whose every request fails.
 */

type NavEntry = {
  to: string;
  label: string;
  icon: typeof BarChart3;
  /** Overview sits at the console root, so it matches on equality only —
   *  without this every child route would light it up as well. */
  exact?: boolean;
};

const NAV: NavEntry[] = [
  { to: "/admin", label: "Overview", icon: BarChart3, exact: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/blog", label: "Blog", icon: FileText },
  // Sources sits next to AI providers because the two are one job: what the
  // pipeline reads, and what it thinks with.
  { to: "/admin/sources", label: "Sources", icon: Rss },
  { to: "/admin/ai", label: "AI providers", icon: Cpu },
  // Next to AI providers for the same reason: what the pipeline thinks with,
  // and what that thinking costs.
  { to: "/admin/cost", label: "Cost", icon: Coins },
  { to: "/admin/content", label: "Site content", icon: LayoutTemplate },
  // Next to site content because both are "what the outside world gets", and
  // ahead of the audit log because it is the one an operator reaches for in a
  // hurry — closing the doors is the emergency lever on this console.
  { to: "/admin/access", label: "Access", icon: DoorClosed },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
];

/**
 * `useViewer` and `isAdmin` live in src/lib/viewer.ts, because the customer
 * dashboard needs the role check too and importing it from here would drag the
 * whole console — every panel, table and stat — into the dashboard's bundle.
 *
 * They are re-exported because the console pages already import them from this
 * module, and a shell that hands out its own primitives is a smaller thing to
 * remember than a rule about which file to reach into.
 */
export { isAdmin, useViewer };

function NavItem({ to, label, icon: Icon, exact }: NavEntry) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = exact ? path === to : path === to || path.startsWith(to + "/");
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

export function AdminLayout() {
  const { data: viewer, isLoading } = useViewer();

  if (isLoading) {
    return <PageLoading label="Checking your access" />;
  }

  // Mirrors the server's 404 for a non-admin. A stranger learning that a console
  // exists and they are merely not on the list gains nothing they can use.
  if (!isAdmin(viewer)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="font-serif text-3xl">Not found.</p>
        <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
          There is nothing at this address.
        </p>
        <Link to="/" className="text-[13.5px] underline decoration-signal underline-offset-4">
          Back to nyuz
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hairline bg-surface px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>

        <p className="mt-6 px-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-signal">
          Console
        </p>

        <nav className="mt-3 flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>

        <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> {viewer?.role}
          </p>
          <p className="mt-2 break-all text-[12.5px]">{viewer?.email}</p>
          <Link
            to="/dashboard"
            className="mt-3 inline-block text-[12px] text-muted-foreground underline decoration-hairline underline-offset-4 hover:text-foreground"
          >
            Leave console
          </Link>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="glass sticky top-0 z-30 border-b border-hairline">
          <div className="flex h-16 items-center gap-3 px-5 sm:px-7">
            <div className="lg:hidden">
              <Logo />
            </div>
            {/* The way back out, too. "Leave console" lives in the sidebar,
                which is `hidden lg:flex`, so on a phone the only exit was the
                logo — which goes to the marketing home page, not to the
                dashboard the operator came from. It sits at the end rather than
                the start so it cannot be hit while reaching for Overview. */}
            <nav className="flex gap-1 overflow-x-auto lg:hidden">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
              <Link
                to="/dashboard"
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Leave
              </Link>
            </nav>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-5 pb-16 pt-6 sm:px-7 sm:pb-20 sm:pt-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Shared primitives                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Optional props throughout this file are written `?: T | undefined` rather than
 * `?: T`. `exactOptionalPropertyTypes` is on, which makes those two different
 * types: the bare form forbids passing `undefined` explicitly, and every call
 * site here does exactly that — `sub={cond ? "…" : undefined}` is the natural way
 * to write a conditional prop in JSX.
 */
export function ConsoleHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="display text-[clamp(1.375rem,4vw,2.35rem)]">{title}</h1>
        {sub ? (
          <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
  className,
}: {
  title?: string | undefined;
  note?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn("rounded-3xl border border-hairline bg-surface p-6 sm:p-7", className)}>
      {title ? (
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
      ) : null}
      {note ? (
        <p className="mt-2.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
      <div className={title || note ? "mt-5" : undefined}>{children}</div>
    </section>
  );
}

/**
 * A figure with its label. `estimate` is not decoration — several numbers in the
 * overview multiply list price by subscription count and know nothing about
 * discounts, refunds or failed charges, and a figure like that has to say so
 * wherever it appears or it gets quoted as fact.
 */
export function Stat({
  label,
  value,
  hint,
  estimate,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  estimate?: boolean | undefined;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[11.5px] text-muted-foreground">
        {label}
        {estimate ? <span className="ml-1.5 text-signal">est.</span> : null}
      </p>
      <p className="mt-1 font-serif text-[26px] leading-none tabular-nums">{value}</p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-[11.5px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "mt-2 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-signal focus-visible:ring-2 focus-visible:ring-ring";

/** Monochrome status pill. Colour is reserved for the accent, so state is shape. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "signal" | "outline";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px]",
        tone === "signal" && "bg-signal text-signal-foreground",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "outline" && "border border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Surfaces an error from a server function.
 *
 * Console errors are operational messages, not user-facing copy — "Refusing to
 * remove the last superadmin" is exactly what the operator needs to read, so it
 * is shown verbatim rather than replaced with something reassuring.
 */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  // Operational messages stay verbatim — that is the point of this component —
  // but a failed validator still arrives as a JSON issue array, and a wall of
  // punctuation is no more useful to an operator than to a customer.
  const message = humanError(error, "Something failed.");
  return (
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] leading-relaxed">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/**
 * Re-exported so the console's existing imports keep working; the wait itself is
 * the mark drawing itself, same as everywhere else in the product.
 */
export { Loading } from "@/components/loading";

/**
 * Wraps a mutation so every console write refreshes what it changed and reports
 * failure in place. `invalidate` takes query keys rather than a callback because
 * every caller wants the same thing: re-read the list you just edited.
 */
export function useConsoleMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  invalidate: string[][],
) {
  const qc = useQueryClient();
  return useMutation<TOutput, Error, TInput>({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Two-step confirm for destructive actions, without a modal. */
export function useConfirm() {
  const [pending, setPending] = useState<string | null>(null);
  return {
    pending,
    ask: (id: string) => setPending(id),
    clear: () => setPending(null),
    is: (id: string) => pending === id,
  };
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}
