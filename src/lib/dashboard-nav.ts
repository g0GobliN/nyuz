import {
  Bell,
  Bookmark,
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
  UserRound,
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
 * The website layout's mobile strip: the sidebar flattened, plus Settings.
 *
 * Kept as its own list rather than derived from `NAV` because the labels differ
 * on purpose — this strip is 11px under an icon, where "My briefing" is a line
 * and "Briefing" is a word. Folding them together would silently rename an
 * existing tab to save eight lines.
 *
 * The installed app does not use this list; it has `TABS` below.
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

/**
 * The app shell's tabs.
 *
 * Four tabs, not the sidebar's nine. That is the whole difference between an app and
 * a narrow website: a tab bar is a promise that every one of its items is a
 * place you go often, and a bar that has to scroll sideways to show its own
 * destinations has broken that promise. Alerts is the one destination worth
 * promoting out of the tab bar and into the top bar, because a pushed alert
 * opens there — everything else (Sources, Delivery, History, Billing) is
 * configuration or archive, and those live in the Profile hub.
 *
 * `tab` names the view this destination opens *within* a route, for Saved: it
 * is the same `/dashboard/briefing` page with the other chip selected, which is
 * why it is a search param rather than a second route.
 */
export type ShellTab = NavDestination & { tab?: "today" | "saved" };

export const TABS: readonly ShellTab[] = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/topics", label: "Topics", icon: Tag },
  { to: "/dashboard/briefing", label: "Saved", icon: Bookmark, tab: "saved" },
  { to: "/dashboard/settings", label: "Profile", icon: UserRound },
] as const;

/**
 * What the Profile hub lists below the reader's own settings.
 *
 * Derived from the lists above rather than written out again — a fifth array is
 * a fourth chance to lose a destination. Everything in `NAV` and `NAV_FOOT` that
 * the tab bar does not already carry, plus the staff block.
 *
 * A tab claims a destination only if it opens the *same view* of it. Saved is
 * `/dashboard/briefing?tab=saved`, so it does not claim `/dashboard/briefing`
 * itself — which is why "My briefing" stays in this list. Excluding by path
 * alone would have quietly removed the delivered-briefing view from the app's
 * navigation, leaving it reachable only from the button on Home.
 */
export function profileHubDestinations(staff: boolean): readonly NavDestination[] {
  // Tabs with a `tab` param claim one view; tabs without one claim their path.
  const claimed = new Set(TABS.filter((tab) => !tab.tab).map((tab) => tab.to));
  return [
    ...NAV.filter((item) => !claimed.has(item.to)),
    ...NAV_FOOT.filter((item) => !claimed.has(item.to)),
    ...(staff ? NAV_STAFF : []),
  ];
}
