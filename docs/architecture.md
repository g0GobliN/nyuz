# Architecture

How a briefing is supposed to be produced, why the stages are in this order, and why the
cost of running it does not rise with the number of subscribers.

> **State:** the design below is complete and the database schema implements it. **All six
> stages are built** — see [status.md](status.md). This page describes the target, and says at each
> stage whether that stage exists.

---

## The shape of the problem

Thirty outlets cover one announcement. A naive product sends thirty items, or asks a
language model to summarise each of the thirty for each of its subscribers. The first is
useless to read. The second costs `articles × subscribers` model calls per day, which is
a business that gets more expensive exactly as it succeeds.

nyuz collapses those thirty articles into **one event**, understands that event **once**,
and then matches it against subscribers with a database query. The expensive work scales
with _how much happened today_; only one cheap step scales with _how many people
subscribed_.

---

## The six stages

Cheap deterministic work runs first and discards as much as it can, so the expensive work
only ever sees what survived. That ordering is the entire performance and cost story.

### 1. Collect — _built_

Each source in `sources` is fetched on its own cadence. Failures increment
`failure_count`; a source that keeps failing is backed off and eventually has `active` set
false, so one dead feed cannot stall a run.

**Cost:** network and parsing. No model.

### 2. Normalise — _built_

URLs are canonicalised — tracking parameters, session ids and AMP variants stripped — then
hashed with the title into `articles.content_hash`. An exact hash collision is a republish
of something already seen, not a new article.

In practice the hash does less than this implies, and the reason is worth stating: the URL
is already unique, so a hash over URL and title cannot find a duplicate the unique index
would not have rejected. What it does catch is a publisher rewriting the headline on a
story already stored. Duplicate _reporting_ of one event is stage 3's job, not this one.

**Cost:** a hash comparison. No model.

### 3. Cluster — _built_

The `articles_title_trgm_idx` GIN index shortlists headlines that are plausibly the same
story, **in Postgres**. Only that shortlist is sent to a model, and only to answer one
question: are these the same event?

This is the load-bearing optimisation. Sending every pair to a model would be quadratic
and ruinous; the trigram pass makes the model's job small and bounded.

No SQL function was needed for the shortlist, which was not obvious: a GIN
`gin_trgm_ops` index serves `title ilike '%nvidia%'` as an index scan, and that is exactly
what PostgREST emits for an `ilike` filter. So the shortlist is a handful of `ilike`
disjuncts over the most distinctive words in the headline, bounded to a few days and ten
rows.

**Cost:** first model call, on a shortlist. Around 610 tokens per article, measured.

### 4. Understand — _built_

One analysis pass per event extracts what happened, the before and after state, and scores
`importance` and `novelty` from 0 to 10, and links the event to rows in the shared `topics`
table so stage 5 has something to match against. Tokens spent are recorded on
`events.analysis_tokens`.

**This is the last shared model call, and it happens once per event forever.** If another
forty articles arrive about the same event tomorrow, they attach to it. No re-analysis. The
gate is `analysed_at`: selection is `analysed_at is null`, nothing in the codebase clears
it, and clustering deliberately does not touch it when new coverage joins an event.

Three details are load-bearing rather than incidental. An event is **claimed** before the
model is called, by a conditional move to `status = 'analysing'`, so two workers cannot
both pay for one event. Topics are written **before** `analysed_at`, because an event
marked analysed with no topics would be invisible to matching forever and never retried.
And an event whose analysis fails is **not** retried by the schedule, because a cluster
that cannot be analysed would otherwise be paid for every half hour unattended.

The model is given the coverage and told that absent facts are null, so `before_state` is
frequently null and that is the correct answer. Topics are restricted in the prompt to
slugs that exist in `topics`, because an invented slug matches no reader; slugs the model
asks for and cannot have are counted and reported as a coverage signal instead.

**Cost:** second model call, once per event. Around 1,700 tokens per event, measured — most
of it the reasoning model's own reasoning rather than the prompt.

### 5. Match — _built_

A deterministic query, not a model. Topics, keywords, source preferences and the per-user
density threshold decide who sees what, writing to `user_events`. It runs on a schedule
at `25,55`, and `src/lib/pipeline/backfill.ts` runs the same code for one reader the
moment they finish onboarding, so a new account is not looking at an empty page until the
next cron. That day-one path is the only one that may call a model here, and only when the
query returned nothing: up to three events whose headline already names something the
reader follows, at most once per account, recorded in `admin_audit_log`.

Exclusions are applied **last and win**. A term you have excluded cannot be reintroduced
by a topic you follow. This ordering is a product promise, not an implementation detail —
`src/lib/matching.ts` implements the same rule over fixtures today, and
`src/lib/matching.test.ts` locks it in.

**Cost:** arithmetic. No model. This is the stage that would otherwise scale with users,
and it is deliberately free.

### 6. Generate and deliver — _built_

One short paragraph per person per story — `digest_items.why_it_matters` — explaining what
this changes given what that person follows. Everything else in the briefing was written
once, upstream. Then `deliveries` handles the send per channel with retry.

**Cost:** a small generation per person. The only per-user model spend in the system.

---

## Why it stays cheap

An illustrative day at the volume the system is designed for:

```
Articles collected        8,412   ████████████████████
After normalisation       8,120   ███████████████████
After clustering            312   ███████
Analysed by a model         312   ███████     ← charged once each, forever
One reader's briefing         6   █
```

The ratio between the second row and the fourth is the argument. 8,412 articles produced
312 model analyses, not 8,412 — and those 312 serve every subscriber simultaneously.

Adding the ten-thousandth subscriber adds ten thousand short paragraphs per day, which is
the cheapest thing a language model can be asked for. It does not add a single analysis
pass.

> These figures are illustrative, not measured. Real numbers live in the admin console.
> All six stages now run. Delivery still shows zeroes in the console until a digest has
> actually been generated against the live database. The product does not display
> plausible-looking figures nobody computed.

---

## Stack

| Layer     | Choice                    | Why                                                                 |
| --------- | ------------------------- | ------------------------------------------------------------------- |
| Framework | TanStack Start (React 19) | File-based routes, server functions, SSR                            |
| Language  | TypeScript                | `noUncheckedIndexedAccess` is on                                    |
| Styling   | Tailwind v4               | Three-colour token system in `src/styles.css`                       |
| Database  | Supabase (Postgres)       | Row-level security is the actual authorisation layer                |
| Runtime   | Cloudflare Workers        | Pipeline is cron- and queue-shaped; SSR ships alongside             |
| Models    | OpenAI-compatible HTTP    | Provider is a database row — see [ai-providers.md](ai-providers.md) |

**No Node built-ins at runtime.** The Cloudflare Workers target has none. Server code must
be fetch-based, and the service-role Supabase client is constructed per request from the
env handed to it rather than captured at module scope.

---

## Data flow at a glance

```
sources ──fetch──▶ articles ──hash/dedupe──▶ articles (distinct)
                                                  │
                                          trigram shortlist
                                                  │
                                            ┌─────▼─────┐
                                            │  model 1  │  same event?
                                            └─────┬─────┘
                                                  ▼
                                               events
                                                  │
                                            ┌─────▼─────┐
                                            │  model 2  │  once per event
                                            └─────┬─────┘   importance, novelty
                                                  ▼
                          ┌───────────── events (understood) ─────────────┐
                          │                                               │
                     SQL match                                       SQL match
                  (topics − exclusions)                          (topics − exclusions)
                          │                                               │
                     user_events                                     user_events
                          │                                               │
                    ┌─────▼─────┐                                   ┌─────▼─────┐
                    │  model 3  │ one paragraph                     │  model 3  │
                    └─────┬─────┘                                   └─────┬─────┘
                          ▼                                               ▼
                    digest ▶ deliveries                            digest ▶ deliveries
                     reader A                                        reader B
```

The fan-in above the events row and the fan-out below it is the whole design. Everything
above `events` happens once for everybody; everything below happens per person and is
deliberately cheap.

---

## Related

- [database.md](database.md) — the tables these stages read and write
- [ai-providers.md](ai-providers.md) — which model serves which stage
- [status.md](status.md) — what exists today
