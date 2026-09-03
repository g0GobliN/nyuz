/**
 * The counting half of rate limiting, with no request binding.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own module
 * ---------------------------------------------------------------------------
 *
 * `src/lib/server/rate-limit.ts` imports `@tanstack/react-start/server` to read
 * the caller's IP from the request. That specifier is denied in the client
 * environment, which is fine while every export of that module is a middleware
 * — the build strips those from the client graph along with their imports.
 *
 * A plain exported function is not stripped that way. So a server function that
 * wants to *ask* about a limit rather than be gated by one cannot import from
 * there without dragging a server-only specifier into the browser bundle and
 * failing the build. Splitting the arithmetic out is what lets both sides have
 * what they need: the middleware keeps the request binding, and a handler can
 * make a decision from a value it already has.
 *
 * In-memory and per-isolate, exactly as before. Cloudflare routes consecutive
 * requests to different isolates, so this is a soft cap and not a distributed
 * one — good enough to blunt runaway spend and spam on a student budget, not a
 * substitute for a KV or Durable Object limiter.
 */

type RateLimitEntry = { count: number; resetAt: number };

const limiters = new Map<string, RateLimitEntry>();

export function rateLimit(
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

export const RATE_LIMITS = {
  // AI-backed calls (askStory): 20 per minute per signed-in user.
  ai: { maxRequests: 20, windowMs: 60 * 1000 },
  // Waitlist submissions: 5 per hour per IP.
  signup: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  // Blog view counting: one per post per hour per IP.
  view: { maxRequests: 1, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * Whether this visitor should count as a view of `slug`.
 *
 * `increment_post_view` is reachable by anon on purpose (0036 documents why: a
 * signed-out reader must be able to count a view, and no policy can express
 * "may update one column, upward only"). What it never had was a ceiling, so a
 * loop could add arbitrarily many views to any post and make `view_count`
 * meaningless.
 *
 * Returns a boolean rather than throwing, because a reader who has already been
 * counted this hour must still get the post. Being over the limit is not an
 * error, it is just not a new view.
 *
 * Soft, per the module note above: an attacker spread across isolates still
 * gets more than one. That is the right trade for a cosmetic counter — the
 * alternative is persisting a visitor identifier for every anonymous read,
 * which is a real privacy cost for a number displayed under a blog post. The IP
 * never leaves this process.
 */
export function shouldCountView(ip: string, slug: string): boolean {
  return rateLimit(`view:${ip}:${slug}`, RATE_LIMITS.view.maxRequests, RATE_LIMITS.view.windowMs)
    .allowed;
}
