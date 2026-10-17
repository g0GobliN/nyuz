# Source adjacency in the ranked path

**Status: ruled 2026-10-17 (arbiter ruling #4), landed the same day.** The ranked composer now
honours the contract the single-source path always had — a sentence that opens on a reference is
published directly behind the sentence the author wrote before it — and refuses the sentence only
when that sentence is missing or cannot supply the reference.

## The defect, read on the live product

The reader's briefing on 2026-10-17 carried one story, and its fourth paragraph read:

```
Major Taiwanese companies are more than capable of spending the billions of dollars needed to
set up shop in the U.S. TSMC, for example, has already spent $165 billion …           [after]
However, they also rely on several smaller manufacturers that do not have the financial
capability to expand operations into the U.S. independently.                          [before]
```

"However, they also rely …" opened that paragraph with nothing above it saying who _they_ was. The
source's own naming sentence — the one about Major Taiwanese companies — was published _after_ it,
in the same paragraph. The cause is measured, not inferred: `composeArticleWithDiagnostics` reports
`ordering=relevance` for this story (its facts arrive as enriched units plus rss sentences, so
`oneDocument` is false), and `narrativeParagraphs` — the only path that enforces
`sourceOrder === previousOrder + 1` — never runs. Ranking had decided the dependent sentence came
first.

The same ruler that missed it had recorded the gap for a while: the audit's row _"of those, a pronoun
behind a connector (not covered)"_ counted these blocks separately, because `contextDependent` read
position zero and the sentence opens on `However`.

## The measurement put to the arbiter

Frozen corpus `tmp/corpus-after.json`, 200 events, 2026-10-17:

| measure                                                         | count |
| --------------------------------------------------------------- | ----- |
| facts whose opening needs an antecedent                         | 104   |
| of those, the source-adjacent predecessor is also selected      | 77    |
| of those 77, refused as `unresolved_context` before this change | 66    |
| of those 77, published before this change                       | 11    |

The refusal class was not theoretical: the Australian surfers verdict story lost five sentences
("Their bodies were found in a clifftop shaft…", "Their killings took place barely 36 hours after
they crossed into Mexico…") with their antecedents sitting right next to them in the source.

## The ruling

Option 1, with conditions. Quoted from the arbiter's reply:

- _"Approve option 1, with explicit eligibility and preservation constraints. Apply it to the ranked
  composition path, not as a new global rule that blindly reorders every sentence."_
- _"Ranking should determine what is worth publishing. It should not override the contextual
  dependency required to make a selected sentence understandable."_
- (a) predecessor fails its gate → _"Refuse the dependent fact, as today. Do not bypass the failed
  predecessor and publish the dependent sentence anyway."_
- (b) _"Body first. Do not silently change deck composition in this release."_
- (c) _"Yes. Required for acceptance."_ — every repair reported by name, before → after, with both
  source positions and the outcome.
- (d) _"Yes."_ — a previously refused sentence may publish when the context is now established, but
  _"Do not manufacture an antecedent."_
- _"Mere sentence adjacency is necessary for this repair but is not, by itself, proof of semantic
  resolution."_
- _"Do not claim that all 66 refusals should disappear. The measured upper bound describes the
  candidate population, not the guaranteed outcome."_

## What was built

- [`src/lib/editorial.ts`](../../src/lib/editorial.ts) — `deterministicParagraphs` (the ranked body
  path) finds the source-adjacent predecessor of a fact that needs an antecedent and publishes it
  directly in front of it, or splices the fact directly behind it when the predecessor is already
  published. Both facts must already be selected; nothing is pulled into the story, no gate is
  skipped, and the deck is untouched.
- A predecessor that is the deck counts as context only when it supplies the reference, by the same
  test.
- [`src/lib/reader-evidence.ts`](../../src/lib/reader-evidence.ts) — `antecedentSupplied`: the
  evidence guard the ruling demanded. A plural reference (`they`, `their`, `both`) needs a plural
  noun phrase in the sentence before it; a demonstrative with a noun (`those turbines`, `these price
increases`) needs that noun. Everything else — `he`, `she`, `it`, a bare `this` — keeps the
  refusal it has today, because telling a person from a company is the one thing this layer cannot
  do without a model.
- `contextDependent` now sees a pronoun behind a connector (`However, they also …`), which is how
  the live defect was invisible to both the gate and the ruler.
- The block splitter will not separate a repaired pair: `ArticleParagraph` carries `glue`, the
  assembly moves the pair to the next block rather than leaving the dependent sentence at the top
  of one, and the gate refuses a dependent whose predecessor it refused.
- `npm run audit:reader` prints `source-adjacency repairs (ranked body path)` with every repair by
  name, both source positions and whether the prose actually carries it.

## Release report (the measurements the ruling asked for)

| asked for                                         | result                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frozen replay, stories with published prose       | **172 → 172** (unchanged)                                                                                                                                                                       |
| anaphoric facts / selected predecessors / refused | **104 / 77 / 66** — the same baselines                                                                                                                                                          |
| successfully repaired and republished facts       | **8** of a possible 66                                                                                                                                                                          |
| facts still refused                               | 85 `unresolved_context` (was 92); the animate and bare-`this` classes keep their refusal because agreement cannot be proven                                                                     |
| newly published facts                             | 8, each printed by name in the audit with its predecessor                                                                                                                                       |
| stories changed                                   | **6**, and every added sentence listed below                                                                                                                                                    |
| sentences added / removed                         | **+8 / −2**                                                                                                                                                                                     |
| unrelated changes                                 | none: story count, selection (1,556 facts) and every other rule's count unchanged except `article_limit` 10 → 11 (one sentence pushed past the article cap by the repairs in the surfers story) |
| stories withheld by this rule                     | **0**                                                                                                                                                                                           |
| blocks removed for this rule                      | **0** — both removals are sentences that were refused before, plus one article-cap drop                                                                                                         |
| must-be-zero lines                                | 0 / 0 (`delivered with no body`, `refused then published`)                                                                                                                                      |
| facts lost with no rule                           | **0**                                                                                                                                                                                           |
| context-dependent openings published              | 3 → 3                                                                                                                                                                                           |
| pronoun behind a connector published              | 1 → **0**                                                                                                                                                                                       |

The eight repaired sentences, all published:

```
Neanderthal wooden tools      They found spears, digging sticks, bark trays, parts of shelters…
Surfers (×4)                  Their killings took place barely 36 hours after they crossed…
                              Their bodies were later found with gunshot wounds… down a well
                              Their bodies, however, were not found for another week…
                              Their bodies were found in a clifftop shaft…
AI coding agents              That data encompasses 300 million individual "work events"…
Batteries vs gas turbines     Those turbines are often used by utilities as peaking power plants…
Renoir paintings recovered    They used an angle-grinder to open display cases…
```

The two removals, both named:

- Arc Raiders: _"However, this stance has been frustrating some players…"_ — `unresolved_context`.
  "This stance" is a demonstrative whose referent the sentence before it does not name ("A permanent
  ban is now the standard sanction…"), so under the ruling it is refused rather than published on
  proximity. Previously it published as the audit's one "pronoun behind a connector (not covered)".
- Surfers: _"During the trial the court heard the tourists were killed in an apparent botched
  robbery…"_ — `article_limit`, the article cap reached because four sentences were republished.

## Limitations, stated plainly

- **Animate references are still refused.** `He argued that the Nord Stream pipelines had "untied
Russia's hands"…` sits immediately after a sentence about explosions; publishing it on adjacency
  alone would have handed the reader a `he` with no person behind it. The class needs a
  person/organisation classifier this layer does not have, and stays recorded instead of guessed.
- **The live page still carries the old paragraph.** The repair changes what the composer produces;
  today's briefing was built before it, so the deployed article is only corrected for the next
  build. Verification is the composer output on the live event's own data, the frozen before/after,
  and the audit window.
- **The plural guard is coarse.** It asks whether a sentence contains a plural noun, not whether that
  noun is the antecedent — the Neanderthal repair passes on "tools" where the antecedent is the team
  named in the deck. It is a floor, not a proof; the ruling accepted that trade.
