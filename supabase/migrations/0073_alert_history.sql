-- nyuz -- alert history as its own entitlement
--
-- Breaking alerts are `digests` rows with `kind = 'alert'` (0009), and that
-- stays true here. One table means one purge, one set of indexes, and one
-- delivery ledger; a second table would duplicate all three to express a
-- distinction that is really about a number.
--
-- What was wrong is that alerts also BORROWED the briefing number. Two
-- separate problems came out of that:
--
--   1. `history_window_start()` answered "how far back may this reader read"
--      for alerts and briefings alike, so alert retention could not be moved
--      without moving briefing retention with it.
--
--   2. The Alerts page asked for no window at all. `loadRecentAlerts` runs on
--      the service-role client, where RLS is bypassed, and it was the only
--      reader of personal history that never called the boundary function --
--      `loadHistory`, `loadDigestStories`, `searchStories` and `loadStory` all
--      do. A Plura reader who dropped to Uno kept seeing alert titles the
--      story page would then refuse to open.
--
-- So this splits the number without splitting the table:
--
--   plan_alert_days()    uno 0, plura 90, omni 365
--   plan_history_days()  uno 7, plura 90, omni 365   (0067, untouched)
--
-- They agree for plura and omni today. They are two functions so that changing
-- one is a one-line change that cannot silently move the other.
--
-- Uno is 0 rather than 7 because Uno has no breaking alerts at all --
-- `claim_alert` (0037) returns 'plan' before anything is written -- so there is
-- no such thing as Uno alert history, and a seven-day window would imply there
-- was one waiting to be filled.
--
-- ---------------------------------------------------------------------------
-- Deletion is deliberately NOT split here
-- ---------------------------------------------------------------------------
--
-- `purge_expired_digests` still deletes every digest, alert or briefing, past
-- `plan_history_days`, with the same 30-day downgrade grace. That is correct
-- for exactly as long as `plan_alert_days <= plan_history_days` holds for every
-- plan -- 0<=7, 90<=90, 365<=365 -- because it means a row is never deleted
-- while it is still readable.
--
-- Raising alert retention ABOVE briefing retention breaks that, and would
-- delete alerts the entitlement still promises. The purge must learn `kind`
-- BEFORE that number moves. The invariant is asserted in
-- src/lib/plans-limits.test.ts so it fails a test run rather than quietly
-- shortening somebody's alert history, and it is stated again above
-- `alertRetentionDays` in src/lib/plans.ts.
--
-- Not touched on purpose: alert detection, the importance floor, the daily
-- caps, briefing generation, briefing retention, and the corpus purge.
--
-- Safe to run twice: every function is `create or replace` and both policies
-- are dropped before being recreated.

begin;

-- ---------------------------------------------------------------------------
-- 1. The number, in one place
-- ---------------------------------------------------------------------------

-- Mirrors `PLAN_LIMITS[plan].alertRetentionDays` in src/lib/plans.ts, which is
-- the display copy. This is the enforcement copy, and the only place in SQL
-- where 0/90/365 appears for alerts.
create or replace function public.plan_alert_days(p_plan public.plan_tier)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'omni'  then 365
    when 'plura' then 90
    else 0
  end;
$fn$;

comment on function public.plan_alert_days(public.plan_tier) is
  'Days of breaking-alert history a plan entitles: uno 0, plura 90, omni 365 (0073). '
  'Deliberately separate from plan_history_days even where the numbers agree.';

/**
 * The canonical alert access boundary, in the shape of `history_window_start`.
 *
 * Grace is not part of it, for the same reason it is not part of the briefing
 * boundary (0067): a downgrade narrows access immediately while the rows
 * survive, so an upgrade inside the grace window widens the window back over
 * rows that were never deleted.
 *
 * Uno lands on `now()`, which excludes every row rather than the last zero
 * days of them. That is the intended reading of "this plan has no alert
 * history".
 *
 * SECURITY INVOKER, like its briefing counterpart: under `authenticated` the
 * subscriptions policy means the subquery can only find the caller's own row,
 * so asking about somebody else returns the uno default and leaks nothing.
 */
create or replace function public.alert_window_start(p_user uuid)
returns timestamptz
language sql
stable
as $fn$
  select now() - make_interval(days => public.plan_alert_days(
    coalesce(
      (select s.plan from public.subscriptions s where s.user_id = p_user),
      'uno'::public.plan_tier
    )
  ));
$fn$;

comment on function public.alert_window_start(uuid) is
  'Oldest breaking alert this reader may read, right now (0073).';

-- ---------------------------------------------------------------------------
-- 2. The policies, branching on kind
-- ---------------------------------------------------------------------------

-- The window functions stay inside `(select ...)` so each is an InitPlan
-- evaluated once per statement rather than once per row. The CASE is on `kind`,
-- which is `not null default 'briefing'` (0009), so there is no third branch to
-- get wrong.
drop policy if exists "own digests" on public.digests;
create policy "own digests" on public.digests
  for select using (
    auth.uid() = user_id
    and scheduled_for >= case kind
      when 'alert' then (select public.alert_window_start(auth.uid()))
      else (select public.history_window_start(auth.uid()))
    end
  );

-- Restated rather than left to inherit through the parent's policy, for the
-- reason 0067 gives: relying on nested RLS to carry an entitlement is the kind
-- of correctness that survives until someone rewrites the outer policy.
drop policy if exists "own digest items" on public.digest_items;
create policy "own digest items" on public.digest_items
  for select using (
    exists (
      select 1 from public.digests d
      where d.digest_id = digest_items.digest_id
        and d.user_id = auth.uid()
        and d.scheduled_for >= case d.kind
          when 'alert' then (select public.alert_window_start(auth.uid()))
          else (select public.history_window_start(auth.uid()))
        end
    )
  );

commit;
