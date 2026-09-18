# Deterministic Read quality audit

Production read-only inspection: 2026-09-18. Baseline commit: `f34bf0539d49d131bcaa8f3864eb82d4d0654b1b`.
GitHub Actions run `35196853577` reports successful checks and **Deploy to Cloudflare Workers** for that SHA, matching the local baseline. This patch has not been deployed.

## Production trace before editing

| Field                            | Case A                                     | Case B                                      |
| -------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Event                            | `4bfcb140-7397-402c-8849-0ba6da29c5c8`     | `459fdafd-c8bb-4edc-a216-a475983b860d`      |
| Article                          | `80422f55-5df3-4186-8950-8553cee5920d`     | `aabcb1af-c69e-4df1-8691-15aa084fc6fe`      |
| Publisher / source count         | The Register / 1                           | The Register / 1                            |
| Enriched?                        | No article evidence record                 | No article evidence record                  |
| `article_evidence.status`        | Absent, not failed/pending                 | Absent, not failed/pending                  |
| `source_word_count`              | Absent, not zero                           | Absent, not zero                            |
| Stored enriched evidence units   | 0                                          | 0                                           |
| Evidence origin                  | RSS excerpt only                           | RSS excerpt only                            |
| Stored event understanding       | null                                       | null                                        |
| On-demand understanding          | Failed, null payload, insufficient balance | Failed/idle, null payload                   |
| Cached AI version                | `b121b211a319`, no prose                   | `47c9a3e0eff3`, no prose                    |
| Current topics in returned order | AI, Cybersecurity                          | Politics, Linux, AI, Anthropic, Open source |
| Old deterministic Read words     | 153                                        | 146                                         |

`article_enrichment_enabled` was enabled at 100%. The absence of records does not establish a failed fetch or explain why these articles were not selected. No source-page fetch, AI generation, rollout change, production write or backfill was performed for this task.

### Evidence actually selected by the old composer

Case A's deck came directly from `events.what_happened`: the PWNED welcome paragraph. `newDevelopments` selected the editorial lesson, Richard Schut's current AI job, and his earlier security audit. `context` duplicated the lesson, added the externally accessible test environment/live database sentence, and appended the two unrelated titles. The final exact-string deduplicator removed the duplicate lesson. No entity or numeric sentence was generated. This is five unique RSS statements including the deck, plus the unrelated title dump.

Case B's deck also came directly from `events.what_happened`: the publisher's 30-year retrospective. `newDevelopments` selected “As we write”, Hansson/Rails background, and immigration-post context. `context` duplicated the first two, appended the first four company dictionary hits (Apple, Intel, Meta, Anthropic), and the two unrelated titles. Numeric metadata scanned the full excerpt and rendered 8, 10, 18.5 and 12 million without their source sentences. This is four unique RSS statements including the deck, plus entity, related-title and number templates.

The RSS excerpts, not any source fetch, supplied every sentence and entity/number match above. Permanent snapshots are in `src/lib/test-support/reader-production.json`.

### Exact old related-event selection

The implementation counted shared topic rows, sorted descending by that count, then by publication time. It computed no entity, product, action or lexical signals and had no semantic acceptance threshold. Candidates were bounded to 300 topic rows and 100 event IDs.

| Case | Selected event ID / title                                                  | Score | Shared signal | Tie-breaking publication time |
| ---- | -------------------------------------------------------------------------- | ----- | ------------- | ----------------------------- |
| A    | `2365057f-ff26-4981-9dce-208b72ebf4e4` — llama.cpp/OpenVINO backend update | 1     | AI            | 2026-08-28 13:53:31 UTC       |
| A    | `f676394e-2f5f-40df-93b8-faf3a078b220` — a16z Machine Age fund             | 1     | AI            | 2026-08-28 13:24:43 UTC       |
| B    | `289e2ec9-c9c6-4b05-a306-4008e81c5fbd` — Leon Black/Epstein                | 1     | Politics      | 2026-09-02 22:03:25 UTC       |
| B    | `98a926ed-a33c-4f9c-b1c3-d2a526b83d70` — Australia/Nepal/housing           | 1     | Politics      | 2026-09-02 22:00:26 UTC       |

### Category and cache causes

Topic assignment matched keywords across the coverage, including Schut's current AI job and Omarchy's political controversy. `hydrateEvents` then preserved the order of an unordered topic query. Both UI components display `story.topics[0]`; there was no primary-category ranking. Existing taxonomy includes Cybersecurity, Funding, Linux and Open source.

Deterministic articles are composed live in `composeArticle`, not stored in `article_evidence` or `event_understanding`. The stale component was the stored first-sentence summary reused as the deck. New composition reselects the lead from evidence, and future metadata finalization uses the same selection. Stored enriched units are re-filtered on read. No content-version migration/invalidation is needed for these deterministic outputs. Authored AI articles retain their existing cache and priority; their version is deliberately unchanged. Readers need the deployed client bundle/reload to run new composition code.

## Shared fixes

| Problem             | Root cause                                              | Owning file/function                                                           | General fix                                                                                                                                   |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Publisher lead      | First excerpt sentence stored and preferred             | `news-signals.finalizeMetadata`, `editorial.composeArticle`                    | Title overlap, entity role, concrete action and matching headline amounts rank lead evidence                                                  |
| Editorial voice     | Navigation-only filtering                               | `reader-evidence.editorialNoise`, `selectReaderEvidence`                       | Filter column introductions, first-person publisher language, rhetorical setup and fragments; retain attributed quotations                    |
| Lost facts          | Four-sentence RSS cap                                   | `selectReaderEvidence`                                                         | Scan complete stored excerpts and enriched facts; preserve unique supported claims                                                            |
| Entity lists        | First dictionary matches treated as central             | `rankEntities`, `legacyEventIntelligence`                                      | Internal primary/secondary/background/reporting-source roles; case canonicalization and evidence-backed acronym aliases; no entity-list prose |
| Bare numbers        | Extraction removed subject, currency and qualifications | `selectReaderEvidence`, `composeArticle`                                       | Render complete claims, not standalone values; normalize currency/scale only for ranking                                                      |
| Weak related events | Shared topic alone accepted                             | `related-events.scoreRelatedEvent`, `briefing.relatedEventsFor`                | Hard semantic-anchor gate; topic overlap adds no score; expose overlaps, lexical similarity, recency, score and reason                        |
| Mechanical history  | Joined titles                                           | `relatedContext`                                                               | Require a usable prior factual summary and strong relationship; otherwise omit                                                                |
| Wrong category      | Incidental keywords and database order                  | `topic-assign.rankEventTopics`, `classify.topicsFor`, `briefing.hydrateEvents` | Explicit central-action/title/lead ranking using existing category labels                                                                     |
| Noisy richness      | Counts included duplicated/meta context                 | `readerQuality`                                                                | Re-filter and deduplicate evidence before evaluating breadth and length; no related-event length bonus                                        |

Citation merging preserves distinct values and subject/object direction. Single-publication articles identify the publication in the lead. Publisher retrospective clauses are only neutralized when a complete factual proposition survives; ambiguous cases are dropped.

## Replayed production results

Run `node scripts/tsrun.mjs scripts/reader-quality-audit.ts` for exact selected units, origins, scores, entities, quality, paragraphs and word counts. It is offline and reads only the permanent fixtures.

| Metric                                                   | Case A                 | Case B                              |
| -------------------------------------------------------- | ---------------------- | ----------------------------------- |
| Words before → after                                     | 153 → 255              | 146 → 314                           |
| Old sentence candidates / unique rendered RSS statements | 22 / 5                 | 37 / 4                              |
| New raw units / rejected / duplicates / retained         | 18 / 9 / 0 / 9         | 24 / 10 / 0 / 14                    |
| Reader quality after                                     | adequate               | adequate                            |
| Category before → after                                  | AI → Cybersecurity     | Politics → Funding                  |
| Related events before → after                            | OpenVINO + a16z → none | Leon Black + Australia/Nepal → none |

New raw counts differ because quotations and version numbers remain intact rather than being split into fragments. Both replays are internally `adequate`: they are clean but remain single-source and below 400 words. Unsupported padding and unusable material are excluded. A separate multi-source evidence fixture verifies that clean deterministic composition exceeds 400 words when more usable evidence exists.

Case A now leads with Richard Schut's discovery of an externally accessible test environment connected to live customer information, attributed to The Register. Case B leads with the foundation's approximately $18.5 million in pledges/donations, retaining multiyear-commitment and AI-token qualifications. Its body identifies Hansson/DHH and Rails, describes actual backers and hires, and preserves attributed criticism as context.

In the four negative related fixtures, entity overlap, primary overlap, product overlap and lexical similarity are all zero. Topic overlap is 1 but contributes zero. Final scores are recency only: approximately 0.778901, 0.778678, 0.838576 and 0.838553, respectively. All are rejected because the semantic anchor is absent, regardless of score.

## Scope and limitations

- No new AI calls, dependencies, migration or production writes. AI fallback ordering is unchanged.
- Cron cadence, ENRICH_LIMIT, subrequest budget, robots, SSRF, fetch security, failure backoff and rollout remain unchanged. Enrichment's only plumbing change reads/passes the article title for fact ranking.
- Entity/action detection is conservative English-language heuristics, not complete semantic understanding. Ambiguous aliases, long quotations, orphan references and weak history may be omitted.
- Related-event discovery retains the existing bounded topic-based candidate lookup; strong matches outside that candidate set can be missed.
- Existing AI-authored prose is intentionally untouched. This audit proves local replay, not a deployment of the patch.

## Files and tests

Implementation: `reader-evidence.ts`, `related-events.ts`, `editorial.ts`, `understand.ts`, `story.ts`, `pipeline/topic-assign.ts`, `pipeline/classify.ts`, `pipeline/news-signals.ts`, `pipeline/evidence-extract.ts`, `pipeline/enrich.ts`, `server/briefing.ts`.

Regression coverage: `reader-quality.test.ts`, `editorial.test.ts`, `understand.test.ts`, `server/story-flow.test.ts`, and `test-support/reader-production.json`. Tests cover publisher boilerplate/voice, quoted speech, lead ranking, entity roles/canonicalization, contextual and orphan numbers, headline amounts, exact false related events, strong related acceptance, natural history, taxonomy priority, metadata removal, stale enriched facts, RSS/enrichment mixing, attribution, deduplication and 400+ word composition. Existing enrichment/fetch/robots/security suites remain part of full validation.

Diagnostic artifact: `scripts/reader-quality-audit.ts` and this report.
