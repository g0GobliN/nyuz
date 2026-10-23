# Where a delivered item's significance line dies — measured (Leg A, 2026-10-23)

Task `t_27cc9ccb` —
[reader-quality-10-of-10.md](../reader-quality-10-of-10.md) item 2 (Significance, Leg A),
[reader-clarity-audit-2026-10-22.md](../reader-clarity-audit-2026-10-22.md) B-04,
[plan-2026-10-23-to-11-01.md](../plan-2026-10-23-to-11-01.md) wave 2. The card asks for
measurement first, then the smallest change that moves Leg A. This note carries the measurement, the
change it produced, and what it says the next slice must be.

Everything measured here is recorded by the facts the instrument prints. The classification is code
(`npm run audit:significance-leg-a`) and reuses the ladder's own predicates from
[`inclusion.ts`](../../src/lib/pipeline/inclusion.ts) (`consequenceStep`, `bindingStep`,
`storyNames`) — it does not re-implement them, because three instruments disagreeing with
production was the measured failure on 2026-10-17.

## The population

The three newest delivered editions (one digest per scheduled slot — 25 item rows in the
2026-10-19 22:30Z slot, 9 in 2026-10-09 22:30Z, 16 in 2026-10-08 22:30Z): **50 delivered item
rows, each on its own event (50 distinct `event_id`s)**. The window audit measures the same pool
from its other end: its query reads every digest generated in the window dates regardless of
delivery status, so its Leg A read was **2 / 50** when this slice opened (2026-10-20) and is
**3 / 92** on the 2026-10-23 tree — the 42 extra rows are digests generated after the newest
delivered slot, not newer delivered editions (no digest with `status = 'sent'` in this population
has a slot later than 2026-10-19 22:30Z).

## The funnel — where each delivered item's line died

| stage | items | share |
| --- | --- | --- |
| **composed** — a rung justified a line from stored facts | **2** | 4% |
| rung-refused — a shape exists, the ladder's own guards refused it | 2 | 4% |
| no-shape — stored evidence exists, nothing in it carries a ruled shape | 33 | 66% |
| no-evidence — nothing stored at all | 13 | 26% |

Side splits: **6 of the 50 rows carry a line** — 1 composed and carried (the 10-19 edition's
Disney consequence line, the delivered row equal to the ladder's line), 1 coverage line ("Two
publishers reported this.", also delivered equal), and **4 figure-puff lines** ("The story
carries a $40 billion figure.", plus $80B, $150 million and $60M variants) that the
pre-ruling-#10 builds of the 10-08 and 10-09 editions printed and that stand in the archive —
the non-retroactivity of ruling #10, measured. 44 rows are delivered silent. Coverage as an
input is rare here: **2 items** sit on events with ≥2 publishers, and the ladder answers both
with the coverage line — 1 of them carried. 12 evidence-bearing events die as `figure-only` (money with
nothing saying what it is doing — the shape ruling #10 removed); 2 die as `fragment`.

Refusal reasons over the events (event-level, losing refusal of the first candidate):
`consequence:figure-only 12`, `consequence:fragment 2`.

## Why the 13 no-evidence events have none — the enrich-stage attribution

Every one of the 13 resolved to **`attempted, not enriched: blocked`** — robots.txt disallowing the
path, or permission not safely determinable. Boundary, not defect ([significance-without-a-model.md](significance-without-a-model.md):
blocked is deliberately not worked around), so the delivered cohort's missing input is **not**
coverage: **74% of delivered events (37/50) already carry stored evidence.**

That contradicts the corpus-wide reading the card opens with (2.7% of matches; the 30-day
enrichment census reads 89.9% of *complete* events with zero evidence). Delivered items are
selected by a readiness gate that prefers evidence-bearing stories, so the delivered cohort skews
evidence-rich. The bottleneck this cohort measures is **shapes, not coverage**: 33 of 50 items hold
paragraph-grade prose with no money-consequence or binding shape in it, and both refused fragments
are unsafely rewritable (a conditional sentence; one with an unresolvable "they").

## The change this measurement produced: zero-yield extraction is not a success

While attributing the no-evidence family, the pipeline side surfaced the one real coverage defect
the 30-day window shows, and it is in enrichment, not in the ladder: **a page that fetches at the
usable-words floor and yields zero admissible evidence units is recorded as `ok: true` on the
source** — an extraction that produced nothing reports success, so no failure counter, backoff or
recovery path can ever see it.

Measured ([probe of the 30-day window](../audits/significance-leg-a.json)): the
`extraction_empty` census family is real and concentrated — Lenta.ru 5/96 rows zero covered,
India Today 5/46 with 2 covered, El Financiero 2/29 zero covered, Milan News 2/14 zero covered —
non-English feeds the reader gets nothing from while the stage keeps paying the free plan's
subrequest budget for them every tick.

**Landed (in scope, `src/lib/pipeline/enrich.ts`):** a zero-yield extraction now counts toward
`enrichment_failure_count` and reports `extraction_empty` in the run row, so the source reaches the
same latch a broken origin reaches. The `article_evidence` row keeps the census's documented family
shape (`enriched` status, zero units, a real word count — that shape *is* the census's evidence),
so [enrichment-census.ts](../../src/lib/enrichment-census.ts)'s attribution is unchanged. Tests
fail-first pinned both the report shape and the latch (2 new cases in `enrich.test.ts`). The reader
effect: the tick's 3 fetch slots stop being spent on sources whose extraction provably yields
nothing, and the run row can finally see the family.

## What would raise Leg A next — and what would not

Leg A is the universal bar (arbiter #17/#17a, quoted in
[reader-quality-10-of-10.md](../reader-quality-10-of-10.md): every delivered item carries a
non-empty, story-specific line, agreed with the ladder now, traced to stored material —
**coverage is eligible** on this leg). Two things measured worse than useless here:

- **Widening `CONSEQUENCE`** (the money verb set — the two composed lines are "asks for damages",
  "will be refunded") to plu-raising/announcement verbs would convert a handful of the 12
  figure-only candidates, but 8–10 of them die at the why-vs-what gate (deals and funding
  announcements that restate the paragraph: SSD prices, Nvidia pre-orders, the Town Series B
  announcement) or are truncated mid-number by the same unit bound that protects them. The
  2026-10-09 history (narrow rule measured ~1/3 precision, measured in inclusion.ts's header) is
  exactly why the verb set is narrow. Not done in this slice: a candidate widening needs its own
  measured census like `audit:binding` got, and an arbiter cross-examination before landing.
- **Repairing the 2 refused fragments** is not a slicing bug: one clause begins "then SpaceX's xAI
  will get $40 billion", whose conditional cannot be printed without the "if"; the other's "they"
  does not resolve inside the clause. The FRAGMENT guard is doing its job.

The honest next mover, on the numbers above: **the next build's rows**, not this cohort.
Zero-yield sources latching (the change above) frees the tick's budget for English-capable
candidates; evidence-bearing events stay at 74% and the shapes run unchanged. Leg A rises only when
a new rule composes more lines from stored facts — or when the pool's coverage grows events of the
shape the ruled rungs can explain (multi-source events are rare in this
cohort: 2/50 coverage-eligible is the ceiling the coverage rung alone reaches). Both routes are
with the arbiter; neither is free.

## One conflict to put to the arbiter

The task card says *"a coverage-count line … is not a significance line — the item prints no
'Why it matters' … rather than printing a puff sentence"*, but the recorded instrument ruling
([reader-quality-10-of-10.md](../reader-quality-10-of-10.md) item 2, arbiter #17/#17a) says
`coverage` **is eligible on Leg A** and `npm run audit:significance-window`'s exit codes are built
on that. This slice changed neither: removing the rung would move Leg A down on the same rows, and
the audit script is outside this task's file boundary. The conflict is recorded here so the next
arbiter question ("does a coverage-only item print no why-line, and does the stored-row Line A bar
read the archive that results?") can be asked with this measurement attached. Until it is answered,
the coverage rung prints what it prints and Leg A reads the saved count.

## Commands

```
npm run audit:significance-leg-a        # the funnel table, writes docs/audits/significance-leg-a.json
npm run audit:significance-window       # Leg A / Leg B on the experiment's window (unchanged)
npm run briefing:checkpoint             # ladder now / stored-equals drift diagnostic (unchanged)
```

Ledger: [audits/significance-leg-a.json](../audits/significance-leg-a.json) — every item with its
stage, rung, refusal reasons, evidence units, and the stored units the ladder read.
