# The 69 and the 413, attributed (2026-10-12)

**Ruling implemented:** Q3 of [arbitration-2026-10-12.md](arbitration-2026-10-12.md) — the 413
built-then-discarded items must not be merged into one count; each is attributed as correctly
refused under policy, lost through execution failure, lost through a scheduling or expiry defect,
or another attributable reason. The 69 briefed items with no `why_it_matters` are audited against
the existing reader-quality rules. The target is explicitly _"not to force all 413 items to ship"_,
but _"every disposition is correct and explainable"_.

**How it is measured:** `npm run audit:backlog` (`scripts/backlog-attribution.ts`), read-only
SELECTs against the live project on 2026-10-12. It reproduces both published counts exactly —
**69 items over 69 events**, **413 items over 12 digests** — and prints one disposition line per
digest with its delivery legs and their recorded `last_error`, so every number below can be traced
to rows. Dispositions are decided per digest (the unit that was disposed of); items inherit their
digest's disposition.

## The 69 — shipped with no `why_it_matters`

| Disposition                      | Items | Meaning                                                 |
| -------------------------------- | ----- | ------------------------------------------------------- |
| no explanation produced          | 69    | the shared explanation never existed to put in the line |
| — row never written              | 67    | `event_impacts` has no row for the event                |
| — row written, text empty        | 2     | the explanation was attempted and produced nothing      |
| explanation produced and dropped | 0     | the composer had a line and discarded it                |

**Corrected the same day (2026-10-12, after re-reading the rules): none of the 69 is a confirmed
violation of the existing reader-quality rules.** The first draft of this file called all 69
violations because the landing page's sample briefing shows a "Why it matters ·" line on every
item. That was the wrong ruler. The existing rules are the inclusion ladder
([inclusion.ts](../src/lib/pipeline/inclusion.ts)), whose rung 6 is _silence_: when no rung
produces a story-specific line, `why_it_matters` ships empty **by design**, and the delivery
surfaces render around it — `email/templates.ts:392` drops the whole line when the text is empty,
and the Telegram formatter does the same. The ladder was ruled on 2026-10-08 (filler is the
defect; honest silence is not). So the correct attribution is: **69 items took rung 6**, all one
cause (67 events never had an `event_impacts` row written, 2 had one with empty text — so no rung
1–5 material existed), zero composer drops, zero policy violations. What ships is thin but honest.

**Ruled 2026-10-12 (Q4 in
[arbitration-2026-10-12.md](arbitration-2026-10-12.md)): rung-6 silence withholds the item.** The
code deferred this — the `bare` count rode the digest row "so the honesty-bar presentation can be
measured against real counts before it changes what sends" — and the measurement those words asked
for is the 69 above. The arbiter chose withholding over shipping: no rung-6 item reaches a reader,
no explanation is invented to rescue one, and every withheld item is recorded as `skipped` with a
canonical reason and its identifiers, so every disposition stays auditable. Implementation is the
next slice.

## The 413 — built, then discarded with their digest

| Disposition                           | Items | Digests | Recorded causes                                                                                                                               |
| ------------------------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| delivered, then mislabelled by expiry | 168   | 6       | 5× leg `sent` on push, 1× `sent` on email                                                                                                     |
| lost through execution failure        | 245   | 6       | 5× `Missing EMAIL_UNSUBSCRIBE_SECRET` (220 items), 1× Resend 401 invalid API key **and** missing table `public.registered_devices` (25 items) |
| correctly refused under policy        | 0     | 0       | —                                                                                                                                             |
| lost through the expiry defect alone  | 0     | 0       | every discarded digest had at least one leg created                                                                                           |
| other attributable reason             | 0     | 0       | —                                                                                                                                             |

The twelve digest ids and their leg evidence are printed by the audit; the notable ones:

- **168 items were never lost.** Six digests had an accepted leg — the reader received the briefing
  (five on push, one on email) while `expire_stale_work` later marked the digest `briefing slot
expired`. This is the status defect `reconcileDigestAfterTerminal` (landed `0ab934f`) removes: a
  digest with an accepted leg settles `sent` the moment its last leg resolves.
- **245 items were lost to credential and schema failures, not to policy or scheduling.** The
  dominant cause is a missing `EMAIL_UNSUBSCRIBE_SECRET` (five digests, 220 items — on three of
  them the push leg had no reader endpoint, so the email leg was the only route and it failed on
  the secret). One digest (25 items) failed on a rejected Resend API key **and** on
  `public.registered_devices` missing from the schema cache — that table absence is schema drift on
  the live project and is a finding in its own right.

## The ruler's own first draft was wrong, and is pinned

The first classifier filed a digest under "other attributable reason" whenever its legs failed for
_different_ reasons — which misfiled 155 items across four digests (a Resend 401 beside a missing
table is two execution failures, not a mystery). The per-leg cause now decides
(`scripts/lib/disposition.ts`), and every string the live database actually writes is pinned in
[src/lib/backlog-disposition.test.ts](../src/lib/backlog-disposition.test.ts), including the
misfiled case.

## What this closes and what it opens

- Closes step 2 of the ruling's order: both counts are attributed individually, nothing merged.
  Under the existing rules there are **zero confirmed violations** to block: the 69 are rung-6
  silence (allowed), and the 413 are accounted for disposition by disposition.
- Confirmed defects, in order of what a reader loses: (1) the digest status defect — fixed and
  landed; (2) missing `EMAIL_UNSUBSCRIBE_SECRET` — owner-side secret, same blocker as the step-1
  email proof; (3) `public.registered_devices` absent on the live schema — needs a migration check.
- The rung-6 question is **ruled**: withhold the item with mandatory skipped-with-reason
  accounting (Q4). Implementation pending — until it lands, rung-6 items still ship without a line.
- Nothing here forces an item to ship. The 245 are unrecoverable for those readers (their slots are
  past); the causes are what is fixed.
