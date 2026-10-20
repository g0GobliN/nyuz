# What is left before a reader's briefing is 10/10

Written 2026-10-18, so the next session starts from state instead of re-deriving it. Every number here
was measured, and the command that measured it is named beside it. This file is the acceptance
checklist for the reader-facing bar; `docs/context.md` stays the project memory, this is the short list
of what still fails.

## The definition of done (all four must hold, on the live product)

1. **Delivery.** `npm run audit:delivered-line` reads `PASS n / n card lines equal their page opening
   (0 defects, …)` against a briefing a reader actually received. Exit 0.
2. **Significance.** Every delivered item either carries a line a stored fact justifies, or is not
   delivered. The command is `npm run briefing:checkpoint` — `ladder now:` must be non-zero, and every
   `none` must be an item that was withheld. `stored equals the ladder now` is the drift check.
3. **The rest of the reader's surfaces.** Home feed, archive and the alert channel are measured the way
   the briefing now is (one instrument, one verdict line, exit status as the check). Nothing has been
   audited there yet.
4. **Alerts.** Quiet and meaningful: the alert audit's gate line read against the current pool, with no
   class firing that a reader did not need to act on.

`10/10` is therefore a measurement, not an opinion: each line above is a command whose failure exits
non-zero. When all four read green on the live product, the reader-facing bar is met; until then the
goal is unfinished.

## Where each item stands today (2026-10-18)

| item | state | how it was measured |
| --- | --- | --- |
| 1. Delivery | **first briefing built under the contract read `FAIL 10 / 13` (3 defects) on 2026-10-19, and the cause is found and fixed in the tree** — the gate composed from the article's excerpt while the page composes from the excerpt plus its `article_evidence`; the gate now reads the same material (`10/13 → 13/13` measured on the delivered rows). The next build is the first under the fix | `npm run audit:delivered-line` |
| 2. Significance | **fails**: `ladder now: none 13`, 12 of 13 items silent, 1 stored line kept verbatim; under the withhold rule **0 of 13 items would survive** | `npm run briefing:checkpoint`, `npm run briefing:withhold-preview` |
| 3. Other surfaces | **measured, green, and ruling #11 is now enforced there**: feed `53/53` card lines equal their page opening (3 cards print no line, 0 defects), archive `25/25`, 0 defects; the counterfactual it used to report (`9/57`, `7/14`) is the assertion now — a card line that differs from its page opening fails the run. The feed's admitted count moved 54 → 53 because the instrument now models the loader's own `deliveredLine` boundary instead of the raw column | `npm run audit:surfaces` |
| 4. Alerts | **measured, green**: 2 stories would fire, 8 withheld by the readiness gate (3 newsletter, 5 single-source research), 0 firing while a gate refuses it; 49 more withheld earlier in the funnel (28 no reader matched, 14 already alerted, 7 outside the flash window) | `npm run audit:alerts-gate` |

## Why item 2 fails, exactly

The ladder (`src/lib/pipeline/inclusion.ts`) is not broken. Its inputs are empty:

- **stored impact** — `event_impacts` is empty by policy (no model writes analysis text);
- **before/after state** — `events.after_state` is not written, same policy;
- **the binding sentence** — needs the event's own stored evidence (enrichment), which covers 2.7% of
  matches;
- **the coverage count** — needs ≥2 independent outlets.

And multi-outlet stories cannot form in the numbers the rung needs, measured live 2026-10-18:

| quantity | value |
| --- | --- |
| complete events | 12,256 |
| events with ≥2 publishers | **152 (1.2%)** |
| articles | 48,180 |
| unclustered articles (`event_id` null) | 25,252 |
| … of those older than 7 days | **24,935 (99%)** |
| sources not fetched since 2026-10-06 (demand gate) | 26 of 87 |
| one live `cluster --limit 100` batch | 18 considered, 0 joined, 0 grouped, 18 events of one |

`priority_articles_to_cluster` reaches a backlog only 7 days deep (`backlog_cutoff = now() - interval
'7 days'`), one sixth of a ≤100 batch, so 99% of the unclustered corpus is unreachable by the matcher
that has been proved to merge real cross-outlet pairs (both Red Roses headlines, the wildfire pair, the
Roadster pair).

**So the fix is upstream, and it is a cost/limit decision — not a rung to write.** Put to the arbiter
2026-10-18 as request #12 with numbered options: (1) extend the backlog window and drain it, (2)
re-enable the dormant sources, (3) both, (4) withhold items with no significance line so the briefing is
smaller but every item is explained, (5) something else.

**Ruled: option 1** — extend the clustering window 7 → 45 days, drain in bounded batches, measure before
scaling, do not re-enable sources yet, do not withhold publishable stories for a missing line.

**Done and measured (2026-10-18):** the drain is landed as `npm run cluster:backlog` (bounded, `--kind`,
`--dry-run`, refuses any run reporting a model call). Two real news batches: 100 articles → 8 joined, 100
→ 10 joined, all cross-outlet paraphrases, none looking false, 0 grouped, 0 failed, 0 model calls, ~40 s
each; **events with ≥2 publishers 152 → 152 — the acceptance number did not move.** The backlog behind
those batches is 14,657 articles (4,034 news, 10,090 research). Whether the ceiling is the corpus or
`events.publisher_count` lagging the analysis pass is open and is with the arbiter now; **the window
change itself is deliberately not applied**, because a ruling whose own acceptance number does not move
is re-cross-examined rather than followed.

**Answered by #12a's inspection (2026-10-18, read-only): the ceiling is the corpus, not the counter.**
Twelve multi-publisher events read row by row show sound publisher keys (key count = distinct-source
count on all twelve) and genuinely different outlets; the analysis pass does re-count (`coverage_revision`
18 / `publisher_count` 3 on a drained event). A probe of 40 unclustered news articles found **0 eligible
cross-outlet pairs** within ±48 h. So the matcher is not blind and the counter is not stale — the backlog
has no partners to find. That is the arbiter's own third condition, and the open question is now exactly
one: **a separately budgeted source-reactivation experiment**, or a smaller briefing where every item is
explained. Nothing in this item is blocked on code.

## The four commands, and what they answered on 2026-10-18

```
npm run audit:delivered-line     FAIL 6 / 13   (built before ruling #11; 13/13 if built now)   exit 1
npm run briefing:checkpoint      ladder now: none 13; stored equals the ladder 0/13              exit 0
npm run audit:surfaces           PASS  feed 57/57 · archive 14/14 · alerts 2/2 (8 withheld)      exit 0
npm run audit:alerts-gate        PASS  2 would fire, 8 withheld by a gate, 0 firing unfairly       exit 0
```

`briefing:withhold-preview` is the fifth, and it is deliberately not a check: it measures the rule
that has not been ruled on. Its last line today is **`0 of 13 items would reach a reader`** — every
item is silent for the same two causes (no stored impact, no before/after state), 8 of 13 also lack
the evidence the binding rung reads, and all 13 have one publisher. That is why withholding cannot
ship: the briefing would be empty, and the arbiter's #12 already ruled the option premature.

## Update 2026-10-19 — what the four commands read this morning, and what changed

```
npm run audit:delivered-line     FAIL 10 / 13  (3 defects, 0 no-deck)                            exit 1
npm run briefing:checkpoint      ladder now: none 13; stored equals the ladder now 0/13           exit 0
npm run audit:surfaces           PASS  feed 50/50 · archive 27/27 · alerts 2/2 (7 withheld)      exit 0
npm run audit:alerts-gate        PASS  2 would fire, 7 withheld by a gate, 0 firing unfairly       exit 0
```

**Item 1's three defects are explained and closed in the tree.** The delivered briefing was the first
built under ruling #11, and 10 of its 13 lines did carry the composer's own opening; the other three
came from a gate that composed from a **different input** than the page — `loadBriefs` passed the
article's `excerpt` only, while the page's loader passes the excerpt **and** the article's
`article_evidence`, which the composer reads. Measured on those rows: gate opening equals page opening
**10 / 13** before, **13 / 13** after. The fix is one attachment in the briefing build, proven
failing-first by a test that fails with only that line removed. The delivered archive is unchanged (it
is immutable); the next build is the first that can read 13/13, and that build is the evidence.

### The live read the same morning (deployed origin, dashboard, 12 cards)

Read as a stranger at `https://nyuz.grgvishal-gurung17.workers.dev/dashboard` on 2026-10-19, with
[screenshots/dashboard-2026-10-19.png](../screenshots/dashboard-2026-10-19.png) as the record:

- **Two delivered cards still show the pre-fix opening** (#02 Disney, #11 Asus monitor). Expected and
  stated: the archive is immutable, and the next build is the first under the input fix above.
- **Three cards carry the shapes the 2026-10-18 dashboard ruling lists as remaining classes** — a
  price card (`Anycubic's award-winning 3D printer hits all-time low pricing`, #07), a discount card
  (`Lenovo's fast, comfy SteamOS handheld is hundreds off`, #10), and a first-party celebration
  (`RTX Spark Ignites Global Celebration as New Windows PCs Arrive`, the vendor's own blog, #12).
  Recorded as the measured population for the next class ruling; nothing was refused on sight, because
  that ruling requires one class at a time with its own measurement. **Measured 2026-10-19**
  (`npm run audit:dashboard-classes`, recorded in
  [decisions/dashboard-feed-first-class.md](decisions/dashboard-feed-first-class.md#the-next-class-measured-pricediscount-without-an-acquisition-verb-is-not-one-class-2026-10-19)):
  "price/discount without an acquisition verb" is **105 titles of 22,569**, and it is not one class —
  40 of them are price movement *as the news* (a launch, a repricing), 25 are explicit discount deals
  (the observed card's bucket, mixed with affiliate listings), and only 5 are the clean coupon/affiliate
  shape. The vendor-blog shape (12 sources, 175 events) likewise contains engineering posts. A class has
  to be cut out of that population; a rule keyed on price alone would refuse product-launch news.
  **Ruled #14 and landed:** option 1, the **coupon publishing frame only** — `isCouponPageTitle`, wired
  into `gateHomeFeed` and `audit:surfaces`, refusing **24 corpus titles, every one a coupon/promo-code
  page**; launches, repricing, commercial changes and genuine deals stay eligible, and the first version
  that refused a product deal was tightened and pinned as a test control.
- **One topic-attribution smell — ruled #13 and fixed 2026-10-19:** a Windows command-prompt
  story from The Register reasoned **"You follow AI."** The reason line is the reader's only
  explanation of why a story is on their page, so a wrong one is a defect of the same family as a wrong
  summary. The instrument and the record are
  `npm run audit:topic-attribution`, [decisions/topic-attribution-reason-lines.md](decisions/topic-attribution-reason-lines.md).
  **The mechanism was pure code, no model:** `assignTopics` gives the AI topic the weak term `"prompt"`,
  and the rule let one weak term in a headline label a story on its own. **The arbiter ruled option 2
  (require two distinct weak terms in the headline); it is implemented, fail-before proven, and
  measured:** the measured digest went **4 flagged → 0** (plus 2 labels that differed only by the
  five-label cap, now counted separately), and the corpus is re-run in the record. Acceptance is
  *zero headline-only assignments caused by a single weak term*.

**Item 2 is unchanged and cannot move today.** `ladder now: none 13` is a corpus fact, not a rule gap:
all 13 delivered stories have one publisher, no stored impact and no before/after state, so no rung but
silence can speak. Its route is ruling **#12c** — eight sources reactivated for a bounded 30-day
experiment through per-source exemptions — whose own acceptance needs delivered items *after* the
experiment's first window. It is the next slice, and it is not a 2-hour slice: it is a schema change,
an ingest gate, a test that the other 18 sources stay withheld, and a re-run of the baseline.

**That slice was built on 2026-10-19, applied later the same day, and the experiment is now running.**
Migration 0120 adds an auditable, per-source, self-expiring exemption and the gate reads it; the PGlite test
proves exactly the eight are released and the other 18 stay withheld, and that the window closing withholds
them again. The owner pasted the migration into the SQL editor on 2026-10-19; the before-record was taken
with the clock stopped (**12,733 complete events, 169 with ≥2 publishers**, ladder `none 56 · coverage 3 ·
consequence 1`), then `npm run experiment:sources -- --on` started the window
**2026-10-19T06:46Z → 2026-11-18T06:46Z**, and the gate answers `exempt: 12c-30d` for all eight. Item 2's
acceptance is measured on items delivered **after** the first covering window, so its verdict is not
available today.

**Measured an hour later: the experiment was running and inert, and that is now fixed.** The gate released
all eight and not one feed moved, because every one of them also sat on the **`paused`** polling tier
(10080 minutes, last fetched `2026-10-17T02:45Z`) — so the cadence would not have offered them a request
until **2026-10-24**, five days into a thirty-day window. `scripts/` reported eight released sources exactly
as designed, which is what made it invisible. The fix is `dueCadence()` in
[ingest.ts](../src/lib/pipeline/ingest.ts): a source whose gate reason starts `exempt` is due on the
ordinary interval; every other source keeps its tier, and the tier row is untouched so the window closing
restores the old behaviour by itself. Six cases in `ingest.test.ts`. **It cost the experiment five days of
its thirty, and item 2's window now starts with the next ingest tick rather than on 2026-10-24.**

## The order to work in

1. **Done 2026-10-19:** migration 0120 applied (eight rows), the before-record taken, and
   `npm run experiment:sources -- --on` started the 30-day window
   (**2026-10-19T06:46Z → 2026-11-18T06:46Z**) — then the cadence defect above, found by checking that the
   feeds were actually moving rather than that the command had printed them. **The next thing to read is
   `ladder now:` after the first covering window** — the acceptance is item 2 above.
2. Re-read `ladder now:` after the experiment's first window; the acceptance is item 2 above.
3. Items 1, 3 and 4 are now instruments with exit statuses — keep them green rather than re-deriving
   them. Tonight's 22:30Z build is what turns item 1 from `FAIL 6 / 13` into `PASS 13/13`.

## What must not be broken while doing it

- No model-written text reaches a reader; no core output may depend on a model call.
- Delivered archives are immutable — the seven mismatched lines in `5294a8b9` stay as delivered.
- Nothing composes on the reader request path; the readiness gate owns composition.
- The free plan stays as it is: `demand_driven_sources` and the 10 ms CPU budget are conditions, not
  defects to fix by spending.
- The palette stays three colours; `npm run ci` stays the gate before any push.
