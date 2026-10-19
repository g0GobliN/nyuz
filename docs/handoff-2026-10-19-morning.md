# Start here — 2026-10-19 (morning), after the gate-input fix

Read this, then `docs/context.md`, then `docs/reader-quality-10-of-10.md`. Nothing here is a plan the
owner has to approve; it is where the work stopped and why.

## What this session found and landed

**The only reader-facing line that was red is fixed and deployed.** The first briefing built under
ruling #11 (delivered 2026-10-18T22:41:37Z) read `FAIL 10 / 13` on `npm run audit:delivered-line`:
three cards opened on a sentence their page did not. None of it was data drift — the three events'
`last_updated_at` all precede the build. **Two producers were composing from different material:**
`loadBriefs` (the gate) handed the composer each article's `excerpt` alone, while the reader's page
(`briefing.ts` `articlesFor` → `enrichedEvidenceFor`) passes the excerpt **and** the article's
`article_evidence`, and the composer reads `enrichedEvidence`. Measured on the delivered rows: the
gate's opening equals the page's for **10 / 13** excerpt-only and **13 / 13** with the evidence
attached — the miss is exactly the three defects.

Landed in `449f979`: the gate's source rows now carry `enrichedEvidence` (same pass, no extra query),
with a failing-first test (`digest-gate-material.test.ts`). `npm run ci` green on the frozen tree
(197 files / 3394 tests, e2e 30/30); pushed and the deploy job green.

**What the fix changes for the reader, measured on the live 200-event window:** of 200 events, 167
carry enriched evidence, **123 compose a different deck when it is attached**, and of those **81
composed no deck from the excerpt alone** — i.e. at most 81 stories move from `unbriefable`-withheld to
briefable (the gate's title rungs and the Q4 why-line rule still stand in front of them), and **0 move
the other way**. That is the fix's real footprint and it is why the next briefing must be read, not
assumed.

## What is still open, in order

1. **Read the next briefing as a stranger** — it is the first built under the fix. `npm run
   audit:delivered-line` on it is what turns acceptance item 1 from `FAIL 10/13` into whatever it now
   reads; the 22:30Z slot is the next natural build (`npm run pipeline -- digest --status` to see it).
   Expect more items than last time, for the reason above.
2. **Acceptance item 2 cannot move without ruling #12c.** `briefing:checkpoint` reads `ladder now:
   none 13`; the ladder is starved by a single-publisher corpus (152 of 12,256 events have ≥2
   publishers), so the route is the ruled per-source exemption for eight sources — schema change +
   ingest gate + "the other 18 stay withheld" test + baseline re-run. **The baseline is already
   recorded** (`npm run baseline:sources`: 79 sources · 26 withheld · 153 multi-publisher); start at
   the exemption itself.
3. **Three dashboard classes measured this morning** (screenshot in the acceptance doc): a price card,
   a discount card and a first-party celebration — the 2026-10-18 ruling's remaining classes, to be
   taken one at a time with a measurement each.
4. **One topic-attribution smell:** a Windows command-prompt story reasons "You follow AI." The reason
   line is the reader's only explanation of why a story is on their page; measure before any rule.

## Update, 2026-10-19 afternoon: ruling #12c is built and waiting on one paste

Item 2 of the checklist was taken next, as this handoff said. Its four required parts exist except the last
step of the last one:

| part | state |
| --- | --- |
| auditable exemption | migration `0120_source_experiment_exemptions.sql` — one row per source, `experiment`, `reason`, a **mandatory** bounded window, seeded `enabled = false`, RLS on with no policies |
| ingest reads it | `sources_to_collect` (same signature) joins the table and answers `exempt: 12c-30d`; ingest needed no change — it prints the gate's reason verbatim |
| the other 18 stay withheld | `src/lib/pipeline/source-exemptions-db.test.ts` on PGlite: 8 released, 18 still `no demand for 50 days`, core source untouched, expiry withholds all 26 again. Fail-before shown by deleting only the exemption from the gate |
| baseline re-run after enabling | **blocked**: there is no DDL credential in this checkout (no `config.toml`, no database password, no CLI token), so 0120 is not applied and nothing is enabled |

**So the tree is green with the exemption present and off**, which is the contingency the work was given.
The one action that unblocks it is a paste of `supabase/migrations/0120_source_experiment_exemptions.sql`
into the Supabase SQL editor (it seeds eight disabled rows and changes no behaviour), followed by
`npm run experiment:sources -- --on` and `npm run baseline:sources`. The same-day baseline before starting,
measured read-only on 2026-10-19: 79 active sources, 26 withheld, all eight present; 12,620 complete events,
**161 with ≥2 publishers**; ladder over the newest 60 live events none 59 · consequence 1.

**Acceptance line 1 has not had its first chance yet.** No briefing has been generated since `449f979`: the
newest delivered build is still 2026-10-18T22:41Z, and today's 07:30Z rows are `scheduled` with
`generated_at` null — the recorded free-plan CPU-kill condition, not a new defect. The next natural build
is 22:30Z, and `npm run audit:delivered-line` (exit status captured) is what reads it.

## Boundaries that do not move

No model-written text reaches a reader; delivered archives are immutable; nothing composes on the
reader's request path; the free plan (10 ms CPU budget, `demand_driven_sources`) is a condition, not a
defect; the palette stays three colours; `npm run ci` stays the gate before any push.

## Land it the standard way

`npm run ci` green (typecheck, lint, the suite with coverage, the coverage floor, build, PWA, route
walk, origin self-test, Playwright), then commit, push, and confirm the runner's Deploy job — a red
push is not a deployed change. Update `docs/context.md` in the same commit as the change it describes.
