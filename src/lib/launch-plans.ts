/** Canonical V1 entitlements. SQL is generated from this module by scripts/launch-plans.mjs. */
export const LAUNCH_PLANS = {
  uno: {
    monthly: 0,
    annual: 0,
    topics: 3,
    prioritySources: 3,
    customSources: 0,
    storiesPerBriefing: 5,
    briefingsPerDay: 2,
    customDeliveryTime: false,
    alertDailyCap: 1,
    devices: 1,
    retentionDays: 7,
    email: true,
    push: true,
    telegram: false,
    notificationControl: "basic",
    topicKeywords: 4,
  },
  plura: {
    monthly: 14.99,
    annual: 149.9,
    topics: 15,
    prioritySources: 15,
    customSources: 8,
    storiesPerBriefing: 15,
    briefingsPerDay: 2,
    customDeliveryTime: true,
    alertDailyCap: 5,
    devices: 3,
    retentionDays: 90,
    email: true,
    push: true,
    telegram: true,
    notificationControl: "standard",
    topicKeywords: 50,
  },
  omni: {
    monthly: 29.99,
    annual: 299.9,
    topics: 30,
    prioritySources: 30,
    customSources: 20,
    storiesPerBriefing: 25,
    briefingsPerDay: 2,
    customDeliveryTime: true,
    alertDailyCap: 12,
    devices: 10,
    retentionDays: 365,
    email: true,
    push: true,
    telegram: true,
    notificationControl: "advanced",
    topicKeywords: 100,
  },
} as const;

/**
 * The morning slot, in the reader's own zone. Every tier gets it; a tier with
 * `customDeliveryTime` may move it, and `deliveryTimesFor` in
 * `briefing-slots.ts` is the only place that decision is made.
 *
 * Owner ruling, 2026-10-30: "change 7:30 to 9:30 and 20:30 to 16:30 thats all
 * permanently everyday." 07:30 is therefore no longer a default here, and no
 * literal `07:30` remains anywhere in scheduling.
 */
export const STANDARD_DELIVERY_TIME = "09:30";

/** The evening slot, fixed for every reader on every tier. */
export const EVENING_DELIVERY_TIME = "16:30";

/**
 * A reader's day, as clock times in their own zone. Order is the order of the
 * day, so the first element is always the morning edition.
 */
export const BRIEFING_SLOTS = [STANDARD_DELIVERY_TIME, EVENING_DELIVERY_TIME] as const;
