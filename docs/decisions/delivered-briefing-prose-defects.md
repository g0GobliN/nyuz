# The delivered briefing is aligned and still not readable

**Measured 2026-10-19, on the first briefing built after ruling #11's fix** —
`4a6b2ad2-857a-4680-8fc7-e6f88065f534`, scheduled `2026-10-19T22:30Z`, built `22:58:35Z`, **25 cards,
`status = sent`**, publisher count **1 on every card**.

## What the acceptance instrument says, and what it does not

```
npm run audit:delivered-line
ruling #11  PASS  25 / 25 card lines equal their page opening (0 defects, 0 no-deck fallback)   exit 0
```

Item 1 of the four is therefore **green**: the card line and the page opening are one composition, which is
what that ruling was about. The instrument measures *alignment*. It says nothing about whether the sentence
is worth reading, and the standing bar is what a reader actually receives. So the briefing was read as a
stranger would read it. **Eight of the twenty-five cards have a defect of a class the bar names.**

## The catalogue (positions are the instrument's, so card `[01]` is `position 0`)

| # | card opening, as delivered | defect class |
| --- | --- | --- |
| 01 | "The EBU and NVIDIA are expanding the sovereign standards…" | opens on an acronym the card never expands |
| 02 | "None of them were particularly impressive by themselves…" | **opens on a reference with no antecedent at all** |
| 03 | "Fewer than 100 Chinese characters were used, yet the agents had attempted **ot** break into…" | typo in reader-facing text ("ot"), and "the agents" arrives before the card names them |
| 04 | "A hacker broke into more than 100 websites using an army of AI agents…, according to … **Norforge**" | same story as 03, delivered again (see below); an outlet name the card cannot vouch for |
| 06 | "Everything becomes effectively open source, which closes down substantial revenue streams…" | an assertion, not an account of what happened |
| 09 | "If Disney is chosen as the winning bidder by **Character. AI**…" | mangled entity name, twice |
| 15 | "The response to music gear that uses AI and vibe coding has been mixed." | the headline restated; no event |
| 16 | "**The authors** were looking at it wrong: What seemed like tangled… networks may actually follow a hidden logic." | definite reference to people the card never names |
| 19 | "The Prometheus supercluster is housed in Meta's New Albany, Ohio, data center." | one locational fact, `importance 0`, no significance |
| 20 | title ends "…services to probe **securi**" | **truncated title, reader-facing**; opening is a comparative ("a starker view") with nothing to compare |
| 22 | "For a very limited time, Sony's latest high-end noise-canceling earbuds are actually cheaper…" | a shopping deal in a news briefing |

Classes, counted: **unestablished opening reference 4** (01, 02, 16, 20 — 16 % of cards), **same story twice
1 pair** (03/04), **garbled or mangled text 2** (03 "ot", 09 "Character. AI"), **thin card 3** (06, 15, 19),
**truncated title 1** (20), **deal 1** (22).

A machine count over every delivered briefing in the store (25 briefings scanned; only this one carries
items, so the population is 25 cards) puts the opening-reference class at **3–4 of 25 = 12–16 %**, which is
the figure to move.

## Why 03 and 04 were delivered twice — the mechanism, measured

The two cards are one incident:

- Tom's Hardware — "A Chinese hacker used AI agents to break into more than 100 company websites"
  (`…/a-chinese-hacker-used-ai-agents-to-break-in`)
- The Verge — "A hacker broke into John Deere and SharkNinja with an army of AI agents"
  (`…/1013643/ai-agents-hack-john-deere-shark-ninja-cummins`)

`cluster.ts` pairs a cross-outlet article only when `sameStory()` holds. In `news-signals.ts:308–311`:

```ts
const figuresA = figures(a);
const figuresB = figures(b);
if ((figuresA.size > 0 || figuresB.size > 0) && ![...figuresA].some((f) => figuresB.has(f)))
  return false;
```

One headline carries the figure **100** and the other carries none, so the pair is rejected before
`sameIncident()` or the shared-word test is ever reached. **The guard fires on "either side has a number",
so a paraphrase that omits the number can never pair with the version that states it** — and a paraphrase
is exactly what a second outlet writes. This is not one unlucky pair: it is the shape of the 169
multi-publisher events out of 12,733 complete ones, and it is why the significance ladder reads
`none 13` — the ladder's `coverage` rung needs two publishers on one event, and the rule that would give it
two is refusing.

## The two rulings this needs (numbered options)

**#17 — an opening must stand on its own.** The card line is the opening of the page, so it is the only
sentence a reader is guaranteed to see.

1. **Refuse the sentence** — if the first sentence opens on a pronoun, a bare definite NP, or an acronym
   the card has not expanded, take the next sentence from the same paragraph; if none qualifies, compose
   the opening from the event's title and the first sentence that stands alone; if still none, withhold the
   card. Strictest, and it can cost cards on a thin day.
2. **Repair the sentence** — rewrite the reference deterministically from the event's entities (name the
   subject the title names) before falling back to option 1. Keeps cards, risks a formulaic opening.
3. **Only the worst three words** — block the pronoun and "none of" openings, leave definite NPs alone (so
   01 "the EBU", 16 "the authors", 20 "a starker view" stay).
4. **Leave the prose; make it visible** — keep delivering, and count the class in an instrument so the
   number is watched. Cheapest, and it accepts defects in what a reader reads.

**#18 — one story must not arrive twice.** The figure guard is the measured cause.

1. **Require a shared figure only when both titles carry one** — the narrower fix, and it admits 03/04.
   Risk: "…cuts 20 %…" vs "…raises prices…" pairs if the words align; the negation key still separates
   opposite claims.
2. **Keep the guard, add an entity path** — pair when both titles name the same ≥2 entities *and* share an
   incident verb, regardless of figures.
3. **Keep the guard, add a number-equivalence path** — pair when the only figure difference is
   presence-vs-absence and the shared content words clear a higher bar.
4. **Leave it**, and accept that cross-outlet coverage needs near-identical headlines.

## What is not in dispute

No model may write any of this; every rule above is a string/number test on stored data. Delivered archives
stay immutable. Item 1's alignment line is genuinely green and must stay so.
