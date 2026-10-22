import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Browser smoke tests against the built Worker.
 *
 * ---------------------------------------------------------------------------
 * The rule this file follows
 *
 * Every assertion below is about something a reader can observe: a status, a
 * heading, a URL, a document the browser refuses to install. None of them reach
 * into the application. That is deliberate — a test that imports the component it
 * is testing cannot catch the failure this exists for, which is the failure that
 * only appears once a bundle is loaded by a browser that was handed a document by
 * a Worker.
 *
 * Two placeholders stand in for the database. Public content reads never throw
 * and fall back to the copy bundled in the components, so the marketing pages
 * render exactly what production renders before anybody edits a headline. The
 * client then tries to reach `ci-placeholder.supabase.co`, which does not exist:
 * failures to that host are expected here and are excluded from the network
 * assertions below, while a failure to any other host is a real defect.
 *
 * The one page this job cannot render is `/blog`. Its route is gated on the
 * `blog` feature flag and that gate is fail-closed: with no database the flag
 * resolves off and the route answers 404 on purpose. That is the gate working,
 * not a broken page, so the suite asserts the gate's own contract instead of a
 * 200 — the home page's link and the route flip together, and
 * `blogIsAdvertised` below reads the link to decide which state is on.
 */

const PLACEHOLDER_HOST = "ci-placeholder.supabase.co";

/**
 * The public pages a reader reaches without a session.
 *
 * `/blog` is deliberately absent: it is behind the fail-closed `blog` flag, so
 * this list holds only the pages that render in every environment. The blog is
 * covered by `the blog and its link appear together, or neither does` below.
 */
const PUBLIC_ROUTES = [
  { path: "/", title: /nyuz/i },
  { path: "/how-it-works", title: /how nyuz works/i },
  { path: "/pricing", title: /pricing/i },
  { path: "/about", title: /about/i },
  { path: "/legal/terms", title: /terms/i },
  { path: "/legal/privacy", title: /privacy/i },
] as const;

/**
 * Strings that mean a template rendered a value it did not have.
 *
 * `undefined` and `NaN` reach a page when a loader's data is missing and a
 * component interpolates it anyway; `[object Object]` when an object is
 * stringified into a text node. Both ship, both look like content, and neither
 * is caught by a type check.
 */
const RENDER_FAILURES = [/undefined/, /\bNaN\b/, /\[object Object\]/];

interface Noise {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/** Collects everything the browser complained about while the page was open. */
function watch(page: Page): Noise {
  const noise: Noise = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") noise.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => noise.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    noise.failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    // A 4xx/5xx the page did not ask for is a defect even when the request
    // "succeeded" at the network level. The placeholder host is excluded for the
    // same reason as `requestfailed`: it cannot exist by design.
    if (response.status() >= 400 && !response.url().includes(PLACEHOLDER_HOST)) {
      noise.failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  return noise;
}

function realFailures(noise: Noise): string[] {
  return [
    ...noise.consoleErrors,
    ...noise.pageErrors,
    ...noise.failedRequests.filter((entry) => !entry.includes(PLACEHOLDER_HOST)),
  ];
}

/**
 * Whether the site is advertising the blog right now.
 *
 * `src/routes/blog/index.tsx` states the contract: the flag is a 404 rather
 * than a hidden link, and flipping it "reveals the nav link and the route
 * together, so the two cannot disagree". With no database behind this job the
 * flag reads off, so `/blog` is supposed to 404 — and the home page's own
 * markup is the honest way to ask which state is on, because the link is the
 * flag's observable half. Reading it from the rendered page rather than
 * importing the flag keeps this suite outside the application.
 */
async function blogIsAdvertised(page: Page): Promise<boolean> {
  await page.goto("/", { waitUntil: "networkidle" });
  // Exact match: the landing page's hard-coded `/blog/why-i-built-nyuz` link is
  // not the nav's, and must not be mistaken for it.
  return (await page.locator('a[href="/blog"]').count()) > 0;
}

test.describe("the built site answers a request", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} renders a page a reader can read`, async ({ page }) => {
      const noise = watch(page);
      const response = await page.goto(route.path, { waitUntil: "networkidle" });

      expect(response?.status(), `${route.path} status`).toBe(200);
      await expect(page).toHaveTitle(route.title);

      // A body that collapsed to an empty shell still returns 200 and still
      // carries the title in the head, so the height is the assertion that
      // separates a rendered page from a blank one.
      const height = await page.evaluate(() => document.body.scrollHeight);
      expect(height, `${route.path} rendered height`).toBeGreaterThan(400);

      const text = await page.locator("body").innerText();
      for (const failure of RENDER_FAILURES) {
        expect(text, `${route.path} must not render ${failure}`).not.toMatch(failure);
      }
      expect(realFailures(noise), `${route.path} browser errors`).toEqual([]);
    });
  }

  test("the blog and its link appear together, or neither does", async ({ page }) => {
    // The gate is the contract, so this asserts the pair: a site that
    // advertises the blog must serve it, and a site that does not must 404 it.
    // Either way, neither half may disagree with the other.
    const advertised = await blogIsAdvertised(page);
    const noise = watch(page);
    const response = await page.goto("/blog", { waitUntil: "networkidle" });

    if (!advertised) {
      expect(response?.status(), "the gate is off, so the route answers 404").toBe(404);
      await expect(page.locator("h1")).toHaveText("Nothing here.");
      // The browser logs the 404 itself, which is this page working as
      // designed; what must not appear is a script that threw while rendering
      // the 404 page.
      expect(noise.pageErrors, "the 404 page did not throw").toEqual([]);
      return;
    }

    expect(response?.status(), "the flag is on, so the route renders").toBe(200);
    await expect(page).toHaveTitle(/blog/i);
    const height = await page.evaluate(() => document.body.scrollHeight);
    expect(height, "/blog rendered height").toBeGreaterThan(400);
    const text = await page.locator("body").innerText();
    for (const failure of RENDER_FAILURES) {
      expect(text, `/blog must not render ${failure}`).not.toMatch(failure);
    }
    expect(realFailures(noise), "/blog browser errors").toEqual([]);
  });

  test("the home page shows the copy, not an error page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // `getPublicSiteContent` falls back to the bundled defaults when the read
    // fails, so this asserts the fallback chain itself: the page is real even
    // with no database behind it.
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /nyuz/i }).first()).toBeVisible();
    expect(await page.locator("main").count()).toBeGreaterThan(0);
  });

  test("an address that does not exist is a 404, not a page of copy", async ({ page }) => {
    const response = await page.goto("/no-such-page", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(404);
    // A 200 that renders the landing page would pass a link check and fail a
    // reader, and would make every broken link on the site look fine. The status
    // above is the assertion; this one is the sentence that tells a reader they
    // are not looking at a story that failed to load.
    await expect(page.locator("h1")).toHaveText("Nothing here.");
  });

  test("the reader's own pages do not overflow a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/", "/pricing", "/how-it-works"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // The PWA shell, safe-area insets and the mobile nav all live at this
      // width; a horizontal scrollbar here is the regression this catches.
      expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("the guards hold for a visitor with no session", () => {
  test("the dashboard sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    // The session lives in browser storage, so the guard runs on the client and
    // the server cannot redirect. A dashboard shell served to a stranger is not
    // a failure by itself -- the data is what must not appear -- so the
    // assertion is that the guard fires at all.
    await page.waitForURL(/\/auth/, { timeout: 15_000 });
    expect(page.url()).toContain("/auth");
  });

  test("the console does not admit that it exists", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "networkidle" });
    // Deliberately a 404 in the UI rather than a sign-in wall: a stranger who
    // learns that a console exists and is merely not on the list gains nothing
    // they can use. The real boundary is `adminOnly` in src/lib/server/guard.ts,
    // which re-reads the role from the database on every call -- this asserts
    // the page agrees with it.
    await expect(page.getByText("Not found.")).toBeVisible();
    await expect(page.locator("nav")).toHaveCount(0);
  });
});

test.describe("the origin keeps its promises", () => {
  test("the health endpoint stays hidden without its token", async ({ request }) => {
    const response = await request.get("/api/health");
    // 404, not 401: an endpoint that says "I exist and you may not" is a map.
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  test("the manifest is served and the document installs from it", async ({ page }) => {
    const link = page.locator('link[rel="manifest"]');
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();

    const manifest = await page.request.get(href!);
    expect(manifest.status()).toBe(200);
    const body = (await manifest.json()) as {
      name?: string;
      display?: string;
      icons?: { src: string; sizes: string; type: string }[];
    };
    expect(body.name).toBeTruthy();
    expect(body.display).toBeTruthy();
    // `viewport-fit=cover` is what lets the app draw under the notch; without it
    // the install prompt arrives and the layout is wrong on the device.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    for (const icon of body.icons ?? []) {
      expect(icon.sizes, `${icon.src} declares its size`).toBeTruthy();
      const file = await page.request.get(new URL(icon.src, baseOf(page, href!)).href);
      expect(file.status(), `${icon.src} is served`).toBe(200);
    }
  });

  test("a route walk never serves a broken asset", async ({ page }) => {
    // This test needs its own budget, and the reason is arithmetic rather than
    // a slow page.
    //
    // It walks the six public routes in PUBLIC_ROUTES, plus "/blog" when the
    // site advertises it, each with `waitUntil: "networkidle"`, and the suite's
    // 30s ceiling is shared across all of them. Measured with the timeout
    // raised so the walk could report its own duration, the total on this tree
    // was 43-73s across runs, on a box with a load average of 22-43 on 4 cores
    // because other agents were building concurrently. The budget was already
    // too small before anything in this repository changed.
    //
    // The cost is not the server. Every page answers in well under a second
    // against the local Worker. The cost is that each navigation waits for the
    // network to go idle, and workerd's FIRST request pays its cold start
    // (~2.2s); the rest are warm.
    //
    // What the walk was actually spending its time on was a duplicate load:
    // `blogIsAdvertised` opened "/" to read the nav link, and then the walk
    // opened "/" again as its first route. Those two navigations measured
    // 33-52% of the walk's total in every run. That duplicate is gone below —
    // the link is read during the walk's own visit to "/" — so the structural
    // cost is fixed rather than merely tolerated.
    //
    // The remaining budget is margin, not a fix. `networkidle` is not the thing
    // to weaken: the assertion is that no asset failed, and `watch()` counts a
    // `requestfailed`, which fires when a request is ABORTED. Ending the walk
    // early would abort the next page's own requests and report them as broken
    // assets, turning a slow test into a false one. So the wait stays and the
    // budget moves.
    test.setTimeout(120_000);

    const routes: string[] = PUBLIC_ROUTES.map((route) => route.path);

    // `watch` is attached before the first navigation, so the landing page is
    // inside the same asset check as the rest of the walk. `/` is
    // `PUBLIC_ROUTES[0]`, so reading the blog link here costs nothing extra and
    // visits exactly the routes the old version did.
    //
    // The blog link is only on the landing page, so the first route has to BE
    // "/". Asserted rather than assumed: if someone reorders PUBLIC_ROUTES,
    // the probe below would read some other page, find no blog link, and
    // silently drop "/blog" out of the walk — a gate that quietly covers less,
    // with nothing failing. One line turns that into a loud failure.
    expect(routes[0], "the walk reads the blog link on the landing page").toBe("/");

    const noise = watch(page);
    const [first, ...remaining] = routes;
    await page.goto(first!, { waitUntil: "networkidle" });

    // The blog joins the walk only when the site is advertising it: a
    // deliberate 404 for a gated page is not a broken asset, and walking it
    // regardless would report the gate as a defect. Exact match: the landing
    // page's hard-coded `/blog/why-i-built-nyuz` link is not the nav's, and
    // must not be mistaken for it.
    if ((await page.locator('a[href="/blog"]').count()) > 0) remaining.push("/blog");

    for (const route of remaining) {
      await page.goto(route, { waitUntil: "networkidle" });
    }
    expect(realFailures(noise)).toEqual([]);
  });
});

function baseOf(page: Page, href: string): string {
  return new URL(href, page.url()).href;
}
