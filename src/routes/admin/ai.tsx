import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Coins, Cpu, Gauge, SlidersHorizontal } from "lucide-react";
import { useViewer } from "@/components/admin/shell";

/**
 * The AI hub.
 *
 * Three pages that had grown apart — providers, runtime controls, cost — were
 * one investigation from the operator's chair: "why did spend spike?" spans
 * where requests go, what limits are in force, and what got spent. They are one
 * place now, with the four tabs below as child routes so each mounts only its
 * own queries and the URL stays shareable.
 *
 * Like the console shell itself, this layout draws nothing that enforces
 * anything: the real gates are `adminOnly` / `superadminOnly` inside each server
 * function, and they are unchanged by the move.
 */

// Layout route: it holds the tab bar and renders the active tab through
// <Outlet />. The page at /admin/ai itself is the Status tab, provided by the
// index route in ai/index.tsx.
export const Route = createFileRoute("/admin/ai")({ component: AiHub });

const TABS = [
  { to: "/admin/ai", label: "Status", icon: Gauge, exact: true },
  { to: "/admin/ai/providers", label: "Providers", icon: Cpu },
  { to: "/admin/ai/limits", label: "Limits", icon: SlidersHorizontal },
  { to: "/admin/ai/spend", label: "Spend", icon: Coins },
] as const;

function AiHub() {
  const { data: viewer } = useViewer();
  const isSuper = viewer?.role === "superadmin";

  return (
    <>
      <ConsoleTabBar isSuper={isSuper} />
      <Outlet />
    </>
  );
}

function ConsoleTabBar({ isSuper }: { isSuper: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <nav
        aria-label="AI console sections"
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5"
      >
        {TABS.map((tab) => (
          <TabLink key={tab.to} {...tab} />
        ))}
      </nav>
      {isSuper ? null : (
        <p className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
          Provider, route and prompt changes are restricted to superadmins; everything here is
          readable by admins.
        </p>
      )}
    </div>
  );
}

function TabLink({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: typeof Gauge;
  exact?: boolean | undefined;
}) {
  return (
    <Link
      to={to}
      {...(exact ? { activeOptions: { exact: true } } : {})}
      className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] text-muted-foreground transition-colors duration-200 hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
