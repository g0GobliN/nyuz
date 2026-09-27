import { readFileSync } from "node:fs";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/guard", () => ({ adminOnly: {}, audit: vi.fn() }));

import { AI_RUNTIME_SETTINGS } from "@/lib/ai/runtime-config";
import { KILL_SWITCH_SETTING_KEY, deriveAiStatus } from "@/lib/server/ai-status";
import { parseSettingSearch } from "./ai/-shared";
import { Route as AiRuntimeShim } from "./ai-runtime";
import { Route as CostShim } from "./cost";

/**
 * The AI console used to be three pages; it is one hub with four tabs now. Old
 * URLs live on in bookmarks, docs, alert text and the `?setting=` deep links
 * the status derivation hands out, and every one of them fails silently when
 * it breaks — a redirect to a missing route is a blank 404, and a dropped
 * search param lands on the right page with the wrong control in view.
 */

const ROUTE_TREE = readFileSync("src/routeTree.gen.ts", "utf8");

type ShimRoute = { options: { beforeLoad?: unknown } };

/** Runs a shim's beforeLoad and returns where it sends the browser. */
function redirectOf(route: ShimRoute, search: Record<string, unknown> = {}) {
  const beforeLoad = route.options.beforeLoad as (ctx: { search: Record<string, unknown> }) => void;
  try {
    beforeLoad({ search });
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown.options;
    throw thrown;
  }
  throw new Error("beforeLoad returned instead of redirecting");
}

function isRegistered(fullPath: string): boolean {
  return ROUTE_TREE.includes(`fullPath: '${fullPath}'`);
}

describe("old AI console URLs", () => {
  it("/admin/cost lands on the Spend tab", () => {
    expect(redirectOf(CostShim)).toMatchObject({ to: "/admin/ai/spend", replace: true });
  });

  it("/admin/ai-runtime lands on the Limits tab", () => {
    expect(redirectOf(AiRuntimeShim)).toMatchObject({
      to: "/admin/ai/limits",
      search: {},
      replace: true,
    });
  });

  it("/admin/ai-runtime keeps the ?setting= deep link across the redirect", () => {
    expect(redirectOf(AiRuntimeShim, { setting: "ai.monthly_cost_usd" })).toMatchObject({
      to: "/admin/ai/limits",
      search: { setting: "ai.monthly_cost_usd" },
    });
  });

  it("forwards nothing the Limits tab would not accept", () => {
    expect(redirectOf(AiRuntimeShim, { setting: 42, utm_source: "mail" })).toMatchObject({
      search: {},
    });
  });

  it("both shims and every redirect target are registered routes", () => {
    // Without the shim route a bookmark 404s; without the target, the redirect
    // does. Either way the router says nothing until someone clicks.
    for (const path of [
      "/admin/cost",
      "/admin/ai-runtime",
      "/admin/ai/spend",
      "/admin/ai/limits",
    ]) {
      expect(isRegistered(path), path).toBe(true);
    }
  });
});

describe("Limits tab search", () => {
  it("accepts a setting key and drops everything else", () => {
    expect(parseSettingSearch({ setting: "ai.daily_cost_usd", page: "2" })).toEqual({
      setting: "ai.daily_cost_usd",
    });
    expect(parseSettingSearch({ setting: ["a", "b"] })).toEqual({});
    expect(parseSettingSearch({})).toEqual({});
  });
});

describe("deep links from the AI status", () => {
  const base: Parameters<typeof deriveAiStatus>[0] = {
    spentUsd: 1,
    ceilingUsd: 10,
    tokensUsed: 1_000,
    tokensBudget: 1_000_000,
    inFlightUsd: 0,
    daySpentPro: 0,
    dayCapPro: 5,
    daySpentFlash: 0,
    dayCapFlash: 1,
    killSwitchOn: false,
    creditRemainingUsd: 5,
    creditToppedUpUsd: 10,
    creditBurnUsdPerDay: 0.1,
    creditDaysRemaining: 50,
    creditStatus: "ok",
    creditGateEnabled: false,
    ceilingSource: "database",
    tokenBudgetSource: "database",
  };

  // One scenario per way the status can end up blocked or warning, so every
  // branch that could hand out a link is exercised.
  const scenarios: Partial<typeof base>[] = [
    {},
    { killSwitchOn: true },
    { tokensUsed: 1_000_000 },
    { spentUsd: 10 },
    { creditGateEnabled: true, creditStatus: "exhausted", creditRemainingUsd: 0 },
    { creditGateEnabled: true, creditStatus: "unrecorded", creditToppedUpUsd: 0 },
    { daySpentFlash: 1 },
    { daySpentPro: 5 },
    { spentUsd: 9.5 },
    { creditStatus: "low" },
  ];

  const linked = scenarios
    .map((overrides) => deriveAiStatus({ ...base, ...overrides }).action?.settingKey ?? null)
    .filter((key): key is string => key !== null);

  it("still produces the links the status card and Status tab rely on", () => {
    // Guards the check below against passing vacuously if the derivation
    // stops producing links altogether.
    expect(new Set(linked)).toEqual(
      new Set([KILL_SWITCH_SETTING_KEY, "ai.monthly_token_budget", "ai.monthly_cost_usd"]),
    );
  });

  it("only links to controls the Limits tab renders", () => {
    // The tab lists the runtime registry plus the kill-switch row the server
    // appends. A key outside that set opens the tab with nothing highlighted.
    const rendered = new Set([
      ...AI_RUNTIME_SETTINGS.map((spec) => spec.key),
      KILL_SWITCH_SETTING_KEY,
    ]);
    for (const key of linked) expect(rendered.has(key), key).toBe(true);
  });
});

describe("links to the top-up form", () => {
  it("every #record-topup link has a target on the Spend tab", () => {
    const spend = readFileSync("src/routes/admin/ai/spend.tsx", "utf8");
    expect(spend).toContain('id="record-topup"');

    for (const file of ["src/components/admin/shell.tsx", "src/routes/admin/ai/index.tsx"]) {
      const source = readFileSync(file, "utf8");
      // Each hash link must point at the Spend tab, the only page with the form.
      const hashLinks = source.match(/<Link[^>]*hash="record-topup"[^>]*>/g) ?? [];
      expect(hashLinks.length, file).toBeGreaterThan(0);
      for (const link of hashLinks) expect(link, file).toContain('to="/admin/ai/spend"');
    }
  });
});
