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
