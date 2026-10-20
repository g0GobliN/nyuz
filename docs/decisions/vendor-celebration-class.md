# The vendor-blog celebration class — measured, cut, and wired (2026-10-20)

**Where this stands (updated by the wiring slice, same day).** The pack below was cut as a request: the
population, the predicate, its false-positive controls, three numbered options and the acceptance each one
has to move. **Option 2 is now the rule in `gateHomeFeed`**, and the wiring is described in
[What the wiring needed](#what-the-wiring-needed--and-what-landed). The line that opened this document
said no ruling had been given; the wiring was ordered on the card that carried this slice
(`t_01d2ef9e`, *"Wire the first-party celebration rule into the gate"*), which named option 2's two arms
and its census acceptance verbatim. **No class was added and no lexeme was widened**: the two arms are the
measured ones, 13 predicate tests and a gate pin per dashboard branch. If the arbiter later rules
differently, the rule is one clause in one function and the census re-runs in a minute.

The reason it was held back, for the record: the call site this class needs
([`gateHomeFeed`](../../src/lib/server/briefing.ts)) is not the call site the other three classes used — it
needs coverage the feed did not load — and the arbiter's ruling #9 rule is one measured class at a time.

## Why it was asked

The live dashboard, read as a stranger on 2026-10-19, held twelve cards. Three were shapes the
2026-10-18 ruling lists as remaining classes; two were then ruled and landed (a deal, a coupon page).
The third is still standing and is a first-party celebration:

> **12.** _"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"_ — the vendor's own blog.

[reader-quality-10-of-10.md](../reader-quality-10-of-10.md) records the population this has to be cut out
of: _"The vendor-blog shape … likewise contains engineering posts. A class has to be cut out of that
population; a rule keyed on price alone would refuse product-launch news."_ The 2026-10-19 measurement
(`audit:dashboard-classes`) counted 12 sources / 175 events with a brand-name read of `feed_url` and
stopped there, correctly: the population is not one class.

## Why the card still renders — two measured causes, not one

The briefing path already refuses one celebration shape. `CELEBRATION_TITLE` in
[readiness.ts](../../src/lib/pipeline/readiness.ts) refuses _"Celebrating Our Newest AWS Heroes"_ on a
first-party source, and it has since 2026-10-02. The dashboard card survived for two separate reasons:

1. **The dashboard gate never loads coverage.** `gateHomeFeed` calls
   `assessReadiness({ title: s.title, whatHappened: s.what })` — no `sourceKinds`, no `sourceCount`. Every
   first-party rung in the readiness gate fails open without coverage, by design
   (`isFirstPartySource(undefined) === false`), so the celebration rung, the marketing rungs and the
   primary-source rung are all skipped on the dashboard. That is also why the dashboard is wider than the
   briefing today, which ruling #9 requires it to stay.
2. **The existing pattern only sees community recognition.** `CELEBRATION_TITLE` is
   `celebrating|congratulations|honoring … our|the newest|this year's`. It does not match the measured card
   (noun "Celebration") and it does not match _"Be There for the Beginning: Celebrate the Launch of NVIDIA
   RTX Spark"_. So even with coverage passed in, the class would not be cut by the pattern as it stands.

Both causes are why this class needs its own measured rule rather than a one-line pattern edit.

## The measurement

Command (Node 22; corpus read 2026-10-20):

```
node --env-file=.env scripts/tsrun.mjs scripts/vendor-celebration-census.ts [--all]
```

Corpus: **23,539 stored event titles**. "First-party" is the stored signal the pipeline already uses for
it — `sources.kind = 'company_blog'` (`FIRST_PARTY_SOURCE_KINDS` in readiness.ts, the arbiter's ruling of
2026-10-11, D5) — **not** a brand name read out of a feed URL. That is a correction to the earlier recorded
number: the old block matched 12 sources by brand in `feed_url` and missed Meta Engineering, PyTorch,
Hugging Face, Cloudflare, GitHub, Stripe, Netflix and Android Developers, which are `company_blog` sources
in the corpus. Measured by kind: **20 sources, 367 events carried by any, 354 carried only by them**.

| the first-party population             | events  |
| -------------------------------------- | ------- |
| carried only by `company_blog` sources | **354** |
| **celebration (the predicate)**        | **3**   |
| engineering / research / roundup       | 46      |
| launch / announcement                  | 49      |
| repricing                              | 1       |
| partnership / acquisition              | 5       |
| none of those                          | 264     |
| celebration ∩ engineering              | **0**   |
| celebration ∩ launch                   | **0**   |

The three celebrations, in full:

```
RTX Spark Ignites Global Celebration as New Windows PCs Arrive          NVIDIA Blog [company_blog]
Celebrating Our Newest AWS Heroes – September 2026                     AWS News  [company_blog]
Be There for the Beginning: Celebrate the Launch of NVIDIA RTX Spark    NVIDIA Blog [company_blog]
```

### What a title-only rule would cost — the reason the class needs two arms

The celebration lexeme is not the class. Measured across every stored title, one arm at a time:

| arm           | corpus matches | first-party matches |
| ------------- | -------------- | ------------------- |
| `celebrat*`   | 19             | 3                   |
| `anniversary` | 10             | 0                   |
| `jubilee`     | 0              | 0                   |
| `festivities` | 0              | 0                   |
| **union**     | **29**         | **3**               |

**26 of the 29 are news.** Verbatim from the corpus, these are the titles a title-only rule refuses:

```
Grace Hopper Celebration canceled two weeks out as AnitaB.org runs short of funds
Pope Leo celebrates open-air mass before 700,000 people in Paris
In pictures: Dussehra celebrated across India as triumph of good over evil
Israel marks third anniversary of 7 October Hamas attacks | First Thing
Celtic celebrate heated win over Rangers in final of revived Tennent’s Sixes
Microsoft celebrates end of Office 2021 LTSC with MS 365 outage
… plus 20 more (a mosque centenary, a 9/11 anniversary game, an AfD win, a film about Beveridge,
a TCP/IP retrospective, an Amy Winehouse reissue, two Oct. 7 remembrance pieces, …)
```

The sharpest is the first: a major conference being **cancelled** is a development a reader needs, and a
title-only celebration rule would have refused it. So the frame alone cannot be the rule, exactly as the
2026-10-18 ruling found for the deal class.

### The predicate: celebration frame **and** first-party carriage

```ts
// src/lib/pipeline/vendor-celebration.ts
export const VENDOR_CELEBRATION_ARMS = [
  { name: "celebrat*", test: /\bcelebrat(?:e|es|ed|ing|ion|ions|ory)\b/i },
  { name: "anniversary", test: /\banniversary\b/i },
  { name: "jubilee", test: /\bjubilee\b/i },
  { name: "festivities", test: /\bfestivit(?:y|ies)\b/i },
];
isFirstPartyCarriage(sourceKinds); // every carrier is `company_blog`, non-empty, same rule as readiness
```

Measured with both arms:

| set                                                                      | examined          | refused                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| every stored event title                                                 | 23,539            | **3** — every one a first-party celebration                                                                               |
| the first-party population                                               | 354               | **3** (0.8%)                                                                                                              |
| this reader's matched set (`user_events`, reader `640a69b6`, 5,808 rows) | 5,808             | **2** — both first-party celebrations                                                                                     |
| the newest three delivered briefings                                     | 25 / 9 / 16 cards | **0** — no celebration is in a stored briefing; the card is in the matched set, which is the branch that renders it today |
| **product launches, first-party**                                        | 49                | **0**                                                                                                                     |
| **engineering / research, first-party**                                  | 46                | **0**                                                                                                                     |
| **repricing, first-party**                                               | 1                 | **0**                                                                                                                     |
| **partnership / acquisition, first-party**                               | 5                 | **0**                                                                                                                     |
| **celebration-shaped news (non-first-party)**                            | 26                | **0**                                                                                                                     |

The reader's two, in full: the measured card, and _"Celebrating Our Newest AWS Heroes – September 2026"_.
The other three celebration-shaped titles in the reader's set are news and stay
(_"Grace Hopper Celebration canceled…"_, _"‘A beacon of peace’: London’s oldest mosque celebrates
centenary"_, _"Igalia Celebrates 25 Years Of Advancing Linux & Open-Source"_).

### Controls, pinned in tests

`src/lib/pipeline/vendor-celebration.test.ts` (13 tests, all passing) pins the measured cases by name:

- **product launch**: _"Introducing GPT-6 Sol and Luna"_, _"Microsoft and Nvidia launch Surface Laptop
  Ultra with RTX Spark"_, _"NVIDIA Launches DSX Ready to Qualify Power and Cooling Products for AI
  Factories"_ — kept;
- **repricing**: _"Introducing Clef-omni with full multimodality, plus a faster Clef and a cheaper
  Clef-flash"_ — kept;
- **acquisition / partnership**: _"Atlassian and OpenAI expand partnership…"_, _"CrowdStrike and NVIDIA
  announce SafeMind agentic cybersecurity system"_, _"Emerald AI, Google and NVIDIA Launch
  Alliance…"_ — kept;
- **engineering from the same blogs**: _"Open and Emergent Problems in Agentic Privacy and Security"_,
  _"AWS Weekly Roundup: Prime Day 2026 by the numbers…"_, _"How we found 24 Android vulnerabilities…"_,
  _"Introducing TorchNeuron…"_ — kept;
- **all 26 celebration-shaped news titles** — kept;
- **unknown / empty carriage** — kept (fail-open, the readiness rule);
- **mixed carriage** (`company_blog` + `news`) — kept: one news outlet carrying the story is corroboration.

### One measured false negative, recorded and not fixed

_"Igalia Celebrates 25 Years Of Advancing Linux & Open-Source"_ is a company celebrating itself, carried by
a news source, so the first-party arm keeps it. Cutting it would need a source-independent arm, and that
arm costs the 26 news titles above. Recorded, not hidden.

## Options

**Option 1 — title-only celebration lexeme.** One arm, no coverage needed, lands in `gateHomeFeed` beside
the three existing class predicates.
_Measured cost:_ 29 corpus titles refused, 26 of them news, 3 of the reader's 5,808 matched cards refused
and all three news (a cancelled conference, a mosque centenary, a company anniversary post).
_Acceptance it must move:_ **0 news titles refused**. It fails on the first measurement, so it should not
be wired. This option exists in the pack because it is the shortcut the population invites.

**Option 2 — first-party celebration (recommended).** Both arms: the celebration lexeme **and** every
carrier a `company_blog`.
_Measured:_ 3 of 23,539 corpus titles, 2 of the reader's 5,808, 0 of 46 engineering, 0 of 49 launches, 0 of
1 repricing, 0 of 5 partnerships, 0 of 26 celebration-shaped news.
_Acceptance it must move, on the live product:_ the dashboard loses **exactly the celebration card(s)** and
nothing else; a stranger's read of the feed shows no celebration card; and a re-run of the census reads
**3 corpus refusals, every one first-party, 0 in each control column**. The refusal count is allowed to be
small — 3 cards a year is the measured size of the class — because a class is cut by its shape, not by a
target volume.

**Option 3 — widen the lexeme set now** (`birthday`, `congratulations`, `honoring`, `showcase`, `roundup`,
`marks N years`). It catches _"Happy 20th Birthday, Amazon EC2"_ and Cloudflare's _"Everything we launched
during Birthday Week 2026"_.
_Measured:_ nothing — those arms have no first-party count yet, and `birthday` at least is ambiguous
(a launch roundup during a birthday week is substantive).
_Acceptance it must move:_ no new news refusals **and** at least one additional first-party milestone
refused, measured arm by arm. Deferred: a clause with no measured class can only refuse news it was never
shown to refuse, which is ruling #14's own principle.

## Recommendation

**Option 2, with this operative wording for the ruling:**

> Refuse a dashboard card whose title carries a celebration frame — `celebrat*`, `anniversary`, `jubilee`,
> `festivities` — **and** all of whose carrying sources are `company_blog`. The class is the vendor
> announcing its own ceremony, anniversary or community recognition, not the vendor reporting a product:
> launches, repricing, partnerships, engineering, research and roundup posts from the same blogs stay
> eligible, and a celebration-shaped news story stays eligible however it reads. Refusal means exclusion from
> the dashboard feed only — history, search and the story page keep the record.

That last sentence is ruling #9's own condition and is already how the three landed classes behave.

## What the wiring needed — and what landed

The class cannot be wired by adding a predicate to the existing `gateHomeFeed` chain: that chain saw a
`Story` that carries source **names**, not kinds, and `articlesFor` selected `sources ( name )` only.

**Landed, 2026-10-20** (`wt/wire-celebration`):

1. [`src/lib/server/briefing.ts`](../../src/lib/server/briefing.ts) — `articlesFor` selects
   `sources ( name, kind )`, `Coverage` gains an optional `kind`, `hydrateEvents` carries it onto
   `sourceList`, and `gateHomeFeed` reads the story's kinds through a local `sourceKindsOf(story)` and calls
   `isVendorCelebrationTitle(s.title, kinds)` as the **fourth clause of the one existing chain** — not a
   second gate. Both dashboard branches (`storiesFromDigest` and `loadMatchedStories`) go through
   `hydrateEvents → articlesFor`, so one change covers the digest card and the live match alike — the same
   lesson the deal class learned when gating only the matches path left the card on the page.
   `sourceKindsOf` answers with the empty list when **any** carrier has no kind, so unknown coverage fails
   open exactly as it does in `assessReadiness`; the predicate was not loosened to say so.
2. [`src/lib/story.ts`](../../src/lib/story.ts) — `Story.sourceList` entries gained an optional `kind`, since
   that is what the gate reads.
3. [`src/lib/server/story-flow.test.ts`](../../src/lib/server/story-flow.test.ts) — the wiring pin the other
   classes have, in one test that reads **both** branches against the same fixtures: the measured celebration
   card is absent from each, and the launch, repricing, partnership, engineering and celebration-shaped
   **news** controls are present in each. The pin also asserts the story page still opens the refused card
   (refusal is the dashboard's alone) and that the loader actually carried `kind` onto the card. Verified red
   by replacing the clause with `true`: the test fails on the celebration title in the matches branch.
4. [`src/lib/pipeline/readiness.ts`](../../src/lib/pipeline/readiness.ts) — **not this round** (forge owns
   that file), but the two definitions should converge afterwards: `isFirstPartySource` is private there and
   restated in the new module, and `CELEBRATION_TITLE` should either be subsumed by the new class or stay
   where it is with this class above it. One first-party rule, not two copies.

No change to `alert-floor.ts`: this is a feed class, not an alert class, and the alert floor's own
celebration-shaped refusals are unaffected. `isCouponPageTitle`, `isReaderDealTitle` and `isReaderModTitle`
are untouched, so ruling #14 and the two classes before it are unchanged; the new clause is additive.

### Re-measured after the wiring (2026-10-20, second run)

```
node --env-file=.env scripts/tsrun.mjs scripts/vendor-celebration-census.ts
```

The census is a read of the stored corpus and does not run the gate, so the predicate's numbers are
unchanged by construction — which is the point: the wiring did not move the rule. It reads, verbatim:

| the first-party population             | events |
| -------------------------------------- | ------ |
| carried only by `company_blog` sources | **354** |
| **celebration (the predicate)**        | **3**   |
| engineering / research / roundup       | 46      |
| launch / announcement                  | 49      |
| repricing                              | 1       |
| partnership / acquisition              | 5       |
| none of those                          | 264     |
| celebration ∩ engineering              | **0**   |
| celebration ∩ launch                   | **0**   |

| control column                          | measured | refused |
| --------------------------------------- | -------- | ------- |
| product launches, first-party           | 49       | **0**   |
| engineering / research, first-party     | 46       | **0**   |
| repricing, first-party                  | 1        | **0**   |
| partnership / acquisition, first-party  | 5        | **0**   |
| celebration-shaped news (non-first-party) | 26     | **0**   |

Corpus-wide: **3 refusals of 23,539 titles, every one a first-party celebration**, 0.8% of the first-party
population. The three, in full, are *"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"*
(NVIDIA Blog), *"Celebrating Our Newest AWS Heroes – September 2026"* (AWS News) and *"Be There for the
Beginning: Celebrate the Launch of NVIDIA RTX Spark"* (NVIDIA Blog).

Two numbers moved for a reason that is not this change: this reader's matched set now reads **5,841 rows
with 2 refused** (was 5,808 in the pack — the corpus grew a day's worth of matches), and both refusals are
still first-party celebrations. The stored briefings are unchanged at **0 refused of 25 / 9 / 16 cards**:
no celebration has ever been delivered in a briefing, which is why the card was on the dashboard's matched
branch and not in an inbox.

## What this authorises, and what it does not

- **Authorised by a ruling on option 2:** excluding a first-party celebration card from the dashboard feed
  by title **and** carriage, with the three measured cards as the class and the controls above kept.
- **Not authorised:** a title-only celebration rule (option 1 — it refuses a cancelled conference); widening
  the lexeme set before its own measurement (option 3); touching history, search, the story page or the
  briefing's own gate; passing `sourceKinds` into `assessReadiness` on the dashboard to switch on every
  coverage-dependent rung at once, which would narrow the dashboard below the width ruling #9 requires and
  needs its own ruling.

None of the "not authorised" list is touched by this slice: the clause is in `gateHomeFeed` only, the story
page reads past it (pinned in the test), and `assessReadiness` still receives a title and a summary.

## Files on this branch

On `wt/wire-celebration` (PR #26's pack was cherry-picked onto `main` after #27 merged, because #26 was
marked *do not merge* and conflicts with `main`):

- `src/lib/pipeline/vendor-celebration.ts` — the predicate, two arms, arm names exported for audits.
- `src/lib/pipeline/vendor-celebration.test.ts` — 13 tests: the 3 measured cards, the 26 news controls,
  launches, repricing, partnerships, engineering, unknown carriage, mixed carriage, arm attribution.
- `scripts/vendor-celebration-census.ts` — the replay: the tables above, `--all` for every match with its
  sources. Not yet an `npm run` alias; the command is the one quoted at the top.
