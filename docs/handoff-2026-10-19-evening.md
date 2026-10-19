# Start here — 2026-10-19 (evening), after the reason-line and class measurements

This file records what this session landed, what it measured, and the two actions that block the loop.

## What landed

1. **Ruling #12c's exemption slice (`2edb2b7`)** — committed and pushed after a full local `npm run ci`;
   the runner's jobs, including **Deploy to Cloudflare Workers**, all read success. Migration `0120`,
   the widened `sources_to_collect`, the PGlite test (3/3), `npm run experiment:sources` — **seeded
   `enabled = false`, not applied**. Nothing is enabled and no feed moves.

2. **The reason line measured (`3b8c0c7`)** — `npm run audit:topic-attribution`
   ([reader-topic-attribution.ts](../../scripts/reader-topic-attribution.ts)) prints, per delivered card,
   the reader-visible reason, the event's labels, and what `assignTopics` produces with and without the
   headline. Population on the newest delivered set (**13 cards**): **4 reasons name a topic whose only
   evidence is one weak headline term** — #3 `Claude` via "Anthropic", #7 `AI` via "command prompt", #11
   `Chips` via "AMD", #12 `World` via "Global". Record:
   [decisions/topic-attribution-reason-lines.md](../decisions/topic-attribution-reason-lines.md), four
   numbered options, **no rule changed**.

3. **The dashboard's remaining classes counted** — `npm run audit:dashboard-classes`
   ([dashboard-class-census.ts](../../scripts/dashboard-class-census.ts)). 22,569 stored event titles;
   the landed rules refuse 21 (deal) and 12 (mod); **122 price/discount-shaped, 105 without an
   acquisition verb**, cut into 5 coupon/promo-code, 25 explicit discount, 40 price movement as the
   news, 1 review, 34 unclassified; vendor blogs 12 sources / 175 events including research posts.
   The finding: the tempting widening is **not one class** — a rule keyed on price alone would refuse
   product-launch news. Record: [decisions/dashboard-feed-first-class.md](../decisions/dashboard-feed-first-class.md).

## The two blocking actions — both cleared 2026-10-19

1. **Migration 0120 — applied** by the owner in the Supabase SQL editor. Verified: `npm run
   experiment:sources` read 8 granted rows, 0 honoured, before anything was started. The before-record
   was then taken with the clock stopped: **12,733 complete events, 169 with ≥2 publishers**, ladder
   `none 56 · coverage 3 · consequence 1`. `--on` started the window **2026-10-19T06:46Z →
   2026-11-18T06:46Z**; the gate now answers `exempt: 12c-30d` for all eight and `no demand for 50
   days` for the other 18.
   **What remains for item 2:** items delivered *after* the first covering window. Nothing to do until
   then except read `ladder now:`.
2. **The arbiter — the owner logged into Chromium**, but the agent's profile snapshot is stale and
   Hermes refuses to re-snapshot while Chromium is running. Next thread: quit Chromium fully, open
   `chatgpt.com` in the browser panel (real-profile mode will copy the fresh cookies), and post the two
   prepared requests — topic attribution (#13) and dashboard classes (#14).

## The reader bar, measured this session (live)

```
npm run audit:delivered-line     FAIL 10 / 13   (built-now counterfactual: 13)   exit 1
npm run briefing:checkpoint      ladder now: none 13                            exit 0
npm run audit:surfaces           PASS feed 47/47 · archive 27/27 · alerts 2/2   exit 0
npm run audit:alerts-gate        PASS 2 would fire, 7 withheld, 0 unfair        exit 0
```

Item 1 is one build away: no briefing has been built since `449f979`, and the next natural slot is
**22:30Z** (07:30 JST). The delivered archive is immutable; the three mismatched cards stay.

## Invariants still holding

No model writes anything a reader reads; the AI *topic* is a keyword-table category, not a feature.
Nothing composes on the reader's request path. Delivered archives are immutable. The palette is three
colours. Free-plan conditions (CPU budget, `demand_driven_sources`) are conditions, not defects.
