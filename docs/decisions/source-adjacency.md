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

## The first guard published dangling references, and was tightened the same day

The first `antecedentSupplied` accepted **any word ending in `s`** anywhere in the predecessor. Read on
the live corpus the same afternoon (`npm run audit:reader`, 1,991 selected facts), it had published
two sentences whose reference it had manufactured:

```
Apple's HomeView has an app problem
  What gives here?                                    [predecessor]
  They then debate the merits of returning to X …     [published — the `s` was the verb `gives`]

A fake WhatsApp clone is showing up before the real version on the Play Store
  Android Authority points out that the WhatsApp clone may be using Early Access,
  which could have helped users warn people against downloading the app.   [predecessor]
  Their listing for the WhatsApp impostor has the same icon …              [published — the letters
                                                                           were `points`, `reviews`,
                                                                           `users`, none of them the
                                                                           referent of `Their`]
```

The frozen replay had two more of the same kind under that guard: a quotation ("The morphology of
these 13 tools…") accepted as the antecedent of `They found spears`, and `France saw its biggest art
robbery … in years` accepted as the antecedent of `They used an angle-grinder`. That is the defect the
repair exists to remove, so the guard now asks for the group in the predecessor's **own subject**: it
stops at the first recognisable finite verb, refuses a sentence that opens on a quotation, refuses
when no verb can be found, and accepts a plural only inside that subject zone. A sentence that opens
on `They`/`Them`/`Their`/`Both` is the one case where the chain is explicit and no inference is
needed.

## Release report (the measurements the ruling asked for)

Final guard, two corpora, both measured 2026-10-17 after the tightening:

| asked for                             | frozen 200-event corpus                                                 | live 200-event corpus                 |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| facts repaired and published          | **3**                                                                   | **2**                                 |
| every repair named with both positions | yes — the audit prints each pair and whether the prose carried it       | yes                                   |
| facts rendered                        | 1,401                                                                   | 1,794                                 |
| facts still refused                   | 155, of which 90 `unresolved_context` (the animate and bare-`this` classes) | 197                                |
| facts lost with no rule               | **0**                                                                   | **0**                                 |
| stories withheld by this rule         | **0**                                                                   | **0**                                 |
| `article_limit`                       | 10 — the baseline                                                       | 12 (unchanged from before the change) |
| must-be-zero lines                    | 0 / 0                                                                   | 0 / 0                                 |
| context-dependent openings published  | 3 — unchanged, the documented NTT class                                 | 5 — unchanged                         |
| pronoun behind a connector published  | **0**                                                                   | **0**                                 |
| `unresolved_context` refusals         | **90** (92 before the change)                                           | —                                     |

The repaired sentences, all published and all read in place:

```
Surfers                    The murders sent shockwaves around the world…
                           Their killings took place barely 36 hours after they crossed…
AI coding agents           AI agents are still a relatively new part of the coding world…
                           That data encompasses 300 million individual "work events"…
Batteries vs gas turbines  The effects have been more acute for open-cycle gas turbines…
                           Those turbines are often used by utilities as peaking power plants…
Taiwan industrial park     Major Taiwanese companies are more than capable…
                           However, they also rely on several smaller manufacturers…
Key Practices (SI)         The product outlines ten voluntary core practices…
                           This product aligns with cyber incident response best practices…
```

What the tightening cost, named: six sentences the loose guard published are refused again — the two
dangling references above, plus four that happened to read correctly but could not be proven
(`They come after the company revealed…`, `They then broke into…`, `They're meant for developers…`,
and the Neanderthal and Renoir sentences). The ruling's bar was evidence, not recall: _"Do not
manufacture an antecedent."_ Losing a readable sentence keeps the page honest; publishing a dangling
one is the defect.

One removal remains from this work, and it is not caused by the tightened guard:

- Arc Raiders: _"However, this stance has been frustrating some players…"_ — `unresolved_context`.
  "This stance" is a demonstrative whose referent the sentence before it does not name ("A permanent
  ban is now the standard sanction…"), so under the ruling it is refused rather than published on
  proximity. Previously it published as the audit's one "pronoun behind a connector (not covered)".

## Limitations, stated plainly

- **Animate references are still refused.** `He argued that the Nord Stream pipelines had "untied
Russia's hands"…` sits immediately after a sentence about explosions; publishing it on adjacency
  alone would have handed the reader a `he` with no person behind it. The class needs a
  person/organisation classifier this layer does not have, and stays recorded instead of guessed.
- **The live page still carries the old paragraph.** The repair changes what the composer produces;
  today's briefing was built before it, so the deployed article is only corrected for the next
  build. Verification is the composer output on the live event's own data, the frozen before/after,
  and the audit window.
- **The guard still reads grammar, not meaning.** It proves that the predecessor's subject is a
  plural, which is why `The murders sent shockwaves … / Their killings took place …` passes: the
  victims are named earlier in the story, not in that sentence. It cannot prove the subject is the
  thing the pronoun means, and it says so rather than implying otherwise. The direction is one-way:
  the tightening removed every dangling reference found by reading, and the audit prints each
  surviving repair with both sentences so the next check is reading, not counting.
- **Animate references and bare `this` are not repaired at all.** They keep their refusal, so a
  sentence that needs a person or a whole preceding clause stays out rather than being guessed.
