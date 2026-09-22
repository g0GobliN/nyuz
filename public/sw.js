/**
 * The service worker.
 *
 * Copied to the deploy verbatim — it is not part of the bundle, so it cannot
 * import. Every constant below is mirrored, and held, in src/lib/sw-config.ts
 * plus src/lib/sw.test.ts.
 *
 * ---------------------------------------------------------------------------
 * Activation is deliberately not automatic
 * ---------------------------------------------------------------------------
 *
 * `skipWaiting()` in `install` (which this worker used to do) hands the reader a
 * session where half the assets come from the old build and half from the new
 * one. That was harmless while this file only handled push — it never served
 * anything — and becomes a real bug the moment it caches the bundle: a lazily
 * imported chunk can be requested against a document that no longer matches it,
 * and the classic symptom is a blank page that fixes itself on reload and
 * therefore never gets reported properly.
 *
 * So a new worker waits. The page decides: it posts SKIP_WAITING when the reader
 * taps "Reload now", or the waiting worker takes over on the next cold start,
 * because browsers activate a waiting worker when every tab of the old version is
 * gone. `clients.claim()` is still called in activate, which is safe now: by the
 * time activate runs, activation was either a first install (nothing was
 * controlled) or an update the page asked for.
 *
 * ---------------------------------------------------------------------------
 * What it caches
 * ---------------------------------------------------------------------------
 *
 * Documents: network first, with the last good copy as the fallback, because a
 * cached document is only ever used when the server cannot be reached. Assets
 * under /assets/: cache first with a background revalidation — their names are
 * content-hashed, so a cached one is correct forever and a new deploy simply
 * references different names.
 *
 * Never /_serverFn/, /api/, /auth, /onboarding or /admin. See the comment on
 * SW_NEVER_CACHE: those are per-account or must be current, and an HTTP cache has
 * no idea who is asking.
 */

const CACHE = "nyuz-shell-v1";
const DOCUMENTS = `${CACHE}-documents`;
const ASSETS = `${CACHE}-assets`;
const SKIP_WAITING = "SKIP_WAITING";

const PRECACHE = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg",
];

const NEVER_CACHE = ["/_serverFn/", "/api/", "/auth", "/onboarding", "/admin"];

const OFFLINE_HTML = `<!doctype html>
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

// ---------------------------------------------------------------- lifecycle

self.addEventListener("install", (event) => {
  // No skipWaiting here on purpose — see the header. A new worker waits until
  // the page asks for it or the last old tab closes.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      // Individually, and with failures tolerated: one icon missing from a
      // deploy must not fail the whole install and leave the reader with no
      // worker at all.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(CACHE)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === SKIP_WAITING) {
    event.waitUntil(self.skipWaiting());
  }
});

// ------------------------------------------------------------------ requests

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Anything but a GET is a server-function call or a form post. Neither is
  // cacheable and neither should be touched.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((path) => url.pathname.startsWith(path))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function isStaticAsset(pathname) {
  if (pathname.startsWith("/assets/")) return true;
  return /\.(?:css|js|mjs|png|svg|ico|webp|jpg|jpeg|woff2?)$/.test(pathname);
}

/**
 * The network, and the last good document only when it cannot answer.
 *
 * Documents are not cache-first because the HTML carries the theme, the inline
 * scripts and — before hydration — the only content a reader sees.
 */
async function networkFirstDocument(request) {
  const cache = await caches.open(DOCUMENTS);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

/**
 * Cache first, then quietly replace it.
 *
 * The names under /assets/ contain a content hash, so a hit is always the right
 * bytes for that name — which is why this can serve from cache without asking.
 * The refresh is what keeps a document from being served beside a bundle the
 * cache does not have yet.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const response = await network;
  if (response) return response;
  // A statically imported file the cache has never seen and the network cannot
  // provide. Nothing useful to say, so let it fail as it would have.
  return Response.error();
}

// ---------------------------------------------------------------------- push

self.addEventListener("push", (event) => {
  let data = { title: "nyuz", body: "", url: "/dashboard", tag: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "nyuz", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: false,
      data: { url: data.url || "/dashboard" },
      icon: "/logo-mark.png",
      badge: "/logo-mark.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard";
  const abs = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          return w.focus().then((client) => (client.navigate ? client.navigate(abs) : client));
        }
      }
      return self.clients.openWindow(abs);
    }),
  );
});
