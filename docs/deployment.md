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
in a table, never `VITE_`-prefixed.

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put DEEPSEEK_API_KEY
```

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

---

## Release checklist

- [ ] `npm run ci` green locally, and CI green on the commit
- [ ] Migrations applied to the target project
- [ ] Secrets set for every active AI provider and the service role
- [ ] `ENTITY` placeholders filled in `src/routes/legal/$doc.tsx`
- [ ] `[Company legal name]` and contact filled in `LICENSE`
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
