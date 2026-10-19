# Start here — 2026-10-19 (late), after rulings #13, #14, #15 and #16

This file replaces the earlier evening handoff. It records the session's four rulings, what landed, what
is running, and what a fresh thread should do first.

## Landed and deployed

| commit | what |
| --- | --- |
| `edcb294` | **Rulings #13 and #14.** `assignTopics` needs two distinct weak terms in a headline before weak-evidence labels a story (the "Windows command prompt → You follow AI." defect); `isCouponPageTitle` refuses the coupon/promo-code publishing frame on the dashboard feed. 24 corpus titles refused, none out of scope; the measured digest went 4 flagged → 0. |
| `51aa616` | **Ruling #15.** Five promise-level copy corrections: languages are English-only on every page, Telegram is plan-dependent, support stops telling Uno readers to set a custom delivery time, acceptable-use drops the seat entitlement, and the operator is "Vishal Gurung". The ruling's sweep requirement found the same language promise in three more places. |
| `34f3fc4` | **Ruling #16.** The providers table names "DeepSeek (the default AI provider)" and its region as "China for the default configuration…". |
| `0abf9ad` | The handoff and `docs/context.md`'s session-start pointer. |
| `ddaae18` | **The experiment was running and inert — fixed.** All eight exempted sources sat on the `paused` polling tier (10080 minutes, last fetched 2026-10-17T02:45Z), so the cadence would not have offered them a request until 2026-10-24 while the gate answered `exempt: 12c-30d` for each. `dueCadence()` now makes a source whose gate reason starts `exempt` due on the ordinary interval; the tier row is untouched, so the window closing restores the old behaviour by itself. Six cases in `ingest.test.ts`. |
| (in flight) | The mechanical copy pass #15 kept separate (see "What is still open"). |

## Running, and what reads it

- **Ruling #12c's source experiment** is live: window **2026-10-19T06:46Z → 2026-11-18T06:46Z**, eight
  sources released, the gate answering `exempt: 12c-30d`. Before-record, taken with the clock stopped:
  **12,733 complete events, 169 with ≥2 publishers**, ladder `none 56 · coverage 3 · consequence 1`.
  **Item 2's acceptance is items delivered after the first covering window** — read `ladder now:` then, not
  before.
- **Item 1** waits for a briefing with content: today's 07:30Z builds both came out `skipped`, 0 items, no
  failure (the honest quiet-day path). The owner's next slot is 22:30Z. `npm run audit:delivered-line`
  reads the newest delivered briefing; with 0 items it reports `N/A`, which is not a pass.

## The reader bar, as measured this session

```
npm run audit:delivered-line     FAIL 10 / 13 on the 2026-10-18 build (built-now counterfactual 13)
npm run briefing:checkpoint      ladder now: none 13
npm run audit:surfaces           PASS
npm run audit:alerts-gate        PASS
npm run audit:topic-attribution  0 flagged of 427 cards (after #13); 49 labels differ only by the cap
npm run audit:dashboard-classes  21 deal + 12 mod + 24 coupon refused, every one in its class
```

## The arbiter is reachable now

`chatgpt.com` works from the browser panel: Chromium is the default browser, `browser.use_real_profile`
and `browser.headed` are on, and the owner's session is live. Four rulings came back this session this
way. Requests are posted by opening the `nyuz` project and using `Input.insertText` + `Enter` — the daemon
times out under load (a CI run on the same machine), so post when the machine is idle, and restart the
daemon if `page_info()` starts failing.

## What is still open

1. **The mechanical copy pass** the #15 ruling kept separate — **done and pushed on 2026-10-19**: one page
   now has one name (Service providers, everywhere it is shown), the pricing caption reads "At least 2
   months free on an annual plan." while staying derived, the landing page says "five stories or fewer"
   against the five-story cap, the density dial labels all four bands over the track each owns, and the
   brand is lowercase. Record: [decisions/public-site-copy-audit.md](../decisions/public-site-copy-audit.md).
2. **Item 1's evidence** — the first build with content after `449f979`. Today's builds were honest
   quiet-day skips (0 items); the reader's next slot is 22:30Z.
3. **Item 2's evidence** — after the experiment's first covering window. **The clock actually starts with
   the first ingest tick after `ddaae18` deployed (2026-10-19T08:45Z)**, not at 06:46Z, because of the
   cadence defect above; read `ladder now:` after coverage from the eight arrives and is delivered.
4. **The unresolved NTT opening** in [decisions/context-openings.md](../decisions/context-openings.md):
   ruled "repair or record", it is recorded, and the audit still counts block openings rather than
   paragraph openings.

## Invariants

No model writes anything a reader reads; the AI topic is a keyword-table category, not a feature. Nothing
composes on the reader's request path. Delivered archives are immutable. Three colours. Free-plan
conditions are conditions, not defects. `npm run ci` is green before every push, and a red push is not a
deployed change.
