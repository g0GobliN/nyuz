/**
 * The two Stripe calls nyuz makes outbound: start a checkout, open the portal.
 *
 * Plain `fetch` against the REST API rather than the `stripe` SDK, for the same
 * reason the webhook verifier is hand-rolled — the runtime is Cloudflare
 * Workers, which has no Node built-ins, and this is two POSTs.
 *
 * Stripe's API takes form encoding, not JSON, including for nested structures.
 * `encodeForm` below is the whole of that translation.
 */

export type StripeApiEnv = {
  STRIPE_SECRET_KEY?: string;
};

function readKey(env?: StripeApiEnv): string {
  const proc = globalThis.process?.env;
  const key = env?.STRIPE_SECRET_KEY ?? proc?.["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY. In production set it with `wrangler secret put STRIPE_SECRET_KEY`.",
    );
  }
  return key;
}

/**
 * Flattens to Stripe's bracket notation: `{a: {b: 1}}` becomes `a[b]=1`.
 *
 * Undefined and null values are dropped rather than sent as the strings
 * "undefined" and "null", which Stripe would accept and store verbatim.
 */
function encodeForm(input: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          parts.push(...encodeForm(item as Record<string, unknown>, `${name}[${index}]`));
        } else {
          parts.push(
            `${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`,
          );
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts;
}

export type StripeApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  env?: StripeApiEnv,
): Promise<StripeApiResult<T>> {
  let key: string;
  try {
    key = readKey(env);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm(body).join("&"),
    });
  } catch (error) {
    return { ok: false, error: `Network error: ${(error as Error).message}` };
  }

  const json = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;

  if (!response.ok || !json) {
    return {
      ok: false,
      error: json?.error?.message ?? `Stripe returned ${response.status}`,
    };
  }

  return { ok: true, data: json };
}

/* ---------------------------------------------------------------------- */
/* Checkout                                                                */
/* ---------------------------------------------------------------------- */

export type CheckoutInput = {
  priceId: string;
  userId: string;
  email: string;
  /** Set once the reader has paid before, so Stripe reuses the same customer. */
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
  env?: StripeApiEnv;
};

/**
 * Starts a subscription checkout and returns the URL to send the reader to.
 *
 * `client_reference_id` carries the nyuz user id through to the webhook. It is
 * the ONLY thing that links a Stripe customer back to an account —
 * `checkout.session.completed` is where that link is recorded, and without this
 * field the payment succeeds and the plan never applies.
 *
 * The same id is duplicated onto the subscription's metadata because a session
 * is short-lived: months later, when a renewal or a cancellation arrives, the
 * session is long gone but the subscription is still there.
 */
export async function createCheckoutSession({
  priceId,
  userId,
  email,
  customerId,
  successUrl,
  cancelUrl,
  env,
}: CheckoutInput): Promise<StripeApiResult<{ id: string; url: string }>> {
  return post<{ id: string; url: string }>(
    "checkout/sessions",
    {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      // Reuse the existing customer when there is one; otherwise let Stripe
      // create it against this address. Sending both is an error.
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      subscription_data: { metadata: { user_id: userId } },
      // Cheap to allow and impossible to add later without a code change.
      allow_promotion_codes: true,
    },
    env,
  );
}

/* ---------------------------------------------------------------------- */
/* Billing portal                                                          */
/* ---------------------------------------------------------------------- */

/**
 * Opens Stripe's hosted portal, which is where cancelling, resuming and
 * changing a card actually happen.
 *
 * Building those screens ourselves would mean handling proration, dunning and
 * card authentication — and every one of them is a place to get billing wrong.
 * The portal emits the same webhooks either way, so a cancellation there still
 * sends our own cancellation email.
 */
export async function createPortalSession({
  customerId,
  returnUrl,
  env,
}: {
  customerId: string;
  returnUrl: string;
  env?: StripeApiEnv;
}): Promise<StripeApiResult<{ id: string; url: string }>> {
  return post<{ id: string; url: string }>(
    "billing_portal/sessions",
    { customer: customerId, return_url: returnUrl },
    env,
  );
}
