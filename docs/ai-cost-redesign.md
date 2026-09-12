# AI cost redesign handoff

The current implementation keeps clustering and shared event analysis in the
background. Briefing assembly reads stored impacts and derives a fallback from
stored facts; it makes no model call. Story Ask is disabled on all plans, and
translation serves existing cache rows without generating new ones.

## On-demand explanations

Migration `0078_understand_on_demand.sql` adds an explanation cache keyed by event
and material version, with a database claim shared by all readers. A real story
open can generate an explanation after the session and story visibility checks.
Prefetches, briefing lists, and alert delivery never generate explanations.

The reader path checks the material version before accepting a cache hit. Legacy
content is adopted without a provider call. Generated payloads retain the article
IDs in evidence order, so citations survive changes in coverage ordering.

The version detector recognizes a bounded list of developments and numeric
magnitude buckets. It is not a semantic change detector: smaller corrections or
unrecognized developments can leave old prose cached. List hydration can also
serve the latest ready explanation while a newer version is unavailable.

Failed generations have a per-version attempt limit. Each JSON request can make
one independently metered repair. A worker crash leaves its claim held; an
operator must reconcile provider usage and the ledger before allowing recovery.
Age alone does not authorize another paid call.

## Rollout

Apply migration 0078 before deploying code that uses its new feature label and
cache. Its defaults preserve background generation (`understand_in_analysis`
enabled, `understand_on_demand` disabled). Migration 0079 retires the Ask and
translation flags and keeps enrichment disabled.

After deployment, enable `understand_on_demand` and verify a real uncached open,
a second reader's cache hit, and source links. Then disable
`understand_in_analysis` to stop writing the long article during background
analysis. Model-generated importance and novelty remain in use; the deterministic
scorer has not been promoted.

Turning background generation back on restores the long analysis contract.
Turning on-demand generation off stops new reader-triggered calls. Existing
cached explanations remain readable. Re-enabling Ask or translation generation
requires a code change; their old flags no longer enable spending.

## Measurement and operations

- `npm run audit:ledger` reads feature attribution from the ledger.
- `npm run shadow:scoring` compares deterministic scores with stored model scores
  without modifying events or calling a provider.
- `npm run repair:stranded` previews ledger settlement repairs. Its `--apply`
  option writes settlements and should follow review of the preview.

Model alias settlement records both the provider-reported model and the rate-card
model used for pricing. No cost savings are claimed from local tests. Provider
quality, live migrations, production deployment, and actual post-rollout spend
require live verification.
