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

## What the instrument did before the ruling, and what it does now

Before 2026-10-20 it reported every number each of the six paragraphs above needs, labelled with the
document and line that states it, and then refused a verdict:

```
before the close   gate 2  PENDING    <close date>        exit 0     (retired by the ruling)
after the close    gate 2  UNDEFINED  <both bars named>   exit 2     (retired by the ruling)
```

`UNDEFINED` exited **2**, never 0: a gate with no single definition must not read green. That shape is
kept for missing evidence, and is replaced for the two documented bars by the two legs below. The
pre-close `0` is **retired**: the ruling requires an unfinished experiment to exit 2.

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

## Ruled: two legs, one instrument (arbiter #17 and #17a, 2026-10-20)

The case went to the arbiter (the owner's ChatGPT `nyuz` project, chat *"Gate 2 Ruling"*) with the four
options above and the measured rows. It ruled **option 3**, then narrowed the population the same day
after one cross-examination.

**#17 — option 3, and why.** _"The universal reader-quality bar and the experiment's existence condition
are distinct tests. Neither may substitute for the other."_ Gate 2 is reported as two legs:

- **Leg A — universal delivery quality.** Every item delivered within the defined population carries a
  non-empty, story-specific `why_it_matters` line justified by the evidence available to the delivery
  decision. The delivered line is checked against the ladder-derived line under the existing canonical
  comparison, and _"a line derived now but absent from the delivered row does not retroactively count as
  delivered"_ — card #16 stays a delivery failure. A missing line is a failure, **not** an implicit
  withholding decision; the ruling does not authorise withholding publishable stories.
- **Leg B — significance experiment acceptance.** At least one qualifying delivered briefing item carries
  a valid, story-specific line from a rung other than coverage, traced to that event's stored evidence,
  **and attributable to one of the eight released sources** — the attribution the handoff stated and
  ruling #12c's text omitted. The outlet and its fetch time are recorded in the ledger, not asserted.

The split verdict on the same rows: **Leg A FAIL 1 / 25, Leg B PASS** (card #08, `consequence`, Wired,
fetched `2026-10-19T11:00:15Z`). _"The experiment can succeed while the product-quality gate fails. That
is not a contradiction to resolve by weakening either bar; it is the measured finding the two-leg verdict
exists to expose."_

**#17a — the population, after cross-examination.** The first ruling's population ("all items actually
delivered … across all readers and delivery surfaces included in the checklist") was too broad, and the
arbiter withdrew it on the evidence that the feed's matched-story path never carries a `why_it_matters`
line: _"Your cross-examination identifies a real scope error in my previous ruling: I extended the
significance-line requirement to surfaces governed by a different checklist item. That was too broad."_
Leg A is _"delivered briefing items (`digest_items`) generated within the authoritative experiment
window"_. The archive re-renders those same rows and is not counted twice; the feed's digest-sourced cards
are the same rows again; the feed's matched-story cards and the alert channel stay under checklist item 3
— _"do not classify absence of why_it_matters as a Gate 2 failure."_

**The six missing definitions, as ruled:** each one is answered in the ruling above, and the summary is:
both bars govern, as two independent legs; the eight-source attribution is required for Leg B and recorded
with the outlet's name and fetch time; the delivered row is authoritative for what the reader received and
the ladder now for what the evidence supports, with a line derived now but not delivered not counting; the
`coverage` rung counts on Leg A and not on Leg B; the population is the delivered `digest_items` of the
window for every reader, with the archive's re-render and the feed's digest copy not counted again; and the
window is `source_exemptions`' 2026-10-19T06:46:22Z → 2026-11-18T06:46:22Z, the 08:45Z ingest tick being
"an operational event, not a replacement for the recorded experiment boundary".

**Exit status, which the ruling set and the instrument now implements:**

```
window still open      gate 2  PENDING    <close date>                        exit 2
closed, both legs pass gate 2  PASS       Leg A PASS · Leg B PASS             exit 0
closed, a leg fails    gate 2  FAIL       Leg A FAIL (1/25) · Leg B PASS      exit 1
evidence incomplete    gate 2  UNDEFINED  <what is missing>                   exit 2
```

`stored equals the ladder now` is printed as a diagnostic: it is read inside Leg A and is not a threshold
of its own. A pre-close run records the counts and **no leg verdict** — the ledger's `verdict.legA.verdict`
and `verdict.legB.verdict` are `null` until the window closes on whole evidence, because a run before the
close "must not report PASS or FAIL for a window whose acceptance conditions are not yet final".

## What the ruled command printed (2026-10-20)

Open window, `npm run audit:significance-window`, **exit 2**:

```
Leg A — universal, every delivered briefing item inside the window
    1 / 25 carry a non-empty, story-specific line, agreed with the ladder now and traced to stored material
    result: no verdict before the close
Leg B — the experiment's existence condition (ruling #12c + the handoff's attribution)
    1 / 1 qualifying line(s) traced and attributable to one of the eight released sources
    result: no verdict before the close
      #08 consequence Disney Asked Character.AI to Go Bankrupt for a Get-Out-of-Laws
         "The company will be refunded the $2 million deposit and receive a breakup fee."
         traced yes; released source: Wired, fetched 2026-10-19T11:00:15.17196+00:00

gate 2  PENDING  window closes 2026-11-18 06:46:22Z (28d 22h away); 25 delivered item(s) recorded,
no PASS or FAIL before the close  exit 2
```

The closed branch, exercised on the same rows with `--now 2026-11-18T07:00:00Z --out /tmp/…`, **exit 1**
— the verdict *shape* 18 November will produce, not the 18 November reading:

```
gate 2  FAIL  Leg A FAIL (1/25) · Leg B PASS (1 qualifying)  exit 1
```

## 18 November is still owed

The window closes `2026-11-18T06:46:22Z`; the reading must be taken on the rows delivered by then, and
the ledger committed with that run's clock. Nothing about this ruling makes that reading early — it makes
it **possible**: the command now prints a verdict the ruling names, instead of refusing one.
