/**
 * Per-page search and social metadata.
 *
 * ---------------------------------------------------------------------------
 * What this fixes
 * ---------------------------------------------------------------------------
 *
 * `__root.tsx` sets one set of OpenGraph tags for the whole site, and each
 * public route overrode only `title` and `description`. Those are different
 * namespaces: a route that sets `title` does not set `og:title`. So every
 * public page except the landing page shared the landing page's social card —
 * paste a link to /pricing into Slack and it previewed as "nyuz — Stop
 * searching. Start knowing." with the homepage description.
 *
 * Only `/` carried a canonical link, so the remaining public pages were
 * reachable at more than one URL (trailing slash, query strings from campaign
 * tags) with nothing telling a crawler which one to keep.
 *
 * One helper rather than fifteen hand-written blocks, because the failure mode
 * here is silent: nothing breaks, the preview is just wrong, and nobody looks
 * at it again after the first time.
 *
 * ---------------------------------------------------------------------------
 * Why the origin comes from one module
 * ---------------------------------------------------------------------------
 *
 * A canonical URL has to be the public production address, and it must be the
 * *same* address as the one in `robots.txt`, in the sitemap and in the links an
 * email carries — a page that canonicalises to one host while the sitemap lists
 * another is telling a crawler two different things about the same site.
 *
 * This used to be a literal here, and a second literal in `index.tsx` and a
 * third in `__root.tsx`. On 2026-10-12 all three pointed at a host with no DNS
 * record while the product answered somewhere else, and nothing caught it.
 * `siteOrigin()` is now the single answer, and `scripts/origin-check.mjs`
 * asserts against a real deployment that the answer matches the sitemap, the
 * robots file and the origin itself.
 *
 * It is still never localhost: see the reasoning in `site-origin.ts`.
 */

import { siteOrigin } from "@/lib/site-origin";

export function canonicalUrlFor(path: string): string {
  const origin = siteOrigin();
  return path === "/" ? `${origin}/` : `${origin}${path}`;
}

/**
 * Head metadata for one public page.
 *
 * `og:title` and `og:description` are set alongside `title` and `description`
 * rather than left to inherit, which is the whole point — see above.
 */
export function pageHead(input: { path: string; title: string; description: string }): {
  meta: (
    { title: string } | { name: string; content: string } | { property: string; content: string }
  )[];
  links: { rel: string; href: string }[];
} {
  const url = canonicalUrlFor(input.path);
  return {
    meta: [
      { title: input.title },
      { name: "description", content: input.description },
      { property: "og:title", content: input.title },
      { property: "og:description", content: input.description },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
