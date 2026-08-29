# V2 Track — demand-driven intelligence architecture

Tracks execution of [`plan2.md`](plan2.md) against the actual state of the repo.
Conventions follow [`plan.md`](plan.md) and [`localisation-plan.md`](localisation-plan.md):
**Built**, **Designed, not built**, **Not started**. Tick a box only when it is true
against the live database, not when it compiles.

> **Read this before `plan2.md`.** `plan2.md` is a generic architecture brief written
> without seeing this codebase. Section 2 of it demands an audit before implementation —
> this file is that audit, plus the deviations from its own phase order that the audit
> justifies. Where the two disagree, this file wins.

---

## Phase 0 — Audit — done, 2026-08-29

### Subsystem map

| Subsystem                | Files                                                         | Tables                                                          | Entry point                          | State | Verdict                             |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- | ----- | ------------------------------------ |
| Collect                  | `src/lib/pipeline/ingest.ts`, `feed.ts`, `fetch.ts`             | `sources`, `articles`                                            | Cron `*/15 * * * *`                  | Built | Keep                                 |
| Normalise                | `src/lib/pipeline/canonical.ts`, `ingest.ts`                    | `articles`                                                        | (same run)                            | Built | Keep                                 |
| Cluster                  | `src/lib/pipeline/shortlist.ts`, `cluster.ts`                   | `events`, `articles.event_id`                                    | Cron `10,40 * * * *`                 | Built | Keep; deterministic-confidence layer (plan2 §25) is additive, not a replacement |
| Understand (analysis)    | `src/lib/pipeline/analyse.ts`                                   | `events`, `event_topics`, `ai_prompts`                            | Cron `20,50 * * * *`                 | Built | Keep; claim/lock pattern already atomic |
| Match                    | `src/lib/matching.ts`, `src/lib/pipeline/match.ts`, `relate.ts`  | `user_topics`, `user_exclusions`, `user_source_prefs`, `user_events` | Cron `25,55 * * * *` + day-one backfill | Built | Keep — already AI-free, already the free stage plan2 §48 asks for |
| Day-one backfill         | `src/lib/pipeline/backfill.ts`                                  | `user_events`                                                    | On onboarding completion              | Built | Keep |
| Generate + deliver       | `src/lib/pipeline/digest.ts`, `src/lib/server/email/`           | `digests`, `digest_items`, `deliveries`, `event_impacts`          | Cron `*/5 * * * *`                   | Built | Phase 2 removed the per-reader model call — see below |
| Breaking alerts          | `src/lib/pipeline/alerts.ts`                                    | `digests` (`kind='alert'`), `alert_claims`                        | Match-time                            | Built | Keep |
| Story Ask                | `src/lib/server/briefing.ts` (`askStory`), `src/lib/ask-scope.ts` | `ai_usage_ledger`                                                | On demand, `claim_ask` RPC            | Built | **This is already plan2 §36's on-demand personal explanation** |
| AI provider routing      | `src/lib/ai/deepseek.ts`, admin `ai.tsx`                        | `ai_providers`, `ai_model_routes`, `ai_prompts`                   | Resolved per call, 60s cache          | Built | Keep — already the central router plan2 §65 asks for |
| Plan entitlements        | `src/lib/plans.ts`                                              | `subscriptions`, `0017_plan_entitlements.sql`                     | Read everywhere plan-gated            | Built | **Already the single canonical table plan2 §58 asks for** |
| Billing                  | `src/lib/server/stripe/`, `src/lib/server/billing.ts`           | `subscriptions`                                                   | Checkout, portal, webhook             | Built, test mode | Do not touch pricing without explicit instruction |
| Admin console            | `src/routes/admin/*`                                            | `0003_admin.sql`                                                  | `/admin`, `adminOnly`/`superadminOnly` | Built | Extend, don't replace (plan2 §23, §77 already say this) |
| Feature flags            | `src/lib/site-content.ts`, admin `content.tsx`                  | `feature_flags`                                                   | —                                      | Built | Reuse for any V2 flag |
| Source model             | `src/lib/server/sources.ts`, admin `sources.tsx`                | `sources` (`source_kind` enum)                                   | —                                      | Built, single global table, no per-user copies | Already satisfies plan2 §12's "one crawler, many subscribers" — there just aren't custom sources yet |
| Translation              | none                                                             | none                                                              | —                                      | Not started | **A better-specified plan already exists** — see below |
| Source-topic graph       | none                                                             | none                                                              | —                                      | Not started | See recommendation below |
| Source demand / adaptive polling | none                                                      | none                                                              | —                                      | Not started | See recommendation below |
| Custom user sources      | none                                                             | none                                                              | —                                      | Not started | See recommendation below |
| Tests / CI                | 18 files, 354 assertions, vitest                                | —                                                                  | `npm run test`, CI on every push       | Built | Keep pattern for any new work |

### The one live gap plan2 correctly identifies — closed in Phase 2

`digest.ts` used to write `digest_items.why_it_matters` with **one model call per
person per story, automatically, every digest** — exactly the "automatic user × story
AI" plan2 §34 wants removed, and the only stage `ai-providers.md` labels as scaling
with subscribers. **Closed 2026-08-30**: the shared explanation is written once per
event in `event_impacts` and reused by every reader. Story Ask remains the on-demand
personal path plan2 §36 asks for. See "Phase 2 — corrected and built" below.

### Where plan2 duplicates work already done better

**Translation (plan2 §39–45).** `docs/localisation-plan.md` is a more rigorous version
of the same idea — same shared-cache principle (`event_translations`, once per
event/language, lazily filled), but costed against this codebase's actual token
measurements, with the specific files that break (`shortlist.ts` has no tokenizer for
CJK, `ask-scope.ts`'s English-only refusal regex fails open in other languages,
Telegram's length guard undercounts Devanagari). **Follow `localisation-plan.md`, not
plan2 §39–45, if translation gets built.**

**Entitlements (plan2 §58).** Already one table: `PLAN_LIMITS` in `src/lib/plans.ts`,
already read by billing, topics, alerts, Ask, and retention. Nothing to build here
except adding new keys if V2 introduces new limits (e.g. `maxCustomSources`).

### Revised after discussion, 2026-08-29 — the demand gate is not a "someday" problem

Original read of this section argued the source-demand machinery was solving a
problem this product doesn't have yet, because it read the risk purely against
*user* count (one live reader). That was an incomplete read. The founder's plan is
for **sources and users to grow together** — wider coverage is part of how the
product gets more useful to more people, not a thing that waits for users to show
up first. Under that plan, one piece of plan2's diagnosis is already real today,
independent of user count:

**Every clustered event gets analysed whether or not any current reader wants it.**
Real numbers from `status.md`: 98 events analysed, only 29 ever matched to the one
live reader — roughly **70% of all analysis spend to date paid for events nobody
has used yet.** That is not "waste" in an absolute sense (an unmatched event stays
useful forever if a future reader's interests reach it — that is the whole point of
analysing once and reusing), but it does mean analysis cost today tracks *how much
news exists*, not *how much demand exists*, and if sources grow ahead of readers —
which is the stated plan — that ratio gets worse before it gets better. Plan2's
"pre-analysis demand gate" (§29–30) is the direct fix, and it does not require scale
to be worth having; it requires source growth outpacing user growth, which is the
scenario in view. Fetching itself is still free (no model involved, `architecture.md`
stage 1) — the cost lives in clustering and analysis, downstream of fetching, and
that is where the gate has to sit.

The four `plan.md` stage-9 launch blockers (Stripe live mode, `VITE_SITE_URL`,
verified `RESEND_FROM_EMAIL`, production webhook secret) are still open and still
unrelated to any of this — they block a first paying customer regardless of which V2
phases ship.

---

## Recommendation — revised 2026-08-29

1. **Ship-readiness is not blocked by anything in plan2.** The four `plan.md` stage-9
   items (Stripe live, sending domain, `VITE_SITE_URL`, webhook secret) are what stand
   between this product and its first real customer. None of them need V2, and they
   can proceed in parallel with everything below.
2. **Source-topic graph — in progress.** `0018_source_topic_graph.sql` adds
   `sources.coverage_mode` and the global `source_topics` table. Schema only, inert,
   additive. Needed before demand can be computed at all — everything else in this
   section reads from it. **Needs manual application** — see "Applying 0018" below.
3. **Next: seed the graph, then make demand visible before it changes any behaviour.**
   Per plan2's own §104, calculate and *show* demand in admin before using it to skip
   collection or analysis. That means an admin page to assign topics to sources
   (task queued), then a read-only demand number per source. No source stops being
   fetched or analysed until that number has been checked against reality.
4. **Pre-analysis demand gate (plan2 §29–30) is the actual near-term prize**, not the
   source-demand graph for its own sake. It is what stops the 70%-unmatched pattern
   from getting worse as coverage grows ahead of readers. Build it behind a feature
   flag, once demand visibility (step 3) is trustworthy enough to gate on — gating on
   an unverified demand number risks silently hiding events a reader would have
   wanted.
5. **Shared event impacts (plan2 phase 2 / §32–36) still stands on its own merits** —
   independent of the above, low risk, replacement path (Story Ask) already exists.
   Can be built in parallel, whenever convenient.
6. **Translation** stays scoped in `localisation-plan.md`, not started, pending a
   product decision on timing.
7. **Adaptive polling, custom sources, cluster v2 (plan2 §19–22, §12–14, §25–27)** —
   still sequenced after the demand gate proves out, per plan2's own phase order.
   Nothing here changes that ordering; it only changes how soon phase 3 starts.
8. **Pricing v2 (plan2 phase 9, §54–61) — do not start** without explicit instruction.
   Repricing a live Stripe catalogue pre-launch is a decision with no upside yet and
   real downside if it needs to be undone.

### Applying 0018

This dev machine has no linked Supabase CLI (`docs/plan.md` stage 1/9 — the same
constraint every prior migration hit). `supabase/migrations/0018_source_topic_graph.sql`
has to be pasted into the Supabase SQL editor, or applied through the Supabase MCP
once it's authorised in this session, before anything can read `coverage_mode` or
`source_topics` against real data. It has not been applied yet — this file says so
until it has, per this project's own rule against claiming unverified things work.

---

## Phase tracker

| # | Phase | plan2 ref | Status | Depends on |
| - | ----- | --------- | ------ | ---------- |
| 0 | Audit | §2, §100 | **Done** — this file | — |
| — | Launch blockers (Stripe live, sending domain, `VITE_SITE_URL`, webhook secret) | not in plan2 | Not started | Cloudflare deploy, Stripe dashboard, DNS |
| 2 | Shared event impacts, stop automatic per-user AI | §32–36, §101 | **LIVE + VERIFIED** — real impact written with real prose at **0 extra tokens**, folded into the analysis call. `event_impacts` has no `user_id` column | — |
| 1 | Translation cache | §39–45 + `localisation-plan.md` | **LIVE, no rows yet** — key proven stable and version-sensitive against live rows; duplicate rejected. Nothing generated: no reader has chosen a non-English language | A reader choosing one |
| 3 | Source-topic graph | §11, §103 | **Applied and verified live** — `0018`, `0019`, `0023` (87 sources, 122 mappings, 4 known-dead sources correctly left unmapped), admin chips on `/admin/sources` | — |
| 3b | Custom sources, canonicalisation, SSRF hardening | §11–14, §62, §103 | **LIVE + VERIFIED** — `claim_custom_source` returned `ok` then `exists` for a Pro reader; 87 sources / 87 distinct URLs; anon denied after `0036` | — |
| 4 | Demand visibility (admin only, no behavior change) | §16–18, §104 | **Applied and verified live** — `admin_source_demand()` returns real numbers. Purely read-only; nothing changed about fetch/analyse behaviour | — |
| 8 | Pre-analysis demand gate | §29–30, §108 | **LIVE + VERIFIED** — real batch skipped 6/6, 0 model calls, 2s. Fails open on any RPC error | — |
| 5 | Demand-driven collection (skip zero-demand sources) | §105 | **LIVE schema, flag off** — `sources_to_collect()` correct live: 83 eligible at 72h, 56 at 0h. Grace period proven | Turning the flag on |
| 6 | Adaptive polling | §19–22, §106 | **LIVE schema, flag off** — 83 sources tiered live (hot 35 / normal 42 / low 5 / cold 1); cadences correctly ordered | Turning the flag on |
| 7 | Cluster v2 → real AI-skipping | §25–27, §107 | **Shadow LIVE; skip correctly OFF** — `cluster_shadow_log` still empty, so no threshold can be chosen yet | Real shadow data |
| 9 | Pricing/entitlement architecture | §54–61, §109 | **LIVE + VERIFIED** — grandfathering built and tested; confirmed **no live Stripe price changed**, no legacy ids configured | — |
| 10 | Cost intelligence dashboard | §77–79, §110 | **LIVE + VERIFIED** — `admin_cost_intelligence()` cross-checked against a direct count; `/admin/cost` shipped | — |
| — | **Security fix** | §74, §96 | **LIVE + VERIFIED** — `0036` closed ten functions that were callable by anon. Re-probed: all denied | — |

### Phase 2 — corrected and built, 2026-08-30

Earlier in this file I declined to build shared event impacts, reasoning that removing
per-user personalisation traded a real product feature for savings that were currently
cents. **The founder corrected this directly**: the point was never today's cost, it is
removing automatic user × story AI generation *before scale makes it expensive* —
architecture decisions here are meant to target the product's scale, not today's
one-reader dataset. Built, deliberately, on that instruction.

**What was built:**

- `0028_event_impacts.sql` — `event_impacts` table (one shared row per event: `status`,
  `text`, `model`, tokens, timestamps), the same `pending`/`generating`/`complete`/
  `failed` claim shape `events.status` already uses for the analysis claim, applied to
  a smaller resource. RLS matches `event_topics`: read-only to signed-in users, no
  write policy — pipeline only. **DDL — needs manual application**, same as every other
  schema change this session (no DB password, no linked CLI). This is the one thing
  blocking Phase 2 from being live — see "Applying the migrations."
- `analyse.ts`'s JSON contract gained an `impact` field — the shared explanation is now
  written **in the same call** that understands the event, at analysis time, for
  effectively free: one extra sentence of output on a call already being made. No new
  model call for the common case. `impact` is optional in `readAnalysis` (unlike
  `what_happened`/scores) — a missing one still leaves an analysable event, because
  `digest.ts`'s backfill exists for exactly that case. 2 new tests in `analyse.test.ts`.
- `digest.ts`'s `generateOne` no longer calls a model per reader per story. It reads
  `event_impacts` for the picked events; for the (shrinking, legacy-only) backlog of
  events analysed before `event_impacts` existed, it backfills lazily — claimed with
  the exact same atomic pattern as `analyse.ts`'s `claimEvent`, so two readers whose
  digests both need the same brand-new legacy event's impact cannot both pay for it.
  An event whose impact is being written by another worker, or has permanently failed,
  is simply left out of *that* digest — `briefed_at` stays unset, so it is picked up on
  the reader's next scheduled run once the impact exists. Nothing is lost, delivery is
  deferred — same philosophy the demand gate already uses.
- Removed as dead code: `readerTopics`, `renderReader`, the old per-reader
  `DEFAULT_PROMPT`/`contract()`, and the `meterUserId`/per-user token-cap metering on
  this path — the cost is shared now, not attributable to one user's cap, matching how
  `analyse.ts` already treats its own shared spend.
- The old personalisation ("why this matters *to you*") is not gone — it moved. Story
  Ask is the explicit, on-demand, metered version of exactly that question, already
  built, unchanged by this work.

**Known follow-up, not done here:** `PLAN_LIMITS.digestModel` and `digestCapabilityFor`
in `src/lib/plans.ts` are now unused by the pipeline (nothing calls them since the
per-user digest call is gone) but were not removed — deleting entitlement config is a
bigger-blast-radius change than this phase needed, and nothing currently breaks by
leaving it. Worth removing once confirmed nothing else references it.

**Backward compatibility, per plan2 §35 and §111:** historical `digest_items` rows are
untouched — old personalised paragraphs already sent remain exactly as they were.
Nothing here rewrites history, only what gets generated from this point on.

### Phase 1 — global cached translation, built 2026-08-30

Follows `localisation-plan.md`'s scope (which is more rigorous than plan2 §39–45 and
costed against this codebase's real token measurements), and plan2's cache rule:
**one row per event per language, never per user.**

- `0029_event_translations.sql` — `event_translations` keyed on
  `(event_id, language, content_version)`, plus `notification_preferences.language`
  defaulting to `'en'` so every existing row keeps today's behaviour exactly. RLS
  matches every other global content table. **DDL — needs manual application.**
- `src/lib/languages.ts` — the six launch languages as one list the picker, the
  pipeline and both validators read. `zh-Hans`, not bare `zh`: Simplified and
  Traditional are not interchangeable and a schema storing `zh` could not express the
  difference later without migrating every cached row.
- `src/lib/pipeline/translate.ts` — lazy, cached, claimed. English returns immediately
  without a round trip (it is canonical, not a translation target). Non-English is
  served from cache or generated once, with the same conditional-update claim
  `analyse.ts` uses, so concurrent digests cannot both pay for one story.
- **`content_version` is why this is correct rather than merely working.** A cached
  translation describes a *specific* English text; `--event <id>` can retry a failed
  analysis, and any future re-analysis path would silently leave every translation
  describing text that no longer exists. Hashing the source into the key makes changed
  text miss the cache and regenerate, while already-delivered rows stay readable.
- **A bug caught while writing it, worth recording:** generation and delivery
  originally built the hash input differently (one passed `impact`, the other passed
  `null` for it). That is a *permanent* cache miss which looks exactly like a cold
  cache — translations would silently regenerate on every single send, quietly
  destroying the property this whole phase exists to protect. Both paths now go
  through one `translatable()` helper in `digest.ts`; the fix is structural, not a
  matched pair of callsites hoping to stay in step.
- Failure is degraded, never fatal: a story that cannot be translated is delivered in
  English. Delivery reads `cacheOnly` — putting a model call between a queued delivery
  and an inbox would turn a provider timeout into a failed send.
- 11 tests in `translate.test.ts` covering hash stability/sensitivity (including the
  before/after-state swap collision), refusal of partial replies, and the model's
  null-shaped words. `preferences-map.test.ts` gained language round-trip and
  fallback coverage — its existing round-trip test caught the new field immediately,
  which is what it is for.

**Not built, deliberately:** UI localisation (interface strings) is static i18n, a
separate mechanism plan2 §44 explicitly says must not be conflated with this. Story
translation is content; the app's own chrome is not. Also not built: a dedicated
`translate` AI capability — that is a fourth value in the `ai_capability` enum and
therefore DDL against an enum, so translation currently routes through `cluster`
(the cheap, high-volume tier, which is the correct choice for it anyway). Recorded
here rather than pre-empted, the same way `ai-providers.md` records the `reason`
tier's eventual split.

### Phase 3b — custom user sources, built 2026-08-30

Readers on paid plans can ask nyuz to watch a feed. **The source stays global**: two
readers following the same URL share one `sources` row and therefore one crawler, one
clustering pass, one analysis. `alice_example_feed` / `bob_example_feed` is precisely
what plan2 §12 forbids, because it would make the product more expensive as reader
overlap increases — the inverse of everything else here.

- `0030_custom_sources.sql` — `user_custom_sources` (follows), plus
  `claim_custom_source`, plus extensions to `admin_source_demand` and
  `events_with_demand` so a direct follower counts as demand. **DDL — needs manual
  application.**
- **The cap is enforced in Postgres, not in TypeScript.** RLS can say "this row is
  yours"; it cannot say "you may have five of these" without a subquery that races —
  two concurrent adds both see four rows and both succeed. `claim_custom_source` takes
  a per-reader advisory lock and decides, exactly like `claim_alert` (0017) and
  `claim_ask` already do. `user_custom_sources` has **no INSERT policy at all**, so the
  claim function is the only way in; an insert policy would be a route around the cap.
- Caps per plan2 §62: Free 0, Personal 5, Pro 25. **Pro is finite where topics are
  `Infinity`** — each custom source is a real crawler on a schedule, so "unlimited"
  would be an unbounded infrastructure commitment rather than a generous row limit
  (plan2 §18: all tiers stay bounded). Free is zero per §63: a free reader consumes the
  already-active shared network, and creating a new crawler is the one thing free
  growth must not be able to do.
- `plans-custom-sources.test.ts` (8 tests) **reads the migration file** and asserts the
  SQL caps match `PLAN_LIMITS.customSources`, that no INSERT policy exists, that the
  function is revoked from browser roles, and that the advisory lock is present. The
  two definitions drifting apart is a silent failure in both directions — a UI cap
  above the SQL cap promises a paying reader something that is then refused.
- **SSRF protection is entirely reused, not reimplemented.** `isPublicHttpUrl` rejects
  non-http(s) schemes, embedded credentials, loopback, private, CGNAT, link-local
  (which covers the `169.254.169.254` cloud-metadata endpoint) and IPv6 unique-local.
  `fetchFeed` re-validates **after every redirect hop**, so a public URL that 302s to
  `127.0.0.1` is refused at the hop. It also caps redirects, response size (2MB) and
  wall-clock time. A second implementation of any of this would be a second thing to
  get wrong.
- **The feed is fetched and parsed before the source row is created.** That is directly
  from this session's own findings: the four dead feeds `0025` disabled got in because
  the console's add form validates a URL's *shape* and never fetched it. A row that has
  never been proven to parse should not exist.
- An existing source is **not** re-fetched on follow — it has already been proven to
  parse, and re-probing on every follow would let one reader make the product hammer a
  publisher.

**Not built:** the "supported static webpage where cheap extraction works" case from
plan2 §12. Everything here is RSS/Atom, per §15 ("prefer structured sources"; do not
build expensive crawling infrastructure without evidence of demand). A page with no
feed is refused with a message saying so, which is honest and cheap.

### Phases 5 and 6 — demand-driven collection and adaptive polling, built 2026-08-30

Phase 8 stopped paying to *understand* events nobody wants. These stop *fetching* and
*over-fetching*. Fetching costs no model tokens (`architecture.md` stage 1), so this is
a **subrequest** saving — and on Workers that is a hard constraint, not an abstraction:
a free-plan invocation gets 50 subrequests and every feed fetch plus every PostgREST
call counts (`plan.md` stage 2 on `SCHEDULED_LIMIT`). A run that skips 27 zero-demand
sources is a run that reaches 27 more somebody is waiting for.

**Phase 5 (`0031`)** — `sources.last_demand_at`, `refresh_source_demand()`,
`sources_to_collect(grace_hours)`. A source is collected while it is `core`, OR wanted
now, OR was wanted within a **72-hour grace period**. The grace period is plan2 §10's
explicit requirement and prevents ON/OFF/ON thrash: a reader muting a topic on Friday
and unmuting Monday must not produce a weekend-shaped hole, and a paused source cannot
recover what it published while nobody looked — a feed only serves its current window.
`last_demand_at` is a stored timestamp rather than a computed value because "when was
this last wanted" is a fact about the past that no present-tense query can recover once
demand is gone. Backfilled to `now()` so applying the migration cannot itself cause a
collection gap. Selection returns a **reason per source**, so the run reports *why*
something was skipped (plan2 §20: observable, not merely deterministic).

**Phase 6 (`0032`)** — `sources.last_new_content_at`, `polling_tier`, a `polling_tiers`
table (cadence is data, tunable without a deploy, same reasoning as AI routes and
prompts), and `recompute_polling_tiers()`. Tiers: hot 15min, normal 1h, low 6h, cold
24h, paused weekly. **Learned, not configured** — derived from `articles.published_at`,
demand, and follows. No AI; arithmetic over timestamps.

Two ordering decisions inside it matter. **Demand is checked before publication
frequency**: a changelog that posts twice a year is exactly what a Pro reader adds, and
the one post that matters must not wait six hours. And `last_new_content_at` is stamped
**only when an insert actually happened** — stamping it on every successful fetch would
make every source look permanently fresh and the cadence would never decay.

**Backoff always beats cadence** (`isDue` uses `max`, not `min`): the tier says how
often a source *publishes*, the backoff says whether it currently *answers*. A feed
that has failed four times is not polled every fifteen minutes because it used to be
busy. 9 tests in `polling.test.ts` pin that precedence in both directions.

Both fail open. A missing flag, an unapplied migration, or an RPC error collects
everything on the old uniform interval — a collection pipeline that silently stops
collecting is a far worse failure than one that ignores an optimisation.

### Phase 7 — the skip is built, and deliberately not switched on

**The instruction was to use shadow measurements to choose conservative thresholds. On
2026-08-30 I checked, and there are none.** `deterministic_cluster_v2` had been on since
the previous day and **zero articles had been clustered in that window** — and worse,
shadow verdicts were only ever written to cron log output, which is gone by morning. So
there was nothing to measure, and no way to accumulate anything.

That made the real phase-7 blocker "measurement is impossible", not "thresholds are
unchosen". So:

- **`0033_cluster_shadow_log.sql`** — persists one row per shadowed decision:
  the deterministic verdict, what the model actually decided, and whether they agreed
  (null when the shadow was ambiguous, which must count as neither). Plus
  `cluster_shadow_summary(days)`, which splits agreement **by verdict** rather than
  blending it. That split is the point: per plan2 §25 the two directions carry very
  different risk — a wrong `different` splits an event (one extra analysis, visible as
  a duplicate, cheap), while a wrong `same` **merges two unrelated stories** and
  "silently misinforms every reader who receives it", invisibly. A single blended
  accuracy number would hide exactly the thing worth knowing.
- **`0034_cluster_skip_flag.sql`** — `deterministic_cluster_skip`, **off**. When on,
  HIGH CONFIDENCE SAME attaches and HIGH CONFIDENCE DIFFERENT creates, both with no
  model call; ambiguous still asks. Requires `deterministic_cluster_v2` as well, so
  acting on a verdict never removes the record of whether acting was right.
- `cluster.ts` gained a real `aiSkipped` count, and `modelCalls` was **corrected**:
  it counted "had a shortlist", which used to imply a model call and no longer does.
  Counting spend rather than candidates keeps the saving honest rather than
  self-reported.

**What has to happen before this flag goes on:** apply `0033`, let clustering run long
enough to accumulate a real sample, then read `cluster_shadow_summary(30)`. The `same`
rate needs to be near-perfect over a meaningful number of decisions; the `different`
rate can carry some error. If only `different` is trustworthy, the honest step is to
skip only that half — which is a code change, not this flag. Turning it on now would be
choosing thresholds from an empty table.

### What's actually live — verified against the real database, 2026-08-29

All five migrations (`0018`–`0022`) are applied. Verified with `npm run verify:v2`
(new, permanent — same spirit as `db-status.ts`: read-only, safe to run against
production), not assumed from a green build. Both new feature flags
(`pre_analysis_demand_gate`, `deterministic_cluster_v2`) are present and confirmed
**off**, exactly as shipped — turning either on is still a deliberate, separate action
nobody has taken.

**This also turned up something bigger: the docs this whole audit was built from are
stale.** `status.md` (last reviewed 26 August) describes 68 sources, 98 events, one
live reader, zero paying customers. The live database right now has:

| Measured live, 2026-08-29 | Value |
| -------------------------- | ----- |
| Sources                    | 87 (was 68) |
| Events                     | 1,771 (was 98) |
| Analysis tokens spent, ever | 706,079 (was 181,980) |
| `source_topics` rows        | 122 |

**Correction, checked further:** `admin_source_demand()` initially looked like it showed
a paid interested user, which read as "there's a paying customer" — checked further and
that's wrong. The one `plan = 'pro'` subscription row has no `stripe_customer_id` or
`stripe_subscription_id`, so it never went through checkout. Not a real subscriber.
"Zero paying customers" from `status.md` still holds. Said here plainly because the
wrong version of this was already said out loud once in this session.

Real product activity has happened between when those docs were written and now that
is not reflected in them. `status.md` should get a real refresh — not done here,
because it means re-verifying its specific claims (delivery figures, breaking-alert
counts, etc.) against live data one at a time the way the rest of that document already
does, which is a separate pass from this one.

**The topic vocabulary has also grown**, and in a direction the original docs (and this
file's earlier phases) did not anticipate: 28 topics live, not the 19 from `0006`/`0009`
— `politics`, `world`, `sports`, `film`, `music`, `health`, `economy`, `climate` now
exist alongside `claude`. 23 sources were added since `0006` to go with them —
Guardian/BBC/NPR sections, ESPN, Pitchfork — general news, not technology. That is a
real, deliberate widening of what this product covers, not something this session
initiated.

**Of those 23, 19 are live and now mapped** (`0023_source_topics_seed_2.sql`, applied
directly — `db:seed` refuses this migration's `insert ... select ... join` shape, so it
was replayed by resolving `feed_url`/`slug` in TypeScript and upserting the result;
same operation, no SQL parser to extend for one file).

**4 are dead, and were left unmapped on purpose:**

| Source | Feed | Status |
| ------ | ---- | ------ |
| Anthropic | `/rss.xml` | HTTP 404, live-checked. Same failure `0006`'s comments recorded months ago |
| Meta AI | `/blog/rss/` | HTTP 404, live-checked. Same as above |
| Andreessen Horowitz | `/feed/` | HTTP 404, live-checked. Same as above |
| Google Project Zero (`/feeds/posts/default`) | — | Redirects to the 12.9MB feed `0006` already moved away from. A working row at `/feeds/posts/summary?max-results=25` already exists and is already mapped |

Someone re-added these — most likely through the admin console's "Add source" form,
which validates a URL's shape but does not fetch it to check it parses, unlike `0006`'s
original seed which was verified with `check:feeds` before being committed. Not fixed
here: disabling them, or finding Anthropic a working feed if one now exists (it had
none as of this check), is an admin-console action, not a migration. Recorded so it
isn't rediscovered from scratch.

### The demand gate's real impact, measured — and why it's smaller than expected

Ran `events_with_demand()` (read-only, no model calls, no state changes) against the
first 1,000 of the **1,225 events currently awaiting analysis** — a real, growing
backlog: the oldest unanalysed event is from 2026-08-25, four days old, and 9 of 10
events stuck in `analysing` are stale claims well past the 15-minute reclaim window,
meaning analysis is falling behind while clustering keeps creating new events (both
confirmed running within the last few minutes). Events are being produced faster than
`ANALYSE_LIMIT = 6` per run can drain them.

**Result: only 3% (27 of 1,000) would be skipped.** Not the large saving the 70%
unmatched-events number earlier in this file suggested. The reason is structural, not a
bug: `0018` marked **all 87 existing sources `core`**, correctly preserving today's
behaviour — but `events_with_demand()` treats any event with a `core`-source article as
having demand, which is nearly every event, since almost every source is `core`. The
gate is working exactly as built; it just has almost nothing to bite on yet.

**The gate's real value is gated behind a decision only the founder can make: which of
the 87 sources are genuinely "always monitor regardless of who's reading" versus
"only worth fetching because someone asked."** That is an editorial call, source by
source, especially now that the source list spans general news (sports, politics,
music) rather than just technology.

### Reclassified 2026-08-29 — the confident subset, not the whole list

Ranked the pending backlog by source and cross-referenced with live demand. The
worst offenders: four of five arXiv research feeds alone were 417 of 1,000 sampled
pending events, at one interested reader each. Sport and entertainment coverage added
more on top.

`0024_reclassify_optional_sources.sql` moved 10 sources from `core` to `demand`:
the five arXiv feeds, ESPN, BBC Sport, Guardian Sport, BBC Entertainment, Pitchfork.
Applied and verified live: `coverage_mode` is now 77 `core` / 10 `demand`, and the
gate's measured skip rate across the **full** pending backlog went from **3% to
14%** as a direct, checked result.

**Completed 2026-08-29, `0026`:** the remaining 17 sources (general world/politics/
business/health/environment/science across Guardian/BBC/NPR, plus CISA, BleepingComputer
and Ars Technica) were also moved to `demand`. The reasoning that changed: `core` in
this schema means *deliberately curated bootstrap coverage* — the original 64 sources
in `0006`, chosen because a personalised-briefing product needs baseline event
discovery before any reader exists. It never meant "important," and this product's own
stated philosophy is personalisation-first everywhere else (`product-brief.md`: "NOT a
generic news aggregator," every topic a reader sees is one they chose). Security
content reaching an interested reader still goes through the same importance/breaking-
alert path either way — `core` status only ever controlled whether it gets pre-analysed
before anyone asks, not whether a real reader can see it.

**What stayed `core`, and why that part wasn't reconsidered:** the original 64
technology sources (OpenAI, DeepMind, TechCrunch, and so on) are this product's founding
identity, not an open question the way the general-news expansion was — 60 remain
`core` after `0025` disabled 4 dead ones from that original set. Final split: 60 `core`
/ 27 `demand`, applied and verified live.

### Both flags turned on — 2026-08-29, `0027`

`deterministic_cluster_v2`: on. Zero behavioural risk by construction — shadow-only,
never changes a clustering decision, only starts logging agreement.

`pre_analysis_demand_gate`: on. Measured, live, after `0026`'s reclassification: **28%
of the current 1,225-event backlog would be skipped** (up from 3% before any
reclassification, 14% after the first, more conservative pass). Skipped events stay
`pending` — not lost, eligible for analysis the moment a reader's interest reaches them.
Fails open on any RPC error per `loadDemand` in `analyse.ts`, so a problem here degrades
to "runs as if the gate didn't exist," never to "silently stops analysing everything."

- The demand gate's feature flag (`pre_analysis_demand_gate`) ships **disabled**.
  Turning it on before the source→topic graph has been reviewed for real coverage would
  gate analysis on a first-pass guess. Per the after-apply checklist above: review the
  seeded mapping, check the Demand column against what you'd expect, only then flip it.
- `npm install` was also run — `@block65/webcrypto-web-push` (push notifications) was
  declared in `package.json` but never installed, which silently failed 5 of 29 test
  files before this session. Unrelated to V2; fixed because it was blocking verification
  of everything else.

### A live privilege hole, found by executing rather than reading — 2026-08-30

**The most important thing in this file.** `0018`–`0035` applied cleanly, all static
checks green, 456 tests passing. Then the first live probe with the project's own anon
key found that **ten `security definer` functions were executable by an
unauthenticated caller**, including one that wrote to another user's account.

**Root cause.** `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default, and both
`anon` and `authenticated` inherit it. So

```sql
revoke execute on function f() from anon, authenticated;
```

removes a grant those roles never held directly and leaves the `PUBLIC` grant intact.
The line reads like a lock and does nothing. `0017` had the correct form all along —
`revoke all ... from public, anon, authenticated` then `grant ... to service_role` —
which is why `claim_alert`, `reserve_ai_tokens` and `purge_expired_digests` were
correctly denied when probed. Everything else in the project, including every function
added this session, copied the weaker pattern. `admin_daily_counts` had been exposed
since `0003`.

**What was actually reachable, verified by calling it:**

| Function | Exposure |
| -------- | -------- |
| `claim_custom_source` | **Unauthenticated write to another user's account.** Takes an arbitrary `p_user_id`, is `security definer`, returned `ok`, and the row was real — deleted immediately after. Also bypasses the plan cap, because the cap is evaluated against the *victim's* plan |
| `admin_daily_counts`, `admin_source_stats`, `admin_source_demand`, `admin_cost_intelligence`, `cluster_shadow_summary` | Whole-product analytics — signups, active readers, plan mix, token spend, flag state — to anyone holding the anon key, which ships in the browser bundle by design |
| `sources_to_collect`, `events_with_demand` | Pipeline internals |
| `refresh_source_demand`, `recompute_polling_tiers` | Unauthenticated writes to global source state. No attacker-controlled input, so bounded, but should not be reachable |

**No evidence of exploitation:** `user_custom_sources` held zero rows before the probe,
and the only row ever written was the probe's own.

**Fixed by `0036`**, applied and re-verified: all ten now return `401 / 42501` to anon.
Note the permission change took a moment to propagate — PostgREST pools connections, so
the first re-probe still showed the old state. Worth knowing before concluding a revoke
failed.

**Why every existing check missed it.** `security-invariants.test.ts` asserted that a
revoke line *existed* for each function. It did exist. It was simply insufficient, and
**no test that reads SQL as text can distinguish a working revoke from a useless one.**
That test now demands the `from public` form, but the real guard is
`npm run verify:live`, which executes the calls as an anon client. This is the single
clearest argument in the whole project for live verification over static checking.

### An apply-time bug caught by reading, 2026-08-30

`0030` redefines `admin_source_demand()` to add a `direct_followers` column. Postgres
**refuses `create or replace function` when the return type changes** — it fails with
"cannot change return type of existing function". The migration would have failed
on paste, after `0028` and `0029` had already succeeded, leaving a half-applied series
and a confusing error.

Fixed by dropping first (`drop function if exists` immediately before the `create`).
The whole migration runs in one transaction, so there is no window where the function
is missing. `events_with_demand` is also redefined in `0030` but keeps an identical
signature, so `create or replace` is legal there and was left alone.

Worth recording because it is invisible to every check this environment can run:
typecheck, lint, tests and build all pass with the broken version, since none of them
execute SQL.

### Applying the migrations

This dev machine has no linked Supabase CLI (`docs/plan.md` stage 1/9 — the same
constraint every prior migration hit). In order, paste into the Supabase SQL editor (or
apply via the Supabase MCP once authorised in this session):

**`0018`–`0027` are applied.** The outstanding set is `0028`–`0035`, in order:

```
0028_event_impacts.sql              shared "why it matters"
0029_event_translations.sql         cached translation + reader language
0030_custom_sources.sql             follows, plan cap, demand now counts followers
0031_demand_driven_collection.sql   last_demand_at, grace period
0032_adaptive_polling.sql           learned cadence tiers
0033_cluster_shadow_log.sql         persist shadow verdicts
0034_cluster_skip_flag.sql          the skip flag (off)
0035_cost_intelligence.sql          the /admin/cost numbers
```

Order matters: `0035` reads tables created in `0028`, `0029`, `0032` and `0033`, and
`0030` redefines a function `0020` created. Paste them one at a time rather than as one
block — the SQL editor wraps each paste in a transaction, so a failure rolls back
cleanly and you can see which file it was.

To read them out in order:

```bash
for f in 0028_event_impacts 0029_event_translations 0030_custom_sources \
         0031_demand_driven_collection 0032_adaptive_polling \
         0033_cluster_shadow_log 0034_cluster_skip_flag 0035_cost_intelligence; do
  echo "-- ===== $f ====="; cat "supabase/migrations/$f.sql"
done
```

Then confirm with `npm run verify:v2` (read-only) and open `/admin/cost`.

**Nothing changes behaviour on apply.** Every new flag ships off; `coverage_mode`,
`language` and `last_demand_at` are backfilled so existing rows keep today's behaviour.
The first real effect is Phase 2 — digests stop making a per-reader model call — which
happens as soon as `0028` is applied, because that is a correctness change rather than
an opt-in one.

<details>
<summary>Previously applied: 0018–0027</summary>

```
0018_source_topic_graph.sql
0019_source_topics_seed.sql
0020_source_demand.sql
0021_demand_gate.sql
0022_cluster_v2_flag.sql
0023_source_topics_seed_2.sql
0024_reclassify_optional_sources.sql
0025_disable_dead_sources.sql
0026_reclassify_remaining_optional.sql
0027_enable_flags.sql
```

</details>

### After applying `0018`–`0027`: what to check

This was the checklist for the first batch, kept because steps 1–3 are still the right
review and have not been done. Steps 1–2 read data that is now live.

1. `select count(*) from source_topics;` — should be non-zero (the 0019 seed).
2. Open `/admin/sources` — the Topics and Demand columns should show real data
   instead of "—". Review a handful of the seeded topic mappings against sources
   you know well; fix anything wrong right there in the console.
3. Compare the Demand numbers against what you'd actually expect given who's
   using the product today. A source showing demand you don't recognise, or a
   source you'd expect to show demand showing none, means the graph needs more
   correction before anything reads it for real.
4. ~~Consider turning on `pre_analysis_demand_gate` / `deterministic_cluster_v2`.~~
   **Done — `0027` turned both on.** The demand gate is skipping a measured 28% of the
   backlog; cluster v2 is recording shadow verdicts but, until `0033` is applied, only
   to cron output that is discarded.

---

## Remaining work

As of 30 August 2026, after live verification (52 checks, 0 failures). Everything
below is real; nothing is padding.

### 1. V2 engineering work still required

Small, and none of it is architectural — the architecture is done and verified.

- **Nothing is required for correctness.** All 40 §121 criteria are LIVE + VERIFIED,
  BUILT BUT NOT LIVE (three flags deliberately off), or PARTIAL pending measurement.
- **`ANALYSE_LIMIT` versus event creation rate.** The backlog is 1,254 and growing:
  the cron drains 6 per half-hour while clustering creates more. The demand gate cuts
  *waste*, not *throughput* — it now skips ~6 in 6 on general-news batches, which
  helps, but the arithmetic still does not close. Raising the limit or the cadence
  costs more per hour, so it is a spend decision, not an engineering one.
- **Stale `analysing` claims.** Nine of ten events stuck in `analysing` are past the
  15-minute reclaim window. Self-correcting by design; worth watching that the count
  does not grow, which would mean the reclaim is not firing.
- **Optional, deferred by choice:** removing `PLAN_LIMITS.digestModel` and
  `digestCapabilityFor`, now unused by the pipeline since phase 2. Left in place
  because deleting entitlement config has a wider blast radius than the phase needed.

### 2. External / manual actions only you can do

- **Turn on `demand_driven_sources` and `adaptive_polling`** when you want them. Both
  are live, correct and verified in their computed form; only the behaviour is gated.
  Check `/admin/cost` first — it shows what each would do before it does it.
- **Review the seeded source→topic mapping.** Still not done. `0019`/`0023` were a
  first pass written from source names, and the demand numbers rest on it being
  roughly right. `/admin/sources` → Topics column.
- **Decide the general-news question.** 27 sources are now `demand`, including all
  general news and the security feeds. If that is wrong for the product, it is one
  migration to move them back.
- **Rotate nothing, but know this:** the anon key was never leaked by the `0036`
  hole — the key is public by design. What was exposed was what that key could *do*.
  No rotation is needed.

### 3. Launch blockers, unrelated to V2

Unchanged, untouched by any of this work, and all requiring credentials.

- Stripe live mode — no real payment has ever run through the webhook.
- `RESEND_FROM_EMAIL` is still `onboarding@resend.dev`; a stranger cannot receive mail
  until a verified domain exists.
- `VITE_SITE_URL` must be the real origin in production.
- Production `STRIPE_WEBHOOK_SECRET` differs from the CLI one.
- No Cloudflare deploy has happened. The build artifact is the only evidence the
  Worker is deployable.

### 4. Intentionally deferred until real usage data exists

These are not oversights. Each needs evidence that does not exist yet.

- **`deterministic_cluster_skip`.** `cluster_shadow_log` is empty. Read
  `cluster_shadow_summary(30)` once clustering has run for a while. The `same` rate
  must be near-perfect over a meaningful sample — a wrong `same` merges two unrelated
  stories invisibly. A wrong `different` only costs a duplicate. If only `different`
  proves trustworthy, skip only that half, which is a code change rather than a flag.
- **Translation.** Schema live, keying proven, zero rows. Nothing generates until a
  reader picks a non-English language. Quality per language then needs a native
  speaker, not a test — `localisation-plan.md` says so and it is still true.
- **Custom-source SSRF in anger.** The protections are proven code reused unchanged,
  but no hostile URL has been submitted through the new path.
- **Concurrent translation.** The claim is identical to the analysis claim, which *is*
  proven live under real concurrency. Translation has not yet run twice at once.
- **Pricing v2 ($19/$29/$39).** Grandfathering is built and tested; no live price was
  touched. This is a revenue decision, not an engineering one.
- **Performance at 1K/10K/100K readers** (§98). Needs a seeded database this
  environment cannot create.

---

## Resolved questions

- [x] Prioritise the source/demand side, or wait for scale? **Now** — sources and
      users grow together.
- [x] Who seeds `source_topics`? First pass written and applied; correctable in the
      console.
- [x] Is multi-language near-term? **Yes** — built, six languages.
- [x] Should phase 2 happen despite small current cost? **Yes** — the point was
      removing the per-user call before scale made it expensive. Done, and it costs
      zero extra tokens.
