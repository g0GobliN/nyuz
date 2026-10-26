# One story, one card — inside a single edition

**Measured 2026-10-25/26, Node 22, worktree `wt/edition-dupes`.** The corpus is the live project. The
finding is audit **B-05** (`docs/reader-clarity-audit-2026-10-22.md`, Appendix A) and the work is wave 3
of `docs/plan-2026-10-23-to-11-01.md`.

## The gap this closes

`suppressDeliveredDuplicates` answers "was this reader already sent this story?" over a 48-hour window.
It has nothing to say about two same-story events chosen into **one** briefing, and that is what the
reader saw: the 2026-10-21 edition (`7268ba11`, `item_count = 25`) carried cards #04 + #07 (the GTC
Berlin keynote) and #06 + #09 (the PHP security release) as four cards for two stories. Each pair is
two distinct `events` rows with one stored article each, so the clustering never joined them and
selection had no rule that would refuse the second one.

## The rule

`suppressStoryTwins` (in `src/lib/pipeline/duplicates.ts`) gained two legs, both gated on
`options.b05Rules` (absent = on; `false` reproduces the pass as it stood before this change):

1. **Event-noun leg.** Both headlines carry an event noun (`keynote`, `conference`, `summit`,
   `unveils`, `launches`, `debuts`, `introduces`) **and** share a name. The noun alone is never a
   marker group — `keynote` on its own fused a GTC liveblog with an unrelated summit liveblog, both
   headlined "Live Updates".
2. **Disclosure leg.** Both headlines are disclosure-shaped (`vulnerability`/`vulnerabilities`,
   `flaw(s)`, `bug(s)`, `security release`, `cve-YYYY`) **and** share a capitalised proper name. The
   name requirement is not decoration: PRIMARY entity ranking also promotes concept words
   (`security`, `critical`, `flaw`, `bug fixes`), so a leg that accepted those would fuse unrelated
   outages.

The disclosure leg also refuses a pair whose **headline** announces the next turn of a saga —
`PROGRESSION` (`another`, `again`, `second`, `third`, `follow-up`, `surges`, `resumes`, `after`,
`later`, `next`, `imminent`). The check reads the headline only, because stored summaries restate the
original event and would make the follow-up look like a retelling. It is load-bearing: with the guard
removed the PHP2Shell day-two pair below fuses, and its test fails.

The pair, quoted from `events`:

```
PHP2Shell: Two Unpatched Critical PHP RCE Flaws (CVSS 9.2) Trigger Emergency Security Alert
URGENT - PHP Warns of Another Unpatched RCE Two Days After Emergency PHP2Shell Patches
```

Two cards: the emergency release and the day-two hole are different developments. Both audited
pairs, by contrast, carry no progression word and stay fused.

## Measured, on delivered data

Three most recent delivered editions (a `deliveries` row `channel=push, status=sent`, digest
`item_count > 0`), pairs judged from stored `events.title` + `events.what_happened` and the stored
`articles` rows:

| edition | generated | items | same-event-id pairs | reader-visible duplicate pairs | cards |
| --- | --- | --- | --- | --- | --- |
| `fab11fdf` | 2026-10-22 22:55Z | 17 | 0 | 1 | #09 + #10 |
| `7268ba11` | 2026-10-21 22:57Z | 25 | 0 | 2 | #04 + #07, #06 + #09 |
| `3fcbb21c` | 2026-10-20 22:55Z | 25 | 0 | 1 | #08 + #09 |
| **total** | | **67 cards** | **0** | **4 pairs / 8 cards** | |

Replayed through the pass, legs off → on, on the same four pairs:

```
fab11fdf 8766cb0f+537b6a31  before=2 cards  after=1 card
7268ba11 7810ac70+8150634e  before=2 cards  after=1 card
7268ba11 a3e60b09+f937622f  before=2 cards  after=1 card
3fcbb21c f3d41905+50bdeef2  before=1 cards  after=1 card
```

Three of the four are fused by the new legs and by nothing else. The fourth — SpaceX, 2026-10-20 —
already fuses on the base legs today, so it is **not** evidence for this change: its appearance in
that edition is not explained by the pass as it stands, and this slice does not claim it. Recorded
rather than glossed.

## Blast radius, measured

`npm run audit:twin-corpus` over the 30-day window: **18,517 events**, **491** disclosure-shaped.
Of **1,326** candidate pairs that share a PRIMARY and are disclosure-shaped, the new legs fuse
**307** — **44** of them clear ruling #18's acceptance floor and **263** sit below it.

The 263 are the one number a reviewer should weigh: ruling #18's floor (three shared content words,
or a capitalised entity plus …) is the bar that widening was accepted against, and these legs fuse on
a different, narrower signal — a shared *proper* name plus disclosure vocabulary. The population
below the floor is not new in kind: [twin-floor-below-floor.md](twin-floor-below-floor.md) already
reports 164 such pairs, and reading that list shows the dominant shape is one story told by many
outlets (the FBI jobs-portal hack, the Medicare/OpenAI incident, the ShinyHunters arrests). Those are
pairs the reader should see once. **If the gate wants this change inside ruling #18's floor, the
ruling has to widen the floor, not the code** — this slice ships the reader-visible fix and says so.

## What it does not fix

The clustering layer still creates two events for one story; this pass drops the second at selection
time. That is the smallest change that makes the pair impossible in a briefing, but the corpus keeps
both events, so the same story can still surface twice on **different days** once the 48-hour window
passes. Joining them at `cluster.ts` is the durable fix and is a separate slice.
