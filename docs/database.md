# Database

Postgres via Supabase. Migrations are applied in numeric order.

| Migration                    | Contents                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `0001_init.sql`              | Core schema — identity, interests, content, delivery, feedback                      |
| `0002_rls.sql`               | Row-level security for everything in 0001                                           |
| `0003_admin.sql`             | Roles, bans, blog, site settings, AI routing, flags, audit                          |
| `0017_plan_entitlements.sql` | Launch plan caps, inactivity state, alert/source guards, AI ledger, retention purge |

---

## The one rule that shapes everything

> **Content tables are global. Per-user tables reference events by id. An event is never
> copied per subscriber.**

This is what keeps model cost independent of user count ([architecture.md](architecture.md)).
Any future migration that copies event content into a per-user row breaks the cost model,
however convenient it looks at the time.

---

## Table groups

### Identity

| Table                      | Notes                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `profiles`                 | Identity, presence, and automatic inactivity-pause state         |
| `subscriptions`            | One row per user. `plan` is written by billing, never the client |
| `notification_preferences` | Schedule, channels, density, pause                               |
| `user_roles`               | `user` / `admin` / `superadmin`. **No write policy at all**      |
| `user_bans`                | Reason and paper trail. _Not_ the enforcement — see below        |

### Interests

| Table               | Notes                                                   |
| ------------------- | ------------------------------------------------------- |
| `topics`            | Global topic vocabulary                                 |
| `user_topics`       | Per-user importance, frequency, keywords, weight, muted |
| `user_exclusions`   | Terms that beat topics at match time                    |
| `user_source_prefs` | Prioritise / normal / mute, with plan caps on priority  |

### Content — global, pipeline-written

| Table          | Notes                                                           |
| -------------- | --------------------------------------------------------------- |
| `sources`      | Feeds, with `failure_count` and `active` for back-off           |
| `articles`     | Raw items. `content_hash` is the exact-duplicate guard          |
| `events`       | The unit of meaning. `importance`, `novelty`, `analysis_tokens` |
| `event_topics` | Event → topic with confidence                                   |

### Delivery

| Table          | Notes                                                              |
| -------------- | ------------------------------------------------------------------ |
| `user_events`  | Match results plus durable `briefed_at` deduplication              |
| `digests`      | One per user per scheduled slot. `skipped` is a real success state |
| `digest_items` | `why_it_matters` — the only per-user generated text                |
| `deliveries`   | Per channel, with attempts and retry                               |

### Feedback

| Table             | Notes                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `feedback`        | useful / not_useful / not_interested                               |
| `saved_stories`   | Kept past the retention window                                     |
| `alert_claims`    | Atomic rolling alert quotas; browser-inaccessible                  |
| `ai_usage_ledger` | Monthly token reservations and settled usage; browser-inaccessible |

### Admin (0003)

| Table             | Notes                                                |
| ----------------- | ---------------------------------------------------- |
| `blog_posts`      | Markdown body. **Never store rendered HTML here**    |
| `ai_providers`    | `api_key_env` holds the variable _name_, never a key |
| `ai_model_routes` | One row per capability tier                          |
| `ai_prompts`      | System prompts as data                               |
| `site_settings`   | jsonb per key, validated on read and write           |
| `feature_flags`   | With rollout percentage                              |
| `admin_audit_log` | Append-only by construction                          |

---

## Row-level security

RLS is enabled on every table. **A table with RLS on and no matching policy denies by
default**, and that default is used deliberately in several places rather than being
worked around.

Three patterns:

**1. Global content — read-only to signed-in users.**
`topics`, `sources`, `events`, `articles`, `event_topics` have a `select` policy and _no
write policy_. The pipeline writes with the service-role key, which bypasses RLS
entirely. The absence of a write policy is the write guard.

**2. Owner-only rows.** Matched on `auth.uid()`. Note that `digests`, `digest_items`,
`deliveries` and `user_events` get `select` only — they are produced by the pipeline, and
a user has no business writing them.

**3. Public read.** `blog_posts` (live posts only), `site_settings` and `feature_flags` are
readable by `anon` as well as `authenticated`, because a signed-out visitor renders the
marketing site.

### Tables unreachable from the browser

`ai_providers`, `ai_model_routes` and `ai_prompts` have **no policy at all**. RLS is on,
nothing matches, so they cannot be read from the browser under any circumstances. Only the
service-role key reaches them.

---

## Decisions worth understanding

### Why roles are not a column on `profiles`

`0002_rls.sql` grants `update own profile` for all columns. A `role` column there would be
self-grantable — any user could promote themselves with one PostgREST call. `user_roles` is
a separate table with a read policy and no write policy, so a role can only be changed by
the service-role key behind an audited server function.

### Why `profiles.email` is protected by a trigger

The console lists and searches users by email, and `auth.users` is not exposed to
PostgREST, so the address is mirrored onto `profiles`. But `update own profile` covers that
new column too — a user could rewrite their own address and the console would display
whatever they typed.

RLS cannot compare against `OLD`, so the clamp is a `BEFORE UPDATE` trigger
(`protect_profile_columns`) that forces `id`, `email` and `created_at` back to their
previous values unless the caller is `service_role`.

### Why a ban row is not a ban

`user_bans` holds the reason and the audit trail. **The enforcement is
`auth.users.banned_until`**, set through the Supabase Admin API by the same server
function — that is what actually stops a token refresh. Treating the table as the control
would produce a ban that stops nothing.

### Why scheduled posts need no scheduler

`blog_post_is_live(status, published_at)` compares `published_at` to `now()` on every read,
and the RLS policy calls it. A post scheduled for Friday becomes visible on Friday with no
job running and nothing to fail.

### Why the view counter is a function

Anonymous readers must be able to increment `view_count` without being able to write
anything else on the row. A policy cannot express "may update exactly one column, only
upward", so `increment_post_view(slug)` is a `security definer` function instead.

### Why analytics grouping is a SQL function

PostgREST cannot `GROUP BY`. Pulling raw timestamps into JavaScript to bucket them works
until the tables are real and then stops working. `admin_daily_counts(days)` does the
grouping in Postgres and is **revoked from `anon` and `authenticated`** — the console calls
it with the service-role key after checking the caller's role in application code.

---

## Applying migrations

Paste each file into the Supabase SQL editor in order, or use the CLI:

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push
```

**Migrations are not idempotent.** `create type` and `create table` fail on a second run.
The SQL editor wraps a paste in a transaction, so a mid-way failure rolls back cleanly.

### The first superadmin

`0003` creates the role machinery but grants nobody. `supabase/bootstrap_superadmin.sql` is
run by hand, once, after the account has signed up normally:

```sql
insert into public.user_roles (user_id, role, granted_at)
select id, 'superadmin', now()
  from auth.users
 where lower(email) = lower('you@example.com')
on conflict (user_id) do update
  set role = 'superadmin', granted_at = now();
```

It is deliberately not a migration: an email address baked into committed SQL would grant
that person the console in every environment, including a teammate's local project and
anything restored from this repo later. Every subsequent role change goes through the
console and writes an audit row.

---

## Types

`src/lib/supabase/types.ts` is hand-written to mirror the migrations. Regenerate with:

```bash
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > src/lib/supabase/types.ts
```

Adding a table means adding it there too, or the typed client will not see it.

---

## Related

- [security.md](security.md) — how these policies fit the wider trust boundary
- [admin-console.md](admin-console.md) — what reads and writes the 0003 tables
