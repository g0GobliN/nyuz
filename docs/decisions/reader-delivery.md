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
