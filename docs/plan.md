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
and — as of the most recent work — reader preferences persisted to Postgres.

**Not working today.** Everything that makes it a news product.

| Reality check                            | Answer                                           |
| ---------------------------------------- | ------------------------------------------------ |
| Do readers get real news?                | No. The dashboard renders `src/lib/sample-data`. |
| Does anything call a language model?     | No. `lib/ai/` exists and nothing imports it.     |
| Are there articles or events stored?     | No. `sources`, `articles`, `events` are empty.   |
| Can a new reader be matched to anything? | No. There is nothing to match against.           |

The tables all exist from `0001` with row-level security already written. They have
simply never been filled.

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

### Stage 1 — Sources · _not started_

A real list of feeds to watch. Nothing here costs anything.

- [ ] Migration `0006_sources.sql` seeding ~40–60 feeds across the `source_kind`
      enum (`company_blog`, `news`, `rss`, `github`, `research`, `product`)
- [ ] Admin console page to add, disable and inspect a source
- [ ] Verified: `select count(*) from sources where active` returns > 0

**Decisions already made.** `sources.feed_url` is unique, so a seed is re-runnable with
`on conflict do nothing`. `failure_count` and `last_fetched_at` exist for backoff —
use them rather than adding new columns.

**Watch out.** Coverage has to match what onboarding implies. `TOPIC_POOL` offers
fifteen technology topics but onboarding accepts free text, so a reader can ask for
something no source covers. That is called out in [`status.md`](status.md) as a product
decision, and it becomes real the moment sources exist.

---

### Stage 2 — Ingestion · _not started_

Fetch every active feed, store what is new. Still no model calls.

- [ ] RSS and Atom parsing that survives malformed feeds
- [ ] URL canonicalisation — strip tracking parameters, session ids, AMP variants
- [ ] `content_hash` over canonical url + title; an exact match is a republish, not news
- [ ] Insert into `articles`, skipping anything already stored
- [ ] Per-source failure counting and backoff, so one dead feed does not stall a run
- [ ] Cron trigger on Cloudflare Workers
- [ ] Verified: a real run puts real rows in `articles`

**Why this is the right starting point.** It costs nothing, needs no model, and puts
real rows in the database within an hour — which is what turns the dashboard from
fixtures into a product.

**Decisions already made.** `articles.url` is unique; rely on it rather than checking
first. Workers has no Node built-ins, so the parser must be `fetch` plus a string or
`DOMParser`-free approach — do not reach for a Node-only RSS library.

---

### Stage 3 — Clustering · _not started_

Thirty articles about one announcement become one event. **First model cost.**

- [ ] Trigram shortlist in Postgres using `articles_title_trgm_idx`
- [ ] Model call over the shortlist only, answering one question: same event or not
- [ ] Create or attach `events`, set `articles.event_id`
- [ ] Verified: one real announcement covered by several outlets produces one event

**This is the load-bearing optimisation.** Sending every pair of articles to a model
is quadratic and ruinous. The trigram index makes the model's job small and bounded.
If this stage is written without the shortlist, the cost argument collapses.

**Use** `completeJson` from `src/lib/ai/deepseek.ts` via `completeRouted` in
`src/lib/ai/config.ts`, so the model is the one the admin console selected rather than
a hard-coded string. Tier: `cluster`.

---

### Stage 4 — Analysis · _not started_

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

**Decide before building.** "Recent" needs a window — probably 48–72 hours. Too wide and
day one is a stale wall of text; too narrow and quiet topics still show nothing.

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

- [ ] Dormancy email has no trigger — needs open-tracking, which needs stage 7
- [ ] Stripe live mode — no real payment has ever run through the webhook
- [ ] `VITE_SITE_URL` must be the real origin in production
- [ ] `RESEND_FROM_EMAIL` is `onboarding@resend.dev`, which only delivers to your own
      address — a verified domain is needed before a stranger can receive anything
- [ ] Production `STRIPE_WEBHOOK_SECRET` differs from the CLI one

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
