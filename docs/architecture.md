# Architecture

Nyuz is a code-first news product. Shared events power personalized selection and delivery. Background work makes no AI provider calls.

## News processing

1. Ingestion fetches supported RSS/Atom feeds on existing demand-aware schedules. Normalization strips HTML, canonicalizes URLs, deduplicates articles and bounds retained excerpts to 4,000 characters. No article crawler is involved.
2. Clustering uses the existing indexed shortlist plus conservative complete-headline and publication-time comparisons. A second, also-conservative route attaches a *paraphrase* — shared story-identifying words, figures and negation that do not conflict, a 48-hour window, and two different publishers — which is what gives one event coverage from more than one outlet; the same publisher's next take is not a second source. Uncertain articles form separate events. Database leases protect article processing.
3. Classification produces deterministic topic candidates from article/source text and the taxonomy.
4. The retained `analyse` stage finalizes events using ordinary code. It selects a representative source headline and short description, promotes topics into `event_topics`, derives importance/novelty, and records `status = complete` and `analysed_at`.
5. Matching uses topics, custom interests, exclusions, preferred/muted sources and existing reader weights. Ranking retains freshness, importance, novelty and personalization signals. An event whose articles have all moved away is not a candidate: it keeps its stored summary so a briefing already sent still renders, but it has no source to open and nothing to compose from, so it cannot reach a reader who has not seen it.
6. Briefings select and arrange stored events within density, freshness and plan rules. Breaking alerts retain their qualification, pacing and transactional delivery claims. Both suppress near-identical recent coverage conservatively. A reader-readiness gate withholds only provably non-news — empty summaries, build numbers, commit messages, bylines, newsletter containers, sales with a clock on them, quote posts and a vendor's own marketing copy — never short real news, and one story is told once: events the corpus split across several tellings of the same arrest, filing or launch are collapsed to the highest-ranked one before the cap is filled.
7. Delivery formats stored content for email, push and Telegram. Schedules, entitlements, history, bookmarks and custom-source limits are preserved.

The schedule and manual pipeline use these same implementations. Onboarding backfill may finalize pending events, but that operation is free of AI as well.

## Shared long-form coverage

Opening an event first returns deterministic metadata and any cached story. A separate authenticated POST can request long-form synthesis. It checks authorization, evidence quality, the event/version cache, a database generation owner, retry policy, initiation rate limits, global concurrency and a worst-case spending reservation before one provider request.

The article is stored globally by `(event_id, content_version)`. A hundred readers of that version reuse one generation. Prefetch, metadata reads, briefings and alerts cannot initiate synthesis. A missing budget or unavailable provider affects only new long-form coverage, never the rest of the news product.

The existing reader renderer is retained. Generated content is only a cited introduction and paragraphs, not importance scores or personalized analysis. Historical generated fields remain readable; schema columns are not broadly removed.

## Refresh and recovery

New coverage marks event metadata dirty. Finalization preserves original event/analysis times and existing prose. Article count and normalized publisher count are distinct. Versioning depends on material development markers and numeric buckets, not metadata timestamps or readers.

Free processing leases can be reclaimed after worker crashes. Paid generation uses owner fencing and separate claimed, requesting, uncertain, persisting, ready and failed phases. Uncertain paid outcomes require reconciliation; persistence-only recovery reuses the same payload rather than buying it again.

See [Code-first news and financial policy](code-first-news.md) for launch limits, recovery details, the financial query and rollout requirements. Earlier dated design documents describe historical implementations, not permission to restore background provider calls.

## Runtime and trust boundaries

TanStack Start/React provide the UI and server endpoints; Supabase/PostgreSQL own durable shared state, claims and financial authorization. Cron invocations use the existing Cloudflare/Nitro scheduling shape. Provider support remains OpenAI-compatible, but its only ordinary production consumer is shared story generation.

Server middleware verifies reader/admin identity and authorization. Browser roles and UI flags are not security boundaries. Operational caches, initiation ledgers and spending functions are service-role only. Tests and CI cannot use live paid provider transport.
