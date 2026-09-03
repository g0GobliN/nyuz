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
 * Why the origin is a constant
 * ---------------------------------------------------------------------------
 *
 * A canonical URL has to be the public production address. `VITE_SITE_URL`
 * would be that in production and `http://localhost:8080` in development, and a
 * canonical pointing at localhost is worse than none at all — it is a positive
 * instruction to a crawler to index an address it cannot reach. This matches
 * what `__root.tsx` and `index.tsx` already do with the og:image and the
 * existing canonical.
 */

const SITE_ORIGIN = "https://nyuz.app";

export function canonicalUrlFor(path: string): string {
  return path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
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
