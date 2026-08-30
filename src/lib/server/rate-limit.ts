import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { signedInOnly } from "./guard";

/**
 * In-memory, per-isolate rate limiting. Cloudflare can route consecutive
 * requests to different Workers isolates, so this is a soft cap, not a
 * distributed one — good enough to blunt runaway AI spend and waitlist spam
 * on a student budget, not a substitute for a KV/Durable-Object limiter.
 */

type RateLimitEntry = { count: number; resetAt: number };

const limiters = new Map<string, RateLimitEntry>();

function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; resetAt: number } {
  const now = Date.now();
  const entry = limiters.get(key);
  const current = entry && now < entry.resetAt ? entry : { count: 0, resetAt: now + windowMs };

  if (current.count >= maxRequests) {
    limiters.set(key, current);
    return { allowed: false, resetAt: current.resetAt };
  }

  current.count++;
  limiters.set(key, current);
  return { allowed: true, resetAt: current.resetAt };
}

const RATE_LIMITS = {
  // AI-backed calls (askStory): 20 per minute per signed-in user.
  ai: { maxRequests: 20, windowMs: 60 * 1000 },
  // Waitlist submissions: 5 per hour per IP.
  signup: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
} as const;

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
