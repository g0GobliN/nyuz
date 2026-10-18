# Start here — 2026-10-18 (evening), after the instruments landed

Read this, then `docs/context.md`, then `docs/reader-quality-10-of-10.md`. Nothing in this file is a
plan the owner has to approve; it is where the work stopped and why.

## Where the product is

- **Deployed and green.** `main` is pushed and the deploy job is green. The reader's live product is
  `https://nyuz.grgvishal-gurung17.workers.dev` (no domain is bought, on purpose).
- **The reader's surfaces now each have an instrument whose exit status is the check.** Four of them,
  plus a fifth that measures a rule nobody has ruled on:

  ```
  npm run audit:delivered-line      ruling #11 at the briefing          FAIL 6/13 today (built pre-ruling), 13/13 if built now
  npm run briefing:checkpoint       the ladder, per delivered item       ladder now: none 13
  npm run audit:surfaces            feed + archive + alert channel       PASS 57/57 · 14/14 · 2/2 (8 withheld)
  npm run audit:alerts-gate         the alert population alone           PASS 2 would fire, 0 firing unfairly
  npm run briefing:withhold-preview what the withhold rule would keep     0 of 13 items
  npm run baseline:sources          ruling #12c's baseline before/after   79 sources · 26 withheld · 153 multi-publisher
  ```

- **Tonight's 22:30Z build is the first shipped briefing under ruling #11.** Run
  `npm run audit:delivered-line` after it: item 1 of the checklist should turn from `FAIL 6/13` into
  `PASS 13/13`. If it does not, that is the only reader-facing thing to repair first.

## The next slice, already ruled: #12c

The arbiter (ChatGPT `nyuz` project, thread "Rule clustering option") ruled **#12c** on 2026-10-18:
reactivate **eight** sources for a bounded 30-day experiment through **per-source exemptions**, with
`demand_driven_sources` left on, and judge it by three conditions (coverage above the 153 baseline; at
least one future delivered item with a line from a rung **other than coverage**; `briefing:checkpoint`
non-zero and traceable to stored evidence). The ruling and its baseline are recorded in
[decisions/reader-delivery.md](decisions/reader-delivery.md#ruling-12c--the-source-reactivation-experiment-ruled-and-baselined-2026-10-18).

The eight, and the pairs they are chosen for:

| beat | pair |
| --- | --- |
| UK politics | BBC Politics, The Guardian Politics |
| health | BBC Health, NPR Health |
| science / environment | BBC Science, The Guardian Environment |
| US technology | Wired, Engadget |

What is **not** done: the exemption itself. It needs (1) a schema change that is auditable and
reversible — one column or one settings row naming the exempt sources and the experiment's end date,
not a second flag; (2) the ingest selection reading it before `sources_to_collect`'s demand answer; (3)
a test proving the other 18 withheld sources stay withheld; (4) the baseline re-run after enabling, so
the before/after pair is produced by one command rather than memory. The ruling's own order was
baseline first — that is recorded now, so the slice can start at (1).

Boundaries that do not move: no model-written text; delivered archives immutable; nothing composes on
the reader request path; the 45-day clustering window stays unapplied; `demand_driven_sources` is not
flipped; the free plan is a condition, not a defect.

## What the measurements say, so no session re-derives them

- **Significance is silent because the inputs are empty, not because a rung is missing.** All 13
  delivered items have no stored impact and no before/after state; 8 have no stored evidence for the
  binding rung; all 13 have one publisher. `event_impacts` is empty by policy (pure code), so the
  stored-impact and change rungs cannot fire until something else writes those columns — the coverage
  rung is the only one the corpus can feed, and it needs a second outlet.
- **The withhold rule would empty the briefing** (0 of 13). The arbiter ruled that option premature;
  do not ship it before a ruling, and note that the 0 is the evidence, not an opinion.
- **The corpus lacks cross-outlet pairs in the backlog**: 18 valid joins from two bounded drain batches
  moved multi-publisher events by 0; 40 sampled unclustered news articles had **0** eligible partners;
  publisher identity is sound (12 events read row by row, 0 mismatches).
- **The alert channel is quiet and correct**: 2 stories would fire, 8 withheld by the readiness gate,
  49 more withheld earlier (28 no reader matched, 14 already alerted, 7 outside the flash window).
- **Ruling #11 is not enforced at the feed or the archive** — 9/57 and 7/14 card lines equal their page
  opening. That is reported as a counterfactual by `audit:surfaces`, not as a defect, because extending
  the contract to those surfaces is a ruling. If a session wants to close it, put it to the arbiter
  first.

## How to consult the arbiter (this works; it is not blocked)

The ChatGPT `nyuz` project is a browser tab in the preview panel. Ask in the existing thread with
`preview_evaluate` to read the tail and `preview_type` on `div[contenteditable="true"]` to post; the
project carries the context, so a full thread is not a reason to stop — start a new chat inside the
project if it fills. Record every ruling in `docs/decisions/` with its date and quote.

## Land it the standard way

`npm run ci` green (typecheck, lint, 196 files / 3393 tests, coverage floor, build, PWA, route-walk,
origin self-test, Playwright), then commit, push, and confirm the runner's Deploy job — a red push is
not a deployed change. Update `docs/context.md` in the same commit as the change it describes.
