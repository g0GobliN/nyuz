-- nyuz -- history entitlement, downgrade grace, and month metadata
--
-- Three separate things were true before this migration, and together they
-- made history both unbounded and unenforced:
--
--   1. Retention was a query filter. `loadHistory` computed `now() - N days`
--      in TypeScript and put it in a SELECT. Nothing else did -- not RLS, not
--      `loadDigestStories`, not `searchStories`, not `loadStory`. An old
--      digest id, a search term, or a direct Supabase query from the browser
--      all returned history the History page itself would refuse to show.
--
--   2. `purge_expired_digests` read the reader's plan AT PURGE TIME. A Plura
--      reader who dropped to Uno had ninety days of archive become deletable
--      the moment the webhook landed, and the next dormant() run took it.
--      Downgrading punished them twice: the entitlement AND the record.
--
--   3. `user_events` was never pruned at all. One row per matched event per
--      reader, for ever, for a window nobody may read.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix: one boundary, one grace, one purge
-- ---------------------------------------------------------------------------
--
-- `history_window_start(user)` is the single canonical answer to "how far back
-- may this reader read, right now". RLS calls it, the month RPC calls it, and
-- every server function calls it. 7/90/365 is written down once, in
-- `plan_history_days`, and never restated in application code.
--
-- Grace is deliberately NOT part of that boundary. A downgrade restricts
-- access immediately -- the window narrows the instant `subscriptions.plan`
-- changes -- while the rows themselves are kept for another thirty days. So
-- the archive stops being readable but does not visibly vanish, and an upgrade
-- inside the grace window widens `history_window_start` back over rows that
-- were never deleted. There is no restore job because there is nothing to
-- restore: access is a function of the current plan, applied to whatever still
-- exists.
--
-- The cost of that generosity is bounded and only paid by people who actually
-- had the higher tier. An account that has always been Uno has both grace
-- columns null, is purged at seven days exactly, and never accumulates a
-- hidden 90- or 365-day archive that an upgrade could retroactively reveal.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- `events` and `articles` stay globally readable to authenticated readers
-- (0002). They are shared canonical knowledge -- one row serves every reader
-- who matched it -- and gating them per-reader would be a different, much
-- larger change with a cost on the hottest read path in the product. What this
-- migration bounds is the PERSONAL layer: which digests exist for you, in what
-- order, with which `why_it_matters`, and which of them you may still open.
-- That is the thing a plan sells and the only thing a downgrade can take back.
--
-- Correspondingly, no per-user cleanup deletes a shared row. `purge_expired_digests`
-- touches `digests` and `user_events` and nothing else; `digest_items` follows
-- its parent digest by cascade. Expiring reader A's history cannot remove an
-- event reader B still has in tomorrow's briefing.
--
-- Safe to run twice: every function is `create or replace`, both columns are
-- `if not exists`, and both policies are dropped before being recreated.

begin;

-- ---------------------------------------------------------------------------
-- 1. The numbers, in one place
-- ---------------------------------------------------------------------------

-- Mirrors `PLAN_LIMITS[plan].retentionDays` in src/lib/plans.ts, which stays
-- the product's source of truth for display copy. This is the enforcement
-- copy, and it is the ONLY place in SQL where 7/90/365 appears.
create or replace function public.plan_history_days(p_plan public.plan_tier)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'omni'  then 365
    when 'plura' then 90
    else 7
  end;
$fn$;

comment on function public.plan_history_days(public.plan_tier) is
  'Days of briefing history a plan entitles: uno 7, plura 90, omni 365 (0067).';

/**
 * The canonical access boundary. Everything older than this is not readable by
 * this reader, whoever asks and however they ask.
 *
 * Exact-date arithmetic, never calendar months: a seven-day window that begins
 * on 31 August spans two month labels and that is a display concern, not an
 * entitlement one.
 *
 * SECURITY INVOKER on purpose. Under `authenticated`, the "own subscription"
 * policy from 0002 means the subquery can only ever find the caller's own row,
 * so asking for somebody else's window returns the Uno default and leaks
 * nothing about their plan. Under `service_role` -- the pipeline, and every
 * server function, which run with the admin client -- RLS is bypassed and the
 * real answer comes back. One function, correct for both callers, with no
 * definer to audit.
 *
 * No `set search_path` here, deliberately: every reference is schema-qualified,
 * and a function with a SET clause cannot be inlined by the planner. This one
 * is called from an RLS policy, where inlining is the difference between a
 * predicate and a per-row function call.
 */
create or replace function public.history_window_start(p_user uuid)
returns timestamptz
language sql
stable
as $fn$
  select now() - make_interval(days => public.plan_history_days(
    coalesce(
      (select s.plan from public.subscriptions s where s.user_id = p_user),
      'uno'::public.plan_tier
    )
  ));
$fn$;

comment on function public.history_window_start(uuid) is
  'Oldest readable history timestamp for a reader, from their CURRENT plan '
  '(0067). Downgrade grace never widens this -- grace delays deletion, not '
  'restriction.';

-- ---------------------------------------------------------------------------
-- 2. Downgrade grace
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists history_grace_until timestamptz,
  add column if not exists history_grace_days  smallint;

comment on column public.subscriptions.history_grace_until is
  'Set on a downgrade to now() + 30 days (0067). Until it passes, purge keeps '
  'the OLD plan''s reach so an upgrade can make that history readable again. '
  'Null for anyone who has never downgraded -- they accumulate nothing.';

comment on column public.subscriptions.history_grace_days is
  'The retention window being held open during grace: the plan they left, or '
  'the reach of an earlier unexpired grace, whichever is longer (0067).';

/**
 * Grace is decided by the database, not by the webhook.
 *
 * Every path that can change a plan goes through an UPDATE on this table --
 * `customer.subscription.updated`, `customer.subscription.deleted` dropping to
 * uno, the payment-failure path where `entitlementPlan` demotes a past_due
 * reader, and any hand-run SQL. Putting the rule in application code would
 * mean writing it four times and having it drift three.
 *
 * The three cases:
 *
 *   downgrade    - hold the plan they are leaving (or a longer grace already
 *                  running) for thirty more days.
 *   upgrade that - clear it. The new plan's own window now reaches at least as
 *   covers grace   far back, so there is nothing left to hold open.
 *   upgrade that - keep the existing deadline untouched. Omni -> Uno -> Plura
 *   does not      still has rows aged 90-365 days that only Omni can read, and
 *                  a further upgrade inside the original grace should still
 *                  find them.
 *
 * A second downgrade restarts the thirty days rather than extending the first
 * deadline arbitrarily -- bounded, and the same clock the reader was just told
 * about.
 */
create or replace function public.apply_history_grace()
returns trigger
language plpgsql
as $fn$
declare
  old_days integer;
  new_days integer;
  carried  integer;
begin
  if new.plan is not distinct from old.plan then
    return new;
  end if;

  old_days := public.plan_history_days(old.plan);
  new_days := public.plan_history_days(new.plan);
  carried  := case
    when old.history_grace_until > now() then coalesce(old.history_grace_days, 0)
    else 0
  end;

  if new_days < old_days then
    new.history_grace_days  := greatest(old_days, carried);
    new.history_grace_until := now() + make_interval(days => 30);
  elsif new_days >= carried then
    new.history_grace_days  := null;
    new.history_grace_until := null;
  else
    new.history_grace_days  := old.history_grace_days;
    new.history_grace_until := old.history_grace_until;
  end if;

  return new;
end;
$fn$;

drop trigger if exists subscriptions_history_grace on public.subscriptions;
create trigger subscriptions_history_grace
  before update on public.subscriptions
  for each row execute function public.apply_history_grace();

-- ---------------------------------------------------------------------------
-- 3. Month metadata
-- ---------------------------------------------------------------------------

/**
 * The one thing permitted to look past `history_window_start`, and the only
 * reason it may is that it returns no content: a month, its local bounds, how
 * many briefings inside it are still readable, and -- for the ones that are
 * not -- the newest and oldest timestamps of what is being held. No titles, no
 * digest ids, no bodies. Enough for the page to say "August 2026, locked" and
 * to work out honestly which plan would bring it back, and nothing more.
 *
 * Months are bucketed in the READER's timezone, not the server's. A briefing
 * scheduled 00:30 on 1 September UTC belongs to August for a reader in New
 * York, and a month list that disagrees with the dates printed inside it is a
 * bug report waiting to happen. Bucketing here, in SQL, is also what lets the
 * day query stay a plain range scan: it hands back `starts_at`/`ends_at`
 * already resolved, so no caller has to do timezone arithmetic in JavaScript.
 *
 * SECURITY DEFINER because the digests policy below now hides exactly the rows
 * this needs to count, and revoked from everyone but `service_role` because the
 * only legitimate caller is a server function.
 */
create or replace function public.history_months(p_user uuid)
returns table (
  month_key        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  available        integer,
  locked_newest_at timestamptz,
  locked_oldest_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  with reader_zone as (
    select coalesce(
      (select nullif(np.timezone, '') from public.notification_preferences np
        where np.user_id = p_user),
      'UTC'
    ) as tz
  ),
  bounds as (
    select public.history_window_start(p_user) as window_start
  ),
  briefing as (
    select d.scheduled_for,
           date_trunc('month', d.scheduled_for at time zone (select tz from reader_zone)) as local_month
      from public.digests d
     where d.user_id = p_user
       and d.kind = 'briefing'
       and d.status in ('ready', 'sent', 'skipped')
  )
  select
    to_char(r.local_month, 'YYYY-MM'),
    (r.local_month at time zone (select tz from reader_zone)),
    ((r.local_month + interval '1 month') at time zone (select tz from reader_zone)),
    count(*) filter (
      where r.scheduled_for >= (select window_start from bounds)
    )::integer,
    max(r.scheduled_for) filter (
      where r.scheduled_for < (select window_start from bounds)
    ),
    min(r.scheduled_for) filter (
      where r.scheduled_for < (select window_start from bounds)
    )
  from briefing r
  group by r.local_month
  order by r.local_month desc;
$fn$;

comment on function public.history_months(uuid) is
  'Month metadata for the History page (0067). Returns counts and bounds only, '
  'never content -- it is the single call allowed to see past '
  'history_window_start, so that locked months can be labelled without being '
  'readable.';

-- ---------------------------------------------------------------------------
-- 4. The access boundary, enforced
-- ---------------------------------------------------------------------------
--
-- `plan-state.ts` reads `subscriptions` straight from the browser, so this
-- project already treats the browser as a first-class Postgres client. That
-- makes a React-side filter worth nothing: a downgraded reader with the
-- anon key and their own JWT could select their old digests directly. These
-- two policies are what actually stop it.
--
-- The `(select ...)` wrapper is load-bearing. Written bare, the helper is
-- re-evaluated per candidate row; wrapped, the planner hoists it into an
-- InitPlan and calls it once per query -- which matters on an Omni reader's
-- 365-day archive.
--
-- Server functions run with the service-role client and bypass all of this by
-- design, which is why §8's explicit filters in briefing.ts are not optional.
-- Two layers, each sufficient for the caller it governs.

drop policy if exists "own digests" on public.digests;
create policy "own digests" on public.digests
  for select using (
    auth.uid() = user_id
    and scheduled_for >= (select public.history_window_start(auth.uid()))
  );

-- Restated rather than left to inherit through the parent's policy: relying on
-- nested RLS to carry an entitlement is the kind of correctness that survives
-- until someone rewrites the outer policy.
drop policy if exists "own digest items" on public.digest_items;
create policy "own digest items" on public.digest_items
  for select using (
    exists (
      select 1 from public.digests d
      where d.digest_id = digest_items.digest_id
        and d.user_id = auth.uid()
        and d.scheduled_for >= (select public.history_window_start(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Purge: current entitlement, unless grace is holding the door
-- ---------------------------------------------------------------------------

/**
 * Deletes only user-specific history:
 *
 *   digests       - and `digest_items` with them, by cascade (0001).
 *   user_events   - the match records, previously never pruned at all.
 *
 * It does NOT touch `events` or `articles`. Reader A's window expiring says
 * nothing about whether reader B is about to be sent the same event, and the
 * shared corpus has its own age-based job below.
 *
 * Saved stories are exempt from the `user_events` sweep: a bookmarked story
 * keeps its "why you're seeing this" rather than degrading the moment the
 * matching history ages out. `saved_stories` itself is never touched here at
 * all -- saving is a decision the reader made and only the reader unmakes it.
 *
 * Bounded by `p_limit` on both sweeps and ordered oldest-first, so a backlog
 * drains deterministically across runs instead of one call trying to delete a
 * year of a thousand accounts.
 */
create or replace function public.purge_expired_digests(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer := 0;
  changed integer := 0;
begin
  with cutoff as (
    select s.user_id,
           now() - make_interval(days => case
             when s.history_grace_until > now()
               then greatest(public.plan_history_days(s.plan), coalesce(s.history_grace_days, 0))
             else public.plan_history_days(s.plan)
           end) as expires_before
      from public.subscriptions s
  ),
  expired as (
    select d.digest_id
      from public.digests d
      join cutoff c on c.user_id = d.user_id
     where d.status in ('ready', 'sent', 'skipped', 'failed')
       and d.scheduled_for < c.expires_before
     order by d.scheduled_for asc
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  delete from public.digests d
   using expired e
   where d.digest_id = e.digest_id;
  get diagnostics changed = row_count;
  removed := removed + changed;

  with cutoff as (
    select s.user_id,
           now() - make_interval(days => case
             when s.history_grace_until > now()
               then greatest(public.plan_history_days(s.plan), coalesce(s.history_grace_days, 0))
             else public.plan_history_days(s.plan)
           end) as expires_before
      from public.subscriptions s
  ),
  expired as (
    select ue.user_id, ue.event_id
      from public.user_events ue
      join cutoff c on c.user_id = ue.user_id
     where ue.matched_at < c.expires_before
       and not exists (
         select 1 from public.saved_stories sv
          where sv.user_id = ue.user_id
            and sv.event_id = ue.event_id
       )
     order by ue.matched_at asc
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  delete from public.user_events ue
   using expired e
   where ue.user_id = e.user_id
     and ue.event_id = e.event_id;
  get diagnostics changed = row_count;
  removed := removed + changed;

  return removed;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Shared corpus: 400 days -> 420
-- ---------------------------------------------------------------------------
--
-- Restated from 0045 with one number changed. Omni's 365-day entitlement plus
-- a 30-day downgrade grace reaches 395 days, and `digest_items` cascades from
-- `events` -- so at 400 the corpus job was five days from silently hollowing
-- out digests that the reader is still entitled to open. 420 restores a
-- month of margin. Saved stories remain exempt, as before.

create or replace function public.purge_expired_corpus(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  expired_ids uuid[];
  removed integer := 0;
  changed integer := 0;
begin
  select array_agg(id) into expired_ids
    from (
      select e.id
        from public.events e
       where e.last_updated_at < now() - interval '420 days'
         and not exists (
           select 1 from public.saved_stories s where s.event_id = e.id
         )
       order by e.last_updated_at asc
       limit greatest(1, least(coalesce(p_limit, 500), 5000))
       for update skip locked
    ) old_events;

  if coalesce(array_length(expired_ids, 1), 0) > 0 then
    delete from public.articles where event_id = any(expired_ids);
    get diagnostics changed = row_count;
    removed := removed + changed;

    delete from public.events where id = any(expired_ids);
    get diagnostics changed = row_count;
    removed := removed + changed;
  end if;

  with old_articles as (
    select id
      from public.articles
     where event_id is null
       and coalesce(published_at, fetched_at) < now() - interval '420 days'
     order by coalesce(published_at, fetched_at) asc
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  delete from public.articles a
   using old_articles old
   where a.id = old.id;
  get diagnostics changed = row_count;
  removed := removed + changed;

  return removed;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
--
-- `create function` grants EXECUTE to PUBLIC, which anon and authenticated
-- inherit -- so a revoke naming only those two roles is decoration (0036).
-- Every revoke here names PUBLIC.
--
-- The two exceptions are deliberate: `authenticated` MUST be able to execute
-- `history_window_start` and `plan_history_days`, because the digests policy
-- calls them on the reader's behalf. Without those grants every browser read
-- of `digests` fails with a permission error instead of a filtered result.

revoke all on function public.plan_history_days(public.plan_tier) from public, anon;
grant execute on function public.plan_history_days(public.plan_tier)
  to authenticated, service_role;

revoke all on function public.history_window_start(uuid) from public, anon;
grant execute on function public.history_window_start(uuid) to authenticated, service_role;

revoke all on function public.history_months(uuid) from public, anon, authenticated;
grant execute on function public.history_months(uuid) to service_role;

revoke all on function public.apply_history_grace() from public, anon, authenticated;
grant execute on function public.apply_history_grace() to service_role;

revoke all on function public.purge_expired_digests(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_digests(integer) to service_role;

revoke all on function public.purge_expired_corpus(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_corpus(integer) to service_role;

commit;
