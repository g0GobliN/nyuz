# Composer prose: the expansion at first use, and the reason line that names the narrow interest

**Measured 2026-10-23 (audit `reader-clarity-audit-2026-10-22.md`, findings H-06, H-11, H-14, I-03,
I-14; task card `t_f581d4f4`).** Two rules, both deterministic code over stored rows, no model in the
path.

## 1. The body-admission guard consults the page's own title

**Measured cause.** On the live rows the composer refused every sentence that places a key noun:

- Terafab card `d50c1236`: *"ASML, the world's sole commercial supplier of the $400 million EUV
  lithography systems required for high-volume, leading-edge chip production…"* recorded as
  `unrendered[unresolved_context]` although the delivered headline names ASML.
- H-11 card `b8b0110f` (AMD/Intel PyTorch): the ZenDNN sentence, the x86 Ecosystem Advisory Group
  (EAG) sentence and the steering-member sentence, all refused `unresolved_context`, all carrying
  "AMD" in the headline.

Why: the ranked body pass called `contextDependent(text)` **without** the story title, so the two
title-based classes of arbiter ruling #17 (2026-10-20) — "a bare reference whose head the title does
not establish, and an acronym neither the title nor the opening expands" — could never see the page
the reader actually has. Passing the title through changes what the **page** admits, which is exactly
what ruling #17 measures; a caller without a title still gets the stricter answer, unchanged.

With the guard apposite, the page is readable where it names its subject: ASML is placed in the
sentence that first prints it, ZenDNN and EAG arrive with their explainers, and the first-use
acronym expansion (`expandAcronymsFromEvidence`, which landed earlier) repairs the first bare use of
an abbreviation the story's own evidence spells out ("operational technology (OT)" — audit I-03;
"extreme ultraviolet (EUV)" in the Terafab row). With the guard consulted, the page is readable where
it names its subject.

**Finding, recorded rather than tuned:** the "EUV" abbreviation is spelled by its own source as
"extreme ultraviolet" — two morphemes inside one word — which the adjacency matcher cannot
initialise-match without a morpheme table this product refuses to invent. The form exists on the
page because the source prints "extreme ultraviolet (EUV)" verbatim further down; it is not carried
to the first bare use. Widening the matcher to compound-word initials is a later, separate rule.

## 2. The reason line names the narrowest matched interest

**The audited defect.** 25 of 25 reason lines on the 2026-10-22 briefing named AI; 8 were exactly
"You follow AI." — the line that says why *this* card is on the reader's page told the reader the
one thing they already knew about their own feed.

**The rule** (`reasonExplanation`, `src/lib/server/briefing.ts`):

1. A matched interest outside `BROAD_TOPIC_LABELS` is a specific one — a company, a product, a
   standard — and the line names it: "You follow NVIDIA." (the audited card 04's own chips read
   "AI · NVIDIA · Hardware", so "You follow NVIDIA." is what its row supports).
2. Otherwise, when at least two pools matched, the narrowest matched pool is measured from the
   briefing it renders in: the matched label the delivered cards carry least. Naming it answers the
   reader's real question — why this card and not the others: "You follow Cybersecurity." A single
   matched pool never qualifies, because it names exactly the broad thing the reader already knew
   they followed.
3. When the match spans the briefing's whole feed, the line says what the card is about instead,
   from the card's own remaining labels: "You follow AI — this card is about Cybersecurity and
   NVIDIA."
4. When nothing narrows and the card carries nothing else, the line is left off — the eighth
   "You follow AI." is worse than no line.

**Measured on the audit's own briefing** (`fab11fdf`, 17 delivered cards, real stored labels,
2026-10-23): **17 of 17 lines change**; before, three read "You follow AI."; after, none do. Worked
examples:

```
537b6a31  labels=[AI, Cybersecurity]
  before: You follow AI and Cybersecurity.
  after : You follow Cybersecurity.
8766cb0f  labels=[AI, OpenAI, Cybersecurity, Open source]
  before: You follow AI, OpenAI, Cybersecurity, and Open source.
  after : You follow OpenAI.
8d12d5b7  labels=[Energy, Music, Consumer tech, Hardware, AI]
  before: You follow AI.
  after : You follow AI — this card is about Energy, Music, Consumer tech, and Hardware.
ec112c1c  labels=[AI, NVIDIA]
  before: You follow AI and NVIDIA.
  after : You follow NVIDIA.
```

**Finding, recorded rather than tuned (I-14):** the Wiz/PHP sentence *"According to OpenAI, an AI
security group called Calif identified a "critical" PHP flaw using GPT-5.6 Sol, and Google-owned Wiz
independently discovered and reported the vulnerabilities using AI."* publishes admissibly, and
nothing the story stores places OpenAI, Calif, GPT-5.6 Sol or Google — a first-use expansion has no
stored words to carry, and inventing them would be a glossary. The rewrite the audit proposes is a
headline-policy decision, which the audit's own finding-class table routes to the arbiter.

**Boundary.** Only `src/lib/editorial.ts`, `src/lib/server/briefing.ts`, and the tests beside them
changed; the card surfaces and the pipeline are untouched.
