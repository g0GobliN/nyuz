# The twin floor was clearing pairs on capitals that select nothing — and the pass suppresses more than the bar allows

**Measured 2026-10-20, Node 22, on `origin/main` `f12e96d` and branch `wt/twin-floor`.** The corpus is
the live project: the 30-day window ending that day, **16,828 events**, of which **119 headlines** carry
ruling #18's widened vocabulary. The command is `npm run audit:twin-corpus`; the pair list and its
anchors are in [twin-floor-below-floor.md](twin-floor-below-floor.md), generated from the census output.

## What this slice was asked to do

Card `t_3fcb8b9f` asked for one thing: tighten the *acceptance floor* in the twin-corpus census, because
F18-1 said the floor was too lenient to prove ruling #18's widening safe. It was explicit that the
delivery pass was **not** the defect, and that a widening or a loosened floor was not the answer.

## The premise that did not survive contact with the rows

The card states that `suppressStoryTwins` "keeps 2 of 2" on the pair below "with both stored summaries".
Measured on those rows — `events` `d2cacbc0-3918-4fcd-88c7-f3193001e38a` and
`5160c30c-4515-4e0b-b0b5-5db5f200b522`, `what_happened` included — it does not:

```
Hackers Exploit Plex2Shell Flaws to Install Crypto Miners and Linux Proxy Backdoor
China-Linked Hackers Exploited BeyondTrust Zero-Day to Take Over Remote Support Servers

suppressStoryTwins (widened)   kept 1 of 2     <- it fuses them
suppressStoryTwins (pre-#18)   kept 2 of 2
shared: "hackers" (a sentence-initial capital) + exploit, flaw, server, hacker, day
```

The 2-of-2 reading in the previous session came from a probe that carried **invented** summaries
(`scripts/_f18probe.ts`, removed in this branch) rather than the stored ones; titles alone or invented
summaries leave the pair below the pass's three-word threshold. So F18-1 was never only an instrument
defect. Both halves are true, and this branch fixes the half it was given:

1. the floor cleared suppressions on evidence that selects nothing, so it could not prove the widening
   safe — **fixed here**;
2. the delivery pass suppresses pairs the ruling's own bar does not allow — **not touched here**, because
   changing `suppressStoryTwins` is a ruling, and because the floor had to be able to see it first.

## The rule now

`src/lib/pipeline/twin-floor.ts` is the floor, and `scripts/twin-corpus-census.ts` reads it. The suite's
fixtures assert the same object, so the instrument and the tests cannot drift.

**Entity leg — a capitalisation is evidence only where it discriminates.** A Title Case headline
capitalises every word, and a headline capitalises its first word whatever it is, so neither selects a
name. The leg now needs one side to capitalise the word *mid-title in a headline that is not Title Case*;
the other side's capitalisation, wherever it sits, corroborates. Function words are excluded, so `Why`
after a colon is not an entity. This is what refuses `Hackers`: it is the first word of one headline and
a Title Case capital in the other, and it is the only "entity" the Plex2Shell / BeyondTrust pair shares.

A per-side "drop the first word" version was tried first and rejected on evidence: it still cleared the
Plex2Shell headlines against a Nextcloud one on `Backdoor`, a Title Case capital in both.

**Content-words leg — the sentence's furniture is not content.** The floor carries its own
`FUNCTION_WORDS` (articles, conjunctions, prepositions, pronouns, auxiliaries, determiners) on top of the
shortlist's `STOPWORDS`, so `and`, `the`, `for`, `but` and their siblings no longer count. `and` is the
one that was measured: `Hackers hit AI coding tool OpenCode…` against `A hacker broke into John Deere…`
shares exactly `hacker`, `agent` and `and`, and the conjunction supplied the third word.

**It is deliberately not added to `STOPWORDS`.** That set is also read by `duplicates.ts` (`contentWords`,
`namePairs`) and by `titleTokens`, so extending it would quietly narrow the delivery pass — a change to
the rule, not to the instrument, and one no ruling covers. The floor tightens; the pass is untouched.

## What the tightened floor finds

```
window                              30 days, 16828 events loaded
headlines carrying the new vocabulary   119
pairs newly fused by the widening       272
pairs fused before it as well           48
new fusions below the ruling floor      164      entity leg only 56, words only 75, both 33
pre-existing fusions below it           19      (another rule's; was 1 under the lenient legs)
ruling #18  FAIL  164 newly fused pair(s) do not clear the floor
```

Read at face value that is the finding: **164 of the 272 pairs ruling #18's widening newly fuses do not
meet the bar ruling #18 put on the widening.** Every one is listed with its anchors in
[twin-floor-below-floor.md](twin-floor-below-floor.md), and the sample is not ambiguous — different
products, actors and incidents joined by generic security vocabulary:

- Plex2Shell flaws against a BeyondTrust zero-day (the pair the card names), and against Nextcloud /
  Collabora, ConnectWise credentials, Bitget, and a weekly recap;
- `A Chinese hacker used AI agents to break into more than 100 company websites` against
  `Hackers suspected of using AI agents for cyberattacks on South Korean banks` — two shared content
  words, fused by the third being a function word;
- arXiv `reward hacking` papers fused with security stories on `hack` + `reward`.

The 164 is a count of pairs the pass *could* suppress together, not a count of cards a reader lost: the
census pairs every stored event carrying the vocabulary with every other one, and whether two of them
landed in one reader's briefing is a separate measurement this branch did not take. What is established
is that the acceptance instrument can no longer say the widening is safe, and that it says so for
reasons the rows support.

## The two instruments are pinned pointing opposite ways

- `src/lib/pipeline/twin-floor.test.ts` asserts the floor **refuses** the Plex2Shell / BeyondTrust pair,
  on the stored rows, with its anchors.
- `src/lib/pipeline/duplicates.test.ts` carries the pass's behaviour on the same rows as an `it.fails`
  tripwire: it fuses them today, and the day the pass stops doing so that test goes red and whoever fixed
  it flips `it.fails` to `it`.

Neither can be "fixed" by widening the other: the floor cannot be cleared by a new marker, and the pass
cannot be satisfied by lowering the bar.

## What this branch did not change

`suppressStoryTwins`, `sameStory`, `sameIncident`, `cluster.ts`, the #18 vocabulary (`hack`, `hacker`,
`hacking`, `break in`, `break into`, `broke into`), and every rule from #17 and #19. The diff is the
floor module, the census that reads it, and tests. `npm run audit:delivered-line` reads exactly as it did
on `main` — `15 / 22` as delivered, `22` of 25 if built now, 7 defects, 3 no-deck — which is also what
proves the delivery path was not touched.

## The ruling this needs — numbered options

This is a question about the bar, not a number to tune, so it is put rather than decided.

1. **Narrow the delivery pass to the bar.** Make the widened marker's fusion require what the floor
   requires — a name selected by an informative capitalisation, and three content words that are not
   function words. Cost: some real twins fall through to two cards (`Hacker` + `AI` + one more word is a
   common shape); benefit: the ruling's own bar becomes the rule, which is what the floor was written to
   prove.
2. **Keep the pass, and keep the floor as the bar with the census reporting rather than gating** (exit 0,
   164 named). Cost: the acceptance instrument stops being a check and becomes a report, so nothing
   prevents the next widening from adding more.
3. **Narrow #18's vocabulary itself** — the delivered case needed `break into`; `hack` is what pulls in
   the arXiv and weekly-recap population. Cost: the delivered 2026-10-19 pair is the only confirmed
   reader-facing duplicate this bought, and its title carries both.
4. **Leave both as they are and accept the 164**, on the argument that the reader cost of a suppressed
   card is lower than the reader cost of a duplicate card. Cost: this contradicts the ruling's own floor,
   so the floor would have to be struck from the ruling rather than silently ignored.

Option 1 is the one the evidence supports, and the one this branch makes possible rather than makes.

## Also found, reported and not tuned

- **A suite test that asserts nothing.** `duplicates.test.ts` → "holds the corpus floor" builds its five
  headlines with **empty** summaries, and with those none of the ten pairs fuses, so its loop body never
  runs. It is left as it is: repairing it means encoding a decision the ruling above is about. Its claim
  should not be read as coverage of the floor — `twin-floor.test.ts` is.
- **Item 1 is not "green at 24 or 25" on `main`.** `npm run audit:delivered-line` reads
  `FAIL 15 / 22` as delivered and `22` of 25 if built now, on `f12e96d` before this branch and after it.
  The 24-of-25 figure in the card and in the earlier verification is a reading of `3e6c5f6`, taken
  before #17/#18/#19 merged; the archive's stored lines predate those rules.
- **Pre-existing fusions below the floor rose from 1 to 19** under the tighter legs. They fuse by other
  branches (shared PRIMARY entity and figure, or a shared name) and are another rule's defect; they are
  counted and named, not tuned here.
- **The floor's deliberate cost.** Two headlines that both open on the same name and never write it again
  cannot prove that name. That direction — refusing evidence rather than inventing it — is the safe one
  for a floor; a pair it refuses is reported, a pair it blesses is never looked at again.
