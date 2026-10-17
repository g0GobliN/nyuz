# The dangling document reference: two refused repairs

**Status: open, no code shipped.** This file records what was tried on 2026-10-17 and why both
attempts were reverted. It exists so the next session does not spend a loop rediscovering that
refusal is the wrong lever for this defect.

## The defect

`npm run audit:reader`, live corpus, 1,855 sentences read, 2026-10-17. Every must-be-zero counter is
**0** — delivered with no body, refused then published, refused then published by another path,
confirmed quote defects. Exactly **one event carries a reader-visible defect**:

```
context: NTT Global Data Centers weighs the price tag of not building fast enough
deck: Bruno Berti, CTO at NTT Global Data Centers, notes that he has watched the size envelope
      stretch beyond recognition.
  1. The report models three growth trajectories through 2030 and stress-tests each against the
     constraints operators hit, such as land availability, water consumption, specialized labor …
```

The page never says which report. That is the defect class the product bans in its own words — _a
paragraph that opens on a reference the page never establishes_ — and it survives
`contextDependent`, which reads pronouns (`this`, `they`, `both`), not definite nouns.

## Attempt 1 — refuse the sentence (reverted)

Added `thirdPartyDocumentOpening` (a narrow list: report, filing, prospectus, memo, whitepaper —
never the page's own paper or study, which `SELF_REFERENTIAL_DOCUMENT_OPENING` already resolves) and
refused a sentence that opens on one when the noun appears nowhere in the text published above it.

Result on the same event: the sentence was refused, and the article's first paragraph became

```
1. The middle (baseline) scenario projects annual demand growth of about 23 percent …
```

The audit still reported **5 context-dependent openings** and **the same event with a
reader-visible defect**. The reference had not been removed; it had moved one sentence later. The
paragraph was built around the report, so every later sentence inherits it. The change also cost the
reader the block's numbers, which are the story's substance.

## Attempt 2 — refuse the block (reverted)

Same rule, applied to the assembled block instead of the sentence. Identical outcome, for a
structural reason: in the narrative path each fact is its own paragraph at gate time, so _block_
granularity and _sentence_ granularity are the same thing there, and the following fact still
inherits the reference.

## Why refusal cannot fix this class

The defect is not in the sentence that carries the reference; it is in **which sentence the page
opens with**. A refusal removes text and leaves the next sentence holding a pronoun-less definite
reference to something the refused text introduced. To close it, the composer must open the story
with prose that stands alone:

1. **Prefer a document-establishing sentence as the deck** — if the source itself says "NTT Global
   Data Centers published a report modelling …", that sentence is both the lead and the antecedent.
   This is a selection rule (pick the fact that establishes the document), not a refusal rule.
2. **Order the body after it** — the narrative path reads forwards, so the establishing sentence
   has to lead, or the blocks before it must be dropped as a run rather than one by one.
3. **Withhold** — `assessReadiness` already has a reason vocabulary for this; using it would make
   the story unavailable rather than published with a dangling reference. That is a product
   decision, not a repair, because it costs the reader a story the story page could otherwise tell.

Option 1 is the only one that adds nothing to the prose and loses no fact, and it is measurable on
the same corpus. It is the next slice.

## What is _not_ claimed

Not claimed: that the audit's other four "context-dependent openings" are defects. They are counted
on the published prose and are readable in place — _"These constitute non-delivery scams…"_ has its
subject one sentence earlier in the same block. The one event the audit names as defective is the
one where nothing above supplies the referent.

Not claimed either: that this is the last of the class. The list in `thirdPartyDocumentOpening` is
deliberately narrow, so a story opening "The announcement says…" is still not covered.

## What reading the live page found that the instrument did not

2026-10-17, signed in on the deployed origin
(`/dashboard/story/a87a7bc6…`, _Taiwan raising $4 billion to build industrial park in Texas…_):
the page reads well as a whole — headline, deck, five sourced paragraphs, citation on every block —
but three sentences inside it depend on something the page no longer carries:

> "**However, they also rely on** several smaller manufacturers that do not have the financial
> capability to expand operations into the U.S. independently."

That paragraph opens on `they`, and the sentence those manufacturers were introduced in (the one
about major Taiwanese companies) is not in the paragraph above it. The `narrativeParagraphs`
adjacency rule let it through because it is the next sentence *in the source*, but the sentence that
gave `they` its referent was refused or merged, so adjacency is not what the reader sees.

> "**It's also not limiting itself** to a single industrial park, with the government saying that
> it's planning for "more than one" site…"

`It` here is the park, the government, or the plan — the reader cannot tell, and the sentence that
would have said so is not adjacent.

> "…has even recognized some of these companies in a keynote in Taipei earlier in 2026,
> **nothing** the crucial part…"

`nothing` for `noting`. It is the source's own typo, not a composer rewrite, and it is recorded
rather than "fixed": correcting a source's wording is a rewrite, which the product does not do.

**The instrument gap matters more than the individual sentences.** `audit:reader` reports one
defective event for the whole corpus, and this page is not it. The audit counts *block openings*;
this page's dangling references sit at paragraph openings inside a block the audit accepted, and one
of them (`they`) is exactly the class `contextDependent` exists for. Any rule that closes this has to
be measured on the live page as well as on the corpus, and the audit's context counter needs to read
paragraph openings, not only block openings.

## The ruler widened, and the answer is that this class cannot be refused

`audit:reader` now reports a second row beside the ruled one — **a bare pronoun behind a leading
connector**, which both the ruler and the gate miss because they read position zero. Measured on the
live corpus, 2026-10-17, `npm run audit:reader` (exit 0; 1,855 sentences):

```
context-dependent openings        5      (ruled class, unchanged)
  of those, a pronoun behind a connector (not covered)        2
    Norwegian teenage hitman hired for UK murder … · However, he was found guilty of conspiracy to
      murder and on Friday was sentenced to 20 years in detention. Natland had been controlled by …
    Taiwan raising $4 billion … · However, they also rely on several smaller manufacturers that do
      not have the financial capability to expand operations into the U.S. independently. …
```

Two blocks in the corpus, and they are not the same defect:

- the **Taiwan** one is the live defect: the sentence that introduced *those manufacturers* was
  refused, so the pronoun has nothing above it;
- the **sentencing** one is correct prose: `he` is the hitman the headline and the paragraph above
  name, and refusing it would delete the story's central fact.

That is the reason no rule shipped for this class. A blanket refusal of connector + pronoun would
remove a correct paragraph to fix one wrong one, and telling them apart needs the referent itself —
for `they`, the published page above contains other plural nouns (`companies`, `officials`), so a
number-and-noun search cannot decide it. Refusing is not a safe lever here either.

**So the honest position is: measured, not fixed.** The counter is in the instrument so the number
stops being invisible, and the class stays open with its size known — 2 blocks per corpus, 1 genuine.
A rule would need coreference, which is out of reach of string tests; the alternative shapes are the
three in the section above (open with the establishing sentence, order the body after it, or withhold
the story), and each is a product decision rather than a repair.

## The first body block, measured (2026-10-17)

The deck already has its own test (`needsAntecedentToOpen`); the paragraph under it is the page's
next sentence and nothing measured it. `scripts/reader-context-anchors.ts` now reports it separately.
On the frozen 200-event corpus (`tmp/corpus-today.json`):

```
first body block does not stand alone: 15 of 159 stories
  of those, a document noun the page never names: 2
```

**The two document cases are the real defect class**, and both are the same shape as the NTT story
recorded above:

- `NTT Global Data Centers weighs the price tag of not building fast enough` — block 1 opens
  `The report models three growth trajectories through 2030 …`, and nothing above it says which
  report. Its own coverage contains no sentence that names one (measured with
  `audit:reader --find "NTT Global"`), so there is no establishing sentence to hoist.
- `Power plant attacks reflect Russian blueprint to make Ukrainian cities unliveable` — block 1 opens
  `The document does not specify which Russian agency developed the assessment, which is titled
  Analysis of Ukraine's Energy, Housing and Utilities Sectors …`. The document's title is inside the
  same block, one sentence after the reference that needs it.

**The other thirteen are not defects, and that is why no string rule can fix this class.** They are
`The US had previously warned …` (the headline says the US), `The latest interim release of Ubuntu …
` (the deck names Ubuntu 26.10), `The woman known only as "Jane Doe" …` (the deck says the plaintiff),
`The court previously heard …`, `The device also includes …`, `The auditor, his wife …`. A rule keyed on
"the head noun does not appear above" fires on all thirteen and would delete a readable opening from
13 of 159 stories to fix 2 — the same arithmetic that killed the refusal rule for the body, one block
earlier. The census reports the document-noun subset separately for exactly this reason: it is a screen
sized before a rule exists, not a verdict.

### What can close the two, and what each costs

| option | what the reader gets | cost | available today? |
| --- | --- | --- | --- |
| A. drop the leading block, then re-test the next | NTT opens on Berti's own words (`We used to build ten-megawatt buildings …`); Ukraine-power opens on its next block | NTT **loses the report's findings** — the trajectories and stress tests are that block | yes, deterministic; needs a product ruling because it deletes prose |
| B. hoist a sentence that establishes the document | the page opens by naming the report/document, then the block reads normally | **no material for NTT** (its coverage never names a report); unknown for Ukraine-power | no, not for NTT |
| C. withhold the story | the reader never sees a dangling reference | loses the whole page, including the sources that do read well | readiness has no reason for this today; needs a ruling and a new reason |
| D. leave it recorded | a page that opens on an unknown reference | the defect AGENTS.md bans, on 2 of 159 stories | current state |

**Status: blocked on a product ruling, and said plainly.** A and C both change what a reader receives,
which AGENTS.md routes to the arbiter before code; B has no material for the case that matters. The
arbiter (the owner's ChatGPT `nyuz` project) is not reachable from this session's tools, so the case is
escalated to the owner with the table above rather than decided here. **Nothing behavioural has been
shipped for this class**, and the census is the landed change: the size and the two examples are now
reproducible with one command.
