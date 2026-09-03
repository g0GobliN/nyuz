import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleStripeWebhook, type WebhookEnv } from "./lib/server/stripe/webhook";
import { handleTelegramWebhook, type TelegramWebhookEnv } from "./lib/server/telegram/webhook";
import { verifyUnsubscribeToken, type UnsubscribeEnv } from "./lib/server/email/unsubscribe";
import { createAdminClient, type ServerEnv } from "./lib/supabase/admin";
import { handleSitemap, type SitemapEnv } from "./lib/server/sitemap";
import { envValue } from "./lib/runtime-env";
import type { DeliveryChannel } from "./lib/supabase/types";

/**
 * Stripe posts here.
 *
 * Handled at the Worker entry rather than as a route because the signature is
 * computed over the exact bytes Stripe sent. Anything upstream that parses the
 * body and hands on a re-serialised copy — which is what a framework route does
 * — changes key order and whitespace, and the signature then never matches.
 *
 * It also has to sit in front of the CSRF middleware in src/start.ts: Stripe is
 * a third party by definition and carries no same-origin credentials.
 */
const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";
const UNSUBSCRIBE_PATH = "/api/unsubscribe";
const HEALTH_PATH = "/api/health";
// Served here rather than from public/: it lists blog posts, which are rows.
const SITEMAP_PATH = "/sitemap.xml";

type UnsubscribeServerEnv = ServerEnv & UnsubscribeEnv;
type HealthEnv = ServerEnv & { HEALTHCHECK_TOKEN?: string };

function unsubscribePage(message: string, status = 200): Response {
  const safe = message.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — nyuz</title></head><body><main><h1>${safe}</h1><p>You can change all notification channels from Delivery settings after signing in.</p></main></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

async function handleUnsubscribe(request: Request, env?: UnsubscribeServerEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = await verifyUnsubscribeToken(token, env);
  if (!userId) return unsubscribePage("This unsubscribe link is invalid or expired.", 400);

  const db = createAdminClient(env);
  const { data, error } = await db
    .from("notification_preferences")
    .select("channels")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`reading unsubscribe preferences: ${error.message}`);
  if (!data) return unsubscribePage("Email briefings are already unsubscribed.");

  const channels = (data.channels as DeliveryChannel[]).filter((channel) => channel !== "email");
  const { error: updateError } = await db
    .from("notification_preferences")
    .update({ channels })
    .eq("user_id", userId);
  if (updateError) throw new Error(`saving unsubscribe preferences: ${updateError.message}`);
  return unsubscribePage("You have been unsubscribed from email briefings.");
}

async function handleHealth(request: Request, env?: HealthEnv): Promise<Response> {
  const expected = envValue("HEALTHCHECK_TOKEN", env);
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("token");
  if (!expected || supplied !== expected) return new Response("Not found", { status: 404 });

  const db = createAdminClient(env);
  const [{ data, error }, { count: failedDeliveries, error: deliveryError }] = await Promise.all([
    db
      .from("ops_status")
      .select("key, status, detail, updated_at")
      .order("updated_at", { ascending: false }),
    db.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 503 });
  if (deliveryError)
    return Response.json({ ok: false, error: deliveryError.message }, { status: 503 });
  const heartbeat = data?.find((row) => row.key === "cron:heartbeat");
  const stale = !heartbeat || Date.parse(heartbeat.updated_at) < Date.now() - 45 * 60_000;
  const unhealthy = (data ?? []).some(
    (row) => row.status !== "healthy" && row.key !== "delivery:failure",
  );
  const ok = !stale && !unhealthy && (failedDeliveries ?? 0) === 0;
  return Response.json(
    { ok, heartbeat_stale: stale, failed_deliveries: failedDeliveries ?? 0, statuses: data ?? [] },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
];

const CONTENT_SECURITY_POLICY = [...CSP_DIRECTIVES, "upgrade-insecure-requests"].join("; ");

/**
 * The same policy without the transport upgrade, for a request that arrived
 * over plain HTTP.
 *
 * `upgrade-insecure-requests` rewrites every subresource URL to https://, and
 * on a dev server nothing is listening for TLS on the port — so the document
 * arrives and its stylesheet does not, leaving unstyled HTML. Chrome exempts
 * localhost from the upgrade because a loopback origin is trustworthy, which is
 * why this is invisible until the site is opened from another device at
 * http://<lan-ip>:8080. HSTS is dropped for the same reason: pinning a bare
 * LAN IP to HTTPS in a phone's browser outlives the dev session.
 *
 * Nothing changes in production. Cloudflare terminates TLS and hands the Worker
 * an https:// request URL, so the deployed site always takes the branch above.
 */
const CONTENT_SECURITY_POLICY_INSECURE = CSP_DIRECTIVES.join("; ");

function secureResponse(request: Request, response: Response): Response {
  const secured = new Response(response.body, response);
  const https = new URL(request.url).protocol === "https:";
  secured.headers.set(
    "Content-Security-Policy",
    https ? CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY_INSECURE,
  );
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  if (https) {
    secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  const path = new URL(request.url).pathname;
  if (
    path.startsWith("/_serverFn/") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/admin") ||
    path === "/auth" ||
    path === "/onboarding"
  ) {
    secured.headers.set("Cache-Control", "no-store");
  }

  return secured;
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const path = new URL(request.url).pathname;
      if (path === STRIPE_WEBHOOK_PATH) {
        const response = await handleStripeWebhook(request, env as WebhookEnv | undefined);
        return secureResponse(request, response);
      }
      if (path === TELEGRAM_WEBHOOK_PATH) {
        const response = await handleTelegramWebhook(
          request,
          env as TelegramWebhookEnv | undefined,
        );
        return secureResponse(request, response);
      }
      if (path === UNSUBSCRIBE_PATH) {
        return secureResponse(
          request,
          await handleUnsubscribe(request, env as UnsubscribeServerEnv | undefined),
        );
      }
      if (path === HEALTH_PATH) {
        return secureResponse(request, await handleHealth(request, env as HealthEnv | undefined));
      }
      if (path === SITEMAP_PATH) {
        return secureResponse(request, await handleSitemap(env as SitemapEnv | undefined));
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return secureResponse(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return secureResponse(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
