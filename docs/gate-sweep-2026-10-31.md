# Independent gate sweep — 2026-10-23 (sentinel)

Sweep run 2026-10-23T05:47–05:55Z by sentinel, on worktree `wt/gate-sweep` @ `72f85b7`
(= `origin/main`, fast-forwarded). Never merged by sentinel; this doc is the only diff.

## What the sweep measured against

- **Deployed build:** `72f85b7` "Merge pull request #59 from g0GobliN/wt/briefing-surface",
  merged 2026-10-23T04:49:21Z. GitHub run 39902369664: job `Deploy to Cloudflare Workers`
  succeeded 2026-10-23T04:57:15Z — that is the build live when this sweep ran. Worktree HEAD
  = deployed commit, so every audit script executed here is the deployed code.
- **The merge being verified:** PR #59 (`72f85b7`), the latest merge on `main` at sweep time.
- **`built_at` requirement:** the newest delivered briefing is
  `fab11fdf-65fb-4488-a766-01771a94efa0`, built **2026-10-22T22:55:38.672Z**.
  That predates PR #59's merge by ~5h54m and its deploy by ~6h2m. **The requirement
  "`built_at` must postdate the merge being verified" FAILS.** It also fails against every
  other merge of 2026-10-23 (the day's first merge, PR #55/`702ced7`, landed 02:19:31Z —
  still ~3h24m after the briefing was built).

---

## Gate 1 — delivered line

Command: `npm run audit:delivered-line` (exit 0)

```
ruling #11  PASS  14 / 14 card lines equal their page opening (0 defects, 3 no-deck fallback)
```

Measured: delivered briefing `fab11fdf` (status `ready`), scheduled 2026-10-22T22:30Z,
built 2026-10-22T22:55:38.672Z, 17 items. 14/14 card lines equal their page opening,
0 defects, 3 no-deck fallback headlines.

**Verdict: PASS line, 0 defects — but for the previous build, not the deployed one.**
The `built_at` check fails (see above), so this gate does not attest PR #59's output.
The first briefing the new build can produce is the next scheduled one (~22:30Z tonight);
until it is built, no delivered-row gate can read the deployed build.

## Gate 2 — significance window (ruling #12c / arbiter #17)

Command: `npm run audit:significance-window` (exit 2 — expected before the close)

```
gate 2  PENDING  window closes 2026-11-18 06:46:22Z (26d 0h away); 92 delivered item(s) recorded, no PASS or FAIL before the close  exit 2
```

Measured: ledger `docs/audits/significance-window-12c-30d.json`, window
2026-10-19T06:46:22Z → 2026-11-18T06:46:22Z from `source_exemptions` (8/8 enabled).
Population: 12 briefings generated in the window, 4 with items, 92 items, 92 distinct
events, 3 readers.

**Today's rows (2026-10-23 UTC): 0.** No briefing item has been generated today; the
newest day with rows is 2026-10-22 (17 items, digest `fab11fdf`).

- **Leg A — FAILS plainly.** Window: 3/92 carry a non-empty, story-specific line agreed
  with the ladder now (89 fail). On the newest day's rows (10-22): **0/17** — all 17 are
  rung `none` with empty lines.
- **Leg B — passes so far.** Window: 2/2 qualifying lines (both rung `consequence`,
  both traced, both attributable to Wired — one of the eight released sources), fetched
  2026-10-19 and 2026-10-20. On 10-22's rows: 0 qualifying.

Exit 2 = correct per the ruling (window open, no PASS/FAIL reported).

**Verdict: PENDING (expected). The answer the close will return unless the population
changes: Leg A FAIL (3/92; 0/17 on the newest day), Leg B PASS (2/2).**

Population observation (not a verdict change): 2 of the 4 item-bearing digests have status
`failed` (10-20 `3fcbb21c`, 10-21 `7268ba11`) and the newest is `ready` (never `sent`);
only the 10-19 digest is `sent`. 50 of the 92 items sit on `failed` digests. Read as
sent-only, the population would be 25 items — Leg A 1/25 (still fail), Leg B 1 qualifying
(still pass). Worth a ruling on whether `failed` digests are "delivered".

## Gate 3 — surfaces (feed / archive / alerts)

Command: `npm run audit:surfaces` (exit 0)

```
reader surfaces  PASS  feed 13/13 (3 no line, 0 defects) · archive 14/14 (3 no line, 0 defects) · alerts 5/5 (12 no line, 0 defects)
```

Measured: feed = newest 60 cards a reader's home feed is shown (16 cards shown, 1 gated
off before the card); archive = newest 3 delivered briefings re-rendered (17 items); alert
channel = what would fire in the last 7 days (5 fire, 12 withheld). 0 defects on all three.

**Verdict: PASS.** Re-rendered by the deployed code on live rows, so this gate reads the
new build's composition (unlike gate 1, which reads rows the old build wrote).

## Gate 4 — alerts gate

Command: `npm run audit:alerts-gate` (exit 0)

```
reader surfaces  PASS  alerts 5/5 (12 no line, 0 defects)
```

Measured: 5 stories would fire (both gates clear); 12 withheld by a gate with a reason;
0 DEFECT "fires while a gate refuses it". Withhold reasons: already alerted 21, no reader
matched 40, outside the flash window 2, readiness marketing 1, newsletter 2,
primary-source 9.

**Verdict: PASS.** Silence is doing the withholding, not hiding a breakage: every withhold
carries a reason and none fires against its gate.

## Gate 5 — topic attribution + enrichment (coverage censuses)

Command: `npm run audit:topic-attribution` (exit 0 — census, no PASS/FAIL line)

Measured: 20 delivered briefings, 455 cards examined. 1 card (0.2%) whose reason names a
headline-only topic (`Cybersecurity` — the OpenCode Console Breach card); 52 labels differ
only by the five-label cap (excluded: tie-break, not title). No verdict line is printed;
exit 0 = the census ran clean.

Command: `npm run audit:enrichment` (exit 0 — census, no PASS/FAIL line)

Measured: 1000 complete events in the 30-day window (sample cap), 1080 articles, 852
evidence rows. **Covered 563/1000 = 56.3%.** Uncovered causes, by event:
`never_attempted` 195, `extraction_empty` 85, `blocked` 70, `unreachable` 55,
`thin_content` 32. Uncovered carrying importance ≥ 7: 5. Families worth attributing: 280;
boundaries-not-defects: 157.

**Verdict for the wave: the input missing is 43.7% of events without usable evidence,
dominated by `never_attempted` (195) — the deterministic pipeline is not reaching ~20%
of events at all, and 56.3% coverage is what the significance ladder has to work from.**

---

## Adversarial findings (the falsification pass)

1. **Stale-build finding (most important):** the only gate with a hard `built_at`
   condition (delivered-line) fails that condition. Its PASS attests the briefing built
   2026-10-22T22:55:38Z by the build deployed before PR #59; the deployed build has
   produced no delivered briefing yet. Green gates on stored rows do not mean the new
   build is attested — they mean the old build was. Re-run gates 1 and 2 after tonight's
   briefing (or any briefing built after 2026-10-23T04:57Z) to attest the deployed build.
2. **Significance population mixes digest statuses** (`sent`/`failed`/`ready`) — verdicts
   survive either reading (Leg A fails, Leg B passes), but "delivered" deserves a ruling.
3. **Today's rows are zero** — nothing was generated on 2026-10-23 by sweep time, so Leg A
   and Leg B "today's rows" numbers above are the newest day's (10-22).
4. **Enrichment census caps at 1000 events** — 56.3% covers that sample, not every
   complete event.
5. **Archive drift:** `audit:delivered-line` recomposes archived rows from live event data
   (numbers can drift between runs). This sweep's numbers are one run at 05:47Z on a tree
   identical to `main`, so no branch-vs-main comparison applies.
