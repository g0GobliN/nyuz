# R1 — the product-wide readiness ruling (2026-10-12)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "Readiness review summary"
(`/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6acc2fc0-6434-83e8-90e4-e97cdc60f2d0`), reached
from this session on 2026-10-12. It is quoted here rather than paraphrased, because a ruling
reworded into something easier to build is not the ruling.

**What was put to it.** The measurement, not a proposal: [product-readiness.md](../product-readiness.md),
produced by the new read-only instrument `npm run audit:posture`, plus `db:status`, `billing:check`,
`briefing:checkpoint -- --recent 14`, `audit:alerts` and the Supabase security advisor. Seven
numbered questions, each with a recommendation. Nothing changed in the code before the ruling
arrived.

**The arbiter's opening ruling, verbatim:**

> "My ruling: the blocking set comes first, security gets a classification pass before any
> revocations, and every product side gets a measurable acceptance line. We should not confuse code
> completion with product readiness, and we should not change behaviour just to make the dashboard
> look healthier."

## Q1 — order of work

**RULED: blocking set first.** D8/D9 may proceed in parallel _only_ where the work does not compete
with the owner actions or obscure the current measurements. The arbiter stated the execution order
and its acceptance:

> 1. Restore email delivery, including both the Resend credentials and `EMAIL_UNSUBSCRIBE_SECRET`.
>    Replace the test sender address with an appropriate production sender.
> 2. Fix the Stripe configuration and verify the complete payment-to-entitlement path using an
>    appropriate test transaction before attempting a live charge.
> 3. Investigate the 22:30 briefing failures. Do not silently accept discarded briefings as normal.
> 4. Verify stranger sign-in and the end-to-end first-user experience.
> 5. Exercise Telegram or explicitly classify it as an unsupported or inactive channel for this
>    release.
> 6. Continue D8/D9 in parallel only where the work is independent.

> "Acceptance: A production email is accepted by the provider **and** verified as delivered; a test
> payment completes and produces the correct entitlement. Provider acceptance alone does not prove
> inbox delivery, and a successful checkout alone does not prove the paid product works."

The three ratings (built 8.5/10, exercised live 5/10, sellable 3/10) were accepted as describing
three different things, with the priority stated plainly: _"The priority is not to improve the first
score. It is to establish evidence for the third."_

## Q2 — the alert floor (D8)

**RULED: (a) gate only, provisionally.** No higher floor, no mandatory outlet count, no blanket
first-party exclusion — the measurement (a floor of 8 removes seven of eight non-news interrupts and
seven genuine ones with it) makes it too blunt a trade, and option (c) contradicts D5.

> "This ruling does not declare the alert quality problem solved. It preserves the current policy
> while the evidence remains insufficient to justify a stricter one."
> "The remaining question is whether the current gate adequately distinguishes news from
> announcements. The measurement you provided does not establish that it does."

D8 is therefore **closed as a policy question and re-opened as an evidence question**: the gate
stays exactly as it is, and what is wanted next is a measurement of whether the gate separates news
from announcements at all.

## Q3 — Free and alerts (the three-way divergence)

**RULED: one important alert per day for Uno** — the code (`uno.alertDailyCap = 1`) and the
reader-visible plan copy agree; the conflicting documentation is what changes.

> "Keep the one-alert daily allowance. Correct context.md and status.md to reflect the actual policy.
> Verify that the enforcement path honours the allowance, not just the UI. Do not interpret an
> allowance of one as a guarantee that an alert will be generated every day."

Acceptance: _"An Uno user cannot receive more than one eligible alert per day through the enforced
product path, and the documented and displayed allowance agrees with the implementation."_
Done in this commit: both documents corrected. Enforcement verified 2026-10-12 on this tree:
`npx vitest run --coverage src/lib/launch-plans-db.test.ts` → 1 file, 19 tests, all passed
(the cap is Postgres-enforced by `claim_alert`).

## Q4 — the two untrue support answers

**RULED: fix the copy now.** _"This is not a decision to expand or reduce the product. It is a
decision to describe the existing product truthfully."_ Acceptance: _"Every support answer
describing an available feature agrees with the current implementation and published plan policy.
No unsupported capability is presented as available."_ Done in this commit
([support.tsx](../src/routes/support.tsx)).

## Q5 — the 19 anon-executable `SECURITY DEFINER` functions

**RULED: classify all 19 first, then revoke inappropriately granted access.** No blanket
revocations without understanding the intended callers. For every function the classification must
establish purpose, intended callers, data exposure, whether it enforces the caller's permissions on
its own, its search-path safety, and the decision (keep public, narrow, or redesign). The 31
RLS-enabled-no-policy tables, the 10 mutable `search_path` functions and the disabled leaked-password
protection are **separate findings** and get their own classification.

> "Do not claim the entire database is secure just because the original 19 findings disappear."

**Not implemented in this commit**: classification first is the ruled order.

## Q6 — the 22:30 briefing failures

**RULED: investigate the lateness as its own slice; do not normalise the failure in copy.** The
investigation must distinguish three hypotheses — generation is late, scheduling/queueing is late,
or the deadline calculation is wrong — by tracing the timeline of the affected runs (scheduled time,
actual start, stage durations, completion, expiry calculation, retries, disposition) and comparing
against successful slots with the same instrumentation.

> "Do not retain or deliver expired briefings merely to improve delivery statistics. Equally, do not
> treat discarded work as an acceptable steady state until its cause is understood."

Acceptance: the 22:30 failure rate is measured against a defined sample and window, and after the fix
the slot meets an explicit reliability target. _"I am deliberately not setting a numerical target
until the lateness mechanism and baseline are understood."_

## Q7 — acceptance lines for every product side

**RULED: yes, every side gets a measurable acceptance line**, while the reader path keeps its
stricter must-be-zero rules wherever correctness requires them. The arbiter's own starting table is
recorded as §7 of [product-readiness.md](../product-readiness.md) — acceptance criteria to formalise,
_"not claims that the system already satisfies them"_. Numbers follow the evidence: _"A target of
zero unexplained delivery outcomes, for example, is defensible. A target of zero unclustered
articles may not be."_

## Two more rulings the arbiter volunteered

**Alert `ready` status semantics — investigate as a defect.** The 69 alerts sitting at `ready` while
push succeeded and email failed suggest the status conflates overall alert completion with one
channel's state. _"Do not relabel those records as successfully delivered through every channel."_
The target is a status model that distinguishes successful delivery, partial delivery, failed
delivery and genuinely pending — at minimum.

**Observability — make failures actionable, not merely recorded.** An `ops_status` error persisting
29.6 days and a balance warning persisting 10.8 days show that _"recording a failure is not the same
as operating a monitored service."_ The first step is not necessarily buying an error-tracking
service; it is establishing that critical failures reach a responsible person within a defined time,
and making failure detection part of the acceptance criteria for the restored email and billing
paths.

## Evidence correction to this case (2026-10-12, after the ruling)

The case as sent said the 30-day email failures split "110 missing secret / 92 Resend 401". That
split was **misattributed**: those were the 45-day counts over the *alert* legs, not the 30-day email
total. Measured per cause and per date, the real sequence is:

| cause | failures | first | last |
| ----- | -------- | ----- | ---- |
| `Missing EMAIL_UNSUBSCRIBE_SECRET` | 125 | 2026-08-26T23:55 | 2026-09-11T05:45 |
| `Resend 401` | 128 | 2026-09-11T06:14 | 2026-10-11T12:59 (current) |

The two causes are **sequential, not concurrent**: the secret was evidently set in production around
11 September, which is why that class stops, and the invalid key is what is failing now. Nothing has
been accepted by the provider since 2026-08-26T22:59 either way. The correction was sent back to the
arbiter in the same thread rather than absorbed silently, because the ruling's Q1 requirement (both
credentials present, plus a production sender) was formed on the wrong split — it turns out to be the
right requirement anyway, and the arbiter confirmed it changes nothing. One addition the correction
carries: `EMAIL_UNSUBSCRIBE_SECRET` is still absent from this checkout's `.env`, so a local run and
the Worker **do not fail for the same reason**, and a laptop cannot reproduce production's failure.

## What this ruling authorises now, and what it does not

| authorised in this commit                                      | not authorised / queued                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The posture instrument and the measured readiness document     | Any grant or policy change from the security findings (classify first)                                      |
| The two support copy corrections (Q4)                          | The 22:30 fix (investigation slice, with its own evidence)                                                  |
| The Free/alert correction in `context.md` and `status.md` (Q3) | The alert floor (ruled: keep it) and the D8 evidence question (open)                                        |
| The per-side acceptance lines recorded (Q7)                    | Email/Stripe/Telegram configuration (owner actions; the top of the order)                                   |
| —                                                              | `legal/$doc.tsx` also promises a language choice; legal copy is a legal commitment and needs its own ruling |
