# Build plan — making nyuz actually work

The shell around the product is finished. The product is not.

This file tracks the one remaining piece of work that matters: turning a dashboard
of labelled fixtures into a briefing built from real news. It is written to be
resumable — anyone picking this up cold should be able to read the current stage,
see what is already true, and continue without re-deriving the design.

> **Update this file as you go.** Tick a box only when the thing is built _and_
> verified against a real database, not when the code compiles.

---

## Where things stand

**Working today.** Marketing site, accounts and OAuth, admin console, blog, editable
site content, Stripe checkout and webhook (test mode), lifecycle email via Resend,
reader preferences persisted to Postgres, a feed ingester filling `articles` on a
schedule, and — as of the most recent work — a clustering stage grouping those articles
into `events`.

**Not working today.** Everything between an event and a reader.

| Reality check                            | Answer                                           |
| ---------------------------------------- | ------------------------------------------------ |
| Do readers get real news?                | No. The dashboard renders `src/lib/sample-data`. |
| Does anything call a language model?     | Yes — clustering, and nothing else.              |
| Are there articles stored?               | Yes — 1017, from 64 live feeds.                  |
| Are there events?                        | Yes — 38, holding 41 articles. 976 unclustered.  |
| Has anything been analysed?              | No. All 38 events are `pending`, 0 tokens spent. |
| Can a new reader be matched to anything? | No. Matching needs `event_topics`, still empty.  |

The tables all exist from `0001` with row-level security already written. `articles` is
genuinely full and `events` is genuinely being written to; everything downstream of
`events` is genuinely empty.

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
DDL rather than applying half of it. **`0007_source_stats.sql` is therefore still
unapplied** — it creates a SQL function. Until somebody runs it, `listSources()`
degrades to null counts and the console prints "—" for article counts, which it says
on the page.

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
left it out. Seven candidates shown, one matched. **41 articles now sit in 38
events**, none analysed, `analysis_tokens` still zero.

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

### Stage 4 — Analysis · _next_

One pass per event, ever. **Second and last shared model cost.**

- [ ] Extract `what_happened`, `before_state`, `after_state`
- [ ] Score `importance` and `novelty`, 0–10
- [ ] Link `event_topics` against the shared `topics` table
- [ ] Record spend in `events.analysis_tokens`
- [ ] Set `analysed_at`; never re-analyse an event that has it
- [ ] Verified: forty more articles about a known event add zero token spend

**The whole cost argument lives here.** If an event is ever analysed twice, the product
scales with articles instead of events. `analysis_tokens` is recorded once, on the
event, precisely so this is auditable.

**There are 38 real events waiting**, all `status = 'pending'` with `analysed_at` null
and `analysis_tokens` zero, so the verification box has a genuine corpus. Stage 3
deliberately does not clear `analysed_at` when new coverage joins an event, which is
half of that box already: the other half is that this stage must filter on
`analysed_at is null` rather than on status.

**Every event's `title` is currently one article's headline** — stage 3 leaves it as a
placeholder rather than inventing a neutral one. Writing a real title belongs here.

---

### Stage 5 — Matching · _not started_

A SQL query. **No model.** This is the stage that would otherwise scale with readers,
and it is deliberately free.

- [ ] Match `event_topics` against `user_topics` into `user_events`
- [ ] Apply `notification_preferences.density` as an importance threshold
- [ ] Apply `user_exclusions` **last** — an exclusion beats a topic, always
- [ ] Respect `user_source_prefs` (`muted`, `priority`)
- [ ] Verified: the rules in `src/lib/matching.test.ts` hold against the SQL version

**`src/lib/matching.ts` already implements these rules over fixtures, and
`matching.test.ts` locks them in.** Those tests are the specification for the query.
When the query replaces the module, the tests must still describe it.

---

### Stage 6 — Day-one backfill · _not started_

**This is the idea that makes signup not feel empty**, and it is nearly free.

A reader who picks topics today should immediately see events already in the database —
those were analysed for somebody else, so matching a new reader against them costs one
SQL query and nothing else.

- [ ] On onboarding completion, run stage 5 against recent events
- [ ] Render those on the dashboard straight away
- [ ] If nothing matches, fetch and analyse on demand for that first day only
- [ ] From day two, the normal schedule takes over
- [ ] Verified: a brand-new account with common topics lands on a non-empty dashboard

**Decided: 72 hours.** Wide enough that a reader who picks a quiet topic still sees
something on day one, narrow enough that the first briefing is not a stale wall of text.
The ingester's own `MAX_AGE_DAYS` is 30, so the corpus reaches back further than this
window deliberately — stage 3 gets history to cluster against, and day one does not.

**Do not confuse this with a quiet day.** The product promises that quiet days stay
quiet. Backfill fills a _new account_, not a slow news morning. If nothing genuinely
matches, say so — that is the promise, not a bug.

---

### Stage 7 — Digest and delivery · _not started_

- [ ] Build `digests` and `digest_items` on the reader's schedule and timezone
- [ ] One short `why_it_matters` per person per story — the only per-reader model spend
- [ ] Skip honestly: `status = 'skipped'`, zero items, no padding
- [ ] Respect `notification_preferences.paused`
- [ ] Send by email through the existing Resend transport, recording `deliveries`
- [ ] Retry failed sends using the existing `deliveries` retry semantics
- [ ] Verified: a real briefing arrives in a real inbox at the requested time

**Already built and reusable.** `src/lib/server/email/send.ts` handles transport,
retryability and idempotency keys. `src/lib/email/shell.ts` has the layout and palette.
A briefing template is new work; the plumbing under it is not.

---

### Stage 8 — Dashboard on real data · _not started_

- [ ] Read `user_events` and `digest_items` instead of `src/lib/sample-data`
- [ ] Remove `SampleDataNotice` once nothing on the page is a fixture
- [ ] Story pages read real `articles` for the source list
- [ ] Verified: `sample-data.ts` is imported by nothing outside the marketing site

**Keep the notice until it is a lie.** The dashboard currently labels its fixtures
honestly. That banner comes down when the data is real, not before.

---

### Stage 9 — Loose ends

- [ ] `0007_source_stats.sql` is unapplied — it is DDL, and DDL cannot run from this
      environment (see stage 1). Somebody has to paste it into the Supabase SQL editor
      or link the CLI. Until then the console prints "—" for per-source article counts.
- [ ] `--signal` is red in two places and blue in one. `a653371` "update color scheme
      from red to blue" changed `public/logo.svg` to `#0573AA`, but `src/styles.css` is
      still `oklch(0.54 0.19 27)` (hue 27, red), `src/lib/email/shell.ts` still has
      `PALETTE.signal = "#c52c2a"`, and `AGENTS.md` claims hue 240. **Resolve before
      stage 7**, or the first real briefing email goes out in the wrong colour.
- [ ] **PyTorch's feed is the wrong URL.** `releases.atom` returns CI branch tags, not
      releases — `trunk/16ee93b8…: [vision hash update]`, `viable/strict/1787468606:
    Revert "…"`. Eleven of the 1017 stored articles are refs of that shape. Stage 3
      now recognises them and spends nothing on them, but they are still stored, and
      they will still reach a reader as an event of one if stage 4 scores them. Either
      point the source at `tags.atom` filtered to `v*`, or drop the source. A source
      decision, so it is a human's.
- [ ] Dormancy email has no trigger — needs open-tracking, which needs stage 7
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
