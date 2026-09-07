# History and retention

How far back a reader can see, how long nyuz keeps it, and what happens when a plan
changes. This is the canonical page for all of it — the localisation plan and plan2 §72
point here rather than restating any of it.

Everything below was implemented in
[`0067_history_entitlement.sql`](../supabase/migrations/0067_history_entitlement.sql).

---

## The windows

| Plan       | History  | `retentionDays` |
| ---------- | -------- | --------------- |
| nyuz Uno   | 7 days   | 7               |
| nyuz Plura | 90 days  | 90              |
| nyuz Omni  | 365 days | 365             |

`PLAN_LIMITS` in [`src/lib/plans.ts`](../src/lib/plans.ts) is the product's source of
truth for what the pricing page says. `plan_history_days()` is the enforcement copy, and
it is the only place in SQL where 7, 90 and 365 appear. Nothing else in either language
restates them.

## Exact dates, never calendar months

The boundary is `now() - N days`. A window is not a month, does not begin on the first,
and does not care what a month is called.

This matters most at the edges. A reader on Uno on 3 September can see back to 27
August, so their History page has two month headings and both are fully readable. A
90-day Plura window lands in the middle of June far more often than on the 1st, which is
why a month can be **partly available** — some of its days inside the window, some
outside — and why the page says exactly that rather than rounding a month to readable or
locked.

Month _headings_ are a display grouping. They are computed in the reader's own timezone
(`notification_preferences.timezone`), so a briefing at 00:30 UTC on 1 September appears
under August for a reader in New York, and the day labels inside a month always agree
with the heading above them.

## The access boundary

```sql
public.history_window_start(p_user uuid) returns timestamptz
```

One function, called by everything:

- the `own digests` and `own digest items` RLS policies
- `history_months()`
- `loadHistory`, `loadDigestStories`, `searchStories`, `loadStory`

It is `security invoker` on purpose. Under `authenticated`, the "own subscription" policy
means the lookup can only find the caller's own row, so asking for somebody else's window
returns the Uno default and leaks nothing. Under `service_role` — the pipeline and every
server function — RLS is bypassed and the real answer comes back. One function, correct
for both callers.

It reads the **current** plan and nothing else. Grace is not part of it. See below.

## Downgrade grace

Two columns on `subscriptions`, written by the `subscriptions_history_grace` trigger and
never by application code:

| Column                | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `history_grace_until` | Deadline, set to `now() + 30 days` on a downgrade                          |
| `history_grace_days`  | The window being held open — the plan they left, or a longer running grace |

The trigger, not the Stripe webhook, because every path that changes a plan is an UPDATE
on this table: `customer.subscription.updated`, the cancellation path that drops to Uno,
the payment-failure path where `entitlementPlan` demotes a `past_due` reader, and any
hand-run SQL. In application code the rule would have to be written four times.

**Access changes immediately; deletion does not.**

```text
downgrade
  ↓
history_window_start narrows the same instant   → old months stop being readable
rows stay in the database for 30 more days      → old months are still listed, locked
  ↓
upgrade inside the grace   → the window widens back over rows that were never deleted
grace expires              → purge deletes them for real
```

There is no restore job, and there is nothing to restore. Access is a function of the
current plan applied to whatever still exists, so an upgrade unlocks history by
arithmetic rather than by a data migration.

A second downgrade restarts the thirty days and keeps the longer reach — bounded, and the
same clock the reader was just shown. An upgrade that covers the grace clears both
columns; an upgrade that does not (Omni → Uno → Plura, where rows aged 90–365 days are
still beyond Plura) keeps the original deadline running so a further upgrade can still
find them.

**Nobody accumulates history they never had.** An account that has always been Uno has
both columns null, is purged at seven days exactly, and cannot be upgraded into a
retroactive archive. Plura simply starts building toward 90 days from the day it starts.

## Purge

`purge_expired_digests(p_limit)`, run from `dormant()` on the pipeline schedule.

Cutoff per reader:

```text
current plan retention
  unless history_grace_until > now(), then
greatest(current plan retention, history_grace_days)
```

It deletes from exactly two tables:

- `digests` — and `digest_items` with them, by cascade
- `user_events` — the match records, which before 0067 were never pruned at all

Both sweeps are bounded by `p_limit`, ordered oldest-first, and safe to rerun: a backlog
drains deterministically across runs. No AI is involved in any part of retention or
entitlement, and none should ever be.

## Shared corpus

`events` and `articles` are shared. One event row serves every reader who matched it, so
one reader's window expiring says nothing about whether another reader needs it
tomorrow. **No per-user cleanup deletes a shared row**, and the per-user purge is
asserted in [`history-entitlement.test.ts`](../src/lib/history-entitlement.test.ts) to
touch nothing but `digests` and `user_events`.

The corpus has its own age-based job, `purge_expired_corpus`, which deletes events idle
for more than **420 days** (raised from 400 in 0067) and exempts anything in
`saved_stories`. The margin is deliberate: Omni's 365 days plus 30 days of grace reaches
395, and `digest_items` cascades from `events` — at 400 days the corpus job was five days
away from hollowing out digests a reader was still entitled to open.

## Saved stories

Exempt from all of it.

- `saved_stories` rows are never deleted by any purge.
- `purge_expired_corpus` will not delete an event somebody saved.
- `purge_expired_digests` skips saved events when pruning `user_events`.
- `storyVisible` treats a saved row as sufficient on its own, whatever the window says.

What a saved story loses once its digest expires is the per-user `why_it_matters`
paragraph, which falls back to the shared `event_impacts` text that
`storiesFromDigest`/`storiesFromEventIds` already prefer when there is no personal one.
That fallback is why there is no `saved_stories` `exists()` bolted onto ordinary history
rows: the expensive check would buy a paragraph.

## Security model

Two layers, because there are two kinds of caller.

**Browser → PostgREST.** `plan-state.ts` reads `subscriptions` straight from the browser,
so this project already treats the browser as a first-class Postgres client. The
`own digests` policy therefore carries the window itself:

```sql
auth.uid() = user_id
and scheduled_for >= (select public.history_window_start(auth.uid()))
```

The `(select …)` wrapper is load-bearing: bare, the helper is re-evaluated per candidate
row; wrapped, the planner hoists it into an InitPlan and calls it once per query.
`own digest items` restates the same predicate through its parent rather than relying on
nested RLS to carry an entitlement.

**Server functions.** These run with the **service-role client** (`guard.ts` hands one
down on `context.actor.db`), and service_role bypasses RLS. So every server-side read
applies the window itself — collected in [`src/lib/server/history.ts`](../src/lib/server/history.ts)
so the boundary lives in one file rather than at four call sites:

| Route               | How it is bounded                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `loadHistory`       | Months from `history_months()`; days clamped to `max(month start, window start)`                  |
| `loadDigestStories` | `digestInWindow` — ownership **and** recency, so an old digest id from a bookmark returns nothing |
| `searchStories`     | `user_events.matched_at >= window start`                                                          |
| `loadStory`         | `storyVisible` — an in-window match, an in-window delivered digest, or a saved row                |

`history_months()` is the single exception permitted to look past the window, and the
reason it may is that it returns no content: a month key, its bounds, how many briefings
in it are readable, and the newest/oldest timestamps of what is being held. No titles, no
digest ids, no bodies. It is `security definer` and granted to `service_role` only.

### What is deliberately not bounded

`events` and `articles` stay globally readable to authenticated readers (0002). They are
shared canonical knowledge, and gating them per reader would be a much larger change on
the hottest read path in the product. What a plan sells, and the only thing a downgrade
takes back, is the **personal** layer: which digests exist for you, in what order, with
which `why_it_matters`, and which of them you may still open. That is what 0067 bounds.

## The History page

One layout for every plan, with no branch on the plan anywhere in it.

Months are the navigation and only the open one is fetched — a year of daily briefings is
365 rows, and the previous implementation asked for `retentionDays + 5` of them on every
visit. A month row is locked when the server says there are rows there the reader may no
longer open, which means:

- **Always been Uno** — one or two month rows, both readable, and a quiet line at the
  bottom: _Need more history? Plura keeps 90 days and Omni keeps 1 year._ There are no
  locked rows, because there is nothing behind them to lock. Twelve grey months on a free
  plan would be a paywall pretending to be an archive.
- **Downgraded** — their own months, held for thirty days, each labelled with the plan
  that would genuinely bring it back, plus one line saying the archive is recoverable
  until a date.

### Restore CTA

Derived from the real dates of the locked rows in the month, never from its name:

```text
age of the newest locked day ≤ 7    → Uno
                              ≤ 90   → Plura
                              ≤ 365  → Omni
                              > 365  → no plan offered
```

The **newest** locked day, because that is the first one an upgrade recovers — pricing
off the oldest would push everyone to Omni for a month whose first week Plura already
reaches. When the chosen plan does not also reach the oldest locked day, the page says
"Plura restores part of this month" instead of "Restore with Plura". Two months with the
same name and different histories get different offers, which is the property
[`history-window.test.ts`](../src/lib/history-window.test.ts) pins.

## Storage

Per-reader steady state, from the figures in [localisation-plan.md](localisation-plan.md):

| Plan  | Steady state (Latin / non-Latin) |
| ----- | -------------------------------- |
| Uno   | ~0.1 MB / ~0.2 MB                |
| Plura | ~1.2 MB / ~2.5 MB                |
| Omni  | ~5 MB / ~10 MB                   |

Grace costs a downgrader's **old** footprint for at most thirty extra days — under 5 MB
for an Omni leaver, released automatically. Nobody who has not downgraded pays anything
for it. Pruning `user_events` on the same boundary is a net reduction against what the
database did before this migration, which was keep every match row for ever.

## Tests

| File                                                                    | Covers                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`history-window.test.ts`](../src/lib/history-window.test.ts)           | 7/90/365, boundary arithmetic, month states, restore-plan selection             |
| [`server/history.test.ts`](../src/lib/server/history.test.ts)           | Window enforcement in every server-side read, against a fake PostgREST          |
| [`history-entitlement.test.ts`](../src/lib/history-entitlement.test.ts) | The migration: RLS predicate, grace trigger, purge cutoff, shared-corpus safety |
| [`security-invariants.test.ts`](../src/lib/security-invariants.test.ts) | `history_months` and `purge_expired_digests` are revoked from PUBLIC            |

`npm run verify:live` additionally proves that an anonymous client genuinely cannot
execute `history_months()` or `purge_expired_digests()` — a text test cannot tell a
working revoke from a useless one.
