# Killed invocations — 37% of the pipeline is ended by Cloudflare (2026-10-12, open)

**Status: RULED 2026-10-12 — C approved, B deferred, A refused.** The arbiter: _"Q2 — approve C,
defer B pending evidence"_, with the governing principle that _"Nyuz must not send readers broken
links or untrustworthy briefings"_ and that infrastructure work is justified **when it protects that
promise, not simply because an operational metric looks bad.** So: **C is approved** — abandoned-run
reconciliation as _bounded, auditable_ cleanup, plus a **durable** kill signal independent of the
heartbeat; **the provisional alert threshold is >5% over 15 minutes with at least 10 observed
invocations** (both halves matter — a percentage on a small denominator is noise); health reporting
must expose degraded/unhealthy processing states and `/admin` must expose the detailed evidence.
**B is deferred, not rejected**, and is to be decided only on evidence from quantifying which
execution paths cause the kills. **A stays refused.** Full register and order:
[arbitration-2026-10-12.md](arbitration-2026-10-12.md). **Not yet implemented.**

**RULED by the owner, 2026-10-12 — the free plan is intentional.** _"Cloudflare and any other is free
plan as it's in develop stage."_ So Option A is **not authorised and not to be re-proposed** while the
product is pre-launch: the 37% kill rate is an accepted operating condition, and the work is to
design inside the 10 ms budget rather than to buy a bigger one. This is recorded in
[AGENTS.md](../../AGENTS.md) under **Stage and priority** so a session that never reads this file
still inherits the decision, and the launch-time form of the gate stays in
[deployment.md](../deployment.md).

**What that leaves open, and why it now matters more rather than less.** Accepting the kills makes the
_visibility_ problem (§4) the live one, because a budget a product deliberately runs against is a
budget whose overruns must be legible — and today a 37% loss reads as `200 ok`. Options B, C and D
are therefore still open, and C is the one that converts an accepted condition into a monitored one
without changing what the pipeline does. The arbiter still needs to rule on whether the kill rate
becomes a signal with a stated threshold.

**What this answers.** R1 ordered _"investigate the 22:30 briefing failures; do not silently accept
discarded briefings as normal."_ The last unexplained thread was the three days — 2026-09-26, 10-05,
10-06 — which the first pass filed as _"the stage simply not running often enough"_ and left as a
separate trigger-delivery question. That filing was wrong. This is what is actually happening, read
off Cloudflare's own record rather than inferred from our tables.

## 1. The trigger is delivered every minute. There was never a delivery fault.

Cloudflare's analytics API exposes a dataset per scheduled invocation —
`workersInvocationsScheduled`, fields `cron`, `scheduledDatetime`, `status`, `cpuTimeUs`. One row per
cron fire, with the expression that fired and the instant it fired for. Read over one UTC day:

| day        | every-minute (`* * * * *`)                   | stages (`0,2,4,…`) | quarter-hour (`*/15`) |
| ---------- | -------------------------------------------- | ------------------ | --------------------- |
| 2026-10-11 | **1,443 invocations / 1,443 distinct slots** | 651 / 651          | 96 / 96               |
| 2026-10-05 | **1,435 invocations / 1,435 distinct slots** | 649 / 649          | 96 / 96               |

A minute that fired zero times would show as a slot with no row. There is none. **The every-minute
trigger — the one that generates and delivers briefings — fired on every minute of both days.**

The registered triggers were also read back from the deployed Worker
(`GET /accounts/{account_id}/workers/scripts/nyuz/schedules`) and match `triggers.crons` in
[vite.config.ts](../../vite.config.ts) exactly, including the `created_on` of each entry moving when
the string last changed.

## 2. What is actually happening: the invocations are killed

The same dataset carries `status`. On 2026-10-11, of the 1,443 every-minute invocations, **354
(24.5%) ended `exceededResources`.** On 2026-10-05 it was **768 of 1,435 (53.5%).** The whole of
that day's scheduled work, kills included:

| day        | every-minute        | stages    | quarter-hour | killed that day |
| ---------- | ------------------- | --------- | ------------ | --------------- |
| 2026-10-11 | 354 / 1,443 (24.5%) | 207 / 651 | 43 / 96      | **604**         |
| 2026-10-05 | 768 / 1,435 (53.5%) | 230 / 649 | 49 / 96      | **1,047**       |

Over 2026-09-19…10-12 the account-wide `workersInvocationsAdaptive` dataset — every invocation, HTTP
and scheduled alike — reports **21,909 `exceededResources` against 37,142 `success` and 99
`clientDisconnected`**, so **37% of all invocations in the window were killed.** Almost all of that
is scheduled work: the two days above alone contribute 1,651 of it, and the Worker serves little
else.

`exceededResources` is the Workers metrics name for `exceededCpu`: _"Worker exceeded CPU time
limit"_, error 1102 ([Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#error-exceeded-cpu-time-limit)).
The documented fix is to raise the CPU limit, optimize the code, or offload work in smaller chunks.
All three are behaviour changes; none is made here.

**These kills are the shortfall this investigation kept finding under other names.** A killed
invocation never reaches its closing write:

- **Before Audit 47** (`fd91f29`, deployed 2026-10-07T04:04Z), the receipt was written _after_ the
  work, so a kill left **no `pipeline_runs` row at all** — the minute looked like one the scheduler
  had skipped. Measured: **6,258 such minutes** between 2026-09-19 and 2026-10-07, in 1–29 minute
  groups spread across every hour, never a blocked window.
- **After Audit 47**, the receipt opens before the work, so the same kill leaves a row still
  `running`. Measured: **1,936 such rows**, 493/97/559/531/251 across 10-07…10-11 — and zero before
  10-07, which is the deploy date.

The two rates agree: **~357/day before the deploy, ~387/day after.** They are one phenomenon
recorded two ways, and the first pass's _"two distinct mechanisms"_ was an artifact of which side of
that deploy a row happened to land on.

**This also disposes of every other candidate cause, with a measurement rather than an assertion:**

- _Not_ runs longer than the 60-second interval. Of 25,433 finished digest runs, the median is
  **1.6 s** and the p90 **2.1 s**; only **3** ever exceeded 60 s and **0.0%** overlapped the next
  minute. The duration of the run before a missing minute is indistinguishable from the run before
  a present one (1.7 s vs 1.6 s).
- _Not_ the subrequest budget. The kills carry **3–20 subrequests** while successful invocations
  carry up to 59.
- _Not_ `pipeline_runs` retention. `purge_pipeline_runs` (0092) keeps 90 days; the table simply
  starts at 2026-09-19T13:12Z, twelve minutes after 0092 was deployed (`fe858d2`, 09-19T12:49Z).
- _Not_ a coverage artifact in the audit arithmetic. `scripts/audit45-dispatch-rate.ts` divides by
  `--days`, so asking for 30 days against 23 days of table understates every rate by 23/30. That is
  why it reported a uniform "63% of every minute" that no real per-day count supports.

## 3. Where the kill line sits, and what is still open

Of the 604 kills on 10-11, **453 fall in the 9.5–10 ms CPU bucket** and the rest land within 40 ms
(reported `cpuTimeUs` for one kill is 1,990,135 — a long synchronous phase). It is a **soft budget,
not a hard wall**: on the same day **767 scheduled invocations succeeded having used more than
10 ms**, up to 709,805 µs, which matches Cloudflare's documented per-isolate grace — _"some built-in
flexibility to allow for cases where your Worker infrequently runs over the configured limit. If
your Worker starts hitting the limit consistently, its execution will be terminated."_

**Still open, and stated as open rather than assumed:** which limit is configured on this Worker. A
custom `cpu_ms`, the Workers **Free** 10 ms Cron Trigger budget, and a legacy Bundled 50 ms limit
all sit in the same range, and the deployed Worker's settings endpoint does not expose a `limits`
block to the token available here — the Cloudflare API returned `Authentication error` for
`/subscriptions`. This matters for the ruling: on Free the fix is a billing change, on a custom
`cpu_ms` it is a config line.

**What is not open is the consequence.** A tick that finds nothing to do is cheap; a tick that finds
a briefing to build, deliver and record is not. **The kills therefore land disproportionately on
the invocations that were going to do the work** — which is why the reader-visible outcome is a
briefing that was never built rather than a pipeline that merely ran less often.

## 4. The monitoring defect this exposes

**A 37% kill rate is invisible to every instrument the product already has.**

- A killed invocation never runs `recordOps(db, "cron:heartbeat", …)`, so that write does not
  happen — **but the next surviving no-op tick one minute later rewrites it `healthy`.** The
  heartbeat is a latest-state upsert written by every invocation, including the trivial ones.
- `/api/health` marks the heartbeat stale only after **45 minutes**
  ([server.ts](../../src/server.ts) — `Date.now() - 45 * 60_000`), and it looks at `ops_status`
  rows only.
- `deriveOperationsState` tolerates **2 hours** ([operations.ts](../../src/lib/server/operations.ts) —
  `heartbeatAge > 2 * HOUR || cronAge > 2 * HOUR`).
- **Nothing reads `pipeline_runs` for health at all.** The 1,936 abandoned `running` rows — the one
  durable trace of a killed invocation — are read only by an operator script that someone has to
  remember to run.

So the pipeline can lose more than a third of its scheduled invocations and still answer `/api/health`
`200 ok` with a fresh heartbeat. That is the same defect R1 named elsewhere: _a recorded failure is
not a monitored service._ Here the failure is not even recorded, and the monitor that exists is
**structurally incapable of seeing it** because it polls a value that survives the failure.

## 5. What each option costs, and what is being asked

Four options, in the order I would rank them. Option A is the only one that removes the cause
without changing what the pipeline does; B and C change behaviour; D is instrumentation.

**A. Raise the invocation CPU budget (owner-side, one setting).** If the Worker is on Free, enabling
Workers Paid moves the Cron Trigger budget from 10 ms to 30 s; otherwise raise `limits.cpu_ms` in
the config or the dashboard. `docs/deployment.md` already carries this as an unchecked launch gate:
_"Workers Paid enabled, or production traces prove SSR and every cron stay within Free CPU
limits."_ Production traces now exist, and they prove the opposite. **Cost: a billing change, no
code change, no reader-visible behaviour change.**

**B. Split the digest invocation so a tick does one thing.** Today one `DIGEST_CRON` invocation
generates _and_ delivers _and_ sweeps the deadline queue; delivery competes with generation for the
same budget, so a tick that finds work is the tick that dies. Moving delivery to its own minute is
the change that lets generation fit a small budget. **Cost: a real behaviour change to the digest
path, and it needs a spec.**

**C. Reap abandoned `pipeline_runs` rows, and surface them.** Nothing closes a row whose invocation
died (`recordRunLifecycle` closes in both its success and error branches, so `running` means killed).
Reaping would stop the ledger lying, and exposing the count would make the kill rate a number an
operator can see. **Cost: a write path plus a health signal — and if it feeds `/api/health`, it is
an operator-facing decision.**

**D. Reduce per-tick CPU** (smaller batches, fewer stages per invocation). Correct in principle,
needs a CPU profile first, and `cpuTimeUs` is sampled rather than attributable per stage, so the
profile has to come from `wrangler tail` or DevTools on the worker. **Cost: investigation before a
change, and it does not help a tick that must parse one briefing's payload.**

**What is being asked of the arbiter:** whether B and C are in scope now (A is settled — the owner
ruled the free plan intentional on 2026-10-12, so the budget is not raised before launch), and
whether the kill rate becomes a monitored signal with a stated threshold. Nothing is being
recommended into the shipping path before that ruling. **Until then the standing bar is the one in
[AGENTS.md](../../AGENTS.md): what the reader reads is 10/10, and the kills are a condition to design
inside rather than a defect to escalate.**

## 6. How to reproduce every number here

Read-only. Node 22 or later, `.env` present.

```
node --env-file=.env scripts/tsrun.mjs scripts/audit45-dispatch-rate.ts --days 45
node --env-file=.env scripts/tsrun.mjs .scratch/trigger-delivery/daily-digest-runs.ts
node --env-file=.env scripts/tsrun.mjs .scratch/trigger-delivery/missing-minutes.ts
node --env-file=.env scripts/tsrun.mjs .scratch/trigger-delivery/gap-cause.ts
```

The Cloudflare side is GraphQL, account-scoped, read-only:

```graphql
query ($accountTag: String!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsScheduled(
        limit: 5000
        filter: {
          scriptName: "nyuz"
          datetime_geq: "2026-10-11T00:00:00Z"
          datetime_leq: "2026-10-11T23:59:59Z"
        }
      ) {
        cron
        scheduledDatetime
        status
        cpuTimeUs
      }
    }
  }
}
```

The `.scratch/trigger-delivery/` probes are throwaway instrumentation for this investigation, not
part of the product's scripts; they are kept only so the numbers above are reproducible end to end.

## 2026-10-16 — the first attribution of the spend, measured on the reader with the largest pool

**Open question B** (*which execution paths cause the kills*) now has a first answer, measured rather
than sampled. Reproduced as an upper bound on a laptop with `process.cpuUsage()` around each phase of
the briefing build's read path for the reader whose 22:30Z slot has been killed six nights running
(1000 live unbriefed matches): **the readiness gate is the dominant term — 15.5 s of CPU across 36
candidate briefs, median 338 ms per brief** (range 9.6 ms … 1,744 ms, tracking excerpt size), against
`loadMatches` 320 ms, twin suppression 1,052 ms, duplicate suppression 529 ms, brief loading 140 ms,
and artifact composition for the shipping set 117 ms (~3.6 ms each). Read path total **~17.7 s CPU**
before any write.

**Why this is not a contradiction of §3's "soft budget".** The measured 710 ms success ceiling means an
invocation survives roughly 700 ms of CPU; a build that needs 17.7 s cannot, and the gate alone exceeds
the ceiling on a single brief more often than not. It also explains the shape of the success record: the
two UTC readers are `skipped` with 0 items every day because their candidate set never reaches the gate,
and the reader's briefings that *did* ship (16 and 9 items, 2026-10-08/09) were built when its pool was
current and small. Nothing ships → the pool grows → the gate costs more → the build is killed.

**What it does not settle:** the Worker's own per-stage CPU (this is a laptop upper bound, and
`cpuTimeUs` stays the authoritative Worker figure), or which of the bounded-work designs to take — the
options and their costs are recorded in
[reader-delivery.md](reader-delivery.md#the-next-slices-first-measurement-where-the-briefing-builds-cpu-goes-2026-10-16-measured-design-question-open),
where the slice is being ruled.


## 2026-10-16 — the ruled slice: generation made resumable, so a kill costs a stage

**Landed with 0119.** The build is cut at its own stage boundaries (`select`, `screen`, `gate`,
`write`), each boundary is written to `digests.generation_progress`, and `loadDue` treats a row
carrying progress as due immediately rather than after `GENERATION_LEASE_MINUTES` — the lease answers
"may a dead claim be retaken", and a row with a cursor has already come back. The gate takes two
briefs per invocation, and a stage whose set exceeded 12 gets a tick of its own.

Why a count and not a clock: a wall-clock budget would make "did this briefing finish in one
invocation" depend on the machine that ran it, which no test can assert and no operator can reason
about, and it would push every reader whose build already fits one tick into several. The whole
ruling, the stage-by-stage costs and the residual risk (`select` ~0.93 s and `screen` ~1.19 s on this
reader are each still above the ~710 ms success ceiling, so option B remains the next slice) are
recorded in
[reader-delivery.md](reader-delivery.md#the-ruled-slice-a-briefing-built-across-cron-ticks-2026-10-16-ruled-and-landed).

## 2026-10-16 — the second measurement: the profile names the spend, and the repair is proved equivalent

**Why a second measurement.** The first one attributed 87% of a large-pool briefing build to the
readiness gate and said its cost "tracks excerpt size" — a correlation, not a mechanism, and the
arbiter's ruled criterion is to *locate* the spend before reducing it. So the gate was profiled
rather than timed: `node --cpu-prof` over the same replay harness, same live pool, same reader
(640a69b6, 1,000 unbriefed matches, 37 candidates, cap 25).

**What the profile said.** The gate's 15,113 ms of CPU, by self time:

| entry                        | self time | share | note                                                             |
| ---------------------------- | --------- | ----- | ---------------------------------------------------------------- |
| `repetitionBomb`             | 4,330 ms  | 22.2% | nested window rebuilds + comparisons for a three-occurrence count |
| `contains`                   | 3,216 ms  | 16.5% | a fresh `iu` lookbehind `RegExp` compiled on every call           |
| `(anon)` closures            | 1,620 ms  |  8.3% | `forms.some(...)`, `units.filter(...)` around the two above       |
| `centralTokens`              |   410 ms  |  2.7% | tokenizing excerpts that the loops above re-read                  |
| `(garbage collector)`        |   578 ms  |  3.0% | the allocations those rebuilds made                                |
| everything else              | ~4,900 ms | 32.0% | the composer proper, spread across ~90 functions                  |

Both leaders are called from `rankEntities` inside `selectReaderEvidence`, i.e. per brief, per name,
per sentence, per source — the loops that multiply with excerpt size, which is why the cost looked
like a property of the excerpt.

**After the repair, same harness, mean of two runs.** Gate **15,113 -> 2,634 ms** (5.7x), median per
brief **125 -> 18 ms**, worst **1,826 -> 435 ms**; `repetitionBomb` **4,330 -> 322 ms**;
`contains` as a self-time entry **3,216 -> ~150 ms**. The census harness (whole read path): **17.7 s
-> 6.4 s**, now `loadMatches` 33 ms, `map to MatchRow` 0.5 ms, `alreadyBriefed` 12 ms,
`selectItems` 10 ms, `suppressDeliveredDuplicates` 194 ms, `loadBriefs` 50 ms, `deliveredTwinTitles`
9 ms, twin suppression 140 ms, the gate 2.6 s across 37 briefs, artifact composition 52 ms.

**The equivalence proof.** 200 stories frozen to one file, composed on a clean worktree at `17d1b36`
and on this tree, diffed with `scripts/reader-composer-diff.ts`: **0 stories rewritten, 0 stories that
lost or gained 25+ words, 0 that became empty, every reader-visible defect counter identical**; the
same run's wall clock 22.5 s -> 8.6 s. That is the evidence the verdicts did not move, and it is
stronger than the reasoning that says they could not have.

**What this does not change.** The budget reading stands exactly as recorded in §2: kills cluster in
the 9.5-10 ms bucket, and 767 scheduled invocations on 2026-10-11 still succeeded above 10 ms with the
largest at 709,805 us. These are laptop measurements and upper bounds on a single-threaded isolate;
the Worker's own `cpuTimeUs` for the repaired ticks is still not measured. What changed is that every
stage of this reader's build — selection ~250 ms, screening ~200 ms, one gated brief's worst 435 ms,
the write ~52 ms — now sits inside that observed grace, where the gate at two briefs a tick did not.
