import { describe, expect, it } from "vitest";
import {
  canEnterPaymentGrace,
  canChangePaidSubscription,
  entitlementPlan,
  shouldApplySubscriptionEvent,
} from "./entitlements";

describe("Stripe entitlement status", () => {
  it.each(["active", "trialing", "past_due"])("grants paid access for %s", (status) => {
    expect(entitlementPlan("omni", status)).toBe("omni");
    expect(canChangePaidSubscription(status)).toBe(true);
  });

  it.each(["unpaid", "incomplete", "incomplete_expired", "canceled", "paused"])(
    "revokes paid access for %s",
    (status) => {
      expect(entitlementPlan("plura", status)).toBe("uno");
      expect(canChangePaidSubscription(status)).toBe(false);
      expect(canEnterPaymentGrace(status)).toBe(false);
    },
  );

  it("restores access when payment recovers", () => {
    expect(entitlementPlan("plura", "past_due")).toBe("plura");
    expect(entitlementPlan("plura", "unpaid")).toBe("uno");
    expect(entitlementPlan("plura", "active")).toBe("plura");
  });

  it.each(["active", "trialing", "past_due"])("permits payment retry grace from %s", (status) => {
    expect(canEnterPaymentGrace(status)).toBe(true);
  });
});

describe("Stripe event ordering", () => {
  const now = new Date("2026-09-01T10:00:00Z");

  it("accepts the first event and newer events for the same subscription", () => {
    expect(
      shouldApplySubscriptionEvent({
        storedSubscriptionId: null,
        incomingSubscriptionId: "sub_current",
        storedEventCreatedAt: null,
        incomingEventCreatedAt: now,
      }),
    ).toBe(true);
    expect(
      shouldApplySubscriptionEvent({
        storedSubscriptionId: "sub_current",
        incomingSubscriptionId: "sub_current",
        storedEventCreatedAt: "2026-09-01T09:00:00Z",
        incomingEventCreatedAt: now,
      }),
    ).toBe(true);
  });

  it("rejects an obsolete subscription and an out-of-order event", () => {
    expect(
      shouldApplySubscriptionEvent({
        storedSubscriptionId: "sub_current",
        incomingSubscriptionId: "sub_old",
        storedEventCreatedAt: null,
        incomingEventCreatedAt: now,
      }),
    ).toBe(false);
    expect(
      shouldApplySubscriptionEvent({
        storedSubscriptionId: "sub_current",
        incomingSubscriptionId: "sub_current",
        storedEventCreatedAt: "2026-09-01T11:00:00Z",
        incomingEventCreatedAt: now,
      }),
    ).toBe(false);
  });

  it("never resurrects a subscription after its deletion event", () => {
    expect(
      shouldApplySubscriptionEvent({
        storedSubscriptionId: null,
        retiredSubscriptionId: "sub_deleted",
        incomingSubscriptionId: "sub_deleted",
        storedEventCreatedAt: "2026-09-01T10:00:00Z",
        incomingEventCreatedAt: now,
      }),
    ).toBe(false);
  });
});
