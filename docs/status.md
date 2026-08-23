# Project status

Last reviewed: 23 August 2026.

nyuz is **in development and not accepting customers.** This page is the honest,
itemised version of that sentence.

It exists because the app looks considerably more finished than it is. The marketing
site, the accounts, the admin console and the blog are genuinely working software. As of
this review the ingester is too — there are real articles in the database — and those
articles are now grouped into real events by a real model call. The thing the product is
actually for — a briefing assembled from real reporting — is still not built: nothing has
yet read an event and worked out what it means, and no reader has been shown anything but
fixtures. Anyone forming a judgement from the screenshots alone will be wrong in one
direction or the other.

---

## Summary

| Area                                                   | State                                        |
| ------------------------------------------------------ | -------------------------------------------- |
| Marketing site (landing, pricing, how-it-works, legal) | **Built**                                    |
| Editable site content + feature flags                  | **Built**                                    |
| Accounts, sign-in, OAuth                               | **Built**                                    |
| Admin console (analytics, users, bans, roles, audit)   | **Built**                                    |
| Blog (authoring + public pages)                        | **Built**                                    |
| AI provider routing configuration                      | **Built** — clustering now routes through it |
| Billing (checkout, portal, webhook)                    | **Built** (test mode; unproven against live) |
| Lifecycle email (account, billing, pause)              | **Built** (dormancy nudge has no trigger)    |
| Onboarding flow                                        | **Built**, persisted to the account          |
| Source list (64 live feeds)                            | **Built**                                    |
| Ingestion pipeline                                     | **Built** — 1017 articles stored             |
| Clustering (articles → events)                         | **Built** — 41 articles in 38 events         |
| Analysis, scoring, matching                            | **Designed, not built**                      |
| Digest generation and delivery                         | **Designed, not built**                      |
| Customer dashboard                                     | **Prototype** — renders labelled sample data |

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
**1017 articles are stored** as of this review. Re-reading a feed inserts nothing —
`articles.url` is unique and the insert ignores duplicates — and a publisher who rewrites
a live headline updates the stored row instead. Feeds that fail are counted, backed off on
a widening schedule, and switched off after eight consecutive failures with an audit-log
row naming the reason. Verified against the live database, including the failure path and
the disable; see [plan.md](plan.md#stage-2--ingestion--done) for the figures and for the
one claim that could not be verified without a deploy.

**Clustering.** Articles that report the same occurrence are grouped into one row in
`events`. **41 articles sit in 38 events** as of this review — the first rows anything in
this project has written to that table, and the first money it has spent.

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
over real batches, and 89 of the 1017 stored articles are decided for nothing at all
because their titles are version tags or CI refs rather than headlines.

Articles are processed one at a time on purpose. The shortlist reads the column the write
updates, so a burst of coverage converges on one event with no bookkeeping; running the
batch concurrently would have every worker create its own event for the same story, and
the analysis stage would then pay for that story once per outlet. Clustering has its own
schedule, `10,40 * * * *`, offset from ingestion so it runs on coverage that has finished
arriving. Verified through the built Worker, not just the source. See
[plan.md](plan.md#stage-3--clustering--done).

`npm run pipeline` still runs ingestion only. A stage that spends money has to be asked
for by name.

---

## What is a prototype

**The customer dashboard.** Every story on every dashboard page comes from
`src/lib/sample-data.ts` — six fixtures. The ingester fills `articles` and clustering now
fills `events`, but nothing has yet worked out what any of those events _mean_, so
`event_topics`, `user_events`, `digests` and `digest_items` are all still empty and there
is nothing real for the dashboard to read. An event currently carries a title, a first-seen
timestamp and a `pending` status — not a summary, not an importance score, and no topics to
match a reader against.

Two things were done so that this is not misleading:

1. **A "Sample data" notice** on the dashboard and briefing pages, saying plainly that
   the stories are examples and nothing was gathered for the reader. Its wording was
   revised in this review: it used to say collection was not running, which is no longer
   true, so it now says collection _is_ running and that nothing here came from it yet.
   Grep `SampleDataNotice` — it is meant to be deleted when the dashboard reads real rows.

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

**Everything between an event and a reader.** Collection and grouping work; nothing after
them does. `event_topics`, `user_events`, `digests`, `digest_items` and `deliveries` have
never had a row written to them by anything. The DeepSeek client is called for clustering
and for nothing else — no analysis, no scoring, no summarising.

The stages, in the order they need building:

1. ~~**Collect** — fetch feeds on a schedule, record failures, back off dead sources.~~
   Built and verified, 23 August 2026.
2. ~~**Normalise** — canonicalise URLs, hash, drop exact duplicates.~~ Built, with one
   correction: a hash over URL plus title cannot find a duplicate, because the URL is
   already unique. Duplicate _reporting_ of one event is stage 3's job. What the hash does
   catch is a publisher rewriting a headline on a story already stored.
3. ~~**Cluster** — trigram shortlist in Postgres, then one model call to confirm.~~ Built
   and verified, 23 August 2026. 41 of 1017 articles are grouped so far; the remaining 976
   are a backlog the schedule works through, or `npm run pipeline -- cluster --limit N`
   does deliberately.
4. **Understand** — one analysis pass per event; importance, novelty, before/after.
   **Next.** 38 events are waiting, all with `analysed_at` null.
5. **Match** — deterministic SQL against topics, keywords, exclusions and density.
6. **Generate and deliver** — one paragraph per person per story, then send.

**The project has now spent money.** Clustering is the first stage that does, at roughly
610 tokens per article. `events.analysis_tokens` is still zero across all 38 rows, because
that column records stage 4's spend and stage 4 has never run — it is the number the whole
cost argument gets audited against, so it is worth knowing that nothing has touched it.

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

**PyTorch's feed is the wrong URL.** The source points at `releases.atom`, which for that
repository returns continuous-integration branch tags rather than releases —
`trunk/16ee93b8…: [vision hash update]`, `viable/strict/1787468606: Revert "…"`. **Eleven
of the 1017 stored articles are refs of that shape.** Clustering recognises them and
spends nothing on them, but they are still stored, and they will reach a reader as
one-article events if the analysis stage scores them. Fixing it means pointing the source
at a tag feed filtered to releases, or dropping the source — a coverage decision rather
than a bug.

**The cron's per-run limit assumes a paid Cloudflare plan.** A Worker invocation may make
50 subrequests on the free plan and 1000 on paid; `SCHEDULED_LIMIT` is 24 sources, which
is roughly 120 subrequests. On the free plan this must come down. Clustering has now added
a second schedule, `10,40 * * * *`, so there are two triggers rather than one — its limit
of 12 articles is bounded by money and wall-clock rather than by subrequests, and it
deliberately does not attempt to drain the backlog unattended.

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

**`react-refresh/only-export-components` warnings.** Nineteen of them, all in files that
export both a component and a helper. They affect hot-reload granularity in development
and nothing else. Left alone deliberately; splitting those files to satisfy the rule
would scatter closely-related code for no runtime benefit.

---

## Checks that must stay green

CI runs all four on every push and pull request — see
[development.md](development.md#continuous-integration).

```
npm run typecheck   # tsc --noEmit, with noUncheckedIndexedAccess on
npm run lint        # eslint, currently 0 errors / 19 warnings
npm run test        # vitest, 163 tests across 12 files
npm run build       # vite + nitro, Cloudflare Workers target
```

None of the four prove the pipeline works. A green build says the code compiles; it says
nothing about whether a migration ran or a feed parsed. That is what the operator scripts
are for — `npm run db:status`, `npm run check:feeds`, `npm run pipeline` and
`npm run cron:test` all talk to the real project, and their output is what the figures on
this page come from.
