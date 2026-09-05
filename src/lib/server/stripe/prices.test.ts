import { describe, expect, it } from "vitest";
import { priceCatalogueConfigured, priceIdFor, resolvePrice, type PriceEnv } from "./prices";
import { stripePriceMatches, type StripePrice } from "./api";

/**
 * Grandfathering (docs/plan2.md §61).
 *
 * Repricing means creating **new** Stripe price objects, never editing old
 * ones — an existing subscription keeps billing against the object it was
 * created with. So the catalogue has to do two contradictory-looking things
 * at once: keep honouring a price nobody can buy any more, and refuse to sell
 * it to anyone new.
 *
 * Getting this wrong is not a cosmetic failure. If a legacy price stops
 * resolving, every existing subscriber silently loses their plan at the next
 * webhook — which is exactly the "no surprise charges, no accidental
 * downgrades" property §61 exists to protect.
 */

const env: PriceEnv = {
  STRIPE_PRICE_PLURA_MONTHLY: "price_new_plura_m",
  STRIPE_PRICE_OMNI_MONTHLY: "price_new_omni_m",
  STRIPE_PRICE_PLURA_MONTHLY_LEGACY: "price_old_plura_m",
  STRIPE_PRICE_OMNI_MONTHLY_LEGACY: "price_old_omni_m",
};

describe("grandfathered prices", () => {
  it("still grants the plan for a price that is no longer sold", () => {
    // The subscriber on the old $7 price keeps Plura.
    const resolved = resolvePrice("price_old_plura_m", 700, env);
    expect(resolved?.plan).toBe("plura");
    expect(resolved?.interval).toBe("month");
  });

  it("never offers a legacy price at checkout", () => {
    // Somebody signing up today gets the current price, not the old one.
    expect(priceIdFor("plura", "month", env)).toBe("price_new_plura_m");
    expect(priceIdFor("omni", "month", env)).toBe("price_new_omni_m");
  });

  it("keeps the label the charge actually carried, not the current one", () => {
    // The receipt says what was billed. A subscriber on the old price being
    // shown the new one would be a lie about their own invoice.
    expect(resolvePrice("price_old_plura_m", 700, env)?.label).toBe("$7 / month");
    expect(resolvePrice("price_new_plura_m", 1499, env)?.label).toBe("$14.99 / month");
  });

  it("does not report a legacy-only catalogue as configured", () => {
    // Nothing here can start a checkout. Saying "configured" would turn a
    // misconfiguration into a silent one.
    const legacyOnly: PriceEnv = { STRIPE_PRICE_PLURA_MONTHLY_LEGACY: "price_old" };
    expect(priceCatalogueConfigured(legacyOnly)).toBe(false);
    expect(priceCatalogueConfigured(env)).toBe(true);
  });

  it("still returns null for a price belonging to another product", () => {
    // The Stripe account is shared. An unmatched price is ignored, not
    // trusted — unchanged by grandfathering.
    expect(resolvePrice("price_someone_elses", 500, env)).toBeNull();
  });

  it("returns null rather than a wrong plan when an interval is unconfigured", () => {
    // Annual is not set in this env. Refusing is correct; falling back to the
    // monthly id would charge the wrong amount.
    expect(priceIdFor("plura", "year", env)).toBeNull();
  });
});

describe("checkout price validation", () => {
  const price: StripePrice = {
    active: true,
    currency: "usd",
    livemode: true,
    type: "recurring",
    unit_amount: 1499,
    recurring: { interval: "month", interval_count: 1 },
  };

  it("accepts only the exact active catalogue price", () => {
    expect(stripePriceMatches(price, { cents: 1499, interval: "month", requireLive: true })).toBe(
      true,
    );
    for (const changed of [
      { ...price, active: false },
      { ...price, currency: "jpy" },
      { ...price, unit_amount: 700 },
      { ...price, recurring: { interval: "year", interval_count: 1 } },
    ]) {
      expect(
        stripePriceMatches(changed, { cents: 1499, interval: "month", requireLive: true }),
      ).toBe(false);
    }
  });

  it("refuses test-mode prices on a public deployment", () => {
    const testPrice = { ...price, livemode: false };
    expect(
      stripePriceMatches(testPrice, { cents: 1499, interval: "month", requireLive: true }),
    ).toBe(false);
    expect(
      stripePriceMatches(testPrice, { cents: 1499, interval: "month", requireLive: false }),
    ).toBe(true);
  });
});
