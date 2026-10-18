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
| 1. Delivery | contract landed and deployed; the delivered briefing that exists predates it (`FAIL 6 / 13`, 7 defects; `13/13` if built now) | `npm run audit:delivered-line` |
| 2. Significance | **fails**: `ladder now: none 13`, 12 of 13 items silent, 1 stored line kept verbatim; under the withhold rule **0 of 13 items would survive** | `npm run briefing:checkpoint`, `npm run briefing:withhold-preview` |
| 3. Other surfaces | **measured, green**: feed `57/57` card lines admitted by the shared boundary (3 gated off before the card), archive `14/14`, 0 defects — but ruling #11's contract is *not* enforced there: `9/57` and `7/14` card lines equal their page opening (counterfactual, not enforced) | `npm run audit:surfaces` |
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

## The order to work in

1. **Implement ruling #12c** (ruled 2026-10-18, per-source exemption for eight sources, 30 days,
   three acceptance conditions, baseline recorded in `docs/decisions/reader-delivery.md`). That is the
   only unblocked route to item 2: the significance rung needs a second outlet per story, and the
   corpus has been measured to lack one.
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
