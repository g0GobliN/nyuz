import { describe, expect, it } from "vitest";
import { modeMatches } from "./webhook";
import type { StripeEvent } from "./signature";

function event(livemode?: boolean): StripeEvent {
  return {
    id: "evt_1",
    type: "customer.subscription.created",
    created: 1_788_000_000,
    ...(livemode === undefined ? {} : { livemode }),
    data: { object: {} },
  };
}

const LIVE = { STRIPE_SECRET_KEY: "sk_live_not_a_real_key" };
const TEST = { STRIPE_SECRET_KEY: "sk_test_not_a_real_key" };

describe("modeMatches", () => {
  it("refuses a test-mode event on a live deployment", () => {
    // The bug this pins: a test-mode subscription event, which anyone with the
    // test dashboard can create for free, used to grant a real reader a paid
    // plan. It is genuinely signed, so the signature check cannot catch it.
    expect(modeMatches(event(false), LIVE)).toBe(false);
  });

  it("refuses a live event on a test deployment", () => {
    expect(modeMatches(event(true), TEST)).toBe(false);
  });

  it("accepts an event from the mode the secret key belongs to", () => {
    expect(modeMatches(event(true), LIVE)).toBe(true);
    expect(modeMatches(event(false), TEST)).toBe(true);
  });

  it("accepts a payload that does not carry livemode at all", () => {
    // Older payloads and hand-rolled replays. Refusing these would break a
    // legitimate redelivery to gain nothing.
    expect(modeMatches(event(undefined), LIVE)).toBe(true);
  });

  it("does not guess when no secret key is configured", () => {
    expect(modeMatches(event(false), {})).toBe(true);
  });
});
