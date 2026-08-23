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

| Script               | Does                                                   |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Dev server on 8080                                     |
| `npm run build`      | Production build — nitro bundle for Cloudflare Workers |
| `npm run preview`    | Serve the built output                                 |
| `npm run typecheck`  | `tsc --noEmit`                                         |
| `npm run lint`       | ESLint, including Prettier as a rule                   |
| `npm run format`     | Prettier write                                         |
| `npm run test`       | Vitest, once                                           |
| `npm run test:watch` | Vitest, watching                                       |
| `npm run ci`         | All four checks, in CI order                           |

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push and PR to `main`, and can be triggered by
hand from the Actions tab.

Four steps, **each its own step** so a red run names what broke rather than reporting that
`npm run ci` failed somewhere. They run in ascending order of cost:

```
typecheck  →  lint  →  test  →  build
```

CI supplies obvious throwaway `VITE_SUPABASE_*` values. The build is _checked_, not run,
and no request is made to that host — so a build failure can never be mistaken for a
credential problem and a PR needs no real secrets.

A second push to a branch cancels the earlier run; `main` is excluded so its history stays
fully checked.

---

## Conventions

**`tsc --noEmit` must stay clean.** `noUncheckedIndexedAccess` is on, so index access
yields `T | undefined` — narrow before use.

**Three colours only.** Black, white, and one red (`--signal`, hue 27). Every other token
in `src/styles.css` is chroma 0. Do not introduce a fourth.

`--destructive` is monochrome deliberately: with a red accent, a red error state is
indistinguishable from an ordinary highlight, so destructive states lean on iconography and
weight. The two hex values in `public/logo.svg` are the sRGB form of `--signal` light/dark
and must change alongside it.

**Routes are file-based** under `src/routes/`. `src/routeTree.gen.ts` is generated — never
edit it by hand.

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
