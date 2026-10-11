# D6 — the 59 stories that publish nothing, accounted for one by one

**Ruling (2026-10-11).** Account for all 59 individually, with the evidence and the decision-time
context (coverage availability, the event clock); classify each as _justified silence_, _justified
deck-only_, _false refusal_, _evidence-selection defect_ or _unresolved_, naming any class added; the
frozen corpus and its baseline stay as they are; a claimed defect must reproduce before its fix and
pass afterwards; **no broad release rule** lands before the 59 are understood. The classification and
the proposed disposition come first, with any clearly reproducible defect brought forward for a
narrow ruling.

This is the classification. It changes no publication behaviour.

## 1. The instrument had to be able to see the thing being judged

The census printed `sourceWords=2` and left the reader to trust that the coverage really was two
words. A classification that cannot see the material it silenced is an opinion about a number, so
`npm run audit:reader` now prints, for every story that published no paragraph, a per-source coverage
line (`kind`, publication time, extracted units, the stored headline and excerpt) and a **D6 ledger**
— one line per silent story carrying the five facts the disposition turns on: coverage volume,
evidence availability, selected facts, whether a deck published, and the rule that was charged.

`scripts/lib/corpus.ts` reports two new read-only fields to make that possible: `coverage` (the
loader's unaugmented view of the rows behind `sourceList`) and `enrichment` (the article's
`article_evidence.status`, or `none` when there is no row). **The composer's input is untouched**:
the evidence query now reads every row and filters `status = "enriched"` in memory, which is the same
predicate as before, so the units the composer sees are identical.

**Proof it changed nothing.** Frozen 200, same corpus file, before and after the loader change:

```
stories publishing nothing        59        (nothing-selected 31 / single-fact-is-the-deck 26 / charged 2)
delivered with no body             0
readable stories withheld         14
ledger          1572 = 1418 + 154 + 0   unexplained 0
per-story D6 ledger               59 rows, byte-identical
```

## 2. The 59, classified

The disposition is derived from the measurement, not assigned by hand, so the counts are checkable:

- `single-fact-is-the-deck` → **justified deck-only** — a body needs a second usable fact and the
  floor governs that contract. Not a defect.
- `emptied-after-selection`, charged to a rule → **justified deck-only, charged** — the deck
  published and every remaining fact is charged to a named rule.
- `nothing-selected`, with a charged refusal → **justified silence, charged** — the material was
  offered and a named rule refused it.
- `nothing-selected`, nothing refused at all → **justified silence, no coverage body** — the class
  name is added because it is the one the ruling's five did not have.

| disposition                         | stories |
| ----------------------------------- | ------- |
| justified deck-only                 | 26      |
| justified deck-only, charged        | 2       |
| justified silence, charged          | 7       |
| justified silence, no coverage body | 24      |
| **false refusal**                   | **0**   |
| **evidence-selection defect**       | **0**   |
| **unresolved**                      | **0**   |
| total                               | 59      |

Evidence on the frozen 200: **57 of the 59 have zero extracted evidence units**, every story has
exactly **one** coverage source, and **31** published a deck (26 deck-only + 2 charged + 3 of the
charged-silence group, whose stored summary supplied it).

| story                                                                                                      | disposition                         | selected | deck | units | source words | clock      | rule charged                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------- | ---- | ----- | ------------ | ---------- | --------------------------------------------------------- |
| Recruitment boss accused of being behind ‘doxxing’ campaign against RNLI and anti-racism activists         | justified silence, no coverage body | 0        | none | 0     | 2            | 2026-10-10 | -                                                         |
| ‘If voters aren’t better off by the next election, we’re screwed’: Labour insiders voice fears over budget | justified silence, no coverage body | 0        | none | 0     | 6            | 2026-10-10 | -                                                         |
| UK accused of giving people of Gaza false hope over new refugee safe route                                 | justified silence, no coverage body | 0        | none | 0     | 5            | 2026-10-10 | -                                                         |
| UK savings: 5% interest rate deals may not last, say experts                                               | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-10 | -                                                         |
| ‘Like a drill going into my eye’: why the mystery over Havana syndrome refuses to die                      | justified silence, no coverage body | 0        | none | 0     | 9            | 2026-10-10 | -                                                         |
| Create new pre-apprenticeship scheme to close youth unemployment gap, says Milburn                         | justified silence, no coverage body | 0        | none | 0     | 5            | 2026-10-10 | -                                                         |
| b11541                                                                                                     | justified silence, charged          | 0        | none | 0     | 6            | 2026-10-10 | invalid_sentence=1                                        |
| b11540                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 185          | 2026-10-10 | invalid_sentence=10                                       |
| Key things to know about Hurricane Isaias as millions under evacuation orders                              | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-10 | -                                                         |
| SQLite 3.54 Released With Faster Performance, Drops Windows XP Support                                     | justified deck-only                 | 1        | 22w  | 0     | 32           | 2026-10-10 | invalid_sentence=1                                        |
| b11539                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 182          | 2026-10-09 | invalid_sentence=10                                       |
| Friday Squid Blogging: I Caught a Squid                                                                    | justified deck-only                 | 1        | 17w  | 1     | 71           | 2026-10-09 | invalid_sentence=2,narrator_ambiguous=4                   |
| b11538                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 185          | 2026-10-09 | invalid_sentence=10                                       |
| Credential-Stealing GitHub Actions Workflows Planted in Tens of Thousands of Repositories                  | justified deck-only                 | 1        | 27w  | 0     | 54           | 2026-10-09 | unassigned_quote=1                                        |
| b11534                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 207          | 2026-10-09 | invalid_sentence=11,imperative_instruction=1              |
| Ubuntu 26.10 To Include Desktop Images For RISC-V                                                          | justified deck-only                 | 1        | 19w  | 0     | 44           | 2026-10-09 | invalid_sentence=1                                        |
| Valve's Proton 11.0-2e Released To Fix EA App Issues                                                       | justified silence, charged          | 0        | 26w  | 0     | 23           | 2026-10-09 | invalid_sentence=1                                        |
| Parties prepare for byelection in Farage seat amid speculation over £5m gift inquiry                       | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| U.S. working to reverse an Egyptian man's third-country deportation to Africa                              | justified deck-only                 | 1        | 22w  | 0     | 28           | 2026-10-09 | -                                                         |
| Two Latvians arrested at RAF base in Cambridgeshire released on bail                                       | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| US immigration officials defend ICE agents who shot man in same car as child                               | justified deck-only                 | 1        | 23w  | 0     | 23           | 2026-10-09 | -                                                         |
| Russian search engine Yandex struggles after Ukrainian strikes on data centres                             | justified deck-only                 | 1        | 23w  | 0     | 19           | 2026-10-09 | -                                                         |
| Labour byelection win shows party starting to win back voters on left                                      | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| LumenUs helps automate tedious paperwork in times of grief                                                 | justified deck-only                 | 1        | 29w  | 0     | 29           | 2026-10-09 | -                                                         |
| Ed Davey faces growing revolt against leadership as senior Lib Dem MP quits                                | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Danu Robotics’ fight to build a better recycling robot                                                     | justified deck-only                 | 1        | 21w  | 0     | 18           | 2026-10-09 | -                                                         |
| Did Russia play by the rules in reporting lab worker's death?                                              | justified deck-only                 | 1        | 29w  | 0     | 29           | 2026-10-09 | -                                                         |
| b11531                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 178          | 2026-10-09 | invalid_sentence=10                                       |
| Does Polanski have to go? Greens at the crossroads after Holborn and St Pancras                            | justified silence, no coverage body | 0        | none | 0     | 5            | 2026-10-09 | -                                                         |
| Tornado rips through Sicilian town and city                                                                | justified deck-only                 | 1        | 16w  | 0     | 16           | 2026-10-09 | -                                                         |
| Watch: 'I am Jane Doe' protests across US call for end to sexual violence                                  | justified deck-only                 | 1        | 15w  | 0     | 15           | 2026-10-09 | -                                                         |
| How the oil industry is preparing for Hurricane Isaias                                                     | justified deck-only                 | 1        | 19w  | 0     | 29           | 2026-10-09 | invalid_sentence=1                                        |
| China agrees to ‘halve’ hybrid car exports to EU in landmark deal                                          | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Quoting Matthew Green                                                                                      | justified deck-only, charged        | 2        | 33w  | 1     | 121          | 2026-10-09 | invalid_sentence=2,editorial_noise=2,narrator_ambiguous=2 |
| Python 3.15 Released With Experimental JIT Compiler Running Faster                                         | justified silence, charged          | 0        | 19w  | 0     | 16           | 2026-10-09 | invalid_sentence=1                                        |
| b11527                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 195          | 2026-10-09 | invalid_sentence=10,imperative_instruction=1              |
| b11526                                                                                                     | justified deck-only                 | 1        | 36w  | 0     | 180          | 2026-10-09 | invalid_sentence=10                                       |
| Democratic Senate candidate responds to anti-trans attacks pushed by Republicans                           | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Surveillance company Flock cuts staff as privacy backlash grows                                            | justified deck-only                 | 1        | 18w  | 0     | 18           | 2026-10-09 | -                                                         |
| Ubuntu 26.10 Sticks To Using GCC 15 By Default                                                             | justified silence, charged          | 0        | none | 0     | 28           | 2026-10-09 | narrator_ambiguous=1                                      |
| Lightsaber Darth Vader used in ‘I am your father’ Star Wars duel up for auction                            | justified silence, no coverage body | 0        | none | 0     | 2            | 2026-10-09 | -                                                         |
| Hurricane Isaias barrels toward Gulf coast as category 3 storm                                             | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| EU ‘pulling out all stops’ with minerals projects as it tries to avert China trade war                     | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Execution live stream could cause PTSD in viewers, say psychiatrists                                       | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| Robert Jenrick launches scathing broadside against ‘Kensington Kemi’                                       | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| Tory tax break for banks has cost UK public purse £6bn, says TUC                                           | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Microsoft barred from sponsoring foreign workers for US residency                                          | justified deck-only, charged        | 3        | 31w  | 0     | 85           | 2026-10-09 | invalid_sentence=2                                        |
| Andrew Mountbatten-Windsor faced £1.8m repair bill after leaving Royal Lodge                               | justified silence, no coverage body | 0        | none | 0     | 4            | 2026-10-09 | -                                                         |
| Trump says U.S. won't attack Iran before midterms. And, ICE agent shoots man in NYC                        | justified deck-only                 | 1        | 13w  | 0     | 36           | 2026-10-09 | invalid_sentence=1                                        |
| Faster Zswap With Patches To Batch The Writeback I/O                                                       | justified silence, charged          | 0        | none | 0     | 42           | 2026-10-09 | narrator_ambiguous=1                                      |
| Hegseth promises execution live stream as Trump appears to ‘pause’ war on Iran \| First Thing              | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| Leader of Jewish Greens calls for Zack Polanski to resign                                                  | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| Boro: NVIDIA's Open-Source Effort For AI-Assisted Linux Kernel Development                                 | justified silence, charged          | 0        | 31w  | 0     | 31           | 2026-10-09 | invalid_sentence=1                                        |
| Isaias strengthens to become first Atlantic hurricane of 2026 season                                       | justified silence, no coverage body | 0        | none | 0     | 3            | 2026-10-09 | -                                                         |
| NEWSBRIEF: HURRICANE ISAIAS, UKRAINE WAR LATEST, POLITICS OF IRAN WAR                                      | justified deck-only                 | 1        | 23w  | 0     | 19           | 2026-10-09 | -                                                         |
| Ukraine has battlefield success with drones, but Russian airstrikes relentless                             | justified deck-only                 | 1        | 23w  | 0     | 23           | 2026-10-09 | -                                                         |
| Ukraine's made battlefield gains, but Russia tipped for large winter offensive                             | justified deck-only                 | 1        | 30w  | 0     | 30           | 2026-10-09 | -                                                         |
| Norwegian Nobel Committee awards this year's Peace Prize                                                   | justified deck-only                 | 1        | 15w  | 0     | 15           | 2026-10-09 | -                                                         |
| b11518                                                                                                     | justified silence, charged          | 0        | none | 0     | 11           | 2026-10-09 | invalid_sentence=1                                        |

### What the four classes actually contain

**The 24 `no coverage body` stories are the ones worth naming.** Each carries a single source whose
stored coverage is a headline and a photo credit — `Photograph: Facebook`, `Photograph: Joe
Raedle/Getty Images`, `Composite: Alex Mellon for the Guardian : Getty Images` — two to nine words.
Nothing was refused because nothing was ever offered; the evidence pass had no article text to read.
Silence is the right reader-facing outcome, and the class exists because it is not the same finding
as "a rule judged the material too thin".

**The 7 `charged` silences** are the opposite: real prose (16–42 words) from the feed's own summary,
refused by a named rule — `invalid_sentence` where the feed itself truncated the sentence mid-clause
(the stored excerpt ends in an ellipsis), `narrator_ambiguous` where the voice is a first-person
columnist. Publishing a truncation or an unattributable "I" would be the defect, not the refusal.

**The 9 llama.cpp entries** (`b11540`, `b11539`, `b11538`, `b11534`, `b11531`, `b11527`, `b11526`,
`b11541`, `b11518`) are a CI build log — 178–207 word commit messages with the title `b11541`.
`invalid_sentence=10` per story is the rules correctly refusing ten fragments of a build log. They
have no disposition problem in the composer; whether a build-number feed belongs in the corpus at all
is an ingestion question, not one this rule set can answer.

**The two charged deck-only stories are each another queue's entry**: `Quoting Matthew Green` wears a
quote-opening title (D4's family) and `Microsoft barred from sponsoring foreign workers` was emptied
by `stacked_quotes=2` (D7's mechanism). Neither is a D6 defect; both are cross-references, recorded so
the later queues do not re-derive them.

## 3. The dominant family is not the composer's to fix

The live window answers what the frozen file cannot: whether a silent story's article had an evidence
row that failed, or never had one. `npm run audit:reader` on 2026-10-11 (live, 200 events):

```
silent stories 50   nothing-selected 23 / single-fact-is-the-deck 27 / charged 0
enrichment state of the coverage:  none 30   blocked 5   unavailable 6   enriched 9
```

**41 of the 50 (82%) had no usable evidence when the composer ran**: 30 articles with no
`article_evidence` row at all, 11 whose fetch was blocked or the page unavailable. The 9 whose
evidence was enriched are deck-only outcomes governed by the floor. The frozen 200 shows the same
shape in its own field: 57 of 59 with zero extracted units.

`npm run audit:enrichment` (2026-10-11, 30-day window, 1000 events) says whose decision that was:

```
covered rate 43.6% (436/1000)
extraction_empty  180      never_attempted 285      blocked  82
thin_content       15      unreachable       2
fixable families 465       boundaries, not defects 99     uncovered with importance>=7  7
```

and `scripts/reader-enrichment-cause.ts` splits the 285 `never_attempted` by the gate that kept each
article out:

```
never_matched 267   priority_arm 9   fallback_arm 4   source_gate 4   outside_both_arms 1
```

**So the silence decomposes into three owners, and only one of them is a defect.**

- **`never_matched` 267 — a cost boundary, not a loss.** The enrich stage's priority arm is events a
  reader was matched to in the last 24 hours and its fallback arm is articles published inside 72
  hours; an event nobody was ever matched to and whose articles are older is _deliberately_ never
  enriched. No amount of ticking picks it up. This corrects the census's own headline number:
  `fixable families 465` counts all of `never_attempted` as fixable, and 267 of the 285 are that
  boundary, so the genuinely fixable figure is nearer **198** (`extraction_empty` 180 + `priority_arm`
  9 + `fallback_arm` 4 + `source_gate` 4 + `outside_both_arms` 1). Reported as a correction, not a
  change to the script.
- **`extraction_empty` 180 — the real loss.** The page was fetched and had enough words, and zero
  units came out. This is the family whose only possible fix is inside the evidence pass.
- **`priority_arm` 9 — the only candidate defect on this path.** These events _had_ a reader matched
  within 24 hours and their articles were inside the candidate arms, so the dispatch should have
  picked them and did not (`ENRICH_LIMIT` is 3 per tick, newest-published first).

## 4. Proposed disposition, for a narrow ruling

1. **No composer rule changes.** Zero false refusals, zero evidence-selection defects, zero
   unresolved across all 59. There is nothing here for a release rule to fix, and this is the
   measurement the ruling's "no broad release rule" condition was waiting for.
2. **Bring forward `priority_arm` 9** — dispatch starvation: a matched, in-arm article that a tick
   never reached. Reproducible from the same two commands; a candidate for a narrow ruling on the
   enrich batch order or limit.
3. **Bring forward `extraction_empty` 180** as the one family that is real loss, with the caveat that
   it is an evidence-pass question, not a readiness one.
4. **Treat `never_matched` 267 as boundary behaviour**, recorded as the explicit cost gate it is, so
   the next reader of `fixable families 465` does not read it as 465 lost stories.
5. **A reporting nit for the census, not a defect:** on the live window 2 of the 27
   `single-fact-is-the-deck` stories published no deck at all (their one fact was refused for
   `unresolved_context`). The class is keyed on `selected === 1`, so its name overstates. Both are
   charged to a named rule, so neither is a defect; on the frozen 200 the label is exact (0 of 26).

## 5. Provenance

- `npm run audit:reader -- --corpus tmp/corpus-after.json` (frozen 200) and `npm run audit:reader`
  (live 200), 2026-10-11. Census `59 (31/26/2)`, ledger `1572 = 1418 + 154 + 0`,
  `delivered with no body 0`, `readable stories withheld 14` — identical before and after the
  instrument change, per-story ledger byte-identical.
- `npm run audit:enrichment` and `scripts/reader-enrichment-cause.ts`, 2026-10-11, 30-day window.
- The frozen corpus and its baseline were **not** changed, and no composer rule was touched.
