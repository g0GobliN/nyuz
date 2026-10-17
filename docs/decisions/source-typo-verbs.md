# A source's own typo in a verb slot (arbiter ruling #6, 2026-10-17)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "ARBITER REQUEST 2026-10-17 #6",
`/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6ad359bd-ceb8-83e8-9b24-b7f08a188b80`, reached from this
session through the browser panel. The owner's standing instruction from the previous ruling (*"discuss
with chatgpt … dnt ask me until both get conclusion"*) is why this went to the arbiter and not to the
owner.

**Why it was asked.** The live product, read as a reader receives it on 2026-10-17 — dashboard story
`a87a7bc6`, *"Taiwan raising $4 billion to build industrial park in Texas to support US chipmaking supply
chain"* — published this sentence in its fourth published paragraph:

> Nvidia CEO Jensen Huang has even recognized some of these companies in a keynote in Taipei earlier in
> 2026, nothing the crucial part that these smaller companies play in the global AI supply chain.

The word is `noting`. Tom's Hardware's own page says `nothing` too (fetched 2026-10-17 with `curl`, the
sentence read in the response body), so it is the **source's own typo published verbatim** — not an
extraction error and not something the composer introduced. A sentence with no reading that is true is
the same class of defect as a truncated one, so it was measured rather than patched.

Measured that day on the frozen live corpus, 250 events through the production composer (the same
composer the page uses):

| measurement                                     | value                                              |
| ----------------------------------------------- | -------------------------------------------------- |
| stored sentences                                | 3,871                                              |
| stored matches                                  | 2 — the same sentence, in the excerpt and its unit |
| published sentences                             | 2,219                                              |
| published matches                               | **1**, the sentence above                          |
| cost of refusing it                             | that one sentence; the story has five others       |

Two candidate rules were measured with controls rather than one:

- `nothing` + determiner. 1 published match, but the control *"There is nothing the company can do about
  the export controls."* **matches** — grammatical English — so the narrow form is not safe.
- `nothing` + determiner + up to two words + `that`. 1 published match, **0 false positives**; the three
  controls pass: that same sentence, *"Using anything that might attract copyright lawyers is also out."*,
  *"The report said nothing about the delay."*

**The arbiter's ruling, verbatim in the parts that bind:**

> "Option 1 — Refuse the sentence at the composer gate as editorial_noise."

> "Scope: Apply only the measured pattern (b): nothing + determiner + up to two words + that. Do not
> generalize it into a grammar or typo-correction rule."

> "Eligibility: The story must remain eligible. Refusing this sentence must not reject the story, discard
> its five other paragraphs, or suppress otherwise publishable evidence."

> "No invention: Do not silently change nothing to noting, even though the intended correction is clear.
> Nyuz should not rewrite source text without a separately justified correction policy."

> "Regression tests: Pin all three supplied negative controls and verify that none matches. Verify that
> the target sentence does match."

> "Release evidence: Replay the frozen 250-event corpus using the production composer. Show that the
> target sentence is absent from published output, the story remains published with its other paragraphs
> intact, and no unrelated sentences or stories are lost. Report before-and-after counts and confirm that
> all regression tests pass."

> "Classification: Record the refusal as editorial_noise, with evidence identifying the exact pattern
> responsible."

> "Decision principle: Reject the demonstrably defective sentence, not the story. Preserve source fidelity
> without allowing a known malformed sentence into the reader-facing product."

## What landed, and how it was verified

`sourceTypo` in [src/lib/reader-evidence.ts](../../src/lib/reader-evidence.ts), one pattern and nothing
wider, wired into `editorialNoise` and charged by `unitTextRejection` as `editorial_noise` (the exact
classification the ruling asks for), with the measured comment in the code.

Release evidence, `node --env-file=.env scripts/tsrun.mjs tmp/probe-ruling6.ts` (2026-10-17, 250 live
events, production composer):

- stored sentences 3,914 → the pattern refuses **2**, both the same source sentence (excerpt and enriched
  unit).
- published sentences 2,216 → the malformed sentence published: **0**. Before: 1.
- stories 250, stories publishing a body 196 — unchanged; the affected story keeps its five paragraphs
  and its deck, and no other sentence or story in the corpus is touched by the rule.
- `npx vitest run src/lib/reader-prose-rules.test.ts` → **179 passing**, the target plus the three
  controls pinned.

## What this authorises, and what it does not

- **Authorised:** refuse a sentence at the composer gate when the measured pattern matches, as
  `editorial_noise`.
- **Not authorised:** repairing or rewriting the source's word; a general grammar or spell checker; a
  list of typo pairs; refusing anything else in the same story; treating a source typo as a reason to
  withhold a story.
