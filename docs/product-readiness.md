# Product readiness — every side, measured

**Rules for this file.** Every number carries its provenance: the date it was measured and the
command that produced it. It says what is **verified** separately from what is **assumed**, and a
side with no measurement says "not measured" rather than being scored on impressions. It changes no
behaviour: where a side needs a decision, the decision is named here and put to the arbiter, not
taken here.

The instrument is `npm run audit:posture` ([product-posture.ts](../scripts/product-posture.ts)) —
read-only, one run, one line of truth per side. It exists because this question ("how done is the
product?") has been answered from memory before, and a product judged from memory is judged by
whoever last read a failure log. It exits 0 even when it finds a channel dead since August: it is an
instrument, not a gate.

Everything below was measured **2026-10-12** against the live Supabase project with
`npm run audit:posture`, `npm run db:status`, `npm run billing:check`,
`npm run briefing:checkpoint -- --recent 14`, `npm run audit:alerts`, and the Supabase security
advisor for project `qdnemetjiygvpedomvba`.

## 1. The verdict, in one paragraph

Most of the product exists in code, but existence is not dependable service. The build is advanced;
launch readiness is low. The most important path, email, has been failing for weeks; billing has no
usable price configuration in this environment and has never completed a test-to-entitlement journey;
the 22:30 briefing slot discards finished briefings; security exposure is unclassified; alert status
cannot explain partial delivery; and no stranger has tested onboarding. D8's *policy* is provisionally
ruled (keep the current gate); the unanswered question is whether it distinguishes announcements from
news. D9's prose ruler is still open. **The last email accepted by any provider was 2026-08-26T22:59.
The failures were sequential, not simultaneous: 125 missing-`EMAIL_UNSUBSCRIBE_SECRET` failures from
2026-08-26T23:55 to 2026-09-11T05:45, then 128 Resend 401 failures from 2026-09-11T06:14 to
2026-10-11T12:59 (the current cause).** Push is the only channel carrying anything (110 accepted in
the measured 30-day window). No payment has ever been taken: there are no Stripe customer IDs,
`billing_ledger` is empty, and `npm run billing:check` exits 1 because the environment has old
`PERSONAL`/`PRO` price names while the code expects `PLURA`/`OMNI`.

**My rating is deliberately split:**

- **Built: 8.5/10** — broad core functionality is implemented and the previous committed tree passed
  CI, but this is a code-completeness estimate, not proof every detail works. The local full gate on
  this working tree was red from worker starvation/timeouts; see §8.
- **Exercised live: 5/10** — real pipeline and push rows exist; email, billing, Telegram and stranger
  onboarding are not demonstrated end to end.
- **Sellable today: 3/10** — the core briefing email is dead, checkout has not been demonstrated, and
  no first-time customer has completed the journey.

These are judgement scores, not a mathematically precise completion percentage. If you need one
number: **about 30% launch-ready**, because the critical path to a real paying reader is still blocked.
It does not mean 30% of the code is written.

**Rating, on three separate questions, because they have three different answers:**

| question                           | score      | basis                                                                                                                                       |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Is it built?                       | **8.5/10** | 12 of 14 surfaces built; 182 test files and 3,114 tests green; the two gaps are one missing secret and one open ruling                      |
| Has it been exercised live?        | **5/10**   | Push, ingestion, clustering, analysis, matching, alerts and the dashboard have real rows; email, Telegram, billing and the paid path do not |
| Could it sell to a stranger today? | **3/10**   | the front door is email and email is dead; no payment has ever run; sign-in for a stranger is unverified                                    |

A single "how done is it" percentage would be a made-up number. These three are what the evidence
supports.

## 2. The scorecard

State legend: **live** (real rows from real traffic), **built** (works, not yet exercised with a
stranger), **blocked** (code finished, an owner action or secret missing), **dormant** (deliberately
off in V1), **broken** (a real defect with a reproduced symptom).

| #   | side                               | state            | what was measured (2026-10-12)                                                                                                                                                                             | the gap                                                                                                                     |
| --- | ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Landing page                       | live             | 44 route files; walked by the CI route walk and the daily production health job                                                                                                                            | none found                                                                                                                  |
| 2   | Pricing page                       | built            | figures 0 / 14.99 / 29.99 in `launch-plans.ts`                                                                                                                                                             | the price cannot be charged — see 12                                                                                        |
| 3   | How-it-works                       | live             | own explaining page, not the landing's sections                                                                                                                                                            | none found                                                                                                                  |
| 4   | About / support                    | copy corrected*  | 7 FAQ answers in `support.tsx`                                                                                                                                                                             | this review corrected two inaccurate answers; final check still pending, and the legal page separately promises language choice |
| 5   | Legal (8 docs)                     | live             | one `legal/$doc` route, not console-editable by design                                                                                                                                                     | operator is an unregistered individual; needs review before money moves                                                     |
| 6   | Blog                               | live             | 2 posts, scheduled publishing without a job                                                                                                                                                                | none found                                                                                                                  |
| 7   | PWA / install                      | live             | `pwa:self-test` in CI; install contract checked daily                                                                                                                                                      | none found                                                                                                                  |
| 8   | Accessibility                      | not measured     | no automated a11y check exists (`axe` is not a dependency)                                                                                                                                                 | nothing measures it, so any claim about it is a guess                                                                       |
| 9   | Accounts / auth                    | built            | 4 profiles, 3 with a role, 1 ban, `signups_open` on                                                                                                                                                        | password reset and signup mail for a stranger are unverified (Supabase's own mailer, not Resend)                            |
| 10  | Onboarding / day one               | live             | 2 of 4 profiles finished onboarding                                                                                                                                                                        | none found                                                                                                                  |
| 11  | Plan entitlements                  | built            | caps enforced in Postgres under an advisory lock; 4 subscription rows (3 `uno`, 1 `omni`)                                                                                                                  | the docs and the code disagree about Free and alerts — see §4                                                               |
| 12  | Billing                            | **broken**       | `billing:check` exits 1: `STRIPE_PRICE_PLURA_*` / `OMNI_*` unset, `PERSONAL`/`PRO` present and no longer read; 0 Stripe customers; 1 `stripe_events` row; `billing_ledger` empty                           | checkout resolves no price in this environment, and no live payment has ever been run                                       |
| 13  | Lifecycle email                    | **broken**       | shares the email path                                                                                                                                                                                      | dead while email is dead                                                                                                    |
| 14  | Ingestion                          | live             | 87 sources, 79 active, 2 failing; 43,706 articles; 15-minute cron; `ops_status` records the 2 feed failures                                                                                                | none found                                                                                                                  |
| 15  | Clustering                         | live             | 18,771 of 43,706 articles in an event                                                                                                                                                                      | 24,935 unclustered (57%)                                                                                                    |
| 16  | Analysis                           | live, behind     | 9,689 events analysed; 305 in 24h                                                                                                                                                                          | 8,347 awaiting (7,273 eligible), 555 failed; intake outruns drain on busy days — see §3                                     |
| 17  | Matching / topics / custom sources | live             | 4,572 `user_events`, 795 matches in 7 days, 36 topics                                                                                                                                                      | none found                                                                                                                  |
| 18  | Cost governance                    | live             | monthly reservation ledger, global token budget, `ai:budget` healthy, 12 flags on                                                                                                                          | `ai:settle:error` has been an `error` row for 29.6 days                                                                     |
| 19  | Briefing assembly                  | built            | 22 briefings `sent`, 15 `skipped` honestly, 3 `scheduled`                                                                                                                                                  | 17 `failed` in 45 days — see §3                                                                                             |
| 20  | **Email delivery**                 | **broken**       | last accepted 2026-08-26T22:59; 0 accepted in the 30-day window (every email attempt failed); two causes in sequence, 26 Aug → 11 Oct: 125 `missing EMAIL_UNSUBSCRIBE_SECRET` (26 Aug → 11 Sep), then 128 `Resend 401` (11 Sep → today, current) | two sequential causes; `EMAIL_UNSUBSCRIBE_SECRET` is still absent from this environment; `RESEND_FROM_EMAIL` is `onboarding@resend.dev` |
| 21  | Push                               | live             | 110 accepted in 30 days; 8 registered devices                                                                                                                                                              | 5 failures from a schema-cache miss recorded on 2026-09-12 (now resolved: the table exists)                                 |
| 22  | Telegram                           | dormant          | 1 account row, **0 deliveries ever**                                                                                                                                                                       | linked but never used; webhook configuration unverified                                                                     |
| 23  | Breaking alerts                    | live, partial    | 133 sent / 69 `ready`, 206 ever; every alert reached push; 9 in one day (2026-09-25)                                                                                                                       | D8 policy ruled provisionally: keep gate; investigate news/announcement discrimination and partial-status semantics          |
| 24  | Read page / article                | live, under work | composer + fact ledger; must-be-zero lines at 0 on the frozen 200                                                                                                                                          | D9: five reader-visible defects a human found and the audit does not count                                                  |
| 25  | Dashboard, history, feedback       | live             | 17 feedback rows, 1 saved story                                                                                                                                                                            | none found                                                                                                                  |
| 26  | Admin console                      | live             | 15 admin routes, 1 audit-logged ban, roles read server-side per call                                                                                                                                       | none found                                                                                                                  |
| 27  | Site content + flags               | live             | 21 flags, 3 site settings, 2 posts edited from the console                                                                                                                                                 | 4 obsolete flags (`ask_nyuz`, `story_translation`, `deep_explain`, …) still flippable with no effect                        |
| 28  | AI routing                         | live             | `cluster` → flash/2048, `digest` → pro/4096, `reason` → pro/8192, resolved per call                                                                                                                        | none found                                                                                                                  |
| 29  | Observability / health             | built            | `ops_status` (16 rows) + daily `health.yml` + admin diagnostics and delivery-health                                                                                                                        | no error-tracking service; nothing alerts a human when an `error` row appears — `ai:settle:error` has sat for 29.6 days     |
| 30  | CI / tests / deploy                | live             | `npm run ci` green on `b9d4d38`; deploy is gated on it                                                                                                                                                     | none found                                                                                                                  |
| 31  | Security / RLS                     | **at risk**      | Supabase advisor: 19 `SECURITY DEFINER` functions executable by `anon`, 19 by `authenticated`, 31 tables with RLS and no policy, 10 functions with a mutable `search_path`, leaked-password protection off | the 2026-08-30 hole was this same class; each of the 19 needs classifying, not assuming                                     |
| 32  | Story Ask                          | dormant          | flag off, zero allowance on every plan, 10 historical `ask_log` rows                                                                                                                                       | by design                                                                                                                   |
| 33  | Translations                       | dormant          | flag off, language panel deliberately hidden                                                                                                                                                               | by design — but the support FAQ still promises it (see 4)                                                                   |
| 34  | WhatsApp                           | absent           | not implemented, rejected by plan enforcement                                                                                                                                                              | by design                                                                                                                   |

## 3. The two live defects worth naming as defects

**Email has two causes in sequence, and only one of them is recorded anywhere.** `docs/context.md`
blames the Resend key. The first failure after the last accepted send is
`Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32 characters)` on 2026-08-26T23:55, and that class runs
unbroken to 2026-09-11T05:45 — **125 failures**. The Resend 401 takes over at 2026-09-11T06:14 and
runs to 2026-10-11T12:59 — **128 failures, and it is what is happening today**, which is why the
secret stopped appearing: it was set in production somewhere around 11 September. It is *still*
absent from this environment's `.env` (`EMAIL_UNSUBSCRIBE_SECRET in env: no`, checked 2026-10-12), so
a laptop run and the Worker do not currently fail for the same reason. A fresh Resend key is the fix
for the live outage; the local environment needs the secret too before it reproduces production.

**The 22:30 slot fails systematically, and it throws away finished briefings.** Of 17 failed
briefings in 45 days, 16 are the 22:30 slot. Ten say `briefing slot expired; not sent` and five say
`missed slot by 120–126 minutes; not sent` — and in ten of those a briefing had already been built,
**336 items discarded**. A late-generated briefing is refused rather than sent late, which is a
defensible rule, but a reader whose delivery time is 22:30 has received nothing on those days. The
`00:13` row shows the same shape once outside that slot. Not yet explained: why generation lands
~two hours after the deadline.

## 4. The small sides, which are still sides

- **The support page had two inaccurate answers; this review corrected them in source, pending final
  checks.** Translation is not in V1 and the language panel is hidden; the answer now says so. Alert
  limits are now stated as 1/day Uno, 5/day Plura, 12/day Omni. The legal page still promises language
  choice; legal text is a separate legal commitment, not changed here.
- **Three sources disagreed about Free and alerts** (`context.md`, `status.md`, `launch-plans.ts` +
  `plan-copy.ts`). The arbiter ruled one important alert/day; this review corrected the two docs.
  The entitlement itself was not changed.
- **`status.md` remains stale in the places a reader would trust**: it records the V2 flags as off
  (`demand_driven_sources`, `deterministic_cluster_skip`) and they are on; its counts are August
  figures. The alert-entitlement line was corrected in this review.
- **`69` alerts sit at status `ready`** although each has a delivery row with push accepted and
  email failed. The status is not wrong so much as unreadable: an operator reading `db:status` sees
  "ready 70" and cannot tell that the alert reached the phone and only the email leg failed.
- **Some flags may be obsolete but this review did not establish an exact count.** `ask_nyuz_enabled`,
  `story_translation_enabled` and `deep_explain` (superseded by `understand_on_demand`) appear to have
  no active effect; verify every flag's callers before removing or hiding any. Do not repeat the earlier
  unverified claim of "four".

## 5. What this read did not measure

- **No stranger has used it.** 4 profiles, 1 seen in the last 7 days, 0 waitlist signups. Every
  "live" verdict is the operator's own account exercising the path.
- **Nothing about the reader's visual experience** — no accessibility run, no browser walk of the
  dashboard or a story page in this session (the CI Playwright suite covers the public pages,
  sign-in to its address step, and the billing toggle).
- **Nothing about the paid path end to end**, because no payment has been run. Billing is judged
  from test-mode coverage and configuration.
- **Telegram delivery**, beyond the fact that no row exists.
- **DeepSeek's live balance.** `ops_status` recorded a `402 Insufficient Balance` warning on
  2026-10-01; whether the account has credit today was not checked, and the budget ledger reads
  `available` with 0.06% of the cap spent.

## 6. The case put to the arbiter (2026-10-12) — RULED

Sent to the owner's ChatGPT `nyuz` project as one message: the scorecard, the evidence, and these
numbered questions, each with a recommendation.

1. **Order of work.** Does the blocking set (the two email secrets, the verified sending domain, the
   Stripe price variables, one live payment) take precedence over finishing D8/D9, or do those open
   rulings continue in parallel? _(Recommendation: the blocking set first — it is the only work that
   changes whether a stranger can be served at all, and it needs the owner, not a ruling.)_
2. **The alert floor (D8), still open.** Options (a)–(d) are recorded in
   [decisions/reader-delivery.md](decisions/reader-delivery.md). With the gate landed, alerts still
   reach phones for shapes no rule refuses, and 9 fired in one day.
3. **Free and alerts.** `context.md` and `status.md` say Free has none; the code says one a day and
   the plan copy says so to the reader. Which is the product?
4. **The support page's untrue answers.** A false support answer is copy, and copy is a decision —
   but it is also currently false. Fix the two answers now, or hold for a ruling?
5. **The 19 anon-executable `SECURITY DEFINER` functions.** Classify all 19 and revoke the ones not
   meant to be public, or first bring back a classification for a ruling?
6. **The 22:30 slot.** Investigate why generation lands ~120 minutes late, as its own slice, or treat
   "a late briefing is refused" as the intended behaviour and change the copy instead?
7. **What "done" means per side.** Does each side get an acceptance line (a number that must hold),
   or is the must-be-zero style reserved for the reader path only?

**The ruling arrived the same day** and is recorded verbatim in
[decisions/product-readiness.md](decisions/product-readiness.md) (R1). In short: **the blocking set
comes first** (email including _both_ secrets, Stripe configuration plus a test payment, the 22:30
investigation, stranger sign-in, Telegram exercised or declared inactive), D8/D9 continue only where
independent, **the alert floor stays as it is** while the gate's ability to separate news from
announcements becomes the next evidence question, **Uno keeps one alert a day** and the documents
change instead, **the support copy is corrected** (done), **the 19 functions are classified before
any grant changes** (not yet done), **the 22:30 lateness is investigated rather than normalised**,
and **every side gets an acceptance line** (§7), with the reader path keeping its stricter
must-be-zero rules.

## 7. Acceptance lines — one per side (ruled 2026-10-12)

Ruled as criteria to formalise, **not claims the system already satisfies**. Each side fails on its
own line; the reader path keeps its must-be-zero gates where correctness requires them. **✓** means
met as measured by this review, **~** partially met, **✗** open. The number follows the evidence
rather than being chosen to look good.

| side                      | acceptance line                                                                                              | state 2026-10-12                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Ingestion                 | source failures are visible, attributable and inside an explicit operational target                          | ✗ 2 active failing sources, visible in `ops_status` and on the console                          |
| Clustering                | unclustered articles measured against a defined expectation; duplicates and wrong merges sampled and audited | ✗ 24,935 unclustered, no defined expectation                                                    |
| Analysis                  | eligible / awaiting / failed / complete reconcile, and failure causes are attributable                       | ✗ 555 failed with no attribution                                                                |
| Matching                  | outcomes measurable; wrong or missing matches audited against an explicit test set                           | ✗ no test set                                                                                   |
| Briefing assembly         | every generated briefing is sent, skipped honestly, or accounted for by a named reason                       | ✗ 17 failed / 336 items discarded                                                               |
| Email                     | a real briefing completes the configured path with provider acceptance **and** delivery outcome observable   | ✗ last acceptance 2026-08-26                                                                    |
| Push                      | accepted, failed and undelivered notifications all accounted for                                             | ~ 110 accepted, 5 failures each with a reason, but partial delivery has no status of its own    |
| Telegram                  | the path is demonstrated end to end, or the channel is explicitly declared inactive                          | ✗ 0 deliveries ever, not declared                                                               |
| Billing                   | checkout, webhook, entitlement change and failure paths pass end-to-end tests                                | ✗ no live payment, config unread                                                                |
| Alerts                    | eligibility, channel outcome, dedup and final status reconcile                                               | ✗ `ready` cannot express partial delivery                                                       |
| Reader quality            | the deterministic gates hold; unsupported or prohibited output does not pass                                 | ✓ must-be-zero lines 0 on the frozen 200 (D9 open)                                              |
| Security                  | intended access documented, unintended access removed, remaining findings tracked                            | ✗ 19 functions unclassified                                                                     |
| Support and documentation | published claims agree with functionality and plan entitlements                                              | ~ two ruled answers corrected in this commit; `legal/$doc.tsx` still promises a language choice |
| Accessibility             | a defined automated check plus a manual set pass, limitations recorded                                       | ✗ nothing measures it                                                                           |
| Observability             | operational failures are detectable, attributable and surfaced to someone responsible                        | ✗ recorded but not surfaced (29.6-day error row)                                                |

Zero unexplained delivery outcomes is defensible; zero unclustered articles may not be — which is
why the numbers are set after the baseline is measured, not before.
