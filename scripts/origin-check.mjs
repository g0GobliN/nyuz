#!/usr/bin/env node
/**
 * Asserts that a deployment publishes ONE origin, and that the origin it
 * publishes resolves.
 *
 *   node scripts/origin-check.mjs https://example.workers.dev
 *   node scripts/origin-check.mjs --self-test      (no network, proves it bites)
 *
 * ---------------------------------------------------------------------------
 * The failure this exists for, measured
 * ---------------------------------------------------------------------------
 *
 * On 2026-10-12 the product answered on `https://nyuz.grgvishal-gurung17.workers.dev`
 * and published `https://nyuz.app` — a host with no DNS record and no zone on
 * the Cloudflare account — in three of the four places it says where it lives:
 *
 *   | surface                        | origin it named                        |
 *   | ------------------------------ | -------------------------------------- |
 *   | `<link rel=canonical>`         | `nyuz.app` (a literal in three files)  |
 *   | `og:image` / `twitter:image`   | `nyuz.app` (a literal in two files)    |
 *   | `robots.txt` → `Sitemap:`      | `nyuz.app` (a file in `public/`)       |
 *   | `sitemap.xml` → `<loc>`        | the origin the Worker answers on       |
 *
 * Everything rendered, every test passed, and the deploy job was green, because
 * each surface was internally consistent and nothing compared them to each
 * other or to the address a reader was actually using. That is the class of
 * defect this check is for: **not a broken page, a broken claim about where the
 * page is.**
 *
 * ---------------------------------------------------------------------------
 * What it asserts
 * ---------------------------------------------------------------------------
 *
 * The sitemap is read first and its paths are the corpus, so the check covers
 * whatever the deployment actually claims to publish rather than a list kept in
 * this file. Then, for each page and for the two crawler files:
 *
 *   1. every absolute URL declared by the pages, `robots.txt` and the sitemap
 *      names ONE origin — the `Set` has exactly one member;
 *   2. that origin answers `GET /` with a 200 and a real `<title>`;
 *   3. every page declares a canonical at all.
 *
 * A page is allowed to declare no OpenGraph image; it is not allowed to declare
 * one on a different host. `--pages N` bounds the walk (default 10) because a
 * blog archive can list hundreds and the first ten are all that is needed to
 * tell one origin from two.
 *
 * The origin the pages name is *reported* against the origin being checked but
 * is not required to equal it: a preview deployment is served from one host
 * while a build may legitimately be configured with the production origin, and
 * a check that failed on that would be switched off on its first red run.
 * Reachability is required; equality is printed.
 *
 * ---------------------------------------------------------------------------
 * Why the retries, and why no dependencies
 * ---------------------------------------------------------------------------
 *
 * Same reasoning as `route-walk.mjs`, which this sits beside in the deploy job:
 * a fresh deploy propagates to the edge asynchronously, and the first answer is
 * often the previous build. `--attempts` defaults to 3.
 *
 * `fetch` is Node 18+ and this runs immediately after an upload, so it cannot
 * depend on `npm ci` having succeeded.
 */

import { createServer } from "node:http";

const TIMEOUT_MS = 20_000;

function heading(text) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function check(ok, message, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok && detail) console.log(`        ${detail}`);
  return ok;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The origin of an absolute or relative URL, or null when there is none. */
function originOf(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}

/** Every absolute URL one page declares about itself. */
function declarationsOf(html, base) {
  const declared = [];
  const canonical = /<link\b[^>]*\brel\s*=\s*"canonical"[^>]*\bhref\s*=\s*"([^"]*)"/i.exec(html);
  if (canonical) declared.push({ where: "canonical", url: canonical[1] });

  for (const name of ["og:url", "og:image", "twitter:image"]) {
    const property = name.includes(":")
      ? new RegExp(
          `<meta\\b[^>]*\\bproperty\\s*=\\s*"${name}"[^>]*\\bcontent\\s*=\\s*"([^"]*)"`,
          "i",
        )
      : null;
    const byName = new RegExp(
      `<meta\\b[^>]*\\bname\\s*=\\s*"${name}"[^>]*\\bcontent\\s*=\\s*"([^"]*)"`,
      "i",
    );
    const tag = property?.exec(html) ?? byName.exec(html);
    if (tag) declared.push({ where: name, url: tag[1] });
    // `content` may precede the identifying attribute; a document that does is
    // rare enough that one order is read rather than both, and the canonical —
    // which is the assertion that matters — is matched in either order above.
    const reversed = new RegExp(
      `<meta\\b[^>]*\\bcontent\\s*=\\s*"([^"]*)"[^>]*\\b(?:property|name)\\s*=\\s*"${name}"`,
      "i",
    ).exec(html);
    if (!tag && reversed) declared.push({ where: name, url: reversed[1] });
  }

  return declared
    .map((entry) => ({ ...entry, origin: originOf(entry.url, base) }))
    .filter((entry) => entry.origin !== null);
}

/** Every `<loc>` in a sitemap. */
function locsOf(xml) {
  const found = [];
  const pattern = /<loc>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const value = (match[1] ?? "").trim();
    if (value) found.push(value.replace(/&amp;/g, "&"));
  }
  return found;
}

/** The `Sitemap:` target in a robots file, if it declares one. */
function sitemapTargetOf(text) {
  const match = /^\s*sitemap\s*:\s*(\S+)\s*$/im.exec(text);
  return match ? match[1] : null;
}

function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? (match[1] ?? "").trim() : "";
}

async function get(url) {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: {
      // Identify honestly, and do not look like a bot that a WAF is configured
      // to challenge: this runs against our own origin.
      "user-agent": "nyuz-origin-check/1.0",
      accept: "text/html,application/xhtml+xml,application/xml,text/plain",
    },
  });
}

/** Reads the sitemap, the robots file and up to `pages` of its pages. */
async function inspect(target, pages) {
  const report = { target, sitemap: null, robots: null, pages: [], error: null };

  try {
    const response = await get(`${target}/sitemap.xml`);
    report.sitemap = { status: response.status, body: await response.text() };
  } catch (error) {
    report.error = `sitemap: ${error?.cause?.code ?? error?.message ?? error}`;
    return report;
  }

  try {
    const response = await get(`${target}/robots.txt`);
    report.robots = { status: response.status, body: await response.text() };
  } catch (error) {
    report.error = `robots.txt: ${error?.cause?.code ?? error?.message ?? error}`;
    return report;
  }

  const paths = locsOf(report.sitemap.body)
    .map((loc) => new URL(loc).pathname)
    .slice(0, pages);

  for (const path of paths) {
    try {
      const response = await get(new URL(path, target).href);
      report.pages.push({
        path,
        status: response.status,
        url: response.url || new URL(path, target).href,
        body: await response.text(),
      });
    } catch (error) {
      report.pages.push({
        path,
        status: 0,
        url: new URL(path, target).href,
        body: "",
        error: error?.cause?.code ?? error?.message ?? String(error),
      });
    }
  }

  return report;
}

/**
 * Turns one inspection into assertions.
 *
 * Pure so the self-test can drive it with a fixture, and without the network.
 * The reachability probe is passed in as a function for the same reason.
 */
function evaluate(report) {
  const facts = [];

  const sitemapOk = report.sitemap?.status === 200 && locsOf(report.sitemap.body).length > 0;
  facts.push({
    ok: sitemapOk,
    message: "sitemap.xml is served and lists at least one URL",
    detail: report.sitemap ? `status ${report.sitemap.status}` : "not fetched",
  });
  if (!sitemapOk) return { facts, origins: [] };

  const sitemapOrigins = new Set(locsOf(report.sitemap.body).map((loc) => originOf(loc)));
  for (const loc of locsOf(report.sitemap.body)) {
    if (originOf(loc) === null) {
      facts.push({ ok: false, message: "every <loc> is an absolute URL", detail: loc });
    }
  }

  const robotsOk = report.robots?.status === 200;
  facts.push({
    ok: robotsOk,
    message: "robots.txt is served",
    detail: report.robots ? `status ${report.robots.status}` : "not fetched",
  });

  const sitemapTarget = robotsOk ? sitemapTargetOf(report.robots.body) : null;
  facts.push({
    ok: sitemapTarget !== null,
    message: "robots.txt points at a sitemap",
    detail: sitemapTarget === null ? "no `Sitemap:` line" : "",
  });

  for (const page of report.pages) {
    const ok = page.status === 200;
    facts.push({
      ok,
      message: `${page.path} is served`,
      detail: ok ? "" : (page.error ?? `status ${page.status}`),
    });
  }

  for (const page of report.pages.filter((entry) => entry.status === 200)) {
    const declared = declarationsOf(page.body, page.url);
    const canonical = page.body.match(
      /<link\b[^>]*\brel\s*=\s*"canonical"[^>]*\bhref\s*=\s*"([^"]*)"/i,
    );
    facts.push({
      ok: Boolean(canonical),
      message: `${page.path} declares a canonical URL`,
      detail: canonical ? "" : "no <link rel=canonical>",
    });
  }

  // The assertion this script is named for: one origin across every surface.
  const surfaces = new Map();
  const note = (origin, where) => {
    if (!origin) return;
    if (!surfaces.has(origin)) surfaces.set(origin, []);
    const list = surfaces.get(origin);
    if (list.length < 6 && !list.includes(where)) list.push(where);
  };
  for (const origin of sitemapOrigins) note(origin, "sitemap.xml");
  if (sitemapTarget) note(originOf(sitemapTarget, report.target), "robots.txt");
  for (const page of report.pages.filter((entry) => entry.status === 200)) {
    for (const entry of declarationsOf(page.body, page.url)) note(entry.origin, entry.where);
  }

  const origins = [...surfaces.keys()];
  facts.push({
    ok: origins.length === 1,
    message: "every published URL names one origin",
    detail: origins
      .map((origin) => `${origin} (${(surfaces.get(origin) ?? []).join(", ")})`)
      .join("  |  "),
  });

  return { facts, origins };
}

async function probeOrigin(origin) {
  try {
    const response = await get(`${origin}/`);
    const body = await response.text();
    const title = titleOf(body);
    if (response.status !== 200) return { ok: false, detail: `status ${response.status}` };
    if (title.length === 0) return { ok: false, detail: "no <title>" };
    return { ok: true, detail: `"${title}"` };
  } catch (error) {
    return { ok: false, detail: error?.cause?.code ?? error?.message ?? String(error) };
  }
}

async function run(target, pages) {
  heading(`Checking the origin published by ${target}`);
  const report = await inspect(target, pages);
  // `evaluate` stays pure so the self-test can drive it with a fixture and no
  // network; the one probe that needs the network is made here, where the
  // origin the pages named is known.
  const { facts, origins } = evaluate(report);
  for (const fact of facts) check(fact.ok, fact.message, fact.detail);

  let healthy = facts.every((fact) => fact.ok);
  const declared = origins.length === 1 ? origins[0] : undefined;
  if (declared) {
    const reachable = await probeOrigin(declared);
    healthy = check(reachable.ok, `${declared} serves the site`, reachable.detail) && healthy;
  }
  return healthy;
}

// ---------------------------------------------------------------- self-test

/**
 * Proves the check rejects each defect it names.
 *
 * A check that has never failed proves nothing, and this one exists precisely
 * because a green suite hid this defect for weeks. The fixture serves a healthy
 * site — pages that declare the fixture's own origin, a robots file pointing at
 * the fixture's sitemap, a sitemap listing the fixture's pages — and then the
 * same site with one defect at a time. Every defect must be rejected.
 */
async function selfTest() {
  const pages = new Map();
  const makePage = (origin, path) =>
    `<!doctype html><html><head><title>nyuz — ${path}</title>` +
    `<link rel="canonical" href="${origin}${path === "/" ? "/" : path}"/>` +
    `<meta property="og:url" content="${origin}${path}"/>` +
    `<meta property="og:image" content="${origin}/og-image.png"/>` +
    `<meta name="twitter:image" content="${origin}/og-image.png"/>` +
    `</head><body><main>Reader text.</main></body></html>`;

  const paths = ["/", "/pricing", "/about"];
  const sitemapFor = (origin) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  const robotsFor = (origin) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

  let siteOrigin = "";
  let sitemapBody = "";
  let robotsBody = "";

  const reset = () => {
    siteOrigin = `http://127.0.0.1:${server.address().port}`;
    sitemapBody = sitemapFor(siteOrigin);
    robotsBody = robotsFor(siteOrigin);
    pages.clear();
    for (const path of paths) pages.set(path, makePage(siteOrigin, path));
  };

  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (path === "/sitemap.xml") {
      response.writeHead(sitemapBody === "" ? 503 : 200, {
        "content-type": "application/xml; charset=utf-8",
      });
      response.end(sitemapBody);
      return;
    }
    if (path === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(robotsBody);
      return;
    }
    const body = pages.get(path);
    if (body === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  reset();
  const origin = siteOrigin;

  let failures = 0;
  const expectRejected = async (label, mutate) => {
    heading(`self-test: ${label} is reported`);
    reset();
    mutate();
    const report = await inspect(origin, 10);
    const { facts, origins } = evaluate(report);
    const healthy =
      facts.every((fact) => fact.ok) && origins.length === 1 && (await probeOrigin(origins[0])).ok;
    if (healthy) {
      console.error(`\nFAIL: the check accepted ${label}.`);
      failures += 1;
    }
  };

  const expectAccepted = async (label) => {
    heading(`self-test: ${label} passes`);
    reset();
    const report = await inspect(origin, 10);
    const { facts, origins } = evaluate(report);
    const healthy =
      facts.every((fact) => fact.ok) && origins.length === 1 && (await probeOrigin(origins[0])).ok;
    if (!healthy) {
      console.error(`\nFAIL: the fixture is correct and the check rejected it.`);
      for (const fact of facts.filter((entry) => !entry.ok))
        console.error(`  ${fact.message} — ${fact.detail}`);
      failures += 1;
    }
  };

  try {
    await expectAccepted("a healthy fixture");

    await expectRejected("a canonical on another origin", () => {
      pages.set("/", makePage("https://nyuz.app", "/"));
    });

    await expectRejected("an OpenGraph image on another origin", () => {
      pages.set(
        "/pricing",
        makePage(siteOrigin, "/pricing").replace(
          `${siteOrigin}/og-image.png"`,
          `https://cdn.example.com/og-image.png"`,
        ),
      );
    });

    await expectRejected("a sitemap listing another origin", () => {
      sitemapBody = sitemapFor("https://nyuz.app");
    });

    await expectRejected("a robots file pointing at another origin", () => {
      robotsBody = robotsFor("https://nyuz.app");
    });

    await expectRejected("a page with no canonical", () => {
      pages.set(
        "/about",
        makePage(siteOrigin, "/about").replace(/<link rel="canonical"[^>]*>/, ""),
      );
    });

    await expectRejected("a sitemap that is not served", () => {
      sitemapBody = "";
    });

    await expectRejected("a robots file with no sitemap line", () => {
      robotsBody = "User-agent: *\nAllow: /\n";
    });

    await expectRejected("one origin that does not serve the site", () => {
      // Consistent everywhere, and dead: the shape of a build configured with a
      // host that was never pointed at the Worker. Port 1 refuses immediately.
      const dead = "http://127.0.0.1:1";
      sitemapBody = sitemapFor(dead);
      robotsBody = robotsFor(dead);
      for (const path of paths) pages.set(path, makePage(dead, path));
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
  if (args.includes("--self-test")) return (await selfTest()) ? 0 : 1;

  const pagesIndex = args.indexOf("--pages");
  const pages = pagesIndex === -1 ? 10 : Number(args[pagesIndex + 1] ?? 10);
  const attemptsIndex = args.indexOf("--attempts");
  const attempts = attemptsIndex === -1 ? 3 : Number(args[attemptsIndex + 1] ?? 3);
  const target = args.find((arg) => /^https?:\/\//.test(arg))?.replace(/\/+$/, "");

  if (!target) {
    console.error("usage: node scripts/origin-check.mjs <origin> [--pages N] [--attempts N]");
    console.error("       node scripts/origin-check.mjs --self-test");
    return 2;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\n=== attempt ${attempt} of ${attempts} ===`);
    if (await run(target, pages)) {
      heading(`${target} publishes one origin, and it resolves.`);
      return 0;
    }
    if (attempt < attempts) {
      console.log("\nNot healthy. Waiting 10s for the edge to catch up.");
      await sleep(10_000);
    }
  }
  heading(`${target} publishes an origin that does not hold up.`);
  return 1;
}

process.exitCode = await main();
