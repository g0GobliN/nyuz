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

**Ruling (2026-10-11): option (a), conditionally.** _Require a first-party source before a
marketing-shaped title can trigger the marketing refusal._ The ruling rejected (b) — narrowing the
patterns — because it moves the error from "we withheld a real story" to "we published a vendor
advert", and rejected (c) because a usable signal existed. Its implementation contract: keep the
existing patterns and reasons; let them fire only when the source is _positively_ identified as
first-party; **unknown, missing or generic `rss` kinds must not silently become first-party**; no new
query and no inferring kind from a displayed name; the release-note refusals stay, recorded as
correct outcomes rather than false positives; and no general rewrite of promotion detection.

**Implemented.** `FIRST_PARTY_SOURCE_KINDS` is `company_blog` alone, and the two marketing call
sites gained that precondition — the patterns and their reason strings are untouched. Missing,
empty and unknown kinds are all _no_, so the rung is skipped rather than guessed at, which is the
existing convention for coverage-dependent rungs. `marketingShape(title)` exports the shape test on
its own, because the audit has to be able to ask "would this title have been refused had the
publisher been speaking for itself?" on a window whose kinds are unknown without re-implementing the
patterns; `readiness.test.ts` pins the predicate and the gate together on a table of titles.

**Acceptance evidence.**

- **Fail-before, demonstrated.** With the precondition removed the acceptance tests fail exactly as
  the defect describes: the three newsroom stories come back `{ ready: false, kind: "marketing" }`
  where `{ ready: true }` is required, and the generic-`rss` case is refused too — the gate reading a
  `rss` feed as the publisher speaking for itself. Restored, 49 tests pass.
- **A regression test per case, from the corpus verbatim:** the three newsroom stories (one `: how`
  trailer, one `: how` trailer, one `Meet` opener) delivered when their kind is `news`; the two
  Cloudflare launch posts still refused when theirs is `company_blog`; and the generic-feed control —
  `rss`, `other`, `product`, empty, a mixed list and a missing `sourceKinds` must all fail to qualify.
- **The frozen 200, labelled as what it is.** `readable stories withheld 19 → 14`, and the report now
  says `coverage kinds carried by this corpus: no — the marketing rung is skipped`, with its own
  `Vendor shapes` section showing 6 titles wearing a shape and **0** refused. That number moved for a
  reason the corpus cannot show: it does not carry `kind`, so the two Cloudflare posts were released
  here as well, which is exactly the loss the ruling means to avoid. **This is a sensitivity result,
  not acceptance evidence**, and the corpus was not changed to make it look better.
- **The live-window measurement the ruling required** (`npm run audit:reader`, 2026-10-11, kinds
  carried: **yes**): 4 stories wear a marketing shape — **1 refused** (`Introducing Clef-omni …`,
  `company_blog`, 5 paragraphs composed) and **3 released**, all `kinds: news`:

  | released title                                                                                   | kinds | composed     |
  | ------------------------------------------------------------------------------------------------ | ----- | ------------ |
  | `‘Halloweenmas’: how the spooky one-nighter turned into a month-long spectacular`                | news  | 4 paragraphs |
  | `We tested gaming performance in 17-year-old Windows 7 on a modern gaming PC against Windows 11` | news  | 8 paragraphs |
  | `Nord Stream trial: How German police followed the evidence - to Ukraine`                        | news  | 4 paragraphs |

  On that window the change releases 12 paragraphs of newsroom reporting and keeps every vendor post
  refused. Its must-be-zero lines are unchanged: `facts lost 0`, `delivered with no body 0`,
  `refused then published by another path 0`, ledger `1777 = 1575 + 202 + 0` reconciles.

- **The `rss` risk is measured, not resolved.** Not one of the released shapes on the live window
  came from `rss`: the three are `news` and the refusal is `company_blog`. That means the risk was
  **not exercised** by this window rather than settled by it — a single live run cannot show what a
  vendor announcement syndicated through a generic feed would do, and the ruling is explicit that the
  five frozen cases do not settle it either. The window keeps this section, so the next run measures
  it again.

**D5 disposition: measured, ruled and implemented.** The instrument (the previous section) and this
rule change are the slice; the arbiter's next queue is D6, the 59 stories publishing nothing, ahead
of the two-quote blocks on reader impact.

**What this slice does not claim.** It does not claim the three are defects: it claims they are
refused by rules that judge the title, that their sources are newsrooms rather than vendors, and
that the composer had a body ready for each. Which of those is worth changing is the ruling. The
family is read from the gate's reason string, so a reworded rung would be filed as `evidence` —
reported, not dismissed — and `reader-withheld.test.ts` pins the strings the live corpus produced so
that a reworded rung fails a test instead of quietly reclassifying a withheld headline.

## D6 — the 59 silent stories, accounted for individually (2026-10-11)

**The ruling.** Account for all 59 one by one with their evidence and decision-time context; classify
each as justified silence, justified deck-only, false refusal, evidence-selection defect or
unresolved; no broad release rule before they are understood; a claimed defect must reproduce first.

**The classification is [d6-silence-classification.md](d6-silence-classification.md), and it changed
no publication behaviour.** Result: **26** justified deck-only, **2** justified deck-only charged to a
named rule, **7** justified silence charged to a named rule, **24** justified silence with **no
coverage body** (added class: one stored headline plus a photo credit, 2–9 words — nothing was
refused because nothing was offered), and **0** false refusals, **0** evidence-selection defects,
**0** unresolved.

**The instrument, and the proof it moved nothing.** `npm run audit:reader` now prints a per-story D6
ledger and each coverage source's kind, clock, units and stored excerpt; `scripts/lib/corpus.ts`
reports each source's `article_evidence.status`. Both are read-only, and the composer's input is
untouched — the evidence query reads every row and filters `status = "enriched"` in memory, the same
predicate as before. Frozen 200 before and after: `59 (31/26/2)`, ledger `1572 = 1418 + 154 + 0`,
`delivered with no body 0`, `readable stories withheld 14`, and the 59-row ledger byte-identical.

**The dominant family has a different owner.** On the live window 41 of 50 (82%) silent stories had
no usable evidence (30 with no `article_evidence` row, 11 blocked or unavailable). `audit:enrichment`
and `scripts/reader-enrichment-cause.ts` (30-day window) attribute it: `extraction_empty` 180,
`never_attempted` 285 — of which `never_matched` **267** is the enrich stage's deliberate cost
boundary, not loss — plus `priority_arm` 9, `blocked` 82, `thin_content` 15, `unreachable` 2. That
corrects the census's own `fixable families 465`, which counts all `never_attempted` as fixable; the
honest figure is nearer 198.

**Brought forward for a narrow ruling, and nothing else.** `priority_arm` 9 — events with a reader
matched inside 24 hours whose articles were inside the candidate arms and which no tick reached, a
dispatch-starvation candidate. `extraction_empty` 180 — fetched, enough words, zero units, the one
family that is real loss, and an evidence-pass question rather than a readiness one. No composer rule
is proposed for change: there was nothing for one to fix.

### D6 ruling (2026-10-11) — accepted and closed

The arbiter accepted the classification in full and ruled on the boundary it exposed:

- **The 59 dispositions are accepted as reported** — 26 / 2 / 7 / 24, with false refusals,
  evidence-selection defects and unresolved all zero. The distinction between material that was
  _refused_ and material that was _never available to be evaluated_ is the finding that mattered: a
  headline plus photo credit is a coverage-availability problem, not a failed composition.
- **`never_matched` 267 is recorded as intentional cost-gate behaviour**, explicitly, in the audit's
  reporting and in its documentation: never loss, never defect, and not recoverable by running more
  ticks. `audit:enrichment` therefore prints **`families worth attributing`**, not `fixable families`,
  with a printed caveat that it is not a count of recoverable stories and a pointer to
  `npm run audit:enrichment:cause` for the attribution. **~198 is an estimate of the dispatchable
  remainder, not a verified count of recoverable stories** — eligibility for a retry does not prove a
  retry recovers usable evidence.
- **Next slice: `priority_arm` 9.** The investigation must reconstruct each event's eligibility at
  decision time, establish its place in the candidate ordering and whether `ENRICH_LIMIT` 3 kept it
  out, separate legitimate deferral to newer work from starvation by repeated selection, and determine
  whether repeated ticks can reach an eligible event under the current rules at all. If a defect is
  demonstrated it needs a fail-before test and the narrowest correction, plus a before/after
  measurement, no change to unrelated eligibility rules, and evidence the correction prevents
  recurrence rather than one tick happening to process the nine. **Raising `ENRICH_LIMIT` or widening
  the fallback window to make the nine disappear is explicitly not authorised.**- **Then `extraction_empty` 180, as its own slice**, distinguishing content genuinely unusable from
  content lost during extraction, structural-parsing failures, and cases where the reported word count
  does not describe what the extractor evaluated. Readiness and composition are not to be changed to
  compensate for evidence that was never produced.
- **No broad rule change is authorised by any of this.**
- **How `priority_arm` is to be investigated** (ruled the same day, after the boundary landed): a
  read-only **replay** using the **real dispatch-selection logic** over frozen inputs, not an
  audit-only reimplementation, recording per event its eligibility at decision time, its position in
  the newest-published-first ordering, which three candidates consume each tick's `ENRICH_LIMIT`, and
  whether successive ticks reach it. Falling below the first three is **not** starvation; only staying
  unselected across the replayed ticks is. If starvation is proven, the failing replay becomes the
  regression test and the correction is the narrowest one that restores progress **without changing
  eligibility, `ENRICH_LIMIT` or the fallback window**; if every event is eventually selected the nine
  are **deferred, not defective**, and dispatch behaviour does not change to make a diagnostic count
  zero. A demonstrated correction then gets **one forward confirmation** on real successive ticks —
  which supplements the replay rather than replacing it. Full contract:
  [d6-silence-classification.md §6](d6-silence-classification.md).

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

## D8 — what an alert is allowed to be (2026-10-11)

Numbered D8 because D7 is already reserved in the work log for the stacked-quotes family
(`docs/context.md`, 2026-10-11); this entry does not take that slot.

**Status: the gate landed; the floor is open, awaiting the arbiter.** Two separable questions were
found in one complaint ("this does not feel like breaking news"); one is a defect and was fixed, the
other is a policy and is put below.

**Where the case came from.** The owner, reading their own account: alerts fire on stories that are
not breaking — a newsletter, research preprints, a vendor roadmap post, a hobby hack — and the page
behind an alert sometimes has nothing to read. That is a claim about the product, so it was measured
rather than argued. `npm run audit:alerts` was written for it (the alert path had no instrument at
all; see the work log in `docs/context.md`).

**The measurement** (`npm run audit:alerts`, live database, 2026-10-11; raw output
`tmp/alerts-audit5.txt`, the instrument committed in `9cbde00`):

```
alerts ever created (digests kind=alert)                     205
of those, refused by the gate the briefing uses          108 of 205
  unbriefable             69   (the page composes no readable body)
  primary-source          31   (single-source research item)
  newsletter               5
  commit-message           2
  build-number             1
alertable now (matched, in reach, not yet alerted)            16
  would publish                                              14
  refused by the gate                                         2
newest alert                                          2026-10-10T21:14
```

Read precisely: **the shipped alert rule would have refused 53% of everything it ever sent, had it
asked the question the briefing asks of every story** — 69 of them pointing at a story with no
publishable body. The four most recent refused alerts were two `The Download` newsletter containers
(importance 8 and 6) and two single-source arXiv items (6 and 6). Separately, importance does not
separate "worth interrupting" from "not worth interrupting" on this history: **raising the floor to 8
would remove 7 of the 8 interrupts that read as non-news in the last 25 and cost 7 genuine ones**
(KillSec 10, Soldier 10, US disrupts 8, Warner Bros 8, Blockchain 9 versus Super Micro 7, Nvidia 7,
Top AI labs 7, FBI 6, Dyfed-Powys 7, EC 6, TLD hijacks 7).

**Ruling and authority, stated exactly.** The arbiter's ChatGPT project was **not reachable from this
session** — that is the first of the two conditions in `AGENTS.md` for escalating to the owner, and it
is which one applies. The owner ruled in-session: an alert must be breaking and latest, and worth
interrupting for. That ruling is recorded as the owner's, not attributed to the arbiter.

**Implemented — the gate (one shared gate, no new rule).** `fireAlerts` now runs every candidate
through `assessReadiness` — the same function, on the same inputs (the event's clock, its coverage,
the feeds' kinds) that `digest.ts` uses to select a briefing story — **before `paceAlerts`**, so a
refused hit does not spend one of the three burst slots. Refusals are reported as `withheld` and
`withheldKinds` on `AlertReport` instead of being folded into `skipped`, because "nothing was sent"
must be answerable. Nothing is deleted or claimed: `create_alert_delivery` is the only thing that
records a claim, so a refused event stays in `user_events` and leads the reader's next briefing.
Six tests (`alerts-readiness.test.ts`); five of the six fail with the gate disabled, verified by
running them against a pass-through gate.

This is the narrowest fix that removes a proven defect, and it is deliberately _not_ a new policy: it
applies a rule that already exists to the path that was skipping it.

**Open — the residual, for the arbiter, with the numbers.** After the gate, alerts that still read as
non-breaking are shapes no rule refuses: a vendor roadmap advertorial (importance 7), a product
newsletter (7), a hobby hack (6), a personal blog post (6), a price-piece about a memory kit (6). The
options, each with what it costs on the same history:

- **(a) Nothing further.** The gate is the whole fix. Cheapest and touches no settled rule; leaves the
  five shapes above reaching phones.
- **(b) Raise the alert floor above the briefing floor.** `ALERT_FLOOR` (`scoring-shadow.ts`) is
  `IMPORTANT_FLOOR` verbatim today although its own comment says it is "kept separate because a miss
  here is the expensive one". At 8: removes 7 of 8 recent non-news interrupts, costs 7 genuine ones.
  A miss here is invisible to the reader and to the operator, which is the trade the measurement puts
  in numbers.
- **(c) A first-party marketing shape refuses an alert even when corroborated.** This **contradicts
  D5** (2026-10-11), which ruled that a marketing shape only refuses when the publisher was speaking
  for itself and that `company_blog` is what says so. It would catch the vendor advertorial and the
  product newsletter; it needs D5 reopened, not extended.
- **(d) Require the alert to be carryable by more than one outlet** (a stricter `sourceCount` than the
  briefing's) — the same operator decision of 2026-10-08 that created the `primary-source` rung,
  applied at the alert bar rather than the briefing bar.

The recommendation is not made here: (b) and (c) both trade a reader-visible failure for an invisible
one, and that trade is the arbiter's to rule on.

**Ruled 2026-10-14 by the CEO (GOB-15, binding for that issue).** Alerts are reserved for breaking,
important developments; the five shapes that still pass the gate — a vendor roadmap advertorial, a
product newsletter, a hobby hack, a personal blog post, a memory-kit price piece — are not breaking
developments and are refused at the alert floor. This is a *narrow* floor extension, one rule per
class (`assessAlertFloor`, `src/lib/pipeline/alert-floor.ts`), not option (b) (a blanket floor raise,
which the measurement showed would cost seven genuine alerts) nor (c) (a D5-contradicting first-party
exclusion) nor (d) (an outlet minimum). The five classes are development-free shapes; none can
legitimately be a breaking development, so no exception was carved. Measured 2026-10-14
(`npm run audit:alerts`): 5 of 101 gate-ok alerts refused, one per class, 0 genuine alerts lost.

## D9 — the block that opens on a truncated sentence (2026-10-11, open)

**Status: OPEN, evidence recorded, no code landed.** Found while verifying D8: with the alert gate
landed, three of the most recent alerted stories were read by hand through the composer audit
(`npm run audit:reader -- --find "<title>" --show 1`) to check the reader's page behind an alert. The
audit reports **0 reader-visible defects** on all three. A person reading them finds five.

**The evidence, quoted from the composed pages (2026-10-11, live window).** Each is the _first
sentence of a published block_, which is the position that has no sentence before it to repair it:

```
FBI Arrests Founder of Ransomware Negotiation Firm
  ¶1  "… An online search reveals the Summit was held at the Loews Philadelphia Hotel between Oct."
      ^ ends mid-date: "between Oct." is not a sentence
  ¶5  "… The FBI declined to comment for this story. Investors.boeing.com/investors/news/press-release-details/2025/Boeing-to-Sell-…-for-10-55-Billion/default.aspx Am wondering what ransomware negotiations he was involved in."
      ^ a raw URL and a forum comment, published as reporting
  ¶5  opens "For example, was he involved in the United Healthcare/ChangeHealth ransomware incident?"
      ^ a question with no antecedent — charged to no rule

Super Micro smuggling co-conspirator pleads guilty to sending AI chips to China
  ¶2  "The Super Micro co-founder is set to go to trial this coming Nov."
  ¶3  opens "Sun is also expected to be sentenced on Sept."          ^ truncated month
  ¶5  opens "2, even as the third co-conspirator, Chang, remains a fugitive."   ^ opens on "2,"

PS5 hack delivers native PS2 disc support and 4K upscaling where Sony refused
  deck "One standout feature is high-resolution upscaling, enabling 6X scaling …"
       ^ a deck whose first words refer to a feature the page has not introduced
  ¶1   "… Sony is evident that the console can play games from older generations of consoles all this time."
       ^ broken clause, published
```

**Why this is its own entry and not a D8 follow-up.** D8 is about _what an alert is allowed to be_;
this is about the _prose_ the reader lands on, and it applies to the briefing's own pages equally —
none of the five is alert-specific. It is a reader-quality defect on the frozen-corpus path, and the
prose rules there are ruled on by the arbiter, not changed on inspection.

**What the instrument cannot currently see, stated plainly.** The audit's rulers are:
`ENTITY_LEAK`, `METADATA_LEAK`, malformed attribution, context-dependent opening (`unresolved_context`,
which charged one of the above), `DOUBLE_SPACE`, two quotes in one block, quote-opening block,
duplicate citation. A **truncated sentence** and **a raw URL with forum comment text** are counted by
none of them, so the must-be-zero line `stories with a reader-visible defect` reports 0 on stories a
human calls defective. That is the same shape of failure D2/D3 fixed in the ruler: a count that cannot
see the thing being judged. The next slice is therefore the **ruler first** — a fragment/truncation
class and a raw-URL class, measured on the frozen 200 — and a rule only after a ruling, because
"D12, even as …" and "between Oct." are also legitimate English in other contexts and a rule that
refuses by regex alone will cost real prose.

**Not claimed here:** that these are five distinct causes. Three of the five are one cause — a source
sentence truncated at a clipping boundary (a date, a month name, a list item) and then published — and
the fix for the class is likely one rule. The other two (the raw URL with comment text, the
unintroduced deck) are evidence passes rather than block rules. The measurement is the next step;
this entry exists so the finding is not lost between sessions.

### D9 — the ruler landed and was measured (2026-10-12), still no rule

**Status: ruler landed, rule still open and still unruled.** The two classes exist now as measurement
only, in [defects.ts](../../scripts/lib/defects.ts) beside the other rulers, with 12 tests in
[reader-truncation.test.ts](../../src/lib/reader-truncation.test.ts). Nothing the reader receives
changed. Measured on the frozen 200 with the real composer
(`node --env-file=.env scripts/tsrun.mjs tmp/d9-measure.ts tmp/corpus-after.json`):

| class                                       | count                               |
| ------------------------------------------- | ----------------------------------- |
| published blocks judged                     | 702 (141 of 200 events have a body) |
| **truncated lead**                          | **0**                               |
| **raw URL in published prose**              | **6**                               |
| input excerpts carrying a URL, for contrast | 22 of 207                           |

The 6 raw URLs, printed with their matched text: the bare
`Investors.boeing.com/investors/news/…/default.aspx` press release — **the exact block D9 was opened
on** — plus `bun.sh/install.ps1` inside a shell snippet, and `Orkut.com` ×2,
`PhillyUnsolvedMurders.com`, `WordPress.com`. **Only the first two are the shape the owner flagged**;
the other four are a domain used as an ordinary noun ("urged users to visit Orkut.com", "the
WordPress.com parent company"), which is prose, not damage. So the address class is _6 rows, 2 of them
defects_, and it needs that sub-classification before it could support a rule — which is an argument
against a blanket one, not for it.

**Two things the first draft of each ruler got wrong, and both are now pinned as tests.** The
truncation ruler's first version listed every preposition and fired on four published leads that were
merely idiomatic — "while OpenAI moves on.", "most passionate about.", "have quickly signed on.",
"was scheduled on." — so the list is now months, articles and conjunctions plus the prepositions that
bind forward tightly, with those four strings kept as negative controls. The URL ruler's first version
accepted any dotted word and called `llama.cpp`, `Node.js` and `GLM-5.3-Flash` web addresses; its
second accepted any suffix followed by a path and counted `Assisted-by: pi:llama.cpp/Qwen3.8-Flash-Next`
as a URL. It now decides on a named set of web TLDs, which costs one recorded miss and removes every
false positive measured. Both drafts would have produced a number, and the number would have been
wrong — which is the whole reason the ruling ordered the ruler before the rule.

**The finding that matters most: the frozen 200 is the wrong instrument for the truncation class.**
Both D9 samples — "…the Loews Philadelphia Hotel between Oct." and "…sentenced on Sept." — end on a
month, and the ruler catches exactly that shape (it is two of the tests). The frozen corpus contains
none of them, so it reports 0, while the same ruler fires on the live window D9 was opened from. A
corpus that cannot contain the defect cannot measure it, and reporting "0 truncated leads" from the
frozen 200 alone would be a clean number standing in for an unmeasured question. The live window is
the instrument for this class; `npm run audit:reader` over a live window is the run that would give
the arbiter a number to rule on.

**Also measured, not a defect:** 22 of 207 input excerpts carry an address and only 6 published blocks
do, so the composer already removes the majority of raw addresses before they reach a block. That is a
result worth keeping beside the 6, because it is the difference between "addresses leak through" and
"some do".

**Still not claimed:** that either class should refuse a story. No rule, no refusal, no gate change —
the numbers above are what a ruling would be argued from, and they are not yet a case for one.

## GOB-6 — Guardian newsletter sidebar boundary (2026-10-13)

**Status: implemented.** Board interaction `20825b29-4359-4c90-8d18-a27ef7ab5e66` approved an exact
heading boundary before changing reader-visible output.

**Observed defect.** A live-read audit of the Guardian story titled “Shock, anger…” found the
reader's article carrying unrelated visa-policy and water-restriction snippets from the story's
separate “What else we're reading about” section. The composer included them, and the existing
reader-visible defect audit did not count them. The boundary failure was structural: the section
heading and its paragraphs sit inside the same article column, and `extractMainText` processed every
`<p>` tag after the heading as ordinary article body.

**Owner decision.** Place the boundary at the exact heading, in the structural extraction layer
(`src/lib/pipeline/html-text.ts`), because that is where publisher structure becomes text runs. Do
not add a broad relevance filter, a generic sidebar detector, or any unrelated quality change. Match
the heading text exactly: "What else we're reading about", case-insensitive, with straight or curly
apostrophe, and optional trailing punctuation (`:`, `…`, `.`, `?`, `!`, `-`).

**Scope.** The change affects only HTML extraction. It stops paragraph collection at the matched
heading. Existing stored excerpts and the frozen corpus are unchanged; new fetches and re-fetches
apply the boundary. Ordinary article content, other headings, and all composer controls remain
unchanged.

**Validation.**
- New unit tests in [html-text.test.ts](../../src/lib/pipeline/html-text.test.ts): the heading cuts
  the run list; variants with curly apostrophe and trailing colon are honoured; headings that merely
  contain the phrase are not cut; headings inside stripped furniture tags (`aside`) are ignored;
  ordinary article headings remain intact.
- New regression fixture in [reader-fixture-regression.test.ts](../../src/lib/reader-fixture-regression.test.ts)
  proving the captured Guardian case: the article's own reporting stays in the extracted text,
  evidence selection, and composed article; the sidebar heading and snippets are absent from all
  three; and removing the heading reproduces the defect (the snippets become evidence).
- `npx tsc --noEmit` clean.
- Focused test run: `npx vitest run src/lib/pipeline/html-text.test.ts src/lib/reader-fixture-regression.test.ts`
  passes (59 tests).
- The frozen corpus was not present in this workspace (`tmp/` empty), so `npm run audit:reader --
  --corpus tmp/corpus-after.json` could not be re-run. The fixture exercises the captured case
  directly; the existing corpus is unaffected because the change applies at extraction time, not to
  stored excerpts.

**Measured reader-visible output for the captured case.**

Before the boundary (simulated by removing the heading):

```
Deck: Residents reacted with shock and anger on Tuesday after officials unveiled a new
residency policy they said would reshape who can live and work in the city.

Paragraphs include:
- The mayor's office said the measure, which takes effect next month, was designed to address
  a severe housing shortage and would be reviewed after six months.
- Civil rights groups promised legal challenges, arguing the policy unfairly targets low-income
  families and recent arrivals.
- Visa changes for international students have left hundreds uncertain about their autumn plans,
  universities said.
- Water restrictions are expected to tighten across the southern region after the driest summer
  on record.
```

After the boundary:

```
Deck: Residents reacted with shock and anger on Tuesday after officials unveiled a new
residency policy they said would reshape who can live and work in the city.

Paragraphs:
- The mayor's office said the measure, which takes effect next month, was designed to address
  a severe housing shortage and would be reviewed after six months.
- Civil rights groups promised legal challenges, arguing the policy unfairly targets low-income
  families and recent arrivals.
```

The visa-policy and water-restriction snippets are no longer in the extracted text, evidence, or
composed article. The fact ledger for the fixture reconciles (`lost: 0`).

## Source furniture in published prose — the welded label and dateline (2026-10-14, landed)

**Found by reading the live product as a stranger.** Five stories at the deployed origin
(`https://nyuz.grgvishal-gurung17.workers.dev`, read 2026-10-14), three carrying defects. GOB-12's
reader-quality contract already names the class: §2 acceptance criterion 6 ("No source metadata,
heading furniture, URL fragments, or extraction artefacts appear in prose") and §3 cross-cutting
row 3 — **Source metadata / extraction furniture in reader prose, Critical**. No T1–T7 item on the
GOB-13 triage owned it, and the T1 ruler cannot see it: `truncatedSentence` fires only on a
sentence that *ends* on a month or a function word, and `RAW_URL_WITH_PATH` needs a scheme, `www.`
or a path. Measured against the in-flight W5/W6 tree before the fix: all four strings below were
selected by `selectReaderEvidence` as publishable facts.

Verbatim, as a reader received them:

1. `story/29ad32c2` — `The full chain:…September 18, 2026 Operating as hackers under OpenAI's bug
   bounty program, Hacktron researchers uncovered critical vulnerabilities that granted them access
   to internal employee tools…`
2. `story/7af726e6` — `Model selection Some frontier models impose security guardrails on their
   outputs, according to GitHub.`
3. `story/7af726e6` — `The architecture in one minute Before getting into the interesting parts, it
   helps to know how the pieces fit together.`
4. `story/7af726e6`, same class, found by the live-window scan — `A shelf of diminutive apps With
   TinyJS, Stroh-Spijer created an "app store" that can be run, natch, from the desktop.`

**What landed.** `sourceSeam` in [reader-evidence.ts](../../src/lib/reader-evidence.ts) now calls
`sourceFurnitureHead`, two narrow shapes: a verbless label of at most eight words ending in `:` or
`…` immediately followed by a month-name date; and a sentence-cased, verbless head of 2–6 words
followed by a capitalised subordinator, preposition or quantifier and a clause that carries a
predicate. Refused as `invalid_sentence` through the one shared predicate, so the evidence pass,
the composer's entity path and the fallback deck agree. **No new reason string, no counter change,
nothing else in the diff.**

**Narrowness, measured.** `tmp/furniture-scan.ts` over the live window — 1,000 articles, 7,926
units published in the preceding 14 days — matches **one** unit, and it is a true positive (#4
above). The first draft matched 12 and 11 of them were prose; each is now a pinned negative
control: `According to The Register`, `In an emailed statement to The Washington Post`, `The other
day I`, `The number I keep coming back to`, `Some of the researchers The Verge spoke to`, `It's
powerful, with the A19 chip` (letters-only stripping read the digit token as the article "a"), and
a dateline at the head of its own sentence. The opener set is therefore subordinators,
prepositions and quantifiers only — the pronouns and articles that English puts mid-sentence for
ordinary reasons are out — and digit-bearing tokens are skipped. Controls live in
[reader-furniture-seam.test.ts](../../src/lib/reader-furniture-seam.test.ts) (14 tests: the 4 live
positives, 8 prose controls, and an integration case through `selectReaderEvidence` asserting the
welded fact is absent while the `$6,500 bounty` fact remains published).

**The arbiter's ruling (ChatGPT `nyuz` project, 2026-10-14, asked with the numbers above).**
**Accept** the slice as landed and narrowly scoped; refusal is the correct remedy for the current
case and the sentence is **not** to be automatically repaired. Conditions recorded: keep the rule
narrow, retain every negative control and the integration control, treat a false-positive
regression as a reader-quality failure, and do not widen the opener set without new evidence.
Recorded limits: the 1,000-article scan is evidence of narrow observed behaviour, not proof of
universal precision or recall; the 4 live positives establish the targeted behaviour, not overall
precision and recall; this rule must not grow into a general grammar validator, which would need
separate evidence. **The overall reader-quality gate remains open** — this decision addresses one
failure class, not the state of reader-facing prose.

**Two defects the ruling kept separate** (rejected as published, each its own category, neither to
be folded into this rule):

- **Incomplete explanatory deck** — `A set of taskflow YAMLs, one per stage, which are essentially
  the prompts that tell the LLM agent what to do at each step.` A deck that presents itself as
  explanatory prose while supplying a noun phrase and a relative clause with no main clause. The
  ruling: prefer recovering the source's complete sentence when it is attributable; allow a minimal
  grammatical repair only when the meaning is unambiguous and no new claim is introduced;
  otherwise withhold the deck.
- **Unestablished first-person voice** — `Two vulnerabilities chained together gave us access to
  ChatGPT and Codex accounts belonging to OpenAI employees.` The page never establishes who "us" is,
  and the adjacent sentence was already rewritten (`We demonstrated` → `The authors demonstrated`).
  The ruling: establish the sentence's source and authorial voice first; if the statement is
  attributable, convert it to the third person without changing its meaning; if attribution cannot
  be established, withhold it rather than guess; check adjacent sentences for consistent voice.
  **Measured before any rule (2026-10-14, `tmp/first-person-scan.ts`, same 1,000-article window):
  1,355 of 5,646 publishable units carry a first-person token — and most are legitimate** (a quoted
  speaker: `"no early warning from our partners"`; a reviewer's own voice in a first-person piece:
  `I'll admit that it stressed me out the first time I watched it, too.`). A blanket first-person
  refusal would delete reporting and quotations; the ruler for this class has to read the selection
  path's own context (the quote flag, the narrator resolution) rather than the text alone.

**Not claimed.** That reader quality is 10/10 — the arbiter explicitly declined that. What is
claimed is measured: four reader-visible welds are refused by a rule that matches one unit in
7,926, `npx tsc --noEmit` is clean, the full suite passes 3,203 tests, and the local app renders
both affected stories with the welds gone and the real facts kept.

## The incomplete deck: a published list item — ruled and landed 2026-10-14

**The defect, and where it comes from.** Story `7af726e6`'s deck, read at the deployed origin on
2026-10-14, was:

> `A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent
> what to do at each step.`

It is not a truncated sentence. It is one item of the source's own **bulleted list**. The GitHub blog
post writes a lead-in and three items — "There are three layers: a shell driver
(`run_fuzzing.sh`) …, a set of taskflow YAMLs …, a set of MCP tools …" — the provider flattens the
list into one paragraph, and the composer published the middle item as the story's opening line. Its
two siblings are still published in the body, where the lead-in carries them:

> `For the fuzzing task flow, the authors use Claude Sonnet 5 by default because it passed all of
> their internal tests without issues. There are three layers: A shell driver (run_fuzzing.sh) that
> chains the pipeline stages together. A set of MCP tools that the agent calls to actually do the
> work: run AFL, compile a harness, store a crash, read a coverage report, and so on.`

**Rulers measured before any rule** (live window: the newest 1,000 articles, 14 days, 7,870 units;
three drafts, and the numbers killed two of them):

| draft | shape | live-window result |
| --- | --- | --- |
| v1 | no predicate before the relativizer | **82 matches, every one ordinary prose** — "Today's epic patch batch dwarfs September's record of nearly 1,000 fixes, which was already …" ("dwarfs" is invisible to the closed verb lists) |
| v2/v3 | + verb morphology, any relativizer | 91 matches, still dominated by prose — "We present ToFu, a tool-aware framework that …" (complementizer `that`) |
| shipped | the relativizer must be **set off by a comma**, and the material outside it read with determiner-plus-verb-shaped noun heads masked | **12 of 7,842**, 11 of them prose ("Consumers fetch data …, like ClickHouse, which we rely on heavily.") |

**What landed.** `noMainClause` in [reader-evidence.ts](../../src/lib/reader-evidence.ts): a unit whose
only predicate is a comma-set relative clause's own verb. It reads the material outside the clause and
treats a verb-shaped word directly after a determiner as the noun head it is — `IRREGULAR_PREDICATE`
carries `set`, which is a verb in "the company set a record" and a noun in "a set of rules" — and it
ignores a token carrying a bracket, an underscore, an internal dot or a digit, because
`PREDICATE_MORPHOLOGY` otherwise reads the filename in "A shell driver (`run_fuzzing.sh`) that chains
…" as a verb. Refused at `judgeFallbackDeck` as the **existing** `malformed_sentence`: no new reason
string, no counter change, and deliberately **not** folded into `sourceFurnitureHead` — it is a
separate classification, as the arbiter required. It is hooked at the deck boundary and nowhere else;
`unitTextRejection` carries the note where the hook would go.

**Narrowness, measured with the shipped predicate.** Live window, newest 200 completed events: 192
published decks, 57 of them carrying a comma-set relative clause, **0 refused**. The production deck is
refused — the composed article has `deck.text === ""` with `deckReasons={"malformed_sentence":1}` and
opens on its real first sentence ("Even projects that have been enrolled in OSS-Fuzz for years can
still hide critical bugs …"). At the unit boundary the same predicate refuses 12 of 7,842 live units
and 11 of those are prose, which is why it has no hook there; two of the eleven are the reason the
rule stops at the deck.

**A false positive the repository's own suite caught, and what it changed.** The first draft refused
`The photographer told Reuters that the image was taken on Monday.` — `told` is a main verb none of
the closed lists carry ([reader-quality.test.ts](../../src/lib/reader-quality.test.ts)). That is what
moved the rule to the comma-set form, and the sentence is a pinned negative control now.

**The arbiter's ruling (ChatGPT `nyuz` project, 2026-10-14, asked with the numbers above).** **Accept**
`noMainClause` as a separate, deck-boundary refusal rule. **Do not promote the next-ranked fact
automatically**: withholding is the correct outcome for a list item, because repair would risk
inventing source material, and "a valid fact is not necessarily a valid deck … automatic fallback can
hide the original failure". **Record the non-comma limitation explicitly and do not broaden the rule**
on current evidence — the two live shapes that share the item's grammar without the comma ("A
Ukrainian company that got rich … now outfits drones …", "A Silicon Valley startup that uses weather
balloons … won a US military contract …") are complete sentences and are kept, pinned as controls.
Also ruled: an empty deck is acceptable as a *containment* outcome for this defect, not proof that an
empty deck is always the best reader experience; that broader question stays open. **No widening** of
the rule without new evidence.

**Acceptance conditions set by the ruling, and their result:** `npx tsc --noEmit` clean; the 12 new
tests pass; reader-quality + prose-rules + fixture-regression 214 pass; the full suite passes (189
files / 3,215 tests); the deploy gate passes; the malformed deck stays withheld in a
production-shaped run; the non-comma sentences and the Reuters sentence stay publishable; both valid
list siblings stay in the body; and the rendered page starts on the article's own first sentence with
no empty-deck artifact.

**Not claimed.** That the class is solved. The non-comma shape is untouched, the two siblings are
still published in body position, the deck is withheld rather than replaced, and 200 events is
evidence of narrow observed behaviour, not proof of universal precision or recall. **The overall
reader-quality gate remains open**, exactly as the arbiter restated.

## The unestablished first person — the defect the narrator resolver never saw (2026-10-14, ruled and landed)

**The defect, read on the deployed origin.** The sentence below published as written, while the
sentence beside it — same source, same excerpt — was already rewritten:

> Two vulnerabilities chained together gave us access to ChatGPT and Codex accounts belonging to
> OpenAI employees.

Its sibling `We demonstrated …` published as `The authors demonstrated …`. A reader cannot tell who
`us` is: the page never establishes it.

**Cause, located in the shipped code — not guessed.** `resolveNarrator`'s opening guard tested only
the subject forms (`I / we / my / our`). A unit whose only first-person token was an object or
possessive pronoun never entered the function at all, so the five resolution steps behind that guard
— whose last step has always been an `ambiguous` refusal — never ran on it. The same gap sits in
`publisherVoice`'s `VOICE` set, which has never carried `us`: under a case-insensitive test it is
the country.

**A false premise caught in the first measurement, twice.** The first draft of the live probe used
`/i`, so `us` matched `US` — "the US", "US officials", "the US Army" — and the class measured **30**.
Corrected case-exact, it is **27 of 7,816 live units** (newest 1,000 articles, 14 days), in three
shapes:

| shape | live units | what `us` is |
| --- | --- | --- |
| own work (`authors/ENABLE`) | 6 | the paper describing its own method ("This allows us to harness the accuracy of tree-based models like XGBoost …", all six arXiv) |
| community | 3 | an audience or a group ("those of us who actively wish to avoid it", "For us, … was AI") |
| newsroom recipient | 3 | the outlet's own desk ("… she told us during an interview", "u/cal93_'s latest Reddit update gave us more details …") |
| handover, company blog | 4 | the source's own engineers ("MoQ gives us the foundation …", "… they do not always tell us …") |
| other object pronouns | 11 | "sounds to me like", "That to me sounds like", "congratulates me", … |

**The remedy was simulated before it was asked for, and the simulation killed one of the two.** A
blind third-person substitution — the obvious fix — rewrites an audience into a paper's author list
("those of us who actively wish to avoid it" → "those of *the authors* who actively wish to avoid
it") and mis-attributes a Reddit-sourced transaction to the authors, in **6 of 17** units of the
first (uncorrected) set. That is a worse reader defect than the one it fixes, and it is why the
ruling below is not "rewrite them".

**The reader-facing population, before the fix.** Composing the live window — 200 completed events,
**928 published blocks** — **7 blocks** carried an object-only first-person token, and **none of them
was the own-work shape**: three newsroom, three audience, one the source's own engineers. The class
that reaches a reader is not the class the resolution targets, which is what made "withhold" the safe
direction and "resolve" the narrow exception.

**The ruling (ChatGPT `nyuz` project, 2026-10-14, asked with the numbers above).** **Option 2, with a
strict attribution requirement.** Option 1 (withhold all 27) rejected: "Nyuz should not equate
caution with indiscriminate suppression." Option 3 (rewrite a newsroom's "told us" into "she said in
an interview") **rejected outright** for this slice — a newsroom-voice transformation needs its own
evidence.

- **Guard.** Recognise the first-person subject, object and possessive forms, case-aware, "without
  matching unrelated words such as US"; the existing resolution flow stays the primary mechanism.
- **Own-work resolution.** Apply only where source attribution establishes the actor *and* the
  substitution preserves meaning. The source's identity alone is **not** enough: "the presence of a
  research-paper source does not, by itself, establish that every first-person plural pronoun refers
  exclusively to the paper's authors."
- **Actor noun, never a pronoun.** "Use the verified actor noun for own-work cases; do not introduce
  an unsupported pronoun" — replacing `us` with `them` "introduces a referent the page has not
  established".
- **Community and newsroom voice.** Never substituted to the authors; preserved when the referent is
  clear under existing rules, otherwise withheld through the existing `ambiguous` path.
- **No new reason string, no counter change.** "Do not add a reason string, counter, or separate
  public failure category merely to make the new code look more explicit."
- **`renameNarratorPronouns` unchanged**, and the defect class belongs in the documentation and the
  tests rather than in the runtime taxonomy.
- The 27 is "the observed candidate set for the proposed broader guard, not necessarily the final
  number of withheld units under Option 2", and the window had to be **rerun against the shipped
  implementation** with dispositions recorded by class.
- **The overall reader-quality gate remains open.**

**Landed.** `reader-evidence.ts`: the guard now takes a case-exact object/possessive token test
(`NARRATOR_OBJECT`, letters-only tokens so `us-west-2` and `/docs/us/install` are not pronouns), and
one new resolution, `restoreNarratorBeneficiary`, fires only when **both** conditions of the ruling
hold — the source's identity carries `the authors` (a repository source, `person === "authors"`) and
the sentence makes the narrator the beneficiary of its own work's enabling verb
(`lets/allows/enables/permits/leads/helps us`). Everything else object-only falls to the existing
`ambiguous` refusal, counted as `narrator_ambiguous`. `editorial.ts`: the composer's entity path —
which rebuilds a sentence straight out of the source excerpt whenever it names an entity — applies
the **same** resolver, because it was publishing a unit the evidence pass had already refused.

**Re-measured with the shipped implementation.**

- **Dispositions on the live window: 27 candidates → 6 resolved** (every one the arXiv own-work
  shape, published with `the authors` named) and **21 withheld**, none preserved.
- **Reader-facing: 7 of 928 published blocks → 0 of 938.** The two survivors of the first
  post-fix scan were both traced, not assumed: the community sentence named NetBSD, so the
  composer's entity path published it after the evidence pass had refused it; with that path asking
  the same resolver, the block is gone. Re-measured with the composed window: **0 object-only
  first-person blocks**, and the earlier welds (furniture, list-item deck) stay gone.
- **Verified:** `npx tsc --noEmit` clean; 23 tests in
  [reader-narrator-object.test.ts](../../src/lib/reader-narrator-object.test.ts) including the six
  country controls, the quotation gate, the code-token controls and the end-to-end refusal counted as
  `narrator_ambiguous`; reader-quality + prose-rules + fixture-regression 248 pass; the full suite and
  the deploy gate as recorded in [context.md](../context.md).
- **Proven fail-before, not assumed:** with the entity path's narrator step removed, its community
  test fails; with the guard unwidened, 9 of the 23 fail. Two candidate tests that passed either way
  were **deleted** rather than kept, because a test that passes with the fix removed proves nothing.

**Not claimed, and the limits this leaves open.**

- **Community and newsroom voice is withheld, not repaired.** 21 of the 27 live candidates are
  withheld, including legitimate interview quotes ("… she told us during an interview") and
  audience-directed constructions ("the E-T16 Concept shows us that …", "… will take us inside …").
  The ruling's preserve-when-the-referent-is-clear clause was implemented as *not rewritten*; whether
  an audience-addressed `us` should publish unchanged is **not settled by this slice** and is the
  next question for the arbiter.
- **The resolution's firing set is tiny** (6 units in a 14-day window, none of which reaches a reader
  in the composed 200-event window) and its entity-path branch is **preventive**, measured as 0 live
  cases.
- **No story-level check** exists that a paragraph opens on a referent the page establishes — this
  slice is rule-level on one pronoun class.
- The class was measured on one window; 27 and 6 are observations, not precision and recall. **Reader
  quality is not 10/10 and the gate stays open.**
