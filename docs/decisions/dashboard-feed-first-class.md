# The dashboard's first floor class: a deal is not a thing worth knowing (ruling #9, 2026-10-18)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "ARBITER REQUEST 2026-10-18 #9",
reached from this session through the browser panel. The owner's standing instruction from #5 (*"discuss
with chatgpt … dnt ask me until both get conclusion"*) is why it went to the arbiter.

**Why it was asked.** The reader-quality loop's own rule is *open the site and read it as a stranger*, so
the live dashboard was read signed-in on 2026-10-18 — *"Good morning, goblin01. Your nyuz found 13 things
worth knowing."* Four of the 13 cards were not developments; the worst:

> **10.** *"Grab an RTX 5090 for a discounted $5,300 as part of an MSI Infinite ZS prebuilt gaming PC —
> price includes other components worth about $2,300 on their own"* — what happened: *"Best Buy has an
> MSI Infinite ZS in stock with an RTX 5090 ensconced within for $7,599 …"*

plus a Lego-kit fan replica, a flight-sim yoke review and a nine-year console mod. All 13 titles were run
through both gates that exist — `assessReadiness` (briefing) and `assessAlertFloor` (alerts) — and **all
13 pass both**: the dashboard feed is gated only by the title/summary rungs, so a deal card the alert path
refuses is the reader's front page. The dashboard is also the surface that matters most now, because
briefing email is deliberately off until launch.

**The arbiter's ruling, verbatim in the parts that bind:**

> "**Option 1 — Apply the alert-floor classes to the dashboard, one measured class at a time.**"

> "**Keep the dashboard wider than the briefing.** Do not apply the full `assessReadiness` gate. … Do not
> broaden the rule beyond the evidence. … Classify the title's demonstrated purpose, not merely its
> subject matter."

> "**Keep every story accessible.** Refusal means exclusion from the dashboard feed, not deletion. Preserve
> the database record, history, and story page."

> "**Do not combine the two classes into one unmeasured change.** Ship and verify commerce/shelf first,
> then measure and ship hobby-hack separately."

> "**Require measured release evidence for each class:** the number of matched cards examined and the
> number refused; representative false positives and false negatives; that the four demonstrated
> non-development cards are handled correctly by the applicable rules; that legitimate news cards remain
> visible and the dashboard remains broader than the briefing; that history and story-page access remain
> intact; passing regression tests and a fresh read of the live dashboard as a stranger."

## What landed, and how it was verified

`isReaderDealTitle` in [alert-floor.ts](../../src/lib/pipeline/alert-floor.ts) — one definition, used by
[gateHomeFeed](../../src/lib/server/briefing.ts) — refuses a card whose title carries **both** an explicit
discount marker (*discounted*, *lowest price*, *price drop/cut*, *record low*, *for under*, *clearance*,
*% off*, *$N off*) **and** a verb that asks the reader to obtain the object (*grab, snag, buy, order,
pre-order, pick up, claim, get*). The existing `shelf-deal` class did not see the measured card: it needs
an *urgency* frame, and a deal page need not be urgent.

The first draft was measured and **rejected**: "acquisition verb + a price" matched **47 of 22,018** stored
titles and swept up *"Nvidia to buy developer platform Hugging Face in $12.9bn deal"*, *"Lambda raises $1B
in debt to buy Nvidia chips for Microsoft lease"* and *"ShinyHunters claim CyrusOne breach, demand $13m
ransom"*; words that read like a discount but are not one (*"saving 900 jobs"*, *"a rescue deal"*) caused
the same false positives, so the frame is the marker itself, never the bare noun. One instrument trap is
recorded in the code: a leading `\b` can never match before `$`, so `\b\$40 off` is dead in JavaScript —
the first landed version matched `% off` and silently missed `$40 off`.

Measured with the landed rule, 2026-10-18:

| set | examined | refused |
| --- | --- | --- |
| the live dashboard's 13 cards | 13 | **1** — the deal card |
| this reader's matched titles (`user_events`) | 1,000 | **2** — both deals |
| every stored event title | 22,018 | **17** — every one a deal or shopping page |

## The second class, measured and landed on its own (same ruling)

`isReaderModTitle` in the same file, wired into the same `gateHomeFeed` call, refuses an enthusiast
modification: `modder`/`modded`/`modding`, or a bare `mod` followed by a verb of capability (`enables`,
`adds`, `triples`, …), because `mod` is also a noun in real reporting and a substring of words this must
not touch (`model`, `Moderna`, `modern`, `moderates`). The alert floor has refused the closest relative
since 2026-10-14 (`hobby-hack`); this is the same class seen through the verb a modder uses.

Measured with the landed rule, 2026-10-18:

| set | examined | refused |
| --- | --- | --- |
| every stored event title | 22,020 | **11** — every one an enthusiast mod (a DLSS port in a browser, a jailbroken PS5, a 360mm radiator inside a laptop, a leaked DLSS injection into Pac-Man) |
| this reader's matched titles | 1,000 | **3** |
| the live dashboard's cards | 13 | **1** (the measured card) |

The Lego-kit card and the flight-sim review are deliberately **not** touched: the ruling names two
classes, and a review is not one of them. Everything else about the feed is unchanged — no item is
deleted, history and the story page keep it, and `gateHomeFeed` still runs `assessReadiness` for the
title/summary rungs.

## What this authorises, and what it does not

- **Authorised:** excluding a deal-shaped card from the dashboard feed, title-only, with both halves
  measured; the hobby-hack/review class later, after its own measurement.
- **Not authorised:** applying the full readiness gate to the dashboard; refusing on a price or a verb
  alone; touching history, search or the story page; folding the second class in without its own evidence.
