import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  deletionDeadline,
  deletionRequiresCancellation,
} from "@/lib/account-deletion";

describe("account deletion billing gate", () => {
  it("blocks an attached subscription until cancellation is scheduled", () => {
    expect(
      deletionRequiresCancellation({
        stripe_subscription_id: "sub_live",
        cancel_at_period_end: false,
      }),
    ).toBe(true);
  });

  it("allows deletion after period-end cancellation is scheduled", () => {
    expect(
      deletionRequiresCancellation({
        stripe_subscription_id: "sub_cancelling",
        cancel_at_period_end: true,
      }),
    ).toBe(false);
  });

  it("allows an account with no Stripe subscription", () => {
    expect(
      deletionRequiresCancellation({
        stripe_subscription_id: null,
        cancel_at_period_end: false,
      }),
    ).toBe(false);
  });
});

describe("deletionDeadline", () => {
  it("lands the grace period exactly where the purge sweep will act", () => {
    const requested = "2026-09-09T08:30:00.000Z";
    const deadline = deletionDeadline(requested);
    expect(deadline.toISOString()).toBe("2026-10-09T08:30:00.000Z");
    expect(deadline.getTime() - new Date(requested).getTime()).toBe(
      ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it("accepts a Date as readily as the timestamp the RPC returns", () => {
    expect(deletionDeadline(new Date("2026-01-31T00:00:00.000Z")).toISOString()).toBe(
      "2026-03-02T00:00:00.000Z",
    );
  });
});
