# The 22:30 briefing failures — investigated (R1 item 3, 2026-10-12)

The arbiter's order was to _"investigate the 22:30 briefing failures. Do not silently accept
discarded briefings as normal."_ This is that investigation. It changes no behaviour by
itself; the one code change it justifies is named at the end and is already written.

**Provenance.** Read-only census over the live project, 2026-10-12:
`digests` (267 rows, all of them) and `deliveries` (all legs) read through the service-role
client, grouped by `scheduled_for` slot, `status`, `kind` and `generation_failure_reason`.
The figures below are from that run, not from a log.

## 1. What the numbers say

|                                                          |        |
| -------------------------------------------------------- | ------ |
| failed digests, all time                                 | **19** |
| of those, the 22:30Z slot                                | **18** |
| distinct readers behind all 22:30Z rows                  | **1**  |
| briefings **sent** at the same 22:30Z slot               | **23** |
| briefings **skipped** at 22:30Z (quiet days, no stories) | 5      |

The first thing this establishes is what the failure is _not_. The same slot both sent and
failed on the same days, and 23 of that reader's 41 briefings went out. **The cron did not
stop and the worker did not die** — `DIGEST_CRON` is `* * * * *` and the slot's generation
window opens ten minutes early (`PREPARE_LEAD_MINUTES = 10`), consistent with the on-time
generation timestamps (`22:20`–`22:26`) on the days that worked. A whole-reader outage would
not look like this.

**22:30Z is 07:30 in Asia/Tokyo.** That is this reader's chosen `send_at` — the daily
briefing slot, not a stray cron minute.

## 2. Two failure shapes, and they are different bugs

**Shape A — built, then discarded (12 rows).** The briefing was assembled correctly, 25–50
items, and the digest reached `ready`. Every delivery leg then failed, or one succeeded and
nothing reconciled the digest, so the row sat `ready`. Two hours past its slot,
`expire_stale_work` (0091) marked it `failed` with _"briefing slot expired; not sent"_ —
**413 built items discarded** across those 12 rows (392 of them at 22:30Z).

Their legs, verbatim:

| date                       | items   | legs                                                                                     |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| 2026-08-27                 | 30      | `email:failed (Missing EMAIL_UNSUBSCRIBE_SECRET)` · `push:failed (no push subscription)` |
| 2026-09-05                 | 40      | `email:failed (Missing EMAIL_UNSUBSCRIBE_SECRET)`                                        |
| 2026-09-27                 | 25      | `email:failed (Resend 401)` · **`push:sent`**                                            |
| 2026-09-19                 | 25      | `email:failed (Resend 401)` · **`push:sent`**                                            |
| 2026-09-22                 | 25      | `email:failed (Resend 401)` · **`push:sent`**                                            |
| 2026-09-28                 | 25      | `email:failed (Resend 401)` · **`push:sent`**                                            |
| 2026-09-03 / 09-01 / 09-02 | 50 each | `email:failed (missing secret)`                                                          |
| 2026-08-26                 | 47      | `email:sent` · `push:failed (no push subscription)`                                      |

The `push:sent` rows are the ones that matter. **The reader received those briefings on
their phone, and the database recorded them as failures.** Nothing connected "this digest's
legs have all resolved" back to the digest, so a partially-delivered briefing stayed `ready`
until the sweeper threw it away.

**Shape B — never built (5 rows).** 2026-09-26, 10-05, 10-06, 10-10, 10-11: `item_count 0`,
**no delivery rows at all**, reason _"missed slot by 120–126 minutes; not sent"_, with the
`generated_at` stamp landing at `00:30`–`00:35` — about two hours after the slot. A row only
reaches `expireSlot` by being returned from `loadDue` while already more than
`MAX_LATENESS_MINUTES = 120` past its `scheduled_for`.

Two further rows (2026-08-30, 08-31) carry `generation_failure_reason = null` with no
delivery rows. No current code path writes a failed digest without a reason — `expireSlot`,
`failGeneration` and the reconciliation all name one — so these are pre-0077 history, not a
live defect. Recorded, not chased.

**Shape B — diagnosed (same day, second pass).** The `generated_at` stamp is _not_ when the
row was first touched. The only writer of `generation_started_at` is `claimDigest`
([digest.ts](../../src/lib/pipeline/digest.ts)), and a retake **overwrites** it — so each of the
five rows records the _last_ claim, not the first. What the row proves is narrower and more
useful: by the time any claim succeeded far enough to reach the lateness check, the slot was
already past its ceiling.

All 47 briefings ever scheduled at 22:30Z, by how late their claim landed:

|                                       |                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| healthy days                          | claim **−9 to +26 min** (the window opens 10 min early, so a negative number is on time) |
| the five never-built days             | claim **+113 to +120 min**                                                               |
| days claimed late but still delivered | +45, +86 min — late generation still sends, up to the ceiling                            |

The five are therefore not a special case with a hidden cause; they are the days where the
claim slipped past `MAX_LATENESS_MINUTES`. **One mechanism explains all five**, and it is
readable in `pipeline_runs` — though the first pass read it as two, because Audit 47 changed
the way a death is recorded:

1. **Invocations killed mid-run (2026-10-10, 10-11).** **1,936 of 27,178 digest runs** are left
   `status: running` — 7.1% of them — and **nothing ever reaps them.** `recordRunLifecycle`
   closes its row in both the success and the error branch, so a row still `running` is an
   invocation that was killed before either could run. In the slot window itself these cluster:
   **98 stuck on 10-07, 31 on 10-08, 116 on 10-09, 34 on 10-10, 22 on 10-11** — and the two that
   failed are 10-10 and 10-11. One of them is stamped
   `2026-10-11T00:24:13.121`, matching the failing row's claim at `.696` of the same second: a
   worker claimed the briefing, died holding it, and the row sat `generating` until its
   five-minute lease let a later tick retake it — by then far past the ceiling.
2. **The same mechanism, recorded differently (2026-09-26, 10-05, 10-06).** The first pass read
   these three as "the stage simply not running often enough" — 125, 47 and 59 digest runs in
   their windows against ~170 on a healthy day — and filed that as an unexplained gap in trigger
   delivery. **That reading was wrong, and the platform's own record says so.** Cloudflare's
   `workersInvocationsScheduled` dataset holds one row per scheduled invocation with the cron
   expression that fired and the `scheduledDatetime` it fired for. On 2026-10-11 the every-minute
   trigger produced **1,443 invocations across 1,443 distinct slots**; on 2026-10-05, **1,435
   across 1,435**. The trigger was delivered every single minute on both days. There was never a
   delivery gap to explain.

   What the day actually shows is the kill rate. Cloudflare ended **354 of those 1,443
   invocations (24.5%) on 10-11 and 768 of 1,435 (53.5%) on 10-05** with the invocation status
   `exceededResources`, which is the metrics name for `exceededCpu` — "Worker exceeded CPU time
   limit" (error 1102). Across 2026-09-19…10-12 that is **21,909 killed out of 59,150 scheduled
   invocations, 37%**. The kills are not spread over the window; they are the shortfall itself.
   A tick that is killed before its first write leaves no `pipeline_runs` row, so before Audit 47
   landed it _looked_ like a minute with no run at all — 6,258 such minutes across the window.
   Audit 47 moved the receipt to open before the work (10-07T04:04Z), and from that deploy the
   same deaths appear as the **1,936 rows still `running`** instead. The two rates agree:
   ~357/day before the deploy, ~387/day after. **They were one phenomenon all along, and this
   census's "two distinct mechanisms" was an artifact of which side of that deploy a row was
   recorded on.**

   The kill line sits at about 10 ms of CPU: of 604 kills on 10-11, 453 fall in the 9.5–10 ms
   bucket and the rest within 40 ms. It is a soft budget, not a hard wall — 767 scheduled
   invocations on the same day **succeeded** having used more than 10 ms, up to 0.71 s, which is
   consistent with the platform's documented per-isolate grace for a Worker that does not hit the
   limit consistently. Which limit is configured on this Worker (a 10 ms `cpu_ms`, the Free plan's
   10 ms Cron Trigger budget, or a legacy 50 ms Bundled limit) **could not be read from the token
   available here** and is stated as open rather than assumed. What is not open is the
   consequence: **the ticks that find work are the ticks that are expensive, so the kills land
   disproportionately on the invocations that were going to build a briefing.**

   The full platform evidence, the commands that produced it, and the ruling this needs are in
   [cpu-killed-invocations.md](cpu-killed-invocations.md).

**Why the diagnosis took two passes, and the instrument defect it exposed.** The first pass
read `pipeline_runs.considered` and found **285 consecutive digest runs at `considered: 0`**, which
looks exactly like starvation. It is an artifact: `DigestReport` carried **no `considered` field**,
and `recordRunLifecycle` reads a missing metric as `0` — so _every_ digest run ever recorded
reported `considered: 0`, including ticks that were generating briefings. A count that cannot see
the thing being judged, in the one table used to diagnose this. **Fixed the same day:**
[digest.ts](../../src/lib/pipeline/digest.ts) now reports `considered: due.length` (and
`describeDigest` prints it), with a regression test on the tick that expires a row — the case that
produced nothing and therefore read as zero work — asserting `considered` is still 1
([briefing-timing.test.ts](../../src/lib/pipeline/briefing-timing.test.ts)).

**Not fixed, and not fixed here on purpose.** Nothing reaps an abandoned `pipeline_runs` row, and
generation shares one invocation with delivery — so delivery work, including the 253 failed email
legs with their retries, competes for the invocation that was supposed to build the briefing.
Both are behaviour changes and neither is authorised by this investigation; they are the
proposals that follow from it. No change was made to `MAX_LATENESS_MINUTES`, to the 120-minute
sweeper, or to the trigger list.

## 3. The underlying channel failure (R1 item 1)

Across all legs: **email 4 sent / 253 failed**, **push 208 sent / 12 failed**. The email
errors are exactly the two causes R1 names:
`Missing EMAIL_UNSUBSCRIBE_SECRET` ×125, `Resend 401 API key is invalid` ×128. The remaining
errors are small: `no push subscription` ×7 and
`Could not find the table 'public.registered_devices' in the schema cache` ×5 — a transient
PostgREST schema-cache miss that fails a push leg on its own.

So the 22:30 slot's dominant cause is **not** a scheduling defect: it is email being dead
since 2026-08-26, which is owner-side (two secrets and a verified sender). The code defect
is the second-order one: what the system does with a briefing whose channels partly failed.

## 4. The `ready` backlog, re-measured

There were said to be 69 alerts stuck at `ready`. Re-measured today: **70 rows are `ready`,
and every one of them is an alert — zero are briefings.** 48 of the 70 have
`email:failed · push:sent`, i.e. the same "status does not reflect what the legs did" defect
as Shape A, in the alert path.

This matters twice over. `expire_stale_work` only touches `kind = 'briefing'`, so an alert in
that state is never swept and never resolved — it is permanent, by construction. And because
there are **zero** `ready` briefings, the briefing sweeper currently has nothing to do; the
alerts are not evidence of a briefing backlog.

The alert side is the _other_ R1 ruling — _"that status conflates whole-alert completion with
one channel's state and needs a model that can say successful / partial / failed / pending."_
That is a decision, so no model is built here.

## 5. What this justifies, and what it does not

**Justified, and written:** `reconcileDigestAfterTerminal` in
[digest.ts](../../src/lib/pipeline/digest.ts). On the terminal resolution of a delivery it
asks whether that digest still has queued legs; if none remain it settles the digest —
`sent` when at least one leg was accepted, `failed` with a reason that names the cause when
none was. On the Shape A rows it converts _"silently expires two hours later with 25 built
items attached"_ into _"fails at send time, saying why"_, and it would have marked the four
`push:sent` rows `sent`, because they were delivered.

**Justified, and written (second pass):** `DigestReport.considered`. It is instrumentation only
— nothing the reader receives changes — and it removes a number that read as starvation while
the stage was working.

**Not justified yet:** no change to `MAX_LATENESS_MINUTES`, to the 120-minute sweeper, to
`ENRICH_LIMIT`, or to any alert policy, and no retroactive surgery on the 70. Shape B now has
a diagnosis but still no authorised fix: reaping abandoned `pipeline_runs` rows, separating
generation from delivery in the digest invocation, and raising the invocation CPU budget are all
behaviour changes, and each needs a ruling — see
[cpu-killed-invocations.md](cpu-killed-invocations.md).

**No longer open (third pass).** The trigger-delivery question this section used to leave open
has been answered against the platform, and the answer is that there was no delivery fault: the
every-minute trigger fired every minute, and 37% of the invocations it delivered were killed by
Cloudflare for exceeding their CPU budget. The correction and its evidence are in §2 mechanism 2
and in [cpu-killed-invocations.md](cpu-killed-invocations.md).

**Still owner-side:** the email credentials and a production sender. Until those exist, the
22:30 slot will keep failing for a reader whose only channel is email, however clean the
digest status becomes.

## 6. Measured against the earlier figure

R1's summary said _"10 with a briefing already built and 336 items discarded"_, from
`briefing:checkpoint -- --recent 14` — a 14-day window. This census reads all rows and finds
**12 built-then-discarded and 413 items**. The two agree in shape and differ in window; both
are stated with their command so the difference is not mistaken for a contradiction.
