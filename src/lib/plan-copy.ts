import { PLAN_LIMITS, PLAN_NAMES, PLAN_TIERS } from "./plans";
import type { PlanTier } from "./supabase/types";

const DESCRIPTIONS = {
  uno: "Start every morning knowing what matters.",
  plura: "More coverage, more control.",
  omni: "For people who need to know first.",
};
export function planFeatures(tier: PlanTier): string[] {
  const p = PLAN_LIMITS[tier];
  return [
    `${p.topics} topics + ${p.prioritySources} priority sources`,
    `Up to ${p.storiesPerBriefing} stories per briefing`,
    ...(p.customDeliveryTime ? ["Custom delivery time"] : []),
    `Email + push${p.telegram ? " + Telegram" : ""}`,
    `${p.alertDailyCap} important alert${p.alertDailyCap === 1 ? "" : "s"}/day`,
    ...(p.customSources ? [`${p.customSources} custom sources`] : []),
    `${p.devices} device${p.devices === 1 ? "" : "s"}`,
    p.retention,
    ...(p.notificationControl === "advanced" ? ["Per-topic alert control"] : []),
  ];
}
export const PLAN_CARDS = PLAN_TIERS.map((tier) => ({
  id: tier,
  priceKey: tier,
  name: PLAN_NAMES[tier],
  ...PLAN_LIMITS[tier],
  tagline: DESCRIPTIONS[tier],
  features: planFeatures(tier),
  cta: tier === "uno" ? "Start free" : tier === "plura" ? "Choose Plura" : "Choose Omni",
  popular: tier === "plura",
}));
