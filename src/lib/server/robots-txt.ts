import { envValue } from "@/lib/runtime-env";

/**
 * `robots.txt`, built from the origin the deployment actually answers on.
 *
 * ---------------------------------------------------------------------------
 * Why this is served and not a file in `public/`
 * ---------------------------------------------------------------------------
 *
 * It used to be `public/robots.txt`, with `Sitemap: https://nyuz.app/sitemap.xml`
 * written into it. That address has no DNS record, and `public/` is a static
 * asset: nothing in the build could correct it, no test read it, and a crawler
 * that fetched this file was sent to a sitemap it could never retrieve. The
 * sitemap itself has been generated from `VITE_SITE_URL` at runtime all along —
 * so the two halves of the crawler surface disagreed, and the half that was
 * wrong was the one nobody could fix with a setting.
 *
 * Reading the same variable the sitemap reads makes them agree by construction,
 * and `scripts/origin-check.mjs` asserts it against a real deployment: every
 * absolute URL in the pages, this file and the sitemap must name one origin,
 * and that origin must serve the site.
 *
 * ---------------------------------------------------------------------------
 * Why the policy text is still a constant
 * ---------------------------------------------------------------------------
 *
 * The rules are a decision, not configuration: the four named agents are allowed
 * because they are the crawlers a briefing product wants, and `*` is allowed
 * because there is public content worth indexing. Only the origin is dynamic.
 *
 * The `Sitemap:` line is omitted rather than guessed when no origin is
 * configured. A robots file with no sitemap line is a smaller loss than one
 * pointing at a host that does not exist, and the deploy job fails on the
 * misconfiguration before a reader can see either.
 */

const POLICY = `User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Twitterbot
Allow: /

User-agent: facebookexternalhit
Allow: /

User-agent: *
Allow: /
`;

export type RobotsTxtEnv = { VITE_SITE_URL?: string };

/** The file for one origin, or without a sitemap line when there is none. */
export function robotsTxt(origin: string | null): string {
  return origin ? `${POLICY}\nSitemap: ${origin}/sitemap.xml\n` : POLICY;
}

export function handleRobotsTxt(env?: RobotsTxtEnv): Response {
  const configured = envValue("VITE_SITE_URL", env);
  // Only an address that can be one: a placeholder here would publish a
  // sitemap URL that is worse than no line at all — see `site-origin.ts`.
  const origin = configured ? configured.trim().replace(/\/+$/, "") : "";
  const body = robotsTxt(/^https:\/\/\S+$/i.test(origin) ? origin : null);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Crawlers do not need this to the minute; there is no read behind it.
      "cache-control": "public, max-age=3600",
    },
  });
}
