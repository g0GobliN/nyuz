# Significance without a model: what code can and cannot say

Measured 2026-10-17 on the live reader pool (`640a69b6`), read-only. This file records a **negative
result** and the product question it leaves open. No behaviour changed by the measurement itself.

## The state it measures

Tonight's briefing, replayed with `scripts/briefing-preview.ts`: **5 cards, 0 carrying a significance
line.** The five `what_happened` paragraphs are clean, single-sentence accounts of what happened —
e.g. _AI agents being tested online reached the live systems of Indian organizations and read
business records … CERT-In said in an advisory on October 15._ The cards are not broken. They simply
never answer "why does this matter".

The ladder cannot answer it, and the reason is policy, not a bug: its three strongest rungs
(`event_impacts`, `before_state`, `after_state`) are written by the `analyse` pass, and nyuz ships no
model output. `npm run audit:rungs` on the same day, same pool:

| rung | input present |
| --- | --- |
| stored impact | 0 / 1000 |
| after-state | 0 / 1000 |
| coverage ≥ 2 publishers | 27 / 1000 |
| money consequence in evidence | 7 / 1000 |

So the only rungs a pure-code product can feed explain ~3% of the pool. The other 97% ship silent.

## The candidate that was tested, and why it failed

If coverage cannot speak, the story's own evidence might: a sentence stating that something **stopped,
started, was paused, was withdrawn, or became required** answers "what changed" without inference.
Two variants were measured on the same 400 unmatched-then-unbriefed matches, by printing the actual
lines and reading them.

1. **Unguarded** — any evidence sentence carrying a change-of-state verb: **45 / 400 = 11.3%**. Read
   by hand, roughly a third are defensible. The rest were context from elsewhere in the event: a
   jellyfish _suspended_ in a water droplet, a river _blocked_ by a landslide, tournament heritage,
   a 2011 product _halted_ in a retrospective.
2. **Entity-guarded** — the sentence must also name the event's own PRIMARY entity (the same
   `rankEntities` the twin gate uses): **20 / 400 = 5.0%**, and still about half are unusable:
   - _"The Zune was short-lived, with Microsoft halting production in 2011 …"_ — history.
   - _"Sir Ken said Russia had stopped short of 'conventional conflict' …"_ — not a state change.
   - _"Figuring out exactly how to implement such strategies will require …"_ — a conditional.
   - _"Docker advises users to review their tokens …"_ — advice, not an outcome.

A 5% yield at roughly 50% precision means ~2.5% of cards could gain a true line this way. Under the
product's own rule — **a generic or misleading line is worse than silence** — that is not a rung; it
is a source of filler that happens to fire. It was not built.

This is the second time a widened deterministic significance rule has measured at around a third
precision (the first was the 2026-10-09 consequence widening, 21 of 60 events). Two measurements is
enough to stop treating "widen the ladder" as the fix.

## What this leaves

The reader's pool is ~1,000 matches, of which ~244 are eligible and 5 pass readiness. Of those 5, the
share a code-only product can explain is bounded at a few per thousand by coverage, and the evidence
route measures worse. So one of these is true, and it is a product decision rather than a coding one:

1. **The card is complete without the block.** Headline + what happened + "why you're seeing this"
   is the product's shape, and "Why it matters" is removed from the design until a deterministic
   source exists. The reader is never shown filler, and no card is missing anything.
2. **Withhold the unexplained.** The briefing becomes the 0–2 stories a code-only product can
   explain. This is the Q4 rule the owner reversed on 2026-10-17, and it empties the brief.
3. **Change the corpus, not the ladder.** Significance by coverage needs repeat coverage; measured
   the same day, the news corpus produced only **7 same-story pairs in 96 hours** across 987
   news/RSS articles, so perfect clustering still yields ~1%. Not sufficient.
4. **Say more per story, the same way.** A `what_happened` paragraph that carries the consequence
   ("…which means…") would put the significance in the text the reader already reads, without a
   second slot. That is an editorial rule for the deterministic composer, not a new rung — and it
   needs a ruling because it changes reader-visible copy.

## The ruling

Put to the arbiter on 2026-10-17 (new chat inside the `nyuz` project), and **ruled option 1**:

> **1 — THE CARD IS COMPLETE WITHOUT THE BLOCK.** Condition: headline + factual what-happened
> sentence + provenance constitute a complete card. Remove the separate **"Why it matters"** slot
> from the shipped reader design until a deterministic, evidence-backed source can support it.

Acceptance criteria, and where each one lands:

1. **No empty significance slots, placeholder text, generic explanations, or inferred
   consequences.** The dashboard card no longer renders the block at all — a non-empty `why` in the
   payload prints nothing, and the tests now pin that.
2. **Preserve the existing factuality, attribution, deduplication and reader-quality gates.** No gate
   was touched: the twin rule from the same day still collapses the RTX trio, and readiness, the
   summary boundary and the fact ledger are unchanged.
3. **Do not withhold valid stories because significance cannot be established deterministically.**
   The Q4 reversal of 2026-10-17 stands; five cards ship.
4. **Do not inflate `what_happened` with speculative consequences.** `what_happened` is untouched.
5. **Update product documentation and tests to the revised card contract.** This file, the work log
   in [context.md](../context.md), and `story-card.test.ts` (13 tests) carry the new contract.
6. **Keep the pure-code policy absolute.** No model call, no new data, no new dependency.

**Release condition, verified.** Replaying the same reader's pool after the change: the same **5**
cards are eligible, each has a factual `what_happened` and a provenance note, and none renders an
empty or fabricated block — because none renders the block.**Scope note.** The ruling names *the card*. The email and push channels still carry the ladder's line when one exists (dormant: email is off until launch, and the alert digest reuses the stored line). They render nothing when it is empty, so they satisfy criterion 1 as they stand; this change is the dashboard card the reader actually opens. `digest_items.why_it_matters` and `reasonFor` are kept, so a deterministic source can bring the slot back without a migration.

---

## The binding change: the one shape that measured precise (landed 2026-10-18)

**The gap this closes.** With the composer clean, the reader's briefing still shipped **5 cards and
0 significance lines** — `ships with no why-line 5/5` in `scripts/briefing-preview.ts`. The three
strongest rungs are empty by policy (`stored impact 0/33`, `after-state 0/33`), the cards are
single-source (`multi-source 0/5` so the coverage rung cannot fire), and the 2026-10-17 negative
result below is about *widening* the ladder: a change-of-state verb guarded by the event's primary
entity measured 20/400 at ~50% precision.

**What was measured this time, and rejected.** Four shapes, each run over the whole live corpus of
enriched evidence (3,570 `article_evidence` rows, 3,455 events; every hit printed and read by hand):

| shape | hits | defensible |
| --- | --- | --- |
| any change-of-state verb, entity-guarded | 432 | ~1 in 5 |
| an effective-date sentence alone | 39 | ~3 in 5 |
| an effective start **and** a verb that changes what a party may do | 15 | ~1 in 2 |
| **that, tightened into the shipped rule** | **5** | **5 of 5** |

The rejected hits are the guards, one by one: a change verb inside a relative clause defines a class
(*"care plans, which mandate support for conditions such as …"*), a dated reporting frame is when the
story was *told* (*"Ivanti said on October 13 …"*), a launch date is availability (*"will launch on
October 13th starting at $349"*), a retrospective is history (*"halted production in 2011"*, *"has
passed several gun safety measures in recent years"*), a newsletter's own offer is furniture, and a
spec sheet, a review score and a price are not significance at all.

**The shipped rule** (`bindingLine`, `src/lib/pipeline/inclusion.ts`), between the money consequence
and the bare figure, because it states a consequence where "the story carries a $X figure" states
only that a number exists. It prints the story's **own evidence sentence**, unchanged, when it is
one of two shapes:

- **the effective change** — when it starts and what it does: *"The ban, which went into effect on
  Thursday, restricts ads and paid marketing messages from ByteDance …"*; *"Kicking in on October 30,
  the TOS update won’t allow businesses to opt out …"*;
- **the story's own instrument** — the subject the event is about imposing a duty: *"CERT-In's
  directions also require organizations to report cyber incidents to the agency within 6 hours."*

No new schema, no model call, no new input: the rung reads the evidence and title the ladder already
receives, and it derives the story's own names with `rankEntities` — the composer's ranker, so the
ladder cannot disagree with the article about who the story is about. Exported (`bindingLine`) and
censused by `scripts/reader-binding-census.ts`, which runs `reasonFor` rather than the predicate, so
an instrument and production cannot drift apart.

**Measured on the live pool after the change** (`npm run briefing-preview`, 2026-10-18):
`ships with no why-line` **5/5 → 3/5**, `rungs: none 4, binding 2`, `distinct why-lines 3/5`. The two
lines are the Meta terms card and the CERT-In advisory, both printed above. **The remainder is named
per card**, not left as a number: the preview now prints why each silent card is silent — *"no stored
impact; no after-state; one publisher; 12 evidence units, none stating what a change binds or when it
starts"* for both RTX Spark cards, and the same with 4 units for the Meta clarification card. Three
cards whose stored material is a specification, a launch event or a clarification have nothing a
code-only product can honestly say, and they ship unlined.

**Tests** (`src/lib/pipeline/inclusion.test.ts`, 33 in the file): the round-trip that a change and its
start date produce the line and the rung is `binding`; the instrument shape; **a card that must still
ship unlined** (both RTX cards' real evidence — spec sheet, price, launch party — asserted to
`{ text: "", source: "none" }`); the three live near-misses refused (relative clause, reporting
frame, launch date); and the ordering that money at stake still outranks it. Fail-before evidence:
with the rung's candidate removed from `reasonFor`, *"prints what a change binds, and when it
starts"* fails (`1 failed | 32 skipped`), and passes with it restored.

**What this does not claim.** The line reaches the reader through the surfaces that render
`why_it_matters` — the briefing page and, when email is on, the email; the dashboard card still
renders no significance block (the 2026-10-17 ruling stands, because the rung cannot explain most
cards). The yield is low by design: 5 events of 3,455 with enriched evidence, because precision is
the bar and every wider shape measured worse.
