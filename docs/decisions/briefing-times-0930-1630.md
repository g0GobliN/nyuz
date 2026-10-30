# Briefing times: 09:30 and 16:30, every day — the ruling and what it changed

**Ruled by the owner, 2026-10-30, twice in one hour:**

> "No change the time 9:30am and 4:30pm"

> "change 7:30 to 9:30 and 20:30 to 16:30 thats all permanently everyday."

No case had to be put to the arbiter: the owner stated the outcome, twice, and the
second statement names the old values it replaces. This file records the ruling,
the measured state it landed against, and the decisions the implementation had to
make that the ruling did not spell out — so a later session can see which parts
were the owner's words and which were engineering.

## What the product promises now

Two briefings a day, in the reader's own zone, seven days a week, on every plan:

| slot    | clock (reader's zone) | source of truth                                      |
| ------- | --------------------- | ---------------------------------------------------- |
| morning | 09:30                 | `STANDARD_DELIVERY_TIME` in `src/lib/launch-plans.ts` |
| evening | 16:30                 | `EVENING_DELIVERY_TIME` in `src/lib/launch-plans.ts`  |

`BRIEFING_SLOTS` is the array of both, and `deliveryTimesFor(plan, sendAt)` is
the only function that builds a reader's day. Nothing else computes a slot time,
and no page writes a clock it did not read from there.

## Measured state before the change (2026-10-30, live DB, `aws-0-ap-southeast-1` pooler)

```
digests (kind=briefing, status=scheduled, scheduled_for > now)
  0b922417…  UTC          2026-10-30T07:30:00+00:00   local 07:30
  73384572…  UTC          2026-10-30T07:30:00+00:00   local 07:30
  640a69b6…  Asia/Tokyo   2026-10-30T22:30:00+00:00   local 2026-10-31 07:30

notification_preferences: 3 rows, send_at 07:30:00 for all three,
  days [1,2,3,4,5] for the two UTC readers, [1..7] for the Tokyo reader
subscriptions: uno, uno, omni
```

Three facts that were wrong, in the order they matter:

1. **One slot a day.** `scheduleUpcoming` wrote one row per reader per tick, so
   the evening edition the product's copy implied did not exist at all.
2. **07:30, not 09:30.** The default was `07:30` in `prefs.ts`, `launch-plans.ts`
   and `standard_delivery_time()` in SQL, and the stored rows carried it.
3. **Five days a week.** `DEFAULT_PREFS.days` was Mon–Fri, so Saturday and
   Sunday had no rows — and the DB trigger `enforce_daily_briefing` refused a
   second briefing on the same local day, which would have rejected the evening
   edition even if the scheduler had written it.

## What changed

### Scheduling (TypeScript)

- `src/lib/launch-plans.ts` — `STANDARD_DELIVERY_TIME = "09:30"`, new
  `EVENING_DELIVERY_TIME = "16:30"`, `BRIEFING_SLOTS`, and
  `briefingsPerDay: 2` on all three tiers (the plan table's own statement of the
  ruling; nothing reads it at runtime).
- `src/lib/briefing-slots.ts` — new. `deliveryTimesFor` and `slotLabel`. Total:
  no caller decides what a plan is entitled to.
- `src/lib/pipeline/schedule.ts` — `nextSlots(schedule, now, times)`, one instant
  per clock time, deduped and sorted. `nextSlot` is unchanged and still the
  single-slot primitive.
- `src/lib/pipeline/digest.ts` — `scheduleUpcoming` writes **one row per slot**,
  so a reader always has both of their next editions booked. The
  `(user_id, scheduled_for)` unique index keeps a per-minute tick idempotent.
- `src/lib/prefs.ts` — default `time` is `STANDARD_DELIVERY_TIME`, default
  `days` is all seven.
- `src/lib/server/briefing.ts` — the "next briefing" chip names the earliest
  slot still ahead; `HistoryDay` gains `slotTime` so two editions of one day are
  distinguishable in the archive.

### The database (`supabase/migrations/0124_briefing_slots.sql`)

- `standard_delivery_time()` → `09:30`, and `launch_plan` re-declared with
  `briefingsPerDay: 2` (0081 is generated history and carries the same values).
- `enforce_daily_briefing` becomes **one briefing per slot per local day**
  (before noon / from noon) instead of one per local day. It still drops a
  second *morning* briefing, which is the duplicate it was written for.
- Column defaults `send_at` → `09:30`, `days` → all seven. Without this, any row
  inserted without a time would carry `07:30` and be rejected by
  `enforce_launch_preferences` on every plan without `customDeliveryTime`.
- Data: `07:30` rows → `09:30`; the exact old Mon–Fri default → seven days;
  every future `scheduled` briefing moves to the 09:30 slot of **its own local
  day** and gains a 16:30 row beside it, skipping a move whose morning instant
  has already passed and never colliding with a row already at that instant.

### Reader copy

No reader-facing surface names a time it does not use:

- Delivery settings: "Morning delivery time" plus a line naming 16:30 as the
  evening edition on every plan. Onboarding says the same.
- Dashboard "Your next briefing": `09:30 and 16:30 · <days> · <zone>`.
- History: each edition row carries its own slot time.
- Briefing page: the header sub names the edition's slot ("Built from the
  coverage up to 16:30") when the edition is known, and names no clock when it
  is not; the card's `Edition · <time>` header does the same rather than
  stamping an evening edition with the morning's clock.
- `/dashboard/pipeline` and `/how-it-works` read `STANDARD_DELIVERY_TIME`
  instead of the literal `07:30`.

## Decisions the ruling did not spell out

1. **Custom delivery time survives, for the morning slot only.** Plura and Omni
   may move 09:30; every reader gets 16:30. Removing a paid entitlement is a
   pricing decision, not a scheduling one, and the ruling names default times,
   not the end of the feature. Rows still storing the old `07:30` were migrated
   to `09:30` on every plan, so nobody keeps a time the product retired.
2. **A reader whose custom morning time is exactly 16:30 gets one briefing.**
   `deliveryTimesFor` collapses the two slots rather than booking the same
   instant twice.
3. **The evening edition may be legitimately quiet.** It draws on what arrived
   since the morning one, and an edition with nothing worth reading is skipped
   and recorded, not filled. If evening editions are consistently empty that is
   a content problem to measure and fix, not a reason to skip the slot.
4. **Nothing else moved.** The internal 16:30 merge gate, cron entries, source
   waves and the 8 Nov quality work are untouched.

## How it was verified

- `src/lib/pipeline/digest-schedule.test.ts` — Tokyo 09:30/16:30 JST
  (`00:30Z`, `07:30Z`), Kolkata 09:30/16:30 IST (`04:00Z`, `11:00Z`), New York
  09:30/16:30 EST (`14:30Z`, `21:30Z`), both sides of the 8 March 2026 New York
  DST switch, and both editions on all seven days.
- `src/lib/schema-migrations.test.ts` — the whole chain applies on PGlite,
  including 0124 and its data statements.
- `npm run ci` on the branch; the numbers are in the work log in
  `docs/context.md` and the task's handoff.
- The migration was applied to the live project and the resulting rows were read
  back (the before/after counts and the next two `scheduled_for` values for a JST
  reader are in the work-log entry).
