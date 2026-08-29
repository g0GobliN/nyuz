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
| Generate + deliver       | `src/lib/pipeline/digest.ts`, `src/lib/server/email/`           | `digests`, `digest_items`, `deliveries`                           | Cron `*/5 * * * *`                   | Built | **The one live gap** — see below |
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

### The one live gap plan2 correctly identifies

`digest.ts` writes `digest_items.why_it_matters` — **one model call per person per
story, automatically, every digest.** That is exactly the "automatic user × story AI"
plan2 §34 wants removed. It is real today, not hypothetical, and `ai-providers.md`
already labels it "the only stage that scales with subscribers." Story Ask already
exists as the on-demand replacement path plan2 §36 asks for. This is the one place
where plan2's diagnosis matches a real, present cost line rather than a future one.

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
| 2 | Shared event impacts, stop automatic per-user AI | §32–36, §101 | Not started | none — can start now |
| 1 | Translation cache | §39–45, superseded by `localisation-plan.md` | Not started | Product decision: still wanted? |
| 3 | Source-topic graph | §11, §103 | **In progress** — `0018_source_topic_graph.sql` written, not yet applied | none |
| 3b | Custom sources, canonicalisation, SSRF hardening | §11–14, §103 | Deferred | Real demand signal materialising |
| 4 | Demand visibility (admin only, no behavior change) | §16–18, §104 | Not started, next up | Phase 3 applied + seeded |
| 8 | Pre-analysis demand gate | §29–30, §108 | Not started — the actual near-term payoff | Phase 4 trustworthy |
| 5 | Demand-driven collection (skip zero-demand sources) | §105 | Deferred | Phase 4 proven |
| 6 | Adaptive polling | §19–22, §106 | Deferred | Phase 5 |
| 7 | Cluster v2 (deterministic confidence, shadow-tested) | §25–27, §107 | Deferred | Independent, but low current payoff — 89/1017 articles already skip AI for free |
| 9 | Pricing v2 (~$19/$29/$39) | §54–61, §109 | Deferred | Explicit go-ahead + real Stripe price IDs |
| 10 | Cost intelligence dashboard (before/after) | §77–79, §110 | Partial — staff pipeline page exists; before/after framing not built | Whatever phases actually ship |

---

## Open questions

Recorded here so the next session doesn't have to re-ask.

- [x] Is there a reason to prioritise the source/demand side over "wait for scale"?
      **Resolved 2026-08-29** — yes: sources and users are planned to grow together,
      so the demand gate is a near-term concern, not a someday one. See the revised
      recommendation above.
- [ ] Priority: close the four launch blockers first, in parallel, or after phase 3/4?
      They don't conflict technically — this is about where effort actually goes next.
- [ ] Is multi-language still a near-term goal? If not, translation stays parked and
      `localisation-plan.md` stays a plan rather than a build.
- [ ] Who seeds `source_topics` once 0018 is applied — is this a job for me working
      from the existing 0006 groupings (AI labs, security, chips, gaming, etc.), or
      does the founder want to review/assign it directly through the admin page?
- [ ] Confirm: build the admin page for source→topic assignment next (task queued),
      or is there a more urgent piece of phase 3/4?
