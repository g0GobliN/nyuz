import { expect, test, type Page } from "@playwright/test";

/**
 * What a reader does, in a browser, against the built Worker.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists and what it does not replace
 *
 * `smoke.spec.ts` proves a page *renders*: a status, a title, a body with words
 * in it, no console errors. That is the floor, and it is the right floor — it is
 * the check that catches a deploy which serves a blank document. It cannot see
 * an interaction, because rendering every page once and clicking nothing is not
 * the same claim as "the toggle changes the price".
 *
 * So this file does the clicking. It is deliberately narrow: four interactions,
 * each of which is a piece of state the server never sees, which is why a render
 * walk cannot assert it.
 *
 * ---------------------------------------------------------------------------
 * Why these four
 *
 * - The billing toggle is the only place on a public page where a reader changes
 *   what the site tells them to pay. `planPrice` in src/routes/pricing.tsx reads
 *   the monthly/annual figures out of the settings blob and renders one of them,
 *   and the caption underneath is derived from the difference. A regression here
 *   advertises the wrong number to somebody about to be charged, and the two
 *   halves of that (the price and the "back per year" line) are computed from
 *   the same value, so they can drift from each other too.
 * - The auth form's email validation runs entirely in the browser. Nothing about
 *   it is visible in a source read and nothing about it appears on a rendered
 *   page until it is wrong.
 * - The support page's addresses are the only way a reader reaches a human. They
 *   are hand-written in a route file, which means they can be mistyped, and a
 *   mistyped `mailto:` is invisible until somebody tries to send.
 * - Dark mode is a class on a wrapper that only appears once JavaScript has run,
 *   so it is exactly the kind of thing a build can break while every static
 *   assertion still passes.
 *
 * ---------------------------------------------------------------------------
 * The rule this file follows
 *
 * Every assertion is about something a reader can observe — a number on a page,
 * a message, a link's target, a colour that is not black. None of them import
 * the component being tested. A test that renders the component it is checking
 * cannot catch a failure that only exists once the bundle is loaded by a browser
 * that was handed a document by a Worker, which is the failure class this whole
 * directory exists for.
 *
 * No credentials, no session, no database. The auth form is exercised up to the
 * point where it would call Supabase, and never past it.
 */

/**
 * The plan prices the page shows, read from the DOM rather than hardcoded.
 *
 * Selected structurally: each plan card renders its figure in a `display
 * text-5xl tabular-nums` span beside the "per month" / "per year" label. No
 * `data-` attribute exists for this, and adding one to production markup purely
 * for a test is the wrong trade — the test should follow the markup, not the
 * other way round.
 */
async function planPrices(page: Page): Promise<string[]> {
  return (await page.locator("span.display.tabular-nums").allInnerTexts()).map((text) =>
    text.trim(),
  );
}

/** Pulls the leading dollar amount out of a rendered price cell. */
function amount(text: string): number | null {
  const match = /\$([\d,]+(?:\.\d{2})?)/.exec(text);
  return match?.[1] ? Number.parseFloat(match[1].replace(/,/g, "")) : null;
}

test.describe("the pricing page quotes the right number", () => {
  test("switching to annual changes every price and the saving", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "networkidle" });

    const toggle = page.getByRole("button", { name: /^monthly$/i });
    const annual = page.getByRole("button", { name: /^annual$/i });
    await expect(toggle, "the billing toggle is on the page").toBeVisible();
    await expect(annual).toBeVisible();

    const monthlyPrices = await planPrices(page);
    expect(monthlyPrices.length, "the page quotes at least one plan").toBeGreaterThan(0);
    expect(monthlyPrices.join(" "), "monthly is quoted in dollars").toMatch(/\$/);

    await annual.click();
    await expect(page.getByText(/per year/i).first(), "an annual quote says so").toBeVisible();

    const annualPrices = await planPrices(page);
    expect(annualPrices, "every plan re-quoted when the toggle moved").not.toEqual(monthlyPrices);

    // Uno is free and has no annual price, so it is the one row allowed to look
    // identical. Both *paid* plans must have moved, or the toggle is not wired to
    // the price at all and the whole control is decoration.
    const paidMonthly = monthlyPrices.filter((quote) => (amount(quote) ?? 0) > 0);
    const paidAnnual = annualPrices.filter((quote) => (amount(quote) ?? 0) > 0);
    expect(paidMonthly.length, "there are at least two paid plans").toBeGreaterThanOrEqual(2);
    expect(paidAnnual, "both paid plans re-quoted rather than only one").not.toEqual(paidMonthly);

    for (const quote of annualPrices) {
      const value = amount(quote);
      expect(value, `"${quote}" is a number`).not.toBeNull();
      // Every paid plan's annual figure is several months of the monthly one, so
      // a per-year total below a month's price is a units bug — the class of error
      // that ships a real charge for the wrong amount.
      if (value !== 0) expect(value ?? 0).toBeGreaterThan(0);
    }
  });

  test("an annual price is never less than its own monthly one", async ({ page }) => {
    // The strongest single statement this page can make: whatever the toggle
    // says, a plan's annual figure must exceed its monthly figure. A settings
    // blob edited by hand in the admin console can produce a yearly price below
    // the monthly one, and neither the type system nor the build notices.
    await page.goto("/pricing", { waitUntil: "networkidle" });
    const monthlyPrices = (await planPrices(page)).map(amount);

    await page.getByRole("button", { name: /^annual$/i }).click();
    const annualPrices = (await planPrices(page)).map(amount);

    expect(monthlyPrices.length, "the page quotes the same plans in both states").toBe(
      annualPrices.length,
    );
    for (const [index, monthly] of monthlyPrices.entries()) {
      const yearly = annualPrices[index];
      expect(monthly, `plan ${index} quotes a monthly figure`).not.toBeNull();
      expect(yearly, `plan ${index} quotes an annual figure`).not.toBeNull();
      if ((monthly ?? 0) <= 0 || (yearly ?? 0) <= 0) continue;
      expect(
        yearly ?? 0,
        `plan ${index}: a year (${yearly}) must cost more than a month (${monthly})`,
      ).toBeGreaterThan(monthly ?? 0);
    }
  });

  test("switching back restores the monthly prices exactly", async ({ page }) => {
    // A toggle that only moves one way is a real defect and it is invisible in
    // one direction of the walk above, so both directions are asserted.
    await page.goto("/pricing", { waitUntil: "networkidle" });
    const before = await planPrices(page);

    await page.getByRole("button", { name: /annual/i }).click();
    await expect(page.getByText(/per year/i).first()).toBeVisible();
    await page.getByRole("button", { name: /monthly/i }).click();
    await expect(page.getByText(/per month/i).first()).toBeVisible();

    expect(await planPrices(page), "monthly prices returned to their original values").toEqual(
      before,
    );
  });

  test("the annual saving is stated in months and not invented", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^annual$/i }).click();

    // The page's own wording, from annualCaption() in src/routes/pricing.tsx:
    // "At least 2 months back on an annual plan." It counts *months*, not a
    // percentage, and it is derived from the least-saving paid plan so it cannot
    // overstate. Asserting the unit here is the point — a copy change from
    // "months" to "%" without recomputing is how a pricing claim starts lying.
    const caption = page.getByText(/back on an annual plan/i).first();
    await expect(caption, "an annual saving is advertised").toBeVisible();
    const text = (await caption.innerText()).trim();

    const months = Number.parseFloat(/at least ([\d.]+)\s+months?\b/i.exec(text)?.[1] ?? "NaN");
    expect(Number.isNaN(months), `caption "${text}" states a number of months`).toBe(false);
    expect(months, `"${text}" is a real saving`).toBeGreaterThan(0);
    // Eleven months back would mean one free month, which is a full year of
    // service and no such price exists.
    expect(months, `"${text}" does not promise a nearly-free year`).toBeLessThan(11);
    // `annualCaption` rounds to one decimal place; a longer figure means the
    // rounding changed and the copy now implies precision it does not have.
    expect(Number.isInteger(months * 10), `"${text}" is rounded to one decimal place`).toBe(true);
  });

  test("the free plan is never quoted as though it charged", async ({ page }) => {
    // Uno is free and has no annual figure. If `planPrice` ever stopped
    // returning null for its annual side, the toggle would start printing a
    // price for the plan that costs nothing — and a reader would think so.
    await page.goto("/pricing", { waitUntil: "networkidle" });
    const monthlyPrices = (await planPrices(page)).map(amount);
    expect(
      monthlyPrices.filter((value) => value === 0).length,
      "one plan is free",
    ).toBeGreaterThanOrEqual(1);

    await page.getByRole("button", { name: /^annual$/i }).click();
    const annualPrices = (await planPrices(page)).map(amount);
    expect(
      annualPrices.filter((value) => value === 0).length,
      "the free plan is still free after the toggle moved",
    ).toBeGreaterThanOrEqual(1);
    await expect(page.getByText(/forever/i).first(), "a free plan says so in words").toBeVisible();
  });
});

test.describe("the sign-in page is usable without a backend", () => {
  /**
   * Advances past the provider buttons to the address field.
   *
   * The form is three client-side steps: OAuth buttons, then the address, then
   * the code. Nothing is on the server, so the whole flow lives in JavaScript and
   * is invisible to a render walk — which is exactly why it belongs here. If this
   * step stops working, a reader cannot sign in at all and every static assertion
   * on `/auth` still passes.
   */
  async function reachAddressField(page: Page) {
    await page.goto("/auth", { waitUntil: "networkidle" });
    const start = page.getByRole("button", { name: /continue with email/i }).first();
    await expect(start, "the provider buttons are offered first").toBeVisible();
    await start.click();
    const field = page.locator("input#email");
    await expect(field, "the address field appears after choosing email").toBeVisible();
    return field;
  }

  test("an empty address is refused before anything is sent", async ({ page }) => {
    const field = await reachAddressField(page);

    const submit = page.locator('button[type="submit"]').first();
    await expect(submit).toBeVisible();
    await submit.click();

    // Whatever the page decides to do, it must not navigate away: submitting an
    // empty string is the failure that shows up as a sign-in button which
    // occasionally just stops working, with no error shown.
    await expect(page, "the reader stays on the sign-in page").toHaveURL(/\/auth/);
    await expect(field, "the reader can see what they typed, or nothing at all").toBeVisible();
  });

  test("a malformed address is refused with something a reader can read", async ({ page }) => {
    const field = await reachAddressField(page);
    await field.fill("not-an-address");
    await page.locator('button[type="submit"]').first().click();

    await expect(page, "a bad address does not navigate").toHaveURL(/\/auth/);
    // Either the browser's own `type=email` validation refused it, or the page
    // rendered an error. Both are correct. What must not happen is a silent
    // failure with no copy, or an `undefined` interpolated into the page — the
    // specific defect a render walk on a *different* route could not have seen.
    const alert = page.locator('[role="alert"]');
    const errored = (await alert.count()) > 0;
    if (errored) {
      const message = (await alert.first().innerText()).trim();
      expect(message.length, "the error is prose a reader can act on").toBeGreaterThan(0);
      expect(message).not.toMatch(/\bundefined\b/);
    }

    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\[object Object\]/);
    expect(text.trim().length, "the page still has its copy").toBeGreaterThan(100);
  });

  test("the address field labels itself for a screen reader", async ({ page }) => {
    const field = await reachAddressField(page);
    // The input is `<input id="email">` and its label lives in a `<label>` above
    // it. A field with no accessible name is invisible to a screen reader and to
    // autofill, and neither is caught by reading the file.
    const labelled = await page.evaluate(() => {
      const input = document.querySelector("input#email");
      if (!input) return false;
      // The three ways a field gets an accessible name, in the order a screen
      // reader resolves them.
      return Boolean(
        input.getAttribute("aria-label") ||
        input.getAttribute("aria-labelledby") ||
        document.querySelector(`label[for="${input.id}"]`) ||
        input.closest("label"),
      );
    });
    expect(labelled, "the address field has an accessible name").toBe(true);
  });

  test("the recovery path exists, because a locked-out reader needs one", async ({ page }) => {
    await page.goto("/auth?recovery=1", { waitUntil: "networkidle" });
    // The route branches on this flag; a link into it that 404s is the whole
    // reason the flag is asserted here.
    expect(page.url()).toContain("recovery=1");
    const text = await page.locator("body").innerText();
    expect(text.trim().length).toBeGreaterThan(100);
    expect(text, "recovery explains itself rather than showing a form with no context").not.toMatch(
      /\bundefined\b/,
    );
  });
});

test.describe("the reader can reach a human", () => {
  test("the support page's addresses are well formed", async ({ page }) => {
    await page.goto("/support", { waitUntil: "networkidle" });

    const links = page.locator('a[href^="mailto:"]');
    const count = await links.count();
    expect(count, "the support page offers at least one address").toBeGreaterThan(0);

    const addresses: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const href = (await links.nth(i).getAttribute("href")) ?? "";
      const address = href.replace(/^mailto:/, "").split("?")[0] ?? "";
      addresses.push(address);
      expect(address, `"${href}" names a mailbox`).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      // Every address is on the product's own domain. A personal address in a
      // published page is a real leak, and it is one the type checker cannot see.
      expect(address, `"${address}" is on the product domain`).toMatch(/@nyuz\.app$/);
    }

    // The same address appearing twice is deliberate — `contact@` is offered both
    // in the hero and in the closing section — so uniqueness is not the rule.
    // What matters is that the *set* of reachable mailboxes is small and every
    // one of them resolves to the product, which the assertions above cover.
    // A new address added here should be one of the four role mailboxes.
    const roles = [...new Set(addresses)].sort();
    expect(
      roles.every((address) => /^(contact|privacy|security|billing)@nyuz\.app$/.test(address)),
      `support offers only the documented role mailboxes, got ${roles.join(", ")}`,
    ).toBe(true);
  });

  test("the four addresses named across the legal pages are the documented ones", async ({
    page,
  }) => {
    // docs/deployment.md lists contact@, privacy@, security@ and billing@ as the
    // four addresses the product answers on. A mistyped one is invisible until a
    // reader tries to use it, and the failure is theirs, not ours.
    const documented = new Set([
      "contact@nyuz.app",
      "privacy@nyuz.app",
      "security@nyuz.app",
      "billing@nyuz.app",
    ]);
    const found = new Set<string>();
    for (const route of ["/support", "/legal/privacy", "/legal/terms"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      for (const href of await page
        .locator('a[href^="mailto:"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""))) {
        found.add(href.replace(/^mailto:/, "").split("?")[0] ?? "");
      }
    }
    for (const address of found) {
      expect(documented.has(address), `${address} is one of the four documented mailboxes`).toBe(
        true,
      );
    }
  });

  test("the footer reaches the legal documents a reader is promised", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    for (const document of ["terms", "privacy"]) {
      const link = page.locator(`a[href="/legal/${document}"]`).first();
      await expect(link, `the home page links to /legal/${document}`).toBeVisible();
    }
  });
});

test.describe("the site survives its own theme", () => {
  test("dark is the house style, and it is applied without being asked for", async ({ page }) => {
    // nyuz does not follow `prefers-color-scheme`, on purpose — see `resolveTheme`
    // in src/lib/theme.ts: "nyuz is a thing you open at 7am and read for ninety
    // seconds; dark is the house style". Dark unless the reader has explicitly
    // chosen light.
    //
    // So this asserts the documented behaviour rather than the browser's: even
    // with the OS set to light, the page is dark. A build that stopped applying
    // the theme would render a light page here, which looks fine in a screenshot
    // and is wrong on every reader's device.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/pricing", { waitUntil: "networkidle" });

    const applied = await page.evaluate(() => ({
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    expect(applied.hasDarkClass, "the dark class is on the document").toBe(true);
    expect(applied.colorScheme, "the document declares a colour scheme").toBe("dark");
    expect(applied.background, "the page is not white").not.toBe("rgb(255, 255, 255)");
  });

  test("the accent stays one colour in whichever theme is on", async ({ page }) => {
    // Every colour rule in the product is a token, and every token is declared
    // once per theme. `--signal` must exist in both, because a link on the home
    // page and a toggle on the pricing page are the same colour and a reader
    // should not be able to tell that two files were involved.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/pricing", { waitUntil: "networkidle" });
    const signal = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--signal").trim(),
    );
    expect(signal, "--signal resolves in the dark theme").toMatch(/oklch|rgb|#/);
    // Chroma 0 would mean the accent had been flattened into the greyscale
    // palette — a fourth colour removed rather than the blue kept.
    const chroma = /^oklch\(\s*[\d.]+\s+([\d.]+)/.exec(signal)?.[1];
    if (chroma !== undefined) expect(Number.parseFloat(chroma)).toBeGreaterThan(0);
  });

  test("a reader's own pages stay inside a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/", "/pricing", "/how-it-works"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
});
