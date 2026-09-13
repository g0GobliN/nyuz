import { priceIdFor } from "../src/lib/server/stripe/prices";
import { retrieveStripePrice, stripePriceMatches } from "../src/lib/server/stripe/api";
import { DEFAULT_PLAN_PRICES, DEFAULT_ANNUAL_PRICES } from "../src/lib/plans";

// Read-only: no checkout, charges, customer records, or secret values in output.
let failed = false;
for (const plan of ["plura", "omni"] as const) {
  for (const interval of ["month", "year"] as const) {
    const id = priceIdFor(plan, interval);
    const expected = Math.round(
      (interval === "month" ? DEFAULT_PLAN_PRICES[plan] : DEFAULT_ANNUAL_PRICES[plan]) * 100,
    );
    if (!id) {
      console.error(
        `${plan}/${interval}: missing STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "ANNUAL"}`,
      );
      failed = true;
      continue;
    }
    const price = await retrieveStripePrice(id);
    if (!price.ok) {
      console.error(
        `${plan}/${interval}: could not read configured price. Check Stripe credentials and price ID.`,
      );
      failed = true;
      continue;
    }
    const valid = stripePriceMatches(price.data, { cents: expected, interval, requireLive: true });
    console.log(
      `${plan}/${interval}: ${valid ? "OK" : "INVALID"}; active=${price.data.active}, live=${price.data.livemode}, amount=${price.data.unit_amount}, currency=${price.data.currency}; expected ${expected} USD cents/${interval}`,
    );
    failed ||= !valid;
  }
}
for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "VITE_SITE_URL"]) {
  if (!process.env[name]?.trim()) {
    console.error(`${name}: missing`);
    failed = true;
  }
}
if (Object.keys(process.env).some((key) => /^STRIPE_PRICE_(PERSONAL|PRO)_/.test(key))) {
  console.warn(
    "Old PERSONAL/PRO price variables are present. Configure PLURA/OMNI with current live prices; old prices are not interchangeable.",
  );
}
process.exitCode = failed ? 1 : 0;
