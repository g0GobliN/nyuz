# Paid-content pages, page openings, and a welded subhead (arbiter ruling #7, 2026-10-17)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "ARBITER REQUEST 2026-10-17 #7". The
owner's standing instruction from the ruling before it (*"discuss with chatgpt … dnt ask me until both
get conclusion"*) is why the three questions went to the arbiter and not to the owner. This session lost
its browser tab to a restart, so the chat's opaque URL is not reproduced here; the ruling's binding text
is quoted below and the chat title is the pointer.

**Why it was asked.** Three reader-facing failures, each with a measurement rather than a proposal:

1. **A publisher's paid lane reached the reader.** The live pool carried
   *"NTT Global Data Centers weighs the price tag of not building fast enough"*, whose only coverage URL
   is `theregister.com/ai-and-ml/2026/10/16/sponsored-global-data-centers-…` — The Register's sponsored
   section. Its title reads exactly like a reported feature, so no title rule could see it. Measured
   2026-10-18 over all stored coverage: **48,151 articles**, **36** in a paid lane, **29 events of
   21,863** whose *every* coverage URL is paid content. Five of those 29 already had a `digest_items`
   row: three briefings (two sent — 2026-09-08 *"Register article urges CTEM as boards demand security
   proof"*, 2026-09-23 *"Why security belongs in the network"* — one failed) and **two alerts, both
   sent**: 2026-09-23 *"Closing the observability gap for the AI-ready enterprise"* and 2026-10-09
   *"Whose roadmap is your software estate running on?"*.
2. **A block could open on a reference the page never established.** Measured on the 250-event corpus
   through the production composer: **8 of 1,049 published blocks** opened that way — `That maneuver
   needed specialized hardware …`, `Those in need get financial aid for their care.`, `These constitute
   non-delivery scams …`, `This follows an investigation …`, `This largely fizzled out …`, `The result is
   that Brave users …`, `This was followed by Open Source Security …`, and the NTT block (`The report
   models three growth trajectories …`). The deck boundary has had this rule since 2026-10-10; the body
   boundary had only the per-fact adjacency repair, which cannot see a page.
3. **A subhead welded to its paragraph.** Live unit: *"The misconceptions that stall projects Two
   objections come up in almost every community consultation …"* — the seam rule already refuses a
   sentence-cased subhead, but its guard read the head's only verb form inside a relative clause as a
   clause of its own.

**The arbiter's ruling, verbatim in the parts that bind:**

> "Option 1 — Refuse at readiness when every coverage URL is a paid-content URL."

> "Use a deterministic readiness reason (`paid-content`) and do not compose or deliver the item."

> "Option 1 — Judge each body block against the title, deck, and preceding published paragraphs;
> withhold the block-opening sentence when its reference is not established there."

> "Refuse the sentence, not the story: if other paragraphs remain readable, publish them."

> "Do not repair the opening by inventing a referent; do not widen the rule past the measured class."

> "For the welded subhead, remove the relative clause before the noun-phrase verb test, and do not
> generalise that into a parser."

## What landed, and how it was verified

**Q1 — paid content.** [src/lib/pipeline/paid-content.ts](../../src/lib/pipeline/paid-content.ts) holds
one URL-path pattern (`sponsored`, `paid`, `advertorial`, `partner-content`, `brand-content`, `promoted`,
`commercial`, as a path segment), and [readiness.ts](../../src/lib/pipeline/readiness.ts) refuses an
event when **every** coverage URL matches — the ruling's all-or-nothing condition, so a story an outlet
both reported and sold space around keeps shipping. The URL now reaches the gate on both reader paths:
`ReaderSource.url` in [reader-evidence.ts](../../src/lib/reader-evidence.ts), `loadBriefs` in
[digest.ts](../../src/lib/pipeline/digest.ts), and `loadEvents` in
[alerts.ts](../../src/lib/pipeline/alerts.ts). A gate shown no URL skips the rung rather than guessing.

**Q2 — page openings.** `pageReferentKind` and `openingEstablishedOnPage` in
[reader-evidence.ts](../../src/lib/reader-evidence.ts) answer exactly three kinds of question — a plural
pronoun, a demonstrative that heads a noun, and the article's own document — against the title, the deck
and the paragraphs already published above the block. `refuseUnestablishedOpenings` in
[editorial.ts](../../src/lib/editorial.ts) runs after every block exists and in published order, drops
the sentence, charges it `unresolved_context`, and a block left under the paragraph floor is dropped
whole as `short_block`. The audit prints asked/kept/refused with the openings themselves.

**Q3 — the welded subhead.** `sentenceCasedHeadingSeam` now removes a trailing relative clause
(`that|which|who` and everything after it) before the noun-phrase verb test. The six-word bound on the
head is unchanged, so prose that merely contains a relative clause is not swept up.

Measured after, 2026-10-18:

- `npx tsc --noEmit` clean; `npx vitest run src/lib/editorial.test.ts src/lib/reader-prose-rules.test.ts
  src/lib/pipeline/readiness.test.ts` → **287 passing**.
- `npm run audit:reader` (live window, 250 events): **22 → 14** body openings asked once the rule was
  narrowed, **8 kept**, **6 refused**; `context-dependent openings 0` on the published prose;
  **`delivered with no body` 0** and **`refused then published` 0** (it was **1** before this rule).
  Cost measured in the same run: readable stories withheld 5 → **6**, stories publishing nothing 43 →
  **40** — one story withheld, three more publishing a body.
- The first run of the page rule refused **five readable singular-pronoun openings** (*"He created celld
  as an implementation …"*, *"However, it also stated, 'Our long-term objective …'"*, *"He was also at
  pains to point out …"*, *"Now, it is likely to have the new features …"*, and a `Ramp to the
  accelerated case …` block). The page test has no way to answer a singular pronoun, so those kinds are
  now **outside the judged set** and the composer never asks about them; pinned in
  `reader-prose-rules.test.ts`. Only the measured classes are judged.
- `npm run audit:alerts` (all 218 alerts ever sent): **2** now read **`gate paid-content`** — the two
  advertorial alerts above — and no other alert changes class. The alert path carries the URL for
  exactly this reason.
- `tmp/probe-paid-events.ts` and `tmp/probe-paid-delivered.ts` produced the 29/5 numbers above.

## What this authorises, and what it does not

- **Authorised:** refusing an event whose every coverage URL is a publisher's paid lane, at readiness,
  as `paid-content`; refusing a body-opening sentence whose judged reference the page above never
  establishes; stripping a relative clause before the welded-subhead test.
- **Not authorised:** refusing a story because *one* of its sources is paid content; a prose-based
  advertorial classifier; reading a missing URL as paid; inventing a referent to repair an opening; a
  grammar parser; widening the page test to singular pronouns or to definite noun phrases generally (20
  of 816 published blocks open on one whose noun the page never repeats and every one is readable).
