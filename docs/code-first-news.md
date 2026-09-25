# Code-first news and financial policy

This specification supersedes the older AI pipeline/cost plans. Migration `0085_code_first_news.sql` must precede the application release. It has not been applied to production by this implementation task. Do not run old workers alongside the new deployment: database reservations reject retired features, but old workers cannot perform deterministic finalization.

## Production boundaries

Ingestion, normalization, classification, clustering, the retained `analyse` stage, topic assignment, importance, novelty, matching, ranking, onboarding/backfill, briefing, alerts, delivery, metadata requests, dashboard, prefetch and maintenance make **zero provider calls**. They do not require a working provider or available AI budget.

Only an authenticated, authorized explicit story open can initiate shared synthesis. The separate POST endpoint validates the event and reader access; GET metadata/prefetch only reads stored data. Explicit administrator connection tests remain metered exceptions, under the same financial ceilings.

The long article belongs to `(event_id, content_version)`, never a reader. Cached reading uses no initiation allowance, reservation, or provider call.

## Launch controls

| Control                              |     Default | Enforcement                                                                          |
| ------------------------------------ | ----------: | ------------------------------------------------------------------------------------ |
| UTC daily spend ceiling              |       $0.50 | Atomic database reservation; cannot exceed launch ceiling                            |
| UTC monthly spend ceiling            |         $10 | Atomic database reservation; cannot exceed launch ceiling                            |
| Concurrent uncached generations      |           2 | Database leases, globally serialized admission                                       |
| Lifetime paid attempts/event version |           3 | Database counter increment immediately before dispatch                               |
| New generations/reader/UTC day       |          10 | Database initiation ledger; configurable abuse protection, not a pricing entitlement |
| Explicit failure cooldown            |  30 minutes | Database, shared across every reader                                                 |
| Uncertain outcome cooldown           | 120 minutes | Reconciliation required; elapsed time alone never authorizes another purchase        |

New story settings are database-owned `ai_runtime_config` entries editable through the existing audited administrator settings. Environment variables cannot override those database rules. The existing monthly token cap, per-model daily caps, provider credit gate, kill switch, access checks and plan restrictions remain.

Before transport: validate explicit authenticated initiation, check cache and evidence, acquire the event/version claim, enforce cooldown/attempt/user/global limits, reserve worst-case input/output cost, revalidate the owner and initiation allowance, then dispatch. A denial makes zero provider requests. Cached content remains readable; no automatic paid retry or paid work queue is created.

Reservations use the existing conservative input-token bound and maximum output at peak model rates. Unknown pricing denies admission. Unresolved charges from previous days/months continue to occupy financial headroom until reconciled; they are never represented as actual settled spend. These are application-enforced limits under the configured provider rate card, not authority over an external provider's billing or unrelated uses of its API key.

## Deterministic news quality

Clustering searches the existing indexed headline shortlist, then compares complete normalized titles. Near-identical content-word order, matching numbers/negation, a 48-hour publication window, and one unambiguous target are required. Conflicting or ambiguous candidates form separate events. Research uses the same conservative rules; it is not categorically excluded. Database owners and two-minute leases protect individual articles and finalization; stale free work can be reclaimed safely.

Finalization preserves `complete`, `analysed_at`, and final `event_topics`. It chooses source wording and useful descriptions rather than inventing prose.

Attribution is part of the prose rather than a label in front of it. A source's own `The paper reports: <fact>` is published as the fact with its attribution after it, a verb that takes an object only loses its colon, and a sentence that already names its claimant is never given a second attribution in front of it. A claim, estimate or projection keeps its attribution either way, and nothing is paraphrased: a frame moves, it does not change what the sentence says. Importance reuses deterministic `scoreEventV2` with one representative per publisher; novelty declines with original event age. Publisher normalization uses source homepages, known domain aliases and recognized subdomains. It does not establish editorial independence. `article_count` and `publisher_count` remain separate.

Article changes mark metadata dirty. Refresh retains original event and analysis times and historical prose. Existing matched-event and alert claims prevent resending an event solely because metadata improves. Briefing and alert selection additionally suppress near-identical recent events, with number/content-word conflicts kept separate.

## Story evidence, versions and display

Feeds retain up to 4,000 sanitized characters of supplied content. No webpage crawler is added. Cards use short selected descriptions. Synthesis selects at most eight useful excerpts, at most 2,400 characters each and 10,000 excerpt characters total, with a conservative 12,000-input-token guard and 4,096 maximum completion tokens including model reasoning. Extremely thin evidence skips generation. There is no minimum word count and no model-based JSON repair.

Understand aims for a full readable explanation: 250–400 words by default, 400–600 with strong evidence, up to about 700 for a very rich major story, and about 120–180 with thin evidence. These are targets, not minimums; trustworthy evidence determines length, never padding or guesses. This guidance applies to new generations and does not invalidate existing shared stories.

The response contains only an introduction and cited paragraphs; scores and analytical structures are not regenerated. A small compatibility envelope lets the existing reader render the article. Citation indices retain the selected article IDs.

Versioning uses the existing deterministic development markers and numeric magnitude buckets, not views, reader IDs, row timestamps, source order or publisher counts. Incidental company/country/ticker recognition no longer changes the key. Historical prose is adopted without a paid conversion. Heuristic markers can still cause false version changes or miss subtle developments; inspect stored cases without provider comparisons.

Metadata returns before synthesis begins. The mounted story page separately requests generation once; concurrent readers poll metadata briefly, without re-invoking generation. Capacity/budget/weak-evidence denials leave the deterministic page usable. No automatic paid retry occurs when capacity becomes free or a budget resets.

## Recovery and accounting

- Before dispatch: no paid attempt is consumed for failed validation, cache/claim refusal, budget or capacity denial.
- Explicit provider error: record it, settle measured usage when available, retain uncertain charges otherwise, and apply shared cooldown.
- Timeout/crashed requesting owner: transition to `uncertain`; require operator reconciliation before any later paid attempt. The longer cooldown is a minimum, not retry permission.
- Usable output: stage the same payload durably, then promote it to ready. Retry only those writes. A staged payload is recoverable on the next open with no provider call.
- Complete storage outage: serve in-memory output to the initiating reader if possible. No system can guarantee durable recovery when all storage writes fail and the worker is destroyed; the unresolved attempt is blocked for reconciliation rather than automatically repurchased.
- Owner identity fences late workers. Lease expiry alone never lets a paid request overwrite a newer owner.
- The existing cron calls `void_stale_ai_reservations`; only positively unstarted reservations older than at least one hour are voided. Unknown historical/in-flight charges are not automatically erased.
- Observed usage is assigned idempotently into typed token/cached-token/cost columns, not added twice. Migration repair promotes numeric historical observed usage only where typed input/output counts were both zero.

## One-query financial report

Run as a service-role operator; these views are not reader-accessible:

```sql
select f.*, b.actual_today_usd, b.actual_month_usd,
       b.reserved_or_uncertain_usd as total_reserved_or_uncertain_usd,
       b.monthly_available_usd
from ai_budget_status b
left join ai_daily_financial_report f
  on f.utc_day = date_trunc('day', now() at time zone 'UTC')
order by f.feature;
```

Requests, input/output/cached tokens, failures, settlements, voids, actual spend and unresolved reservations are separate. A no-usage day has no feature rows; the budget row still appears. The hard monthly allowance remaining also reserves room for uncertain charges.

## Validation and rollout

Tests use injected fake provider transport. `NODE_ENV=test` or `CI=true` blocks real provider fetch before network dispatch; the normal suite replaces real fetch with a throwing transport and substitutes test-only provider secrets. Tests must not enable live provider access.

Run `npm run ci` for typecheck, lint, tests and production build. PostgreSQL tests execute the real reservation/metering migrations in local PGlite; fixture tests cover zero-provider background/onboarding/prefetch and shared story generation. No live-provider comparison is needed or authorized.

Review migration and application together, pause old workers, apply the migration, then release compatible code through the normal operator process. This task does not deploy or push. Retain schema and historical content; rolling back application code alone would restore callers that the database deliberately refuses.
