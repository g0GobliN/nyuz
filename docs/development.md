# Development

> nyuz is proprietary. This page is for people working on it **with permission** — see
> [`LICENSE`](../LICENSE).

---

## Setup

Requires Node 22+ (Vite 8 will not run on older).

```bash
npm ci
cp .env.example .env     # then fill it in
npm run dev              # http://localhost:8080
```

`npm ci` rather than `npm install` — it installs exactly what the lockfile pins and fails
if `package.json` and the lockfile disagree.

### Environment

`.env.example` documents every variable. The two the app cannot start without are
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — `src/lib/supabase/client.ts` throws at
module scope without them.

> **The `VITE_` prefix is the trust boundary.** Vite inlines any `VITE_`-prefixed variable
> into the browser bundle. Anything without it stays server-side. See
> [security.md](security.md).

### Database

Apply `supabase/migrations/` in order, then `supabase/bootstrap_superadmin.sql` by hand to
grant yourself the console. Details in [database.md](database.md#applying-migrations).

---

## Scripts

| Script                     | Does                                                   |
| -------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Dev server on 8080                                     |
| `npm run build`            | Production build — nitro bundle for Cloudflare Workers |
| `npm run preview`          | Serve the built output                                 |
| `npm run typecheck`        | `tsc --noEmit`                                         |
| `npm run lint`             | ESLint, including Prettier as a rule                   |
| `npm run format`           | Prettier write                                         |
| `npm run test`             | Vitest, once                                           |
| `npm run test:watch`       | Vitest, watching                                       |
| `npm run test:shard`       | One quarter of the suite — `npm run test:shard -- 1/4` |
| `npm run test:coverage`    | Vitest with v8 coverage into `coverage/`               |
| `npm run coverage:ratchet` | Compare coverage against `.ci/baseline/coverage.json`  |
| `npm run e2e`              | Chromium against the built Worker (builds first)       |
| `npm run ci`               | Every check CI runs, in CI order                       |

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push and PR to `main`, and can be triggered by
hand from the Actions tab.

Seven jobs. Each check is **its own step** so a red run names what broke rather than
reporting that `npm run ci` failed somewhere.

| Job        | What it proves                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commits`  | No `Co-Authored-By` trailer, which needs a rebase rather than a fix-up commit                                                                                                                                         |
| `audit`    | The lockfile resolves only to the public registry, production dependencies have no known advisory, and no server secret is named `VITE_`                                                                              |
| `verify`   | `typecheck` → `lint` → `build` → the PWA install contract against the emitted artifact → the route walk's own self-test                                                                                               |
| `test`     | The suite, in four shards — 2780 tests, the slowest quarter rather than the sum                                                                                                                                       |
| `coverage` | The suite again, instrumented, then the floor in `.ci/baseline/coverage.json`                                                                                                                                         |
| `e2e`      | Chromium against the built Worker: the public routes render, the guards hold, the health endpoint stays hidden without its token, the billing toggle moves the prices, and the theme is the one the product documents |
| `deploy`   | Ships, then walks every public page on the origin (status, title, rendered content, referenced assets) and checks the install contract                                                                                |

CI supplies obvious throwaway `VITE_SUPABASE_*` values. The build is _checked_, not run,
and no request is made to that host — so a build failure can never be mistaken for a
credential problem and a PR needs no real secrets. The same values reach `e2e`, where the
public pages render from the bundled site content because reads that fail fall back to it.
The one page that does not render there is `/blog`, which is gated on the fail-closed `blog`
feature flag: with no database the flag resolves off and the route answers 404 on purpose.
The suite asserts that contract — the home page's link and the route flip together, so it
checks a 200 when the site advertises the blog and a 404 when it does not — and the deploy
job's route walk is where a rendered blog is asserted.

A second push to a branch cancels the earlier run; `main` is excluded so its history stays
fully checked.

`deploy` runs only for a push to `main` and only once every job above is green — including
the browser suite and the coverage floor. It rebuilds with the real configuration, because
the checked build's placeholders must never reach a browser, and ships to Cloudflare.
See [deployment.md](deployment.md).

### Production health

`.github/workflows/health.yml` is the one job that looks at production without deploying it:
03:17 UTC daily, or by hand from the Actions tab. It re-reads every public page and re-checks
the install contract against `vars.SITE_URL`.

It is the only workflow with **no secrets at all** — `permissions: contents: read` is the whole
grant and it never checks out a database or an account-scoped page, so there is nothing there
to leak. That is what makes it safe to schedule on a repository whose `main` can already deploy.

Two deliberate choices. It runs the route walk's self-test first, on every fire, because a check
that has never failed proves nothing and this one is the thing that reports production healthy.
And it **refuses to run** when `vars.SITE_URL` is unset or is not a public https origin, rather
than passing because it had nowhere to look — a green health check with no target is worse than
no health check, because it reads as coverage in the Actions tab.

### The coverage floor

`npm run test:coverage` measures the whole tree — `all: true`, so a file nothing imports is
counted at 0% rather than omitted — and `npm run coverage:ratchet` compares that measurement
per directory against `.ci/baseline/coverage.json`. Only a **decrease** fails.

It is a ratchet, not a threshold, because the honest number for this codebase is whatever it
measures: a threshold picked by hand would either be unreachable and switched off, or already
passed and telling nobody anything. What the ratchet asks on every commit is narrower and
true — did this change make the codebase less tested than it was?

The floor only rises. `--update` records a new measurement and **refuses to lower anything**;
a deliberate drop needs `--update --allow-lower` and a reason in the commit. Adding a module
with no tests therefore fails the build, and the fix is either a test or an explicit raise.

The one friction worth knowing: `src/routes/**` and most of `src/components/**` sit near 0%
because the unit suite never imports a component. That is the browser suite's territory, and
the rows are there to make the gap visible rather than to demand unit tests for JSX. The
browser suite covers it instead — `e2e/interaction.spec.ts` clicks the billing toggle, walks
the sign-in flow to its address step, and reads every support mailbox — which is worth more
than a line-coverage number, because those are the parts a unit test would have to mock the
very thing it is meant to check.

`.ci/baseline/coverage.json` records `measuredAtCommit`, the commit it was taken at, so a drop
can be attributed to a change rather than guessed at. It is filled in from `git rev-parse HEAD`
when the floor is recorded locally, not only from `GITHUB_SHA` in CI — a floor that cannot say
what it is a floor _for_ is indistinguishable from one that drifted because the source moved.

### The browser suite

`npm run e2e` builds the Worker, serves it with `wrangler dev --local`, and drives it with
Playwright. It is the only check that can see a module-scope throw in the client entry, a
route file that fails to import, or a page that answers 200 with an error page in it — none
of which `tsc` or 2751 unit tests can detect, because none of them load the bundle.

It uses no credentials and never contacts Cloudflare. It runs on a pull request, and it
gates the deploy.

---

## Conventions

**`tsc --noEmit` must stay clean.** `noUncheckedIndexedAccess` is on, so index access
yields `T | undefined` — narrow before use.

**Three colours only.** Black, white, and one blue (`--signal`, hue 240). Every other token
in `src/styles.css` is chroma 0. Do not introduce a fourth.

`--destructive` is monochrome deliberately: a coloured error state would compete with the
accent for attention, so destructive states lean on iconography and
weight. The two hex values in `public/logo.svg` are the sRGB form of `--signal` light/dark
and must change alongside it.

**Routes are file-based** under `src/routes/`. `src/routeTree.gen.ts` is generated — never
edit it by hand.

**Every environment variable is in `.env.example`.** `env-contract.test.ts` reads the code
and fails on a variable that is read anywhere in `src/` or `scripts/` but documented
nowhere; platform-provided names (`DEV`, `PROD`, `GITHUB_SHA`) are listed in that test
rather than in the example file, because nobody can set them.

**Line endings are LF**, enforced by `.gitattributes`. This was added because lint could not
be made green without it: Prettier is configured for LF but files authored on Windows were
committed with CRLF, producing thousands of `Delete ␍` errors in files nobody had touched.

---

## Tests

Vitest, `src/**/*.test.ts`, node environment. `vitest.config.ts` is separate from
`vite.config.ts` on purpose — the app config loads the TanStack Start plugin and the nitro
Cloudflare preset, neither of which is wanted when testing plain functions.

Current coverage is the **pure logic where a regression would be silent and expensive**:

| File                   | Covers                                                 |
| ---------------------- | ------------------------------------------------------ |
| `matching.test.ts`     | Topic matching, exclusion precedence, the caption      |
| `site-content.test.ts` | Section normalisation, media URL validation, fallbacks |
| `plans.test.ts`        | Price override resolution                              |

`matching.test.ts` exists because of a shipped bug: the dashboard showed all six sample
stories to everyone with a hard-coded caption claiming what the reader followed. Its cases
are the ones the real pipeline's SQL will have to satisfy too.

**What is not tested:** components, server functions, and RLS policies. Server functions
need a Supabase instance; policies are best tested against a real database. Both are worth
doing and neither is done.

---

## Project layout

```
src/
  routes/            file-based routes
    admin/           operator console
    dashboard/       customer dashboard (fixtures today)
    blog/, legal/
  components/
    admin/           console shell + primitives
    landing/         marketing sections
    dashboard/       dashboard shell + story card
    ui/              shadcn primitives — mostly untouched
  lib/
    server/          server functions. NEVER import from a component
    supabase/        client (anon) and admin (service-role)
    ai/              provider config and the OpenAI-compatible client
    site-content.ts  schemas + defaults for editable content
    matching.ts      topic matching over fixtures
    sample-data.ts   the fixtures themselves
supabase/migrations/ 0001 → 0003, applied in order
docs/                this
```

**`src/lib/server/` must never be imported from a component.** Even though the bundler
strips server handlers, reaching across that line invites the day someone adds a top-level
side effect and ships a secret with it.

---

## Related

- [status.md](status.md) — what is real before you go looking for it
- [contributing.md](contributing.md) — branches, commits, review
- [deployment.md](deployment.md) — shipping
