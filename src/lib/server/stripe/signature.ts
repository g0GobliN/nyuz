/**
 * Stripe webhook signature verification, on Web Crypto.
 *
 * The `stripe` SDK's `constructEvent` uses Node's `crypto`, which does not exist
 * on Cloudflare Workers. `constructEventAsync` with a custom provider would work,
 * but the whole algorithm is one HMAC and a timestamp check, and pulling in the
 * SDK to reach it would put a large Node-shaped dependency on the one route that
 * must never fail to load.
 *
 * This is the entire trust boundary for billing. An unverified webhook body is
 * an attacker telling you which of your users just paid.
 */

export type VerifyResult = { ok: true; event: StripeEvent } | { ok: false; reason: string };

/** Only the shape this codebase actually reads. Stripe events carry far more. */
export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * Stripe's tolerance for clock skew, in seconds.
 *
 * The timestamp check is what stops a replay: without it, a body and signature
 * captured once stay valid for ever. Five minutes is Stripe's own default.
 */
const TOLERANCE_SECONDS = 300;

/**
 * Parses `t=...,v1=...,v1=...`.
 *
 * More than one `v1` is normal and not an error — it is what a rolled signing
 * secret looks like while both are live. Any one of them matching is a pass.
 */
function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }

  return { timestamp, signatures };
}

/** Lowercase hex, which is the form Stripe sends. */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares in time independent of where the first difference is.
 *
 * A `===` here leaks the length of the matching prefix through timing, which is
 * enough to forge a signature one character at a time given enough attempts.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifies a webhook and returns the parsed event.
 *
 * `payload` must be the EXACT bytes Stripe sent — read the body as text and pass
 * that string. Parsing to JSON and re-serialising changes key order and
 * whitespace, and the signature is over the raw body, so it will never match.
 */
export async function verifyStripeSignature({
  payload,
  header,
  secret,
  now = Date.now(),
}: {
  payload: string;
  header: string | null;
  secret: string;
  now?: number;
}): Promise<VerifyResult> {
  if (!header) return { ok: false, reason: "Missing Stripe-Signature header" };
  if (!secret) return { ok: false, reason: "Missing webhook signing secret" };

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!timestamp || signatures.length === 0) {
    return { ok: false, reason: "Malformed Stripe-Signature header" };
  }

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "Malformed timestamp" };

  const ageSeconds = Math.abs(now / 1000 - sent);
  if (ageSeconds > TOLERANCE_SECONDS) {
    return { ok: false, reason: `Timestamp outside tolerance (${Math.round(ageSeconds)}s)` };
  }

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
  const expected = toHex(mac);

  if (!signatures.some((candidate) => timingSafeEqual(candidate, expected))) {
    return { ok: false, reason: "Signature mismatch" };
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return { ok: false, reason: "Body is not JSON" };
  }

  if (!event?.id || !event?.type) return { ok: false, reason: "Event missing id or type" };

  return { ok: true, event };
}
