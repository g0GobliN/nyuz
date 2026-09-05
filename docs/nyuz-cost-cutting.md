You are now responsible for bringing Nyuz to a safe pre-launch state.

Read this entire instruction before changing anything.

# SOURCE OF TRUTH

There are currently two different cost-related plans in the repo/conversation:

1. `docs/nyuz-cost-cutting.md`

   * This is the older optimization roadmap.
   * It contains useful Tier 1–4 ideas such as Groq routing, caches, prompt optimization, batch clustering, etc.
   * It is NOT authorization to implement every pending item now.

2. The newer P0 incident plan.

   * THIS supersedes the old roadmap for current implementation work.
   * The goal is financial correctness and proven high-impact savings first.

The old `docs/nyuz-cost-cutting.md` should remain as a future optimization roadmap.

DO NOT continue implementing its Tier 2/3/4 wishlist merely because items are marked pending.

---

# CURRENT STRATEGY

We are NOT abandoning all previous cost-cutting work.

We are doing this:

## KEEP low-risk P0-aligned work

Keep existing working implementations of:

* off-peak cron scheduling
* source reclassification / demand-driven source collection
* adaptive polling
* sensible DB indexes
* shared `event_impacts`
* existing Worker cron consolidation
* existing provider abstraction itself, if it existed before this work

Do not revert working low-risk infrastructure just because it was mentioned in the old document.

## FREEZE / DEACTIVATE speculative optimization work for now

Do NOT actively use or further develop:

* Groq routing for clustering
* provider migration
* cluster-cache shortcut / `titleHash()` event attachment
* Story Ask caching
* digest caching
* prompt optimization solely for cost
* batch clustering
* backlog priority queues
* additional P1/P2/P3/P4 optimizations

These can be revisited AFTER P0 financial safety is working and measured.

If database tables/infrastructure for these already exist, do not destroy them merely for cleanliness.

Dormant infrastructure costs almost nothing.

Prefer disabling/reverting active application behavior rather than destructive DB cleanup.

---

# IMPORTANT RULE ABOUT MIGRATIONS

DO NOT blindly delete migration files that may already have been applied to Supabase.

For migrations:

* `0058_cost_cutting.sql`
* `0059_cluster_cache.sql`
* `0060_multi_provider.sql`
* `0061_query_optimization.sql`
* `0062_ask_cache.sql`

first classify each as:

* definitely required by current P0
* harmless dormant infrastructure
* active behavior that should be reverted/deactivated
* production state unknown

If you cannot access production Supabase, say so.

Do NOT pretend migration presence in Git proves it was applied to production.

Do NOT pretend local `.env` proves Cloudflare production configuration.

If a DB cleanup depends on knowing production state, give me READ-ONLY SQL to run manually instead of guessing.

---

# DO NOT MAKE THESE PREVIOUS MISTAKES

Do NOT confuse:

`demand_driven_sources`

with:

`pre_analysis_demand_gate`

They are different.

`demand_driven_sources`
= controls which sources are collected.

`pre_analysis_demand_gate`
= prevents paying to analyse an event when no eligible reader can receive it.

Both matter independently.

Also:

Do NOT assume the `settle_ai_tokens` conflict is 5-arg vs 6-arg merely because those functions exist in migrations.

The earlier production audit found an undocumented `p_id text` overload conflicting with the migration-backed UUID function.

Since you cannot inspect live production unless actual DB access exists, do not drop any function signature based only on migration files.

---

# CURRENT P0 OBJECTIVE

Make Nyuz safe to continue testing with roughly:

* total very-early-stage cost around $10–20/month where realistic
* hard AI financial ceiling around $10/month
* approximately 20M-token secondary fail-safe
* expensive AI work driven by real reader demand
* no spending money on stale old news
* bounded custom-source financial liability
* architecture remains upgrade-shaped, not rewrite-shaped

---

# P0-1 — FIX AI SETTLEMENT APPLICATION LOGIC

Inspect the actual current code around:

`db.rpc("settle_ai_tokens", ...)`

The important question is what happens when:

`error !== null`

Do NOT blame:

`if (!reservation) return`

That merely means there is no reservation to settle.

The actual bug is if the RPC returns an error and the application ignores it.

Fix the application-side settlement path so settlement failure cannot silently masquerade as success.

At minimum:

* structured error log
* include reservation / usage ID
* include capability/model where available
* write `ops_status` or equivalent persistent operational error if that mechanism already exists
* make failure visible to the pipeline/operator
* do not silently continue as though usage settled successfully

Do not redesign the whole AI budget architecture.

Add targeted tests for settlement RPC failure.

---

# P0-2 — VERIFY AND REPAIR `settle_ai_tokens` DB CONFLICT

Because you do not currently have live Supabase access, DO NOT guess which overload should be dropped.

Create a READ-ONLY SQL verification script for me:

```sql
select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_args,
    pg_get_function_arguments(p.oid) as full_args,
    pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'settle_ai_tokens'
order by identity_args;
```

Then tell me:

* which signature current application code expects
* what cleanup migration SHOULD be generated after I provide the live query output

Do NOT create/drop the production function yet unless live function signatures are actually available to you.

The desired end state is:

* one unambiguous authoritative settlement RPC compatible with current app code
* no undocumented conflicting overload
* migration history describes desired production state

---

# P0-3 — TARGETED SCHEMA DRIFT AUDIT

Do a targeted repo-side audit for drift-sensitive objects related to:

* AI reservations
* AI settlement
* cost accounting
* claims
* queue/job state
* source processing
* authentication/authorization

Do NOT turn this into a broad architecture review.

Where production state cannot be known, prepare read-only SQL checks for me.

Do not silently assume Git migration state equals production state.

---

# P0-4 — ENABLE `pre_analysis_demand_gate`

Inspect the implementation of the existing gate.

Verify that it:

* allows events with legitimate current reader demand
* recognizes followed topics
* recognizes eligible custom-source relationships
* respects muted/paused/banned/ineligible reader states according to existing product semantics
* fails closed if demand lookup itself fails
* leaves no-demand events pending/deferred rather than analysing them anyway
* allows a previously pending event to become eligible later when demand appears

Add/verify tests for:

1. demanded event -> analysis allowed
2. no-demand event -> no AI analysis
3. later demand appears -> event becomes eligible
4. demand lookup failure -> no AI spend
5. muted/paused/banned state follows current design

If you cannot query the live feature flag, give me exact SQL to run:

```sql
select key, enabled
from public.feature_flags
where key in (
  'pre_analysis_demand_gate',
  'demand_driven_sources',
  'adaptive_polling'
);
```

Do not mark the production flag enabled merely because a migration contains an UPDATE statement.

---

# P0-5 — KEEP DEMAND-DRIVEN SOURCES AND PRUNE CORE SAFELY

Keep `demand_driven_sources`.

Review current source scheduling logic and `0058`.

Do NOT use nonexistent `sources.updated_at`.

Do not delete source records.

Desired concept:

A source should be `core` only when Nyuz genuinely intends to monitor it regardless of current reader demand.

Niche/topic-specific feeds should normally remain `demand`, even when currently active due to reader demand.

Do NOT convert a demand source into `core` merely because someone currently follows it.

Core is editorially unconditional.

Demand means conditional but active when justified.

Target a genuinely small core set, roughly <=25–30 and preferably fewer if coverage remains good.

Since you cannot query production, provide read-only SQL for:

```sql
select coverage_mode, count(*)
from public.sources
group by coverage_mode
order by coverage_mode;
```

and:

```sql
select *
from public.sources
where coverage_mode = 'core'
order by id;
```

Do not guess current production counts.

---

# P0-6 — CLUSTER MAX TOKENS

Use the existing provider/model.

Do NOT switch to Groq now.

Do NOT redesign clustering.

Do NOT enable deterministic cluster skip.

Do NOT modify shortlist/Jaccard/event semantics.

Set the cluster route output allowance to:

`max_tokens = 1024`

initially.

IMPORTANT:

Do this through the existing route/config mechanism.

Do not confuse the model name environment variable with the route's `max_tokens`.

Run representative clustering tests at 1024 and report:

* successful calls
* JSON validity
* completion token distribution
* `finish_reason`
* `TruncatedCompletionError`
* retries
* merge correctness

If 1024 causes meaningful real truncation, report the evidence and recommend the smallest safe higher value.

Do not silently increase it.

For now restore/leave digest and reason at their known-safe previous values.

Do NOT optimize digest/reason token limits in this P0.

---

# P0-7 — HTTP 402 RESERVATION RELEASE

Find `isDefinitelyUnbilledAiError` or equivalent.

Add HTTP:

`402 Payment Required`

to the definitely-unbilled path.

Expected behavior:

Provider returns 402
-> provider did not perform billable model work
-> internal AI reservation is released
-> no artificial budget usage remains for an hour
-> the actual provider failure still surfaces correctly

Add tests proving this.

Do not treat uncertain failures like 5xx/timeouts as definitely unbilled.

Remain conservative for ambiguous failures.

---

# P0-8 — BUDGET CONFIGURATION

Desired production configuration:

`AI_MONTHLY_COST_USD = 10`

`AI_MONTHLY_TOKEN_BUDGET = 20000000`

The $10 ceiling is the main financial safety rail.

20M tokens is a secondary runaway-loop fail-safe and should not stop the product before the dollar cap.

Do NOT rely silently on:

`DEFAULT_AI_MONTHLY_TOKEN_BUDGET = 500000`

in production.

Repo-side work:

* document expected production variables
* warn loudly through existing health/admin mechanisms if production is using the 500k fallback unintentionally
* do not expose secrets

Because local `.env` does NOT prove Cloudflare production config, give me exact manual Cloudflare steps/variables to configure.

Do not claim production is configured until I confirm it.

---

# P0-9 — CUSTOM SOURCE FINANCIAL LIMITS

Keep global source reuse.

If 10 users subscribe to the same canonical feed, Nyuz should process that source once globally.

But individual accounts must not activate unlimited distinct custom feeds.

Server-side limits:

Free: 0
Personal: 5
Pro: 25

Inspect all relevant paths:

* create
* update
* re-enable
* direct API
* RPC
* import path if one exists

Count canonical DISTINCT ACTIVE custom sources according to existing semantics.

Do not rely only on frontend checks.

Add tests proving:

* Free cannot add one
* Personal succeeds through 5 and fails at 6
* Pro succeeds through 25 and fails at 26
* direct API/RPC bypass fails
* duplicate canonical source does not incorrectly multiply global pipeline work

Do not redesign the custom-source subsystem.

---

# P0-10 — STALE BACKLOG BANKRUPTCY

Do NOT blindly drain old backlog.

The goal is economic bankruptcy on stale processing work, not data destruction.

Implement the smallest safe mechanism so old unprocessed articles do not keep competing for expensive clustering.

Use approximately:

7 days

as the initial stale threshold unless current schema semantics strongly require something else.

Desired behavior:

* recent demanded content gets priority
* recent useful content remains eligible
* old unclustered news with no active reason does not consume AI budget
* stale pending events with no current demand remain unanalysed
* historical rows can remain in DB if useful
* no destructive mass deletion

Prefer:

* skipped/deferred/stale state where existing schema supports it
* filtering them out of expensive candidate selection
* reversible behavior

Before changing selection logic, add a read-only/admin calculation for:

* unclustered <24h
* unclustered 1–3d
* unclustered 3–7d
* unclustered >7d
* pending events by age
* pending events with demand

Do not process the old backlog just to make counters look clean.

---

# P0-11 — STUCK `analysing` EVENTS

Investigate the stale `analysing` event logic.

Earlier audit found approximately 146 events stuck because general `last_updated_at` may be refreshed when new articles attach to an event.

Determine whether reclaim age is incorrectly tied to general event updates rather than a dedicated analysis claim time.

Safety requirement:

DO NOT accidentally perform duplicate analyses.

If this can be corrected with a small safe change, implement and test it.

If it requires a meaningful schema/queue redesign, leave it for P1 and clearly report why.

Do not invent a complex queue system now.

---

# OLD COST-CUTTING WORK — WHAT TO DO WITH IT

Review these existing accidental/old-roadmap changes:

## Groq / migration 0060

For now:

* do not route production clustering to Groq
* do not add additional Groq work
* revert Groq-specific application cost/routing behavior if it changed existing DeepSeek-only behavior
* preserve generic provider abstraction if it pre-existed and is harmless

If `0060` DB objects already exist, leave dormant infrastructure unless removal is required for correctness.

Do not create destructive cleanup just for tidiness.

## Cluster cache / migration 0059

Do not use a title-hash shortcut that directly attaches articles to existing events during P0.

It changes clustering correctness semantics for relatively small savings.

Disable/revert ACTIVE `titleHash()` shortcut/cache behavior.

If the table/RPC already exists, it can remain dormant.

Do not drop it unless required.

## Story Ask cache / migration 0062

Story Ask is not a major current cost driver.

Remove/deactivate newly-added Ask caching application behavior for now.

If `0062` is definitely not applied anywhere and is uncommitted/new, it can be removed from the working branch.

If application state is uncertain, report it instead of guessing.

## Digest cache / migration 0061

Remove/deactivate newly-added digest caching application behavior for now.

Do not drop harmless DB infrastructure simply because it is unused.

## Prompt optimization

If prompts were changed solely because of the old roadmap and there are no before/after quality tests, restore the prior known-good prompts.

Do not sacrifice news quality to save tiny prompt costs.

## Query indexes

Keep sensible indexes that are low risk and benefit actual queries.

Do not remove useful indexes merely because the old roadmap created them.

---

# DO NOT DO

Do NOT:

* migrate clustering to Groq now
* add another AI provider
* enable deterministic_cluster_skip
* loosen clustering thresholds
* rewrite clustering
* batch clustering
* add embeddings
* add vector DB
* add microservices
* add queues
* optimize Story Ask
* optimize digest generation
* optimize translation
* change event_impacts semantics
* rewrite matching
* upgrade Cloudflare
* upgrade Supabase
* raise the $10 AI ceiling
* blindly process stale backlog
* perform destructive DB cleanup without verified production state
* claim production facts from local `.env`
* claim migrations are applied because files exist
* claim feature flags are enabled because a migration says UPDATE
* create another broad architecture review

---

# TESTING STANDARD

After repo-side P0 work:

Run:

* typecheck
* lint
* complete existing test suite
* targeted new tests for changed paths

Specifically prove:

### Settlement

* RPC error is detected
* settlement failure is loud
* success records actual usage correctly at application level

### Demand gate

* demanded event allowed
* no-demand event rejected/deferred
* later demand works
* lookup failure fails closed

### Cluster

* 1024 works on representative cases
* JSON valid
* truncation measured
* retries sane

### HTTP 402

* reservation released
* failure surfaces

### Custom source limits

* Free 0
* Personal 5
* Pro 25
* direct bypass rejected

### Backlog

* stale content excluded from expensive work
* recent demanded content unaffected

### Stuck analysing

* no duplicate model spending

Do not claim production DB behavior is tested by unit tests alone.

---

# MANUAL ACTIONS FOR ME

At the end, provide a separate section:

# MANUAL ACTIONS FOR VISHAL

Include only things I actually need to do manually.

For Supabase, give exact SQL.

Separate:

## READ-ONLY verification SQL

from:

## MUTATING SQL

Never mix them.

For any mutating SQL:

* make it transactional/idempotent where practical
* explain exactly what it changes
* warn me before DROP/DELETE/destructive operations

For Cloudflare tell me exactly which variables need to be set:

* `AI_MONTHLY_COST_USD=10`
* `AI_MONTHLY_TOKEN_BUDGET=20000000`

If other existing variables must change, list them.

Do not expose secrets.

---

# DOCUMENTATION

Update `docs/nyuz-cost-cutting.md` only AFTER P0 implementation state is known.

Do NOT mark old roadmap items complete merely because infrastructure exists.

Restructure status conceptually as:

## Active P0 safety work

what is required now

## Completed low-risk optimizations

off-peak, source demand, adaptive polling, etc.

## Frozen future optimizations

Groq
cluster cache
Ask cache
digest cache
batch clustering
priority queue
additional prompt optimization

Keep useful future ideas in the document.

Do not delete the roadmap.

---

# FINAL RESPONSE FORMAT

Return:

# NYUZ P0 IMPLEMENTATION RESULT

## 1. Repo changes made

Exact files and what changed.

## 2. Old-plan cleanup

For each of:

* Groq
* cluster cache
* Story Ask cache
* digest cache
* prompt optimization
* query indexes

state:

KEEP
DEACTIVATED
REVERTED
DORMANT
NEEDS PRODUCTION VERIFICATION

and why.

## 3. Settlement safety

* application error handling fixed?
* live DB signature verification still required?
* exact read-only SQL for me?

## 4. Demand safety

* pre-analysis gate implementation verified?
* production flag verification required?
* source scheduling state?

## 5. AI budget safety

* $10 ceiling code/config state
* 20M token state
* HTTP 402 state

## 6. Cluster safety

* max_tokens
* provider
* test results
* truncation behavior

## 7. Custom source protection

* exact limits
* enforcement points
* tests

## 8. Backlog

* stale policy
* expected avoided work
* data deletion: yes/no

## 9. Stuck analysing events

* root cause
* fix or deferred
* duplicate-spend protection

## 10. Tests

* typecheck
* lint
* complete test count
* targeted test count/failures

## 11. Manual actions for me

Exact Supabase read-only SQL first.

Then, only where proven necessary, exact mutation SQL.

Then Cloudflare configuration.

## 12. What is intentionally deferred

List all old roadmap optimizations frozen until after P0 measurement.

## 13. Launch status

End with exactly one:

SAFE TO CONTINUE TESTING

NOT SAFE YET

SAFE FOR EARLY PAID USERS

Do not say SAFE FOR EARLY PAID USERS until settlement accounting and actual production financial limits are verified.

---

# ENGINEERING PRIORITY

The order is:

1. Financial accounting correctness
2. Prevent unnecessary analysis spend
3. Prevent unnecessary source work
4. Bound user-created financial liability
5. Ignore economically useless stale work
6. Only then optimize models/caches/providers

Do not chase $0.50 savings while the system that measures and caps spending is unreliable.

The architecture should remain simple.

When Nyuz grows, scaling should mostly mean increasing Cloudflare/Supabase/AI/worker capacity — not rewriting the product.
