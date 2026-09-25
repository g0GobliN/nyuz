# Source discovery without a search provider

**Status: implemented (M0–M2). M3 is deliberately not built.** The Brave-backed
provider, its key, its query formation and the two environment variables it read
are gone; `discovery_jobs.provider`/`queries` became `method`/`terms`/`attempts`
and a `linked_count` on the same `0096` migration, which is unapplied. Nothing
in this document describes a future that has not happened except where it says
"deferred".

**Decision.** Discovery keeps its job queue, its candidate registry and its
registration path. It loses the search provider and everything that existed only
to configure one. Candidates come from two methods that make no request at all,
plus one that probes a URL a reader supplied, and the stage says out loud that it
is best-effort.

## Why the provider had to go

- **A key is a dependency, not a feature.** P0 is "the pipeline works
  end-to-end"; a stage that needs a vendor account provisioned before it can be
  exercised is a stage nobody can accept.
- **A per-call API makes our cost unbounded from our side.** Every followed
  subject with no coverage becomes a search query whose price we do not set.
- **The provider was never the discovery mechanism.** `resolveFeed` was: probe
  the URL, read a declared `<link rel="alternate">`, try the conventional
  addresses, admit a feed only if one parses. A search API supplied a seed URL
  and nothing else.

## The flow, as built

`discover()` claims one due job per tick and calls `runJob`, whose whole body is
`linkExistingCoverage` (`src/lib/discovery/seeds.ts`). No request is made and
none can be: both methods read the database, and a test asserts a job body never
touches the transport.

**M0 — the registry (`seeds.ts`).** Sources we already collect whose own name or
homepage carries every term of the subject. One bounded read (`sources`, active
only), a TypeScript decision, then `source_topics` links. The feed is already in
the registry; the missing thing was the link.

**M1 — the corpus (`seeds.ts`), the fallback.** Read after M0 only when M0 found
nothing: one bounded read of recent articles, decided in TypeScript, grouped to
their sources, then linked. Whoever published a story about the subject covers
the subject — demonstrably — so the source is linked.

**M2 — a reader's URL (`submit.ts`).** The only method that can reach a subject
nothing in the corpus mentions. Canonicalise → `isPublicHttpUrl` → `resolveFeed`
(≤6 requests, declared link then conventional paths) → relevance tripwire →
register and link. Transient failures and failed registration writes queue a
`source_candidates` row with `method = 'reader'`, which the ordinary resolver
pass retries on the next tick, so there is one place where a candidate becomes a
source and this module does not duplicate it.

**Nothing found is an outcome.** The job finishes `succeeded` with
`method = 'none'` and a term list, the console shows the subject as still
uncovered, and the reader's own URL is what can change it. Best-effort, stated
rather than faked.

### The invariant

> A source exists only behind a resolved feed that passes the relevance check.

Enforced in two places and nowhere else: `submit.ts` (resolve → tripwire →
register) and `resolveCandidate` in `runner.ts` (unchanged, the same order). A
200 response, an existing domain, or a plausible URL is not evidence. There is no
"domain guess" path in this implementation, so nothing registers a source merely
because a topic and a hostname look related.

### The SQL filter is a prefilter, and the decision is TypeScript

`mentionFilter` builds a PostgREST `or=` expression of `ilike` terms, which is a
deliberate superset: `mentions` matches word prefixes, so anything the decision
accepts contains the term as a substring and survives the query. The decision
itself is `matchesTerms`, the same evaluator `classify.ts` and `match.ts` use, so
discovery cannot disagree with the rest of the pipeline about what a subject
means. It requires **every** term, which is why a source named "Rust Blog" is
linked to the subject "Rust" and not to "Rust programming".

## Bounds

| Constant                                   | Value                                                                            | File        |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----------- |
| `REGISTRY_SCAN_LIMIT`                      | 500 sources                                                                      | `seeds.ts`  |
| `CORPUS_SCAN_LIMIT` / `CORPUS_WINDOW_DAYS` | 300 articles / 30 days, measured on `fetched_at` so an undated feed still counts | `seeds.ts`  |
| `MAX_LINKS_PER_JOB`                        | 20 links                                                                         | `seeds.ts`  |
| `EVIDENCE_CONFIDENCE`                      | 0.3, matching `OBSERVED_CONFIDENCE` in `match.ts`                                | `seeds.ts`  |
| `MAX_JOBS_PER_RUN` / `CANDIDATES_PER_PASS` | 1 job / 2 candidates                                                             | `runner.ts` |
| `MAX_FETCHES`                              | 6 per candidate                                                                  | `feed.ts`   |

Worst case per tick: ~5 PostgREST calls for a job body and 12 feed requests in
the resolver pass — the same order as `SCHEDULED_LIMIT = 12` feeds in `cron.ts`.
No crawler, no sitemap walk, no article fetching, no browser automation, no model
call.

## What changed in the repository

- **Deleted**: `src/lib/discovery/provider.ts` (the Brave client, `PROVIDER_ENV`,
  `providerFromEnv`) and `src/lib/discovery/queries.ts` (search-query formation),
  with their tests.
- **Added**: `src/lib/discovery/seeds.ts` (M0/M1 and the link write),
  `src/lib/discovery/submit.ts` (M2), and a test file for each.
- **Rewritten**: `runner.ts` — `runJob` links instead of searching; the report
  gained `linked`; the provider failure branches and the
  `provider-not-configured` / `unknown-provider` reasons are gone. Everything
  else in the file (claim by status, `retryAt`, the candidate resolver, the
  leftover pass) is unchanged. `runner.test.ts` was rewritten around it.
- **`coverage.ts`**: the gate is the feature flag alone — nothing to configure,
  nothing missing. `EnqueueResult.reason` is `"ok" | "disabled"`.
- **`0096`**: `discovery_jobs` carries `method`, `terms`, `attempts`
  (`{method, considered, matched, linked}` per method tried) and `linked_count`
  instead of `provider`, `queries`, `candidate_count` and `registered_count`;
  `source_candidates` carries `method`. RLS, the claim index and the retention
  function are untouched. `src/lib/supabase/types.ts` follows.
- **`cron.ts`**: `runDiscover` no longer passes an env bag. `.env.example`
  documents the section as needing no secret.
- **Console** (`server/operations.ts` + `routes/admin/operations.tsx`): the
  "no search provider key" state is gone; the panel shows subjects linked and
  sources added in 24h, and each attempt shows its method and link count.
- **`fake-db.ts`**: inserts can opt in to a generated `id`
  (`FakeDbOptions.generatedIds`), because the registrar reads the new source's id
  back to link it. Off by default — the fake should not invent a column a table
  does not have.

## How it is verified

- `seeds.test.ts` — the decision (every-term rule, source attribution, caps), the
  prefilter's injection refusal, and the link write (a repeat is not counted and
  an operator's own link is never overwritten).
- `submit.test.ts` — the invariant: a 200 page with no feed is refused and
  nothing is registered; a feed that says nothing about the subject is refused; a
  transient failure is queued once, not per click.
- `runner.test.ts` — the flag, a job body that makes no outbound request, M0 and
  M1, "nothing found" as a success, a broken table as a zero rather than a failed
  job, and the resolver turning a queued URL into an ordinary source.
- No test needs a key, a network, or a provider. That is the property the whole
  change was for.

## Deferred, deliberately

**M3, domain guesses from the label** (`slug.com`, `slug.org`, …): not built. Low
yield outside single-token subjects, every guess is a real request, and the
candidate registry's value depends on its entries meaning something. If it is
ever added it must go through `resolveFeed` and the tripwire like M2, and its hit
rate should be measured before it is enabled.

## Rejected, with reasons

- **Search APIs** (Brave, Tavily, SerpAPI, Google CSE). Key, per-call price, and
  an index we do not control.
- **Scraping a search engine's HTML.** An API in disguise: breaks silently,
  against terms, and needs its own failure story — worse than a documented no-op.
- **Wikidata / Wikipedia.** Resolving a label to an official website needs
  `wbsearchentities`, which is a search API, so it fails the same rule.
- **Sitemap walking, `<a href>` harvesting, recursive crawl, browser automation.**
- **Outbound-domain mining from `article_evidence` (0090).** Technically
  available, but it converts a robots-respecting evidence stage into link
  harvesting across publishers.
- **Model-generated domain guesses.** A token spend for a worse version of M3.
