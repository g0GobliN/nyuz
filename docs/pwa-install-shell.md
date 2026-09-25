# Nyuz as an installed app

Install funnel → standalone shell → offline reading → cached shell → install
affordance. **Built.** The real-device pass in Stage 5 is the one thing still
outstanding, and it is what proves the shell; the affordance was built after it
was planned, on top of the contract rather than instead of it.

The goal, in one line: **once Nyuz is on the Home Screen, the reader should
forget they opened a website** — without faking anything. Same codebase, same
routes, same data. A normal browser visit is unchanged.

| Decision | Value |
|---|---|
| Shell scope | App shell on `/dashboard/*` only; marketing pages keep website chrome |
| `start_url` | `/dashboard` |
| Bottom bar | The website's sideways-scrolling strip, all eight destinations — the same list in both chromes; Billing and the staff pages stay in the account menu |
| Offline depth | Per-account IndexedDB: card subset for Home/Today/Saved, whole story for Saved + recently opened |
| iPhone status bar | Full-bleed `black-translucent` + `viewport-fit=cover`; the shell's top bar is ink in **both** themes |

---

## Stage 1 — Manifest and installability ✓

- `public/manifest.webmanifest` — `id: "/"`, `start_url: "/dashboard"`,
  `scope: "/dashboard"` (no trailing slash: scope is a path prefix, so
  `/dashboard/` would exclude `/dashboard` itself and the browser would silently
  discard `start_url`), `display: standalone`, dark `theme_color` /
  `background_color`, `orientation: any`.
- `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`,
  drawn once from the mark's own geometry — the `favicon.svg` path, rasterised at
  4× and downsampled — on the `#0D0D0D` ink field `apple-touch-icon.png` uses,
  at 49% of the canvas so no Android mask clips it. `logo-mark.png` is untouched
  (email and push still use it).
- `src/routes/__root.tsx` — `rel="manifest"` on every page (installing from the
  landing page is a supported path), the two `-capable` metas, the iOS app title
  and `black-translucent`.
- Viewport extended to `viewport-fit=cover`. Without it the layout viewport is
  inset and every `env(safe-area-inset-*)` resolves to 0.
- Landscape pass over the chrome that now has real insets: `gutter-x*` utilities
  in `src/styles.css` replace the plain `px-*` steps on the marketing header rows,
  the dashboard header, the dashboard main column and the browser-mode bottom nav.
- `src/lib/manifest.test.ts` — 14 assertions, including `start_url` inside
  `scope`, real PNG dimensions read from the IHDR, a maskable icon, and the
  `viewport-fit=cover` string itself.

## Stage 2 — The standalone app shell ✓

- `src/lib/display-mode.ts` is the single implementation of `isStandalone`, with
  `push/client.ts` and `device-install.ts` delegating to it. `useStandalone` uses
  `useSyncExternalStore`, so an installed launch gets the real answer on its first
  client render rather than one frame of the wrong chrome.
- `src/components/dashboard/app-shell.tsx` — ink top bar (wordmark, theme toggle,
  Alerts, search, account menu), `min-h-dvh` content, the same sideways-scrolling
  strip of destinations the browser layout draws, safe areas at both ends. No
  page title in the bar: every page already renders its own `PageHeader`, and a
  second copy would be either redundant or briefly wrong.
- `DashboardShell` branches on `useStandalone()`; the website layout is otherwise
  untouched. `DashboardGuard` draws the shell chrome immediately in standalone, so
  only the content waits.
- `src/lib/dashboard-nav.ts` — one destination list both chromes read. The
  installed app's bottom bar draws `MOBILE` in full, exactly as the browser's
  strip does: same destinations, same order, same sideways scroll, only the
  surface differs (ink there, glass here). An earlier version of this stage drew
  four fixed tabs and derived a `profileHubDestinations` list for the rest, which
  kept every destination reachable but made the app's navigation a second system
  to learn; the hub is gone and Settings holds only settings.
- `?tab=saved` lives in the URL on `/dashboard/briefing`, so the saved view
  survives back/forward and is not lost by opening a story and returning. Both
  strips open the route as a whole and the chips choose the view.
- `--app-chrome` / `--app-chrome-foreground` (chroma 0, identical in both themes)
  and `html[data-standalone]` rules for `overscroll-behavior` and the ink behind
  the status bar, set before first paint by a head script beside the theme script.

## Stage 3 — Offline reading ✓

Explicitly not service-worker caching of server functions: `loadStory` is a POST
whose payload is in the body (the Cache API cannot hold it), the responses are
per-account, and any HTTP cache is shared by every account on the device.

| Data | Stored | Why |
|---|---|---|
| Home / Today / Saved lists | the card subset — `understand`, related events, source excerpts and enriched evidence are dropped on the way in | the app must never open blank, and a list is not a reading session |
| Saved stories | warmed whole while online, five per visit | the reader's own shelf |
| Opened stories | the whole payload | reading must survive a tunnel |

- `offline/keys.ts` (pure, tested), `offline/archive.ts` (thin IndexedDB),
  `offline/persist.ts` (client-only cache subscriber, four whitelisted keys),
  `offline/fallback.ts`, `offline/warm.ts`.
- The four archived queries declare `networkMode: "offlineFirst"`. React Query's
  default `"online"` never calls `queryFn` while offline, so the fallback inside
  it would be unreachable and the screen would show a spinner forever.
- The fallback reads the archive *before* requesting when the browser is already
  offline, so a cold launch in a tunnel is instant instead of three failed
  round trips.
- Cleared on sign-out and on account switch (`OfflineArchive` in `__root.tsx`).
- Offline strip in both shells with the age of the copy; a Profile row with what
  is stored and a Clear button; the story page says the story was never saved
  rather than that it is not in your briefing.

## Stage 4 — Service-worker asset caching ✓

- Activation fixed **before** the worker served anything: `install` no longer
  calls `skipWaiting()`. A new worker waits, the page posts `SKIP_WAITING` from
  the reader's "Reload now", and otherwise it takes over on the next cold start.
  `clients.claim()` stays in `activate`, which is safe once activation is either
  a first install or an update a page asked for.
- Documents network-first with the last good copy as fallback and a small offline
  document behind that; `/assets/*` cache-first with background revalidation.
  Never `/_serverFn/`, `/api/`, `/auth`, `/onboarding`, `/admin`; non-GET and
  cross-origin requests are not touched at all.
- `src/lib/sw-config.ts` holds the constants the worker cannot import, and
  `src/lib/sw.test.ts` (13 assertions) holds the two copies together — including
  that `skipWaiting` appears only in the message handler and that the denylist is
  checked before either caching strategy is chosen.
- `src/lib/sw.ts` registers on boot (production only) with
  `updateViaCache: "none"`, and `UpdateNotice` offers the waiting version in both
  shells.

---

---

## Stage 5 — Post-deploy verification (current)

### Fixed in this pass: the status bar over an ink bar

The audit for the device pass found one real defect, in the one place the build
machine could not see: **`theme-color` followed the reader's theme inside an
installed window.** Android paints the status bar from that meta tag, and the
installed shell paints an ink top bar directly beneath it in both themes — so a
reader who chose light got a white status bar stacked on a black bar, on the
screen that is supposed to read as an app. (`black-translucent` on iOS was never
affected; that status bar is the OS drawing white ink over our own bar.)

- `themeColorFor(theme, standalone)` in `src/lib/theme.ts` is the rule: ink
  (`APP_CHROME_COLOR`, the same neutral as `--app-chrome` and the dark
  background) when installed, the themed page colour in a browser tab.
- `applyTheme` and `THEME_INIT_SCRIPT` both go through it, so the toggle cannot
  move the status bar away from the bar under it.
- The head scripts are ordered: `SHELL_INIT_SCRIPT` marks `<html>` with
  `data-standalone` (now exported as `STANDALONE_ATTRIBUTE`, so nothing re-types
  the attribute) and the theme script reads it. Both are parser-blocking, so the
  order costs nothing; `src/lib/theme.test.ts` runs them in that order and
  asserts the resulting meta tag agrees with the function for every combination
  of theme and window, plus a test that records what the wrong order would do.

### Two gates, and only one of them touches the network

`scripts/pwa-check.mjs` is one suite used at two points, and the split matters:
**CI is deterministic and offline, the deployment check is the smoke test.**
Nothing in a pull request depends on the live site, and nothing about
compiling nyuz depends on a deployment that may already be broken.

```
npm run ci                       # …typecheck, lint, test, build, THEN
                                 # npm run pwa:self-test  (reads .output/public)
npm run pwa:check -- https://nyuz.app    # 21 checks, exit 1 on any failure
```

The suite verifies the manifest is served as JSON, has every install field and
`display: standalone`, that `start_url` is inside `scope` (the prefix trap that
makes a browser silently drop `start_url`), that each declared icon is served and
its **bytes** match the declared size, that the start URL answers a document
linking the manifest and carrying `viewport-fit=cover` and `theme-color`, and
that the worker has a fetch handler, does **not** activate itself in `install`,
still handles push, and still excludes `/_serverFn/`. `cache-control` on `/sw.js`
is reported as information, not a failure, since `updateViaCache: "none"` already
makes it moot.

| Where a rule lives | Checked by |
|---|---|
| The manifest file, the icon bytes, and the head `__root.tsx` emits | `manifest.test.ts`, in the unit suite — source, no build needed |
| The **built** artifacts and the worker's runtime contract | `npm run pwa:self-test`, after `npm run build`, inside `npm run ci` |
| The **origin's** real HTML and served bytes | the deploy job, after `wrangler deploy` |

So a pull request goes red if the manifest disappears or stops declaring
`display: standalone`, if `start_url` falls outside `scope`, if an icon is missing
or not the size it claims, if `viewport-fit=cover` or the manifest link leaves
`__root.tsx`, if the worker starts activating itself again, if it stops handling
push, or if it starts caching `/_serverFn/`, `/api/`, `/auth`, `/onboarding` or
`/admin` — all without a phone, a network, or a deployment.

`--self-test` serves the real build artifacts from `.output/public` over a
throwaway local server, prints the full table for the healthy case, then breaks
**five** things on purpose to prove the suite reports them: `display: browser`,
`scope: "/dashboard/"`, an icon the build did not emit, a worker with a
`skipWaiting()` call inside `install`, and a worker whose never-cache list has
been emptied.

It earned that immediately. The first version of the "worker does not activate
itself" check was a substring search for `skipWaiting` in the install handler,
which matched the worker's own comment explaining why it does *not* call it — so
the healthy scenario failed and the tool said so before it was ever trusted. The
denylist check was written the same way and had the same hole: the worker's header
lists every path it never caches, so deleting the array would have left the check
passing on the prose. It now parses the array literal, and the fifth planted fault
is that exact state.

The proof that the gate is load-bearing is cheap to reproduce — deleting one file
from the built artifact, not the source, is what a build that stopped emitting an
icon actually looks like:

```
rm .output/public/icon-192.png
npm run pwa:self-test      # exit 1: FAIL the build emits /icon-192.png,
                           # and the healthy scenario goes red with it
```

The live half runs in the `deploy` job, after the existing 200 check, retried
three times because a fresh deploy can answer on the document before every asset
is being served from the colo. It cannot roll a deployment back; it can make the
run red and name the check that failed.

### The device pass — to be recorded

Everything below needs hardware. Each row names what is already asserted in the
codebase so that a failure points somewhere specific.

| # | Check | Already asserted |
|---|---|---|
| 1 | iPhone Safari → Add to Home Screen; icon name and mark | manifest + `apple-touch-icon.png` + iOS metas |
| 2 | Android Chrome → Install; icon opens straight to `/dashboard` | `start_url` inside `scope`; checker verifies both |
| 3 | Installed launch shows no browser chrome | `display: standalone` |
| 4 | Ink status bar above the ink top bar, in **both** themes | `themeColorFor` + `data-standalone` (Stage 5 fix) |
| 5 | Nothing under the notch or the home indicator, portrait and landscape | `viewport-fit=cover` + `env(safe-area-inset-*)` at both ends |
| 6 | Every destination in the strip opens from the app and highlights, and the strip scrolls sideways rather than clipping | `MOBILE` + `dashboard-nav.test.ts` |
| 7 | Alerts bell opens `/dashboard/alerts` | link present; **note:** the signal dot on the bell is unconditional in *both* shells — there is no unread model anywhere in the product, so it is a permanent accent, not a badge |
| 8 | Saved deep-link opens the Saved chip | `?tab=saved` in `validateSearch` |
| 9 | Airplane mode, cold launch: chrome immediately, Home renders its cards | `networkMode: "offlineFirst"` + list archive |
| 10 | Airplane mode: a previously opened story reads end to end, and an unsaved one says so | story archive + `warmSavedStories` |
| 11 | Sign out, then sign in as someone else: the first account's copies are gone | `clearAccount` on sign-out and switch (`offline-wiring.test.ts`) |
| 12 | A new deploy: the running session keeps working and offers **Reload now**; ignoring it still updates on the next cold start | worker never self-activates; `applyUpdate` posts `SKIP_WAITING` |
| 13 | A normal mobile browser still gets the website chrome | `useStandalone()` false → unchanged layout |
| 14 | Settings shows a real **Install Nyuz** button on Android, and it opens the browser's dialog | `installOffer` returns `prompt` only when an event was captured |
| 15 | iPhone Settings shows **Add to Home Screen**, and the sheet's steps match the phone | `installOffer` → `ios-steps`; one shared sheet |
| 16 | On an installed device the section reads **Installed on this device** and offers nothing | `installedHere()` — standalone, marker, or `appinstalled` |
| 17 | Home shows the card on a return visit, and never again after **Not now** | `bumpSessions` + `shouldShowInstallCard` (`install.test.ts`) |
| 18 | Dismissing **Not now** on Home leaves the Settings section exactly as it was | the dismissal store has exactly one importer, the card (`install-wiring.test.ts`) |
| 19 | Offline, Home offers nothing — Settings keeps its section, deliberately: there it is the affordance of record rather than a promotion | `shouldShowInstallCard` requires `online`; `install-section.tsx` never consults connectivity |
| 20 | A browser that cannot install shows no section at all — no heading, no empty panel, no gap where one would be | `InstallSection` returns `null` for `none`, below its hooks (`install-wiring.test.ts`) |

## Stage 6 — The install affordance ✓

Restrained on purpose: it is a real button only where a real button exists, one
card at most, and nothing anywhere else.

| Where | When it is drawn |
|---|---|
| Settings, directly under Profile | Whenever this device can actually install |
| Home, between the greeting and the stories | On a return visit, at most once ever |
| Everywhere else | Never |

- `installOffer` in `src/lib/install/offer.ts` is the rule, and its order is the
  content: **installed** beats everything → a captured **prompt** beats written
  steps → **ios-steps** is the one platform where instructions *are* the
  affordance → **none** is a branch that returns no UI at all. A browser that
  cannot install, or has already declined to offer it, gets nothing rather than a
  disabled button or a description of a menu it may not have.
- The event has to be caught before the bundle runs, or it is lost for good:
  `beforeinstallprompt` fires once and a browser will not repeat it on demand.
  `INSTALL_INIT_SCRIPT` therefore lives in `<head>`, attaches the listener before
  the body is parsed, calls `preventDefault()` (without it Chromium spends the
  prompt on its own mini-infobar and our button has nothing to call) and parks the
  event on a global. It also dispatches `nyuz:installprompt`, which is what makes
  an event arriving *after* mount visible to React — parking alone cannot update a
  snapshot. Single-use is respected: `runInstallPrompt` clears the event before
  awaiting it.
- Three signals mean "already installed", and this is the part with no API behind
  it: the window is standalone, a launch *was* standalone and left a marker, or
  `appinstalled` fired. Verified in tests, best-effort in life — see the header of
  `src/lib/install/prompt.ts` for what iOS does and does not share.
- The card counts **sessions**, not page views: a visit more than 30 minutes after
  the last one is the next session, and it takes two of them to earn the card.
  Dismissal is permanent and device-local, in `localStorage` beside the count, so
  the phone and the laptop each decide for themselves. Declining the browser's own
  dialog counts as answering the card, which then goes away.
- The iOS steps were a copy in `delivery.tsx` and are now one component
  (`dashboard/ios-steps-dialog.tsx`) rendered by the push flow, the Settings
  section and the card — three surfaces describing one Share menu. The push
  variant keeps its own fourth step, because the notification permission has
  nothing to do with installing.
- `src/lib/install/install.test.ts` — 24 tests, including the decision table, the
  session arithmetic with its boundary and a corrupt blob, the card's rules, the
  head script run the way a parser runs it, and the capture bridge end to end.
- `src/lib/install/install-wiring.test.ts` — the boundary between the two
  surfaces: the dismissal reaches the card and nowhere else, `recordSession` has
  one call site, and the Settings section's `none` return stays below its hooks.

## Verified, and not

**Checked here:** `npm run ci` green at the end of every stage (1963 tests across
130 files, 20 pre-existing lint warnings, none in new code), now including
`npm run pwa:self-test` against the build it just produced, with all five planted
faults reported and each exit code verified by hand (0 healthy, 1 with an
artifact deleted from `.output/public`, 0 once restored); the compiled stylesheet contains `bg-app-chrome`,
`text-app-chrome-foreground/60|75`, `html[data-standalone]`, the `gutter-x*`
utilities and `min-h-dvh`; the built output ships `manifest.webmanifest` (served
as `application/manifest+json`), the three icons and the rewritten `sw.js`; the
built server chunk emits `SHELL_INIT_SCRIPT` before `THEME_INIT_SCRIPT`, and the
theme script reads `data-standalone`; the compiled stylesheet carries the new
utilities the affordance uses (`h-4.5`, `min-w-[14rem]`, `border-signal/30`); and
the HTML the dev server actually returns for `/` contains the manifest link,
`viewport-fit=cover`, and all three inline head scripts **in order** — shell,
then theme, then the install capture.

**Not checked here, and needs a device:** the shell itself, because it only
renders for an authenticated session in a standalone window — `DashboardShell`
never server-renders, and `/dashboard` without a session goes to `/auth`. That is
the table above, rows 1–20. Two of the affordance's rows are the ones static
checks can only approximate: whether a given Android build fires
`beforeinstallprompt` at all, and whether an iPhone's Share sheet still matches
the three steps. Rows 18–20 are the flows most likely to be broken by a later
edit rather than by a device, which is why each is now pinned to a file and a
line rather than to a memory.

**One open item, resolved by construction rather than by measurement:** the live
`cache-control` on `/sw.js` cannot be checked without deploying — `pwa:check`
reports it as information. It matters less than it looks, because
`register(..., { updateViaCache: "none" })` makes the browser bypass the HTTP
cache for the worker script entirely. If a deploy is ever seen not to update, the
fix is a `public/_headers` entry — and that file must be re-checked afterwards,
since nitro generates the `.output/public/_headers` that currently carries the
`/assets/*` immutable rule.

## Non-goals, still

No swipe gestures, no iOS-clone controls, no custom scroll physics, no forced
orientation, no `display: fullscreen`, no artificial splash delay, no second
route tree, no app-only features. The website in a browser tab is the product it
was. Nothing private is ever written to a shared anonymous cache.
