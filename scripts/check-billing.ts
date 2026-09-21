import { priceIdFor } from "../src/lib/server/stripe/prices";
import { retrieveStripePrice, stripePriceMatches } from "../src/lib/server/stripe/api";
import { DEFAULT_PLAN_PRICES, DEFAULT_ANNUAL_PRICES } from "../src/lib/plans";

/**
 * Read-only: no checkout, charges, customer records, or secret values in output.
 *
 * The mode is taken from the key rather than assumed to be live. A test key
 * cannot read a live price at all — Stripe answers "No such price" — so a check
 * that always demanded live mode reported a correctly configured test
 * environment as broken, and the timing was the worst possible: mid-checkout,
 * where the obvious conclusion is that the code is wrong.
 *
 * Strictness is kept where it matters. A live key still requires live prices,
 * because a test-mode price in production is a checkout that charges nobody.
 * An unreadable or missing key stays strict too: only a positive `sk_test_`
 * prefix relaxes the rule.
 */
const secret = process.env["STRIPE_SECRET_KEY"]?.trim() ?? "";
const mode = secret.startsWith("sk_live_")
  ? "live"
  : secret.startsWith("sk_test_")
    ? "test"
    : "unknown";
const requireLive = mode !== "test";

let failed = false;
console.log(`key mode: ${mode}; prices must be ${requireLive ? "live" : "test"} mode`);

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
        `${plan}/${interval}: could not read configured price. Check Stripe credentials and the price id — a ${mode === "test" ? "live" : "test"}-mode id here reads as "No such price".`,
      );
      failed = true;
      continue;
    }
    const valid = stripePriceMatches(price.data, { cents: expected, interval, requireLive });
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
    "Old PERSONAL/PRO price variables are present but are not read. Rename them to PLURA/OMNI; old price ids are not interchangeable.",
  );
}
process.exitCode = failed ? 1 : 0;
