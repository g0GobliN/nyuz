# Briefing delivery time — the build is already per-reader; the lateness is the defect

Measured 2026-10-21 against the live project, read-only: no product code, no migration, no deploy.
This is a **decision record**, not an implementation. It answers the question _"the briefing is built
once at 22:30Z — should it be built more often, per reader, or composed at read time?"_ and the answer
starts by correcting the premise:

> **There is no single 22:30Z build.** The scheduler creates one briefing per reader per day, at
> `send_at` interpreted **in the reader's own timezone** (`digest.ts:587-601` via `schedule.ts:39`).
> 22:30Z is one reader's 07:30 in Tokyo. The pipeline is already option B; what it lacks is not a
> schedule but a timezone default.

The rest of this file is the evidence for that sentence, the cost of one build today, all four options
priced, and the one number that has to move before any of them is worth building.

---

## 1. The premise, checked against the code and the live rows

### What the code does today

| where                                | what it does                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/pipeline/cron.ts:167`       | `DIGEST_CRON = "* * * * *"` — one digest invocation per minute, its own trigger                                                                                             |
| `src/lib/pipeline/digest.ts:554-620` | `scheduleUpcoming` pages every `notification_preferences` row and writes a `digests` row per active reader with `scheduled_for = nextSlot({sendAt, timezone, days})`        |
| `src/lib/pipeline/digest.ts:591`     | `sendAt: PLAN_LIMITS[plan].customDeliveryTime ? row.send_at : STANDARD_DELIVERY_TIME` — paid plans choose their hour, free plans are pinned to `07:30` (**local**, not UTC) |
| `src/lib/pipeline/schedule.ts:39`    | `nextSlot` resolves `07:30` in the reader's IANA zone to a UTC instant, with `utcFromZoned`                                                                                 |
| `src/lib/launch-plans.ts:59`         | `STANDARD_DELIVERY_TIME = "07:30"`                                                                                                                                          |
| `supabase/migrations/0082:7-12`      | `enforce_launch_preferences` raises if a non-entitled plan writes a custom `send_at`                                                                                        |

So the shape is: **one digest row per reader per day, composed for that reader, at an instant computed
from their zone.** There is no global briefing artifact to "build once"; selection is per reader
(`selectItems` reads `user_events`), the gate is per reader, and the items reference events by id.

### What the live data says

`notification_preferences` + `subscriptions` + `nextSlot`, exactly as `scheduleUpcoming` computes them
(measured 2026-10-21T03:02Z, all three rows, no filters):

| measure                                           | value                                                       |
| ------------------------------------------------- | ----------------------------------------------------------- |
| profiles / preference rows / subscription rows    | 3 / 3 / 3                                                   |
| plans                                             | 2 uno, 1 omni                                               |
| stored `send_at`                                  | `07:30:00` × 3                                              |
| stored `timezone`                                 | `UTC` × 2, `Asia/Tokyo` × 1                                 |
| reader's own clock at their next slot             | **07:30 for 3 of 3**                                        |
| distinct next-slot UTC instants                   | **2** — `07:30Z` (×2) and `22:30Z` (×1)                     |
| readers with any briefing item in the last 7 days | **1** of 3 (`640a69b6`, Tokyo: items `0,0,1,13,13,25,25,0`) |

Two consequences, both material to the decision:

1. **The worldwide failure the question describes does not exist in the data yet.** Every live reader's
   slot lands on 07:30 _local_. The 22:30Z instant belongs to the only reader whose zone is Tokyo and
   whose pool produces cards; that is why the build "happens at 22:30Z", not because the schedule is
   global.
2. **The one place the timezone can be wrong is signup, and it is.** `handle_new_user`
   (`0001_init.sql:263`) inserts `notification_preferences` with the column default
   `timezone text not null default 'UTC'` (`0001_init.sql:38/55`). The browser's zone is only written
   when onboarding saves it (`prefs-store.ts:76-85`). A reader who signs up and stops before the
   schedule step is scheduled at 07:30 **UTC** — the exact "hour they will never read it" the question
   is about, produced by a missing default rather than by the build time. Two of the three live rows
   read `UTC`; both are zero-item accounts, so whether they are genuinely in UTC or merely
   un-onboarded cannot be told apart from the rows (see §8).

### How many delivery instants a 07:30-local briefing actually produces

Not three bands — **35**. Measured with `Intl.supportedValuesOf("timeZone")` over all 418 IANA zones
(2026-10-21T03:08Z, script in §9): **37 distinct UTC offsets**, which produce **35 distinct UTC clock
times per day** for a 07:30-local slot (two pairs collide: `+14:00`/`−10:00` both read `17:30Z`, and
`+13:00`/`−11:00` both read `18:30Z`, one calendar day apart), and the same 35 on the gate-2 close date
2026-11-18. The clusters are real but finer than APAC/EMEA/AMER: `+2.00` carries 50 zones, `-4.00` 47,
`+3.00` 42; the median offset carries **6**.

**A three-band design is a coarsening of what the scheduler already does.** It would merge 35 instants
into 3 and move most readers off their own 07:30 — a reader in Kathmandu (+5:45) would be served at
either 02:30Z or 22:30Z instead of 01:45Z, which is 07:30 local.

---

## 2. What one build costs today

### The cited run

`digests.digest_id = 3fcbb21c-b551-49d9-93f9-46b3f8b2bd74`, reader `640a69b6` (Tokyo), slot
`2026-10-20T22:30:00Z`:

| fact                                                               | value                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| generation started (`generation_started_at`)                       | `2026-10-20T22:20:33.874Z` (T−9m26s — the 10-minute prepare window)                                                   |
| generation completed (`generated_at`)                              | `2026-10-20T22:55:38.736Z`                                                                                            |
| wall clock to build                                                | **2,105 s = 35m05s**                                                                                                  |
| first delivery (`push`, `delivered_at`)                            | `2026-10-20T22:55:43.267Z`                                                                                            |
| lateness vs the promised slot (`briefing_timing.lateness_seconds`) | **1,543 s = 25m43s**                                                                                                  |
| rows written                                                       | 1 `digests`, 25 `digest_items` (25 distinct events), 2 `deliveries`                                                   |
| delivery outcome                                                   | push `sent` (1 attempt); email `failed`, `Resend 401` — **expected**, the channel is off until launch by owner ruling |

The three builds before it read `1,722 s`, `702 s` and `1,789 s` late; 25-minute lateness is the norm for
this reader, not an incident.

### CPU, measured on the same pool

`npm run timing:read-path -- --user 640a69b6 --runs 3`, Node 22, 2026-10-21T03:03Z. This instrument
wraps each build phase in `process.cpuUsage()`; it is an **upper bound** relative to a Worker isolate
(`scripts/reader-read-path-timing.ts:15-21`).

| phase                                  | CPU            | note                                                                 |
| -------------------------------------- | -------------- | -------------------------------------------------------------------- |
| select · `loadMatches`                 | 51.6 ms        | 1,000 live matches                                                   |
| select · `alreadyBriefed`              | 36.0 ms        |                                                                      |
| select · `selectItems`                 | 37.6 ms        | 183 eligible → 37 considered                                         |
| select · `suppressDeliveredDuplicates` | **853.4 ms**   | the single largest select cost                                       |
| screen · `loadBriefs`                  | 73.7 ms        |                                                                      |
| screen · `suppressStoryTwins`          | 31.3 ms        | 37 → 33                                                              |
| screen · `suppressDeliveredTwins`      | 61.4 ms        |                                                                      |
| screen · `deliveredTwinTitles`         | 17.8 ms        |                                                                      |
| compose · `selectReaderEvidence`       | **1,537.5 ms** | one pass; the gate runs this twice                                   |
| gate · `assessReadiness`               | **5,832.4 ms** | 33 briefs: median **131.6 ms**, p95 **498.7 ms**, worst **508.3 ms** |
| write · payload                        | 157.3 ms       | 5,859 bytes                                                          |
| **total**                              | **8,690.0 ms** | the phase rows sum to it exactly                                     |

Two facts follow from the table, and both matter more than the time zone:

- **The gate is 67% of a build**, and its per-brief distribution is wide: the median would allow five
  briefs in one tick against the ~710 ms grace, the p95 allows **one**.
- **The gate's per-brief cost regrew 7.3× since 2026-10-16** (median 131.6 ms vs 18 ms; worst 508.3 vs
  435 ms). The cause was already attributed in `docs/context.md` (2026-10-21 entry): commit `449f979`
  attached `article_evidence` to the gate's sources, and the same 33 briefs gate in 2.9–4.7 s at a 7–16 ms
  median without it. This file does not re-litigate that; it prices the consequence.

### The digest stage around it

`pipeline_runs`, last 48 h (2026-10-19T03:02Z → 2026-10-21T03:02Z):

| measure                                    | value                                             |
| ------------------------------------------ | ------------------------------------------------- |
| digest invocations                         | 2,883 (one per minute, as `DIGEST_CRON` declares) |
| finished / still `running` (killed)        | 2,880 / **15** (~7.5 kills/day)                   |
| wall seconds, finished runs                | median 1.78, p90 3.13, max 162.78                 |
| runs that considered or processed anything | 75 (~37/day)                                      |

A tick with nothing due costs ~1.8 s of wall clock and almost no CPU; the spend is entirely in the ~37
ticks a day that advance a build.

---

## 3. The arithmetic that explains the lateness

Nothing here is about the hour of the day. It is about how many ticks a build needs:

```
33 briefs to gate (37 considered, 33 after twins)
÷ 1 brief per invocation (GATE_BRIEFS_PER_INVOCATION = 1, digest.ts:855)
= 33 gate ticks
+ 1 select + 1 screen + 1 write
= ~35 ticks
start at T−10 minutes (PREPARE_LEAD_MINUTES, digest.ts:128)
=> finish at T+25 — measured 35m05s, delivered 25m43s late
```

`GATE_BRIEFS_PER_INVOCATION = 1` is deliberate: the comment at `digest.ts:819-853` records that a
killed tick persists nothing, so a pair that overruns the grace is retried forever. The trade it accepts
is stated there — _"a 25-story briefing becomes about forty gate ticks, so it arrives twenty to forty
minutes after its slot instead of never"_ — and the arbiter ruled that acceptable on 2026-10-16 while the
alternative was no briefing at all.

**That trade is now the delivery-time constraint.** Any option that adds builds (A) or moves them (D)
multiplies or shifts a build that already finishes 25 minutes after its own deadline. The delivery hour
is not the defect; the ticks-per-build is.

### The fan-in ceiling, which is what "worldwide launch" actually hits

`BATCH = 8` (`digest.ts:81`) due digests advance **in parallel in one invocation**, one brief each. Their
CPU adds up inside the same ~710 ms grace:

| concurrent builds in a tick | CPU at the measured median (131.6 ms/brief) | against ~710 ms                                       |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| 1                           | 131.6 ms                                    | fits                                                  |
| 5                           | 658.0 ms                                    | fits, barely                                          |
| 8 (the batch size)          | 1,052.8 ms                                  | **343 ms over — a kill, and a kill persists nothing** |

So the number of readers who can share a delivery instant is **5 at the median and 1 at the p95**. Since
each reader's instant is their own 07:30, the day has at most 35 clock times (37 offsets across two
calendar dates), which puts the pipeline's present capacity at roughly:

```
1 concurrent  × 35 instants  =  35 readers/day at the p95 brief
5 concurrent  × 35 instants  = 175 readers/day at the median brief
builds/day overall: 1440 ticks ÷ ~35 ticks/build × concurrency = 41 … 205
```

This is the launch number that matters, and **timezone bands cannot raise it**: a band is an instant,
and the instants already exist. Only per-brief CPU can raise it.

---

## 4. The four options, measured

Costs are for the live corpus (3 readers, one of them carrying 33 briefs); rows per reader-build are
1 `digests` + up to 25 `digest_items` + up to 2 `deliveries`.

|                                        | builds/day (today)                                            | distinct instants   | CPU per build         | storage rows                        | cost multiplier                                                    | reader-visible latency                               | gate touched         |
| -------------------------------------- | ------------------------------------------------------------- | ------------------- | --------------------- | ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | -------------------- |
| **A. Timezone bands** (APAC/EMEA/AMER) | 3 (unchanged — one per reader)                                | 3, replacing 35     | 8.69 s                | ~28                                 | **1.0× CPU, −32 instants**: coarser than today; no saving anywhere | unchanged, 25m43s late                               | 1 (Delivery)         |
| **B. Per-user schedule**               | 3, at 2 instants                                              | 35 possible; 2 live | 8.69 s                | ~28                                 | 1.0× — **already the shipped design**                              | unchanged today; the only option that spreads fan-in | 1 (Delivery)         |
| **C. Read-time composition**           | 0 scheduled, 3 request-time                                   | n/a                 | 8.69 s per first open | new cache keyed by reader event set | 1.0× CPU, on a **10 ms** request budget = **869× over**            | first open blocks; Worker kills it                   | 1 + the request path |
| **D. One build, different time**       | 3 (a shared artifact is impossible — selection is per reader) | 1                   | 8.69 s                | ~28                                 | 1.0×                                                               | moves the Tokyo reader by up to ±12 h; Delhi by ±3 h | 1 (Delivery)         |

Notes that decide between them:

- **A saves nothing.** Composition is per reader because selection is per reader (`user_events`,
  `user_topics`, `user_exclusions`, `user_source_prefs`). A band build still composes one briefing per
  reader; all it changes is how many readers share an instant — and the scheduler already derives that
  from the zone.
- **B is not a change; it is the current code.** What is missing for it to be _true for every reader_ is
  the signup timezone default (§1), not scheduling logic.
- **C is arithmetically dead.** One build is 8,690 ms of CPU; a Worker request gets ~10 ms. Even a
  perfect cache would miss for every reader, because the cache key is the reader's own event set
  (3 readers → 3 distinct digests today; `digest_items` holds 1,250 rows over 1,249 distinct events).
  It also crosses a recorded invariant: _"Nothing composes on the reader request path; the readiness
  gate owns composition"_ (`reader-quality-10-of-10.md:245`).
- **D is not one build.** There is no shared artifact to move; only the instant could be shared, and
  pinning everyone to one instant is exactly what A already does better.

---

## 5. The three checks the task asked for

**The ~710 ms CPU grace.** Passes today only because one build advances per tick. The ceiling is
5 concurrent at the median, 1 at the p95, 8 per batch — so `BATCH = 8` readers on one instant is
already over budget on paper. Any band design that concentrates readers _more_ than their own zone
does (A with 3 coarse bands) makes the fan-in worse, not better.

**The no-per-user-copies rule.** Holds, and nothing here touches it: `digest_items` references
`event_id`, 1,250 item rows cover 1,249 distinct events, and `event_impacts`/`event_translations` stay
global. C would add a cache, not a copy; A, B and D add no content rows at all.

**The 30-day significance window (gate 2).** Splitting builds does **not** break it, for three reasons
that are checkable in the live rows:

1. The window is read from `source_exemptions`, not from a literal — 8 enabled rows,
   `2026-10-19T06:46:22Z → 2026-11-18T06:46:22Z`, verified live.
2. The population is enumerated as `digests` with `kind='briefing'` and `generated_at` inside the window,
   plus their `digest_items` (`scripts/significance-window-audit.ts:340-355`). Splitting changes _when_
   a reader's one briefing is generated, not how many rows it has.
3. `enforce_daily_briefing` (`0082:98-117`) refuses a second briefing per reader per account-local date,
   so no band scheme can duplicate a reader's population.

Two edges, both stated rather than waved away: a build moved across `2026-11-18T06:46:22Z` changes
whether that day's items are counted (one day, bounded), and a band that shifts a slot across local
midnight could interact with the account-local date rule — not reachable at 07:30 local, but a custom
`send_at` near 00:00 (paid plans) is the case to test if a band is ever built.

---

## 6. Recommendation

**Keep B — one build per reader, at 07:30 in the reader's own zone — as the delivery-time answer, and
do not build bands.** B is already the shipped scheduler, so the work this decision authorises is not a
build system: it is the two things that make B true and fast enough to survive launch.

1. **Capture the zone at signup** instead of defaulting to `'UTC'` (`0001_init.sql:263` /
   `0001_init.sql:38/55`). Until that is fixed, "every reader gets their own brief" is true only for
   readers who finished onboarding. This is the only _timezone_ defect the live data supports.
2. **Treat the 25-minute lateness as the delivery defect it is** before adding any instant. At one brief
   per tick the build cannot finish inside its own 10-minute lead, whatever hour it starts.

**The acceptance number it must move:** `briefing_timing.lateness_seconds ≤ 600` on the next real
22:30Z build (measured today: **1,543 s**), with the gate's per-brief **p95 ≤ 140 ms** as the mechanism
number (measured today: **498.7 ms**), because 140 ms is what lets five briefs share the grace and so
lets a single 07:30 instant carry more than one reader.

Both numbers are read by commands that already exist (`npm run briefing:timing`,
`npm run timing:read-path`), so the decision is falsifiable without inventing an instrument.

---

## 7. The lines that would change — named, not changed

| file:line                                             | why it is the seam                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/pipeline/digest.ts:591`                      | where `send_at` is chosen per plan — a band map would replace `STANDARD_DELIVERY_TIME` here                |
| `src/lib/pipeline/digest.ts:587-601`                  | `nextSlot` call and `scheduled_for` write — the only place an instant is decided                           |
| `src/lib/pipeline/digest.ts:81`                       | `BATCH = 8` — the fan-in per tick, the number the CPU ceiling actually caps                                |
| `src/lib/pipeline/digest.ts:855`                      | `GATE_BRIEFS_PER_INVOCATION = 1` — the ticks-per-build, and therefore the lateness                         |
| `src/lib/pipeline/cron.ts:167`                        | `DIGEST_CRON = "* * * * *"` — the tick stream every option spends                                          |
| `src/lib/pipeline/schedule.ts:39`                     | `nextSlot` — correct as written; **no change needed** for any option                                       |
| `src/nitro/scheduled.ts:46-50`                        | passes `controller.cron` and `scheduledTime` through — **no change needed**                                |
| `supabase/migrations/0001_init.sql:263`, `:38`, `:55` | the signup row and the `'UTC'` default — the actual fix in recommendation 1                                |
| `src/lib/prefs-store.ts:76-85`                        | where the browser zone is adopted, i.e. the path that currently has to run for the default to be corrected |

No file above was modified by this measurement.

---

## 8. What we cannot know without a real run

- **The Worker's own `cpuTimeUs` for these phases.** Everything in §2 is `process.cpuUsage()` on Node 22,
  an upper bound. The Worker figures recorded on 2026-10-11 remain the only direct CPU evidence, and the
  ~710 ms grace is derived from them.
- **Which CPU limit this Worker actually has.** `cpu-killed-invocations.md` records this as still open: a
  custom `cpu_ms`, the Free 10 ms Cron Trigger budget, and a legacy 50 ms limit all fit the observed
  kills, and the deployed Worker's settings do not expose `limits` to the token available here. Every
  fan-in ceiling in §3 is a fraction of the ~710 ms **observed tolerance**, not of a configured
  allowance; a genuinely enforced 10 ms budget collapses them all to nothing.
- **Whether a two-brief gate tick survives.** 2 × p95 = 997 ms predicts a kill; a kill persists nothing,
  so the prediction can only be tested by deploying the change and reading the run — not locally.
- **The real timezone mix of launch traffic.** Three accounts, one with a non-empty pool. There is no
  measured worldwide readership to size bands against; the 35 instants are arithmetic, not demand.
- **Whether the two `UTC` readers are genuinely in UTC or un-onboarded.** Both have zero items every day,
  so the difference is invisible in the product today — but it is the difference between "the default is
  harmless" and "the default is the bug".
- **The cost of a reader's first build in a new zone.** The two empty-pool readers build in ~1.9 s of
  wall clock; no CPU figure was taken, and a first build includes the cold select over 1,000 matches.
- **Gate 2's verdict.** The window closes `2026-11-18T06:46:22Z`; the reading above says splitting is
  neutral on the rows visible now, but the ledger is 28 days short of a verdict.

---

## 9. How to reproduce every number here

```bash
nvm use 22
# readers, zones, instants, digests, pipeline_runs, deliveries (read-only scripts held outside the repo)
node --env-file=.env scripts/tsrun.mjs <measure-script>.ts

# the build's CPU, phase by phase, on the live pool
npm run timing:read-path -- --user 640a69b6 --runs 3

# lateness of every real briefing
npm run briefing:timing -- --days 14

# the 35 clock times: Intl.supportedValuesOf("timeZone") → distinct offsets at a 07:30-local slot
node <bands-script>.mjs
```

Sources for the recorded numbers this file did not re-measure: `docs/context.md` (2026-10-16 CPU repair,
2026-10-21 gate regression attribution), `docs/decisions/cpu-killed-invocations.md` (§3 kill line and the
open limit question), `docs/decisions/significance-window-instrument.md` (gate 2's population),
`docs/reader-quality-10-of-10.md` (the request-path rule and item 1's bar).
