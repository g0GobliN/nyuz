import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MOBILE, NAV, NAV_FOOT, NAV_STAFF, type NavDestination } from "@/lib/dashboard-nav";

/**
 * One destination list, two chromes.
 *
 * Both layouts draw `MOBILE` as a sideways-scrolling strip, and the sidebar draws
 * `NAV`/`NAV_FOOT`. The failure this file exists to prevent is not a crash — it
 * is a destination one layout reaches and the other simply does not list, which
 * nobody notices until they are standing in the layout that lost it.
 *
 * The arithmetic that makes the two comparable: everything is either in the
 * strip or in the account menu, which both headers render at every width. An
 * earlier app shell drew four fixed tabs instead and covered the difference with
 * a Profile hub inside Settings — a second navigation system, and the thing these
 * tests replaced.
 */

const paths = (list: readonly NavDestination[]) => list.map((item) => item.to);

/** What the account menu carries, in both headers. See account-menu.tsx. */
const ACCOUNT_MENU = ["/dashboard/billing", ...paths(NAV_STAFF)];

describe("the strip", () => {
  it("carries every destination a reader reaches from the sidebar", () => {
    expect(paths(MOBILE)).toEqual([
      "/dashboard",
      "/dashboard/briefing",
      "/dashboard/topics",
      "/dashboard/sources",
      "/dashboard/alerts",
      "/dashboard/delivery",
      "/dashboard/history",
      "/dashboard/settings",
    ]);
  });

  it("keeps the short labels an 11px row needs", () => {
    // Not the sidebar's labels: here "My briefing" is a line under an icon.
    expect(MOBILE.map((item) => item.label)).toEqual([
      "Home",
      "Briefing",
      "Topics",
      "Sources",
      "Alerts",
      "Delivery",
      "History",
      "Settings",
    ]);
  });

  it("points every item at a destination the sidebar knows", () => {
    // An item aimed at a route no list mentions is one that will be forgotten
    // the next time the sidebar is reorganised.
    const known = new Set([...paths(NAV), ...paths(NAV_FOOT)]);
    for (const item of MOBILE) expect(known.has(item.to)).toBe(true);
  });
});

describe("nothing is reachable only by typing a URL", () => {
  it("covers the sidebar with the strip and the account menu", () => {
    const reachable = new Set([...paths(MOBILE), ...ACCOUNT_MENU]);
    for (const item of [...NAV, ...NAV_FOOT, ...NAV_STAFF]) {
      expect(reachable.has(item.to)).toBe(true);
    }
  });

  it("leaves Billing to the account menu rather than the strip", () => {
    // Billing is looked for once, and both headers already offer it. The strip's
    // own list stays at the eight destinations above.
    expect(paths(MOBILE)).not.toContain("/dashboard/billing");
    expect(ACCOUNT_MENU).toContain("/dashboard/billing");
  });
});

describe("the lists themselves", () => {
  const lists: Array<[string, readonly NavDestination[]]> = [
    ["NAV", NAV],
    ["NAV_FOOT", NAV_FOOT],
    ["NAV_STAFF", NAV_STAFF],
    ["MOBILE", MOBILE],
  ];

  it.each(lists)("%s has no duplicate destination", (_name, list) => {
    // React keys are the path, so a duplicate is a silent reconciliation bug as
    // well as a double link.
    expect(new Set(paths(list)).size).toBe(list.length);
  });

  it.each(lists)("%s labels and draws every destination", (_name, list) => {
    for (const item of list) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      // Truthy rather than a typeof check: a lucide icon is a forwardRef object
      // in React 19, not a function, and asserting the component's shape would
      // be asserting a third party's internals.
      expect(item.icon).toBeTruthy();
    }
  });

  it.each(lists)("%s uses a distinct icon per destination", (_name, list) => {
    // Two destinations sharing a glyph makes the strip ambiguous at a glance.
    expect(new Set(list.map((item) => item.icon)).size).toBe(list.length);
  });

  it("keeps Home exact, so a child page does not light it up", () => {
    // /dashboard is a prefix of every other dashboard route.
    expect(NAV.find((item) => item.to === "/dashboard")?.exact).toBe(true);
    expect(MOBILE.find((item) => item.to === "/dashboard")?.exact).toBe(true);
  });

  it("starts every destination with a slash", () => {
    for (const [, list] of lists) for (const to of paths(list)) expect(to).toMatch(/^\//);
  });
});

describe("one strip, two chromes", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("is what the installed app's bottom bar draws", () => {
    const appShell = read("src/components/dashboard/app-shell.tsx");
    expect(appShell).toContain("MOBILE.map(");
    // Sideways scroll is what makes one list affordable on a phone; without it
    // the bar would either clip destinations or shrink them past reading size.
    expect(appShell).toContain("overflow-x-auto");
  });

  it("is what the browser layout draws", () => {
    expect(read("src/components/dashboard/shell.tsx")).toContain("MOBILE.map(");
  });

  it("is not written out a second time as a list of links in Settings", () => {
    // The hub that used to live there read from these same lists, so it never
    // went stale — it just put a second, differently-shaped navigation system
    // inside a settings page. Its absence is the point, not its contents.
    expect(read("src/routes/dashboard/settings.tsx")).not.toContain("dashboard-nav");
  });
});
