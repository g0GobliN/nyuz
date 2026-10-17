# One story per briefing: the shared entity pair

**Ruling.** Arbiter, ChatGPT `nyuz` project, **2026-10-17** — option 1 of four, on a new chat
inside the project (the earlier thread being full is a free-plan condition, not a blocker;
[AGENTS.md](../../AGENTS.md) now says so).

> **1 — SHARED ENTITY PAIR.** Condition: both cards must share at least two capitalised content
> tokens that appear **adjacent in the same order in at least one title**, within the existing
> 48-hour window. No event marker required. Keep the existing safeguards and deterministic
> behaviour. Do not introduce model calls, reader-visible AI text, or broader fuzzy matching.

The rest of this file is the evidence the ruling was made on, and the acceptance criteria it
carried.

## The defect, in the reader's own output

Replayed read-only on the live pool (`scripts/briefing-preview.ts --user 640a69b6`, 2026-10-17).
The next briefing had **7 cards**, and three of them were the same product story:

```
1 src 20:31  Benchmarked: Nvidia's RTX Spark notebook delivers serious local AI compute, at a price
1 src 15:00  A week with RTX Spark: everything we've learned using Nvidia's new laptops
1 src 12:00  Microsoft Surface Laptop Ultra review: RTX Spark in a straight-up beautiful Windows laptop
```

Three reviews of one laptop, same day, from three outlets. Repetition and duplicated stories are
release-blocking in the product's own rubric, and this is the first time the failure is visible in
a briefing's actual contents rather than inferred from a feed.

## Why the existing gate let it through

`suppressStoryTwins` (`src/lib/pipeline/duplicates.ts`) needs three conditions at once:

1. at least two shared content words — **satisfied**: `rtx`, `spark`;
2. at least one capitalised entity on both sides — **satisfied**;
3. a shared **event marker group** (`ipo`, `arrest`, `deal`, `funding`, `court`, `layoffs`,
   `launch`, `security`, `disruption`, `policy`) — **not satisfied**: a review announces no event,
   and `review`, `benchmarked`, `hands-on` appear in no group.

So the pair was rejected by the one condition that exists to keep unrelated stories apart, on the
class of story where it is least relevant. Clustering cannot close the gap either: these are three
different articles that legitimately make three different events.

## Why the marker condition is the wrong gate for a product name

The marker asks _what happened_. For two accounts of one incident, that is the right question — it
is what makes "two outlets, one story" a claim about the world rather than about words. For a
product, the identity is in the **name**, and a name is written the same way on both sides:
`RTX Spark` in a benchmark, in a week-long diary, and in a laptop review. Adjacency is what makes
the name a name: two capitalised tokens next to each other in the same order is a product or a
person, while the same two tokens scattered through a headline are two facts about a company.

## The rule, exactly

Two briefs are twins, within the caller's 48-hour window, when their titles share an **adjacent
capitalised bigram** in the same order — `rtx spark`, `surface laptop` — with both tokens in the
content vocabulary (stopwords are not part of a name). No marker is required for this condition.

Everything else is unchanged:

- the stored `primary entity + shared figure` test still runs first and still decides the pairs the
  word tests cannot see;
- the marker path still runs for stories that share no adjacent pair;
- `suppressDeliveredDuplicates` (the same event, and near-identical headlines) is untouched;
- no model call, no reader-visible text, no new data.

What the rule deliberately does **not** do:

- **A shared company name alone does not merge.** `Microsoft` in two headlines is one token; it
  fails the two-word requirement, exactly as the arbiter required.
- **Two scattered entities do not merge.** `Trump` … `Iran` in different positions fails
  adjacency, so two unrelated stories about both actors stay two cards.
- **A Title Case headline does not contribute pairs.** When most words are capitalised,
  capitalisation says nothing about which word is a name, so the pair signal is skipped for that
  title — the same `TITLE_CASE_RATIO = 0.6` reasoning the shortlist already uses.

## Acceptance criteria (the arbiter's, verbatim in substance)

- The three RTX Spark reviews collapse to one story.
- Shared company names alone do not trigger suppression.
- Shared entities appearing separately (Trump … Iran) do not trigger suppression without an
  adjacent pair.
- The existing event-marker logic is preserved for stories that do not match the entity-pair rule.
- Regression tests cover the RTX Spark case and unrelated stories that share entities.

**Release rule.** Run the briefing preview against the same reader and verify that the three RTX
Spark cards no longer appear as three separate stories. Do not weaken an unrelated quality gate to
make the test pass.

## What this does not fix

The reader's seven cards still carry **no significance line** (0/7, measured the same run). That is
a separate defect with a separate cause, and the same measurement bounds it: of 1,000 unbriefed
matches, 0 have a stored impact, 0 an after-state, 27 a second publisher and 7 a money consequence.
The entity-pair rule makes the briefing shorter and truthful; it does not make it explain itself.
