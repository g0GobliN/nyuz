#!/usr/bin/env node
/**
 * Checks a deployed nyuz against the install contract.
 *
 *   node scripts/pwa-check.mjs https://nyuz.app
 *   node scripts/pwa-check.mjs --self-test        (after `npm run build`)
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The standalone app is the one part of the product that cannot be verified by
 * `npm run ci`: it renders only for an authenticated session in a window the
 * build machine does not have. What *can* be verified without a phone is that
 * the deploy serves the pieces the shell needs — a manifest the browser will
 * accept, icons whose bytes match their declared sizes, a document that links
 * the manifest and carries `viewport-fit=cover`, and a worker that caches the
 * bundle without ever caching a per-account response.
 *
 * A check that has never failed is a check nobody should trust, so `--self-test`
 * serves the real build artifacts from a throwaway local server, asserts the
 * whole suite passes against them, and then breaks five things on purpose — the
 * display mode, the scope, an icon, the worker's activation, and its never-cache
 * list — to prove the suite reports them. It runs against `.output/public`, so it
 * needs a build first, and `npm run ci` runs it immediately after one.
 *
 * The document it serves in self-test mode is synthetic: this checker cannot
 * render the app. That is deliberate. The app's own head — the manifest link,
 * `viewport-fit=cover`, the iOS metas — is asserted against the source by
 * `src/lib/manifest.test.ts` in the unit suite, and against real HTML by the
 * live check on a deployment. Nothing here quietly pretends to be that.
 *
 * No dependencies: `fetch` is Node 18+, and a PNG's size is in its header.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------- primitives

/** A PNG's pixel size, read from the IHDR chunk. Throws on anything else. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) {
    throw new Error("not a PNG");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
}

/** Whether `start` is inside `scope`, by prefix — the rule the browser applies. */
function withinScope(startUrl, scopeUrl, base) {
  const start = new URL(startUrl, base).pathname;
  const scope = new URL(scopeUrl, base).pathname;
  return start === scope || start.startsWith(scope.endsWith("/") ? scope : `${scope}/`);
}

// ------------------------------------------------------------------- checks

/**
 * Every check, against one origin. Returns results rather than printing, so the
 * self-test can assert on them.
 */
async function runChecks(base) {
  const results = [];
  const add = (status, label, detail) => results.push({ status, label, detail });
  const url = (pathname) => new URL(pathname, base).href;

  // ------------------------------------------------------------- manifest
  let manifest = null;
  try {
    const response = await get(url("/manifest.webmanifest"));
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (!response.ok) {
      add("fail", "manifest is served", `HTTP ${response.status}`);
    } else if (!type.includes("json")) {
      add("fail", "manifest is served", `content-type is ${type || "missing"}, not JSON`);
    } else {
      add("pass", "manifest is served", `HTTP ${response.status} ${type.trim()}`);
      try {
        manifest = JSON.parse(body);
      } catch {
        add("fail", "manifest parses", "body is not JSON");
      }
    }
  } catch (error) {
    add("fail", "manifest is served", String(error));
  }

  if (manifest) {
    const required = [
      "name",
      "short_name",
      "start_url",
      "scope",
      "theme_color",
      "background_color",
    ];
    const missing = required.filter((key) => !manifest[key]);
    add(
      missing.length ? "fail" : "pass",
      "manifest has every install field",
      missing.length ? `missing ${missing.join(", ")}` : required.join(", "),
    );

    add(
      manifest.display === "standalone" ? "pass" : "fail",
      "manifest asks for standalone",
      `display: ${JSON.stringify(manifest.display)}`,
    );

    // The trap: `scope` is a path prefix, so "/dashboard/" does not contain
    // "/dashboard" — the browser then silently discards start_url and the icon
    // opens somewhere nobody chose.
    const startUrl = manifest.start_url ?? "";
    const scope = manifest.scope ?? "";
    add(
      withinScope(startUrl, scope, base) ? "pass" : "fail",
      "start_url is inside scope",
      `${startUrl} in ${scope}`,
    );

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    for (const want of ["192x192", "512x512"]) {
      const declared = icons.filter((icon) => String(icon.sizes).includes(want));
      add(
        declared.length ? "pass" : "fail",
        `an icon declares ${want}`,
        declared.map((icon) => icon.src).join(", ") || "none",
      );
    }
    add(
      icons.some((icon) => String(icon.purpose ?? "").includes("maskable")) ? "pass" : "warn",
      "a maskable icon is declared",
      icons
        .filter((icon) => String(icon.purpose ?? "").includes("maskable"))
        .map((i) => i.src)
        .join(", ") || "none — Android will letterbox the icon",
    );

    // Bytes, not just declarations: a 512 icon that is really a 192 upscaled, or
    // a 404 that only shows up on a device that requests it.
    for (const icon of icons) {
      const sizes = String(icon.sizes ?? "");
      const declared = /(\d+)x(\d+)/.exec(sizes);
      if (!declared) continue;
      // Only PNGs can be measured here; an SVG icon is legal in a manifest and
      // is reported rather than failed.
      if (!/\.png$/i.test(icon.src ?? "")) {
        add("info", `icon ${icon.src} is not a PNG`, "size not measured");
        continue;
      }
      try {
        const response = await get(url(icon.src));
        if (!response.ok) {
          add("fail", `icon ${icon.src} is served`, `HTTP ${response.status}`);
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        let size;
        try {
          size = pngSize(bytes);
        } catch (error) {
          add("fail", `icon ${icon.src} is a PNG`, String(error));
          continue;
        }
        const matches = size.width === Number(declared[1]) && size.height === Number(declared[2]);
        add(
          matches ? "pass" : "fail",
          `icon ${icon.src} matches its declared size`,
          `${size.width}x${size.height} declared ${sizes}`,
        );
      } catch (error) {
        add("fail", `icon ${icon.src} is served`, String(error));
      }
    }
  }

  // ------------------------------------------------------------- the document
  if (manifest?.start_url) {
    try {
      const response = await get(url(manifest.start_url));
      const html = await response.text();
      add(
        response.ok ? "pass" : "fail",
        "start_url answers",
        `HTTP ${response.status} ${new URL(response.url).pathname}`,
      );

      const hasManifestLink = /<link[^>]+rel="manifest"/.test(html);
      add(
        hasManifestLink ? "pass" : "fail",
        "document links the manifest",
        hasManifestLink ? "/manifest.webmanifest" : "no rel=manifest link",
      );

      const viewport = /<meta[^>]+name="viewport"[^>]*>/.exec(html)?.[0] ?? "";
      add(
        viewport.includes("viewport-fit=cover") ? "pass" : "fail",
        "viewport has viewport-fit=cover",
        viewport || "no viewport meta",
      );

      // Without it every env(safe-area-inset-*) is 0 and the shell's bars sit
      // under the notch. Worth a failure, not a warning.
      const themeColor = /<meta[^>]+name="theme-color"[^>]*>/.exec(html)?.[0] ?? "";
      add(themeColor ? "pass" : "fail", "document carries theme-color", themeColor || "missing");

      const iosMeta = /apple-mobile-web-app-capable/.test(html);
      add(
        iosMeta ? "pass" : "warn",
        "iOS standalone metas are present",
        iosMeta
          ? "apple-mobile-web-app-capable"
          : "missing — iOS would open the icon with Safari chrome",
      );
    } catch (error) {
      add("fail", "start_url answers", String(error));
    }
  }

  // --------------------------------------------------------- service worker
  try {
    const response = await get(url("/sw.js"));
    const body = await response.text();
    if (!response.ok) {
      add("fail", "worker is served", `HTTP ${response.status}`);
    } else {
      const cacheControl = response.headers.get("cache-control") ?? "none";
      add("pass", "worker is served", `HTTP ${response.status}, cache-control: ${cacheControl}`);
      add(
        "info",
        "worker update policy",
        'the page registers with updateViaCache: "none", so a long cache-control here does not hold an update back',
      );

      const installAt = body.indexOf('addEventListener("install"');
      const activateAt = body.indexOf('addEventListener("activate"');
      // Comments stripped first: the worker explains in its install handler why
      // it does *not* call skipWaiting, and a substring check would read that
      // sentence as the call. The self-test is what caught exactly that.
      const installHandler = (installAt === -1 ? "" : body.slice(installAt, activateAt)).replace(
        /\/\/[^\n]*/g,
        "",
      );
      const activatesItself = /\bskipWaiting\s*\(/.test(installHandler);
      add(
        activatesItself ? "fail" : "pass",
        "the worker does not activate itself",
        activatesItself
          ? "skipWaiting() in install would swap assets under a running session"
          : "install leaves the new worker waiting for the page",
      );

      add(
        body.includes('addEventListener("fetch"') ? "pass" : "fail",
        "the worker caches the shell",
        body.includes('addEventListener("fetch"')
          ? "fetch handler present"
          : "no fetch handler — the deployed worker is the push-only one",
      );

      // Read out of the array literal, not searched for as a substring. The
      // worker's header names every path it never caches, so a substring check
      // answers from prose: emptying the list would leave it passing. The
      // `skipWaiting` check above was caught by exactly this trap, and both
      // now read code rather than text.
      const neverCache = /NEVER_CACHE\s*=\s*\[([^\]]*)\]/.exec(body);
      const listed =
        neverCache === null
          ? null
          : neverCache[1]
              .split(",")
              .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean);
      const excludes = (...paths) => listed !== null && paths.every((p) => listed.includes(p));
      const whyNot = (missing) =>
        listed === null
          ? "no NEVER_CACHE array — the contract with src/lib/sw-config.ts changed shape"
          : `${missing} missing from the never-cache list`;

      add(
        excludes("/_serverFn/") ? "pass" : "fail",
        "per-account responses are never cached",
        excludes("/_serverFn/")
          ? "/_serverFn/ is in the never-cache list"
          : whyNot("/_serverFn/ — a shared cache could outlive the session"),
      );

      add(
        excludes("/api/") ? "pass" : "fail",
        "webhooks and the health check are never cached",
        excludes("/api/") ? "/api/ is in the never-cache list" : whyNot("/api/"),
      );

      add(
        excludes("/auth", "/onboarding", "/admin") ? "pass" : "fail",
        "sign-in and console documents always come from the server",
        excludes("/auth", "/onboarding", "/admin")
          ? "/auth, /onboarding, /admin are in the never-cache list"
          : whyNot("a stale document"),
      );

      add(
        body.includes('addEventListener("push"') ? "pass" : "fail",
        "push still works",
        body.includes('addEventListener("push"') ? "push handler present" : "push handler missing",
      );
    }
  } catch (error) {
    add("fail", "worker is served", String(error));
  }

  return results;
}

// ------------------------------------------------------------------ reporting

const ICON = { pass: "PASS", fail: "FAIL", warn: "WARN", info: "INFO" };

function report(results) {
  let width = 0;
  for (const result of results) width = Math.max(width, result.label.length);
  for (const result of results) {
    console.log(`${ICON[result.status]}  ${result.label.padEnd(width)}  ${result.detail ?? ""}`);
  }
  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  console.log(
    `\n${failed ? `${failed} failed` : "all checks passed"}${warned ? `, ${warned} warning${warned > 1 ? "s" : ""}` : ""} (${results.length} checks)`,
  );
  return failed === 0;
}

// ----------------------------------------------------------------- self-test

/** The head src/routes/__root.tsx emits, near enough to be checked. */
function fixtureDocument() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.webmanifest">
</head><body><div id="root"></div></body></html>`;
}

async function selfTest() {
  const dir = path.join(root, ".output", "public");
  const files = [
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "favicon.svg",
    "sw.js",
  ];

  const served = new Map();
  const missing = [];
  for (const name of files) {
    try {
      served.set(`/${name}`, await readFile(path.join(dir, name)));
    } catch {
      missing.push(`/${name}`);
    }
  }
  // A file that the build did not emit is a failure of the contract, not a
  // usage error — so it is reported and the checks still run, which names the
  // culprit instead of just telling the reader to build. Only a missing build
  // directory outright is a usage error.
  for (const name of missing) console.log(`FAIL  the build emits ${name}`);

  // One manifest is the real one; the broken copies are derived from it so only
  // the thing under test changes.
  // Both derivations below are skipped when the file they come from is not
  // there at all; the missing artifact is already reported above.
  const manifestFile = served.get("/manifest.webmanifest");
  const realManifest = manifestFile ? JSON.parse(manifestFile.toString("utf8")) : null;
  const withManifest = (manifest) => {
    const copy = new Map(served);
    copy.set("/manifest.webmanifest", Buffer.from(JSON.stringify(manifest)));
    return copy;
  };

  // Which copy of the artifacts a request is answered from. Reassigned per
  // scenario, so the broken manifests are the real ones with one field changed.
  let currentFiles = served;

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/dashboard") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixtureDocument());
      return;
    }
    const body = currentFiles.get(url.pathname);
    if (!body) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const type = url.pathname.endsWith(".png")
      ? "image/png"
      : url.pathname.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : url.pathname.endsWith(".svg")
          ? "image/svg+xml"
          : "application/manifest+json";
    response.writeHead(200, { "content-type": type });
    response.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // One artifact dropped, and one that activates itself in `install` — the two
  // regressions that would otherwise only show up on a device.
  const withoutIcon = new Map(served);
  withoutIcon.delete("/icon-192.png");

  const worker = served.get("/sw.js")?.toString("utf8") ?? null;
  const selfActivating = new Map(served);
  selfActivating.set(
    "/sw.js",
    Buffer.from(
      (worker ?? "").replace(/(addEventListener\("install"[^{]*\{)/, "$1\n  self.skipWaiting();"),
    ),
  );

  // An emptied denylist, with the header comment left saying what it never
  // caches. This is the state a substring check would call healthy.
  const cachesEverything = new Map(served);
  cachesEverything.set(
    "/sw.js",
    Buffer.from((worker ?? "").replace(/NEVER_CACHE = \[[^\]]*\]/, "NEVER_CACHE = []")),
  );

  const scenarios = [
    { name: "a healthy deploy", expect: "pass", files: served },
    ...(realManifest
      ? [
          {
            name: "display: browser",
            expect: "fail",
            files: withManifest({ ...realManifest, display: "browser" }),
          },
          {
            name: "scope with a trailing slash",
            expect: "fail",
            files: withManifest({ ...realManifest, scope: "/dashboard/" }),
          },
        ]
      : []),
    { name: "an icon the build did not emit", expect: "fail", files: withoutIcon },
    ...(worker
      ? [
          { name: "a worker that activates itself", expect: "fail", files: selfActivating },
          {
            name: "a worker whose never-cache list is empty",
            expect: "fail",
            files: cachesEverything,
          },
        ]
      : []),
  ];

  let ok = missing.length === 0;
  for (const scenario of scenarios) {
    currentFiles = scenario.files;
    const results = await runChecks(base);
    // The healthy run is printed in full, so `--self-test` also shows what the
    // checker says about a correct deploy rather than only counting scenarios.
    if (scenario.expect === "pass") report(results);
    const passed = results.every((result) => result.status !== "fail");
    const asExpected = scenario.expect === "pass" ? passed : !passed;
    const failures = results
      .filter((result) => result.status === "fail")
      .map((result) => result.label);
    console.log(
      `${asExpected ? "ok  " : "BAD "}${scenario.name}: ${passed ? "passed" : `failed (${failures.join("; ")})`}`,
    );
    if (!asExpected) ok = false;
  }

  await new Promise((resolve) => server.close(resolve));
  console.log(ok ? "\nself-test passed" : "\nself-test FAILED");
  return ok;
}

// ---------------------------------------------------------------------- main

const argument = process.argv[2];
if (argument === "--self-test") {
  process.exitCode = (await selfTest()) ? 0 : 1;
} else if (!argument || !/^https?:\/\//.test(argument)) {
  console.error("usage: node scripts/pwa-check.mjs https://nyuz.app");
  console.error("       node scripts/pwa-check.mjs --self-test   (after npm run build)");
  process.exitCode = 2;
} else {
  const results = await runChecks(argument);
  process.exitCode = report(results) ? 0 : 1;
}
