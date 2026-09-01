import type { PlanTier } from "@/lib/supabase/types";

export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "canceled"
  | "paused";

const PAID_STATUSES = new Set<StripeSubscriptionStatus>(["active", "trialing", "past_due"]);

export function normalizeSubscriptionStatus(status: string | null): StripeSubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "canceled":
    case "paused":
      return status;
    default:
      return "incomplete";
  }
}

/** Past-due is the deliberate Stripe retry grace period; terminal states are Free. */
export function entitlementPlan(
  purchasedPlan: Exclude<PlanTier, "free">,
  status: string | null,
): PlanTier {
  return PAID_STATUSES.has(normalizeSubscriptionStatus(status)) ? purchasedPlan : "free";
}

export function canChangePaidSubscription(status: string | null): boolean {
  return PAID_STATUSES.has(normalizeSubscriptionStatus(status));
}

/** Only a subscription that currently has paid access may enter retry grace. */
export function canEnterPaymentGrace(status: string | null): boolean {
  return PAID_STATUSES.has(normalizeSubscriptionStatus(status));
}

export function shouldApplySubscriptionEvent(input: {
  storedSubscriptionId: string | null;
  retiredSubscriptionId?: string | null;
  incomingSubscriptionId: string | null;
  storedEventCreatedAt: string | null;
  incomingEventCreatedAt: Date;
}): boolean {
  if (!input.incomingSubscriptionId) return false;
  if (!input.storedSubscriptionId && input.retiredSubscriptionId === input.incomingSubscriptionId) {
    return false;
  }
  if (input.storedSubscriptionId && input.storedSubscriptionId !== input.incomingSubscriptionId) {
    return false;
  }
  if (!input.storedEventCreatedAt) return true;
  return input.incomingEventCreatedAt.getTime() >= new Date(input.storedEventCreatedAt).getTime();
}
