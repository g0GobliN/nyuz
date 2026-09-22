/**
 * The service worker's facts, kept where TypeScript can see them.
 *
 * `public/sw.js` is copied to the deploy verbatim — it is not bundled, so it
 * cannot import anything. Every value below therefore appears twice: once here
 * and once as a literal in the worker. `src/lib/sw.test.ts` holds the two
 * together, which is the only reason this arrangement is safe rather than a
 * standing invitation to drift.
 */

/**
 * The cache generation, in the cache's *name*.
 *
 * Bumping this is what makes a deploy take effect: `activate` deletes every
 * cache whose name does not start with the current one, so a worker that ships
 * different rules starts from an empty store instead of serving an old document
 * that points at assets the deploy has already replaced. Bump it whenever the
 * caching rules in public/sw.js change — not on every deploy, since the hashed
 * asset names already handle that.
 */
export const SW_CACHE = "nyuz-shell-v1";

/** Where the worker lives. Also its scope, which must stay the site root. */
export const SW_URL = "/sw.js";

/**
 * Files that never change name and are worth having before anything else.
 *
 * Precache is a promise, so it is deliberately tiny: the icons and the manifest
 * are what an installed app is launched for, and they are small. The bundle is
 * *not* here — its filenames are content-hashed per build, so they cannot be
 * listed in a file that is itself not built. Those are cached at runtime.
 */
export const SW_PRECACHE = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg",
];

/**
 * Prefixes the worker must never store, whatever the request.
 *
 * `/_serverFn/` is the whole reason this list exists: those are per-account
 * responses, and an HTTP cache is shared by every account on the device. Storing
 * one reader's briefing and serving it to the next person to sign in on that
 * browser is a data leak, not a caching bug — the archive in src/lib/offline/ is
 * account-keyed precisely because this cache cannot be. `/api/` covers the
 * webhooks and the health check; `/auth`, `/onboarding` and `/admin` are
 * documents that must always come from the server, since a stale sign-in screen
 * or console is worse than no screen at all.
 */
export const SW_NEVER_CACHE = ["/_serverFn/", "/api/", "/auth", "/onboarding", "/admin"];

/**
 * What a navigation with nothing cached sees.
 *
 * A reader offline, on a screen the worker has never seen, should get a sentence
 * rather than the browser's dinosaur. It is a complete document because it
 * replaces one — no stylesheet is fetched, since the network is the thing that
 * is missing — and it offers the only action that can help.
 */
export const SW_OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>Offline — nyuz</title>
<style>
  html,body{margin:0;height:100%}
  body{background:#0a0a0a;color:#f5f5f5;font:400 15px/1.6 "Manrope",ui-sans-serif,system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;text-align:center;letter-spacing:-0.011em}
  main{max-width:22rem;padding:2rem}
  h1{margin:0 0 0.75rem;font-size:1.25rem;letter-spacing:-0.03em}
  p{margin:0;color:#a3a3a3}
  button{margin-top:1.5rem;background:#f5f5f5;color:#0a0a0a;border:0;border-radius:999px;
         padding:0.6rem 1.25rem;font:inherit;font-weight:500}
</style></head>
<body><main>
  <h1>nyuz cannot reach the network.</h1>
  <p>Nothing is saved for this page on this device. Briefings you have opened or saved are still available.</p>
  <button onclick="location.reload()">Try again</button>
</main></body></html>`;

/** The message a page posts to activate a worker that is waiting. */
export const SW_SKIP_WAITING = "SKIP_WAITING";
