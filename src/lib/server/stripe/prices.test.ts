import { describe, expect, it } from "vitest";
import { priceCatalogueConfigured, priceIdFor, resolvePrice, type PriceEnv } from "./prices";

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
  STRIPE_PRICE_PERSONAL_MONTHLY: "price_new_personal_m",
  STRIPE_PRICE_PRO_MONTHLY: "price_new_pro_m",
  STRIPE_PRICE_PERSONAL_MONTHLY_LEGACY: "price_old_personal_m",
  STRIPE_PRICE_PRO_MONTHLY_LEGACY: "price_old_pro_m",
};

describe("grandfathered prices", () => {
  it("still grants the plan for a price that is no longer sold", () => {
    // The subscriber on the old $7 price keeps Personal.
    const resolved = resolvePrice("price_old_personal_m", 700, env);
    expect(resolved?.plan).toBe("personal");
    expect(resolved?.interval).toBe("month");
  });

  it("never offers a legacy price at checkout", () => {
    // Somebody signing up today gets the current price, not the old one.
    expect(priceIdFor("personal", "month", env)).toBe("price_new_personal_m");
    expect(priceIdFor("pro", "month", env)).toBe("price_new_pro_m");
  });

  it("keeps the label the charge actually carried, not the current one", () => {
    // The receipt says what was billed. A subscriber on the old price being
    // shown the new one would be a lie about their own invoice.
    expect(resolvePrice("price_old_personal_m", 700, env)?.label).toBe("$7 / month");
    expect(resolvePrice("price_new_personal_m", 1900, env)?.label).toBe("$19 / month");
  });

  it("does not report a legacy-only catalogue as configured", () => {
    // Nothing here can start a checkout. Saying "configured" would turn a
    // misconfiguration into a silent one.
    const legacyOnly: PriceEnv = { STRIPE_PRICE_PERSONAL_MONTHLY_LEGACY: "price_old" };
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
    expect(priceIdFor("personal", "year", env)).toBeNull();
  });
});
