# Deployment

Target is **Cloudflare Workers**. `npm run build` produces a nitro bundle in `.output/`
using the `cloudflare-module` preset.

The SSR server and the ingestion pipeline ship to the same runtime, because the pipeline is
cron- and queue-shaped and there is no reason to run two platforms.

---

## Runtime constraints

> **No Node built-ins.** Workers has none. Server code must be fetch-based.

Two consequences that have already shaped the code:

**No ambient `process.env` at module scope.** `src/lib/supabase/admin.ts` builds its client
per call from whatever env the request hands it, rather than capturing at import time. New
server code must follow that pattern.

**One copy of React.** `vite.config.ts` dedupes `react`, `react-dom`, and the TanStack
packages. Two copies of React break hooks; two routers break context lookups at runtime.

---

## Deploying

**Merging to `main` deploys.** `.github/workflows/ci.yml` runs the commit-message check,
typecheck, lint, test and build; if all of them pass, its `deploy` job rebuilds with the
real configuration and runs `wrangler deploy`. Nothing else is needed, and a red run
cannot ship — the job `needs` both of the others.

A pull request is checked and never deployed. Neither is any branch but `main`.

### Setting it up once

The workflow reads one secret and five variables from the repository. Under
**Settings → Secrets and variables → Actions**:

| Name                     | Kind     | Value                                    |
| ------------------------ | -------- | ---------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Secret   | A token with **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID`  | Variable | The account ID from the dashboard URL    |
| `VITE_SUPABASE_URL`      | Variable | `https://<ref>.supabase.co`              |
| `VITE_SUPABASE_ANON_KEY` | Variable | The anon key                             |
| `VITE_SITE_URL`          | Variable | Absolute origin, no trailing slash       |
| `VITE_VAPID_PUBLIC_KEY`  | Variable | From `npm run vapid`                     |

The four `VITE_` values are variables and not secrets on purpose: Vite compiles them into
the bundle every visitor downloads, so calling them secret would be theatre. Everything
that is actually secret is a Worker secret and never passes through GitHub — see below.

Mint the token at **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**,
scoped to this account. It is the only credential the workflow holds, and it is scoped to
the `production` GitHub Environment rather than to the repository, so no other workflow
can read it. Put a required reviewer on that environment if a deploy should need a human.

An unset `VITE_` variable would not fail the build — Vite would inline `undefined` and
`src/lib/supabase/client.ts` would throw for every visitor. The job checks for them first
and refuses rather than shipping a bundle that CI called green.

### The worker name is pinned

`vite.config.ts` sets `name: "nyuz"`. Left unset, nitro infers a name from the git remote,
and a worker's name is its identity on Cloudflare — anything that changed the inference
would not fail, it would create a _second_ worker and leave the first one live with the
cron triggers and the secrets still on it.

### By hand

Still possible, and the fastest way to check a change against the real runtime:

```bash
npm run build
npx nitro deploy --prebuilt
```

Or preview the built output locally:

```bash
npm run preview
```

---

## Secrets

Set every server-side secret with `wrangler secret put` — never in `wrangler.json`, never
in a table, never `VITE_`-prefixed, and **not in GitHub**.

The deploy workflow does not carry them. `wrangler deploy` leaves existing Worker secrets
untouched, so they are set once against Cloudflare and stay there; routing them through
Actions on every deploy would put a second copy of every key in a second system and buy
nothing.

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name nyuz
npx wrangler secret put DEEPSEEK_API_KEY --name nyuz
```

**`--name` is not optional here.** There is no `wrangler.toml` at the root — the config is
generated into `.output/server/wrangler.json` at build time, and only `deploy` and `dev`
follow the `.wrangler/deploy/config.json` redirect that points at it. Every other wrangler
subcommand fails with "Required Worker name missing" unless told. `--config
.output/server/wrangler.json` works too and keeps the name in one place, but needs a build
first.

Setting a secret before the first deploy is fine: wrangler offers to create the Worker,
and the deploy then ships over it. That is the better order — it closes the window where
a cron fires against a Worker whose secrets are not there yet.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are build-time and public by design — they
are inlined into the browser bundle, and RLS is what protects the data.

Adding an AI provider means the secret **and** the `ai_providers` row. A provider marked
active whose variable is unset appears in the console as a missing secret rather than
failing mid-run. See [ai-providers.md](ai-providers.md).

---

## Database migrations

Migrations are **not** applied by the deploy. Run them first, deliberately:

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push
```

They are not idempotent — `create type` and `create table` fail on a second run. The
Supabase SQL editor wraps a paste in a transaction, so a mid-way failure rolls back
cleanly.

**Order matters when a migration adds a column the new code reads.** Apply the migration
before deploying the code, or the running deployment queries a column that does not exist
yet.

Automatic deployment sharpens that. There is no longer a gap between merging and shipping
in which to remember, so a change that needs a migration means pushing the migration
first and merging second — not the other way round.

---

## Release checklist

- [ ] `npm run ci` green locally — CI green on `main` is what actually deploys
- [ ] `CLOUDFLARE_API_TOKEN` and the five variables set on the repository
- [ ] Cron Triggers tab shows every schedule in `triggers.crons` registered — Cloudflare
      takes three per Worker and drops the rest without failing the deploy
- [ ] Migrations applied to the target project
- [ ] Secrets set for every active AI provider and the service role
- [x] `ENTITY` filled in `src/routes/legal/$doc.tsx` (sole trader, Japan; contact / privacy / security / billing @nyuz.app)
- [x] Copyright holder and contact filled in `LICENSE`
- [ ] Subprocessor table regions filled in the legal pages
- [ ] At least one superadmin granted on the target project
- [ ] Sample-data notice removed **only if** the pipeline is actually live

The last one matters. The dashboard shows fixtures behind a "Sample data" badge; removing
the badge without building the pipeline turns an honest prototype into a false claim.

---

## Related

- [development.md](development.md) — scripts and CI
- [security.md](security.md) — the secrets model
- [database.md](database.md) — migration detail
