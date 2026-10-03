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
 */

const PLACEHOLDER_HOST = "ci-placeholder.supabase.co";

/** The public pages a reader reaches without a session. */
const PUBLIC_ROUTES = [
  { path: "/", title: /nyuz/i },
  { path: "/how-it-works", title: /how nyuz works/i },
  { path: "/pricing", title: /pricing/i },
  { path: "/about", title: /about/i },
  { path: "/blog", title: /blog/i },
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
    const noise = watch(page);
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path, { waitUntil: "networkidle" });
    }
    expect(realFailures(noise)).toEqual([]);
  });
});

function baseOf(page: Page, href: string): string {
  return new URL(href, page.url()).href;
}
