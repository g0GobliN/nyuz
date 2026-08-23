# Project status

Last reviewed: 24 August 2026.

nyuz is **in development and not accepting customers.** This page is the honest,
itemised version of that sentence.

It exists because the app looks considerably more finished than it is. The marketing
site, the accounts, the admin console and the blog are genuinely working software. As of
this review the ingester is too — there are real articles in the database — those
articles are grouped into real events, those events have been read and scored by a
second model call, those scores have been matched against a real reader's topics, and a
new account is matched against the existing corpus the moment it finishes onboarding — so
the top of the dashboard is now real news rather than a fixture. The thing the product is
actually for — a briefing **delivered** — is still not built: no digest has been generated
and no reader has been sent anything. Everything below the Live badge on the dashboard is
still sample data, and says so. Anyone forming a judgement from the screenshots alone will
be wrong in one direction or the other.

---

## Summary

| Area                                                   | State                                        |
| ------------------------------------------------------ | -------------------------------------------- |
| Marketing site (landing, pricing, how-it-works, legal) | **Built**                                    |
| Editable site content + feature flags                  | **Built**                                    |
| Accounts, sign-in, OAuth                               | **Built**                                    |
| Admin console (analytics, users, bans, roles, audit)   | **Built**                                    |
| Blog (authoring + public pages)                        | **Built**                                    |
| AI provider routing configuration                      | **Built** — two stages route through it      |
| Billing (checkout, portal, webhook)                    | **Built** (test mode; unproven against live) |
| Lifecycle email (account, billing, pause)              | **Built** (dormancy nudge has no trigger)    |
| Onboarding flow                                        | **Built**, persisted to the account          |
| Source list (64 live feeds)                            | **Built**                                    |
| Ingestion pipeline                                     | **Built** — 1040 articles stored             |
| Clustering (articles → events)                         | **Built** — 112 articles in 98 events        |
| Analysis and scoring (events → understood)             | **Built** — 48 of 98 events analysed         |
| Matching (events → readers)                            | **Built** — 16 rows in `user_events`, free   |
| Day-one backfill for a new account                     | **Built** — one query; pays only if empty    |
| Digest generation and delivery                         | **Designed, not built**                      |
| Customer dashboard                                     | **Part real** — live matches over fixtures   |

---

## What is genuinely working

**Accounts.** Supabase auth, email/password plus Google and GitHub. Signing up creates a
profile, a subscription row, notification preferences and a role row via a database
trigger.

**The admin console** at `/admin`. Real queries against real tables: user list with
search and filtering, role management, bans enforced through the Supabase Admin API,
blog authoring, feature flags, editable site content, an append-only audit log, and
analytics that count rows in Postgres rather than estimating. See
[admin-console.md](admin-console.md).

**The marketing site.** Landing, pricing, how-it-works and eight legal pages. The
headline, hero copy, prices, section order, section visibility and image slots are all
editable from the console without a deploy — see [site-content.md](site-content.md).

**The blog.** Markdown authoring in the console, scheduled publishing that goes live
without a job running, public index and post pages, view counting.

**AI provider configuration.** Which provider and model serves each of the three
capability tiers is a database row, not code. Adding a provider is a row plus a secret.
**As of this review it is load-bearing**: the clustering stage resolves its model through
it on every call, so changing the `cluster` tier in the console changes what the pipeline
spends money on, with no deploy. See [ai-providers.md](ai-providers.md).

One fix came out of first use. `resolveRoute` built its Supabase client with no argument,
which works on a development machine and cannot work on Cloudflare, where there is no
`process.env`. The read would have failed, every tier would have silently fallen back to
environment variables, and the console's AI tab would have been decorative in exactly the
place it exists for. The Worker's env bag is now passed through.

**Ingestion.** 64 active feeds are fetched on a Cloudflare Cron Trigger every fifteen
minutes, parsed without any Node built-ins, canonicalised, and inserted into `articles`.
**1040 articles are stored** as of this review. Re-reading a feed inserts nothing —
`articles.url` is unique and the insert ignores duplicates — and a publisher who rewrites
a live headline updates the stored row instead. Feeds that fail are counted, backed off on
a widening schedule, and switched off after eight consecutive failures with an audit-log
row naming the reason. Verified against the live database, including the failure path and
the disable; see [plan.md](plan.md#stage-2--ingestion--done) for the figures and for the
one claim that could not be verified without a deploy.

**Clustering.** Articles that report the same occurrence are grouped into one row in
`events`. **112 articles sit in 98 events** as of this review, with 928 still unclustered —
the first rows anything in this project has written to that table, and the first money it
has spent.

Two real duplicate-coverage pairs were used to verify it, both found in the live corpus
rather than constructed: TechCrunch's and The Verge's separate write-ups of OpenAI's
letter about California's AI safety bill became one event, and two articles about the
Nvidia–Cloverleaf data-centre deal became another. The negative case came free with the
first: an unrelated article about a floating nuclear reactor in California was on that
same shortlist and was correctly left out.

It is cheap by construction, and the construction is the interesting part. Candidates
come from a trigram index that already existed — a GIN `gin_trgm_ops` index on
`articles.title` turns the `ilike` filters PostgREST emits into an index scan — so the
model is only ever shown ten titles, never the corpus. **Around 610 tokens per article**
over real batches, and roughly one article in twelve is decided for nothing at all
because its title is a version tag or a CI ref rather than a headline.

Articles are processed one at a time on purpose. The shortlist reads the column the write
updates, so a burst of coverage converges on one event with no bookkeeping; running the
batch concurrently would have every worker create its own event for the same story, and
the analysis stage would then pay for that story once per outlet. Clustering has its own
schedule, `10,40 * * * *`, offset from ingestion so it runs on coverage that has finished
arriving. Verified through the built Worker, not just the source. See
[plan.md](plan.md#stage-3--clustering--done).

**Analysis.** Each event is read once, ever, and what comes out is a neutral title, a
plain-past-tense account of what happened, the before and after state where the coverage
supports them, scores for importance and novelty, and links into the shared `topics`
table. **49 of the 98 events are analysed** as of this review, for **90,066 tokens** —
about 1,840 per event on average — with **no failures**. `event_topics` has 46 rows, the first
this project has written to a table stage 5 depends on.

The property the pricing rests on is that this happens **once per event forever**, and it
was verified three ways rather than asserted. Asking for an analysed event by name is
refused and costs nothing. Two workers started together on the same event produced one
analysis and one `held` — the claim is a conditional update, so Postgres picks the winner.
And the live corpus produced the real case on its own: an event was analysed at 10:18:33,
a third outlet's coverage was attached to it four minutes later, and its `analysed_at` and
`analysis_tokens` did not move. Verified through the built Worker as well as from a
laptop; see [plan.md](plan.md#stage-4--analysis--done).

Two things about the output are worth knowing before reading the numbers. Scores are low
on purpose — 35 of 48 events score 0–2 for importance and exactly one reaches 7 — because
a scale that answers 7 for everything cannot serve as the threshold density compares
against. And `before_state` is null for 29 of 48, because the model is told to answer
null rather than fill a gap; a plausible sentence there would be a fabrication printed
under a real headline.

**Matching.** `user_events` has rows for the first time: **15 of the 48 analysed events**
matched the one live reader, for **zero model calls**. This is the stage that would
otherwise scale with readers, so it calls nothing, resolves no AI route, and is set
arithmetic over rows that already exist. Re-running it is free and writes nothing — a
second run reported all 15 already matched and left one distinct `matched_at`.

Each rule was exercised against the live database by changing a real preference and
putting it back: at the default density the same 15 events split into 7 admitted and 8
below the threshold; an added exclusion vetoed exactly one story while leaving the topic
that selected it intact; muting an event's only source dropped exactly that event; and
marking a source `priority` reordered the briefing without changing what was in it. Misses
plus matches reconcile to 48 in every run. Details and figures in
[plan.md](plan.md#stage-5--matching--done).

Three limits worth stating plainly. **The density dial's story counts are the dial's
claim, not a measurement** — no code reads them to make a decision, but nothing has
checked "2–3 stories a day" against a real corpus either. **Three of the reader's 15
matches are CI noise** at importance 0 from the PyTorch and llama.cpp feeds, correctly
scored and correctly matched, which is a source problem rather than a matcher one. And
**the reader follows `anthropic` and `cursor` and matched nothing for either** — the
coverage gap below, now visible in real rows rather than argued from a source list.

**Day one.** A new account no longer waits for a cron. Finishing onboarding runs the
matcher for that reader over the last 72 hours, which costs one query because those events
were analysed for somebody else — and the dashboard renders what it found, above the
fixtures, under a Live badge. Verified on real accounts created and deleted for the
purpose: a brand-new account following `openai`, `ai` and `chips` landed on **15 real
events for zero model calls**, and running it again wrote nothing.

If nothing matches, and only then, it may analyse up to three events on demand — but only
events whose headline already names something the reader follows, and only once per
account ever, guarded by an `admin_audit_log` row written before the model is called. That
path was exercised for real: a reader following `cursor` and `anthropic` matched nothing,
one of 50 unanalysed events was judged worth understanding, it cost **1,471 tokens**, and
the reader landed on a dashboard with one real story. **A second account with the same
interests then matched that same event for nothing** — the shared-analysis property doing
exactly what the pricing assumes, on the one path that could have broken it.

A reader whose topics genuinely match nothing still gets an empty dashboard that says so.
That is the promise, not a bug, and nothing here loosens a threshold to fill the space.

`npm run pipeline` still runs ingestion only. A stage that spends money has to be asked
for by name — `match` does not spend, and has no small default for that reason.
`backfill` can, so it refuses to run without `--user` and takes a `--free` flag that
switches the paid half off entirely.

---

## What is a prototype

**The customer dashboard, below the first block.** The top of the home page is real: it
reads `user_events` and renders the reader's own matched events. Everything under it still
comes from `src/lib/sample-data.ts` — six fixtures — as do the briefing, history and story
pages in full. The missing piece is no longer matching; it is `digest_items`, the one
paragraph per person that says why a story matters to that reader, and the briefing built
from it.

Two things were done so that this is not misleading:

1. **A "Sample data" notice** on the dashboard and briefing pages, saying plainly that
   the stories are examples and nothing was gathered for the reader. Its wording was
   revised twice, each time narrowing rather than widening: it used to claim collection
   was not running, then that nothing on the page had been gathered for the reader. Both
   became untrue in turn. It now says which half of the page is a fixture — the half below
   it. Grep `SampleDataNotice`; it comes down when nothing on these pages is invented.

2. **The fixtures are matched against the reader's real topics** by
   `src/lib/matching.ts`. Previously all six stories were shown to everyone with a
   hard-coded caption claiming what the reader followed, so someone who onboarded asking
   for singing was told "You follow chips and AI infrastructure". Now a reader whose
   interests match nothing sees an honest empty state.

That second point is worth being precise about: it makes the _relationship_ between
stated interests and displayed stories honest. It does not make the stories real.

**The Pipeline page** at `/dashboard/admin`. Queue depths and funnel volumes are fixture
figures from a local set. The business metrics on its economics tab are deliberately left
empty rather than filled with plausible numbers.

---

## What is not built

**Everything between a matched event and a reader's inbox.** Collection, grouping,
analysis and matching work; delivery does not. `digests`, `digest_items` and `deliveries`
have never had a row written to them by anything. The DeepSeek client is called for
clustering, for analysis, and — at most once per account, only when a new reader would
otherwise see nothing — for the day-one backfill. Nothing calls it per reader, and nothing
calls it on a recurring basis for one.

The stages, in the order they need building:

1. ~~**Collect** — fetch feeds on a schedule, record failures, back off dead sources.~~
   Built and verified, 23 August 2026.
2. ~~**Normalise** — canonicalise URLs, hash, drop exact duplicates.~~ Built, with one
   correction: a hash over URL plus title cannot find a duplicate, because the URL is
   already unique. Duplicate _reporting_ of one event is stage 3's job. What the hash does
   catch is a publisher rewriting a headline on a story already stored.
3. ~~**Cluster** — trigram shortlist in Postgres, then one model call to confirm.~~ Built
   and verified, 23 August 2026. 112 of 1040 articles are grouped so far; the remaining
   928 are a backlog the schedule works through, or a deliberate
   `npm run pipeline -- cluster --limit N`.
4. ~~**Understand** — one analysis pass per event; importance, novelty, before/after.~~
   Built and verified, 23 August 2026. 49 of 98 events analysed, 49 waiting with
   `analysed_at` null; the schedule takes six an hour, and
   `npm run pipeline -- analyse --limit N` drains the rest deliberately.
5. ~~**Match** — deterministic SQL against topics, keywords, exclusions and density.~~
   Built and verified, 23 August 2026. 16 rows in `user_events`, zero model calls. The
   day-one path that runs the same code for a brand-new account was verified 24 August.
6. **Generate and deliver** — one paragraph per person per story, then send. **Next**, and
   the first stage whose cost is per reader rather than per event.

**The project has now spent money on both of the stages that ever will share it.**
Clustering costs roughly 610 tokens per article; analysis costs roughly 1,846 tokens per
event, once. `events.analysis_tokens` holds **90,066 across 49 rows** — the number the
whole cost argument gets audited against, and the reason it is stored on the event rather
than summed from a log. A single figure there that ever doubled would mean an event had
been understood twice, which is the one failure this design cannot absorb.

**Billing.** Stripe checkout, the billing portal and the webhook are wired.
`subscriptions.plan` is written by `customer.subscription.*` events, and the price of every
incoming event is matched against the nyuz catalogue first — the Stripe account is shared
with another product, so an unmatched price is ignored rather than trusted. It has been
exercised in test mode only. **No live payment has ever run through it.**

**Delivery.** _Briefing_ delivery does not exist — no Telegram, no WhatsApp, and no
briefing email. The `deliveries` table and its retry semantics are still designed and
unused.

_Lifecycle_ email is a different thing and does work: welcome, subscription started,
cancelled, payment failed and briefings-paused all send through Resend. The dormant-reader
nudge is written and tested but has no caller, because nothing tracks whether a briefing
was opened.

---

## Known gaps and rough edges

**Coverage does not match the interest picker.** `TOPIC_POOL` offers fifteen topics and
all fifteen are technology, but onboarding accepts any free-text topic. So the interface
implies coverage the product does not have. Either narrow onboarding to state that
coverage is technology, or broaden sourcing. This is a product decision, not a bug to fix
in code — and it is now live rather than hypothetical, because the 64 feeds being fetched
are all technology feeds.

**Anthropic has no primary source.** It is in `TOPIC_POOL`, and the company publishes no
feed at any conventional path any more, so an Anthropic announcement will only ever arrive
as somebody else's coverage of it. Named here because a reader who picks that topic is
entitled to know.

**`0007_source_stats.sql` has not been applied.** It creates a SQL function, and DDL
cannot be run from a development machine here: there is no database password, no
`SUPABASE_ACCESS_TOKEN` and no `supabase/config.toml`, so `supabase db push` will not run
and PostgREST cannot execute DDL. Until somebody pastes it into the Supabase SQL editor,
the console's source list prints "—" for per-source article counts, which it explains on
the page rather than showing a zero.

**PyTorch's feed is the wrong URL, and it has already cost a fifth of the analysis bill.**
The source points at `releases.atom`, which for that repository returns
continuous-integration branch tags rather than releases — `trunk/16ee93b8…: [vision hash
update]`, `viable/strict/1787468606: Revert "…"`. **14 of the 1040 stored articles are refs
of that shape.** Clustering recognises them and spends nothing deciding that unrelated
commits are unrelated — but recognising a ref is not discarding it. 11 of the 14 still
became events, and **analysis has read 10 of them at a cost of 18,157 tokens, 20.5% of all
analysis spend to date**, measured against the live table. Each scored importance 0 or 1,
so matching will keep them away from readers; the money went before any threshold could
apply. Fixing it means pointing the source at a tag feed filtered to releases, or dropping
the source — a coverage decision rather than a bug, but a metered one.

**The cron's per-run limit assumes a paid Cloudflare plan.** A Worker invocation may make
50 subrequests on the free plan and 1000 on paid; `SCHEDULED_LIMIT` is 24 sources, which
is roughly 120 subrequests. **On the free plan this must come down**, and it is the only
one of the three that must: there are now three triggers — ingestion every fifteen
minutes, clustering at `10,40`, analysis at `20,50` — and the two model stages are
bounded by money and wall-clock rather than by subrequests. Clustering does 12 articles a
run and analysis 6 events, roughly 35 subrequests, and neither tries to drain its backlog
unattended.

**Fifteen topics cannot cover what the sources publish.** Sixteen of the 49 analysed
events carry no topic at all — game reviews, phone trade-in guides, consumer how-tos —
because analysis is told to choose nothing rather than something loose. Those events are
correctly scored and permanently unmatchable: with no row in `event_topics` there is
nothing for a reader's topics to join against. Either the vocabulary grows or some of
these are the wrong sources; both are product decisions, and matching will make the
consequence visible rather than fix it.

**The day-one path draws from the same analysis backlog.** When a new account
matches nothing, the on-demand pass analyses up to three events — from the 49 still
awaiting analysis, not from anywhere new. It is capped, once per account, and restricted
to events whose headline already names something that reader follows, so it cannot drain
the backlog; but the money comes out of the same pocket, and the `admin_audit_log` rows
with action `backfill.analyse` are where to look for what it has spent.

**`--signal` is two different colours.** `public/logo.svg` is blue, `src/styles.css` is
red (hue 27), `src/lib/email/shell.ts` is `#c52c2a`, and `AGENTS.md` claims hue 240. This
needs settling before the first briefing email is built, or it will go out in whichever
colour the template happened to inherit.

**Onboarding preferences reach the account.** `user_topics`, `user_exclusions` and
`notification_preferences` are all written; `localStorage` under `nyuz.prefs.v2` is now a
cache in front of the account rather than the store of record. Noted because earlier
versions of this page said otherwise.

**Legal documents are unreviewed drafts.** `src/routes/legal/$doc.tsx` contains eight
policies with an `ENTITY` constant holding four placeholders. They describe what the
system genuinely does, which is the part a template cannot supply, but they have not been
seen by a lawyer.

**The licence has placeholders too.** `LICENSE` names `[Company legal name]`. A
copyright notice naming nobody is hard to enforce.

**`react-refresh/only-export-components` warnings.** Eighteen of them, all in files that
export both a component and a helper. They affect hot-reload granularity in development
and nothing else. Left alone deliberately; splitting those files to satisfy the rule
would scatter closely-related code for no runtime benefit.

---

## Checks that must stay green

CI runs all four on every push and pull request — see
[development.md](development.md#continuous-integration).

```
npm run typecheck   # tsc --noEmit, with noUncheckedIndexedAccess on
npm run lint        # eslint, currently 0 errors / 18 warnings
npm run test        # vitest, 245 tests across 15 files
npm run build       # vite + nitro, Cloudflare Workers target
```

None of the four prove the pipeline works. A green build says the code compiles; it says
nothing about whether a migration ran or a feed parsed. That is what the operator scripts
are for — `npm run db:status`, `npm run check:feeds`, `npm run pipeline` and
`npm run cron:test` all talk to the real project, and their output is what the figures on
this page come from.
