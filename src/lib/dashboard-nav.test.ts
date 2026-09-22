import { describe, expect, it } from "vitest";

import {
  MOBILE,
  NAV,
  NAV_FOOT,
  NAV_STAFF,
  profileHubDestinations,
  TABS,
  type NavDestination,
} from "@/lib/dashboard-nav";

/**
 * Two chromes read these lists: the website sidebar and the installed app's tab
 * bar. The failure this file exists to prevent is not a crash — it is a
 * destination that is reachable in one layout and simply absent in the other,
 * which nobody notices until they are standing in the wrong one.
 *
 * The app shell has four tabs and the sidebar has nine destinations, so the five
 * that are not tabs have to be reachable from the Profile hub. That is the
 * arithmetic asserted below, and it is the reason the hub derives its list here
 * rather than being written out by hand.
 */

const paths = (list: readonly NavDestination[]) => list.map((item) => item.to);

describe("the tab bar is a subset of the sidebar", () => {
  it("has the four tabs the installed app promises", () => {
    expect(TABS.map((tab) => tab.label)).toEqual(["Home", "Topics", "Saved", "Profile"]);
  });

  it("points every tab at a destination the sidebar knows", () => {
    // A tab aimed at a route no list mentions is a tab that will be forgotten
    // the next time the sidebar is reorganised.
    const known = new Set([...paths(NAV), ...paths(NAV_FOOT)]);
    for (const tab of TABS) expect(known.has(tab.to)).toBe(true);
  });

  it("opens Saved on the saved view rather than the default", () => {
    const saved = TABS.find((tab) => tab.label === "Saved");
    expect(saved?.to).toBe("/dashboard/briefing");
    expect(saved?.tab).toBe("saved");
  });
});

describe("nothing falls off the edge of the tab bar", () => {
  it("keeps every sidebar destination reachable for a reader", () => {
    const tabs = new Set(paths(TABS));
    const hub = new Set(paths(profileHubDestinations(false)));
    for (const item of [...NAV, ...NAV_FOOT]) {
      expect(tabs.has(item.to) || hub.has(item.to)).toBe(true);
    }
  });

  it("lists everything the tab bar does not, in sidebar order", () => {
    expect(paths(profileHubDestinations(false))).toEqual([
      // Kept, even though the Saved tab points at this same route: Saved opens
      // the saved view, and this opens the briefing as it was delivered.
      "/dashboard/briefing",
      "/dashboard/sources",
      "/dashboard/alerts",
      "/dashboard/delivery",
      "/dashboard/history",
      "/dashboard/billing",
    ]);
  });

  it("does not claim a whole route on behalf of one view of it", () => {
    // The bug this guards: filtering by path alone drops the briefing from the
    // hub, because a tab with `tab: "saved"` happens to share its path.
    const hub = paths(profileHubDestinations(false));
    expect(hub).toContain("/dashboard/briefing");
    expect(hub).not.toContain("/dashboard/topics");
    expect(hub).not.toContain("/dashboard/settings");
  });

  it("shows the staff destinations only to staff", () => {
    // Not a permission — `adminOnly` in src/lib/server/guard.ts is — but an
    // invitation, and one that should not appear in a customer's hub.
    expect(paths(profileHubDestinations(false))).not.toContain("/admin");
    expect(paths(profileHubDestinations(true))).toEqual([
      ...paths(profileHubDestinations(false)),
      "/dashboard/pipeline",
      "/admin",
    ]);
  });
});

describe("the browser layout's mobile strip", () => {
  it("still carries all nine, with Settings and not Billing", () => {
    // Unchanged from the strip that shipped before the app shell existed: its
    // labels are shorter than the sidebar's on purpose.
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
});

describe("the lists themselves", () => {
  const lists: Array<[string, readonly NavDestination[]]> = [
    ["NAV", NAV],
    ["NAV_FOOT", NAV_FOOT],
    ["NAV_STAFF", NAV_STAFF],
    ["MOBILE", MOBILE],
    ["TABS", TABS],
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
    // Two destinations sharing a glyph makes the tab bar ambiguous at a glance.
    expect(new Set(list.map((item) => item.icon)).size).toBe(list.length);
  });

  it("keeps Home exact, so a child page does not light it up", () => {
    // /dashboard is a prefix of every other dashboard route.
    expect(NAV.find((item) => item.to === "/dashboard")?.exact).toBe(true);
    expect(TABS.find((item) => item.to === "/dashboard")?.exact).toBe(true);
    expect(MOBILE.find((item) => item.to === "/dashboard")?.exact).toBe(true);
  });

  it("starts every destination with a slash", () => {
    for (const [, list] of lists) for (const to of paths(list)) expect(to).toMatch(/^\//);
  });
});
