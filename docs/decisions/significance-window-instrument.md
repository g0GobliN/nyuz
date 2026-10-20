# Gate 2's instrument, and the definition it cannot compute (2026-10-20)

Measured 2026-10-20, read-only, against the live project while ruling #12c's source experiment runs
(window **2026-10-19T06:46:22Z → 2026-11-18T06:46:22Z**, eight sources released). This file records an
instrument, the first real output it produced, and a **definition gap**: the repository names two
different bars for gate 2's verdict, and on the same delivered rows they read differently. No product
behaviour was changed and no metric was invented.

Gate 2 is item 2 of [reader-quality-10-of-10.md](../reader-quality-10-of-10.md): _"Significance. Every
delivered item either carries a line a stored fact justifies, or is not delivered."_ Its verdict was
parked until 2026-11-18 because that is the experiment's calendar, not because a slice was missing.

## What was built

`npm run audit:significance-window` ([scripts/significance-window-audit.ts](../../scripts/significance-window-audit.ts))
is the ledger the 18 November reading needs:

- **The window is read, not copied.** It comes from `source_exemptions` — the row the gate itself
  honours — and the command refuses if the enabled rows disagree about it. A literal date in the script
  would be a second source of truth for something the database already records.
- **Every briefing generated inside the window is enumerated**, with its reader, status and item count,
  and every `digest_items` row in it. Four of the five briefings so far are `skipped` with 0 items; the
  command reports them rather than filtering them away, because "delivered" is one of the words the docs
  leave open (below).
- **For every delivered item the ladder is re-derived** with `reasonFor` on the same inputs
  `briefing:checkpoint` reads: stored impact, before/after state, publisher count, the event's own
  `article_evidence`, title and paragraph. The rung, its text, whether the delivered row carries it, and
  whether the two are equal are recorded per item.
- **The per-event evidence is persisted** to
  [docs/audits/significance-window-12c-30d.json](../audits/significance-window-12c-30d.json): title,
  paragraph, states, publisher count, distinct outlets with their fetch times, every evidence sentence,
  the rung it produced and where the line traces. It is **one copy per event**, never per reader, and
  the delivery rows reference event ids — the cost model in [database.md](../database.md) holds in the
  record as it does in the database. The first ledger is 69 KB for 25 events.
- **Before the close it prints `PENDING` with the close date; after it, it refuses a verdict** (below).
  `--now ISO` exists so both branches can be verified against real rows instead of waiting for the
  calendar; the ledger records the clock it was taken with.
- It writes no database row, calls no model and imports no application code beyond the ladder itself.

## The bars the repository states, quoted

| source                                                                | lines     | text                                                                                                                                                                                                                                                                                                                                  | shape                                                  |
| --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [reader-quality-10-of-10.md](../reader-quality-10-of-10.md)           | 12–14     | _"Every delivered item either carries a line a stored fact justifies, or is not delivered. The command is `npm run briefing:checkpoint` — `ladder now:` must be non-zero, and every `none` must be an item that was withheld. `stored equals the ladder now` is the drift check."_                                                    | **universal** — every delivered item                   |
| [reader-delivery.md](reader-delivery.md)                              | 3386–3392 | ruling #12c's three acceptance conditions: coverage _"exceed the baseline"_; significance _"at least one **future delivered** briefing item carries a valid, story-specific line from a rung **other than coverage**"_; pipeline _"`briefing:checkpoint` reads a non-zero ladder, and the qualifying line traces to stored evidence"_ | **existence** — at least one item                      |
| [handoff-2026-10-19-afternoon.md](../handoff-2026-10-19-afternoon.md) | 35        | _"Report: did the eight newly released sources produce at least one future delivered briefing item with a non-coverage ladder line? That is the yes/no that moves item 2."_                                                                                                                                                           | **existence + attribution** — one item, from the eight |

A fourth sentence is load-bearing because it contradicts the first: ruling #12 option 1, recorded at
[reader-quality-10-of-10.md](../reader-quality-10-of-10.md) 66–67, says **"do not withhold publishable
stories for a missing line."** The checklist's _"or is not delivered"_ therefore describes a behaviour
the product is ruled not to have: under the standing policy, a delivered item with no line stays
delivered.

## The same rows, three readings, two answers

Today's window holds **5 briefings, 1 with items, 25 delivered items, 3 readers**. Re-derived:

```
ladder now: consequence 1, coverage 1, none 23
delivered items                  25
carried any line at all          1 / 25
stored equals the ladder now     1 / 25
ladder now yields a line         2 / 25
silent (nothing carried)         23 / 25
```

- **Universal bar (checklist):** **FAIL — 1 of 25** delivered items carries a line the ladder justifies.
  A PASS needs 25 of 25.
- **Ruling #12c's significance condition:** **PASS — 1 item.** Card #08 (_Disney Asked Character.AI to
  Go Bankrupt…_) carries _"The company will be refunded the $2 million deposit and receive a breakup
  fee."_ — story-specific, from the `consequence` rung, and the line traces to the event's evidence.
- **The handoff's version:** also **PASS**, and the attribution holds: the event's outlet is **Wired**,
  one of the eight, and its article was fetched **2026-10-19T11:00Z**, inside the window. The line traces
  to Wired's own evidence sentence.

So the same ledger answers **FAIL** to the bar the checklist states and **PASS** to both statements of
the experiment's bar. Which one is gate 2's verdict is not a detail — it is the verdict. The instrument
cannot choose without inventing a metric, which is the one thing the task that asked for it forbids.

## The definitions that are missing, precisely

1. **Which bar governs gate 2.** The checklist's universal sentence (lines 12–14) or ruling #12c's
   existence condition ([reader-delivery.md](reader-delivery.md) 3391), which the handoffs call _"the
   yes/no that moves item 2."_ If the answer is "both", the doc must say which one the word _verdict_
   refers to and what happens when they disagree — they do today.
2. **Whether the eight-source attribution is required.** Ruling #12c does not state it; the handoff does
   ([handoff-2026-10-19-afternoon.md](../handoff-2026-10-19-afternoon.md) 35). The qualifying line today
   happens to satisfy both, so the ambiguity has not yet bitten — it would the first time a line arrives
   on an event none of the eight touched.
3. **What "a stored fact justifies" means.** The item **carries** the line
   (`digest_items.why_it_matters` non-empty) or the ladder **would produce** it now
   (`stored equals the ladder now`)? They differ: card #16's event would now produce the `coverage` line
   _"Two publishers reported this."_ while the delivered row carries nothing. Today the two readings
   happen to agree (1 / 25); they are not the same test.
4. **Whether the `coverage` rung counts.** The checklist names no exception. Ruling #12c excludes it
   (_"a rung other than coverage"_). Under the checklist reading, #16's line would count if it were
   carried.
5. **What population "every delivered item" covers.** `briefing:checkpoint` reads **one** digest — "the
   reader's most recently generated briefing" — while the checklist says every delivered item and the
   window spans readers. Today that is 1 briefing with items for 1 of 3 readers; 4 briefings are honest
   quiet-day `skipped` rows with 0 items, and the dashboard feed and archive also deliver stories that
   are not `digest_items` at all.
6. **Where the window starts for "the first covering window."** The task and the database say
   **2026-10-19T06:46Z**. [handoff-2026-10-19-late.md](../handoff-2026-10-19-late.md) 40 and 77 say the
   clock really started with the first ingest tick after `ddaae18` deployed (**2026-10-19T08:45Z**),
   because the cadence defect cost the experiment five days. The difference is small for a 30-day
   window, but "items delivered after the first covering window" is not defined anywhere: a briefing's
   own 72-hour selection window is a different object from the experiment's 30-day boundary.

## What the instrument does, and does not do

It reports every number each of the six paragraphs above needs, labelled with the document and line that
states it, and then:

```
before the close   gate 2  PENDING    <close date>        exit 0
after the close    gate 2  UNDEFINED  <both bars named>   exit 2
```

`UNDEFINED` exits **2**, never 0. A gate with no single definition must not read green, and a pending
gate must not read red either: the exit status is how this repository's instruments state their answer,
so the absence of an answer has its own status. The moment the definition is ruled, the numbers are
already there — no second measurement pass is needed on 18 November.

## Numbered options for the arbiter

1. **Gate 2 is the checklist bar as written** — every delivered item carries a line the ladder justifies,
   `coverage` included. Then the _"or is not delivered"_ clause must be reconciled with ruling #12's
   no-withhold instruction: read it as _"a withheld item is not delivered, so it is out of scope"_, or
   rule a withhold policy. Today this reads **FAIL 1 / 25**.
2. **Gate 2 is ruling #12c's significance condition** — one delivered item with a valid, story-specific,
   non-coverage line that traces to stored evidence. Today this reads **PASS** (#08, Wired). It can read
   PASS while 23 of 25 cards are silent, which is the defect gate 2 exists to catch.
3. **Two legs, recorded together, one instrument** — gate 2 is (1); the experiment's own verdict is (2);
   a PASS on (2) does not make gate 2 PASS, and the distance between the two numbers is the finding.
   **Recommended.** It keeps the reader-facing bar meaning what it says, gives the experiment the
   acceptance its ruling wrote, and needs no new code: this ledger already prints both.
4. **Something else** — a threshold between the two, a different definition of "justifies", or a new
   class of line. If so, state the threshold and the population, because both change the verdict.

## The first real output (2026-10-20T07:39Z)

```
Gate 2 — 12c-30d's significance window
window (source_exemptions)   2026-10-19 06:46:22Z -> 2026-11-18 06:46:22Z
enabled rows                 8 of 8
clock                        2026-10-20 07:39:22Z  28d 23h to close
ledger                       docs/audits/significance-window-12c-30d.json

Delivered in the window
briefings generated           5
  with items                  1
  status sent / skipped    1 / 4
readers                       3
items                        25
distinct events              25

  ladder now: consequence 1, coverage 1, none 23
  delivered items                  25
  carried any line at all          1 / 25
  stored equals the ladder now     1 / 25
  ladder now yields a line         2 / 25
  silent (nothing carried)         23 / 25

gate 2  PENDING  window closes 2026-11-18 06:46:22Z (28d 23h away); 25 delivered item(s) recorded,
no verdict before the close
```

The closed-window branch was exercised on the same rows with `--now 2026-11-18T07:00:00Z`, and printed
`gate 2  UNDEFINED  two documented bars disagree …` with **exit 2**, as designed.

## How to re-read it on 18 November

```bash
npm run audit:significance-window
git add docs/audits/significance-window-12c-30d.json
```

Paste the verdict line and the block above it into the board entry, and commit the ledger with them.
If a ruling has landed by then, the number it names is in that output; if one has not, `UNDEFINED` is
the honest reading and this file is the blocker to put in front of the arbiter.
