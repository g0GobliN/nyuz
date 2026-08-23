import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "@/lib/server/stripe/signature";

/**
 * This is the whole trust boundary for billing: anything that gets past it is
 * treated as Stripe telling us a customer paid. The cases below are the ones
 * where a plausible-looking implementation is still forgeable.
 */

const SECRET = "whsec_test_secret";

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

const BODY = JSON.stringify({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: { object: { customer: "cus_1" } },
});

const NOW = 1_800_000_000_000;
const NOW_SECONDS = NOW / 1000;

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed body", async () => {
    const header = await sign(BODY, NOW_SECONDS);
    const result = await verifyStripeSignature({ payload: BODY, header, secret: SECRET, now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.id).toBe("evt_1");
      expect(result.event.type).toBe("customer.subscription.updated");
    }
  });

  it("rejects a body altered after signing", async () => {
    const header = await sign(BODY, NOW_SECONDS);
    const tampered = BODY.replace("cus_1", "cus_attacker");
    const result = await verifyStripeSignature({
      payload: tampered,
      header,
      secret: SECRET,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const header = await sign(BODY, NOW_SECONDS, "whsec_someone_elses");
    const result = await verifyStripeSignature({ payload: BODY, header, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
  });

  it("rejects a replay of a genuine old request", async () => {
    // Without the timestamp check a captured body and header stay valid for
    // ever, which turns one observed webhook into a permanent forgery.
    const header = await sign(BODY, NOW_SECONDS - 3600);
    const result = await verifyStripeSignature({ payload: BODY, header, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tolerance/);
  });

  it("accepts a second valid signature while a secret is being rolled", async () => {
    // Stripe sends several v1 values during a secret rotation. Reading only the
    // first would fail every webhook for the length of the rollover.
    const good = await sign(BODY, NOW_SECONDS);
    const header = `${good.replace(`t=${NOW_SECONDS},`, `t=${NOW_SECONDS},v1=deadbeef,`)}`;
    const result = await verifyStripeSignature({ payload: BODY, header, secret: SECRET, now: NOW });

    expect(result.ok).toBe(true);
  });

  it("rejects a missing or malformed header rather than throwing", async () => {
    for (const header of [null, "", "nonsense", "t=abc,v1=xyz"]) {
      const result = await verifyStripeSignature({
        payload: BODY,
        header,
        secret: SECRET,
        now: NOW,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects when no signing secret is configured", async () => {
    const header = await sign(BODY, NOW_SECONDS);
    const result = await verifyStripeSignature({ payload: BODY, header, secret: "", now: NOW });

    expect(result.ok).toBe(false);
  });

  it("rejects a verified body that is not JSON", async () => {
    const payload = "not json";
    const header = await sign(payload, NOW_SECONDS);
    const result = await verifyStripeSignature({ payload, header, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
  });
});
