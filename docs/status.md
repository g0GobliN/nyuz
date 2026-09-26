# Project status

Repository behavior reviewed 26 September 2026. Live database counts and payment/provider configuration below are historical snapshots from August 2026 and were not rechecked during this remediation.

Real growth happened in the gap: the source list and topic vocabulary both expanded
well past technology into general news. One `subscriptions` row shows
`plan = 'omni', status = 'active'` with **no Stripe customer or subscription id** —
checked directly, not assumed — so it did not come through checkout. Not a paying
customer; "zero paying customers" below still holds.

**A security fix landed on 30 August.** Ten `security definer` functions were
executable by an unauthenticated caller, one of which could write to another user's
account. Found by live probing, not by any static check; closed by `0036` and
re-verified. Full account in [`track.md`](track.md).

See [`v2-report.md`](v2-report.md) for the V2 architecture status against all 40
acceptance criteria.

nyuz is **in development and not accepting customers.** This page is the honest,
itemised version of that sentence.

It exists because the app looks considerably more finished than it is. The marketing
site, the accounts, the admin console and the blog are genuinely working software. As of
this review the pipeline is too: articles are collected, grouped into events, analysed,
matched to readers, and assembled into a briefing with one personal paragraph per story.
Whether a real inbox has received one: yes, on 25 August 2026, to the Resend
account that owns the key. A stranger cannot receive mail until
`RESEND_FROM_EMAIL` is a verified domain rather than `onboarding@resend.dev`.

---

## Summary

| Area                                                   | State                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Marketing site (landing, pricing, how-it-works, legal) | **Built**                                                         |
| Editable site content + feature flags                  | **Built**                                                         |
| Accounts, sign-in, OAuth                               | **Built**                                                         |
| Admin console (analytics, users, bans, roles, audit)   | **Built**                                                         |
| Blog (authoring + public pages)                        | **Built**                                                         |
| AI provider routing configuration                      | **Built** — two stages route through it                           |
| Billing (checkout, portal, webhook)                    | **Built**; live account configuration and end-to-end payment remain |
| Lifecycle email (account, billing, pause)              | **Built** — Free warns at 23 inactive days, pauses at 30          |
| Onboarding flow                                        | **Built**, persisted to the account                               |
| Source list (87 feeds, 83 active)                      | **Built** — expanded past technology into general news; see `track.md` |
| Ingestion pipeline                                     | **Built** — 7,035 articles stored                                 |
| Clustering (articles → events)                         | **Built** — 2,007 articles across 1,803 events                    |
| Analysis and scoring (events → understood)             | **Built** — 549 analysed; 718,351 tokens; 1,254 backlog growing faster than `ANALYSE_LIMIT` drains it — see `track.md` |
| Matching (events → readers)                            | **Built** — 157 rows in `user_events`, free                       |
| **V2: shared event impacts**                           | **Live** — one shared explanation per event, written inside the analysis call at zero extra token cost. The per-reader-per-story model call is gone |
| **V2: pre-analysis demand gate**                       | **Live** — skipped 6/6 events in a real batch, 0 model calls      |
| **V2: cached translation**                             | **Cache/read path exists; generation dormant** — missing translations fall back to English |
| **V2: custom sources**                                 | **Live** — Free 0 / Personal 5 / Pro 25, enforced in Postgres under an advisory lock |
| **V2: demand-driven collection, adaptive polling**     | **Live, flags off** — tiers and eligibility computed and visible; behaviour unchanged until enabled |
| **V2: cluster v2 skip**                                | **Built, off** — no shadow measurements exist yet                 |
| **V2: cost intelligence**                              | **Live** — `/admin/cost`, counted from rows only                  |
| Day-one backfill for a new account                     | **Built** — one query; pays only if empty                         |
| Digest generation and delivery                         | **Built** — email, browser push, linked Telegram; quiet days skip honestly |
| Breaking alerts                                        | **Built** — none Free, 3/week Personal, 10/day Pro; atomic claims |
| Story Ask                                              | **Dormant** — endpoint returns disabled; every plan has a zero daily allowance |
| Plan story limits                                      | **Built** — Deep caps 18/30/50; large briefings chunked           |
| AI cost ceiling                                        | **Built** — monthly reservation ledger and global token budget    |
| Staff pipeline page                                    | **Built** — live `getOverview` counts                             |
| Customer dashboard                                     | **Built** — reads `user_events` and `digest_items`                |

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
table. **98 of 99 events are analysed** as of this review, for **181,980 tokens** —
about 1,857 per event. The last 41 were drained 25 August 2026 (79,238 tokens, 0
failures, 0 CI refs). One event is `failed` (a parked CI ref). New topic slugs
(`consumer-tech`, `hardware`, `developer-tools`, `linux`) were used on that drain.
23 analysed events still have no topic.

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

**Matching.** `user_events` has **29 of 98 analysed events** for the one live reader,
zero model calls. A match run after the 25 August drain wrote 13 new rows and fired
no breaking alerts — none of the new matches cleared importance 6. This is the stage
that would otherwise scale with readers, so it calls nothing, resolves no AI route, and
is set arithmetic over rows that already exist. Re-running it is free and writes nothing.

Each rule was exercised against the live database by changing a real preference and
putting it back: at the default density the same events split into admitted and
below-threshold; an added exclusion vetoed exactly one story while leaving the topic
that selected it intact; muting an event's only source dropped exactly that event; and
marking a source `priority` reordered the briefing without changing what was in it.
Details and figures in [plan.md](plan.md#stage-5--matching--done).

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

## What is not built

**WhatsApp delivery.** WhatsApp is not implemented and is rejected by plan enforcement. Email, browser push, and linked Telegram have delivery paths; live provider configuration still needs an environment-level check.

The stages:

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
   Built and verified, 23 August 2026. **98 of 99 analysed** as of 25 August 2026
   (181,980 tokens). The pending backlog was drained the same day.
5. ~~**Match** — deterministic SQL against topics, keywords, exclusions and density.~~
   Built and verified, 23 August 2026. 29 rows in `user_events` after the 25 August
   drain, zero model calls. The
   day-one path that runs the same code for a brand-new account was verified 24 August.
6. ~~**Generate and deliver** — one paragraph per person per story, then send.~~ Built
   25 August 2026. `src/lib/pipeline/digest.ts` schedules on the reader's timezone,
   builds digest items from shared event data without a per-reader model call, skips with zero items when nothing matched, and sends through configured channels with queued retry handling. A quiet day is emailed as a quiet day, not padded. Cron `* * * * *`,
   generating on every minute and delivering on all of them, so the tick
   itself is not a source of lateness (0077).
   `npm run pipeline -- digest --user ID --now` builds a slot immediately.
7. ~~**Breaking alerts** — out-of-schedule send for a newly matched event.~~ Built
   25 August 2026. `digests.kind = 'alert'`, no model call (`generation_tokens = 0`),
   email via the same `deliveries` path. `important` uses the Minimal floor (importance
   ≥ 6) and caps at three a week. Day-one backfill sets `skipAlerts`.
8. **Story Ask is dormant.** The `askStory` endpoint returns `disabled`, and every plan
   currently has a zero allowance. Its older claim/quota implementation is not an active
   user feature.

**The project has now spent money on both of the stages that ever will share it.**
Clustering costs roughly 610 tokens per article; analysis costs roughly 1,846 tokens per
event, once. `events.analysis_tokens` holds **181,980 across 98 rows** — the number the
whole cost argument gets audited against, and the reason it is stored on the event rather
than summed from a log. A single figure there that ever doubled would mean an event had
been understood twice, which is the one failure this design cannot absorb.

**Billing.** Stripe checkout, the billing portal and the webhook are wired.
`subscriptions.plan` is written by `customer.subscription.*` events, and the price of every
incoming event is matched against the nyuz catalogue first — the Stripe account is shared
with another product, so an unmatched price is ignored rather than trusted. It has been
exercised with automated/test-mode coverage only. **A live payment still must be run before launch.**

**Delivery.** Email, browser push and linked Telegram have delivery paths with queued rows, idempotency or provider tags, and retry handling. WhatsApp is unavailable. The configured sending domain and live provider settings were not rechecked for this review.

_Lifecycle_ email still works: welcome, subscription started,
cancelled, payment failed and briefings-paused all send through Resend. The dormant-reader
nudge fires weekly (`0 12 * * 1`) for readers who have had a briefing and have not
visited in seven days. `profiles.last_seen_at` is written from the dashboard, once an
hour. Open-tracking on the mail itself is still not wired — a verified domain would
need to exist first.

---

## Known gaps and rough edges

**Coverage is the topic pool.** Onboarding and Topics only offer `TOPIC_POOL`. Save and
match drop anything else, so a free-text "knitting" row cannot select an event. Anthropic
is in the pool with no primary feed (re-checked 25 August 2026: `/rss.xml`, `/feed.xml`,
`/news/rss.xml`, `/news/feed` all 404) — an announcement arrives only as somebody else's
coverage.

**`0007_source_stats.sql` is applied.** `admin_source_stats()` returns 68 sources and
1,040 articles. Applied 25 August 2026 via the Supabase MCP, because `supabase db push`
still cannot run from this machine.

**PyTorch's GitHub feed was the wrong URL.** It cost a fifth of the analysis bill
(10 CI-ref events, 18,157 tokens). **Retargeted 25 August 2026** to the company blog
(`https://pytorch.org/blog/feed/`). GitHub `releases.atom` and `tags.atom` are the same
CI stream; there is no version filter. First fetch stored 8 real posts. Ingest still
drops CI-ref titles; cluster parks leftovers as failed events.

**The cron's per-run limit assumes a paid Cloudflare plan.** A Worker invocation may make
50 subrequests on the free plan and 1000 on paid; `SCHEDULED_LIMIT` is 24 sources, which
is roughly 120 subrequests. **On the free plan this must come down**, and it is the only
one of the three that must: there are seven stages — ingestion every fifteen
minutes, clustering at `2,17,32,47`, classification at `8,23,38,53`, analysis at
`9,24,39,54`, matching at `14,29,44,59`, digest generation and delivery every minute, and a daily dormant sweep —
carried by **three** triggers, because Cloudflare registers three per Worker and
silently drops the rest. The last five share `STAGES_CRON` and are told apart by
the minute. Classification (0068) is free — deterministic keyword matching, no
model — and sits between clustering and analysis because it is what decides
which events analysis is allowed to see. The two model stages are
bounded by money and wall-clock rather than by subrequests. Clustering does 12 articles a
run and analysis 6 events, roughly 35 subrequests. Demand and approaching briefing
deadlines fill their priority lanes; unrelated work remains in a fixed background slice,
so neither tries to drain its backlog unattended.

**The topic pool grew on 25 August 2026.** Linux, Hardware, Developer tools and Consumer
tech were added (`0009_alerts.sql`) so new analysis has somewhere to put game reviews and
how-tos. Events already analysed keep whatever topics they had — `analysed_at` is
once-ever, so a prior no-topic row stays unmatchable until an operator re-runs analysis
by name, which this codebase refuses to do automatically.

**The day-one path draws from the same analysis backlog.** When a new account
matches nothing, the on-demand pass analyses up to three events — from the 49 still
awaiting analysis, not from anywhere new. It is capped, once per account, and restricted
to events whose headline already names something that reader follows, so it cannot drain
the backlog; but the money comes out of the same pocket, and the `admin_audit_log` rows
with action `backfill.analyse` are where to look for what it has spent.

**`--signal` is blue.** Hue 240 in `src/styles.css`, `#0573AA` / `#55AEE8` in
`public/logo.svg`, and `PALETTE.signal` in the email shell. Settled before the first
briefing mail so it does not go out red.

**Onboarding preferences reach the account.** `user_topics`, `user_exclusions` and
`notification_preferences` are all written; `localStorage` under `nyuz.prefs.v2` is now a
cache in front of the account rather than the store of record. Noted because earlier
versions of this page said otherwise.

**Legal documents are unreviewed drafts.** `src/routes/legal/$doc.tsx` names Vishal
"goblin" Gurung trading as nyuz, correspondence Matsudo, Chiba, 〒270-0004, Japan, contact
`contact@`, `privacy@`, `security@` and `billing@nyuz.app`. They describe what the system genuinely does, but they have not been
seen by a lawyer. Not a registered company — do not say "Registered in Japan".

**The licence names Vishal "goblin" Gurung** and `contact@nyuz.app`. Still not lawyer-reviewed.

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
npm run test        # vitest, 269 tests across 18 files
npm run build       # vite + nitro, Cloudflare Workers target
```

None of the four prove the pipeline works. A green build says the code compiles; it says
nothing about whether a migration ran or a feed parsed. That is what the operator scripts
are for — `npm run db:status`, `npm run check:feeds`, `npm run pipeline` and
`npm run cron:test` all talk to the real project, and their output is what the figures on
this page come from.
