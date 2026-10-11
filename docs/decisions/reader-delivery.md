# Decision log — the reader's delivery path

Every entry is a product decision, not a patch. A change lands only after the ruling is
recorded here with its date and reason. Until then a proposal may exist as a diff outside
the shipping path and nothing else.

Open questions are numbered so a ruling can answer them one at a time.

---

## D1 — Does a card whose article is empty ever reach the reader?

**Status:** OPEN, awaiting the arbiter. Owner ruling required. No code landed.

**Why it is open.** The selection gate and the composer disagree about one story in the
frozen 200-story corpus (`tmp/corpus-after.json`, frozen 2026-10-10). The gate counts facts
the evidence pass accepted; the composer applies publication-time rules afterwards and
refuses some of them. Where the two disagree, the reader receives a headline, a deck and no
article:

```
Microsoft barred from sponsoring foreign workers for US residency
  gate: ready (composedFactCount 3)
  composer: 3 facts selected, 1 rendered as a 31-word deck,
            2 refused as stacked_quotes, 0 paragraphs, 0 unexplained
  audit: delivered with no body <- must be zero ... 1
```

Three sentences of the story's own coverage each carry two quoted fragments, so
`stacked_quotes` refuses both non-deck sentences. This is not caused by any recent slice; the
audit's cross-tab is what made it visible. On the owner's stated bar (one defect per 100,000
items) 1 in 200 is a violation, not a rounding error.**Measured 2026-10-10, before any ruling** — the number the case was missing. Frozen corpus
`tmp/corpus-after.json`, 200 events, read-only (`node --env-file=.env scripts/tsrun.mjs tmp/d1-blast-radius.ts --corpus tmp/corpus-after.json`, raw output in `tmp/d1-blast-radius.json`):

```
admitted today, publishes a body                  122
admitted today, no paragraph  <- the breach        1
withheld today, has a body (over-withholding)     19
withheld today, no paragraph (both agree)         58

option A: newly withheld                           1 of 200 (0.50%)
option A: prose unchanged for                    122

stories with a stacked_quotes refusal             22
  ... and still published a body  (B's surface)   21
  ... and published no paragraph                   1
stacked_quotes refusal events in total            48
```

Cross-checked against the audit, which computes the same quantities by its own path on the same
corpus: it reports 59 stories with no paragraph, `delivered with no body 1`, `readable stories
withheld 19`, and an empty-by-gate split of 9 `build-number` / 1 `quote` / 1 `ready` / 48
`unbriefable`. Every one of those agrees with the numbers below — the 1 admitted-and-empty is
the audit's `ready 1`, and its 48 + 9 + 1 withheld-empty stories are these 58. Two independent
implementations, same corpus, same answer.

Read precisely: **A changes the outcome of exactly one story in 200** — the breach — and
rewrites no prose anywhere. **B's upper bound is 21 stories in 200 (10.5%) whose published
prose changes**, because that is how many keep a body while carrying a `stacked_quotes` refusal;
the true figure depends on how narrowly the rule is relaxed, and any relaxation that keeps those
stories intact is not B as written. The 19 withheld-with-body stories are the existing
over-withholding, unchanged by either option and named in the output.

**Options.**

| #   | What changes                                                                                                                                                                                          | Cost                                                                                                                                                                                                                                                                                    | Who notices                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A   | The gate asks the composer's own question — "does this story publish at least one paragraph?" — once per candidate, from the same inputs the delivery path composes. The body-less story is withheld. | A real story with real evidence becomes a silent miss. Digest behaviour changes. Measured: 5 assertions in `src/lib/pipeline/digest-cost-safety.test.ts` fail, because stories they assert ship stop shipping (`digest_items` 1 → 0). The corpus-wide blast radius is not yet measured. | The reader: fewer cards, none empty. The operator: nothing, unless the withheld class is surfaced. |
| B   | The composer stops refusing both non-deck sentences for `stacked_quotes` and publishes them as prose. The story ships with a body.                                                                    | Changes published prose for every story carrying two quoted fragments (the audit counts 24 quote-opening blocks and 8 two-quote blocks in the 200). Risks publishing quote-stacked sentences the rule exists to prevent.                                                                | The reader: more prose, some of it the shape the rule was written to refuse.                       |
| C   | Delivery filters: the gate stays as it is and the delivery path withholds a story whose composed article has no paragraph.                                                                            | Two counters still exist, so the disagreement can reappear somewhere else. The rule lives downstream of selection, where it cannot influence what is selected.                                                                                                                          | The operator, if the withholding is recorded and shown.                                            |

**Recommendation:** A, with C's recording. Measured cost is one withheld story in 200 against
21 stories whose prose would change under B, and A is the only option that leaves the decision
in the place that decides what the reader is offered — the same lesson as the last two slices,
where every disagreement between two counters produced a defect. A is not defensible until Q3
and Q4 are answered, and Q5 decides whether the five digest assertions change or the ruling does.

**Proposal (not applied).** `tmp/seam-proposal/` holds the three files with the seam built
and its test passing locally: the composer gains one entry point that answers from a headline
and its coverage, and the gate's fact-count rung is replaced by that answer. The working tree
is reverted to the accepted state; `diff -u` against those files reproduces the patch.

---

## Questions

**Q1. Does a card with an empty article ever ship, or is "no body ⇒ no card" absolute?**
If it ships in some cases, name them, because the audit's must-be-zero line assumes none.

**Q2. If no body means no card, where does the rule live — the gate (A), the composer's
refusal rules (B), or delivery (C)?** The gate is proposed because it is the only decision
point that can also keep the story out of the briefing entirely, and because it can ask the
composer's question instead of keeping a second counter.

**Q3. Is a silent miss acceptable when evidence exists but no paragraph can be published?**
The reader gets nothing and the operator sees nothing. If the answer is no, the withheld
class needs a surface (an audit line already exists; an operator-facing one does not).

**Q4. What counts as a body — at least one paragraph, with the deck excluded?**
Today a deck is published prose but is not an article; every empty story in the census has a
deck or nothing.

**Q5. Five assertions in `digest-cost-safety.test.ts` encode the current contract — those
stories ship. If the ruling is A, those expectations change.** Confirm that changing them is
the ruling and not a weakened test, and whether each story involved must be named and
justified individually.

**Q6. Does the 17-story `nothing-selected` class get the same rule, or its own?**
The provisional ruling on that class was to withhold an item with no independently
defensible reason to show it, and explicitly not to add the rule in two places. A answers
both classes with one rule; if they need different answers, say which.

---

## Paste this into the ChatGPT `nyuz` thread

```text
D1 for ruling - does a card whose article is empty ever reach the reader?

Evidence, frozen 200-story corpus, measured 2026-10-10, read-only:
  admitted today, publishes a body                  122
  admitted today, no paragraph  <- the breach         1
  withheld today, has a body                         19
  withheld today, no paragraph                       58
  option A would newly withhold                1 of 200 (0.50%), rewriting no prose
  stories carrying a stacked_quotes refusal          22
    of those, still publishing a body                21   <- option B's upper bound
  stacked_quotes refusal events in total             48

The breach: the Microsoft foreign-worker sponsorship story. Gate ready with 3 accepted facts;
the composer refuses both non-deck sentences as stacked_quotes; 0 paragraphs, deck only. The
reader would get a headline, a deck and no article.

Options. A - the gate asks the composer whether the story publishes a paragraph. B - the
composer stops refusing stacked-quote sentences. C - delivery filters, gate unchanged.
Recommendation: A plus C's recording; A costs one withheld story in 200, B's upper bound is 21
stories whose published prose changes.

Questions. Q1 Is no-body-no-card absolute? Q2 Which layer owns the rule? Q3 Is a silent miss
acceptable for a story that has evidence? Q4 Is a body one paragraph, deck excluded? Q5 Do the
five digest assertions that these stories ship change - and is that the ruling, not a weakened
test? Q6 Does the 17-story nothing-selected class get the same rule?

Nothing lands before the ruling. The built seam lives outside the shipping path:
tmp/seam-proposal/ (patch tmp/seam-proposal/seam.diff, three files).
```

## Recorded rulings

### D1 — ruled 2026-10-10, implemented and measured the same day

**Ruling.** Delivery correctness first. Readiness must evaluate the composer's actual publication
result, composed once from the same inputs the delivery path composes from; paragraph publication
is a hard readiness condition regardless of selected fact count; the deck-only contract is
governed exactly as before; refusal accounting is untouched; no new AI calls, queries or
dependencies. Next acceptance bar: **two independent zeroes** — zero unexplained selected facts,
zero delivered stories that violate the body-publication contract. Order: seam, regression tests,
frozen-corpus audit, census re-derivation, then the queued read-quality openings.

**Implemented.** `assessReadiness` now asks one question of one composition, next to the existing
fact floor it does not replace: a story the floor admits must also publish at least one paragraph.

```
composedWithTheComposer'sAnswer = composeFromSources(title, sources, { publishedAt })
refuse when  composedFactCount < MIN_BODY_FACTS        (existing deck-only contract, unchanged)
refuse when  the composition publishes no paragraph    (the new hard condition)
```

**Evidence the arbiter asked for, on the same frozen 200 stories.**

| audit line                                      | before        | after             |
| ----------------------------------------------- | ------------- | ----------------- |
| `delivered with no body <- must be zero`        | 1             | **0**             |
| `readable stories withheld` (over-withholding)  | 19            | **19**            |
| fact ledger `1572 = 1422 + 150 + 0`             | 0 unexplained | **0 unexplained** |
| `withheld as ready` / `withheld as unbriefable` | 1 / 48        | **0 / 49**        |
| stories that published no paragraph             | 59            | 59 (unchanged)    |

**Fail-before proof.** The new regression test was run with the condition disabled: `expected
{ ready: true } to deeply equal { ready: false, … }` — the gate admitting the Microsoft story,
which is the defect. Restored, it passes.

**Two findings the measurement produced, neither of which was in the proposal.**

1. **The floor's count source could not move.** The composer's own `selected` differs from the
   evidence pass's `composedFactCount` on **45 of 200** stories, and no field inside the composition
   reproduces the legacy number exactly (closest: 196/200). Adopting it as the floor withheld one
   story the ruling never asked to withhold, so the floor keeps reading exactly what it read before
   and only the new condition comes from the composition.
2. **The gate was composing a different article than the reader's page.** Without the event's
   date, a source's relative time cannot be anchored; on this corpus that cost one story its only
   body fact and pushed over-withholding 19 → 20. The date now travels into the gate
   (`publishedAt`, from the same occurrence clock the page uses). Caught by the audit, not by review.

**Clarified the same day, and the clarification removed two workarounds.** The first version of the
new condition refused any candidate with no paragraph, which is broader than the contract: a
composition with a single usable fact publishes its deck and refuses nothing, and that deck-only
outcome is the existing floor's business. The arbiter's decision table now governs:

| evidence floor | composition                                     | outcome                               |
| -------------- | ----------------------------------------------- | ------------------------------------- |
| not met        | anything                                        | not ready (existing floor, unchanged) |
| met            | at least one paragraph                          | eligible                              |
| met            | no paragraph, one usable fact, nothing refused  | **allowed deck-only**                 |
| met            | no paragraph, body refused by publication rules | not ready                             |
| met            | no paragraph, no rule accounts for it           | **fail closed**, investigate          |

The earlier over-broad version had forced two end-to-end fixtures to be rewritten (their coverage
composes only a deck). With the correct table those repairs were unnecessary: **both fixtures are
back to their original text, byte for byte, and pass unchanged** (`digest-cost-safety.test.ts`,
`background-invariant.test.ts`). Final state of this slice: no test expectation changed anywhere,
and no fixture altered. The audit numbers above are identical under both readings, because the
ambiguous class is empty on this corpus.

**Census re-derived** (same corpus, prior census kept as the historical baseline below).

```
body-bearing                     141
nothing-selected                  31
single-fact-is-the-deck           26   <- deck-only, governed by the floor, not a defect
body refused by named rules        2
avoidable / unexplained            0   <- must stay zero
```

Superseded baseline (earlier 200, before the evidence repair): 44 empties — 17 `nothing-selected`,
27 `single-fact-is-the-deck`, 0 charged to a rule, 0 avoidable.

## D2 — the deck may not open on a reference the page never establishes (2026-10-10)

**The case.** Six context-dependent openings on the frozen 200, classified by the only question that
decides one: can the reader resolve it on the page?

- **Four are resolvable by adjacency** and are not defects: `They'd skulk about in nearby trees`
  (the previous block names the tits), `That would be the first public execution in the U.S. since
the 1930s` (the previous block names the livestream), `This monitor is compatible with both AMD
FreeSync…` (the previous block names the monitor), `He turned it down because he liked working at
the coal face` (the previous block names Preston).
- **One was the deck**: `Those were among the descriptions more than three dozen mathematicians
reached for in conversations with The Verge` — nothing on the page is a set of descriptions, the
  source sentence that supplied them was never published, and no rule was consulted because a deck
  was never checked. A deck is the only block with nothing before it, so adjacency cannot repair it.
- **One was a paragraph opening that a rule had refused and the page published anyway**:
  `These price increases have been directly caused by the boom in AI data centers…` on the PC
  shipments story, whose page never says prices increased. Not a wording problem: a rule-enforcement
  problem, and it is D3 below.

**The ruling.** A deck must not begin with an unresolved demonstrative or pronoun. Walk the ranked
facts in order and take the first that composes a self-sufficient deck, keeping every existing
evidence and sentence rule; a displaced candidate is not charged, the body path decides its fate. If
no candidate qualifies — the stored summary is held to the same test — the story has no deck and is
withheld. Do not weaken a refusal or reshuffle until something passes. Zero genuinely unresolved
reader-visible openings is the acceptance condition; the count of adjacency-resolved openings is
diagnostic, not a failure metric.

The ruling's own boundary, kept literally: this is about _unresolved_ references, not pronouns. A
demonstrative whose head is the document the reader is already holding self-refers, so
`This report presents …` and `This paper investigates …` stay published
(`SELF_REFERENTIAL_DOCUMENT_OPENING` in `src/lib/editorial.ts`). This matters: without it the rule
refuses the opening sentence of every research abstract in the corpus, and the first failing test was
exactly that case.

**Measured, same frozen 200 (`tmp/corpus-after.json`).**

| metric                                      | before                | after                 |
| ------------------------------------------- | --------------------- | --------------------- |
| stories with a reader-visible defect        | 1                     | **0**                 |
| context-dependent openings                  | 6                     | 5                     |
| fact ledger                                 | 1572 = 1422 + 150 + 0 | 1572 = 1421 + 151 + 0 |
| delivered with no body                      | 0                     | 0                     |
| readable stories withheld                   | 19                    | 19                    |
| withheld as unbriefable                     | 49                    | 49                    |
| stories publishing no paragraph / deck only | 59 / 31               | 59 / 31               |

The residual five are all paragraph openings: the four above that the previous published block
resolves, and the one D3 owns. No story was newly emptied, no story lost its deck, and the fact
ledger still reconciles — the extra refused fact is the displaced deck sentence that the body path
then refused on its own terms.

**Verified:** `tsc --noEmit` clean (app and scripts), eslint 0 errors, prettier clean, 340 tests green
across the affected suites (editorial, prose rules, quality, fixture regression, readiness,
digest-cost-safety), and the audit re-run above.

**Next, in the arbiter's order:** D3 refusal-finality (a refused fact must not be republished by
another path — 5 verbatim cases, and the `matched: sentence|text` split that filed its worst case as
the benign one), then the 2 absent overlap records, then the 24 quote-opening blocks, then the 8
two-quote blocks.

## D5 — the 19 readable stories withheld, split by what the gate said it matched (2026-10-11)

**The case, before any change.** The audit printed one line — `readable stories withheld 19` — and a
line is not a class. The 19 are stories where the composer published a body and the gate refused the
story anyway, so every one of them is prose a reader could have received; the arbiter's question was
which of them should have. Nothing was changed to answer it.

**Ruling (2026-10-11): option (a) of the previous question, applied.** Classify the 19 before fixing
any, print each with the rule that fired and the evidence behind it, and keep the withheld/justified
distinction explicit rather than collapsing the count. The governing principle is stated in the same
ruling: reduce reader-visible errors without turning justified silence into publication.

**Implemented.** `withheldFamily` in [../../scripts/lib/defects.ts](../../scripts/lib/defects.ts) maps
each of the gate's own `reason` strings — the rule's self-report of which shape it matched — into one
of four families, so no rule is re-implemented to measure it and the audit cannot drift from the
gate about what "a vendor how-to" is:

| family              | what it means                                                                                  | is a loss?                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `not-a-headline`    | the title is an identifier, a commit message, a byline, a container or quotation               | no — there is nothing to read                                      |
| `promotion`         | the title's own words are a price, a sale with a clock, or a shopping listing                  | no — the reader was offered a shop                                 |
| `first-party-shape` | a vendor-marketing shape fired: an imperative, a benefit aimed at the reader, a how-to trailer | **guessed from the title** — the one family a reviewer has to read |
| `evidence`          | the refusal came from the composition or the coverage, not the title                           | a different failure                                                |

The report now prints every withheld story with its family, the rule's reason, the body it would
have delivered (`N paragraph(s), M words`), and the source it came from — because the first-party
family is decided from the title alone, and the source is what says whether the title was the
vendor's own announcement or a newsroom reporting the same words.

**Measured on the same frozen 200** (`tmp/corpus-after.json`, 2026-10-11,
`npm run audit:reader -- --corpus tmp/corpus-after.json`): **19 withheld, and the count is three
quantities**:

```
readable stories withheld        19
  not-a-headline             11
  promotion                   3
  first-party-shape           5
```

Sixteen are refusals that hold. Eleven have no headline to read (9 llama.cpp build numbers, 1 commit
message, 1 quotation announcement), three are the shop's own offer (`TechCrunch Disrupt 2026 … lock
in your pass savings`, `Grab this 32-inch 4K OLED gaming monitor … $596`, `Save $200 on the 2026 M5
MacBook Air`), and two are the vendor's own launch posts (both Cloudflare). **Three are the class
this slice exists to find** — a newsroom story refused by a shape judged from its title:

| title                                                                                | source       | reason                           | would have delivered    |
| ------------------------------------------------------------------------------------ | ------------ | -------------------------------- | ----------------------- |
| `Nord Stream trial: How German police followed the evidence - to Ukraine`            | BBC World    | title is a vendor how-to         | 4 paragraphs, 253 words |
| `Growing pains: how distributed AI training changes the network between datacenters` | The Register | title is a vendor how-to         | 5 paragraphs, 338 words |
| `Meet India's feisty Gen Z protester who is taking on Modi`                          | BBC World    | title is an imperative promotion | 6 paragraphs, 377 words |

Together they are 968 words of composed reporting a reader did not receive. The two shapes
responsible are the `: how` trailer (`MARKETING_TRAILER`) firing on a news feature's
subject-and-question punctuation, and the imperative opener (`MARKETING_TITLE`) firing on a headline
that begins with `Meet`. Both are single-source-only rungs, and all three stories are single-source
newsroom pieces — which is exactly the assumption the marketing rung makes about a single source.

**No fix has been made, and the reason is the ruling's own principle.** A change here decides what
ships and what is withheld, so it is a product decision and belongs to the arbiter: three options
went to it on 2026-10-11 — require the source to be first-party before a marketing shape may fire,
narrow the two shapes, or leave them and accept 968 words of loss. The measurement above is the
input to that ruling.

**What this slice does not claim.** It does not claim the three are defects: it claims they are
refused by rules that judge the title, that their sources are newsrooms rather than vendors, and
that the composer had a body ready for each. Which of those is worth changing is the ruling. The
family is read from the gate's reason string, so a reworded rung would be filed as `evidence` —
reported, not dismissed — and `reader-withheld.test.ts` pins the strings the live corpus produced so
that a reworded rung fails a test instead of quietly reclassifying a withheld headline.

## D4 — a quote opening is classified, not queued (2026-10-11)

**The case, before any change.** The audit counted 29 published blocks opening on a quotation and
9 carrying two quotations, and the queue read "29, then 9". D2 had just shown what that hazard
costs: a ruler's count is not a defect count, and 29 was never a measurement of what a reader
experiences. So the case put to the arbiter was not "how do we fix 29 blocks" but "which of them
is a defect", with the competing reader costs measured in the same run so the answer could be
traded against them.

**Ruling (2026-10-11): option (a).** _Define the quote-opening defect first, inspect the actual
blocks, fix only confirmed defects, and measure the opportunity cost alongside._ The ruling's own
table:

| shape                                                                | classification                  | action                                                     |
| -------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| opens a block, speaker identifiable nowhere on the page              | potential defect — verify       | repair from supported evidence, or refuse the opening      |
| opens a block, speaker and context established elsewhere on the page | valid quote lead                | leave it alone                                             |
| repeats a sentence already published above it                        | potential duplicate-publication | verify, then remove or merge through the established rules |
| opens a block, self-contained and properly attributed                | valid quote lead                | leave it alone                                             |
| has an attribution in the source that was refused or never published | potential context failure       | trace the refusal; do not invent an attribution            |
| unusual to the heuristic, resolvable from the page                   | diagnostic false positive       | retain, and record the classification                      |

With it, acceptance criteria named explicitly: print each candidate with enough context to judge
it by hand; record the opening text and its position, whether the speaker is identifiable, where
the attribution appears, whether the same sentence is already published, whether the source
sentence was refused and under which rule, the classification, and the proposed disposition with
its effect on the ledger; keep 29 as a diagnostic until the classification is complete; check the
overlap with the two-quote class rather than merging the two queues; and report the competing
classes — 19 readable stories withheld, and the census of stories publishing nothing — beside it,
because "the size of a diagnostic counter is not the size of the reader-facing cost".

**Implemented.** `quoteOpeningEvidence` in [../../scripts/lib/defects.ts](../../scripts/lib/defects.ts),
where the other rulers the audit and the before/after diff share are defined, so the definition
exists once. It reads four things and no more: whether the _page_ names the speaker, in this block
or in another; whether that name sits in an attribution seam (a name handed to a speech verb in
the same sentence), tested against the story's own entities from `rankEntities` so the ruler never
guesses that a capitalised word is a person; whether the ledger charged a fact that named a
speaker — the case where the composer had the attribution and did not publish it; and whether a
sentence of the block is the _identity_ of a sentence already published above it, by `sentenceKey`,
which is the merge rules' own notion of "the same sentence". Similarity is deliberately not
a defect test: the D3 resemblance class is reported beside the republication class, never instead
of it. Both quote rows now print the blocks behind them, and each classification prints the
sentence the name was found in.

**Measured on the same frozen 200** (`tmp/corpus-after.json`, 2026-10-11,
`npm run audit:reader -- --corpus tmp/corpus-after.json`):

```
block opening with a quote                             29
  confirmed defects                                    0
    same sentence already published above it           0
    the page names the speaker only in a charged fact  0
  valid quote leads (the page names the speaker)       29
  unresolved: no speaker named anywhere, nothing charged 0
  stories carrying a quote opening                     26
  of those blocks, a second quotation in the same block 0
two quotes in one block                                 9
```

**Nothing to fix, and that is the finding.** By the ruling's own definition none of the 29 is a
defect: the page names the speaker in every one (25 in the opening block itself — `said Jitesh
Ubrani, research director for consumer devices at IDC`, `Haugen says` — and 4 in another block of
the same story), none repeats a sentence already published above it, and no block that opens on a
quotation also carries two quotations, so the two classes do not overlap on this corpus and 29 and
9 are separate queues rather than one of thirty-eight. The queue the arbiter declined to spend a
slice on was, on this corpus, empty.

**What the ruler claims, and what it does not — read off the printed sentences.** It claims "an
entity from the story's own entity list sits in an attribution seam on this page", never "this is
the speaker's name". In 5 of the 29 the string it matched is not the speaker: an employer
(`Techsponential`, for the analyst Avi Greengart), a publication (`Register`, for `Preston told
The Register.`), a body named by its role (`FCC Chairman`, for Carr), and one run that spans the
wrong words (`AI Standards`, out of `US Center for AI Standards and Innovation`); in 2 more the
name is the person's and is cut short (`J.J` for J.J. "Yank" Cummings, `Prime Minister Jonas Gahr`
for Jonas Gahr Støre). In all seven the sentence printed beside the name names the person or the
body speaking, which is why the classification holds — and the sentence is printed for exactly
that reason, so the judgement can be checked instead of trusted. The institution speaking in its
own voice (`Gartner said`, `Comcare said in its notice`, `Anthropic said`) is not one of those
seven: that is the correct attribution.

**Effect on the ledger: none**, which is the other half of the finding. No fact moves, and the
new field is purely additive: the run that printed it differs from the run that did not in
nothing but the added `in:` lines (checked with `diff` over the two reports), so the measurement
is reproducible and the classification changes no publication decision. The must-be-zero lines
stay at zero on both runs — `refused then published by another path` 0, `delivered with no body`
0, `Facts lost, with no rule accounting for them` 0 — and the ledger still reconciles at
`1572 = 1418 + 154 + 0`.

## D2 closure — one definition of "unresolved context" (2026-10-11)

**The case the arbiter ruled on.** The deck predicate and the audit's ruler disagreed about what
"unresolved context" means. The rule had exempted a demonstrative whose head is the document the
reader is holding (`This report presents …`, `This paper investigates …`) since D2, because the
arXiv regression proved that without the exemption the rule refuses the opening sentence of every
research abstract. The ruler (`unresolvedContextOpening`) never learned the exemption, so it kept
counting decks the rule would publish — which made the acceptance number partly a definition rather
than a fact about the prose.

**Ruling (2026-10-11): option (a).** _Teach `unresolvedContextOpening` the same self-reference
exemption, then re-baseline the diagnostic. Do not leave the primary diagnostic knowingly broader
than the rule it measures._ Acceptance criteria, all of which the arbiter named explicitly: one
shared definition of unresolved context wherever the two overlap; the exemption implemented
consistently; the PC-shipments sentence still detectable as genuinely unresolved; the arXiv
`This report …` and `This paper investigates …` cases negative controls; the diagnostic rerun
against the same frozen 200 with the old count preserved as evidence.

**Implemented.** `SELF_REFERENTIAL_DOCUMENT_OPENING` moved from `editorial.ts` into
`src/lib/reader-evidence.ts`, where the other opening patterns live, and `unresolvedContextOpening`
now applies it. The deck rule's `needsAntecedentToOpen` delegates to that one function instead of
keeping a private copy — the rule and the ruler now share the definition by construction rather than
by coincidence.

**Controls, as tests** (`reader-prose-rules.test.ts`):

| case                                                                              | expected                          |
| --------------------------------------------------------------------------------- | --------------------------------- |
| `This report presents the OpenSpace Lab's solution to the competition.`           | not unresolved                    |
| `This paper investigates the feasibility of deploying quadruped walking robots…`  | not unresolved                    |
| `These price increases have been directly caused by the boom in AI data centers…` | **unresolved** (positive control) |
| `This was announced on Tuesday.`                                                  | unresolved                        |
| `The study found a similar effect in every market it examined.`                   | not unresolved                    |

**Re-baselined on the same frozen 200 (`tmp/corpus-after.json`, 2026-10-11).** The count is **3**,
and the row is now printed with the blocks behind it, so the number can be checked instead of
trusted:

```
context-dependent openings        3
  My brief romance with an AI bird feeder · They'd skulk about in nearby trees …
  The U.S. last held a public execution in the 1930s … · That would be the first public execution …
  Rejecting a promotion sent field service tech into support hell · He turned it down because …
```

Historical counts, kept as evidence: **7** in the run before D2 (one of them the arXiv deck),
**5** after D2, **3** since D3 (the entity splice and the deck charge were supplying the other two).

**What the re-baseline actually measured, stated honestly.** On this corpus the exemption changes
nothing on the published page: all three remaining openings are the _adjacency-resolved_ paragraph
openings D2 named — the previous published block supplies the referent (`the tits`, `the
livestream`, `Preston`) — and none is a document self-reference, nor is the PC-shipments sentence
still present for D3 to have fixed. So the exemption's effect here is zero, and its value is that
the ruler no longer counts a class the rule cannot produce: the diagnostic is now a floor of
resolved-by-adjacency cases rather than a mixture of those and definition artefacts.

## D3 — a refused fact is final (2026-10-11)

**The case, before any change.** The audit reported **7** facts a rule had charged that the page
received anyway, and the counter's own two-way split told the wrong story about them:

- Four were real republications: the **entity-context splice** had re-inserted a source sentence
  naming an entity the article had not introduced. The usual reason the entity was unintroduced was
  that the sentence naming it had been **refused** — and the splice then published that sentence
  _after_ the quality gate, so no rule had ever read it. This included the PC-shipments opening
  (`These price increases have been directly caused by the boom in AI data centers …`) whose
  referent the page never establishes, which is the case D2 handed to D3.
- Two were the counter reaching too far: facts the page only _resembles_ (`Hegseth. The BBC said:
"People need to understand …"` versus the sentence `The BBC said: "People need to understand …"`
  that the page carries). The old `matched: "sentence"` label was produced by the ledger's own
  sentence index, which every publishing path writes — including a block a later rule refused — so
  these two were filed as the _worst_ class while one real republication was filed as the benign one.
- One was a fact that was never withheld: a paragraph restated the deck, was refused under a
  sentence rule, and the charge landed on the **deck's own fact** through the shared sentence key —
  a rule the deck had passed.

**The ruling this implements.** From the arbiter's queue: _a refused fact must not be republished by
another path_; the `matched` split must not file a republication as a resemblance.

**Implemented — two causes, one counter.**

1. **Refusal-finality at the splice** (`republishesRefusedFact`). The entity-context pass may not
   reinsert a sentence whose text the ledger already charged, and its candidate is added to the
   article **before** the gate rather than after, so the same sentence rules judge it as every other
   block. Where the entity cannot be introduced without republishing a refusal, the article does not
   mention the entity.
2. **A deck restatement is a merge, not a defect.** `nearDuplicate(deck, part)` is now decided
   before the refusal rules, so a duplicate of published prose charges nobody.
3. **The counter reads the page at sentence boundaries.** `matched: "sentence"` now means every
   sentence of the fact is one of the page's own sentences — the fact's own text on the page, which
   is what a republication requires. Containment alone was tried first and was too loose: a quoted
   message inside another sentence (`THE PATRIOTS CAUCUS sends its regards` inside the sentence
   reporting it) is the page quoting a source, not a path republishing a refused fact. Everything
   else that matched is now `matched: "resemblance"`, counted separately as a diagnostic, with the
   sentence that matched recorded beside it so the reading can be checked.

**Measured, same frozen 200 (`tmp/corpus-after.json`).**

| line                                             | before                | after                 |
| ------------------------------------------------ | --------------------- | --------------------- |
| `refused then published by another path`         | 7                     | **0**                 |
| of those, resemblance only (diagnostic)          | —                     | 3                     |
| `selected = rendered + explained + unexplained`  | 1572 = 1421 + 151 + 0 | 1572 = 1418 + 154 + 0 |
| `Facts lost, with no rule accounting for them`   | 0                     | **0**                 |
| context-dependent openings on the published page | 5                     | **3**                 |
| `stacked_quotes` refusals / sentences refused    | 32 / 166              | 31 / 165              |
| `delivered with no body`                         | 0                     | **0**                 |
| readable stories withheld                        | 19                    | 19                    |
| stories publishing no paragraphs (splits)        | 59 (31/26/2)          | 59 (31/26/2)          |
| stories with a reader-visible defect             | 0                     | **0**                 |

The whole difference is 13 lines of the report: three facts that were published are now refused (the
three sentences the splice inserted), one attribution shape moved from `according_to` to `none`
(the deck-duplicate merge), and the average article lost one word. No story was newly emptied, and
no story lost its deck.

**Fail-before proof.** With `republishesRefusedFact` disabled, the new regression test
(`editorial.test.ts`, "does not splice a refused fact back in as context for an unborn entity")
fails with the corpus defect reproduced verbatim: the published article contains `These price
increases have been caused by the boom in AI data centers, Counterpoint Research said.` — the
refused sentence, on the page. Restored, it passes. Verified: `tsc --noEmit` clean for the app and
for `scripts/`, and 468 tests green across the affected suites (editorial, reader-quality, fixture
regression, prose rules, readiness, digest-cost-safety, understand).

**Also closes the queued "2 absent overlap records":** they were the two facts whose text the page
never carried, and they are now the resemblance class instead of being reported as republications.

**Checked against the arbiter's own acceptance list for D3 (2026-10-11), item by item.** Traceability
from the original refusal through every publication path: the ledger charges facts by identity and
`republishesRefusedFact` reads those charges, so a charge still names its rule. Regression test that
fails against the old behaviour and passes against the fix: yes, with the fail-before output
recorded above. Zero verbatim refused-then-published on the frozen corpus: 0. Zero unexplained
selected facts: 0. Zero delivered stories without a body: 0. No newly emptied story without a
disposition: the census is unchanged at 59 (31 nothing-selected / 26 single-fact-is-the-deck / 2
charged to a rule). Separate accounting of refused sentences genuinely absent from the page: the
`resemblance` class, printed with the sentence that matched. Not a generic text-matching filter:
the suppression test is the ledger's charge, never similarity — the resemblance class changes no
publication decision, it only reports.
