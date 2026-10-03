#!/usr/bin/env node
/**
 * Checks the production origin from outside GitHub Actions.
 *
 *   node scripts/route-walk.mjs https://nyuz.app
 *   node scripts/route-walk.mjs --self-test        (no network, proves the suite bites)
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * A successful `wrangler deploy` means Cloudflare accepted an upload. It does not
 * mean any page renders. The failure this was written for is the one that costs
 * the most: a `VITE_`-prefixed variable that is unset compiles to `undefined`,
 * the bundle is built and uploaded without complaint, and then the document
 * throws at module scope for every visitor.
 *
 * A single `curl -o /dev/null -w '%{http_code}'` is what the deploy job used to
 * do, and it has a specific blind spot. Cloudflare answers a request for `/` from
 * the asset manifest even when the JavaScript bundle it references is missing, is
 * the wrong build, or 500s on its own -- the document is a static file and the app
 * is a script that runs afterwards. So a 200 on `/` is compatible with a
 * completely broken site. The check has to read the body.
 *
 * What it asserts per route:
 *   - status 200
 *   - a non-empty <title> that matches the page it is on
 *   - a body with real content in it, not just a shell
 *   - none of the three strings a template renders when it lacks a value
 *   - the hashed JS and CSS chunks the document references are actually served
 *
 * The last one is the reason this is not just a `curl`. A deploy can be live and
 * still reference an asset directory from a different build; the HTML is real,
 * the status is real, and every script tag 404s into a blank page.
 *
 * ---------------------------------------------------------------------------
 * Why the retries
 * ---------------------------------------------------------------------------
 * A fresh deploy propagates to Cloudflare's edge asynchronously. Asking the same
 * origin a few times is not flakiness-appeasing, it is the only correct reading
 * of a distributed system that was *just* told to change: the first answer is
 * often the previous deployment. `--attempts` defaults to 5 with a 10s gap,
 * which is long enough to outlast a propagation and short enough to fail a CI
 * job in under a minute.
 *
 * ---------------------------------------------------------------------------
 * No dependencies
 * ---------------------------------------------------------------------------
 * `fetch` is Node 18+, stripping tags is a regular expression, and this script
 * has to keep working when the dependency tree is the thing that broke. It is
 * run by the deploy job immediately after an upload and by a nightly schedule
 * with an empty job, so it cannot depend on `npm ci` having succeeded.
 */

import { createServer } from "node:http";

const TIMEOUT_MS = 20_000;

/**
 * The pages a reader reaches without a session.
 *
 * `/dashboard/*` and `/admin/*` are deliberately absent. Both need a token that
 * only exists in browser storage, so the server answers them with the same shell
 * it would answer an anonymous request with, and a walk would report a green
 * result for pages nobody can see. The e2e suite asserts those guards in a real
 * browser; this asserts that the public surface exists.
 *
 * `/legal/$doc` is a dynamic segment with a fixed set of documents, so both are
 * listed explicitly rather than guessed.
 */
const ROUTES = [
  { path: "/", expect: /nyuz/i },
  { path: "/how-it-works", expect: /how nyuz works/i },
  { path: "/pricing", expect: /pricing/i },
  { path: "/about", expect: /about/i },
  { path: "/support", expect: /support/i },
  { path: "/blog", expect: /blog/i },
  { path: "/legal/terms", expect: /terms/i },
  { path: "/legal/privacy", expect: /privacy/i },
];

/**
 * Strings that mean a template rendered a value it did not have.
 *
 * `undefined` and `NaN` arrive when a loader's data is missing and a component
 * interpolates it anyway; `[object Object]` when an object is stringified into a
 * text node. All three ship, all three read as content, and none is caught by a
 * type check -- a loader typed `string | undefined` is *correct*.
 */
const RENDER_FAILURES = [
  { pattern: /\bundefined\b/, label: "undefined" },
  { pattern: /\bNaN\b/, label: "NaN" },
  { pattern: /\[object Object\]/, label: "[object Object]" },
];

// ---------------------------------------------------------------- primitives

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function heading(text) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function check(ok, message, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok && detail) console.log(`        ${detail}`);
  return ok;
}

/** Strips scripts, styles and tags, leaving what a reader would actually see. */
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? (match[1] ?? "").trim() : "";
}

/**
 * The hashed chunks the document pulls in.
 *
 * This is the assertion that catches a deploy serving a document from one build
 * and assets from another. Everything else on the page can be perfect while every
 * script 404s, because the HTML is static and the failure is in what it points
 * at.
 */
function referencedAssets(html, base) {
  const found = new Set();
  const pattern = /(?:src|href)\s*=\s*"([^"]+\.(?:js|css|mjs)(?:\?[^"]*)?)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    // Skip anything not served from the origin: a CDN or a preconnect target is
    // not this deployment's asset and its status says nothing about this build.
    if (!raw.startsWith("/")) continue;
    found.add(new URL(raw, base).href);
  }
  return [...found];
}

async function get(url) {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: {
      // Identify honestly. A walk that looks like a browser is easier to filter
      // out of CDN logs, and some edges serve a different document to a
      // recognisable agent than to an anonymous one.
      "user-agent": "nyuz-route-walk/1.0 (+https://nyuz.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });
}

// ---------------------------------------------------------------- the walk

/** Checks one route. Returns true when everything about it held. */
async function checkRoute(origin, route) {
  const url = new URL(route.path, origin).href;
  let healthy = true;

  let response;
  try {
    response = await get(url);
  } catch (error) {
    // A network-level failure is reported with the underlying code, because
    // "unreachable" and "returned 500" call for completely different responses
    // and a bare label loses the difference.
    const cause = error?.cause?.code ?? error?.code ?? error?.name ?? "unknown";
    return check(false, `${route.path} reachable`, `${cause} — ${error?.message ?? error}`);
  }

  healthy =
    check(response.status === 200, `${route.path} status 200`, `got ${response.status}`) && healthy;

  const html = await response.text();

  const title = titleOf(html);
  healthy = check(title.length > 0, `${route.path} has a title`) && healthy;
  if (route.expect) {
    // A page that serves 200 and answers with the wrong document is a broken
    // deploy that a status check alone would call green.
    healthy =
      check(
        route.expect.test(title),
        `${route.path} title matches ${route.expect}`,
        `got "${title}"`,
      ) && healthy;
  }

  const text = visibleText(html);
  // Well below this a page has rendered a frame and no article. It is a
  // threshold rather than a floor by design: every one of these pages is a
  // long-form document, so the honest lower bound is well above a shell.
  healthy =
    check(
      text.length > 200,
      `${route.path} rendered content`,
      `${text.length} chars of visible text`,
    ) && healthy;

  for (const failure of RENDER_FAILURES) {
    const hit = failure.pattern.exec(text);
    healthy =
      check(
        hit === null,
        `${route.path} free of ${failure.label}`,
        hit ? `found "${hit[0]}"` : "",
      ) && healthy;
  }

  const assets = referencedAssets(html, response.url || url);
  if (assets.length === 0) {
    healthy =
      check(
        false,
        `${route.path} references its bundle`,
        "no hashed .js or .css found in the document",
      ) && healthy;
  }
  for (const asset of assets) {
    let status = 0;
    try {
      const assetResponse = await get(asset);
      status = assetResponse.status;
      await assetResponse.arrayBuffer();
    } catch (error) {
      status = error?.cause?.code ?? error?.message ?? String(error);
    }
    const name = asset.startsWith(origin) ? asset.slice(origin.length) : asset;
    healthy = check(status === 200, `  asset ${name}`, `status ${status}`) && healthy;
  }

  return healthy;
}

/** Walks every route once. Returns true when all of them held. */
async function walk(origin) {
  heading(`Walking ${origin}`);
  let healthy = true;
  for (const route of ROUTES) {
    healthy = (await checkRoute(origin, route)) && healthy;
  }
  return healthy;
}

/**
 * Retries the whole walk.
 *
 * Every attempt starts from scratch rather than resuming, because the interesting
 * failure is a *mixture* -- the document served from the new build and the assets
 * from the old one -- and a partial retry would not see it.
 */
async function walkWithRetries(origin, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\n=== attempt ${attempt} of ${attempts} ===`);
    if (await walk(origin)) {
      if (attempt > 1)
        console.log(`\nHealthy on attempt ${attempt}; earlier attempts saw propagation.`);
      return true;
    }
    if (attempt < attempts) {
      console.log(`\nNot healthy. Waiting 10s for the edge to catch up.`);
      await sleep(10_000);
    }
  }
  return false;
}

// ---------------------------------------------------------------- self-test

/**
 * Proves the suite reports failures.
 *
 * A check that has never failed is a check nobody should trust, and every
 * assertion above was written against pages this script can construct. The
 * fixture serves a healthy site, then the same site with each of eight defects,
 * and the suite must reject all eight and accept the first.
 */
async function selfTest() {
  // Each page carries a title that satisfies its own `expect`, the way a real
  // deployment does -- the checker must not pass on "a title exists" alone. The
  // assertion below keeps the fixture honest about that.
  const good = (title) =>
    `<!doctype html><html><head><title>${title}</title>` +
    `<link rel="stylesheet" href="/assets/app.css"></head>` +
    `<body><main><h1>nyuz</h1><p>${"A reader sees this sentence. ".repeat(12)}</p></main>` +
    `<script type="module" src="/assets/entry.js"></script></body></html>`;

  const titles = new Map([
    ["/", "nyuz — read the news you actually care about"],
    ["/how-it-works", "How nyuz works"],
    ["/pricing", "Pricing — nyuz"],
    ["/about", "About nyuz"],
    ["/support", "Support — nyuz"],
    ["/blog", "Blog — nyuz"],
    ["/legal/terms", "Terms of Service — nyuz"],
    ["/legal/privacy", "Privacy Policy — nyuz"],
  ]);

  const routes = new Map(ROUTES.map((route) => [route.path, good(titles.get(route.path))]));

  for (const route of ROUTES) {
    const title = titles.get(route.path);
    if (!title || !route.expect.test(title)) {
      throw new Error(`fixture title "${title}" cannot satisfy ${route.expect} for ${route.path}`);
    }
  }

  /** Rewrites `/` with a defect applied to an otherwise healthy page. */
  const mutate = (fn) => {
    routes.set("/", fn(good(titles.get("/"))));
  };

  const cases = [
    ["an empty title", (html) => html.replace(/<title[^>]*>[\s\S]*?<\/title>/, "<title></title>")],
    [
      "a wrong title",
      (html) => html.replace(/<title[^>]*>[\s\S]*?<\/title>/, "<title>Dashboard</title>"),
    ],
    ["an empty body", (html) => html.replace(/<main>[\s\S]*?<\/main>/, "<main></main>")],
    ["a rendered `undefined`", (html) => html.replace("A reader", "undefined A reader")],
    ["a rendered `NaN`", (html) => html.replace("A reader", "NaN A reader")],
    [
      "a rendered `[object Object]`",
      (html) => html.replace("A reader", "[object Object] A reader"),
    ],
  ];

  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    // Asset routes answer before the page map is consulted, because the map only
    // holds documents and a hashed chunk is not one.
    if (path === "/assets/entry.js" || path === "/assets/app.css") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("/* fixture */");
      return;
    }
    if (path === "/assets/gone.js") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("gone");
      return;
    }
    const body = routes.get(path);
    if (body === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  let failures = 0;
  const expectRejected = async (label, run) => {
    heading(`self-test: ${label} is reported`);
    if (await run()) {
      console.error(`\nFAIL: the walk accepted a page with ${label}.`);
      failures += 1;
    }
  };

  try {
    heading("self-test: a healthy fixture passes");
    if (!(await walk(origin))) {
      console.error("\nFAIL: the fixture is correct and the walk rejected it.");
      failures += 1;
    }

    for (const [label, mutateFn] of cases) {
      await expectRejected(label, async () => {
        mutate(mutateFn);
        return walk(origin);
      });
    }

    await expectRejected("a missing asset", async () => {
      mutate((html) => html.replace("/assets/entry.js", "/assets/gone.js"));
      // The rest of the site stays healthy, so this case proves the asset check
      // is what fails rather than the page having broken too.
      return walk(origin);
    });

    await expectRejected("an unreachable route", async () =>
      checkRoute(origin, { path: "/no-such-page", expect: /./ }),
    );

    await expectRejected("a document that references no bundle at all", async () => {
      // Both references have to go: leaving the stylesheet in place would still
      // give `referencedAssets` something to fetch, and the walk would correctly
      // pass on a page that a browser would render unstyled and inert.
      mutate((html) =>
        html.replace(/<script[^>]*><\/script>/, "").replace(/<link rel="stylesheet"[^>]*>/, ""),
      );
      return checkRoute(origin, ROUTES[0]);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  heading(failures === 0 ? "self-test passed" : `self-test FAILED (${failures})`);
  return failures === 0;
}

// ---------------------------------------------------------------- entry

async function main() {
  const args = process.argv.slice(2);
  const selfTestOnly = args.includes("--self-test");
  const attemptIndex = args.indexOf("--attempts");
  const attempts = attemptIndex === -1 ? 5 : Number(args[attemptIndex + 1] ?? 5);
  const origin = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/+$/, "");

  if (selfTestOnly) return (await selfTest()) ? 0 : 1;

  if (!origin) {
    console.error("usage: node scripts/route-walk.mjs <origin> [--attempts N]");
    console.error("       node scripts/route-walk.mjs --self-test");
    return 2;
  }

  const healthy = await walkWithRetries(origin, attempts);
  heading(
    healthy
      ? `${origin} is serving every public page.`
      : `${origin} is NOT serving every public page.`,
  );
  return healthy ? 0 : 1;
}

process.exitCode = await main();
