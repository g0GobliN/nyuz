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

## The two blocking actions

1. **Paste `supabase/migrations/0120_source_experiment_exemptions.sql` into the Supabase SQL editor.**
   No DDL credential exists in this checkout (the service-role key cannot `create table`). It seeds
   eight rows `enabled = false`. `demand_driven_sources` was read on 2026-10-19 and is **`true`**, so the
   sequence that follows will not be refused:
   `npm run experiment:sources` → `-- --on` → `npm run baseline:sources` (same day).
2. **Reach the arbiter.** The owner's Chromium profile is now the default browser and
   `browser.use_real_profile` / `browser.headed` are on, which gets past Cloudflare on `chatgpt.com` —
   but the profile's ChatGPT session **expired on 2026-09-21**, so the site opens logged out. The owner
   must log in in the visible browser window, or paste the two prepared requests (topic attribution,
   dashboard classes) into the `nyuz` project and paste the rulings back.

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
