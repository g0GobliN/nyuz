import { envValue } from "@/lib/runtime-env";
import type { Email } from "@/lib/email/shell";

/**
 * Resend transport.
 *
 * Server-only: it holds an API key that can send mail as your domain, so this
 * module must never be imported from a component or anything reachable from
 * client code.
 *
 * Plain `fetch` rather than the `resend` SDK. The runtime target is Cloudflare
 * Workers, which has no Node built-ins, and the whole of this API is one POST —
 * a dependency that might reach for `http` or `stream` buys nothing here.
 */

export type EmailEnv = {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  VITE_SITE_URL?: string;
  EMAIL_UNSUBSCRIBE_SECRET?: string;
};

/**
 * On Workers there is no ambient `process.env` at module scope, so config is
 * read per call from whatever env the request hands us rather than captured at
 * import time. Same reasoning as `createAdminClient`.
 */
function readEnv(env?: EmailEnv): { apiKey: string; from: string } {
  const apiKey = envValue("RESEND_API_KEY", env);
  const from = envValue("RESEND_FROM_EMAIL", env);

  if (!apiKey) {
    throw new Error(
      "Missing RESEND_API_KEY. In production set it with `wrangler secret put RESEND_API_KEY`.",
    );
  }
  if (!from) throw new Error("Missing RESEND_FROM_EMAIL.");

  return { apiKey, from };
}

/**
 * The origin links in an email point at. Absolute, because email has no base.
 *
 * Throws rather than defaulting. This used to fall back to
 * `http://localhost:8080`, which is the one wrong answer that looks like a
 * working one: a briefing goes out, Resend accepts it, the delivery is recorded
 * as sent, and every link in the reader's inbox is dead. Nothing retries,
 * because nothing failed. The same value is also the return URL for Stripe
 * checkout, where a localhost redirect strands a reader who has just paid.
 *
 * `VITE_SITE_URL` is in `.env.example` and set in local `.env`, so the throw is
 * reachable only from a genuinely misconfigured deployment — which is exactly
 * when it should be loud.
 */
export function siteUrl(env?: EmailEnv): string {
  const configured = envValue("VITE_SITE_URL", env);
  if (!configured) {
    throw new Error(
      "Missing VITE_SITE_URL. Links in email and Stripe redirects are absolute and cannot be derived from the request.",
    );
  }
  return configured.replace(/\/+$/, "");
}

export type SendResult =
  { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

export type SendInput = {
  to: string;
  message: Email;
  /**
   * Unsubscribe destination for anything that is not strictly transactional.
   * Signed public endpoint used both by the message link and RFC 8058 clients.
   */
  unsubscribeUrl?: string | undefined;
  /**
   * Makes a retry safe. `deliveries` retries failed sends, and without this a
   * send that succeeded but whose response was lost would go out twice — the
   * one failure mode a reader definitely notices.
   */
  idempotencyKey?: string | undefined;
  env?: EmailEnv | undefined;
};

/**
 * Sends one message.
 *
 * Returns a result rather than throwing, because every caller is a pipeline
 * stage writing an outcome to `deliveries`. `retryable` separates "the network
 * blinked or Resend rate-limited us" from "that address is malformed" — retrying
 * the second forever is how a queue becomes a loop.
 */
export async function sendEmail({
  to,
  message,
  unsubscribeUrl,
  idempotencyKey,
  env,
}: SendInput): Promise<SendResult> {
  let apiKey: string;
  let from: string;
  try {
    ({ apiKey, from } = readEnv(env));
  } catch (error) {
    // Misconfiguration, not a transient fault. Retrying cannot fix it.
    return { ok: false, error: (error as Error).message, retryable: false };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };

  if (unsubscribeUrl) {
    body["headers"] = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: `Network error: ${(error as Error).message}`, retryable: true };
  }

  if (response.ok) {
    const json = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? "" };
  }

  const detail = await response.text().catch(() => "");
  return {
    ok: false,
    error: `Resend ${response.status}: ${detail.slice(0, 300)}`,
    // 429 and 5xx are worth another attempt; a 4xx about the payload is not.
    retryable: response.status === 429 || response.status >= 500,
  };
}
