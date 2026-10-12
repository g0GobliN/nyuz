/**
 * The one origin this app publishes about itself.
 *
 * ---------------------------------------------------------------------------
 * The defect this file exists to close
 * ---------------------------------------------------------------------------
 *
 * On 2026-10-12 the live product answered on
 * `https://nyuz.grgvishal-gurung17.workers.dev` while declaring
 * `https://nyuz.app` — a host with no DNS record and no zone on the account —
 * in its own canonical link, its OpenGraph image and its `robots.txt`. Nothing
 * failed: the page rendered, the tests passed, and CI stayed green, because the
 * origin was written out as a literal in four different files and nothing
 * asserted that those four literals, and the origin the deployment actually
 * answers on, were the same address.
 *
 * So the rule here is one origin, resolved in one place, and asserted against a
 * real deployment by `scripts/origin-check.mjs` — which fails when the pages,
 * `robots.txt` and `sitemap.xml` disagree about it or when the origin they name
 * does not serve the site.
 *
 * ---------------------------------------------------------------------------
 * Why there is a fallback, and why it is the deployed origin
 * ---------------------------------------------------------------------------
 *
 * `VITE_SITE_URL` is the operator's answer to "where does this live", and it is
 * the same variable the Worker reads at runtime for email links, Stripe returns,
 * `robots.txt` and the sitemap. It is deliberately *not* required: a canonical
 * URL cannot be derived from the request, a page that throws while rendering it
 * is worse than a page with a slightly wrong one, and `head()` has no failure
 * channel — so a value that cannot be a public address falls back instead.
 *
 * The fallback is the origin the product actually answers on, never the
 * development origin. A canonical pointing at `http://localhost:8080` is worse
 * than none at all: it is a positive instruction to a crawler to index an
 * address it cannot reach. That reasoning predates this file and is why the
 * origin was a constant in the first place; what was missing is that the
 * constant has to be the *deployed* address, and has to be the same one
 * everywhere.
 */

/**
 * Where the production Worker answers while no domain is attached to it.
 *
 * Not a placeholder and not a secret: it is public, it is in the deploy job's
 * own output, and it is the address a reader reaches today. When a domain is
 * registered this constant is not edited — `VITE_SITE_URL` is set to the new
 * origin and every published URL follows it.
 */
export const DEPLOYED_ORIGIN = "https://nyuz.grgvishal-gurung17.workers.dev";

/**
 * An absolute HTTPS origin: scheme, host, optional port, nothing else.
 *
 * Deliberately strict. `VITE_SITE_URL` has been set to a placeholder sentence
 * before, and a value that merely *parses* as a URL is not a value that
 * resolves — `https://<the origin production answers on>` would sail through
 * `new URL()` in some positions and publish a host with a space in it. A path,
 * a query, a trailing slash or a `localhost` is likewise not a public origin,
 * and each one silently corrupts every absolute URL built from it.
 */
const PUBLIC_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?$/i;

/** True when the value can be a public HTTPS origin and nothing else. */
export function isPublicOrigin(value: string): boolean {
  return PUBLIC_ORIGIN.test(value.trim().replace(/\/+$/, ""));
}

/**
 * The origin every published absolute URL is built from, with no trailing
 * slash.
 *
 * Reads `import.meta.env.VITE_SITE_URL`, which Vite replaces at build time in
 * both the client and the server bundle. Modules imported by the Node scripts
 * under `scripts/` never pass through Vite, so the lookup is written to be safe
 * when `import.meta.env` is not there at all: those scripts get the fallback
 * rather than a crash.
 */
export function siteOrigin(): string {
  const configured = (import.meta.env?.VITE_SITE_URL ?? "").trim().replace(/\/+$/, "");
  return PUBLIC_ORIGIN.test(configured) ? configured : DEPLOYED_ORIGIN;
}
