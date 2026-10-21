# The route-walk e2e test was over its timeout budget (measured 2026-10-21)

**Status: a pre-existing flake with a structural cause, now fixed at the cause.** The duplicate
landing-page load is gone; the timeout bump remains only as margin. The "What nyuz covers" section
and the positioning-line change were never involved.

This file exists so the next person who sees this test fail does not repeat the hour spent here —
including the part of that hour spent believing two things that turned out to be false, which are
recorded below rather than quietly deleted.

## The symptom

`e2e/smoke.spec.ts` — *"a route walk never serves a broken asset"* — fails with
`Test timeout of 30000ms exceeded`, and the `page.goto` that trips it is a **different route each
run**: `/about` on one run, `/legal/privacy` on another, `/pricing` and `/how-it-works` on others.
It is the only e2e failure; the other 29 pass.

A failure that names a *different route every time* is the signature of a shared budget running out,
not of a specific page being slow.

## The real cause: the walk loaded the landing page twice

`blogIsAdvertised(page)` opened `/` with its own `page.goto(..., { waitUntil: "networkidle" })` to
read the nav link, and then the walk opened `/` **again** as `PUBLIC_ROUTES[0]`. Two full cold
landing-page loads, one of them entirely redundant.

Measured by instrumenting 21 navigations across three full walks plus two fresh browser contexts:
those two navigations were **33–52% of the walk's total in every run**. That is the structural cost,
and it was there before anything in this change set existed.

## The fix

The link is read during the walk's own visit to `/`, so the duplicate navigation is gone and the
walk visits exactly the routes it did before:

```ts
const noise = watch(page);
const [first, ...remaining] = routes;
await page.goto(first!, { waitUntil: "networkidle" });
if ((await page.locator('a[href="/blog"]').count()) > 0) remaining.push("/blog");
for (const route of remaining) await page.goto(route, { waitUntil: "networkidle" });
expect(realFailures(noise)).toEqual([]);
```

`watch()` now attaches *before* the first navigation, so the landing page is inside the same asset
check as the rest of the walk. Coverage is unchanged; one full page load is gone.

**Measured after the fix: the walk's own duration is 18.9s**, down from the 43–73s range recorded
before it. That is under the original 30s budget, so the structural fix alone would have been
sufficient on an idle machine. `test.setTimeout(120_000)` is kept as margin for a loaded one, not as
the mechanism.

## Two things I believed that were false

Both were written here on 2026-10-21 and both were refuted by independent measurement. They are kept
because the wrong mechanism produced a *plausible* fix, and the next person deserves to know why the
obvious explanation was not the real one.

**False 1: "the manifest is the slow resource, at 4,092 ms cold."** `/manifest.webmanifest` is
**never fetched during the walk.** Instrumented across three full walks and two fresh contexts:
zero requests to it. The 4,092 ms figure is real but belongs to the *installability* test elsewhere
in the suite, which does request it. It cannot be part of the walk's cost.

**False 2: "seven cold loads do not fit in thirty seconds."** There is only **one** cold start.
Only the first navigation pays workerd's first-request cost (~2.2 s, per wrangler's own log); every
later navigation is warm.

## What the duration measurements are worth (almost nothing)

The earlier version of this file compared "baseline 45.6 s" to "changed 40.5 s" and concluded the
change was faster. **That comparison is meaningless.** The box was running at a load average of
22–43 on 4 cores, with other agents building, running ESLint and driving headless Chrome at the same
time.

Interleaved, alternating three rounds per tree:

| tree | durations measured |
| --- | --- |
| baseline `main` | 43.5 s, 47.6 s, 72.9 s |
| with the landing changes | 49.7 s, 65.6 s, 67.2 s |

The sign flips relative to the single-shot measurement. Same-tree spread alone was **48.5–65.8 s**.
The honest conclusion is: *the budget was too small either way, and single-shot timing on this
machine cannot distinguish the trees.* A duration measured on a loaded box is not a measurement.

What *is* measurable and was checked: diffing both builds shows an **identical chunk-name set**,
38 preloads in both, 139 asset files in both, and **zero new requests** — only +1,866 bytes of JS
(+0.24%) and +2,290 bytes of HTML. The landing section cannot account for seconds.

## Why the timeout was raised anyway

`test.setTimeout(120_000)` inside the test. With the duplicate load removed this is margin rather
than the fix: the walk still does seven `waitUntil: "networkidle"` navigations, and a loaded CI box
can still be slow.

`networkidle` is **not** the thing to weaken. The assertion is that no asset failed, and `watch()`
counts a `requestfailed` — which fires when a request is **aborted**. Ending a navigation early
aborts the *next* page's own requests and reports them as broken assets, turning a slow test into a
**false** one. The wait condition is load-bearing; the budget was not.

## The negative control — the part that matters

A longer timeout on a gate is only safe if the gate can still fail. Proven, not assumed.

**Control A — a corrupt asset (HTTP 200, invalid body).** The test **passed**. Not a defect: the
walk asserts that no asset *fails to load*, and wrong bytes inside a 200 is a different class of
problem. Recorded so nobody mistakes it for a broken gate.

**Control B — a missing asset (404), which the test does claim to cover.** `public/nyuz-readers.png`
was moved away so the build stopped emitting it. The test **failed**:

```
- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 404 (Not Found)",
+   "404 http://127.0.0.1:8788/nyuz-readers.png",
+```
The file was restored byte-exact (2,294,560 bytes).

**An independent control, via a different route.** Because the `webServer` command is
`npm run build && wrangler dev`, it **overwrites `.output/`** on every run — so breaking a file
under `.output/public/assets/` is futile and the test passes for the wrong reason. Start `wrangler
dev` manually against a pre-built `.output`, disable `webServer` in a throwaway config, delete a
hashed chunk, restart: the gate fails as expected.

**Caveat on that control, worth knowing before you trust it:** when the missing asset is a **JS
module**, the test fails with `navigation interrupted by another navigation`, *not* with a clean
404 list. So the walk only cleanly proves missing **non-module** assets. Its clean 404 evidence
covers images, CSS and fetches — not a deleted script chunk.

## How to confirm it is not you, next time

Do **not** `git stash` in the main worktree. On this machine other agents share it, and stashing
mid-investigation resets the tree under them (this happened on 2026-10-21 and cost a peer their
working state). Use a separate checkout:

```bash
git worktree add /tmp/nyuz-baseline origin/main
cd /tmp/nyuz-baseline && npm ci
npx playwright test --reporter=list --timeout=120000 -g "a route walk never serves a broken asset"
```

Then judge by whether **the failing route changes between runs**, and by the build diff — not by a
single duration on a loaded machine.
