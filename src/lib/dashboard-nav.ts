import {
  Bell,
  BookOpen,
  CreditCard,
  Gauge,
  History,
  Home,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";

/**
 * Every place the dashboard can go, in one list.
 *
 * These used to be four arrays inside `src/components/dashboard/shell.tsx` —
 * `NAV`, `NAV_FOOT`, `NAV_STAFF` and `MOBILE` — and the app shell needs the same
 * destinations in a different shape. Copying them would mean that adding a page
 * updates one chrome and not the other, and the failure is invisible: the
 * destination simply is not there, in the layout the reader happens to be using.
 * One list, two renderings.
 *
 * It is the same reasoning as `SECTION_KEYS`/`SECTION_LABELS`/`SECTION_COMPONENTS`
 * in `src/routes/index.tsx`: the three views of a thing live together so that
 * forgetting one is a type error rather than a missing link.
 *
 * Nothing here is a security boundary. `NAV_STAFF` decides what is *drawn*; the
 * protection is `adminOnly`/`superadminOnly` in src/lib/server/guard.ts, which
 * re-reads the role from the database on every call.
 */

export type NavDestination = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only active on an exact path match, for a destination that has children. */
  exact?: boolean;
};

/** The main sidebar, in order. */
export const NAV: readonly NavDestination[] = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/briefing", label: "My briefing", icon: BookOpen },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
  { to: "/dashboard/sources", label: "Sources", icon: Radio },
  { to: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { to: "/dashboard/delivery", label: "Delivery", icon: Send },
  { to: "/dashboard/history", label: "History", icon: History },
] as const;

/** Below the sidebar's hairline. */
export const NAV_FOOT: readonly NavDestination[] = [
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
] as const;

/**
 * Staff-only destinations.
 *
 * Both were previously reachable by every signed-in customer. Pipeline shows
 * internal queue depths and per-event scoring, and Console is the admin panel —
 * neither belongs in a subscriber's sidebar. Hiding them is cosmetic: someone
 * who types /admin still gets a console whose every request is refused. What
 * this removes is the invitation.
 */
export const NAV_STAFF: readonly NavDestination[] = [
  { to: "/dashboard/pipeline", label: "Pipeline", icon: Gauge },
  { to: "/admin", label: "Console", icon: ShieldCheck },
] as const;

/**
 * The scrolling strip, and the only navigation either chrome draws on a phone.
 *
 * Both layouts render this same list, in the same order, and each one only
 * changes what it looks like: the browser's strip is glass on the page's own
 * background under a `lg:hidden` bar, the installed app's is the ink bar at the
 * bottom of the window. That sameness is the point. An earlier version of the
 * app shell drew four fixed tabs instead and needed a Profile hub inside
 * Settings to reach the other five destinations — a second navigation system
 * that existed only because the bar had been shrunk, and that left the reader to
 * learn where each chrome had hidden things.
 *
 * Kept as its own list rather than derived from `NAV` because the labels differ
 * on purpose — this strip is 11px under an icon, where "My briefing" is a line
 * and "Briefing" is a word. Folding them together would silently rename an
 * existing destination to save eight lines.
 *
 * Billing is deliberately absent, in both chromes: it is a settings-shaped
 * thing a reader looks for once, and both headers already carry it in the
 * account menu. The staff destinations are there for the same reason — see
 * `NAV_STAFF`, which the account menu also renders.
 */
export const MOBILE: readonly NavDestination[] = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/briefing", label: "Briefing", icon: BookOpen },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
  { to: "/dashboard/sources", label: "Sources", icon: Radio },
  { to: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { to: "/dashboard/delivery", label: "Delivery", icon: Send },
  { to: "/dashboard/history", label: "History", icon: History },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;
