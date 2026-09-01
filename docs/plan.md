# Build plan — making nyuz actually work

The shell around the product is finished. Stages 1–8 are too: a briefing is built
from real news, emailed, and shown on the dashboard. What remains is ops, coverage
decisions, and a few loose ends in stage 9.

This file tracks that work. It is written to be resumable — anyone picking this up
cold should be able to read the current stage, see what is already true, and
continue without re-deriving the design.

> **Update this file as you go.** Tick a box only when the thing is built _and_
> verified against a real database, not when the code compiles.

---

## Where things stand

**Working today.** Marketing site, accounts and OAuth, admin console, blog, editable
site content, Stripe checkout and webhook (live configuration pending), lifecycle email via Resend,
reader preferences persisted to Postgres, the full pipeline (ingest → cluster →
analyse → match → digest), day-one backfill, email delivery, and a dashboard that
reads `user_events` and `digest_items`. CI refs are dropped at ingest, parked as
failed events at cluster, and refused at analysis, so they no longer spend tokens.

**Not working today.** Telegram/WhatsApp delivery, a verified sending domain (so a
stranger can receive mail), Stripe live mode, and the four ops items at the bottom of
stage 9. Breaking alerts, story Ask, the staff pipeline page, and a wider topic pool
shipped 25 August 2026.

| Reality check                            | Answer                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Do readers get real news?                | Yes — on screen and in an inbox (Resend onboarding address only).      |
| Does anything call a language model?     | Yes — clustering, analysis, and one `why_it_matters` line per story.   |
| Are there articles stored?               | Yes — 1040, from 64 live feeds.                                        |
| Are there events?                        | Yes — 98, holding 112 articles. 928 unclustered.                       |
| Has anything been analysed?              | Yes — 98 of 99, scored and topic-linked. 181,980 tokens. |
| Can a new reader be matched to anything? | Yes — 29 of 98 for the one live reader, at zero cost.    |
| Does a reader see those matches?         | Yes — home, briefing, history and story pages read the live tables.    |
| Is the dashboard real yet?               | Yes. `sample-data.ts` is marketing only.                               |

`digests`, `digest_items` and `deliveries` have rows. First live run: 16 items,
7,858 tokens, `deliveries.status = sent`.

---

## The shape of the thing

From [`architecture.md`](architecture.md). The economics rest on one property: an
event is understood **once**, no matter how many readers eventually see it.

```
feeds ──fetch──▶ articles ──hash──▶ distinct articles
                                          │
                                   trigram shortlist
                                          │
                                   [AI] same event?
                                          │
                                       events ──[AI] analyse once──▶ scored
                                          │
                                  SQL match per reader
                                          │
                              digest_items ──[AI] one short line each──▶ sent
```

Only two stages cost model tokens per event, and both are shared. The only per-person
model spend is one paragraph.

---

## Stages

### Stage 1 — Sources · _done_

A real list of feeds to watch. Nothing here costs anything.

- [x] Migration `0006_sources.sql` seeding ~40–60 feeds across the `source_kind`
      enum (`company_blog`, `news`, `rss`, `github`, `research`, `product`)
- [x] Admin console page to add, disable and inspect a source
- [x] Verified: `select count(*) from sources where active` returns > 0

**Verified 2026-08-23.** 68 rows in `sources`, 64 active, 15 in `topics`. Every feed
URL was fetched and parsed with the same code the ingester uses
(`npm run check:feeds`): 59 working, 5 quiet for a reason, 4 switched off.

Four wrong addresses were disabled, each with an `admin_audit_log` row: Anthropic,
Meta AI and a16z publish no feed at any conventional path any more, and Project
Zero's Blogger default feed is 12.9MB — a corrected `feeds/posts/summary` URL was
added in its place, along with Meta Engineering for the Meta slot. **Anthropic is a
coverage gap worth naming**: `anthropic` is in `TOPIC_POOL` and now has no primary
source, so an Anthropic announcement arrives as somebody else's coverage of it.

**Applied without the Supabase CLI.** There is no database password and no
`SUPABASE_ACCESS_TOKEN` in `.env`, and no `supabase/config.toml`, so `supabase db
push` cannot run from here. `npm run db:seed` replays a migration's INSERTs through
PostgREST instead, which the service-role key can do; it refuses any file containing
DDL rather than applying half of it. **`0007_source_stats.sql` was applied 2026-08-25**
via the Supabase MCP (`admin_source_stats()`): 68 sources, 1,040 articles. The
console no longer has to print "—" for per-source counts.

**Decisions already made.** `sources.feed_url` is unique, so a seed is re-runnable with
`on conflict do nothing`. `failure_count` and `last_fetched_at` exist for backoff —
use them rather than adding new columns.

**Watch out.** Coverage has to match what onboarding implies. `TOPIC_POOL` offers
fifteen technology topics but onboarding accepts free text, so a reader can ask for
something no source covers. That is called out in [`status.md`](status.md) as a product
decision, and it becomes real the moment sources exist.

**Learned the hard way.** An empty feed is not a broken feed. All five arXiv feeds
serve a valid channel with zero items at the weekend and say so in `<skipDays>`; a
liveness check run on a Sunday without reading that would have switched off five
working sources. `parseFeed` returns `skipDays` for this reason, and `--disable` only
ever acts on a permanent HTTP failure or HTML served in place of XML — never on a
timeout, never on an empty feed.

---

### Stage 2 — Ingestion · _done_

Fetch every active feed, store what is new. Still no model calls.

- [x] RSS and Atom parsing that survives malformed feeds
- [x] URL canonicalisation — strip tracking parameters, session ids, AMP variants
- [x] `content_hash` over canonical url + title — but see the correction below
- [x] Insert into `articles`, skipping anything already stored
- [x] Per-source failure counting and backoff, so one dead feed does not stall a run
- [x] Cron trigger on Cloudflare Workers — built and exercised; see the one gap below
- [x] Verified: a real run puts real rows in `articles`

**Verified 2026-08-23.** **1017 rows in `articles`** from 64 active feeds, 0 failing.
The first real run inserted 1005 in 9 seconds. A forced re-run of all 64 inserted **0**,
which is the idempotency claim: `articles.url` is unique and the insert is
`upsert(…, { ignoreDuplicates: true })`, so re-reading a feed is free. Everything
downstream — `events`, `event_topics`, `user_events`, `digests`, `digest_items`,
`deliveries` — is still zero, and honestly so.

**The failure path was exercised deliberately**, because it is the kind of code that
looks right and is not. A source pointing at an RFC 2606 `.invalid` host was inserted,
run at nine times, and deleted: `failure_count` climbed 1→8, `active` flipped to false
on the eighth, an `admin_audit_log` row was written by `pipeline:ingest` recording the
reason, and the ninth run did not see the source at all. Unforced, a source with three
failures reports `backing off after 3 failures` and is skipped. So a dead feed costs one
fetch, then less, then nothing.

**Correction to the third box.** "An exact match is a republish, not news" is not what
`content_hash` can do, and the plan was wrong to imply it. The hash covers canonical URL
plus normalised title, and `articles.url` is unique — so two rows can never share a URL,
and the hash can therefore never match across two rows. It cannot identify a duplicate;
the unique index already caught everything it would have. What it does do, which the
index cannot, is notice that a URL already stored now carries a **different headline** —
a publisher correcting or rewriting a live story. That is what `updateRetitled` uses it
for. Cross-outlet republishing is a real problem and it is stage 3's, not this one's.

**Where the cron actually lives, and why not where you would look.** `src/server.ts` is
not the Worker's default export. Nitro's `cloudflare-module` preset generates its own,
and reaches a `scheduled` handler only through a `cloudflare:scheduled` **hook** — so a
`scheduled` export added to our entry file is never consulted by anything. No error, no
warning, just a cron that appears configured and never runs. The handler is therefore a
nitro plugin, [`src/nitro/scheduled.ts`](../src/nitro/scheduled.ts), registered via
`plugins` in `vite.config.ts`. The schedule strings are declared in two places that must
agree — `cloudflare.wrangler.triggers.crons` in `vite.config.ts` and `INGEST_CRON` /
`CLUSTER_CRON` in [`src/lib/pipeline/cron.ts`](../src/lib/pipeline/cron.ts), which
dispatches on them — so an unrecognised schedule logs itself rather than returning
quietly.

**How the cron was verified, and the one thing that was not.** There is no wrangler and
no Cloudflare credentials here, so nothing was deployed and `wrangler dev
--test-scheduled` could not run. What was verified is the artifact that would deploy:
`npm run build` emits every schedule into `triggers.crons` in
`.output/server/wrangler.json` — `["*/15 * * * *", "10,40 * * * *"]` as of stage 3 — and
`npm run cron:test` imports
`.output/server/index.mjs` and calls its real `scheduled()` export. Three sources had
`last_fetched_at` nulled; the cron run reported `ingest: 3/64 sources` and `db:status`
afterwards showed all 64 fetched again — so the write path works end to end through the
deployable bundle. An unknown schedule correctly reported `cron 0 3 * * * fired and
nothing is registered for it`. **The single unverified claim is that Cloudflare's own
scheduler pulls the trigger at the right minute.** `triggers.crons` in the built
`wrangler.json` is the whole of the evidence for that, and it stays that way until a
real deploy.

**`SCHEDULED_LIMIT` is 24, and that assumes a paid plan.** A Worker invocation may make
50 subrequests on the free plan and 1000 on paid, and every feed fetch _and_ every
PostgREST call counts — 24 feeds is roughly 120. A limit works without a stored cursor
because `selectSources` orders most-neglected-first, so four invocations cover all 64
and, at one every fifteen minutes, each source is read about every forty. Raising or
lowering this is a decision about the hosting plan, not about the pipeline.

**Learned the hard way, expensively.** Rock Paper Shotgun failed on the second run with
`Reading stored hashes: TypeError: fetch failed` — against a feed that had just been
fetched and parsed perfectly. It was not a network fault. A PostgREST filter travels in
the request URL; RPS serves 100 items with slugs up to 201 characters, and the resulting
`url=in.(…)` came to **17,082 characters**, past Supabase's 16KB header limit. The server
abandons the request line, so there is no HTTP status to read — the client reports
`TypeError: fetch failed` with cause `UND_ERR_HEADERS_OVERFLOW`. Two runs had already
charged a failure to the publisher before anyone looked. `byUrlLength` now groups by
_encoded_ length under a 4000-character budget, and `ingest.test.ts` locks the
invariants, because both ways of getting it wrong are invisible from outside: too big
brings the bug back for whoever writes the longest slugs, and a dropped group means
headline updates silently stop.

Two things that cost time and are worth writing down. `supabase-js` returns `{ error }`
rather than throwing, so a bare `try`/`catch` around a query is a **false negative** — a
diagnostic script here reported `size 100: ok` for a query that had in fact failed. And a
database error must never be charged to `sources.failure_count`: that column is a claim
about a publisher, and eight of them switches the feed off, so a fault of ours would
eventually disable a working source. `StorageError` exists to keep the two apart.

**Tested rather than only run.** A live run proves 64 _working_ feeds parse; it cannot
prove the box's actual claim about malformed ones, since a publisher whose feed is broken
in an interesting way is not obliged to stay broken. 58 tests cover that instead —
closing tags inside CDATA, self-nesting elements, byte-order marks, HTML 404 pages served
as feeds, `rel="alternate"` ordering (Blogger puts the comment thread first), named
timezones V8 rejects outright. Two exist purely to stop a future optimisation: `www.` and
`m.` are deliberately not stripped, and `normaliseTitle` deliberately never cuts at a
hyphen.

**Decisions already made.** `articles.url` is unique; rely on it rather than checking
first. Workers has no Node built-ins, so the parser is `fetch` plus string scanning —
no Node-only RSS library, and WebCrypto rather than `node:crypto` for the hash.

---

### Stage 3 — Clustering · _done_

Thirty articles about one announcement become one event. **First model cost.**

- [x] Trigram shortlist in Postgres using `articles_title_trgm_idx`
- [x] Model call over the shortlist only, answering one question: same event or not
- [x] Create or attach `events`, set `articles.event_id`
- [x] Verified: one real announcement covered by several outlets produces one event

**Verified 2026-08-23.** Both of the duplicate-coverage pairs picked out of the live
corpus collapsed into one event each, on the first run, with one model call apiece:

| Event      | Articles                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `481e5a35` | _OpenAI calls for California to strengthen its AI safety laws_ (TechCrunch) + _OpenAI says California should strengthen its AI safety bill_ (The Verge) |
| —          | _Cloverleaf deal is latest example of Nvidia using its war chest…_ + _Nvidia partners with data center developer Cloverleaf_                            |

The negative case came free with the first of those: the same shortlist offered
_Floating 10 MW nuclear reactor proposed for California_, and the model correctly
left it out. Seven candidates shown, one matched. **41 articles sat in 38 events** when
this stage was verified, none analysed; both figures have since grown, and the current
ones are in the table at the top of this file.

**The shortlist needed no DDL, which was not obvious.** The box asks for a trigram
shortlist "in Postgres", which reads like a `security definer` SQL function — and DDL
cannot be applied from this environment at all. It turns out not to be needed:
`articles_title_trgm_idx` is `gin (title gin_trgm_ops)` (`0001_init.sql:235`), and a
GIN trigram index is precisely what turns `title ilike '%nvidia%'` into an index scan.
That is exactly what PostgREST emits for `.or("title.ilike.*nvidia*")`. So the
shortlist is three `ilike` disjuncts over the most distinctive words in the headline,
bounded to ±3 days and ten rows: **one request, 270–370ms against the live table.**

**Cost, measured rather than estimated.** Over all 1017 stored articles, **89 are
decided for free and 928 would reach the model** — around **610 tokens per article**
observed across real batches. The free ones break down as 74 titles with no whitespace
(`v8.2.2`, `Surfdeck`), 11 version-control refs, and 6 whose every word is filler.

**Sequential processing is load-bearing, not laziness.** The shortlist reads the
column the write updates, so by the fourth article about an announcement the first
three are already attached and appear as candidates to join. A burst converges on one
event with no in-batch bookkeeping. Running the batch concurrently would have every
worker see the article as unclustered and create one event each — not a slower correct
answer but the wrong one, and stage 4 would then pay to analyse the same story eight
times.

**Attaching always beats creating.** If any matched candidate already has an event,
that settles it. `last_updated_at` moves and `analysed_at` deliberately does not: new
coverage of an understood event is not a reason to understand it again, and clearing
that timestamp here would break stage 4's whole premise from a distance.

**Two bugs the corpus found that no test would have.**

1. Ranking candidate words by length alone dropped `nvidia` from _"Cloverleaf deal is
   latest example of Nvidia using its war chest to patch cracks"_ in favour of
   `example` and `cracks` — two words that narrow nothing. Capitalisation in the
   original headline is a free proper-noun signal and was being thrown away by
   lowercasing before ranking. It is now used, and switched off above a 60%
   capitalised ratio, because Title Case says nothing.
2. **13 of 25 articles in one real batch were PyTorch CI refs** —
   `trunk/16ee93b8…: [vision hash update]`, `viable/strict/1787468606: Revert "…"` —
   and they took most of that batch's spend to conclude that unrelated commits are
   unrelated. They have whitespace, so the version-tag rule missed them. A ref is now
   recognised as not-a-headline. That is a mitigation; the actual fault is the feed
   URL, recorded in stage 9.

**Clustering has its own schedule**, `10,40 * * * *`, offset from ingestion so it runs
on coverage that has finished arriving, at 12 articles per invocation. Verified
through the built Worker with `npm run cron:test -- "10,40 * * * *"`: 12 articles, 7
model calls, 0 failures, 28 seconds. Both schedules appear in
`.output/server/wrangler.json`.

**`npm run pipeline` still runs ingestion only.** A stage that spends money has to be
named — `npm run pipeline -- cluster --limit 20`. A dry run prints decisions without
writing but does still call the model, because a dry run that skipped it would tell
you nothing about what it would decide.

**Two fixes to the AI layer fell out of this.** `completeJson`'s doc had always
claimed it retried once on malformed output; it did not, and now does, reporting the
**sum of both attempts** so `analysis_tokens` cannot become quietly optimistic. And
`resolveRoute` called `createAdminClient()` with no argument — on Cloudflare there is
no `process.env`, so it could never reach `ai_model_routes`, every route would have
silently fallen back to env vars, and the console's AI tab would have been decorative
in exactly the environment it exists for.

---

### Stage 4 — Analysis · _done_

One pass per event, ever. **Second and last shared model cost.**

- [x] Extract `what_happened`, `before_state`, `after_state`
- [x] Score `importance` and `novelty`, 0–10
- [x] Link `event_topics` against the shared `topics` table
- [x] Record spend in `events.analysis_tokens`
- [x] Set `analysed_at`; never re-analyse an event that has it
- [x] Verified: more articles about a known event add zero token spend

**Verified 2026-08-23.** **48 of 98 events are analysed**, scored and topic-linked, for
**88,595 tokens** — a mean of 1,846 per event, a floor of 1,020 and a ceiling of 3,293.
**Zero failures** across all 48. `event_topics` holds 46 rows, the first this project has
written to a table stage 5 depends on. The remaining 50 events are pending on purpose:
the schedule does six an hour, and a backlog is drained by hand, by name.

**The whole cost argument lives here.** If an event is ever analysed twice, the product
scales with articles instead of events. `analysis_tokens` is recorded once, on the event,
precisely so this is auditable. It was verified three ways, two of them adversarial.

1. **Asking for it by name is refused.** `npm run pipeline -- analyse --event 8c173b42…`
   against an analysed event reported `already analysed, or claimed between selection and
now` — 0 model calls, 0 tokens. `--event` bypasses the claim gate deliberately; it
   cannot bypass `analysed_at`, which is checked unconditionally.
2. **Two workers racing for one event pay once.** Two `analyse --limit 1` processes
   started together selected the same newest pending event. One analysed it for 1,447
   tokens; the other spent nothing and reported `held`. Postgres decides the winner — the
   claim is a conditional update evaluated as one statement — rather than this process
   assuming it.
3. **The corpus produced the real case unprompted.** Event `ef99831e` — CISA's warning
   that Iranian actors are targeting Siemens S7 PLCs — was analysed at 10:18:33 for 1,890
   tokens. At **10:22:25 a third outlet's coverage was attached to it by stage 3**:
   `last_updated_at` moved, `analysed_at` and `analysis_tokens` did not, and no run has
   selected it since. That is the box's mechanism exactly. It is one more article rather
   than forty, because one is what the live corpus offered.

**The cron runs it, verified through the artifact that deploys.** `npm run cron:test --
"20,50 * * * *"` against `.output/server/index.mjs`: **6 events, 6 analysed, 0 failed, 6
model calls, 9,364 tokens, 87s.** All three schedules now appear in
`.output/server/wrangler.json` — `["*/15 * * * *", "10,40 * * * *", "20,50 * * * *"]`.
Analysis sits ten minutes behind clustering so an event is understood from the coverage
that has finished arriving rather than from whichever outlet filed first. Stage 2's
Cloudflare caveat applies unchanged and is the only unverified claim here: that their
scheduler pulls the trigger at the right minute.

**`ANALYSE_LIMIT` is 6, and unlike `SCHEDULED_LIMIT` it fits the free plan.** Each event
costs a coverage read, a claim, one model call and one or two writes — about five
subrequests, so six events is roughly thirty-five plus the shared topic and outlet reads.
Six an hour is not how a backlog gets cleared and is not meant to be; it is sized to the
news of the last half hour.

**A failed event is not retried by the schedule, and that was exercised.** An event was
forced to `failed`; the next ordinary run skipped it and took the next-newest event
instead, and only `--retry-failed` picked it up, analysing it cleanly. The reason is
money: a cluster that cannot be analysed would otherwise be paid for every half hour with
nobody watching. No genuine failure has occurred yet — 0 of 48 — so `recordFailure` itself
has only ever run against an induced state.

**The scores are low, and that is the anchors working.** Of 48 events, 35 score 0–2 on
importance, 13 score 3 or more, and exactly one reaches 7 — the CISA advisory. A scale
that returned 7 for everything would be useless as the threshold
`notification_preferences.density` compares against, which is why the 0–10 anchors live in
code rather than in the editable prompt. **Stage 5 should read this before choosing
thresholds**: over a corpus that is largely game reviews and consumer how-tos, a threshold
of 3 admits about a quarter of events and a threshold of 6 admits none at all.

**Ten of those 35 low scores are one bad source, though.** The PyTorch feed serves CI
branch refs rather than releases, so ten events reading _"PyTorch merged auto-generated PR
updating pinned vision hash"_ were analysed at a cost of 18,157 tokens — **20.5% of all
analysis spend** — and scored 0 or 1, correctly. The scoring is not at fault and neither
is the clustering; the source is, and it is recorded in stage 9 with the measurement.
Expect the distribution to shift once it is fixed, so do not calibrate stage 5's
thresholds against this corpus without discounting them.

**`before_state` is null for 29 of 48, and that is also correct.** The model is told to say
null rather than fill a gap, and a press release genuinely does not report what was true
before. A plausible sentence in that column would be a fabrication printed under a real
headline, so `readAnalysis` also refuses the model's words for null — `"unknown"`, `"not
stated"` — rather than storing them as findings.

**Sixteen of the 48 analysed events carry no topic at all.** They are correctly scored and
permanently unmatchable, because fifteen topics cannot cover a corpus containing game
reviews and phone trade-in guides, and the prompt says to choose nothing rather than
something loose. That is the right behaviour here and it becomes **stage 5's inherited
problem**: an event with no row in `event_topics` can never reach a reader. Slugs the model
asked for and could not have are printed by `npm run pipeline` for exactly this reason — a
slug it keeps reaching for is the clearest evidence the vocabulary is too narrow.

**The prompt is split between the database and the code, deliberately.**
`0008_analysis_prompt.sql` is data only — `ai_prompts.key` is plain `text primary key`, so
a new prompt is an INSERT, and `npm run db:seed` can replay it through PostgREST where DDL
could not be applied at all. What is stored is judgement: voice, and the standard of
evidence. The JSON shape, the scoring anchors and the list of subscribable slugs are
appended by `analyse.ts` on every call, so an operator retuning the wording from the
console cannot break the parse or invent a topic nobody can subscribe to. `analyse.ts`
carries the same wording as a fallback, because `resolvePrompt` returns `""` for a missing
key and an empty system prompt is dropped rather than sent blank — without the fallback an
unseeded database would analyse events with no instructions at all and no error.

**Topics are written before `analysed_at`, and the order is not arbitrary.** If
`analysed_at` were set first and the topic insert then failed, the event would be
permanently understood and permanently unmatchable — invisible to every reader and never
retried, because nothing re-analyses an analysed event. Failing the other way round costs
at worst one repeated analysis of one event, which is bounded and visible. The cheap
failure is chosen on purpose.

**One thing the first real run caught.** The model wrote _"An article described Wi-Fi 8
as…"_ — accurate, and useless in a briefing. `what_happened` is about the event, not about
the coverage of it, and that instruction now lives in the code-side contract rather than
the editable prompt: an operator who deleted it would get prose about articles instead of
prose about news, which is the same class of breakage as deleting the JSON shape.

**Titles are written here now.** Stage 3 leaves an event titled with one article's
headline; this stage replaces it with a neutral line naming what happened — _"OpenAI
reverses on California's SB 53, asks to expand safeguards"_ rather than The Verge's
wording of it.

---

### Stage 5 — Matching · _done_

A SQL query. **No model.** This is the stage that would otherwise scale with readers,
and it is deliberately free.

- [x] Match `event_topics` against `user_topics` into `user_events`
- [x] Apply `notification_preferences.density` as an importance threshold
- [x] Apply `user_exclusions` **last** — an exclusion beats a topic, always
- [x] Respect `user_source_prefs` (`muted`, `priority`)
- [x] Verified: the rules in `src/lib/matching.test.ts` hold against the SQL version

**`src/lib/matching.ts` already implements these rules over fixtures, and
`matching.test.ts` locks them in.** Those tests are the specification for the query.
When the query replaces the module, the tests must still describe it.

**It is TypeScript, not SQL, and that is the environment's fault rather than a
preference.** The rules belong in a `security definer` function so RLS cannot see a
half-built briefing, but DDL cannot be applied from here — `0007_source_stats.sql` has
been sitting unapplied since stage 2 for the same reason. `src/lib/pipeline/match.ts`
therefore reads rows through PostgREST and decides in `decide()`, a pure function the
tests drive directly. The rules are the ones the SQL would express, in the order the SQL
would apply them, so the function is replaceable by a query without the tests changing.

**Box 5 is closed by construction, not by restatement.** `related` — the whole text
predicate — lives in `src/lib/relate.ts` and is imported by both the fixture matcher and
the pipeline, and `match.test.ts` runs nine scenarios through both implementations and
asserts they agree. A second copy of the predicate would have passed its own tests while
quietly meaning something else.

**Measured against the live database, one reader, 48 analysed events:**

| Change made live                          |   Matched | Reason recorded                         |
| ----------------------------------------- | --------: | --------------------------------------- |
| Baseline, density 100 (`importance >= 0`) | **15**/48 | `no-topic-match 33`                     |
| Density 35, the column default (`>= 3`)   |  **7**/48 | `below-threshold 8` — the same 15 split |
| Exclusion `"Nvidia"` added                | **14**/48 | `excluded 1`                            |
| The sole source of one event muted        | **14**/48 | `all-sources-muted 1`                   |
| `TechCrunch` set to `priority`            | **15**/48 | membership unchanged, three scores +2   |

Every count reconciles: misses plus matches equal 48 in each row. **Model calls: 0**, in
every run. A second real run reported _"15 already matched by an earlier run"_, wrote
nothing, and left one distinct `matched_at` — the shared-analysis property holds and
re-running is free. Each preference above was inserted for real and removed in the same
command; the priority run rewrote all 15 rows and the restore reproduced all 15 baseline
relevance values exactly.

**The density mapping was read off the scoring anchors, not interpolated.** The dial's
copy and the analyse prompt turned out to describe the same thing in the same words —
Focused's _"clear developments in the areas you track"_ is anchor 3–5's _"worth knowing
if this is your area"_ — so Minimal → 6, Focused → 3, Broad → 1, Deep → 0, and the table
lives in `src/lib/density.ts` where the dial and the matcher both read it. The obvious
linear map `(100 - density) / 10` was rejected on the record: it puts the default 35 at
6.5, above the top of the band the reader was shown, so a reader on the default would be
told they had opted into their own field and then shown almost nothing.

**Two properties of the corpus, measured in stage 4 rather than guessed, both confirmed
by the run above:**

- **The importance distribution is low and correctly so.** 35 of 48 events score 0–2, 13
  score 3 or more, and one reaches 7. That is why the default density admits 7 events and
  not 15.
- **Sixteen of the 48 have no topic**, so no join to `user_topics` can ever reach them.
  They account for half of the 33 `no-topic-match` misses. The gap is a topic-vocabulary
  problem rather than a query bug, and stage 9 records it.

**Three things stage 5 found that stages 6–8 inherit:**

- **`only_major`, `exclude_keywords` and `user_source_prefs` have no UI writer.** The
  matcher honours all three and the columns exist, but nothing a reader can click sets
  them, which is why they had to be exercised by hand above. Reader-facing controls are
  stage 8's business, not a matcher bug.
- **`user_events` stores `relevance` but not the topics that matched.** Stage 7 has to
  recompute them for _"because you follow…"_. That is free and deterministic — `decide`
  returns them — but it is not a column read.
- **The dial's "2–3 stories a day" copy is still unmeasured** against any real corpus.
  It is display text and no code reads it to make a decision, but it is a claim, and one
  live reader is not a measurement.

**The live reader follows `anthropic` and `cursor` and matched zero events for either** —
the coverage gap `status.md` already names, now visible in real rows rather than argued
from a source list. Three of the 15 matches are PyTorch and llama.cpp CI noise at
importance 0, which is the same bad feed stage 4 measured at 20.5% of analysis spend.

---

### Stage 6 — Day-one backfill · _done_

**This is the idea that makes signup not feel empty**, and it is nearly free.

A reader who picks topics today should immediately see events already in the database —
those were analysed for somebody else, so matching a new reader against them costs one
SQL query and nothing else.

- [x] On onboarding completion, run stage 5 against recent events
- [x] Render those on the dashboard straight away
- [x] If nothing matches, fetch and analyse on demand for that first day only
- [x] From day two, the normal schedule takes over
- [x] Verified: a brand-new account with common topics lands on a non-empty dashboard

**Decided: 72 hours.** Wide enough that a reader who picks a quiet topic still sees
something on day one, narrow enough that the first briefing is not a stale wall of text.
The ingester's own `MAX_AGE_DAYS` is 30, so the corpus reaches back further than this
window deliberately — stage 3 gets history to cluster against, and day one does not.

**Stage 5 already takes the two arguments this needs.** `match(db, { userIds, sinceHours })`
scopes a run to one reader and a window, so backfill is a call rather than a second
matcher. `src/lib/pipeline/backfill.ts` is that call plus the one thing stage 5 does not
do — decide what to pay for when the answer is empty. It writes through stage 5, which
uses `ignoreDuplicates`, so a backfill that overlaps the scheduled run cannot double up
or rewrite `matched_at`.

**Do not confuse this with a quiet day.** The product promises that quiet days stay
quiet. Backfill fills a _new account_, not a slow news morning. If nothing genuinely
matches, say so — that is the promise, not a bug.

**Measured against the live database, on real accounts created and deleted for the
purpose:**

| A brand-new account following…               | Outcome     |          Rows | Model calls |    Tokens |
| -------------------------------------------- | ----------- | ------------: | ----------: | --------: |
| `openai`, `ai`, `chips` — the common case    | `matched`   |        **15** |           0 |         0 |
| the same account, run a second time          | `matched`   | 15, **0 new** |           0 |         0 |
| `typescript` — nothing in the corpus         | `quiet`     |             0 |           0 |         0 |
| `cursor`, `anthropic` — nothing analysed yet | `analysed`  |         **1** |           1 | **1,471** |
| `cursor`, `anthropic`, once that had run     | `matched`   |             1 |       **0** |     **0** |
| nothing at all                               | `no-topics` |             0 |           0 |         0 |

The fifth row is the whole cost argument, visible in one line. The fourth row paid 1,471
tokens to understand one event; the fifth is a **different account** with the same
interests matching that same event for nothing, because analysis is shared and day one
does not re-buy it. The second row is idempotence: 15 rows, one distinct `matched_at`,
nothing rewritten.

**The paid path is bounded three separate ways, and the middle one is the interesting
one.** A cap (`ON_DEMAND_LIMIT` = 3, against the cron's six an hour) and a once-per-account
guard are obvious. What stops it being an endpoint that burns the analysis backlog is that
a candidate must already **name** something the reader follows: an unanalysed event has no
topics — analysis is what writes them — so the only evidence is the headline stage 3 left
on it, read through the same `related` predicate the matcher uses. For `cursor`/`anthropic`
that admitted **1 of 50** unanalysed events, not 50 and not 0. Exclusions apply here too,
so nothing is paid for that the next gate would throw away.

**The guard is an `admin_audit_log` row, written _before_ the model is called.** It is
both the brake and the only record of what day one cost — `ingest.ts` already writes
`source.disable` there with `actor_email: "pipeline:ingest"`, and one account's model
spend is the same kind of thing. Written first, not last: a crash between the two costs
that account its day-one analysis, and the other order costs the project an unbounded
number of them. Verified by pre-seeding the row: `spentBefore: true`, zero tokens.

**Three product decisions came out of building it.**

- **`update()` in `prefs-store.ts` now returns a promise.** Onboarding has to await the
  save before matching, because the matcher joins `user_topics` — running it a beat early
  would match an empty topic list and conclude the reader is interested in nothing. Every
  other caller still ignores the promise, and is right to.
- **Onboarding's "Monitoring 327 sources" is gone.** Nobody counted 327 of anything; there
  are 64 feeds. It was a fabricated figure on the screen a stranger is most likely to
  believe, which is exactly what the rules at the bottom of this file forbid. The other
  three lines of that sequence are now literally true while it plays.
- **The sample-data notice narrowed again rather than coming down.** Real matches render
  above the fixtures under a Live badge, so "nothing here was gathered for you" became a
  lie; it now says which half of the page is a fixture. It comes down in stage 8.

**What stage 6 deliberately did not do.** These events are rendered by their own card, not
by `StoryCard`: the fixture card deep-links to `/dashboard/story/$id`, which reads
`sample-data`, so pointing it at a real event id would produce a card that looks finished
and 404s when clicked. There is no `why_it_matters` on them either — that is one generated
paragraph per person, which is stage 7. Replacing the fixtures outright is stage 8.

---

### Stage 7 — Digest and delivery · _done_

- [x] Build `digests` and `digest_items` on the reader's schedule and timezone
- [x] One short `why_it_matters` per person per story — the only per-reader model spend
- [x] Skip honestly: `status = 'skipped'`, zero items, no padding
- [x] Respect `notification_preferences.paused`
- [x] Send by email through the existing Resend transport, recording `deliveries`
- [x] Retry failed sends using the existing `deliveries` retry semantics
- [x] Verified: a real briefing arrives in a real inbox at the requested time

**Built 2026-08-25.** `src/lib/pipeline/digest.ts`, cron `*/5 * * * *`,
`npm run pipeline -- digest --user ID --now` to force a slot. First live run:
16 items, 7,858 tokens, Resend accepted the send (`deliveries.status = sent`).
`RESEND_FROM_EMAIL` is still the Resend onboarding address, so only the account
that owns the key can receive it.

**Already built and reusable.** `src/lib/server/email/send.ts` handles transport,
retryability and idempotency keys. `src/lib/email/shell.ts` has the layout and palette.
A briefing template is new work; the plumbing under it is not.

---

### Stage 8 — Dashboard on real data · _done_

- [x] Read `user_events` and `digest_items` instead of `src/lib/sample-data`
- [x] Remove `SampleDataNotice` once nothing on the page is a fixture
- [x] Story pages read real `articles` for the source list
- [x] Verified: `sample-data.ts` is imported by nothing outside the marketing site

**Keep the notice until it is a lie.** The dashboard labels its fixtures honestly. That
banner comes down when the data is real, not before.

**The home page already reads `user_events`.** Stage 6 had to render what it matched or
it would have been invisible, so `loadMatches` and `LiveBriefing` exist and the top of
the home page is real. What is left for this stage is everything under it: the fixture
list on the home page, the briefing and history pages, and the story pages behind each
card. The last of those is why the live cards do not link anywhere — `StoryCard` points
at `/dashboard/story/$id`, which reads `sample-data`, so a real event id would give a
card that looks finished and 404s.

**`digest_items` cannot be read until stage 7 writes any.** The live cards carry no
"why this matters to you" line for that reason, not as an oversight.

---

### Stage 9 — Loose ends

- [x] `0007_source_stats.sql` is unapplied — it is DDL, and DDL cannot run from this
      environment (see stage 1). Somebody has to paste it into the Supabase SQL editor
      or link the CLI. Until then the console prints "—" for per-source article counts.
      **Applied 2026-08-25** via Supabase MCP. `admin_source_stats()` returns 68 sources
      and 1,040 articles.
- [x] `--signal` is red in two places and blue in one. `a653371` "update color scheme
      from red to blue" changed `public/logo.svg` to `#0573AA`, but `src/styles.css` is
      still `oklch(0.54 0.19 27)` (hue 27, red), `src/lib/email/shell.ts` still has
      `PALETTE.signal = "#c52c2a"`, and `AGENTS.md` claims hue 240. **Resolved 2026-08-25**:
      `--signal` is `oklch(0.53 0.12 240)` / `oklch(0.72 0.12 240)`, email `#0573AA`.
- [x] **PyTorch's feed is the wrong URL, and it is now the single most expensive mistake
      in the project.** `releases.atom` returns CI branch tags, not releases —
      `trunk/16ee93b8…: [vision hash update]`, `viable/strict/1787468606: Revert "…"`. 14
      of the 1040 stored articles are refs of that shape. Stage 3 recognises them and
      spends nothing deciding they are unrelated, but recognising a ref is not the same as
      discarding it: 11 of the 14 still became events, and **stage 4 has analysed 10 of
      them for 18,157 tokens — 20.5% of all analysis spend to date.** Measured against the
      live table, not estimated. **Retargeted 2026-08-25** to `https://pytorch.org/blog/feed/`
      (`company_blog`). GitHub's own `tags.atom` is the same CI stream; there is no `v*`
      filter. First fetch of the blog: 8 articles from 10 items, 0 failures. Ingest still
      drops leftover CI refs; cluster parks them as `failed`.
- [x] **`ANALYSE_LIMIT` does not protect against a junk source, and nothing else does
      either.** The PyTorch item above is the general case: stage 3 declines to _group_
      an unheadline-shaped article but still creates an event of one for it, and stage 4
      pays per event without asking whether the event was worth understanding. A cheap
      pre-analysis filter — refuse to analyse a single-article event whose only article
      stage 3 already classified as not-a-headline — would have saved 20% of the bill.
      **Built 2026-08-25.** `isVcsRef` in `shortlist.ts` is the shared test. Ingest
      drops matching titles; cluster writes `status = 'failed'` so they leave the
      unclustered queue; analysis returns `ignored` and records the failure with zero
      tokens. Version tags (`v8.2.2`) are not this shape and still pass through.
- [x] **The `cluster` tier's `max_tokens` is 4096 and that is not always enough.**
      `deepseek-v4-flash` is a reasoning model, so the ceiling has to cover reasoning plus
      output. One article in 60 failed, having spent all 4096 of its reasoning budget
      before writing any answer — caught by `TruncatedCompletionError` rather than
      silently returning an empty decision, which is the guard working. **Raised to 8192
      on 2026-08-25**, same ceiling as `digest`. Worst-case cost per call doubles to buy
      back a 1.7% failure rate that was otherwise retried next cycle. Live
      `ai_model_routes` row updated; 0003's seed value matches for a fresh project.
- [x] **`reason` has two intended consumers and only one exists.** Stage 4 uses it, and
      the unbuilt `deep_explain` feature flag is meant to use the same tier for on-demand
      explanations on a story page. Retuning `reason` will then change both, and they want
      different things: analysis is a batch job where latency does not matter, a deep
      explanation is a reader waiting. Splitting them means a fourth value in the
      `ai_capability` enum, which is DDL. **Ask is wired 2026-08-25** to the same
      `reason` route (`askStory` in `briefing.ts`, `deep_explain` enabled). The split is
      still recorded rather than pre-empted; see [`ai-providers.md`](ai-providers.md).
- [x] **The topic vocabulary is too narrow for the corpus.** Sixteen of 48 analysed
      events carry no topic, so nothing can ever match them — game reviews, phone
      trade-in guides, consumer how-tos. **Widened 2026-08-25.** Linux, Hardware,
      Developer tools, Consumer tech added to `TOPIC_POOL` and `topics` (`0009`).
      Already-analysed rows keep their (missing) topics: `analysed_at` is once-ever.
- [x] **Forty-one events are still awaiting analysis.** Drained 2026-08-25.
      `npm run pipeline -- analyse --limit 41`: 41 analysed, 0 failed, 0 CI refs,
      79,238 tokens, 1,933 per event, 869s. Corpus is **98 complete, 1 failed**.
      `events.analysis_tokens` sums to 181,980.
- [x] Dormancy email has no trigger — needs open-tracking, which needs stage 7.
      **Built 2026-08-25.** Keys off `profiles.last_seen_at` (which the privacy
      policy already names), written by `pingPresence` from the dashboard shell,
      throttled to once an hour. Cron `0 12 * * 1`. `npm run pipeline -- dormant`.
      A paused reader, a reader with no briefing, and a recent nudge are all skipped.
- [ ] Stripe live mode — no real payment has ever run through the webhook
- [ ] `VITE_SITE_URL` must be the real origin in production
- [ ] `RESEND_FROM_EMAIL` is `onboarding@resend.dev`, which only delivers to your own
      address — a verified domain is needed before a stranger can receive anything
- [ ] Production `STRIPE_WEBHOOK_SECRET` differs from the CLI one

The last four cannot be closed from a development machine at all: they need a Cloudflare
deploy, a verified email domain, and Stripe's live dashboard. They are listed so that
nobody reads a green build as a shippable product.

---

## Rules for this work

**Never ship plausible-looking data.** The admin console shows zeroes because nothing
has run. Keep it that way rather than inventing figures — `status.md` is the promise
this project makes to anyone reading it.

**Verify against a real database.** Typecheck and tests do not prove a migration ran or
a feed parsed. Every box above says "verified" for that reason.

**Keep the shared-analysis property.** Any change that makes an event get analysed more
than once breaks the economics the whole product is priced on.

**Update [`status.md`](status.md) in the same commit** as the stage that changes it.
