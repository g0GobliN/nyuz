import { afterEach, describe, expect, it, vi } from "vitest";
import { changeStripeSubscriptionPrice } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("paid plan changes", () => {
  it("updates the existing subscription item instead of creating Checkout", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "sub_existing",
            customer: "cus_one",
            status: "active",
            livemode: true,
            items: { data: [{ id: "si_existing", price: { id: "price_pro" } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await changeStripeSubscriptionPrice({
      subscriptionId: "sub_existing",
      itemId: "si_existing",
      priceId: "price_pro",
      userId: "00000000-0000-0000-0000-000000000001",
      env: { STRIPE_SECRET_KEY: "sk_test_not_real" },
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_existing");
    expect(String(init?.body)).toContain("items%5B0%5D%5Bid%5D=si_existing");
    expect(String(init?.body)).toContain("items%5B0%5D%5Bprice%5D=price_pro");
    expect(String(init?.body)).toContain("payment_behavior=pending_if_incomplete");
  });
});
