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

**Merging to `main` deploys.** `.github/workflows/ci.yml` runs three jobs in parallel —
the commit-message check; a dependency and secret-name audit; and typecheck, lint, test
and build. If all three pass, the `deploy` job rebuilds with the real configuration,
scans the bundle it just built, runs `wrangler deploy`, and asks the deployment for a
200 before calling itself green. A red run cannot ship: `deploy` `needs` all three.

A pull request is checked and never deployed. Neither is any branch but `main`.

Two of those gates exist because a bad deploy cannot be taken back. The bundle scan runs
between the build and the upload, since every visitor who loads a published bundle keeps
a copy of whatever was in it. The smoke check runs after, because `wrangler deploy`
succeeding only means Cloudflare accepted the upload — a Worker that throws at module
scope uploads perfectly and then fails for everyone.

Every third-party action is pinned to a commit SHA rather than a tag. A tag is a pointer
its owner can move, and `deploy` hands whatever it resolves to an API token that can
rewrite the live Worker. Upgrading one is a reviewed line in the workflow; the version
each SHA belongs to is in the comment beside it.

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

### Diagnosing production billing

Run `npm run billing:check` with the deployment's configuration in `.env`. This
only reads Stripe prices; it never creates a checkout or charges a customer.
Local results describe that environment, not necessarily the deployed Worker.

Production needs `STRIPE_SECRET_KEY` in live mode, a signing secret for the live
webhook at `https://<your-domain>/api/stripe/webhook`, and these current price IDs:

| Variable | Live USD price |
| --- | --- |
| `STRIPE_PRICE_PLURA_MONTHLY` | $14.99/month |
| `STRIPE_PRICE_PLURA_ANNUAL` | $149.90/year |
| `STRIPE_PRICE_OMNI_MONTHLY` | $29.99/month |
| `STRIPE_PRICE_OMNI_ANNUAL` | $299.90/year |

Old `STRIPE_PRICE_PERSONAL_*` and `STRIPE_PRICE_PRO_*` variables are not read by
the current catalogue. Do not rename old price IDs into these slots: their amounts
may differ. Configure the current live prices in Worker bindings and set
`VITE_SITE_URL` to the customer-facing HTTPS origin for checkout return links.

Apply migration `0084_exclusion_limits.sql` before deploying the exclusion
validation changes; preference saves use its atomic replacement function.

Set every server-side secret with `wrangler secret put` — never in `wrangler.json`, never
in a table, never `VITE_`-prefixed, and **not in GitHub**.

The deploy workflow does not carry them. `wrangler deploy` leaves existing Worker secrets
untouched, so they are set once against Cloudflare and stay there; routing them through
Actions on every deploy would put a second copy of every key in a second system and buy
nothing.

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name nyuz
npx wrangler secret put DEEPSEEK_API_KEY --name nyuz
npx wrangler secret put RESEND_API_KEY --name nyuz
npx wrangler secret put STRIPE_SECRET_KEY --name nyuz
npx wrangler secret put STRIPE_WEBHOOK_SECRET --name nyuz
npx wrangler secret put EMAIL_UNSUBSCRIBE_SECRET --name nyuz
npx wrangler secret put HEALTHCHECK_TOKEN --name nyuz
```

Set the four recurring Stripe Price ids as Worker variables.

**The two AI ceilings are no longer environment configuration.** Since migration 0056
they live in `ai_runtime_config` and are edited at **`/admin` → AI runtime**, which both
the deployed Worker and `npm run pipeline` read. That is the point of the table: the
Worker and the local pipeline read different environments, so a ceiling that lived in
both could disagree indefinitely with nothing reporting it.

`AI_MONTHLY_TOKEN_BUDGET=20000000` and `AI_MONTHLY_COST_USD=10` remain useful as
**bootstrap values only** — they are what a deployment runs on before anyone opens the
console, and they are ignored the moment an admin value is saved. Set them once if you
want a sane starting point; do not treat them as the place to tune. The AI runtime page
shows, per setting, whether the value in force came from the database, the environment
or the built-in default, so there is never a question about which one is live.

**Every completion ceiling is on that page, clustering included.** 0069 moved the last
one. Clustering's ceiling used to come from `ai_model_routes.max_tokens` if a `cluster`
row existed and from a constant in `src/lib/ai/config.ts` if it did not — and in this
project no row existed, so every clustering call ran on the 1024 floor, spent the whole
allowance on hidden reasoning and returned empty content. If clustering or analysis
starts failing with "hit the token ceiling during reasoning", raise **Cluster max
tokens** or **Analyse max tokens** on that page; do not raise all four. Each ceiling is
held as a reservation against the monthly budget on every call that uses it, so a global
raise spends the budget faster on stages that never needed the room. Clustering is bounded
lower than the rest (4096) because it is the only per-article call — everything else is
per event or per reader, so a number raised there multiplies across the whole ingest.

Anything set as a dashboard variable is set once and never in `wrangler.json` or GitHub.
Those names do not appear in this repo's Wrangler config on purpose: `vite.config.ts`
sets `cloudflare.wrangler.keep_vars = true`, so `wrangler deploy` leaves
dashboard-managed plain-text variables alone instead of wiping anything not declared in
the generated config.

**Do not deploy with the shipped default of `500000`.** That number is a fail-safe for a
missing binding, not a production capacity: measured against the current prompts and rate
card, a Flash clustering call settles at ~849 tokens and a Pro analysis at ~7,448, so $10 of
spend corresponds to somewhere between 6.1M tokens (all analysis) and 20.8M (all
clustering). At 500,000 the token ceiling binds within days and the pipeline stops
mid-month while `/admin/cost` still shows dollars unspent — the failure looks like a
provider outage, not a budget. `5000000` is still under the whole range and would bind
first as well. 20,000,000 puts the dollar ceiling in front for every plausible mix, and
leaves the token cap doing the job it is actually good at: catching a loop that generates
enormous cheap traffic, where cost per token collapses.

Headroom is part of that number. A reservation holds `prompt + maxTokens * 2` until it
settles, so one stalled batch of eight analyses pins ~315,000 tokens for up to an hour —
63% of the 500,000 default, 1.6% of the recommended value. The Price ids must be the $14.99/$149.90 Personal and $29.99/$299.90 Pro prices; changing
display copy does not change what Stripe charges.

The Stripe endpoint must send `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`,
`charge.succeeded`, and `charge.refunded`. The succeeded/refunded events populate the private
unit-economics ledger; omitting them keeps gross margin deliberately unavailable in `/admin/cost`.

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

Production is known to have a partially applied `0042_launch_capacity.sql` followed by
0043 and 0044. Do **not** replay 0042 there. Apply
`0045_launch_blocker_repair.sql` as one transaction in the Supabase SQL editor, then run
the schema/RLS verifier. The repair reasserts every intended 0042 object idempotently and
is also safe in a fresh database after the normal 0001–0044 sequence.

Under Supabase **Authentication → URL Configuration**, set the Site URL to
`https://nyuz.app` and allow at least `https://nyuz.app/auth?recovery=1` and
`https://nyuz.app/dashboard` as redirect URLs. Configure the same production URLs in the
Google/GitHub provider consoles when those providers are enabled. Password recovery will
open a session only when Supabase is allowed to return to the recovery URL.

Point an external uptime monitor at `https://nyuz.app/api/health` with
`Authorization: Bearer <HEALTHCHECK_TOKEN>` (a query `token` is also accepted for monitors
that cannot set headers). It returns 503 when the cron heartbeat is stale, a recorded
webhook/AI budget state is unhealthy, or failed deliveries exist. Alert on one failed
check and on recovery; never put the token in a public status page.

Before enabling payments, reconcile the pre-fix pipeline backlog once:

- Compare current-month zero-usage AI reservations with the AI provider's usage/billing log.
  Call `release_ai_reservation(id)` only for calls the provider confirms were refused before
  generation. Ambiguous calls stay reserved; the new runtime settles measured failed calls and
  releases only definitely unbilled failures automatically.
- Two production digests from 30–31 August 2026 are `failed` with zero items and zero tokens.
  After the new Worker is deployed, inspect that they have no `digest_items` or `deliveries`, then
  set those rows back to `scheduled` once. Do not add failed digests to the ordinary cron selector;
  that would turn a real repeatable failure into an infinite retry loop.
- Run `scripts/backlog-audit.ts`. Process only its `pending with current demand` population through
  the normal bounded analysis worker. Leave the no-demand population pending. Do not bulk-analyse
  the event table merely to reduce the count.

---

## Release checklist

- [ ] `npm run ci` green locally — CI green on `main` is what actually deploys
- [ ] Domain registered; `VITE_SITE_URL`, DNS and HTTPS point to the production Worker
- [ ] The four `@nyuz.app` mailboxes receive mail; Resend domain SPF/DKIM and DMARC verified
- [ ] `CLOUDFLARE_API_TOKEN` and the five variables set on the repository
- [ ] Cron Triggers tab shows every schedule in `triggers.crons` registered
- [ ] Workers Paid enabled, or production traces prove SSR and every cron stay within Free CPU limits
- [ ] Migrations applied to the target project
- [ ] Secrets set for every active AI provider and the service role
- [ ] Resend and Stripe secrets and four Stripe Price ids set
- [ ] Migration 0056 applied, then both AI ceilings set in `/admin` → AI runtime
      (monthly AI budget $10, monthly token budget 20,000,000). The shipped default
      token budget of `500000` is a fail-safe and will stop the pipeline mid-month.
      Check the source chip on each reads "DB" — "environment fallback" means the
      value is coming from one runtime's env and the two may drift
- [ ] Per-model daily caps confirmed in `/admin` or `site_settings`
      (`ai.daily_flash_cap_microusd`, `ai.daily_pro_cap_microusd`; defaults $1/day and $5/day)
- [ ] `EMAIL_UNSUBSCRIBE_SECRET` and `HEALTHCHECK_TOKEN` set as Worker secrets;
      external `/api/health` monitor returns 200 after cron runs
- [ ] Supabase Site URL, recovery redirect, OAuth callbacks, SMTP and auth rate/CAPTCHA
      controls configured for `https://nyuz.app`
- [ ] `/admin/cost` checked after the first 48 hours: the projected month-end figure must sit
      under the monthly AI budget, or the pipeline will stop partway through the month.
      Reduce active sources or raise the ceiling — do not leave a projection that overruns
- [ ] Stripe uses live mode; four active recurring USD prices are exactly $14.99/$149.90 and $29.99/$299.90;
      all documented webhook events enabled; webhook endpoint, refund sync and customer portal tested end to end
- [ ] `/admin/cost` has actual monthly Cloudflare, Supabase, Resend, domain and other costs saved;
      a live test payment appears with its Stripe fee before relying on the displayed margin
- [ ] A current database export is stored outside Supabase (Free has no automatic backups)
- [x] `ENTITY` filled in `src/routes/legal/$doc.tsx` (sole trader, Japan; contact / privacy / security / billing @nyuz.app)
- [ ] The operator can provide a real business address and reachable telephone before purchase;
      Japan tax/invoice obligations reviewed with a qualified adviser
- [x] Copyright holder and contact filled in `LICENSE`
- [ ] Supabase's selected project region confirmed in the service-provider disclosure
- [ ] At least one superadmin granted on the target project
- [ ] Sample-data notice removed **only if** the pipeline is actually live

The last one matters. The dashboard shows fixtures behind a "Sample data" badge; removing
the badge without building the pipeline turns an honest prototype into a false claim.

---

## Related

- [development.md](development.md) — scripts and CI
- [security.md](security.md) — the secrets model
- [database.md](database.md) — migration detail
