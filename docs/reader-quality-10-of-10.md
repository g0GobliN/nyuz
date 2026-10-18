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
| 1. Delivery | contract landed and deployed; the delivered briefing that exists predates it (`FAIL 6 / 13`, 7 defects) | `npm run audit:delivered-line` |
| 2. Significance | **fails**: `ladder now: none 13`, 12 of 13 items silent, 1 stored line kept verbatim | `npm run briefing:checkpoint` |
| 3. Other surfaces | **unmeasured** | — |
| 4. Alerts | not assessed since the pool changed | `npm run audit:alerts` (exists) |

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

## The order to work in

1. Wait for ruling #12; land the smallest slice matching it (the SQL/report change is a bounded edit to
   `priority_articles_to_cluster` plus a bounded drain loop), then re-read `ladder now:`.
2. Whatever that ruling says about single-source stories, the acceptance is item 2 above: a line, or no
   item. A briefing of three explained stories beats thirteen silent ones.
3. Instrument the other surfaces (item 3) with the same shape as `audit:delivered-line`: one verdict
   line, exit status as the check.
4. Re-read the alert side (item 4).

## What must not be broken while doing it

- No model-written text reaches a reader; no core output may depend on a model call.
- Delivered archives are immutable — the seven mismatched lines in `5294a8b9` stay as delivered.
- Nothing composes on the reader request path; the readiness gate owns composition.
- The free plan stays as it is: `demand_driven_sources` and the 10 ms CPU budget are conditions, not
  defects to fix by spending.
- The palette stays three colours; `npm run ci` stays the gate before any push.
