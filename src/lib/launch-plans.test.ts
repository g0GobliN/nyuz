import { describe, expect, it, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { PLAN_LIMITS, PLAN_TIERS } from "./plans";
import { planFeatures, PLAN_CARDS } from "./plan-copy";
import { capFor } from "./density";
import { assertTopicAddition, validatePlanPreferences } from "./server/plan-access";
import { installId } from "./device-install";
import { selectItems, type MatchRow } from "./pipeline/digest";
import { alertDeliveryAllowed } from "./pipeline/alert-entitlement";
import { FakeDb, asDb } from "./test-support/fake-db";

afterEach(() => vi.unstubAllGlobals());
it("keeps generated database values identical to the canonical definition", () => {
  expect(() =>
    execFileSync(process.execPath, ["scripts/launch-plans.mjs", "--check"]),
  ).not.toThrow();
});
describe.each(PLAN_TIERS)("%s launch plan", (plan) => {
  const p = PLAN_LIMITS[plan];
  it("rejects over-limit topic additions while accepting retained and reduced lists", () => {
    const existing = Array.from({ length: p.topics + 2 }, (_, i) => String(i));
    expect(() => assertTopicAddition(plan, existing, new Set(existing))).not.toThrow();
    expect(() => assertTopicAddition(plan, existing.slice(1), new Set(existing))).not.toThrow();
    expect(() => assertTopicAddition(plan, [...existing, "new"], new Set(existing))).toThrow(
      "topic limit",
    );
  });
  it("caps selection before generation without padding or lowering freshness", () => {
    const now = new Date("2026-09-12T09:00:00Z");
    const fresh: MatchRow[] = Array.from({ length: 40 }, (_, i) => ({
      eventId: String(i),
      relevance: 9,
      matchedAt: now.toISOString(),
      eventAt: now.toISOString(),
      importance: 8,
      novelty: 8,
      materialRevision: 0,
      deliveredRevision: 0,
    }));
    for (const density of [0, 35, 65, 100]) {
      const cap = capFor(density, plan);
      expect(selectItems(fresh, new Map(), cap, now)).toHaveLength(p.storiesPerBriefing);
      expect(selectItems(fresh.slice(0, 3), new Map(), cap, now)).toHaveLength(3);
      expect(
        selectItems(
          fresh.map((m) => ({ ...m, eventAt: "2020-01-01T00:00:00Z" })),
          new Map(),
          cap,
          now,
        ),
      ).toHaveLength(0);
      expect(selectItems(fresh, new Map(fresh.map((m) => [m.eventId, 0])), cap, now)).toHaveLength(
        0,
      );
    }
  });
  it("shares all pricing features with billing and canonical limits", () => {
    expect(PLAN_CARDS.find((c) => c.id === plan)?.features).toEqual(planFeatures(plan));
    expect(planFeatures(plan).join(" ")).toContain(`Up to ${p.storiesPerBriefing} stories`);
    expect(planFeatures(plan).join(" ")).not.toMatch(
      /unlimited|pro-quality|translation|story ask/i,
    );
    expect(planFeatures(plan).some((f) => f.includes("Telegram"))).toBe(p.telegram);
  });
  it("validates direct capability requests", () => {
    expect(() =>
      validatePlanPreferences(plan, { time: "07:30", frequency: "daily" }),
    ).not.toThrow();
    if (!p.customDeliveryTime)
      expect(() => validatePlanPreferences(plan, { time: "09:00" })).toThrow();
    else expect(() => validatePlanPreferences(plan, { time: "09:00" })).not.toThrow();
    const channels = { email: true, push: true, telegram: true, whatsapp: false };
    if (!p.telegram) expect(() => validatePlanPreferences(plan, { channels })).toThrow();
    else expect(() => validatePlanPreferences(plan, { channels })).not.toThrow();
    expect(() => validatePlanPreferences(plan, { frequency: "weekly" })).toThrow();
  });
});
it("uses a stable generated installation ID across refreshes", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  expect(installId()).toBe(installId());
  expect(storage.size).toBe(1);
});
it("rechecks queued alert eligibility after a downgrade", async () => {
  const now = new Date("2026-09-12T09:00:00Z");
  const db = asDb(
    new FakeDb({
      digest_items: [{ digest_id: "d", event_id: "second" }],
      alert_claims: [
        { user_id: "u", event_id: "first", created_at: "2026-09-12T08:00:00Z" },
        { user_id: "u", event_id: "second", created_at: "2026-09-12T08:30:00Z" },
      ],
    }),
  );
  expect(await alertDeliveryAllowed(db, "u", "d", "plura", now)).toBe(true);
  expect(await alertDeliveryAllowed(db, "u", "d", "uno", now)).toBe(false);
});
