# The briefings have been shipping without their shared explanations (2026-10-12)

Found while investigating the 22:30 failures
([briefing-slot-failures.md](briefing-slot-failures.md)); it is a different failure, on the same
critical path, and a worse one for the reader: it is not that the briefing fails to arrive, it
is that what arrives is thin.

**Provenance.** Read-only census over the live project, 2026-10-12: `digests` (every briefing),
`digest_items` (all 1,145), `event_impacts` (584 distinct events), and `ops_status`.

## 1. What was measured

|                                                            |             |
| ---------------------------------------------------------- | ----------- |
| briefing items ever published                              | **1,145**   |
| items shipped with an **empty** `why_it_matters`           | **69** (6%) |
| of those, with **no `event_impacts` row at all**           | **67**      |
| of those, with a row that exists but is `failed`/`pending` | 2           |

69 items across 1,145 does not sound like much until they are put on a calendar, because they
are not spread out — they cluster:

| briefing       | items | empty  |
| -------------- | ----- | ------ |
| **2026-09-30** | 25    | **25** |
| **2026-10-01** | 25    | **24** |
| 2026-10-08     | 16    | 12     |
| 2026-10-09     | 9     | 8      |

**On 2026-09-30 every single story in the briefing — all 25 — was published with no "why it
matters".** On 10-01 it was 24 of 25. Those are not thin briefings; they are briefings without
the thing that makes them briefings.

## 2. The cause: the explanation writer has produced nothing since 2026-09-13

The newest `event_impacts` rows, read directly:

```
2026-10-01T06:24:44  event 0641a30e  status: "failed",  text: null
2026-10-01T06:24:41  event e012bb83  status: "failed",  text: null
2026-10-01T05:01:16  event d692b08f  status: "pending", text: null
2026-10-01T05:01:15  event 5221f9db  status: "pending", text: null
2026-09-13T14:55:53  event dcdb675d  "For a buyer building a high-end AMD gaming PC, ..."
```

**The most recent explanation actually written is 2026-09-13.** Everything after it is either
absent or a row recording a failure. So for roughly four weeks the shared explanation — one
sentence per story, the product's whole promise that a story is _told_ to you rather than
handed over as links — has not been generated at all.

The cause is recorded, in the app's own health row, and it is money:
`ops_status.impact:writer` has sat at **`warning` since 2026-10-01** with
`402 Insufficient Balance`. `ai:settle:error` has sat at **`error` since 2026-09-12** (30 days)
for `deepseek-v4-flash`. This is R1 item 7 in its exact shape — _"an `ops_status` error sat 29.6
days"_ — now measured at **30 days**, with a second row at 11 days, and neither reached a human.

## 3. Why the briefings are mostly not empty anyway — and where it breaks

`digest.ts` does not depend on the writer to produce a line. `reasonFor` (the ladder in
`inclusion.ts`) builds an inclusion sentence from the event's **own stored fields** — the
stored impact if there is one, otherwise the before/after state, the independent-source count,
the extracted evidence. That is why 1,076 of 1,145 items still carry a real line, and why the
digest row records `"N storys using a derived inclusion line"` on every briefing from
2026-09-13 to 2026-10-07.

The ladder is a fallback, not a replacement, and it is **partial by design**: when a story has
no stored impact _and_ nothing in its stored fields for any rung to stand on, `reasonFor`
returns an empty string and the item ships empty —
`why_it_matters: byImpact.get(brief.eventId) ?? ""`, which is what the code already calls
"thin-brief materiality, recorded not acted on". The `bare` count exists on the digest row
precisely so this could be measured before it changed anything.

So the correct reading is not "the fallback is broken". It is: **the primary source has been
dead for four weeks, and the fallback silently absorbed three weeks of it before it ran out of
stories it could cover.** 2026-09-30 is the day it had nothing left to stand on.

## 4. What this means for the order of work

- **Owner-side, and blocking:** the AI provider balance. This is the third independent
  account-level blocker on the critical path, beside the two email secrets and the Stripe price
  variables, and it is the one with the largest reader-visible cost so far.
- **Not a ruling, an observation:** the fallback's coverage is the difference between a thin
  briefing and a normal one, and nobody could see that from the outside while it was working.
  Widening the ladder is a rule change and would need a ruling; this file does not propose one,
  because the first fix is to make the writer work again and then re-measure.
- **Code change made:** none, for this finding. It changes no behaviour.

## 5. What is not claimed

Not claimed: that the derived line is a defect. It is deliberately designed, documented in
`inclusion.ts`, and counted on every digest row — and on this evidence it is the reason most
readers still got a usable briefing through four weeks of a dead provider account. Not claimed
either: that 69 items is the whole reader-visible cost; it is the part that is _measurable_ as
absent text, and a derived sentence standing in for a written one is a quality difference this
census cannot score.
