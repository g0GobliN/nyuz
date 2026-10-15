# Database

Postgres via Supabase. Migrations are applied in numeric order.

| Migration                                | Contents                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                          | Core schema — identity, interests, content, delivery, feedback                                                                                                                               |
| `0002_rls.sql`                           | Row-level security for everything in 0001                                                                                                                                                    |
| `0003_admin.sql`                         | Roles, bans, blog, site settings, AI routing, flags, audit                                                                                                                                   |
| `0017_plan_entitlements.sql`             | Launch plan caps, inactivity state, alert/source guards, AI ledger, digest retention                                                                                                         |
| `0018_source_topic_graph.sql`            | `sources.coverage_mode`, global `source_topics` map — schema only, inert until phase 3/4 (docs/track.md)                                                                                     |
| `0019_source_topics_seed.sql`            | First-pass source→topic mapping for the 64 seeded feeds — draft data, editable in the console                                                                                                |
| `0020_source_demand.sql`                 | `admin_source_demand()` — read-only, how many eligible readers each source's topics reach                                                                                                    |
| `0021_demand_gate.sql`                   | `pre_analysis_demand_gate` feature flag (off by default) and `events_with_demand()`, the pre-analysis skip check                                                                             |
| `0022_cluster_v2_flag.sql`               | `deterministic_cluster_v2` feature flag (off by default) — shadow-only, never changes a clustering decision                                                                                  |
| `0023_source_topics_seed_2.sql`          | `source_topics` mapping for the 19 (of 23) sources added since `0006`/`0019` that are live and working                                                                                       |
| `0024_reclassify_optional_sources.sql`   | 10 sources (arXiv research, sport, entertainment/music) moved from `core` to `demand` — measured to be the biggest low-risk share of the analysis backlog with least current reader interest |
| `0025_disable_dead_sources.sql`          | Disables the 4 confirmed-404/duplicate sources found while auditing `0023`'s targets                                                                                                         |
| `0026_reclassify_remaining_optional.sql` | Remaining 17 general-news and security sources moved to `demand` — `core` is now exactly the original 60 (of 64) technology sources, minus 0025's 4                                          |
| `0027_enable_flags.sql`                  | Turns on `deterministic_cluster_v2` and `pre_analysis_demand_gate` — both live                                                                                                               |
| `0028_event_impacts.sql`                 | `event_impacts` — one shared "why it matters" per event, replacing the per-reader-per-story model call                                                                                       |
| `0029_event_translations.sql`            | `event_translations` keyed on (event, language, content_version) + `notification_preferences.language`                                                                                       |
| `0030_custom_sources.sql`                | `user_custom_sources` + `claim_custom_source` (atomic per-plan cap); demand functions count direct followers                                                                                 |
| `0031_demand_driven_collection.sql`      | `sources.last_demand_at`, `refresh_source_demand()`, `sources_to_collect()`, `demand_driven_sources` flag                                                                                    |
| `0032_adaptive_polling.sql`              | `sources.last_new_content_at` / `polling_tier`, `polling_tiers`, `recompute_polling_tiers()`, `adaptive_polling` flag                                                                        |
| `0033_cluster_shadow_log.sql`            | `cluster_shadow_log` + `cluster_shadow_summary()` — persists deterministic shadow decisions                                                                                                  |
| `0034_cluster_skip_flag.sql`             | `deterministic_cluster_skip` flag (off; do not enable without shadow data)                                                                                                                   |
| `0042_launch_capacity.sql`               | Launch cap, bounded corpus/probes, retryable Stripe events and private operational config                                                                                                    |
| `0043_unit_economics.sql`                | Service-only Stripe/operating-cost ledgers and per-call AI USD snapshots for the admin cost dashboard                                                                                        |
| `0044_ai_cost_ceiling.sql`               | Atomic global monthly AI dollar ceiling alongside the token ceiling                                                                                                                          |
| `0045_launch_blocker_repair.sql`         | Idempotent 0042 drift repair; ordered Stripe lifecycle, demand-aware selection, capacity deferral, delivery leases, transactional alerts and operational status                              |
| `0067_history_entitlement.sql`           | `history_window_start()` on the digests policy, downgrade grace, `history_months()`, grace-aware purge, `user_events` pruning, corpus 400→420 days — see [history-retention.md](history-retention.md) |
| `0075_deadline_aware_pipeline.sql`       | Demand/deadline priority queues for clustering and analysis, a fixed low-priority background lane, and briefing-readiness metrics                                                            |

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

| Table                 | Notes                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources`             | Feeds, with `failure_count` and `active` for back-off                                                                                         |
| `articles`            | Raw items. `content_hash` is the exact-duplicate guard                                                                                        |
| `events`              | The unit of meaning. `importance`, `novelty`, `analysis_tokens`                                                                               |
| `event_topics`        | Event → topic with confidence                                                                                                                 |
| `source_topics`       | Source → topic with confidence (0018). Empty until seeded through the admin console — see docs/track.md phase 3                               |
| `event_impacts`       | One shared "why it matters" per event (0028), reused by every reader. **Never per-user** — that is Story Ask                                  |
| `event_translations`  | Cached language views (0029), keyed `(event, language, content_version)`. Never per-user                                                      |
| `user_custom_sources` | Which readers asked for which global source (0030). Many followers, one crawler. **No insert policy** — adds go through `claim_custom_source` |

### Delivery

| Table          | Notes                                                              |
| -------------- | ------------------------------------------------------------------ |
| `user_events`  | Match results plus durable `briefed_at` deduplication. Pruned on the plan window (0067) |
| `digests`      | One per user per scheduled slot. `skipped` is a real success state. **Readable only inside `history_window_start()`** (0067) |
| `digest_items` | `why_it_matters`, plus the composed `summary` artifact (0118) and the `delivered_revision` it was composed from |
| `deliveries`   | Per channel, with attempts and retry                               |

### Feedback

| Table                     | Notes                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `feedback`                | useful / not_useful / not_interested                                    |
| `saved_stories`           | Kept past the retention window                                          |
| `alert_claims`            | Atomic rolling alert quotas; browser-inaccessible                       |
| `ai_usage_ledger`         | Monthly token reservations and settled usage; browser-inaccessible      |
| `billing_ledger`          | Live Stripe charge, refund and balance-fee facts; browser-inaccessible  |
| `operating_cost_settings` | Actual monthly provider bills entered by an admin; browser-inaccessible |

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

## Source visibility (0039)

Three independent questions about a source, answered by three columns. Conflating
any two of them produces a wrong answer somewhere, so they are kept apart:

| Column          | Question                             | Values                   |
| --------------- | ------------------------------------ | ------------------------ |
| `coverage_mode` | **Why** we crawl it                  | `core` \| `demand`       |
| `listed`        | Whether a reader may **discover** it | boolean, default `false` |
| `origin`        | Where it **came from**               | `curated` \| `user`      |

`coverage_mode` is the tempting shortcut for visibility and it is wrong: 27 of the
curated catalogue are already `demand`, so hiding non-core sources would hide 27
real feeds from the readers who asked for those subjects. Coverage answers a
scheduling question; listing answers a product one.

**The bug 0039 closes.** `0002` granted `for select to authenticated using (true)`
on `sources`. Since `0030` let readers add their own feeds into that same global
table, every signed-in account could read every other account's private sources —
through the reader source page and by querying PostgREST directly with their own
token. The policy is now `listed OR I follow it`.

**No `created_by_user_id`.** Ownership already exists in `user_custom_sources`,
and it is many-to-many on purpose: a hundred readers submitting the same feed
follow one canonical `sources` row and one crawler. A `created_by` column would
describe only whoever happened to be first and would go stale when they left.
`origin` records provenance without naming a person.

**Reader queries are bounded in SQL.** `reader_sources()` returns catalogue
entries matching the reader's topics through `source_topics`, plus their own
follows regardless of topic, with limit and offset. `search_reader_sources()` is
deliberately wider — the whole catalogue rather than only followed subjects,
because somebody searching for a publication is looking for one they do not have
— but never wider than `listed` plus their own. Both are `security definer`,
revoked from `PUBLIC`, and take the user id as an argument, so they are only safe
after `signedInOnly` has verified the token.

## Translation style versioning (0040)

`event_translations.style_version` records which `TRANSLATION_STYLE_VERSION`
produced a row. It is **not** part of the cache key — `content_version` already
hashes the style version, so improving a profile makes old rows miss and
regenerate. That gives correctness.

This column gives traceability, which a hash cannot: which profile wrote this
row, how much of the cache is still on an older style, and which rows to warm
deliberately after a profile change.
