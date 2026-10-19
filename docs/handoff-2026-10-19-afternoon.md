# Start here — 2026-10-19 (afternoon), after the gate-input fix

This file records what landed in this session and what the next thread must do.

## What this session landed

1. **Gate input fix** — `src/lib/pipeline/digest.ts` now passes `enrichedEvidence` to the gate the same way the reader's page does (`articlesFor` → `enrichedEvidenceFor`). Measured on delivered rows: **10/13 → 13/13**. Fail-before proven by `digest-gate-material.test.ts`: removing only the new attachment line makes the test fail (`"the story the page can open was withheld"`). Full local `npm run ci` green on the frozen tree (197 files / 3394 tests, coverage floor, route walk 23/23, e2e 30/30, EXIT 0). Pushed `449f979`.

2. **Ruling #12c exemption built and tested** — Migration [`0120_source_experiment_exemptions.sql`](../../supabase/migrations/0120_source_experiment_exemptions.sql) adds `source_exemptions` table (one row per source: `experiment`, `reason`, mandatory bounded window, seeded `enabled = false`, RLS on, no policies, check constraint makes open-ended window impossible). The gate `sources_to_collect` widened by one lateral join, answers `exempt: 12c-30d` for released sources instead of `no demand for N days`. Ingest needed no change — it has always printed the gate's reason verbatim. PGlite test [`source-exemptions-db.test.ts`](../src/lib/pipeline/source-exemptions-db.test.ts) proves exactly the eight are released and the other 18 stay withheld and expiry withholds all 26 again.

3. **Baseline re-measured** — `npm run baseline:sources` this morning (2026-10-19) on a database that has the table but no rows enabled: **79 active sources, 26 withheld**, all eight exemptions present and `enabled = false`, **12,620 complete events**, **161 with ≥2 publishers** (the 2026-10-18 record was 153; the number grows on its own, so the comparison must be against a run taken the same day the experiment starts), ladder over the newest 60 live events: **none 59 · consequence 1**.

4. **Commands added** — 
   - `npm run experiment:sources` (`scripts/source-experiment.ts`) — status / `--on` / `--off`; refuses if `demand_driven_sources` is off; prints the gate's answer afterwards.
   - `npm run baseline:sources` now includes block 1b printing every granted row with its window and the gate's own answer, and reports `not applied on this database` when the table is absent.

5. **Docs updated** — 
   - `docs/decisions/reader-delivery.md` — ruling #12c section expanded with built/verified/off state and the four-part audit.
   - `docs/reader-quality-10-of-10.md` — item 2 now says the exemption is built, tested, deliberately off, and the only remaining step is a paste into the SQL editor (this checkout has no DDL credential).
   - `docs/context.md` — same; next thread knows the exemption waits for a SQL-editor paste.
   - `docs/handoff-2026-10-19-morning.md` — completed and pushed.
   - `docs/handoff-2026-10-19-afternoon.md` — this file.
   - `package.json` — added `"experiment:sources"` script.

## What the next thread must do

**One action only, in this order:**

1. **Paste migration `supabase/migrations/0120_source_experiment_exemptions.sql` into the Supabase SQL editor.** It seeds eight rows `enabled = false` and changes no behaviour. (No DDL credential exists in this checkout; this is a manual step.)

2. **Run `npm run experiment:sources -- --on`.** This seeds `enabled = true`, `starts_at = now()`, `ends_at = now() + 30 days` and prints the gate's own answer for each source — the same function ingest calls. The ruling forbids flipping `demand_driven_sources` globally; this command refuses if that flag is off.

3. **Run `npm run baseline:sources` immediately after.** This records the same-day before state: source config, 152/161 multi-publisher events, ladder, and the withhold preview count. The acceptance comparison is like-for-like: baseline taken this day vs. baseline taken after the 30-day window.

4. **After the 30-day window closes (or earlier, by running `npm run experiment:sources -- --off`), re-read item 2.** The significance rung needs a second outlet per story. The acceptance is measured on items delivered *after* the first covering window. Report: did the eight newly released sources produce at least one future delivered briefing item with a non-coverage ladder line? That is the yes/no that moves item 2.

## State integrity

- The tree is green with the exemption present and off — `npm run experiment:sources` reports `Migration 0120 is not applied on this database`, and no feed moves. This is the contingency the work was given.
- No model-written text reaches a reader; delivered archives are immutable; nothing composes on the reader's request path.
- The free plan (10 ms CPU budget per Cron Trigger, `demand_driven_sources`) is a condition, not a defect.
- The palette stays three colours.

## Files changed in this session (for the next thread's diff)

- `src/lib/pipeline/digest.ts` — gate now reads `enrichedEvidence` same as page
- `src/lib/pipeline/digest-gate-material.test.ts` — fail-before test
- `src/lib/pipeline/source-exemptions-db.test.ts` — new test (3 passing)
- `supabase/migrations/0120_source_experiment_exemptions.sql` — new migration
- `scripts/source-experiment.ts` — new start/stop/status command
- `scripts/source-experiment-baseline.ts` — baseline now prints exemption block
- `package.json` — added `experiment:sources` script
- `docs/decisions/reader-delivery.md` — expanded ruling #12c section
- `docs/reader-quality-10-of-10.md` — item 2 updated
- `docs/context.md` — updated 7. What is next
- `docs/handoff-2026-10-19-morning.md` — completed
- `docs/handoff-2026-10-19-afternoon.md` — this file
- `AGENTS.md` — no change needed

## Next thread's first command

```
npm run experiment:sources
```

(Then paste 0120 into SQL editor, then --on, then baseline:sources.)