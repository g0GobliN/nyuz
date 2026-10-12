# Arbitration — origin, CPU kills, and the order of work (2026-10-12, RULED)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "Readiness Review Ruling"
(`/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6acc2fc0-6434-83e8-90e4-e97cdc60f2d0`), reached from
this session on 2026-10-12 through the browser. **This is the only route to the arbiter — there is no
ChatGPT connector in this environment** (the available MCP servers are `supabase` and `cloudflare`),
so a question reaches it by opening that project and posting, which is why `AGENTS.md` requires the
project to stay open across the loop.

**What was put to it.** Two measured findings, not proposals: the dead reader-facing origin
([reader-facing-origin.md](reader-facing-origin.md)) and the 37% kill rate with its invisible
monitoring ([cpu-killed-invocations.md](cpu-killed-invocations.md)), plus the owner's three standing
rulings (free plans intentional; no domain bought; reader quality is the only bar, alerts only when
breaking and important, push only after confirmation).

**The arbiter's decision, verbatim:**

> "Decision: Q1 — change the canonical origin now. Q2 — approve C, defer B pending evidence. Q3 —
> reader quality remains the release bar, but the reliability work required to protect that bar is
> not optional."

> "The governing principle is that Nyuz must not send readers broken links or untrustworthy
> briefings. Infrastructure work is justified when it protects that promise, not simply because an
> operational metric looks bad."

## The decision register, as ruled

| item                                   | decision                                                       | status                 |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| Q1 — canonical origin                  | use the verified `workers.dev` origin                          | **approved**           |
| Q1 — email and checkout links          | verify complete flows on that origin                           | **required**           |
| Q1 — domain purchase                   | remain deferred                                                | unchanged              |
| Q2 — split generation and delivery (B) | investigate before deciding                                    | **deferred**           |
| Q2 — abandoned-run reconciliation      | implement bounded, auditable cleanup                           | **approved**           |
| Q2 — CPU-kill monitoring               | durable signal independent of the heartbeat                    | **approved**           |
| Q2 — initial alert threshold           | **>5% over 15 minutes, with at least 10 observed invocations** | approved provisionally |
| Q2 — health reporting                  | expose degraded/unhealthy processing states                    | **approved**           |
| Q2 — admin visibility                  | expose detailed operational evidence                           | **approved**           |
| Q3 — reader quality                    | remains the release bar                                        | unchanged              |
| Q3 — missing `why_it_matters`          | audit against existing rules; block confirmed violations       | **required**           |
| Q3 — discarded items                   | attribute each failure before changing behaviour               | **required**           |
| push to `main`                         | only after the required checks are confirmed green             | unchanged              |

## Q1 — the origin (RULED: change it now)

> "RULING: Set `VITE_SITE_URL` to the verified Cloudflare-provided Worker origin. Do not wait for a
> purchased domain."

So the dead-link defect is real and is fixed by repointing the origin, not by buying a name. Two
things follow that are easy to miss, and both are **required** rather than optional: the complete
email and checkout flows must be verified **on that origin** (a link that resolves is not a flow that
works), and the claim that produced this finding has to become a check — the arbiter's ruling only
lands if the next misconfiguration is caught by a test rather than by someone opening the site.

## Q2 — the kills (RULED: C approved, B deferred)

C is approved as **bounded and auditable** cleanup plus a **durable** kill signal — durable
specifically so it does not depend on the heartbeat, which is the mechanism that made 37% loss read
as `200 ok`. The provisional alert threshold is **>5% over 15 minutes, with at least 10 observed
invocations**: both halves matter, because a percentage with a small denominator is noise, and this
product runs one reader on a free plan.

B is **deferred, not rejected**: _\"Only approve the generation/delivery split if the evidence shows
that it is an effective, appropriately bounded remedy. Do not undertake a pipeline redesign simply
because it is architecturally attractive.\"_ That makes the fourth step — quantifying which execution
paths cause the kills — the evidence B would be judged against.

## Q3 — the reader backlog (RULED: attribute, do not merge)

The 413 discarded items must **not** be merged into one undifferentiated count. Each is to be
attributed as one of: correctly refused under the established policy; lost through execution failure;
lost through a scheduling or expiry defect; or lost for another attributable reason. And the target
is explicit — _\"not to force all 413 items to ship\"_, but that _\"every disposition is correct and
explainable\"_. The 69 items with no `why_it_matters` are to be audited against the existing
reader-quality rules, with confirmed violations blocked.

## The authorised execution order

1. **Restore and verify the reader-facing origin** — correct the canonical origin, fix the
   unsubscribe destination, add the deployment-origin assertion.
2. **Audit the 69 and the 413** — attribute each; fix confirmed defects before improving unrelated
   operational metrics.
3. **Implement C** — abandoned-run reconciliation and durable invocation-failure monitoring.
4. **Investigate the workload causing CPU kills** — quantify which paths contribute. (May proceed in
   parallel with 1–3.)
5. **Decide whether B is necessary** — on that evidence only.

> "It does mean that broad implementation work must not displace immediate, confirmed reader-facing
> corrections."

## Push to `main` (RULED: unchanged, and the bar is evidence)

> "RULING: Preserve that condition. Do not push red."

The ruling is specific about what a red local run requires before it can be called an environment
limitation: identify which checks fail and why, **separate environment-dependent failures from actual
regressions**, run the applicable checks in a supported environment, and confirm the required checks
pass — and _\"Do not bypass failing checks merely to deliver the origin fix quickly.\"_ So "worker
starvation" cannot be asserted as the reason; it has to be demonstrated by distinguishing the two
classes with independent evidence.

**Nothing is pushed.** Steps 1–3 are authorised but not yet implemented; this file records the ruling
so the next session starts from it rather than re-deriving it.

## Q4 — rung-6 silence at the 10/10 bar (RULED 2026-10-12: withhold)

Asked after the Q3 audit found the 69 empty-`why_it_matters` items are rung-6 silence — allowed by
the existing rules, but thinner than the sample the landing page shows on every item.

> "Ruling: Option 1 — WITHHOLD THE ITEM. At the 10/10 reader-quality bar, an item without a
> story-specific `why_it_matters` line does not ship. It remains eligible for future processing,
> but it is withheld from that briefing."

Reasons on the record: silence is honest but inclusion is a separate decision; the landing-page
promise shows a reason on every item and shipping without one makes the real experience thinner
than the advertised one; a quiet morning is an acceptable outcome — _"fewer defensible items over
a fuller briefing that cannot meet its own standard"_. Withholding is explicitly **not** a
confirmed violation of the inclusion ladder: it is a stricter shipping decision at the final
quality gate. And the boundary the ruling draws by name: _"Do not manufacture explanations to
rescue items. Rung 6 must remain honest silence. The remedy is withholding, not filler, generic
explanations, or unsupported claims."_

**Disposition recording is mandatory:** every withheld item is recorded as `skipped` with an
explicit canonical reason (e.g. `missing_story_specific_why_it_matters`), preserving item and
briefing identifiers, the disposition, the reason, and the gate decision — _"an auditable
disposition, not a fabricated delivery failure or a confirmed content violation"_. No silent
disappearance.

Options 2–4 rejected: 2 accepts the sample-vs-output gap; 3 makes the standard depend on
neighbouring content; 4 fixes only the promise (useful as an additional correction, not
sufficient). **Acceptance condition:** no rung-6 item reaches a reader, no explanation is invented
to fill the gap, and every withheld item has an auditable disposition.
