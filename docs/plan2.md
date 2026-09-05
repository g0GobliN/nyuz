# NYUZ V2 — DEMAND-DRIVEN INTELLIGENCE ARCHITECTURE

## Canonical Master Implementation Prompt

You are working inside the **existing Nyuz repository**.

You are acting as:

* principal software engineer
* product architect
* database architect
* AI infrastructure engineer
* security engineer
* billing architect
* Cloudflare/Supabase engineer
* cost optimization engineer
* QA engineer

This is **NOT a greenfield project**.

Do not redesign Nyuz from scratch.

Do not replace working systems merely because another architecture appears cleaner.

Do not introduce fashionable infrastructure without demonstrated need.

Do not make assumptions about the repository before inspecting it.

The objective is to evolve the existing Nyuz architecture into a **demand-driven personal intelligence platform** where crawling, AI, translation, alerts, and personalization costs are driven primarily by real user demand.

The central rule is:

> **Global knowledge is created once. Users reference it. Never duplicate event knowledge per subscriber.**

The economic rule is:

> **Do expensive work only when somebody wants the result, and if the result can help more than one person, pay for it only once.**

---

# 1. EXISTING PRODUCT

The current product already has significant working infrastructure.

Assume nothing until verified, but expect to find systems for:

* authentication
* onboarding
* billing
* subscription plans
* admin console
* editable marketing site
* blog
* source ingestion
* normalization
* article clustering
* global event analysis
* deterministic user matching
* digest generation
* email delivery
* breaking alerts
* Story Ask / Deep Explain
* AI provider routing
* quotas
* AI usage ledger
* source health/backoff
* Cloudflare Workers deployment
* Supabase
* PostgreSQL
* RLS
* migrations
* existing tests
* CI

Preserve working behavior unless this specification explicitly changes it.

---

# 2. FIRST TASK — AUDIT BEFORE IMPLEMENTATION

Before modifying production behavior, inspect at minimum:

```text
docs/architecture.md
docs/database.md
docs/status.md
docs/ai-providers.md
docs/admin-console.md
docs/site-content.md
docs/security.md
docs/development.md
docs/plan.md
docs/product-brief.md
```

Also inspect:

* every database migration
* current Supabase schema
* RLS policies
* generated/handwritten database types
* pipeline implementation
* cron entrypoints
* worker entrypoints
* source ingestion
* clustering
* event analysis
* matching
* digest generation
* translations if any
* Story Ask
* alerts
* AI routing
* AI ledger
* quotas
* source health
* account inactivity
* plan entitlement implementation
* Stripe catalogue/configuration
* checkout
* Stripe webhooks
* marketing pricing
* site-content overrides
* admin functionality
* tests
* CI
* Cloudflare configuration
* environment variables

Create an internal architecture map:

```text
SUBSYSTEM
→ FILES
→ DATABASE TABLES
→ WORKER/CRON ENTRYPOINT
→ EXTERNAL DEPENDENCIES
→ TESTS
→ KEEP / MODIFY / MIGRATE / DEPRECATE
```

Then produce a concise architecture-gap report.

Do not begin large implementation work until this exists.

---

# 3. EXISTING INVARIANTS

These invariants must survive V2:

1. Content remains global.
2. Events remain the unit of meaning.
3. Users reference global events rather than owning copies.
4. Event analysis happens at most once automatically per meaningful event version.
5. Exclusions beat positive interests.
6. RLS remains fail-closed.
7. Billing controls plan state server-side.
8. Quotas remain atomic/database-backed.
9. Scheduled jobs remain idempotent.
10. Pipeline retries cannot accidentally duplicate paid AI work.
11. Cloudflare Workers code cannot depend on unsupported Node built-ins.
12. Service-role secrets never reach browser code.
13. Stripe webhook state is authoritative for subscriptions.
14. User-controlled fields cannot grant entitlements.
15. Historical events/digests remain readable.
16. Existing production data must be preserved.

---

# 4. PRODUCT PHILOSOPHY

Nyuz is NOT:

* an RSS reader
* a generic news aggregator
* an AI summarizer
* a ChatGPT wrapper
* a website-monitoring dashboard
* a feed containing everything happening online

Nyuz is:

> **A personal intelligence layer that continuously watches what matters to the reader and reports meaningful changes.**

Core product promise:

> **Stop searching. Start knowing.**

Supporting concept:

> **You don't read the news. It reports to you.**

Internal V2 philosophy:

> **Nyuz watches your internet, not the entire internet.**

And:

> **Less information. More relevance. Zero searching.**

---

# 5. OLD COST MODEL

The approximate V1 architecture is:

```text
MANY GLOBAL SOURCES
        ↓
FETCH EVERYTHING FREQUENTLY
        ↓
NORMALIZE
        ↓
AI CLUSTERING
        ↓
AI EVENT ANALYSIS
        ↓
USER MATCHING
        ↓
AI PERSONALIZATION PER USER/STORY
        ↓
DELIVERY
```

This makes cost depend unnecessarily on:

```text
internet volume
+
source count
+
article volume
+
event volume
+
user × story personalization
```

That must change.

---

# 6. V2 TARGET ARCHITECTURE

The architecture should evolve toward:

```text
USER DEMAND
      ↓
TOPICS + CUSTOM SOURCES
      ↓
SOURCE DEMAND GRAPH
      ↓
RELEVANT SOURCES
      ↓
ADAPTIVE POLLING
      ↓
ARTICLES
      ↓
NORMALIZATION
      ↓
CHEAP DETERMINISTIC CLUSTERING
      ↓
AI ONLY FOR AMBIGUOUS CASES
      ↓
EVENT
      ↓
DEMAND GATE
      ↓
SHARED EVENT ANALYSIS ONCE
      ↓
SHARED EVENT KNOWLEDGE
      ↓
DETERMINISTIC SQL MATCH
      ↓
DIGEST ASSEMBLY
      ↓
OPTIONAL TRANSLATION
      ↓
OPTIONAL PERSONAL AI
```

Design rule:

> **Discover cheaply. Understand once. Personalize only when explicitly requested.**

AI should become:

* an exception handler
* a shared intelligence generator
* an explicitly requested personal reasoning layer

AI should NOT be the default implementation of every pipeline stage.

---

# 7. GLOBAL KNOWLEDGE MODEL

The most important architectural rule remains:

```text
EVENT = GLOBAL KNOWLEDGE
```

BAD:

```text
user_a_event_123
user_b_event_123
user_c_event_123
```

GOOD:

```text
events
  evt_123

user_events
  user_a → evt_123
  user_b → evt_123
  user_c → evt_123
```

If 100,000 users care about one event:

```text
analyse once
match 100,000 times cheaply
```

Do not create 100,000 copies of its intelligence.

---

# 8. SOURCE CLASSES

Introduce two conceptual source coverage classes:

```text
CORE
DEMAND
```

Use naming consistent with the existing schema.

Possible field:

```text
coverage_mode
```

Possible values:

```text
core
demand
```

Do not blindly use this exact implementation if the existing schema provides a better pattern.

---

# 9. CORE SOURCES

Core sources are deliberately selected global discovery sources.

They remain monitored without requiring a specific subscriber.

Core status must be explicit.

Do NOT hardcode arbitrary publishers from this specification.

Use:

* existing source data
* admin configuration
* measured source value
* editorial/product requirements

The number of core sources should remain intentionally bounded.

---

# 10. DEMAND SOURCES

Demand sources are monitored because somebody currently wants their information.

Demand may originate from:

1. active user topic interests
2. explicit custom-source follows
3. paid-plan monitoring
4. breaking-alert requirements
5. another justified product demand signal

When demand reaches zero, the source may eventually pause.

Do not instantly disable it.

Use a configurable grace period to prevent:

```text
ON
OFF
ON
OFF
```

thrashing.

---

# 11. SOURCE ↔ TOPIC GRAPH

Create a global source-topic relationship.

Conceptually:

```text
source_topics

source_id
topic_id
confidence
created_at
updated_at
```

Requirements:

* global relationship
* unique `(source_id, topic_id)`
* confidence bounded appropriately
* indexed
* pipeline/admin writable
* browser users cannot arbitrarily modify it
* signed-in read access only if product behavior requires it

A source may cover many topics.

A topic may use many sources.

Do not assume topic names from this prompt exist.

Use the current controlled topic vocabulary.

---

# 12. USER CUSTOM SOURCES

Paid users should be able to explicitly monitor sources.

Examples:

* RSS
* Atom
* company newsroom
* company engineering blog
* changelog
* security advisory feed
* release feed
* research publication feed
* specialist blog
* supported static webpage where cheap extraction works

Use a relationship:

```text
user_custom_sources

user_id
source_id
active
created_at
updated_at
```

The source itself remains GLOBAL.

Never create:

```text
alice_example_feed
bob_example_feed
```

for the same canonical URL.

Instead:

```text
sources
example.com/feed → source_xyz

user_custom_sources
Alice → source_xyz
Bob   → source_xyz
```

One crawler.

Multiple subscribers.

---

# 13. SOURCE CANONICALIZATION

Before creating a source:

1. validate URL
2. normalize URL
3. follow safe redirects
4. discover canonical feed if applicable
5. canonicalize hostname/path
6. check whether source already exists
7. reuse existing source if found
8. create only when truly new

Use database uniqueness where possible.

Race conditions must not create duplicate sources.

---

# 14. CUSTOM SOURCE SECURITY

Treat submitted URLs as hostile.

Protect against:

* SSRF
* localhost
* private IPv4
* private IPv6
* loopback
* link-local
* cloud metadata endpoints
* redirect-to-private-IP
* DNS rebinding where practically defensible
* embedded credentials
* malformed URLs
* excessive redirects
* huge responses
* slow responses
* unsupported content
* pathological XML
* decompression bombs where relevant

Default allowed protocol:

```text
https://
```

Only support plain HTTP if there is a justified product need and it can be done safely.

Never allow:

```text
file:
ftp:
javascript:
data:
blob:
localhost
internal schemes
```

Apply:

* timeout
* response-size limit
* redirect limit
* content-type validation
* feed parsing limits

Cloudflare Workers constraints must be respected.

---

# 15. STRUCTURED SOURCES FIRST

Prefer:

```text
RSS
Atom
structured release feeds
structured APIs where appropriate
```

over generic webpage scraping.

Do NOT immediately introduce:

* Playwright
* browser farms
* headless Chrome infrastructure
* screenshot parsing
* generic browser automation

For unsupported websites:

```text
attempt cheap safe extraction
↓
if unreliable
↓
mark unsupported
```

Do not build expensive crawling infrastructure without evidence of product demand.

---

# 16. SOURCE DEMAND

Implement deterministic source demand.

Conceptually:

```text
SOURCE DEMAND =
core contribution
+
topic followers
+
direct custom-source followers
+
paid-user weighting
+
alert-related weighting
```

No AI.

Possible representation:

```text
source_demand

source_id
interested_users
paid_interested_users
direct_followers
priority_followers
score
calculated_at
```

But do NOT create redundant state automatically.

Evaluate whether the safest implementation is:

* view
* materialized view
* maintained aggregate
* RPC
* table

based on current traffic/query patterns.

Prefer simple correctness.

---

# 17. USER ACTIVITY AND DEMAND

Dead/ineligible accounts must not permanently create infrastructure cost.

Demand must reuse EXISTING lifecycle semantics.

Inspect current handling for:

* banned users
* inactive-paused users
* invalid subscriptions
* deleted users
* disabled monitoring
* other account states

Do not invent a second definition of "active user."

Use existing canonical state.

---

# 18. PAID DEMAND WEIGHTING

Paid users may create stronger monitoring demand.

Conceptually:

```text
Free
→ consumes mostly already-active shared network

Personal
→ can create bounded new demand

Pro
→ can create more demand and higher polling priority

Future Intelligence
→ potentially larger monitoring/AI allowance
```

But:

```text
1 Pro user
```

must NOT cause:

```text
500 sources × every minute
```

polling.

All tiers remain bounded.

---

# 19. ADAPTIVE POLLING

Replace uniform polling assumptions.

Conceptual tiers:

```text
HOT
NORMAL
LOW
COLD
PAUSED
```

Possible starting cadence:

```text
HOT     ~15 min
NORMAL  ~1 hour
LOW     ~6 hours
COLD    ~24 hours
PAUSED  none
```

These are NOT sacred constants.

Make cadence configurable.

Polling tier can consider:

* demand score
* direct followers
* paid followers
* alert requirements
* publishing frequency
* last useful content
* source value
* failure state
* duplicate rate
* noise rate

Potential source fields:

```text
polling_tier
next_fetch_at
last_demand_at
last_new_content_at
```

Only add fields justified by implementation.

---

# 20. COLLECTION SELECTION

Collector logic should move toward:

```sql
WHERE active = true
AND next_fetch_at <= now()
AND source_is_currently_eligible = true
ORDER BY calculated_priority DESC
LIMIT ...
```

rather than:

```text
for every active source
    fetch
```

Source selection must remain deterministic and observable.

---

# 21. LEARN SOURCE FREQUENCY

Nyuz should learn approximate source publication behavior.

Track enough information to estimate:

* average publication interval
* recent publication interval
* last content discovery
* recent burst behavior
* long-term quiet behavior

Example:

```text
quiet source
↓
poll less

new article found
↓
temporarily increase cadence

continues publishing
↓
stay elevated

quiet again
↓
decay cadence
```

No AI required.

---

# 22. SOURCE VALUE METRICS

Track operational metrics before inventing a sophisticated scoring formula.

Potential metrics:

```text
articles fetched
new articles
events created
duplicate-only articles
meaningful events
low-importance events
topicless events
parked/noise events
analysis triggered
analysis tokens
interested users
paid interested users
fetch failures
average latency
```

Potential conceptual value:

```text
VALUE ≈
meaningful_event_rate
× demand
× uniqueness
÷ cost_and_noise
```

Do not treat this as scientifically correct.

Measure first.

Tune later.

---

# 23. ADMIN SOURCE INTELLIGENCE

Extend the existing admin source/pipeline UI.

Useful per-source fields:

```text
Source
Coverage mode
Demand
Direct followers
Topic followers
Paid followers
Polling tier
Next fetch
Last fetch
Last new content
Articles fetched
Events created
Duplicate rate
Noise rate
Average importance
Failure count
Estimated operational value
```

Admin actions:

* mark core/demand
* enable/disable
* inspect topic mappings
* inspect demand
* inspect followers as aggregates
* inspect health
* inspect polling rationale
* inspect source performance

Do not build an enormous BI system.

Build operational visibility.

---

# 24. ARTICLE INGESTION

Articles remain global observations.

Continue using existing canonicalization/deduplication.

Avoid LLM calls for obvious duplicates.

Use deterministic signals such as:

* canonical URL
* normalized URL
* URL hash
* content hash
* normalized title
* publication timestamp
* source identity

Article ingestion must remain idempotent.

---

# 25. CLUSTERING V2

Do NOT immediately replace the current clustering pipeline.

Current conceptual flow:

```text
trigram shortlist
↓
model same-event decision
```

Keep the shortlist.

Add deterministic confidence before AI.

Possible signals:

* normalized title similarity
* important token overlap
* entity overlap
* source relationship
* time proximity
* topic hints
* numeric/date overlap
* known naming aliases

Produce a confidence score.

Conceptually:

```text
HIGH CONFIDENCE SAME
→ attach to event
→ no AI

HIGH CONFIDENCE DIFFERENT
→ create candidate/new event
→ no AI

AMBIGUOUS
→ cheap cluster model
```

---

# 26. CLUSTER V2 FEATURE FLAG

Implement behind a feature flag such as:

```text
deterministic_cluster_v2
```

Shadow-test against current behavior.

Measure:

```text
incorrect merges
incorrect splits
AI calls avoided
tokens avoided
latency
```

Do not switch globally until evidence supports it.

---

# 27. EMBEDDINGS

Embeddings are OPTIONAL.

First determine whether:

* trigram
* normalized title
* token overlap
* entity overlap
* time window

are sufficient.

Only introduce embeddings if measured cluster quality materially improves.

If added:

* cheap embedding model
* one embedding/article
* global storage
* cache permanently
* no unnecessary regeneration

Do not add a vector database merely because embeddings are fashionable.

Use Postgres capabilities if sufficient.

---

# 28. EVENT MODEL

Events remain:

> **What actually happened.**

Articles are:

> **Reports/observations about what happened.**

One event can have many articles.

Keep all article relationships for:

* provenance
* source transparency
* future updates
* trust evaluation

---

# 29. PRE-ANALYSIS DEMAND GATE

This is a major V2 change.

An event does NOT necessarily require immediate expensive analysis.

After clustering:

```text
EVENT
↓
CHEAP DEMAND CHECK
```

Determine whether it intersects:

* active topic demand
* direct custom-source followers
* core coverage
* editorial/core importance
* alert-related demand
* other justified product demand

If no active reader could plausibly receive it and it is not core-worthy:

```text
store event
↓
leave unanalysed
```

Do not delete it.

If demand appears later:

```text
existing event
↓
demand becomes positive
↓
claim
↓
analyse once
```

---

# 30. EVENT ANALYSIS INVARIANT

Automatic analysis occurs:

```text
at most once per meaningful event version
```

Two workers cannot pay for the same analysis.

Use atomic claim/locking patterns.

Failure must not produce endless paid retries.

---

# 31. BOUNDED ANALYSIS EVIDENCE

An event may contain:

```text
28 articles
```

The model does not need all 28.

Rank evidence.

General preference:

1. primary/official source
2. strong independent source
3. useful specialist source

Select a bounded evidence set.

Example:

```text
1 primary
+
1–2 independent/specialist sources
```

Keep all 28 source relationships in the database and UI.

Only reduce model input.

---

# 32. SHARED EVENT ANALYSIS

Global event analysis should produce reusable intelligence.

Possible output:

```json
{
  "title": "...",
  "summary": "...",
  "before_state": "...",
  "after_state": "...",
  "importance": 0.0,
  "confidence": 0.0,
  "topics": [],
  "entities": [],
  "impact_atoms": {}
}
```

Do not blindly change existing schema to this exact structure.

Map into existing event fields safely.

---

# 33. SHARED IMPACTS

Move common `why_it_matters` reasoning upstream.

Introduce shared event impacts conceptually:

```text
event_impacts

event_id
audience
text
created_at
```

Potential minimal audiences:

```text
general
developer
business
consumer
investor
researcher
creator
```

Do NOT automatically hardcode all of these.

Inspect actual users/product positioning.

Use the smallest useful taxonomy.

An event may have only:

```text
general
developer
business
```

if those are the relevant perspectives.

---

# 34. REMOVE AUTOMATIC USER × STORY AI

This is one of the most important economic changes.

Do NOT automatically generate:

```text
why_it_matters_for_user_A
why_it_matters_for_user_B
why_it_matters_for_user_C
```

for every matched event.

Instead:

```text
event
↓
shared impact atoms
↓
deterministically choose relevant impact
↓
digest
```

Digest assembly should become mostly structural.

Conceptually:

```text
digest_items

digest_id
event_id
position
selected_impact
```

Do not destructively remove existing historical personalized columns immediately.

---

# 35. SAFE PERSONALIZATION MIGRATION

Migration sequence:

```text
1. Add shared event impacts
2. Populate them for new analysed events
3. Update digest generation to prefer shared impacts
4. Stop new automatic personalized paragraph generation
5. Preserve old digest content
6. Mark old field nullable/deprecated if appropriate
7. Decide later whether schema cleanup is worthwhile
```

Historical digests must remain readable.

---

# 36. PERSONAL EXPLANATION ON DEMAND

Instead of automatic AI personalization, expose:

> **Why does this matter to me?**

This becomes an explicit user action.

Reuse Story Ask infrastructure.

Requirements:

* event must be available to that user
* plan entitlement
* quota
* cooldown
* atomic claim
* safety restrictions
* usage ledger
* bounded context
* cache repeated equivalent requests when safe

This is where genuinely personalized reasoning belongs.

---

# 37. STORY ASK

Story Ask may answer:

* What actually happened?
* Why does this matter?
* Why does this matter to me?
* Explain this simply.
* What changed from before?
* What are the risks?
* Give me the timeline.
* How does this compare with the previous announcement?

Use:

```text
canonical event
+
existing shared analysis
+
small relevant source evidence
```

before expanding context.

Do not dump every article into the model.

---

# 38. STORY ASK COST CONTROLS

Implement/reuse:

```text
daily quota
monthly quota if appropriate
cooldown
max context
max output
timeout
model route
global budget
user budget
```

Paid does not mean unlimited abuse.

Repeated equivalent request by the same user should be cacheable where safe.

---

# 39. TRANSLATION ARCHITECTURE

Languages must NOT duplicate semantic content.

Concept:

```text
EVENT
↓
CANONICAL CONTENT
↓
LANGUAGE VIEWS
```

Create global translation cache:

```text
event_translations

event_id
language_code
title
summary
before_state
after_state
model
input_tokens
output_tokens
content_version
status
created_at
updated_at
```

Adapt fields to existing event schema.

Unique concept:

```text
(event_id, language_code, content_version)
```

if versioning is required.

---

# 40. SUPPORTED LANGUAGES

Architecture should support the product's intended languages, currently including:

```text
English
Japanese
Hindi
Nepali
Korean
Simplified Chinese
```

Do NOT:

* create separate event pipelines per language
* recluster translated stories
* reanalyse an event for each language
* translate separately for every user

One semantic event.

Many cached views.

---

# 41. TRANSLATION FLOW

Conceptually:

```text
request(event, ja)
↓
cached?
├── YES → return
└── NO
      ↓
   atomic claim
      ↓
 cheap translation model
      ↓
 global cache
      ↓
 return
```

Concurrent requests must not produce duplicate translation charges.

---

# 42. TRANSLATION MODEL

Translation should have its own AI capability route.

Concept:

```text
translation
```

Use existing database-driven provider routing.

Do not automatically use the strongest reasoning model.

Admin should be able to change the translation route without deployment if current provider architecture supports this.

Track:

```text
calls
input tokens
output tokens
failures
cache hits
```

---

# 43. TRANSLATION FAILURE

Translation failure should:

* record failure
* return graceful UI state
* allow later explicit retry
* not create infinite unattended cron retries

Never repeatedly spend money trying to translate something nobody is currently requesting.

---

# 44. UI LOCALIZATION IS DIFFERENT

Product UI localization uses static i18n resources.

Examples:

* navigation
* onboarding
* billing
* buttons
* settings
* errors

No AI.

Event/story translation uses the global translation cache.

Never mix these systems.

---

# 45. PREFERRED READING LANGUAGE

Allow user preference for reading language.

Do NOT automatically translate the entire matched event universe.

Possible strategy:

### Free

Canonical event content with explicit Translate action.

### Paid

For the small number of events selected into a briefing, optionally prewarm the user's preferred language.

Even then:

```text
event + language
```

is globally cached.

Never:

```text
event + language + user
```

unless actual personalized generation is explicitly requested.

---

# 46. TOPIC MODEL

Current controlled topic vocabulary should remain deterministic.

Do NOT let arbitrary LLM-generated topics explode the taxonomy.

But fix legitimate coverage gaps.

Possible flow:

```text
User types "X"
↓
existing topic?
├── yes → use
└── no
      ↓
candidate topic
      ↓
controlled validation/admin/global creation
```

Custom source monitoring can also operate without forcing every source into a newly invented topic.

---

# 47. USER INTERESTS

Support existing positive interests.

Preserve exclusions.

Matching inputs may include:

* event topics
* user topics
* source relationship
* custom source follows
* source preferences
* exclusions
* density
* importance
* recency
* plan rules

Matching remains deterministic.

---

# 48. MATCHING MUST REMAIN AI-FREE

The normal matching stage:

```text
EVENT
+
USER PREFERENCES
↓
SQL / deterministic logic
↓
user_events
```

No model.

Exclusions are evaluated last and win.

Do not regress this invariant.

---

# 49. CUSTOM SOURCES VS SOURCE PREFERENCES

Keep semantics clear.

Existing source preference may mean:

```text
priority
normal
mute
```

Custom source relationship means:

> **I explicitly want Nyuz to monitor this source.**

These are not necessarily the same.

Document precedence.

Do not overload one table if doing so makes behavior ambiguous.

---

# 50. DIGESTS

Digest generation should become mostly:

```text
select relevant events
↓
rank
↓
choose shared impact
↓
assemble
↓
deliver
```

NOT:

```text
select event
↓
call AI for user
↓
select event
↓
call AI for user
↓
...
```

Quiet days remain valid.

Do not manufacture content to fill a quota.

---

# 51. BREAKING ALERTS

Breaking alerts should use shared event intelligence.

Do not require new personalized AI generation.

Alert decision can consider:

* event importance
* urgency
* novelty
* user interest
* custom source follow
* plan entitlement
* quota
* cooldown

Pro demand may increase source polling priority.

But tiers remain bounded.

---

# 52. DELIVERY

Preserve existing delivery channels.

Keep ranking separate from delivery.

Conceptual abstraction:

```text
delivery.send(channel, payload)
```

Potential channels:

```text
web
email
push
telegram
future integrations
```

Do not put intelligence/ranking logic inside provider adapters.

---

# 53. EMAIL ECONOMICS

Email can become a larger bill than AI if handled poorly.

Normal developments should be batched into briefings.

Avoid:

```text
one article
→ one email
```

except justified breaking alerts.

Track delivery metrics already supported by current provider architecture.

Respect unsubscribe preferences.

Keep transactional and editorial communication logically distinct.

---

# 54. PRICING V2

Nyuz should NOT be positioned as a cheap AI news summarizer.

Target pricing architecture:

## FREE — $0

Purpose:

* acquisition
* product discovery
* shared-network consumption

Suggested direction:

* ~3 topics
* one daily briefing
* core/existing active network
* no custom sources
* no breaking alerts
* limited history
* basic feed
* limited translation behavior
* no or extremely limited expensive Story Ask
* standard delivery

Free-user growth must remain inexpensive.

A free user joining an already-popular topic should cost almost nothing.

---

# 55. PERSONAL — TARGET $14.99/MONTH

Personal is for an ordinary reader who wants Nyuz actively monitoring their interests.

Suggested entitlement direction:

* ~15–20 topics
* ~5 custom sources
* daily briefing
* weekly briefing
* configurable schedule
* breaking alerts
* preferred-language reading
* translations
* Story Ask
* personal explanation
* expanded history
* source preferences
* more saved stories
* no advertising

Potential annual price:

```text
approximately $149.90/year
```

The code catalogue is fixed to this amount. Create a matching immutable live
Stripe Price before enabling checkout.

---

# 56. PRO — TARGET $29.99/MONTH

Pro is the main power-user tier.

Suggested direction:

* very high topic limit
* ~25 custom sources
* multiple schedules
* higher source monitoring priority
* more breaking alerts
* substantially higher Story Ask quota
* Deep Explain
* long history
* advanced source controls
* advanced filters
* priority monitoring
* richer custom monitoring
* exports if/when implemented
* no advertising

Potential annual price:

```text
approximately $299.90/year
```

Create the matching immutable live Stripe Price and test checkout before launch.

---

# 57. FUTURE INTELLIGENCE TIER

Architect for a future tier around:

```text
$39/month
```

Do NOT necessarily expose it at launch.

Possible future entitlements:

* many more custom sources
* very high Story Ask allowance
* high-frequency monitoring
* advanced research
* weekly intelligence reports
* company/topic timelines
* professional exports
* advanced monitors
* priority AI
* higher alert limits

Schema must not require redesign to add it.

---

# 58. CANONICAL PLAN ENTITLEMENTS

Before changing limits inspect:

```text
src/lib/plans.ts
Stripe catalogue
0017_plan_entitlements.sql
site-content pricing overrides
plan helpers
tests
```

There must be ONE canonical entitlement system.

Avoid scattered:

```typescript
if (plan === 'omni')
```

logic.

Conceptual entitlements:

```text
max_topics
max_custom_sources
briefings_per_day
weekly_briefing
breaking_alerts
daily_alert_limit
story_ask_daily
story_ask_monthly
history_days
translation_access
preferred_language_delivery
custom_monitors
monitor_priority
deep_explain
export_access
```

Backend/database enforcement is mandatory.

UI hiding is insufficient.

---

# 59. PRICING CONSISTENCY

Pricing must not drift between:

* backend plan definitions
* database entitlements
* Stripe
* checkout
* webhooks
* marketing site
* editable site content
* billing UI
* tests
* documentation

Create one clearly documented mapping.

If site-content allows marketing copy overrides, ensure marketing text cannot silently change actual backend entitlement semantics.

---

# 60. STRIPE MIGRATION

Current/old pricing may be approximately:

```text
Personal $7
Pro $15
```

Prepare for:

```text
Personal ~$14.99
Pro ~$29.99
```

Do NOT blindly alter existing live Stripe prices.

Inspect:

* Stripe product IDs
* Stripe price IDs
* environment configuration
* test/live mode
* webhook mapping
* existing customers
* existing subscriptions

If real production IDs are unavailable:

implement configuration support and document:

```text
MANUAL STRIPE ACTION REQUIRED
```

Never invent IDs.

---

# 61. EXISTING SUBSCRIBERS

Do not silently reprice existing subscribers.

Support grandfathering if needed.

Possible approach:

```text
old Stripe price
→ legacy entitlement mapping

new Stripe price
→ V2 entitlement mapping
```

Document exact migration strategy.

No surprise charges.

---

# 62. CUSTOM SOURCE ENTITLEMENTS

Suggested direction:

```text
Free
0

Personal
5

Pro
25

Future Intelligence
higher
```

Limits must be enforced atomically.

Tests must prove client-side bypass cannot exceed them.

---

# 63. FREE PLAN ECONOMICS

Free users may consume:

```text
already-active shared intelligence
```

They should not freely create:

* expensive new crawlers
* high-frequency polling
* unlimited translation
* unlimited Story Ask
* unlimited alerts

The free plan should be useful without creating an infrastructure liability.

---

# 64. PAID PLAN ECONOMICS

Paid users may create new infrastructure demand.

This is intentional.

Conceptually:

```text
Personal subscription
↓
bounded source demand

Pro subscription
↓
more source demand
+
higher monitoring priority
+
more user-triggered AI
```

Infrastructure should spend money because paying users requested something valuable.

---

# 65. AI ROUTER

All model calls should continue flowing through the central provider/router system.

No direct random SDK calls scattered through features.

Conceptual capabilities:

```text
cluster
analyse
translate
story_ask
deep_explain
interest_parse if genuinely needed
```

Each route should support appropriate configuration:

* provider
* model
* fallback
* max tokens
* timeout
* retry
* budget
* cache policy

---

# 66. AI TASK PHILOSOPHY

V2 target:

```text
NORMALIZATION
→ deterministic

SOURCE DEMAND
→ deterministic

SOURCE POLLING
→ deterministic

MATCHING
→ deterministic

DIGEST ASSEMBLY
→ deterministic

OBVIOUS CLUSTER
→ deterministic

AMBIGUOUS CLUSTER
→ AI

DEMANDED EVENT ANALYSIS
→ AI once

TRANSLATION
→ AI once per event/language/version

PERSONAL EXPLANATION
→ AI on explicit request
```

This distinction must be visible in documentation.

---

# 67. AI USAGE LEDGER

Extend the existing ledger safely.

Useful categories:

```text
cluster
analyse
translate
story_ask
deep_explain
```

Preserve historical categories.

If automatic personalized digest generation disappears, do not rewrite history.

It should simply stop producing new usage.

Track:

* provider
* model
* capability
* input tokens
* output tokens
* event
* source relationship where possible
* user where user-triggered
* success
* failure
* cached
* estimated cost where supported

---

# 68. COST ATTRIBUTION

Admin should eventually answer:

> **What is costing Nyuz money?**

Attribute where practical by:

* source
* event
* pipeline stage
* capability
* provider
* model
* translation
* Story Ask
* plan

Do not pretend estimates are exact if provider pricing is dynamic.

Raw usage is more important than fake precision.

---

# 69. GLOBAL AI BUDGETS

Preserve/add:

```text
daily soft limit
daily hard limit
monthly soft limit
monthly hard limit
```

At soft limit:

* downgrade optional routes
* delay optional processing
* reduce noncritical enrichment

At hard limit:

* stop optional AI
* keep deterministic system operational
* preserve existing content
* notify admin

AI-provider outage must not take down Nyuz.

---

# 70. SHARED OPERATION CONCURRENCY

Protect:

* event analysis
* event translation
* ambiguous cluster arbitration where duplicate execution is possible

Two workers must not purchase the same reusable result.

Use:

* atomic claims
* unique constraints
* transactional state transitions
* existing claim patterns

Avoid fragile application-only locks.

---

# 71. FAILURE PHILOSOPHY

Paid model-backed work:

```text
claim
↓
attempt
↓
record success/failure
↓
bounded retry
```

Never:

```text
cron sees failed
↓
pay again forever
```

Translation can retry on later explicit demand.

Analysis should preserve current bounded-failure philosophy.

---

# 72. RETENTION

Review retention for:

* raw ingestion payloads
* old failed jobs
* temporary claims
* delivery logs
* stale operational metrics
* AI request details
* unused matches

Do not delete canonical knowledge merely to save tiny amounts of storage.

Delete operational garbage.

Preserve product history according to entitlements/product requirements.

---

# 73. DATABASE MIGRATION STRATEGY

Do NOT make one giant migration.

Use incremental numbered migrations.

Likely areas:

```text
source coverage mode
source-topic mapping
custom-source follows
source demand
adaptive polling
source metrics
event impacts
event translations
AI categories
plan entitlements
```

Each migration should include where appropriate:

* constraints
* unique constraints
* indexes
* foreign keys
* checks
* RLS
* grants
* revokes
* comments

Update Supabase/TypeScript database types.

Schema and application types must remain synchronized.

---

# 74. RLS

Maintain fail-closed design.

Global pipeline tables:

```text
browser read only if product requires
browser write = no
```

Owner tables:

```text
owner-scoped
```

Operational/private tables:

```text
browser inaccessible
```

A normal user must NOT be able to:

* mark a source core
* change polling tier
* alter demand counters
* alter global source-topic mappings
* create fake event translations
* write event impacts
* alter AI ledger
* change entitlements
* grant themselves Pro
* alter another user's follows
* exceed custom source limits
* forge Stripe state

Test all of these.

---

# 75. RATE LIMITING

Review/apply limits to:

* auth
* source addition
* source validation
* Story Ask
* Deep Explain
* translation
* search
* interest changes
* alerts
* custom monitoring
* feedback
* admin endpoints

Paid users still receive bounded service.

---

# 76. FEATURE FLAGS

Use existing feature flag infrastructure.

Possible flags:

```text
demand_driven_sources
adaptive_polling
custom_sources
shared_event_impacts
cached_translation
deterministic_cluster_v2
pre_analysis_demand_gate
```

Do not publicly expose incomplete features.

---

# 77. ADMIN COST DASHBOARD

Extend current admin rather than building an unrelated dashboard.

Useful global metrics:

```text
sources
core sources
demand sources
sources fetched today
sources skipped due to zero demand
articles fetched
new articles
events created
events skipped from analysis
events analysed
cluster decisions deterministic
cluster AI calls
analysis calls
analysis tokens
translations generated
translation cache hits
Story Ask calls
AI tokens/day
AI tokens/month
estimated cost
```

---

# 78. SOURCE-LEVEL ADMIN METRICS

Per source:

```text
demand
followers
paid followers
polling tier
fetches
new articles
events
duplicate rate
noise rate
analysis triggered
tokens indirectly triggered
failures
last useful content
```

This helps identify:

> **One bad source is burning money.**

---

# 79. COST SAVINGS INSTRUMENTATION

Measure OLD vs NEW.

At minimum expose:

```text
sources skipped due to zero demand
fetches avoided
deterministic cluster decisions
cluster AI calls avoided
events stored without analysis
analysis calls avoided
personalized digest AI calls removed
translation cache hits
estimated tokens avoided
```

Do not claim savings that cannot be measured.

If not measured:

```text
not measured yet
```

---

# 80. SOURCE COUNT IS NOT THE KPI

Do not optimize marketing or architecture around:

> **We scan 1,000 websites.**

That incentivizes waste.

Product success means:

> **If something important happens in what you care about, Nyuz knows.**

Coverage quality > crawler count.

---

# 81. SOURCE EXPANSION

Nyuz may eventually cover:

* journalism
* official announcements
* company newsrooms
* engineering blogs
* changelogs
* security advisories
* GitHub releases where supported
* regulatory updates
* government publications
* research
* specialist publications

But Nyuz remains event-centric.

Do not turn it into a generic uptime/web-change monitor.

---

# 82. QUIET DAYS

Preserve:

> **Nothing important happened.**

as a valid result.

Do not lower relevance thresholds to artificially fill a briefing.

Trust depends on Nyuz being willing to say nothing.

---

# 83. OBSERVABILITY

Use structured logs.

Trace pipeline:

```text
source
→ fetch
→ article
→ cluster
→ event
→ demand gate
→ analysis
→ matching
→ digest
→ delivery
```

For user-visible recommendations, preserve reason codes.

Admin should be able to understand:

> Why did User X receive Event Y?

without invoking AI.

---

# 84. ANALYTICS

Continue measuring useful product behavior:

```text
DAU
WAU
MAU
activation
D1
D7
D30
briefing open
alert open
save
dismiss
Story Ask
translation
custom source adoption
Free → Personal
Personal → Pro
churn
```

Do not collect unnecessary personal data.

---

# 85. BILLING ANALYTICS

Admin should eventually understand:

```text
MRR
ARR
Free users
Personal users
Pro users
new subscriptions
cancellations
failed payments
annual adoption
ARPU
AI usage
estimated infrastructure cost
```

Eventually useful:

```text
cost / MAU
cost / paid user
```

---

# 86. TARGET ECONOMIC BEHAVIOR

Do not treat these as guaranteed bills.

Treat them as architectural expectations.

The key relationship should be:

```text
10,000 users follow OpenAI
```

NOT:

```text
10,000 crawls
10,000 event analyses
10,000 translations
10,000 personalized summaries
```

Instead:

```text
fetch source once
↓
cluster article once
↓
analyse event once
↓
translate once per requested language
↓
SQL match 10,000 users
```

Subscriber overlap should IMPROVE economics.

---

# 87. COST MODEL NORTH STAR

Move from:

```text
COST ≈
internet volume
+
article volume
+
all event volume
+
user × story personalization
```

toward:

```text
COST ≈
demanded-source volume
+
ambiguous cluster cases
+
demanded events analysed once
+
unique event/language translations
+
explicit user AI requests
```

That is the architecture.

---

# 88. 1M-USER TEST

For every new feature ask:

> **What happens if Nyuz has one million users?**

If one event causes:

```text
1,000,000 AI calls
```

STOP.

The architecture is wrong.

If one event causes:

```text
1 shared analysis
+
SQL matching
+
a few cached translations
+
optional explicit Story Ask
```

the architecture is behaving correctly.

---

# 89. DO NOT OVERENGINEER

Do NOT introduce without evidence:

* Kubernetes
* Kafka
* microservice explosion
* Redis
* vector database
* browser farm
* custom ML training
* distributed event sourcing
* complex queues for aesthetics
* separate service per pipeline stage

Current preferred stack remains:

```text
TanStack Start
TypeScript
Supabase
Postgres
Cloudflare Workers
database-configured AI providers
```

Use boring infrastructure well.

---

# 90. TESTING — SOURCE DEMAND

Tests:

```text
no users + non-core source
→ not selected

core source
→ selected

active interested user
→ source demand exists

paused user
→ demand excluded

banned user
→ demand excluded

two users same custom source
→ one global source

remove one follower
→ demand decreases

remove final follower
→ grace period then source can pause
```

---

# 91. TESTING — ENTITLEMENTS

Tests:

```text
Free cannot add custom source

Personal can add up to configured limit

Personal cannot exceed limit

Pro can add up to configured limit

Pro cannot exceed limit

browser/client manipulation cannot bypass backend enforcement

invalid subscription cannot retain paid-only monitoring according to current lifecycle rules
```

---

# 92. TESTING — TRANSLATION

Tests:

```text
first request
→ generates

second request
→ cache

concurrent requests
→ one generation

invalid language
→ rejected

unauthorized event
→ rejected

failed generation
→ bounded failure

failure
→ no endless cron retry
```

---

# 93. TESTING — CLUSTERING

Tests:

```text
obvious duplicate
→ no AI

obvious different
→ no AI

ambiguous
→ AI

known fixtures
→ remain correct
```

Shadow-test old/new behavior.

---

# 94. TESTING — ANALYSIS DEMAND GATE

Tests:

```text
irrelevant event
→ stored
→ not analysed

demand later appears
→ analysed

second reader wants same event
→ existing analysis reused

concurrent workers
→ one analysis
```

---

# 95. TESTING — SHARED IMPACTS

Tests:

```text
event impact generated globally

multiple users
→ reuse

digest
→ selects shared impact

digest generation
→ no automatic personal model call
```

---

# 96. TESTING — RLS/SECURITY

Tests:

```text
user cannot mutate global source

user cannot mark source core

user cannot set polling tier

user cannot alter demand

user cannot write translation

user cannot write event impact

user cannot alter AI ledger

user cannot alter another user's custom source follow

user cannot exceed entitlement

user cannot grant themselves paid plan
```

---

# 97. FAILURE TESTS

Test:

```text
AI timeout
AI 429
AI malformed JSON
source timeout
source redirect attack
huge source response
malformed XML
duplicate cron execution
duplicate webhook
translation race
analysis race
database transient failure
email failure
```

Retries must remain idempotent.

---

# 98. PERFORMANCE TESTS

Test realistic paths without spending real AI money.

Mock providers.

Evaluate:

```text
1K users
10K users
100K users
```

Focus on:

* source-demand calculation
* candidate matching
* user_events writes
* briefing generation
* translation cache reads
* source selection
* admin metrics

Use `EXPLAIN ANALYZE` on important SQL.

---

# 99. INDEXING

Review high-volume queries.

Likely important dimensions:

```text
source_id
topic_id
user_id
event_id
active
coverage_mode
polling_tier
next_fetch_at
last_new_content_at
published_at
created_at
status
score
language_code
```

Do not blindly add indexes.

Validate query plans.

---

# 100. ROLLOUT PHASE 0 — AUDIT

Measure current behavior without changing it.

Record:

* sources
* source cadence
* fetches/day
* articles/day
* events/day
* clustering calls
* clustering tokens
* analysis calls
* analysis tokens
* personalized digest calls
* personalized digest tokens
* Story Ask usage
* active interests
* source coverage gaps

This becomes the baseline.

---

# 101. PHASE 1 — TRANSLATION CACHE

Lowest-risk isolated optimization.

Implement:

* preferred language
* global event translation table
* on-demand generation
* atomic locking
* cheap translation route
* cache
* UI Translate action
* relevant entitlement/quota behavior

Do not change source collection yet.

---

# 102. PHASE 2 — SHARED EVENT IMPACTS

Implement:

* shared impact storage
* analysis output
* digest selection

Then:

* stop automatic new per-user `why_it_matters`
* preserve historical rows
* move personal explanation to Story Ask

Measure eliminated AI calls.

---

# 103. PHASE 3 — SOURCE/TOPIC GRAPH

Implement:

* source-topic mapping
* source canonicalization
* custom-source relationship
* entitlement enforcement
* secure source validation

Continue current source polling initially.

---

# 104. PHASE 4 — DEMAND VISIBILITY

Calculate demand.

Expose it to admin.

Do NOT use it to disable collection yet.

Compare demand model with real coverage.

Find:

* incorrectly zero-demand sources
* missing topic mappings
* unexpected demand
* lifecycle bugs

Fix them first.

---

# 105. PHASE 5 — DEMAND-DRIVEN COLLECTION

Behind feature flag:

```text
demand_driven_sources
```

Begin skipping:

```text
zero-demand
+
non-core
+
grace-period-expired
```

sources.

Measure coverage impact.

Have a fast rollback.

---

# 106. PHASE 6 — ADAPTIVE POLLING

Introduce:

* demand-aware cadence
* publishing-frequency learning
* failure backoff
* activity bursts
* source-value inputs

Keep tiers configurable.

---

# 107. PHASE 7 — CLUSTER V2

Introduce deterministic confidence.

Shadow-test first.

Measure:

* merges
* splits
* model calls avoided
* tokens avoided

Switch only after evidence.

---

# 108. PHASE 8 — PRE-ANALYSIS DEMAND GATE

Only enable after source/topic demand has proven reliable.

Store zero-demand events without analysis.

Analyse later if demand appears.

Do not accidentally suppress important discovery.

Core events remain eligible.

---

# 109. PHASE 9 — PRICING/ENTITLEMENT V2

After architecture is stable:

prepare:

```text
Free
Personal ~$14.99
Pro ~$29.99
Future Intelligence ~$39
```

Update coherently:

* plan definitions
* database entitlements
* marketing defaults
* checkout
* webhook mapping
* tests
* docs
* Stripe configuration

Do not change production billing without verified IDs and explicit migration strategy.

---

# 110. PHASE 10 — COST INTELLIGENCE

Finish admin operational metrics.

Compare:

```text
BEFORE
vs
AFTER
```

with real data.

---

# 111. BACKWARD COMPATIBILITY

Existing:

* users
* interests
* sources
* articles
* events
* user_events
* digests
* old personalized paragraphs
* AI ledger rows
* subscription state
* source preferences

must remain valid unless deliberately migrated.

Do not delete history just because new architecture stops producing the old shape.

---

# 112. DOCUMENTATION

Update affected documentation only when behavior exists.

At minimum inspect/update:

```text
docs/architecture.md
docs/database.md
docs/status.md
docs/ai-providers.md
docs/admin-console.md
docs/security.md
docs/product-brief.md
docs/development.md
docs/plan.md
pricing documentation
operations documentation
```

Clearly distinguish:

```text
BUILT
PARTIALLY BUILT
DESIGNED
NOT BUILT
```

Never describe plans as shipped.

---

# 113. STATUS HONESTY

`docs/status.md` must remain factual.

Record only measured facts such as:

* migrations actually applied
* source counts
* demand-source counts
* custom-source counts
* fetches skipped
* translation requests
* translation cache hits
* real AI calls
* real token usage
* AI calls avoided where measurable
* actual Stripe tests
* actual multilingual deliveries

Never invent plausible metrics.

If unknown:

```text
not measured yet
```

---

# 114. VALIDATION AFTER EACH MAJOR PHASE

Run relevant:

```text
tests
typecheck
lint
build
```

Also run migration/RLS checks.

Where credentials and environment allow, run existing operator/live verification.

Do not claim something works because TypeScript compiled.

---

# 115. EXECUTION STYLE

Do NOT immediately modify twenty unrelated files.

For every phase:

```text
1. inspect
2. understand dependencies
3. identify affected files
4. identify schema impact
5. implement smallest compatible change
6. migrate safely
7. add tests
8. run tests
9. verify behavior
10. document actual result
11. continue
```

When choosing between:

```text
clever rewrite
```

and:

```text
small compatible migration
```

choose the compatible migration.

---

# 116. DO NOT FAKE COMPLETION

Never report:

```text
implemented
tested
verified
production-ready
```

unless actually true.

If external credentials prevent verification, report:

```text
Implemented locally.
Live provider verification not performed because X credential/environment was unavailable.
```

Be precise.

---

# 117. FINAL TARGET ARCHITECTURE

```text
                         USERS
                           │
               ┌───────────┴───────────┐
               │                       │
            TOPICS               CUSTOM SOURCES
               │                       │
               └───────────┬───────────┘
                           ↓
                      DEMAND GRAPH
                           │
                           ↓
                 RELEVANT SOURCES ONLY
                           │
                    ADAPTIVE POLLING
                           │
                           ↓
                       ARTICLES
                           │
                       NORMALIZE
                           │
                           ↓
                  CHEAP CLUSTER SIGNALS
                           │
                 DETERMINISTIC SCORE
                      /          \
                CONFIDENT       AMBIGUOUS
                    │               │
                  NO AI          CHEAP AI
                    │               │
                    └───────┬───────┘
                            ↓
                          EVENT
                            │
                       DEMAND GATE
                      /           \
               NO DEMAND          DEMAND
                   │                │
                STORE          ANALYSE ONCE
                   │                │
                   │        ┌───────┴────────┐
                   │        │                │
                   │     SUMMARY         IMPACTS
                   │        │                │
                   └────────┴────────┬───────┘
                                    ↓
                                SQL MATCH
                                    │
                 ┌──────────────────┼──────────────────┐
                 ↓                  ↓                  ↓
              USER A             USER B             USER C
                 │
               DIGEST
                 │
         ┌───────┴──────────┐
         │                  │
     TRANSLATE       WHY DOES THIS
         │            MATTER TO ME?
         │                  │
     CACHE?            STORY ASK
      /   \               QUOTA
    YES   NO                │
     │     │            AI ON DEMAND
 RETURN  CHEAP AI
           │
           ↓
       GLOBAL EVENT
       TRANSLATION
          CACHE
```

---

# 118. THE ECONOMIC TEST

Suppose:

```text
10,000 users follow OpenAI.
```

Correct architecture:

```text
OpenAI source
↓
FETCH ONCE
↓
ARTICLE
↓
CLUSTER ONCE
↓
EVENT
↓
ANALYSE ONCE
↓
SHARED IMPACTS
↓
TRANSLATE ONCE PER REQUESTED LANGUAGE
↓
SQL MATCH
↓
10,000 USERS
```

Not:

```text
10,000 crawls
10,000 analyses
10,000 summaries
10,000 translations
10,000 why_it_matters generations
```

---

# 119. PRODUCT TEST

Every feature should answer:

> Does this help Nyuz know what matters without making the reader search?

If not, question whether the feature belongs.

Do not chase generic AI functionality.

Nyuz's value is continuous monitoring and relevance.

---

# 120. COST TEST

Every expensive operation should answer:

> Who wants this result?

Then:

> Can this result be reused?

If nobody currently wants it:

```text
do not eagerly spend
```

If many people can reuse it:

```text
compute once
cache globally
```

If it is genuinely personal:

```text
run only when explicitly requested
meter it
```

---

# 121. FINAL ACCEPTANCE CRITERIA

V2 is successful when:

1. Sources can be core or demand-driven.
2. Source-topic relationships exist globally.
3. Multiple users following the same custom source create one crawler.
4. Zero-demand non-core sources can stop polling safely.
5. User inactivity reduces demand.
6. Polling cadence adapts to demand and source behavior.
7. Source value is measurable.
8. Admin can understand why a source is being fetched.
9. Obvious clustering decisions require no AI.
10. AI clustering is limited to ambiguous cases.
11. Events without current demand can remain unanalysed.
12. Demand appearing later can trigger one analysis.
13. Event analysis uses bounded evidence.
14. Shared impact intelligence exists.
15. Automatic per-user/story AI generation stops.
16. Digest assembly primarily uses shared content.
17. Personalized explanation becomes explicit/on-demand.
18. Translation is globally cached.
19. Concurrent translation requests do not duplicate AI work.
20. Matching remains AI-free.
21. Exclusions continue winning.
22. Breaking alerts use shared event intelligence.
23. Custom source limits are enforced server-side.
24. RLS prevents users from controlling global pipeline state.
25. Submitted source URLs are protected against SSRF.
26. AI usage remains attributable.
27. Cost savings become measurable.
28. Existing history remains readable.
29. Existing subscribers are not accidentally repriced.
30. Free-user growth remains inexpensive.
31. Paid demand is bounded.
32. Tests pass.
33. Typecheck passes.
34. Lint passes.
35. Build passes.
36. Documentation describes actual behavior.
37. Status metrics are real rather than invented.
38. Rollback remains possible for risky pipeline changes.
39. Nyuz remains understandable by a small engineering team.
40. One popular event becomes cheaper per reader as more people care about it.

---

# 122. FINAL DELIVERABLE

When implementation is finished, provide a report with these sections.

## IMPLEMENTED

List exact completed features.

Do not include planned work.

## DATABASE

Report:

```text
migrations added
tables added
columns added
indexes added
constraints
RLS changes
grants/revokes
type changes
```

## SOURCE MODEL

Explain:

```text
core sources
demand sources
source-topic graph
custom source deduplication
demand calculation
adaptive polling
source-value metrics
```

## CLUSTERING

Report:

```text
deterministic signals
AI ambiguity path
feature flag
shadow-test results
AI calls avoided
```

Only include measured savings.

## EVENT ANALYSIS

Report:

```text
demand gate
evidence selection
claiming
shared analysis
shared impacts
failure behavior
```

## PERSONALIZATION

Explain exactly how:

```text
automatic per-user generation
```

was removed/reduced.

Explain the new on-demand personal explanation flow.

## TRANSLATION

Report:

```text
languages
cache
locking
model route
failure handling
quota behavior
cache hits
```

## AI USAGE

Separate:

### Deterministic

List stages that no longer need models.

### Shared AI

List globally reusable model calls.

### On-Demand AI

List user-triggered calls.

## COST MODEL

Report actual measurable differences:

```text
fetches avoided
cluster AI calls avoided
analysis calls avoided
personalized generation calls removed
translation cache hits
tokens avoided
```

If not measured:

```text
not measured yet
```

## BILLING

Confirm actual implemented pricing/configuration:

```text
Free
Personal target ~$14.99
Pro target ~$29.99
Future Intelligence architecture ~$39
```

Clearly distinguish code support from actual Stripe production configuration.

## COMPATIBILITY

List old data and behavior preserved.

## SECURITY

Report:

```text
RLS
SSRF protections
quota enforcement
billing authority
secret handling
```

## TESTS

Give exact results:

```text
unit:
integration:
security:
typecheck:
lint:
build:
```

No vague "all good."

## LIVE VERIFICATION

State exactly what was tested against:

```text
Supabase
Cloudflare
AI providers
email
Stripe
```

If something was not tested, say so.

## REMAINING RISKS

List actual unresolved risks.

Do not hide them.

## BEFORE VS AFTER

End with:

```text
OLD

fetch broad internet
↓
AI-heavy clustering
↓
analyse broad event set
↓
match users
↓
generate personal content repeatedly
↓
deliver


NEW

user demand
↓
relevant sources
↓
adaptive polling
↓
cheap deterministic clustering
↓
AI only when ambiguous
↓
event demand gate
↓
analyse once
↓
shared intelligence
↓
SQL matching
↓
shared digest
↓
translation/personal reasoning only when needed
```

---

# 123. NORTH STAR

Every architectural decision must be evaluated against:

> **Do expensive work only when somebody wants the result, and if the result can help more than one person, pay for it only once.**

And every product decision should reinforce:

> **Tell Nyuz what matters. Nyuz keeps watch.**

And every scaling decision should preserve:

> **More users sharing an interest should improve Nyuz's economics, not make the same piece of knowledge more expensive.**

Build V2 incrementally around those principles.

Do not rebuild Nyuz.

Evolve it carefully.
