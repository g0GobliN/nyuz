import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit-core";
import { signedInOnly } from "./guard";

/**
 * The request-bound half of rate limiting.
 *
 * The counting lives in `@/lib/rate-limit-core`, which imports nothing. This
 * module reads the caller's identity off the request, which needs
 * `@tanstack/react-start/server` — a specifier denied in the client
 * environment. Everything exported here is therefore a middleware, because the
 * build strips middleware and its imports out of the client graph. A plain
 * exported function here would pull a server-only import into the browser
 * bundle through any route that transitively imports this file, and fail the
 * build. That is not a style rule; it is the reason for the split.
 */

function clientIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function tooManyRequests(resetAt: number): never {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  throw new Error(`Too many requests. Try again in ${retryAfter}s.`);
}

/** Caps AI-backed calls per signed-in user. Depends on `signedInOnly` for the actor id. */
export const aiRateLimit = createMiddleware({ type: "function" })
  .middleware([signedInOnly])
  .server(async ({ next, context }) => {
    const { allowed, resetAt } = rateLimit(
      `ai:${context.actor.id}`,
      RATE_LIMITS.ai.maxRequests,
      RATE_LIMITS.ai.windowMs,
    );
    if (!allowed) tooManyRequests(resetAt);
    return next();
  });

/** Caps waitlist joins per IP, for a public endpoint with no signed-in actor to key on. */
export const signupRateLimit = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { allowed, resetAt } = rateLimit(
    `signup:${clientIp()}`,
    RATE_LIMITS.signup.maxRequests,
    RATE_LIMITS.signup.windowMs,
  );
  if (!allowed) tooManyRequests(resetAt);
  return next();
});

/**
 * Puts the caller's IP on the context without gating anything.
 *
 * For handlers that need to make their own decision from it rather than be
 * refused outright — blog view counting, where being over the limit means "do
 * not count this" and never "do not serve the post".
 */
export const withViewerIp = createMiddleware({ type: "function" }).server(async ({ next }) =>
  next({ context: { viewerIp: clientIp() } }),
);
