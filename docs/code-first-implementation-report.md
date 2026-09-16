# Code-first implementation report

Local implementation only. No production migration, deployment, push, live provider experiment or paid validation was performed.

## 1. Provider callsites before and after

Previously, clustering could fall back to paid classification and the analysis stage bought event synthesis; onboarding/backfill and manual commands could reach that analysis. Shared understanding also existed, including a possible JSON repair request.

Remaining production entry points:

| File                              | Purpose                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/server/understanding.ts` | One routed request for an authorized explicit open of an uncached event/version |
| `src/lib/server/ai-config.ts`     | Explicit authenticated administrator provider probe; metered exception          |

Shared plumbing remains in `ai/config.ts` (routing/reservation/settlement), `ai/deepseek.ts` (SDK completion), and `ai/transport.ts` (guarded transport). No background stage calls those providers. The source/script callsite invariant and database feature allowlist enforce this boundary. No new model, embeddings, crawler or per-user synthesis was added.

## 2. Deterministic clustering

Indexed shortlisting remains; complete normalized titles are scored rather than only retrieval tokens. Attachment requires near-identical content-word order, compatible numbers/negation, publication proximity within 48 hours, and a single unambiguous event. Otherwise a separate event is created. Research follows the same conservative rule.

Database article ownership and two-minute leases prevent duplicate processing of one article. Expired free claims can be recovered; owner fencing prevents a previous worker committing afterward. Different articles arriving simultaneously may form separate events. Briefing and alert selection suppress near-identical duplicate coverage, including recently selected coverage for the same reader.

## 3. Deterministic finalization

The `analyse` stage remains:

- Title: representative clean source wording, using publisher representatives, headline overlap and source kind.
- Short description: useful source excerpt/first sentence, bounded to card length; headline fallback.
- Topics: deterministic classifications plus existing event topic candidates promoted into `event_topics`.
- Importance: existing `scoreEventV2`, with publisher representatives instead of treating every article as a distinct source.
- Novelty: understandable age bands using the original event time.
- Completion: transactional metadata/topics, `status=complete`, and initial `analysed_at`. Refresh preserves original time and historical prose.

Claims and fair live/backlog selection recover stranded analysing work without model calls. Failures exit into failed state rather than permanently claiming an event. Metadata refresh does not itself create a prose version or reset delivery eligibility.

## 4. Unique-source scoring

Five BBC articles yield `article_count=5`, `publisher_count=1`. BBC, Reuters, AP, Guardian and NHK yield five publishers. Identity uses curated source homepages, normalized domains, recognized subdomains and known aliases. It does not prove independent confirmation, and UI wording says publishers.

## 5. Onboarding and background proof

The first-briefing regression runs the real handler through backfill/finalization/matching and asserts no provider invocation. The full fixture runs feed ingestion, clustering, classification, finalization, matching, briefing preparation and alert evaluation, with delivery-channel preparation and zero logical provider calls.

| Runtime path                                               |          Provider calls |
| ---------------------------------------------------------- | ----------------------: |
| Ingestion, classification, clustering, finalization        |                       0 |
| Metadata refresh, onboarding, backfill                     |                       0 |
| Matching, ranking, briefing, breaking alerts               |                       0 |
| Email/push/Telegram formatting and delivery preparation    |                       0 |
| Dashboard, story metadata and prefetch                     |                       0 |
| Maintenance, schedules and normal manual pipeline commands |                       0 |
| Eligible first uncached explicit story open                |                       1 |
| Refresh and 100 additional readers, same version           |            0 additional |
| Eligible genuinely new version                             | 1 new shared generation |

These are fixture/static/database test results, not measurements from deployed production.

## 6. Immediate story endpoint

Metadata GET returns stored title, description, sources and cached prose without waiting on generation. The mounted page invokes a separate authorized POST once. Only its article area displays preparation status. Prefetch never invokes that POST. Other readers poll metadata briefly, not the paid endpoint.

## 7. Shared stories and recovery

Cache keys are event/version, never user. Existing long articles are retained/adopted without paid conversion. Versions ignore ordering, views, incidental company/country recognition and metadata-only changes; existing development markers and important-number buckets remain.

An atomic claim admits one owner/version. Three lifetime paid attempts are allowed initially; no JSON repair call is made. Explicit failures have a 30-minute cooldown. Uncertain timeouts/crashes require reconciliation, with a minimum 120-minute cooldown; expiry alone cannot authorize another purchase.

Usable output is staged and promoted. Failed persistence retries the same payload. A later reader can promote staged output without calling the provider. If every write fails, the current reader still receives the in-memory prose; the attempt stays blocked for reconciliation rather than being automatically repurchased.

Feed-supplied evidence retains up to 4,000 sanitized characters. Story input selects at most eight excerpts/10,000 excerpt characters, with conservative input/output token bounds. Thin evidence can skip synthesis entirely; there is no minimum word count. Output contains only a cited introduction and paragraphs in a renderer-compatible envelope.

## 8. Financial and abuse protection

Launch database admission enforces $0.50/day and $10/month, including reserved and uncertain charges. Initial limits are two global active generations, three paid attempts/version and ten new starts/user/UTC day. Story limits use runtime settings; existing token/model caps, kill switch, credit gate and access/plan checks remain.

Refused budget, ownership, evidence or capacity makes zero provider calls. Cached reading consumes no generation allowance. There is no paid work queue or automatic retry after budget reset.

Typed input/output/cached tokens and costs are settled idempotently; observed usage is not added twice. Only positively unstarted stale reservations are automatically voided. Service-only reporting separates settled spend, unresolved reservations, failures, voids and remaining monthly allowance. See the single SQL report in [the financial specification](code-first-news.md).

## 9. Customer wording

“Why it matters [to you]” becomes “Why you're seeing this” where it explains selection. Publisher breadth no longer claims independent outlets. Landing, about, pricing, explainer, default editable copy and reader/email disclaimers describe source-based descriptions, topic matching and deeper shared coverage on request.

Existing database-managed custom public copy was not modified and needs operator review before release.

## 10. Provider-call and failure tests

Regressions cover first generation, repeat/100-reader reuse, simultaneous first opens, material new versions, cached budget bypass, cooldown, timeout uncertainty, persistence failures including thrown storage exceptions, malformed output without paid repair, weak evidence, background/onboarding/prefetch zero-call paths, publisher scoring, duplicate suppression and database reservation/claim/settlement safety.

Real provider transport throws before network dispatch in tests/CI. Injected fake transport is required; tests also replace real fetch and substitute test-only provider keys. Local PGlite executes actual migration functions. Its serialized engine is not a substitute for a multi-connection production PostgreSQL load test.

## 11. Validation

`CI=true npm run ci` completed with exit code 0:

| Check               | Actual result                                            |
| ------------------- | -------------------------------------------------------- |
| `npm run typecheck` | Passed, application and script TypeScript configurations |
| `npm run lint`      | Passed; 0 errors, 19 existing warnings                   |
| `npm run test`      | Passed; 108 files, 1,527 tests                           |
| `npm run build`     | Passed; client/server production bundles generated       |
| Full CI             | Passed                                                   |
| `git diff --check`  | Passed                                                   |

The sandbox initially denied the existing generated-SQL test's child process with EPERM. The unchanged test and then full CI passed with approved execution outside the sandbox; CI provider-network guards remained enabled. Earlier email-copy and story-fixture failures were corrected before the successful full run. Build emitted advisory Vite/plugin and bundling warnings, not failures. No assertion was skipped or weakened to obtain the pass.

## 12. Remaining risks and rollout

- Conservative clustering intentionally splits paraphrased coverage; duplicate suppression is similarly conservative.
- Importance/novelty are heuristics. Tests cover thresholds and breadth, not editorial parity with historical AI.
- Thin feeds limit synthesis quality; no additional webpage scraping was added.
- Material-version heuristics may miss subtle developments or occasionally regenerate unnecessarily.
- Existing small cron batches preserve worker subrequest limits; high-volume backlog throughput remains bounded.
- Uncertain historical charges may consume the new small caps until explicitly reconciled. They are not automatically declared free.
- Complete storage failure followed by process destruction cannot preserve unstored bytes. The safe fallback is blocked repurchase, not guaranteed durable recovery.
- Hard application ceilings assume the configured rate card and bounded provider token behavior; they cannot control unrelated use of the provider key or external billing changes.
- Migration 0085 must precede compatible application code, with old workers paused. No production changes were made. Rolling back application code alone is not sufficient because retired features are rejected by the database.

## Exact files changed

- `docs/ai-providers.md`
- `docs/architecture.md`
- `docs/code-first-implementation-report.md`
- `docs/code-first-news.md`
- `docs/deployment.md`
- `src/components/briefing-preview.tsx`
- `src/components/dashboard/story-article.tsx`
- `src/components/dashboard/story-card.tsx`
- `src/components/landing/pipeline-explainer.tsx`
- `src/components/landing/sections.tsx`
- `src/lib/ai/budget-gates.test.ts`
- `src/lib/ai/callsites.test.ts`
- `src/lib/ai/code-first-db.test.ts`
- `src/lib/ai/config.ts`
- `src/lib/ai/deepseek.ts`
- `src/lib/ai/runtime-config.test.ts`
- `src/lib/ai/runtime-config.ts`
- `src/lib/ai/transport.test.ts`
- `src/lib/ai/transport.ts`
- `src/lib/email/shell.ts`
- `src/lib/email/templates.test.ts`
- `src/lib/email/templates.ts`
- `src/lib/pipeline/alerts.ts`
- `src/lib/pipeline/analyse-cost-safety.test.ts`
- `src/lib/pipeline/analyse.test.ts`
- `src/lib/pipeline/analyse.ts`
- `src/lib/pipeline/backfill.ts`
- `src/lib/pipeline/background-invariant.test.ts`
- `src/lib/pipeline/cluster-deterministic.test.ts`
- `src/lib/pipeline/cluster.test.ts`
- `src/lib/pipeline/cluster.ts`
- `src/lib/pipeline/cron.ts`
- `src/lib/pipeline/digest.ts`
- `src/lib/pipeline/duplicates.test.ts`
- `src/lib/pipeline/duplicates.ts`
- `src/lib/pipeline/event-version.ts`
- `src/lib/pipeline/evidence-correctness.test.ts`
- `src/lib/pipeline/feed.ts`
- `src/lib/pipeline/inclusion.ts`
- `src/lib/pipeline/news-signals.ts`
- `src/lib/security-invariants.test.ts`
- `src/lib/server/ai-config.ts`
- `src/lib/server/briefing.ts`
- `src/lib/server/story-flow.test.ts`
- `src/lib/server/understanding.test.ts`
- `src/lib/server/understanding.ts`
- `src/lib/site-content.ts`
- `src/lib/story.ts`
- `src/lib/supabase/types.ts`
- `src/lib/test-support/code-first-db.ts`
- `src/lib/test-support/fake-db.ts`
- `src/lib/test-support/news-pipeline.ts`
- `src/routes/about.tsx`
- `src/routes/dashboard/briefing.tsx`
- `src/routes/dashboard/story/$id.tsx`
- `src/routes/legal/$doc.tsx`
- `src/routes/pricing.tsx`
- `src/test-setup.ts`
- `supabase/migrations/0085_code_first_news.sql`
- `vitest.config.ts`

Unrelated `.freebuff/` files were left untouched.
