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

## The rulings (arbiter, 2026-10-20) — #17, #18, #19

**Deadline: Saturday 24 October 2026, 23:59 JST (14:59Z).** Four working days, cut from the twelve-day
schedule at the arbiter's direction on 2026-10-20. What the cut buys is a briefing a stranger reads clean;
what it costs is the seven-consecutive-clean-deliveries hold, so the result is *certified for one delivered
briefing*, not *held*. Gate 2 (significance, window closes 2026-11-18) is untouched by any of it.

The rulings were taken against the delivered lines themselves, not against the catalogue above. Two of the
document's own readings did not survive that test, and the corrections are recorded here rather than
quietly fixed, because they change what the implementer builds.

### #17 — the opening must stand alone (option 2, with option 1 as the floor)

`unresolvedContextOpening` returns **false for all 25 delivered lines**, including all four
dangling-reference openings. The guard is not weak on this population; it is blind on it: it asks
`contextDependent`, whose classes are pronoun subjects, connector + pronoun, fronted clauses, and "the
figure". `None of them`, `The authors`, `The EBU` and `a starker view` are none of those. This is measured,
not inferred — the 25 delivered lines were dumped from `4a6b2ad2` and each was put through the guard:

```
unresolvedContextOpening(delivered line)  ->  false, 25 of 25
```

**Ruled:** widen the reference test, at composition, with exactly two new classes, both resolved from the
card's own material:

1. **a bare definite or quantified NP whose head the title does not establish** — `None of them`, `The
   authors` against a title that names no authors;
2. **an acronym in the opening that neither the title nor the opening expands** — `The EBU`, against a
   title that says `European Public Service Broadcasting`.

Keep the quotation test. Where a candidate fails, the deck walk advances to the next qualifying candidate
(option 2's repair is permitted only where the title names exactly one subject that can replace the
reference without inventing a fact — never a paraphrase from the event's entities at large). A story whose
every candidate fails is withheld (option 1's floor). **Widening at composition is what keeps ruling #11
intact**: the card is still the page's opening, so the delivered artifact needs no second path.

Expected on the delivered 25, from the dump, and the acceptance the implementer reports against:

| card | opening | after #17 |
| --- | --- | --- |
| 01 | `The EBU and NVIDIA …` | changes — acronym never expanded |
| 02 | `None of them were …` | changes — no antecedent anywhere |
| 16 | `The authors were looking …` | changes — title names no authors |
| 19 | `Security outfit Huntress offered a starker view and wrote "…"` | changes — opens on a quotation (ruling #10a's class, bypassed here) |
| 16's neighbour | `The Department of Homeland Security …` | **unchanged** — the title establishes the head |
| 18 | `The Prometheus supercluster …` | **unchanged** for this rule — title establishes `Prometheus`; its defect is thinness (#19) |

Four of twenty-five, which is the 12–16 % class already measured. No card is withheld unless it has no
other candidate.

### #18 — one story must not arrive twice (option 3, retargeted to the delivery pass)

**The figure guard is not the sufficient cause, measured.** With the figure removed from the Tom's Hardware
title, so the guard cannot fire, `sameStory` still returns **false**; `sameIncident` returns **false** (the
pair shares no PRIMARY entity, and the Verge title carries no figure at all); and the pair fails the anchor
bar on its own terms — `hacker` and `agents` are the only two anchors, and three anchors require
`titleSimilarity >= 0.4`, which these two do not meet. Relaxing the guard alone would admit nothing, and
would spend risk on every other pair to do it.

The pass that actually delivers the duplicate is the **delivery twin test**: `suppressStoryTwins` over the
two delivered lines returns **both**. The cause is the marker vocabulary — the `security` group is
`breach, breached, hacked, ransomware, leak, leaked`, and neither `hacker` nor `broke into` contains any of
them, so the pair never reaches the overlap test it would have passed (`hacker`, `agents`, `website`; shared
capitalised `AI`; generic marker with overlap ≥ 3).

**Ruled:** add `hack`, `hacker`, `hacking`, `break in`, `break into`, `broke into` to the `security` marker
group, **at the delivery twin pass only**. Do not touch `sameStory` or `cluster.ts`: a wrong merge is
permanent and visible on every surface, a suppressed card is one story the reader does not see twice.
Acceptance: `suppressStoryTwins` over the two delivered lines keeps **1 of 2** (03, which ranks first), the
briefing delivers 24 cards, and over the 30-day twin corpus no pair is suppressed that does not also share
a capitalised entity and three content words.

### #19 — hygiene, one rule each

- **Garble.** `ot` is the source's own typo, and ruling #6's precedent applies: refuse the sentence, do not
  repair it. The delivered sentence also opens on `the agents` before the card names them, so #17's widened
  test displaces it anyway. `Character. AI` is not a typo — it is the sentence splitter cutting inside a
  proper name. Split on a full stop only when it is followed by whitespace **and** the token before it is
  not a known product name; normalise the spaced form to `Character.AI` only where the product's own entity
  list holds the canonical name. No dictionary, no spell-checker.
- **Truncated title.** The stored title is complete (`… to probe security SNAFU`); `probe securi` is the
  card's clamp cutting mid-word. Clamp on word boundaries and never cut inside a word.
- **Thin card.** A card must carry a change, not a state. Copular or locative openings (`is housed in`,
  `was built in`) are not events; withhold the card when no other fact carries a change verb. This is the
  rule that removes 06, 15 and 19 as they stand.
- **Deal.** The briefing gate gets the purchase-shape test the home feed already applies to coupon pages —
  a price, a purchase frame, and no event — and excludes the story.

### Acceptance for the four days

One run each, recorded in the handoff, on a briefing built after the change:

```
npm run audit:delivered-line                  -> 24 / 24 card lines equal their page opening (04 suppressed)
suppressStoryTwins(03, 04)                    -> 1 kept of 2
unresolvedContextOpening(delivered lines)      -> true for every remaining dangling-reference opening
card titles                                   -> no mid-word cut
```

A card count below 24 is a finding, not a pass: it means #17 or #19 withheld something the bar would have
kept, and it gets reported before it gets tuned.
