# The composer reads a story's timeline forwards (2026-10-23)

**Status: implemented in `src/lib/editorial.ts`.** One part of the audit's ideal fix — a *summary*
opening for the story — is **not** implemented, because it cannot be produced from the stored rows
without inventing copy. It is recorded here as a finding, not as a ruling, and the card it came from
asked for exactly that.

**The defect.** The reader-clarity audit (PR #54, `docs/reader-clarity-audit-2026-10-22.md` — on that
branch, not yet on `main`) read card 06 of the delivered 2026-10-21 briefing — *"Today's PHP Security
Release…"* — and filed three blockers that are one defect (I-09, I-10, I-11): the composer prints a
story's sentences in an order that cannot be read.

1. **I-09** — it opened on `August 24, 2026: Wiz Research reports the vulnerabilities to the PHP
   security team.` A date six weeks into the page's own timeline, naming "the vulnerabilities" before
   the reader has been told there are any.
2. **I-10** — the paragraph below it opened `As a result of the leak and pre-announcement around 20:00
   UTC, Calif, …`, referring to "the leak" before the sentence that establishes the leak, and naming
   Calif before anything says who it is.
3. **I-11** — a paragraph printed `The video contributed … October 21st` and then `August 20, 2026: …`,
   `September 21, 2026: …`, `October 21, 2026: …` — a timeline read backwards, in the paragraph that is
   supposed to explain what happened.

**Which file chose the order: `src/lib/editorial.ts`.** `deterministicParagraphs` assembles a paragraph
in *rank* order (facts are grouped by the kind of sentence they are, the groups are sorted by
`groupRank`, and facts are pushed in the order `composeArticle` handed them over), and the deck is
picked by walking the ranked candidates. `src/lib/reader-article.ts` plays no part: it is the read-back
validator for stored articles and orders nothing.

**Reproduced from stored rows, not from the audit's quotation.** Event
`a3e60b09-757a-4b32-8c63-8b106d8affeb`, 2026-10-21, one source, 12 selected facts (6 enriched units
from the post, 6 rss units from the PHP Foundation's disclosure timeline). Before the change the
composer printed:

```
deck  August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.
p1    As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms
      that had reported the issues mistakenly published a video. In response, the PHP project brought
      its pre-announcement forward and published it at 19:30 UTC. On Tuesday, October 20th, at around
      15:00 UTC, the two CVE IDs began circulating on online forums and social media.
p2    The video contributed to accelerated development of various PoCs (exploitation proof of
      concepts), which then increased circulation on October 21st. August 20, 2026: Unauthenticated
      RCE is confirmed against Drupal. September 21, 2026: PHP acknowledges the reports and begins
      developing a coordinated fix. October 21, 2026: Patched PHP releases become available. Copies
      of the deleted video started circulating on social media soon after.
```

After it:

```
deck  August 20, 2026: Unauthenticated RCE is confirmed against Drupal.
p1    August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.
      September 21, 2026: PHP acknowledges the reports and begins developing a coordinated fix.
p2    On Tuesday, October 20th, at around 15:00 UTC, the two CVE IDs began circulating on online
      forums and social media. In response, the PHP project brought its pre-announcement forward and
      published it at 19:30 UTC. As a result of the leak and pre-announcement around 20:00 UTC,
      Calif, one of the security firms that had reported the issues mistakenly published a video.
      Copies of the deleted video started circulating on social media soon after.
p3    The video contributed to accelerated development of various PoCs (exploitation proof of
      concepts), which then increased circulation on October 21st.
p4    October 21, 2026: Patched PHP releases become available.
```

Every date on the page now runs forwards, the reader meets the leak before the sentence that is a
consequence of it, and the actor is named before the sentence that leans on it.

## What the rule is

Four parts, all inside `src/lib/editorial.ts`, all keyed on one condition: **the story carries a
timeline**, meaning two or more selected facts that *open* on a calendar date (`August 24, 2026: …`).
One dated sentence is not a timeline and changes nothing.

1. **`chronologyTimeline`** collects those facts and sorts them ascending. A fact that needs an
   antecedent is left to the adjacency path, because publishing it here would publish it without the
   sentence it depends on (arbiter ruling #4, 2026-10-17).
2. **The deck may not open mid-timeline.** `deckCandidateOrder` keeps the ranking, but a dated fact
   that is not the timeline's first step may not stand in for the story.
3. **The body is the timeline and the narrative, woven by date.** `chronologyBody` hands over three
   blocks at most: timeline steps that fall before the day the narrative starts, then the narrative as
   one block in date order, then timeline steps that fall on or after it. That is what keeps the page
   monotonic — held whole, the timeline would end on `October 21, 2026: Patched PHP releases become
   available` and the narrative would step back to `October 20th`.
4. **A paragraph's sentences are read in the order they happened.** `chronologyOrderedGroup` sorts a
   block by day and then by clock time, and reads a sentence that states only a clock time
   (`… at 19:30 UTC`), or no date at all, as belonging to the day its paragraph is about. A block
   built around an adjacency repair is never re-sorted: that repair exists to put a dependent sentence
   directly behind its predecessor.

### Why the ordering had to be done in sequence, not in paragraph boundaries

The quality gate re-blocks whatever the composer hands it: it splits every block into sentences,
judges them one at a time, and then merges neighbours that share a citation until
`PARAGRAPH_WORD_BUDGET` (75 words) is spent. A composer paragraph boundary is therefore *advice*.
Measured while building this: the timeline was made its own block and the sentence after it
(`Copies of the deleted video …`) still landed in front of the paragraph it belongs to, because
nothing in the gate had to respect the boundary. So the composer now controls the **sequence** and
lets the gate re-block it, and a block that must stay whole is marked `standalone` on
`ArticleParagraph` — two adjacent sentences merge only when they agree about that flag, which fences
the block at both ends.

## Blast radius, measured

| Corpus | Stories | Stories the pass fires on | Pages changed |
| --- | --- | --- | --- |
| Frozen window `2026-10-21T00:00Z → 2026-10-22T02:30Z` (a full day of the pipeline) | 450 | **1** — card 06 | 1 |
| The 200 newest events, frozen before the change | 200 | 0 | **0** |

The 200-event diff is story by story: `deck` and every paragraph text identical, 200 of 200. It also
caught a scope error the first draft had: with the paragraph sort applied to *every* story, one
unrelated card ("Tigray resumes daily life amid fears of wider war") had its sentences reordered. The
whole pass is therefore gated on the story carrying a timeline, and the diff is 0 after that.

## Findings this does not fix — recorded, not padded

1. **The page still opens on a timeline fragment, because no sentence in this story can open it.**
   The audit's ideal opening is a summary: *"Researchers at Wiz found two critical flaws in PHP, the
   language that runs much of the web. The PHP project patched them on 21 October."* No stored fact
   says that. The timeline's own first step (`August 19, 2026: Wiz Research discovers the first PHP
   vulnerability …`) exists only inside a meta sentence — *"This article from the team that discovered
   the original vulnerability includes a more detailed timeline …"* — which the composer refuses for
   an unresolved document opening, correctly. `August 20, 2026: Unauthenticated RCE is confirmed
   against Drupal.` is the earliest readable step, so it opens the page. It is a fragment, but it is
   the *first* fragment, and the sentence after it is no longer a consequence of something the reader
   has not been told.
2. **The stored summary cannot stand in for that opening.** `events.what_happened` for this event is
   `August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.` — the same
   mid-timeline fragment, because the summariser picked a timeline line. `applyFallbackDeck` therefore
   reproduces the defect rather than repairing it. That is an ingestion defect with its own card, not
   an ordering one.
3. **The best opening in the story never becomes a fact.** The post's own standfirst — *"today's
   updates (across the entire PHP 8.x line) address two remote code execution holes, and there have
   been exploits circulating since last night, thanks to a leak in the coordinated disclosure
   process"* — is exactly the sentence a reader needs. The evidence pass refuses it
   (`invalid_sentence`, 8 of the source's units were refused), so the composer cannot use it. Making
   it selectable is a change to the sentence gate, not to ordering.
4. **"the vulnerabilities" in the second sentence has no earlier named referent.** `August 20 … RCE is
   confirmed against Drupal` establishes that a flaw exists and is exploitable, but does not name
   "vulnerabilities". Expanding it needs new copy, so it stays.
5. **A strict cross-source merge is not derivable from the store.** The two sources are ordered as
   units, not woven sentence by sentence, because `sourceOrder` for an enriched source is the index of
   the *evidence unit* and that pass writes its units in the order it judged them. Measured on this
   story: the post's own text opens `On Tuesday, October 20th, at around 15:00 UTC …` while its
   evidence array opens `In response, …`. That is why the rule reads dates out of the sentences
   themselves and refuses to infer position from `sourceOrder`.
