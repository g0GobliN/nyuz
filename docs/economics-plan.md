You are working inside the existing **Nyuz** codebase.

Your task is to design and implement a new **admin-only Economics area** for Nyuz.

This is not merely a UI mockup.

First inspect the existing repository, database schema, billing code, AI cost ledger, Stripe integration, admin settings, provider configuration, scheduled jobs, existing Cost page, user plans, usage tracking, and any existing economics/unit-economics logic.

Do not assume names, routes, database tables, APIs, or architecture before inspecting the code.

Do not rewrite systems that already exist.

Reuse the existing Nyuz design system, layout, typography, spacing, components, table styles, chart conventions, admin navigation, loading/error patterns, database conventions, and authentication/authorization mechanisms.

---

# 1. Product goal

Create a **desktop-first, provider-connected Economics dashboard** that answers:

1. What is Nyuz using?
2. What is Nyuz actually paying?
3. What will the current billing period likely cost?
4. Which providers are responsible for that cost?
5. Which users/plans are generating variable cost?
6. What is the marginal cost of free users?
7. Are Plura and Omni users profitable?
8. What portion of cost is fixed infrastructure versus usage-driven?
9. Are provider metrics fresh and trustworthy?
10. Which values are exact, imported, projected, allocated, estimated, or unavailable?

The dashboard must be **usage-first**, not budget-first.

Do NOT require the administrator to manually enter arbitrary monthly budgets for Cloudflare, Supabase, Resend, AI, etc.

Where providers expose account/usage/billing information, retrieve it automatically.

Manual entries are fallback mechanisms only for data providers do not expose, such as certain invoices, domains, registrar charges, one-off subscriptions, or missing billing information.

---

# 2. Critical architectural rule

The Economics system must be observational/accounting infrastructure only.

It must NOT change:

* news fetching
* ingestion
* clustering
* ranking
* briefings
* delivery
* recommendation behavior
* AI routing
* AI provider selection
* customer-facing pricing
* customer-facing application behavior

Economics consumes existing data.

It must never control the news pipeline.

---

# 3. Existing Nyuz systems to inspect and reuse

Before implementing anything, find and document existing implementations for:

* Stripe billing ledger
* gross revenue
* refunds
* Stripe fees
* subscriptions
* plan mapping
* Plura
* Omni
* free users
* live/test mode handling
* AI usage ledger
* AI provider
* AI model
* token counts
* AI pricing
* AI spend windows
* AI safety caps
* `ai_kill_switch`
* existing cost/admin pages
* manual infrastructure cost settings
* admin authorization
* scheduled/cron jobs
* email delivery ledger
* notification delivery
* Cloudflare configuration
* Supabase project/org configuration
* Resend integration
* currency handling
* historical usage metrics
* active-user calculations
* existing charts/tables
* audit logs

Do not duplicate any of these if equivalent functionality already exists.

Provide a short audit summary before changing code.

---

# 4. Desktop UX direction

This is primarily an **admin desktop interface**.

Design for:

* 1280px+
* 1440px
* 1600px+
* sensible behavior down to laptop widths

It should still degrade reasonably on smaller screens, but do not sacrifice desktop information density to make everything look like a mobile app.

Visual direction:

* premium
* understated
* highly legible
* information-dense
* calm
* operational
* Stripe / Vercel / Linear / modern financial dashboard feel
* consistent with existing Nyuz UI
* no loud fintech gradients
* no giant decorative cards
* no unnecessary illustrations
* no fake analytics
* no meaningless gauges
* no excessive shadows
* no rainbow chart palette
* no dashboard clutter

This is an operator tool.

The administrator should be able to understand the financial health of Nyuz in a few seconds, then drill deeper.

---

# 5. Navigation

Add a dedicated:

**Admin → Economics**

Do not keep expanding an already-large generic Cost page.

If an existing Cost section has useful components or data, reuse/migrate/link them appropriately instead of duplicating them.

Recommended internal sections:

* Overview
* Providers
* Usage
* Users & Plans
* AI
* Reconciliation
* History
* Settings / Connections

Use tabs, secondary navigation, or an equivalent pattern consistent with the existing admin UI.

Avoid adding too many top-level admin routes if the existing app prefers tabbed sections.

---

# 6. Global period selector

At the top of Economics, provide a selected accounting period.

Useful options:

* Current billing month
* Previous month
* Last 30 days
* Last 90 days
* Custom range

If provider billing periods do not align with calendar months, clearly distinguish:

* selected reporting period
* provider billing period

Never silently mix them.

Show timezone where relevant.

Nyuz reporting currency should remain **JPY**, while preserving original provider currency.

---

# 7. Top-level Economics overview

The first screen should prioritize a compact financial summary.

Show:

### Revenue

* Gross revenue
* Refunds
* Net revenue
* Stripe fees

### Costs

* Fixed/shared infrastructure cost
* Variable operating cost
* AI cost
* Email/delivery cost
* provider overage
* fully loaded operating cost

### Profitability

* Marginal contribution
* Fully loaded contribution
* Fully loaded profit/loss
* contribution margin %

### Forecast

* Cost incurred so far
* projected month-end cost
* expected overage
* projected revenue if defensible from existing subscription data
* projected fully loaded result

Do not pretend forecasts are facts.

Every projected value must visibly say it is projected.

---

# 8. Status classification for every important number

Every monetary/usage metric must carry a provenance/status.

Use statuses such as:

* Exact
* Imported
* Estimated
* Projected
* Allocated
* Manual
* Unavailable
* Incomplete
* Stale

These statuses must not be hidden behind tooltips only.

Use subtle badges/labels.

Examples:

`¥3,820  Exact`

`¥6,100 projected`

`¥740 allocated`

`Unavailable`

Never present an allocated or projected number as an invoice fact.

---

# 9. Provider summary cards/rows

Create a provider overview for at least:

* Stripe
* Cloudflare
* Supabase
* Resend
* AI providers
* Domain/registrar
* Other/manual services

Each provider should show:

* provider name
* service/product
* current plan if retrievable
* billing scope
* billing cycle
* base subscription cost
* usage-driven cost
* current-period cost
* projected period-end cost
* previous-period cost
* percentage/change from previous period
* included allowance
* usage
* quota remaining
* overage
* original currency
* JPY reporting amount
* last sync
* data freshness
* source
* confidence/status

---

# 10. Billing scope

Every provider metric must explicitly know its scope.

Examples:

* account
* organization
* project
* workspace
* Nyuz application
* manually allocated

This is especially important where:

* Supabase billing may be organization-level
* usage may be project-level
* Cloudflare billing may span account-level resources
* one API credential may represent more than Nyuz

Never attribute an organization-wide invoice entirely to Nyuz unless the data or admin configuration proves that Nyuz owns the entire billing scope.

If allocation is required, label it clearly.

---

# 11. Usage meters

Create a clean desktop usage section.

Where available, show things such as:

## Cloudflare

* requests
* Worker invocations
* CPU duration/time
* cron invocations
* bandwidth/egress
* included quota
* usage percentage
* estimated overage

## Supabase

* database size
* storage size
* storage bandwidth
* network/database egress
* MAU where relevant to billing
* Edge Function usage where applicable
* compute if accessible
* included allowances
* overage

## Resend

* emails attempted
* sent
* delivered
* bounced
* sending usage
* plan/allowance if available
* estimated overage/cost

## AI

* calls
* input tokens
* output tokens
* total tokens
* spend
* provider
* model
* priced calls
* unpriced calls

Usage visualizations should be compact horizontal meters or small charts.

Example:

```text
Supabase storage
14.2 GB / 100 GB
███████░░░░░░░░░░░░ 14%
Included
```

If there is no meaningful quota, don't manufacture a percentage bar.

---

# 12. Included allowance vs economic usage

Track these separately whenever possible:

* economic usage value
* amount covered by free tier
* amount covered by promotional/provider credit
* included plan allowance
* paid overage
* actual cash paid

For example:

```text
Usage value                 ¥4,500
Covered by included quota  -¥2,500
Covered by credits         -¥1,000
Cash usage charge           ¥1,000
```

A provider giving Nyuz free allowance must not make the system conclude that the underlying resource consumption is zero.

Likewise, promotional credits are not permanent operating economics.

---

# 13. AI economics

Nyuz already has internal AI accounting.

Reuse it.

Show:

* provider
* model
* calls
* input tokens
* output tokens
* total tokens
* actual/provider-recorded cost
* unpriced calls
* cost/story
* cost/user
* cost/briefing where attribution is defensible
* period spend
* projected month-end spend

Also surface:

## AI kill switch

Display current state of:

`ai_kill_switch`

Be extremely clear about semantics:

* kill switch OFF = AI provider calls allowed subject to existing rules/budgets
* kill switch ON = provider calls blocked

Do not change its behavior from Economics.

Economics is read-only with respect to pipeline behavior unless the existing admin settings architecture already provides the legitimate control elsewhere.

If useful, link to the existing setting instead of inventing another switch.

Store/show historical kill-switch changes if audit history exists.

This enables comparisons between:

* AI-enabled periods
* code-only periods

Useful metrics:

* AI cost during AI-enabled days
* AI cost during code-only days
* AI cost per active user
* AI cost per paid user
* AI cost by plan
* AI cost by feature/path if existing telemetry supports it

Do not fabricate attribution.

---

# 14. Cost per Nyuz operation

Where the data supports it, calculate operational unit costs.

Examples:

* cost per active user/day
* cost per briefing generated
* cost per briefing delivered
* cost per 1,000 articles ingested
* cost per event created
* cost per email delivered
* AI cost per analysed event
* AI cost per story

Use only defensible inputs.

If exact attribution is impossible, mark the value as estimated or allocated.

These metrics should help answer:

“Why did costs increase?”

Not merely:

“Which provider charged more?”

---

# 15. Free-user economics

Create a dedicated free-user view.

Show:

* total free users
* active free users
* inactive free users
* free users receiving briefings
* free users generating AI usage
* free users generating delivery cost
* free-user total marginal cost
* cost per active free user
* cost per free briefing recipient
* median free-user cost
* P95 free-user cost
* P99 if sample size makes it meaningful
* conversion to paid where already available

Very important:

Do NOT simply divide the entire infrastructure bill equally among free users.

Primary free-user cost should represent **marginal cost actually caused by that cohort**.

Then optionally show a separate fully-loaded allocation.

---

# 16. Paid plan economics

Provide separate views for:

* Plura
* Omni

For each:

* active subscribers
* net revenue
* Stripe fees
* direct variable cost
* AI cost
* email/delivery cost
* estimated/allocated platform usage
* marginal contribution
* marginal margin %
* allocated shared infrastructure
* fully loaded contribution
* fully loaded margin %

Where useful:

* average
* median
* P95
* P99

Do not let one heavy user disappear inside a simple mean.

---

# 17. Break-even

Because the system already knows:

* fixed/shared infrastructure cost
* paid-plan contribution

calculate useful break-even views where mathematically defensible.

Examples:

```text
Current fixed monthly infrastructure: ¥X

Break-even if only Plura: N users
Break-even if only Omni: N users
Break-even under current paid-user mix: N users
```

Clearly label this as a model.

Do not pretend the future subscription mix is guaranteed.

Show assumptions used.

---

# 18. Fixed vs variable cost

Every provider/service cost should support classification such as:

* fixed
* variable
* mixed

Examples:

Fixed/shared:

* provider base subscription
* Supabase base plan
* Cloudflare base plan
* domain
* minimum email subscription
* fixed monitoring subscriptions

Variable:

* AI calls
* email overage
* bandwidth overage
* storage overage
* compute overage
* request overage

Mixed providers must support separating:

`base fee + variable usage`

Do not classify the entire invoice as variable merely because some overage exists.

---

# 19. Provider integrations

Implement provider syncing incrementally and defensively.

Never assume an endpoint exists.

Before writing an integration:

1. inspect existing dependencies and credentials
2. inspect provider documentation if internet/documentation access is available
3. determine what data is exposed
4. determine scope
5. determine pagination
6. determine rate limits
7. determine billing period semantics
8. determine whether usage is final or delayed
9. determine whether values represent invoices or estimates
10. build a manual fallback when data cannot be retrieved

---

# 20. Cloudflare integration

Support automatic data where available.

Potential information:

* account/plan
* Workers usage
* requests
* CPU
* cron
* bandwidth
* included usage
* billable usage
* overage
* current billing data

Use a read-only credential with the minimum permissions necessary.

Never expose the credential to the browser.

Store imported snapshots rather than querying Cloudflare from every page load.

If Cloudflare only exposes some data at account scope, label it.

---

# 21. Supabase integration

Support automatic data where exposed.

Potential information:

* organization plan
* project
* database size
* storage
* bandwidth/egress
* MAU
* Edge Functions
* relevant compute/usage
* billing/overage information

Very important:

Supabase provider billing and usage may have different scopes.

Explicitly distinguish:

* organization
* project

Do not make unsupported allocations.

If a billing metric is unavailable, show:

`Unavailable`

Do not derive fake precision.

---

# 22. Resend integration

Use existing Nyuz delivery telemetry first.

Automatically capture:

* emails attempted
* emails sent
* delivered
* failed
* bounced

Then reconcile with Resend data where its API exposes it.

If provider subscription/invoice details are unavailable:

* allow invoice/manual fallback
* retain actual Nyuz usage automatically

Do not block the entire provider dashboard because one billing field is unavailable.

---

# 23. Stripe

Stripe should remain the authoritative billing source where existing Nyuz implementation supports it.

Reuse the existing ledger.

Show:

* gross revenue
* refunds
* Stripe fees
* net revenue
* subscriptions
* revenue by plan
* relevant billing period
* live mode

Never mix Stripe test data into live Economics totals.

If test data is visible for debugging, isolate it clearly.

---

# 24. Domain and miscellaneous providers

Manual-first support is acceptable for:

* domains
* registrar
* monitoring
* error tracking
* analytics
* operational subscriptions
* one-off tools
* custom infrastructure

Manual cost entries require:

* provider
* service
* billing period
* amount
* currency
* fixed/variable/mixed
* reference/invoice identifier
* notes
* scope
* created by
* created timestamp
* updated timestamp

---

# 25. Currency model

Reporting base currency:

**JPY**

Always preserve:

* original amount
* original currency
* conversion rate
* conversion date
* conversion source
* resulting JPY amount

Do not mutate historical conversions silently when exchange rates change.

A historical accounting snapshot must remain reproducible.

Corrections should create audit history.

---

# 26. Historical snapshots

This is critical.

Do not build the dashboard from only current provider state.

Persist periodic snapshots sufficient to reconstruct prior periods.

Snapshots should support:

* provider
* service
* scope
* billing period
* timestamp
* usage
* quota
* plan
* cost
* projected cost
* currency
* source
* status
* import metadata

Historical reports must not change merely because:

* provider plan changed later
* API returned different current data
* exchange rate changed
* an admin edited current configuration

Corrections should be traceable.

---

# 27. Sync architecture

Do not fetch every provider on every dashboard page request.

Use a background/scheduled synchronization architecture consistent with Nyuz's existing infrastructure.

Conceptually:

```text
Provider APIs
      ↓
scheduled read-only sync
      ↓
provider snapshots
      ↓
reconciliation
      ↓
cost attribution
      ↓
Economics dashboard
```

Requirements:

* idempotent sync
* retry safety
* provider-specific failure isolation
* timeout handling
* rate-limit handling
* pagination
* stale-data detection
* auditability
* no duplicate accounting records

One provider failure must not prevent other providers from syncing.

---

# 28. Sync health

Each integration should expose:

* connected/disconnected
* last attempted sync
* last successful sync
* last provider period
* next expected sync
* stale/not stale
* recent failures
* latest error summary
* imported record count

Do not expose secrets or raw sensitive provider payloads unnecessarily.

---

# 29. Reconciliation

Add a dedicated Reconciliation view.

Compare internal records against external provider data.

Examples:

### Stripe

Nyuz Stripe ledger
vs
provider totals

### AI

Nyuz AI ledger
vs
provider invoice/top-up/account usage

### Resend

Nyuz delivery records
vs
provider message counts

### Cloudflare/Supabase

Nyuz-attributable internal telemetry
vs
provider-reported usage when comparable

Show:

* internal value
* provider value
* difference
* difference %
* reconciliation state

Possible states:

* Matched
* Minor difference
* Investigate
* Missing provider data
* Missing internal data
* Scope mismatch

Never force incompatible scopes into a fake comparison.

---

# 30. Data quality warnings

Create warnings for:

* stale provider integration
* missing billing period
* missing invoice
* provider usage without cost
* AI call without pricing
* unexplained reconciliation difference
* estimated value used in profitability
* provider stopped reporting
* currency conversion missing
* unknown billing scope
* duplicated import
* partial provider period
* test/live mode contamination
* missing historical snapshot

Warnings should be useful, not noisy.

Prioritize by severity.

---

# 31. Projection engine

Projected month-end values should be based on real usage.

Do not use arbitrary budgets.

Possible inputs:

* elapsed days in billing period
* recent 7-day average
* current-period average
* usage trend if enough historical data exists

A simple defensible model is preferable to fake sophisticated forecasting.

Every forecast must show its basis.

Example:

```text
Projected month-end: ¥7,860
Basis: trailing 7-day average
Current actual: ¥4,220
Billing period: Sep 1–30
```

Allow a projection to say:

`Insufficient data`

rather than manufacture a number.

---

# 32. Charts

Charts should answer specific questions.

Useful examples:

* daily total infrastructure cost
* cost by provider over time
* revenue vs cost
* AI spend over time
* active users vs variable cost
* provider usage trajectory
* free vs paid marginal cost
* plan contribution history

Avoid charts where a compact number/table would communicate better.

Use sensible axes and units.

Don't truncate axes deceptively.

---

# 33. Desktop layout example

A possible Overview layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Economics                         Sep 1 – Sep 30   [Period] │
│ Provider data updated 3m ago                                │
└──────────────────────────────────────────────────────────────┘

┌─────────────┬─────────────┬─────────────┬──────────────────┐
│ Net revenue │ Actual cost │ Projected   │ Fully loaded P/L │
│ ¥XXX        │ ¥XXX        │ ¥XXX        │ ¥XXX             │
└─────────────┴─────────────┴─────────────┴──────────────────┘

┌──────────────────────────────────┬───────────────────────────┐
│ Cost trend                       │ Cost composition          │
│ [chart]                          │ Cloudflare ...            │
│                                  │ Supabase ...              │
│                                  │ Resend ...                │
│                                  │ AI ...                    │
└──────────────────────────────────┴───────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Provider health                                              │
│ Provider | Plan | Usage | Quota | Actual | Projected | Sync │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────┬────────────────────────────────┐
│ Free user economics         │ Paid plan economics            │
│ active users                │ Plura contribution             │
│ marginal cost               │ Omni contribution              │
│ P95 cost                    │ break-even                     │
└─────────────────────────────┴────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Warnings / reconciliation                                   │
└──────────────────────────────────────────────────────────────┘
```

Do not copy this literally if the existing Nyuz admin layout suggests something better.

---

# 34. Provider details screen

Clicking a provider should open detailed information.

Example for Supabase:

Header:

* provider
* current plan
* billing scope
* billing period
* connection state
* last sync

Summary:

* actual cost
* projected cost
* base cost
* usage cost
* overage

Usage:

* database
* storage
* egress
* MAU
* functions
* compute where applicable

History:

* daily/period usage
* cost trend

Reconciliation:

* internal vs provider

Source:

* imported API
* invoice
* manual values

Audit/history.

---

# 35. User attribution architecture

Do not prematurely attribute every infrastructure byte to an individual user.

Use the strongest available attribution first.

Preferred hierarchy:

1. directly attributed
2. cohort-attributed
3. usage-weighted allocation
4. active-user allocation
5. shared/unallocated

Keep an explicit:

`Unallocated shared infrastructure`

bucket.

That is better than fake precision.

---

# 36. Profitability formulas

Preserve clear accounting.

### Revenue

```text
Gross revenue
- refunds
= net revenue
```

Stripe fees remain separately visible.

### Marginal contribution

```text
Net revenue
- Stripe fees
- direct variable costs
= marginal contribution
```

### Fully loaded contribution

```text
Marginal contribution
- allocated shared cost
= fully loaded contribution
```

Do not hide shared infrastructure inside variable cost.

---

# 37. Cash vs accounting

Keep separate concepts for:

* cash paid
* provider credits
* prepaid balance
* economic usage
* recognized expense
* revenue
* accounting profit

Do not treat:

provider credit = revenue

or

remaining prepaid AI balance = profit

or

free-tier allowance = cash expense.

---

# 38. Manual fallback

Provider-connected automation should be the default.

Manual entry exists only when necessary.

Manual values should never silently override imported values.

If both exist:

* show source precedence
* show difference
* allow explicit reconciliation
* preserve both records where appropriate

Every manual correction should have audit history.

---

# 39. Security

Requirements:

* admin-only
* reuse existing admin guard
* server-side provider calls
* never expose API secrets to browser
* least-privilege/read-only provider credentials
* secret-manager/environment storage consistent with the project
* no secrets in logs
* no secrets in database snapshots
* no credentials returned in API responses
* audit sensitive configuration changes
* validate admin access server-side

---

# 40. Failure behavior

Provider outages must not break Economics entirely.

If Cloudflare fails:

* Cloudflare shows stale/error
* Supabase/Stripe/Resend/AI remain visible

If old provider snapshots exist:

show them with:

`Stale — last updated X`

Do not silently substitute stale information as current.

---

# 41. Performance

Do not create a dashboard that runs dozens of expensive queries on every render.

Prefer:

* aggregated period queries
* snapshot tables
* cached summary calculations where appropriate
* pagination for history
* server-side aggregation

Inspect existing Nyuz patterns before introducing caching infrastructure.

---

# 42. Database design

Do not blindly create these exact names.

First inspect the existing schema.

Conceptually, the system may need entities equivalent to:

* provider connections
* provider cost records
* provider usage snapshots
* provider invoices
* currency conversions
* manual costs
* reconciliation records
* economics audit log
* attribution records

Reuse/extend existing tables when structurally appropriate.

Do not duplicate the current AI or Stripe ledgers.

Add indexes for the actual query patterns.

Use migrations consistent with the repository.

---

# 43. Development phases

Implement carefully.

## Phase A — audit

Before modifications:

* identify existing relevant files
* existing DB tables
* ledgers
* admin routes
* provider credentials
* cron system
* charts/components
* unit-economics code
* current Cost UI

Report what exists and what can be reused.

## Phase B — economics foundation

Implement:

* general provider cost model
* provider usage snapshots
* original currency + JPY reporting
* scope classification
* fixed/variable/mixed
* exact/imported/manual/projected/etc provenance
* manual fallback
* historical snapshots
* audit trail

## Phase C — dashboard

Implement:

* Economics route
* Overview
* Providers
* Usage
* Users & Plans
* AI
* Reconciliation
* History

## Phase D — existing-source integration

Connect:

* Stripe existing ledger
* AI existing ledger
* internal Resend/delivery information

## Phase E — external provider sync

Add safe integrations for:

* Cloudflare
* Supabase
* Resend provider-side metrics

Only use data their APIs actually expose.

## Phase F — economics

Add:

* marginal free-user cost
* Plura contribution
* Omni contribution
* percentiles
* operational unit costs
* break-even
* projections

## Phase G — validation

Run:

* typecheck
* lint
* tests
* relevant integration tests
* migrations
* build

Fix failures caused by this work.

---

# 44. Testing requirements

Add tests for important accounting behavior.

At minimum:

### Currency

* conversion preserved historically
* correction doesn't mutate previous snapshot unexpectedly

### Provider sync

* idempotency
* provider failure isolation
* pagination
* stale data
* duplicate prevention

### Stripe

* test-mode excluded
* refunds handled
* fees handled

### AI

* priced usage
* unpriced usage
* zero-AI period
* kill-switch status presentation

### Economics

* fixed vs variable
* marginal contribution
* fully loaded contribution
* free-user marginal cost
* allocation labeling
* provider credit separation
* projected vs exact status

### Security

* non-admin cannot access
* secrets never returned to client

---

# 45. UX details

Use:

* skeleton states
* empty states
* stale states
* error states
* last-sync indicators
* compact number formatting
* full values on hover/details
* JPY as primary display
* original currency available in details
* accessible tables
* keyboard-friendly controls
* proper semantic labels
* sensible tooltips only where necessary

Do not use tooltips as the only place where important accounting meaning exists.

---

# 46. Terminology

Use precise labels.

Prefer:

* Actual cost
* Projected cost
* Base cost
* Variable cost
* Shared cost
* Overage
* Included allowance
* Marginal contribution
* Fully loaded contribution
* Allocated cost
* Unallocated cost
* Provider-reported
* Nyuz-recorded
* Reconciliation difference

Avoid vague labels like:

* Spend score
* Efficiency score
* Health score

unless there is a mathematically defensible definition.

---

# 47. Do not implement fake provider capabilities

This requirement is critical.

If an API does not expose:

* plan price
* quota
* invoice amount
* exact usage
* billing period

then do NOT hardcode assumptions and present them as live provider data.

Instead use:

* unavailable
* manual fallback
* configured value
* provider invoice import
* estimated value

and label it correctly.

---

# 48. Do not hardcode current provider pricing

Provider prices and included allowances change.

Where possible:

* import provider data
* use provider invoice data
* use configured provider metadata with source/date
* make pricing definitions updateable

Do not scatter magic numbers through application code.

---

# 49. Definition of done

Economics is successful when an administrator can open one desktop page and quickly determine:

```text
Current revenue
Current actual operating cost
Projected month-end cost
Fixed infrastructure cost
Variable usage cost
Cost by provider
Provider usage vs allowance
Expected overage
Provider sync freshness
Free-user marginal cost
Plura marginal contribution
Omni marginal contribution
Fully loaded profitability
Break-even paid-user estimate
AI spend
AI-enabled vs code-only economics
Reconciliation problems
Missing or uncertain data
```

And every important number can answer:

```text
Where did this come from?
What period does it represent?
What scope does it represent?
Is it exact or estimated?
What original currency was it?
When was it last updated?
```

---

# 50. Final implementation report

After implementation, provide a concise report containing:

1. Repository audit findings
2. Existing systems reused
3. Database migrations added
4. Provider integrations added
5. Provider fields that could not be automatically retrieved
6. Manual fallbacks added
7. Economics pages/components created
8. Formulas used
9. Attribution assumptions
10. Projection methodology
11. Security measures
12. Tests added
13. Typecheck/lint/test/build results
14. Known limitations
15. Remaining provider-specific work

Do not claim provider billing accuracy unless it has actually been verified.

Do not say a provider is connected unless real API data was successfully retrieved.

---

# Final principle

Build Nyuz Economics around this model:

```text
Provider APIs / invoices
            ↓
Provider usage + billing snapshots
            ↓
Nyuz internal usage ledgers
            ↓
Reconciliation
            ↓
Cost attribution
            ↓
Economics dashboard
```

The dashboard should be automatic wherever reliable provider data exists.

Manual input is the fallback, not the foundation.

The most important qualities are:

**accuracy, provenance, historical reproducibility, clear scope, honest uncertainty, and useful operational visibility.**

Do not optimize for flashy dashboard visuals at the expense of accounting correctness.
