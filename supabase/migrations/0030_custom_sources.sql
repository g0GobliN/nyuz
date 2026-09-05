-- nyuz -- reader-requested sources (docs/plan2.md phase 3b, sections 12-14, 62)
--
-- A paid reader can ask nyuz to monitor a feed. The source itself stays
-- GLOBAL: two readers following the same URL share one row in `sources` and
-- therefore one crawler, one clustering pass and one analysis. Never
-- `alice_example_feed` and `bob_example_feed` for the same canonical URL --
-- that would make the product more expensive exactly as overlap increases,
-- which is the inverse of the property everything else here protects.
--
--   sources              example.com/feed -> source_xyz
--   user_custom_sources  alice -> source_xyz
--                        bob   -> source_xyz
--
-- ---------------------------------------------------------------------------
-- Why the cap is a function and not a policy
-- ---------------------------------------------------------------------------
--
-- RLS can express "this row is yours". It cannot express "you may have five
-- of these" without a subquery that races: two concurrent inserts both see
-- four existing rows and both succeed, and the reader now has six. The same
-- reasoning already produced `claim_alert` (0017) and `claim_ask`, so this
-- follows them exactly -- one function, holding a lock, deciding.
--
-- The cap lives here in SQL rather than being read from src/lib/plans.ts
-- because a number the browser can read is a display value. PLAN_LIMITS
-- .customSources and this function must agree; the test suite asserts the
-- pairing (plan2 section 91: "browser/client manipulation cannot bypass
-- backend enforcement").
--
-- ---------------------------------------------------------------------------
-- Deletion is a real delete, unlike sources
-- ---------------------------------------------------------------------------
--
-- Unfollowing removes the `user_custom_sources` row. It does NOT delete the
-- `sources` row, even when nobody is left following it: articles reference it
-- (`on delete set null`), and a source with zero followers is exactly the
-- "demand reaches zero" case phase 5/6 handle by pausing collection, with a
-- grace period, rather than by destroying history.

create table public.user_custom_sources (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  source_id  uuid        not null references public.sources (id)  on delete cascade,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

-- "Who follows this source" -- the demand calculation's access pattern.
create index user_custom_sources_source_idx on public.user_custom_sources (source_id);

comment on table public.user_custom_sources is
  'Which readers asked for which global source. The source is shared: many '
  'followers, one crawler. See docs/track.md phase 3b.';

alter table public.user_custom_sources enable row level security;

-- A reader reads and unfollows their own. There is deliberately no INSERT
-- policy: adding a follow has to go through claim_custom_source below, which
-- is where the plan cap is enforced. An insert policy would be a way around it.
create policy "own custom sources" on public.user_custom_sources
  for select to authenticated using (auth.uid() = user_id);

create policy "drop own custom sources" on public.user_custom_sources
  for delete to authenticated using (auth.uid() = user_id);

create policy "pause own custom sources" on public.user_custom_sources
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The claim
-- ---------------------------------------------------------------------------
--
-- Returns 'ok', 'limit', or 'exists'. Three outcomes rather than a boolean
-- because the caller has three different things to tell the reader, and
-- "already following this" is not a failure.
--
-- `security definer` so it can read `subscriptions` (which the caller may
-- read only their own row of) and write `user_custom_sources` (which has no
-- insert policy at all). The advisory lock is per user, so two readers adding
-- sources at the same time do not serialise against each other -- only one
-- reader's own concurrent requests do, which is exactly the race being closed.

create or replace function public.claim_custom_source(
  p_user_id   uuid,
  p_source_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  user_plan text;
  cap       integer;
  used      integer;
begin
  -- Serialise this reader's own concurrent adds. hashtext is stable within a
  -- database, which is all a transaction-scoped advisory lock needs.
  perform pg_advisory_xact_lock(hashtext('custom_source:' || p_user_id::text));

  if exists (
    select 1 from public.user_custom_sources
     where user_id = p_user_id and source_id = p_source_id
  ) then
    return 'exists';
  end if;

  select plan into user_plan from public.subscriptions where user_id = p_user_id;

  -- Must match PLAN_LIMITS.customSources in src/lib/plans.ts. An unknown or
  -- missing plan is treated as uno: a reader with no subscription row is not
  -- a reader with unlimited crawlers.
  cap := case coalesce(user_plan, 'uno')
           when 'omni'      then 25
           when 'plura' then 5
           else 0
         end;

  if cap <= 0 then
    return 'limit';
  end if;

  select count(*) into used
    from public.user_custom_sources
   where user_id = p_user_id;

  if used >= cap then
    return 'limit';
  end if;

  insert into public.user_custom_sources (user_id, source_id)
  values (p_user_id, p_source_id);

  return 'ok';
end;
$fn$;

revoke execute on function public.claim_custom_source(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Demand now includes direct followers
-- ---------------------------------------------------------------------------
--
-- 0020 counted only topic interest, because custom sources did not exist.
-- A reader who explicitly asked for a source is the strongest possible demand
-- signal for it, so it is counted here -- and counted with the same
-- eligibility rules (not paused, not auto-paused for inactivity, not banned)
-- rather than a second definition of "active reader" (plan2 section 17).

-- Dropped rather than replaced: this adds `direct_followers` to the return
-- table, and Postgres refuses `create or replace` when the return type
-- changes ("cannot change return type of existing function"). The whole
-- migration is one transaction, so there is no window where the function is
-- missing.
drop function if exists public.admin_source_demand();

create function public.admin_source_demand()
returns table (
  source_id             uuid,
  interested_users      integer,
  paid_interested_users integer,
  direct_followers      integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select p.id as user_id, coalesce(s.plan, 'uno') as plan
      from public.profiles p
      join public.notification_preferences np on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id and (au.banned_until is null or au.banned_until < now())
      left join public.subscriptions s on s.user_id = p.id
     where p.auto_paused_at is null
  ),
  by_topic as (
    select st.source_id, e.user_id, e.plan
      from public.source_topics st
      join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
      join eligible e on e.user_id = ut.user_id
  ),
  by_follow as (
    select ucs.source_id, e.user_id, e.plan
      from public.user_custom_sources ucs
      join eligible e on e.user_id = ucs.user_id
     where ucs.active = true
  ),
  combined as (
    select * from by_topic
    union
    select * from by_follow
  )
  select
    s.id,
    count(distinct c.user_id)::integer,
    count(distinct c.user_id) filter (where c.plan is distinct from 'uno')::integer,
    (select count(distinct f.user_id)::integer from by_follow f where f.source_id = s.id)
  from public.sources s
  left join combined c on c.source_id = s.id
  group by s.id;
$fn$;

revoke execute on function public.admin_source_demand() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The pre-analysis gate learns about follows too
-- ---------------------------------------------------------------------------
--
-- Same change, one stage later: an event from a source somebody explicitly
-- asked for has demand by definition, whatever its topics say.

create or replace function public.events_with_demand(p_event_ids uuid[])
returns table (event_id uuid, has_demand boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    e.id,
    exists (
      select 1
      from public.articles a
      join public.sources s on s.id = a.source_id
      where a.event_id = e.id and s.coverage_mode = 'core'
    )
    or exists (
      select 1
      from public.articles a
      join public.source_topics st on st.source_id = a.source_id
      join public.user_topics   ut on ut.topic_id  = st.topic_id and ut.muted = false
      join public.profiles p
        on p.id = ut.user_id and p.auto_paused_at is null
      join public.notification_preferences np
        on np.user_id = ut.user_id and np.paused = false
      join auth.users au
        on au.id = ut.user_id and (au.banned_until is null or au.banned_until < now())
      where a.event_id = e.id
    )
    or exists (
      select 1
      from public.articles a
      join public.user_custom_sources ucs on ucs.source_id = a.source_id and ucs.active = true
      join public.profiles p
        on p.id = ucs.user_id and p.auto_paused_at is null
      join public.notification_preferences np
        on np.user_id = ucs.user_id and np.paused = false
      join auth.users au
        on au.id = ucs.user_id and (au.banned_until is null or au.banned_until < now())
      where a.event_id = e.id
    )
  from public.events e
  where e.id = any(p_event_ids);
$fn$;

revoke execute on function public.events_with_demand(uuid[]) from anon, authenticated;
