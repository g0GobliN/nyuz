# The story page opens on the event, and every noun it uses first gets its three words (2026-10-27)

**Status: implemented in `src/lib/editorial.ts` on `wt/story-opening`.** This note re-measures audit
rows I-09 to I-12 on the delivered pages **as they read today**, records which rule closed each one,
and names what is still not fixed and why. Source of truth:
`docs/reader-clarity-audit-2026-10-22.md`, rows I-09–I-12 (the audit's own grouping, line 267:
*"The article composer (`composeArticle`) and its evidence ordering. These are the four blockers."*).
Owner plan: `docs/plan-2026-10-23-to-11-01.md`, wave 3, target 2.

The measured population is the delivered 2026-10-21 briefing, digest `7268ba11`
(2026-10-21T22:30Z, ready, 25 items) — the same pages the audit read. All 25 stories were composed
from the same stored rows under three builds of the composer (origin `main`, branch commit
`e11928a`, and this tree) and compared page by page; see "Blast radius, measured" below.

## Re-measurement: the four rows, quoted as they read today

**Blockers live: 4 → 0.**

| Row | The audit's defect (verbatim) | The page today | Verdict | Closed by |
| --- | --- | --- | --- | --- |
| I-09 | Card 06 opens on `August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.[1]` — "a date fragment with no subject, no verb of its own and no event" | **`On August 20, 2026, Unauthenticated remote code execution (RCE) is confirmed against Drupal.`** — a sentence with a subject, a verb, the event, and the date spoken into it | **fixed** | The deck walk's states-the-event tier and `speakDateIntoSentence` (commit `e11928a`); the body's forward order from the chronology slice (PR #58, `d81b33c`) |
| I-10 | `As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video.` — the main clause is about the video, not the thing that matters | **`Calif, one of the security firms that had reported the issues mistakenly published a video, as a result of the leak and pre-announcement around 20:00 UTC.`** — the action leads; the cause is the tail | **fixed** | The fronted-consequence demotion in `composeArticleWithDiagnostics` (this branch, tested in `editorial.test.ts`, which quotes the audit's sentence verbatim) |
| I-11 | `The video contributed to accelerated development of various PoCs (exploitation proof of concepts), which then increased circulation on October 21st.` followed by bare date fragments in the wrong order; `RCE` and `Drupal` unexplained | `RCE` glossed at first use in the deck (see I-09); `PoCs (exploitation proof of concepts)` glossed in the paragraph; the fragments run **forwards**: `August 24 → September 21 → October 21` | **fixed** (with one unfixable noun — finding 2 below) | The chronology slice for the order (PR #58); the acronym prose scan and two-letter guard (commit `e11928a` + this branch) for the glosses |
| I-12 | `Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt, Wikipedia, and the blog where the bar around the corner posts pictures of people's dogs.` — the last clause has no referent and closes the story | Card 09's last paragraph ends **`Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt and Wikipedia.`** The referent-less clause is gone; `bar around the corner` appears on **0** of 25 pages in every build measured | **fixed** | A storage-side rule — rook's `7fe7bdc` (2026-10-23, on `main`): a stored sentence whose final list item names nothing is refused before the composer ever sees it, with its own tests in `src/lib/story-clarity.test.ts`. The composer rule (`dropUnresolvableListItems`) also protects any future row |

Card 01 (`11ecd424`), which the audit's I-rows touch only through I-14/I-03, was re-read too: its
deck opens on the source's own sentence and none of the four defects appear on it.

## The rules the page now follows

All inside `src/lib/editorial.ts`; none is keyed to the audit's four strings (standing rule 3 — a
rule that only fires on the audit's fixture is not a fix).

1. **The deck opens on a sentence that states the event.** The deck walk tries, in order: a candidate
   sharing at least two central tokens with the story's summary (`statesTheEvent`); the timeline's
   first step; any candidate that is neither an opening quotation nor a prevalence statistic; a
   candidate that is not an opening quotation; a candidate that is not a prevalence statistic; and
   only then the ranked first candidate.
2. **If nothing can state the event, the date is spoken into the sentence.** A deck chosen from the
   timeline reads `On August 20, 2026, Unauthenticated remote code execution is confirmed against
   Drupal.` — never a bare `August 20, 2026: …` fragment. The spoken words come from the story's own
   material: a word is lowercased mid-sentence only when the story's facts or source excerpts attest
   it lowercase somewhere (`Drupal` keeps its capital; `unauthenticated` takes it).
3. **Every acronym the page uses first gets its expansion at first use.** The prose scan walks the
   candidate sentence for the expansion's own words (a sliding window of exactly the acronym's letter
   count, each word a plausible English word), and the gloss is only applied when the expansion's
   word count — discounting `and`/`or` — equals the acronym's letter count, which is what keeps
   `IT`/`US`/`AI`-shaped noise from being "expanded". Measured cases: `RCE` glossed once, in the
   deck; `PoC` glossed once, in the paragraph that first uses it.
4. **A sentence that opens on a consequence of something the page never said leads with its action.**
   A fronted `As a result of <cause>, <actor> <did the thing>` is demoted to `<actor> <did the
   thing>, as a result of <cause>.` — position only; every word stays the source's own. The regex is
   deliberately narrow (cause 10–150 chars, no commas, no quotes) and the connective `As a result, …`
   is untouched, because nothing there is out of order.
5. **A stored list item that names nothing is refused before composition.** Rook's rule from
   `7fe7bdc`: the `…and the blog where the bar around the corner posts pictures of people's dogs`
   clause is a content defect in the *stored* sentence, so the refusal lives with the storage
   validation, not in the composer's ordering. Quoted speech is never touched (ruling #6).

## The merge regression this branch caught, and the tier it restored

Composing the 25 delivered stories at the branch commit surfaced a regression the merge `9e69a05`
introduced in the deck walk: rook's I-13 guarantee — *a prevalence statistic may never open the page*
(`7fe7bdc`, ruling #10a) — was lost when `e11928a` made the top tier stricter. With no stored summary
to anchor `statesTheEvent`, the walk fell past the strict tier to the not-a-quotation tier, and the
W3Techs "69.3 percent of all the websites whose server-side programming language we know" statistic
opened the page before the not-a-statistic tier ever got a turn. `src/lib/story-clarity.test.ts`
"demotes the statistic to the body when an event can open" failed at the branch commit; bisected to
the tier order, not to this branch's uncommitted work (passing with `main`'s composer).

The fix restores the combined tier between the timeline tier and the individual tiers: **a candidate
that is neither an opening quotation nor a prevalence statistic beats anything a statistic could
out-rank.** The strict states-the-event tier is unchanged — when a sentence can state the event, it
still wins. Blast radius of the tier itself, measured: **0** delivered pages changed
(5 pages differ head→after before the tier fix, 5 after; the audit cards are byte-identical).

## Findings this does not fix — recorded, not padded

1. **The opening is the fallback, and the fallback is named.** The audit's ideal opening —
   `Researchers at Wiz found two critical flaws in PHP, the language that runs much of the web. The
   PHP project patched them on 21 October.` — is a *summary sentence*, and no stored fact says it
   (the chronology slice's own finding). The page therefore opens on the timeline's first readable
   step with its date spoken in. That is the documented fallback, not the ideal.
2. **`Drupal` cannot be glossed from stored material.** No stored fact or source excerpt for this
   story explains what Drupal is; the composer may only reuse the source's own words, so inventing
   "a content management system" for it is out of bounds. The word passes unglossed, on purpose.
3. **"the leak" is still first met inside a consequence.** The demotion fixed the *order*; the noun
   `the leak` itself is never introduced on the page. Stored material carries the explanation — the
   source's standfirst says `…thanks to a leak in the coordinated disclosure process` — but the
   evidence pass refuses that sentence (`invalid_sentence`), so the composer cannot reach it (same
   root as the chronology note's finding 3). Fixing it is a change to the sentence gate, which this
   card does not own.
4. **The body's first paragraph still opens on bare date fragments.** `August 24, 2026: Wiz Research
   reports the vulnerabilities to the PHP security team.` opens paragraph 1 — in the right place and
   the right order now, but still a fragment shape. The audit's I-09 complaint was about the page
   *opening*, which is fixed; the fragment-in-the-body shape is recorded here for whoever takes the
   next prose slice.

## Blast radius, measured

The same 25 delivered stories (digest `7268ba11`), each composed from identical stored rows by three
builds of `src/lib/editorial.ts`: origin `main` (`a4c8bfe`), the branch commit (`e11928a`), and this
tree (uncommitted work + the tier fix). Deck and every paragraph text compared per page.

| Comparison | Pages changed | The pages |
| --- | --- | --- |
| `main` → this tree | **6 of 25** | Today's PHP Security Release (card 06); Anthropic pitches AI safety bill; The spec is the new code; Nvidia woos wary Europeans; AI will eat a fifth of tech budgets; GM promises smarter cars |
| branch commit → this tree | **5 of 25** | Today's PHP Security Release (card 06); ASML … expedite shipments to Musk's Terafab; Jensen Huang sends in the robot ducks; Blacksmith hits unicorn valuation; Nvidia woos wary Europeans |
| tier fix alone | **0 of 25** | (5 pages differ head→after both before and after the tier fix; card 06 and card 09 byte-identical across it) |

Attribution: card 06's deck fix and the acronym glosses are `e11928a`; the Calif demotion, the
two-letter guard and the date-speak witness fix are this branch's uncommitted work; the I-12 refusal
is rook's `7fe7bdc`, already on `main`. Every changed page changed for a named rule; no page changed
for an unexplained reason.
