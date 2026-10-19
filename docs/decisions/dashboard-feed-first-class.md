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
classes, and a review is not one of them.

**The branch that looked unaffected, and was not.** The first version of this change gated only the
`matches` path of `loadHomeFeed`. The live read after deploy still showed the deal card, because the
dashboard renders `digest_items` whenever a briefing exists — the ready/sent branch returned the stored
digest stories ungated. Both branches now run the same gate, and `story-flow.test.ts` pins it: a digest
item whose title is the measured deal card or the measured mod card is excluded, and a news title in the
same fixture still renders. Verified on the deployed origin the same day: the dashboard went from
**13 things worth knowing** to **11**, losing *"Grab an RTX 5090 …"* and *"Modder finishes nine-year Xbox
360 …"*, with the nine news cards and the remaining two cards unchanged. Everything else about the feed is unchanged — no item is
deleted, history and the story page keep it, and `gateHomeFeed` still runs `assessReadiness` for the
title/summary rungs.

## What this authorises, and what it does not

- **Authorised:** excluding a deal-shaped card from the dashboard feed, title-only, with both halves
  measured; the hobby-hack/review class later, after its own measurement.
- **Not authorised:** applying the full readiness gate to the dashboard; refusing on a price or a verb
  alone; touching history, search or the story page; folding the second class in without its own evidence.

## The next class, measured: "price/discount without an acquisition verb" is not one class (2026-10-19)

`npm run audit:dashboard-classes` (new with this record; every count names the predicate that produced
it). Corpus: **22,569 stored event titles**, read 2026-10-19.

```
refused by isReaderDealTitle                                         21
refused by isReaderModTitle                                          12
price/discount-shaped titles                                        122
  with an acquisition verb (the landed rule)                         17
  without one (outside the landed rule)                             105
      coupon / promo-code page                                        5
      explicit discount deal (% off, $N off, all-time low)           25
      price movement as the news (on sale, cheaper, price cut)       40
      review / buying advice                                          1
      unclassified by those buckets                                  34
```

**Why the count is not a class.** The tempting shortcut is "widen the landed rule to price shapes without
an acquisition verb" — that is a 105-title class, and two of its buckets are real news:

- *price movement as the news* (40) contains *"Hyundai's all-electric hot hatch goes on sale in the UK,
  starting at around $25,000"*, *"Anthropic's new Fable release is cheaper, less restrictive"*, *"Waymo is
  offering transit discounts again, this time with Visa"* — a launch and a repricing, reported.
- *explicit discount deal* (25) is where the observed card lives (*"Award-winning Anycubic 3D Printers on
  sale with up to 47% off"*) but it also holds affiliate listings (*"Wired lists HBO Max promo codes with
  up to 50% off"*, *"We-Vibe discounts up to 60% off listed by Wired"*), which are a different defect.
- *coupon / promo-code page* (5) is the narrowest clean shape in the population: *"Wired publishes
  Priceline coupon page with 10% off for September 2026"*, *"Skechers Coupon Codes 20% Off"* — a
  publisher's affiliate page, not a development by any reading.

**The vendor-owned-blog shape is not a class either.** 12 vendor-owned sources carry 175 events, and the
population includes engineering and research posts (*"Open and Emergent Problems in Agentic Privacy and
Security"*, *"AWS Weekly Roundup: Prime Day 2026 by the numbers"*) beside the observed celebration
(*"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"*). The class, if it is ruled, is "the
vendor announcing its own product with celebration framing", which needs its own marker and its own
false-positive measurement — not "the source is the vendor".

**Status: measured, no rule changed.** The two observed cards still render, and the ruling has to cut a
class out of this population rather than take the whole 105. What the measurement settles is that a rule
keyed on price alone would refuse a product launch, which the previous draft of the deal rule already
learned once (47 of 22,018 titles, real news included).

## Ruled: the coupon publishing frame (arbiter #14, 2026-10-19) — landed

Asked from the same session with the population above; the ruling took option 1 and drew the boundary
tightly. Quoted in the parts that bind:

> Option 1 is the cleanest boundary. A publisher listing coupon codes is publishing an acquisition-oriented
> affiliate page, not reporting an underlying development. […] It should recognize titles indicating that a
> publisher publishes, lists, or presents coupon codes or promo codes, including equivalent explicit
> coupon-page framing. It must not refuse a story merely because its title contains coupon, discount, sale,
> off, or a price. […] Do not add these to the new predicate's territory: product discounts and deal
> announcements; price cuts or products becoming cheaper; vehicle launches described as going on sale;
> commercial policy or pricing changes; reviews and buying advice; vendor-owned engineering, research, or
> technical blog posts. […] Decision principle: exclude the publishing format, not the commercial subject.

**What landed.** `isCouponPageTitle` in [alert-floor.ts](../../src/lib/pipeline/alert-floor.ts), wired into
`gateHomeFeed` beside the two existing classes and into `audit:surfaces`. Two arms: a publisher frame
(*"Wired publishes/lists/rounds up … coupon/promo codes"*) and a listing title (*"<brand> Coupon Codes:
40% Off"*, matched at the start of the title or before a colon, never anywhere in it). The two existing
predicates are untouched, as the ruling requires.

**Measured on the corpus** (`npm run audit:dashboard-classes -- --limit 30`, 22,588 stored event titles,
2026-10-19): **24 refused, every one a coupon or promo-code page** — the five originally measured plus 19
more the frame found. None is a launch, a repricing, a commercial change, a genuine deal or a review.

**One correction the tightening forced.** The first version matched "coupon/promo code" anywhere in the
title and refused a product deal (*"This 32GB of Team Group DDR5 RAM is the cheapest DDR5-6400 kit on the
market – only $405 with promo code, buy this"*), which the ruling puts out of scope. The listing arm now
requires the phrase to be the title's subject, and that title is pinned as a control in the tests.

**Tests:** `alert-floor.test.ts` — 7 measured coupon pages refused; 8 out-of-scope titles kept (a launch, a
repricing, a transit discount, two deal pages, a price cut, the DDR5 deal, a review-shaped deal); 3 titles
with the commercial words alone kept.
