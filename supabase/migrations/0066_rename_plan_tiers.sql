-- nyuz -- rename plan_tier labels
--
--   'free'     -> 'uno'      (nyuz Uno)
--   'personal' -> 'plura'    (nyuz Plura)
--   'pro'      -> 'omni'     (nyuz Omni)
--
-- Renaming an enum label rewrites the label in place: every stored value in
-- public.subscriptions.plan and public.billing_ledger.plan follows it, and so
-- do the column default and the `check (plan <> 'free')` constraint, because
-- both are stored as a reference to the enum member rather than as its text.
-- So there is no UPDATE here, and there must not be one -- an
-- `update ... set plan = 'uno'` before the rename would fail on an enum that
-- has no 'uno' member yet.
--
-- What does NOT follow the rename is a plan name written as a literal inside a
-- function body. Those are re-parsed on every call, so the moment 'pro' stops
-- being a label, every function below starts raising
-- `invalid input value for enum plan_tier`. Each one is restated at its latest
-- definition, with the migration it came from named so the two stay in step.
--
-- Safe to run twice: the renames are guarded, and every function is a
-- `create or replace`.

begin;

-- ---------------------------------------------------------------------------
-- 1. The labels
-- ---------------------------------------------------------------------------

do $rename$
begin
  if exists (
    select 1 from pg_enum e
     where e.enumtypid = 'public.plan_tier'::regtype and e.enumlabel = 'free'
  ) then
    alter type public.plan_tier rename value 'free' to 'uno';
  end if;

  if exists (
    select 1 from pg_enum e
     where e.enumtypid = 'public.plan_tier'::regtype and e.enumlabel = 'personal'
  ) then
    alter type public.plan_tier rename value 'personal' to 'plura';
  end if;

  if exists (
    select 1 from pg_enum e
     where e.enumtypid = 'public.plan_tier'::regtype and e.enumlabel = 'pro'
  ) then
    alter type public.plan_tier rename value 'pro' to 'omni';
  end if;
end
$rename$;

-- ---------------------------------------------------------------------------
-- 2. Topic cap (0011)
-- ---------------------------------------------------------------------------

create or replace function public.plan_topic_cap(p_plan text)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'omni' then null
    when 'plura' then 15
    else 3
  end;
$fn$;

create or replace function public.enforce_topic_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  plan text;
  cap integer;
  used integer;
begin
  if tg_op = 'UPDATE' then
    if new.muted is true then
      return new;
    end if;
    if old.muted is false and new.user_id = old.user_id then
      return new;
    end if;
  elsif new.muted is true then
    return new;
  end if;

  select s.plan into plan
    from public.subscriptions s
   where s.user_id = new.user_id;

  cap := public.plan_topic_cap(coalesce(plan, 'uno'));
  if cap is null then
    return new;
  end if;

  select count(*)::integer into used
    from public.user_topics
   where user_id = new.user_id
     and muted = false
     and (tg_op = 'INSERT' or topic_id is distinct from new.topic_id);

  if coalesce(used, 0) >= cap then
    raise exception 'topic cap exceeded';
  end if;
  return new;
end;
$fn$;

revoke all on function public.plan_topic_cap(text) from public, anon, authenticated;
grant execute on function public.plan_topic_cap(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Priority-source cap and digest retention (0017)
-- ---------------------------------------------------------------------------

create or replace function public.plan_priority_source_cap(p_plan text)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'omni' then null
    when 'plura' then 15
    else 3
  end;
$fn$;

create or replace function public.enforce_priority_source_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  plan text;
  cap integer;
  used integer;
begin
  if new.pref <> 'priority' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.pref = 'priority' and new.user_id = old.user_id then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := now();
  end if;

  select s.plan into plan
    from public.subscriptions s
   where s.user_id = new.user_id;
  cap := public.plan_priority_source_cap(coalesce(plan, 'uno'));
  if cap is null then
    return new;
  end if;

  select count(*)::integer into used
    from public.user_source_prefs p
   where p.user_id = new.user_id
     and p.pref = 'priority'
     and (tg_op = 'INSERT' or p.source_id is distinct from new.source_id);

  if coalesce(used, 0) >= cap then
    raise exception 'priority source cap exceeded';
  end if;
  return new;
end;
$fn$;

create or replace function public.purge_expired_digests(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer;
begin
  with expired as (
    select d.digest_id
      from public.digests d
      join public.subscriptions s on s.user_id = d.user_id
     where d.status in ('ready', 'sent', 'skipped', 'failed')
        and d.scheduled_for < now() - make_interval(days => case s.plan
          when 'omni' then 365
          when 'plura' then 90
          else 7
        end)
     order by d.scheduled_for asc
     limit greatest(1, least(p_limit, 5000))
  )
  delete from public.digests d
   using expired e
   where d.digest_id = e.digest_id;
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

revoke all on function public.plan_priority_source_cap(text) from public, anon, authenticated;
grant execute on function public.plan_priority_source_cap(text) to service_role;
revoke all on function public.purge_expired_digests(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_digests(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Custom sources and source demand (0030, latest definitions)
-- ---------------------------------------------------------------------------

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
           when 'omni'  then 25
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

create or replace function public.admin_source_demand()
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

revoke execute on function public.claim_custom_source(uuid, uuid) from anon, authenticated;
revoke execute on function public.admin_source_demand() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Alert ceilings and source probes (0045, latest definitions)
-- ---------------------------------------------------------------------------

create or replace function public.claim_alert(
  p_user_id uuid,
  p_event_id uuid,
  p_importance real
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  user_plan text;
  used integer;
  cap integer;
begin
  select s.plan into user_plan
    from public.subscriptions s
   where s.user_id = p_user_id;
  user_plan := coalesce(user_plan, 'uno');

  if user_plan = 'uno' then
    return 'plan';
  elsif user_plan = 'plura' then
    -- Plura alerts only on what it would be a problem to miss. This floor,
    -- not the cap, is what keeps the daily count near zero.
    if p_importance < 6 then return 'importance'; end if;
    cap := 10;
  else
    cap := 25;
  end if;

  perform pg_advisory_xact_lock(
    ('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int,
    ('x' || substr(md5(p_user_id::text), 9, 8))::bit(32)::int
  );

  if exists (
    select 1 from public.alert_claims
     where user_id = p_user_id and event_id = p_event_id
  ) then
    return 'duplicate';
  end if;

  select count(*)::integer into used
    from public.alert_claims
   where user_id = p_user_id
     and created_at > now() - interval '24 hours';
  if coalesce(used, 0) >= cap then return 'quota'; end if;

  insert into public.alert_claims (user_id, event_id)
  values (p_user_id, p_event_id);
  return 'ok';
end;
$fn$;

create or replace function public.claim_source_probe(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  user_plan text;
  cap integer;
  used integer;
  recent integer;
begin
  if p_user_id is null then return 'plan'; end if;
  perform pg_advisory_xact_lock(hashtext('source_probe:' || p_user_id::text));

  select plan into user_plan from public.subscriptions where user_id = p_user_id;
  cap := case coalesce(user_plan, 'uno')
           when 'omni' then 25
           when 'plura' then 5
           else 0
         end;
  if cap <= 0 then return 'plan'; end if;

  select count(*) into used
    from public.user_custom_sources
   where user_id = p_user_id;
  if used >= cap then return 'limit'; end if;

  delete from public.source_probe_log
   where user_id = p_user_id
     and created_at < now() - interval '24 hours';

  select count(*) into recent
    from public.source_probe_log
   where user_id = p_user_id
     and created_at > now() - interval '1 hour';
  if recent >= 5 then return 'rate'; end if;

  insert into public.source_probe_log(user_id) values (p_user_id);
  return 'ok';
end;
$fn$;

-- 0036's lesson: `revoke ... from anon, authenticated` leaves the default
-- PUBLIC grant in place and reads like a lock while doing nothing.
revoke all on function public.claim_alert(uuid, uuid, real)
  from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real) to service_role;
revoke all on function public.claim_source_probe(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_source_probe(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Topic demand (0049)
-- ---------------------------------------------------------------------------

create or replace function public.admin_topic_demand(p_days integer default 14)
returns table (
  topic_id       uuid,
  slug           text,
  label          text,
  kind           public.topic_kind,
  followers      integer,
  paid_followers integer,
  mapped_sources integer,
  recent_events  integer
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
  followed as (
    select ut.topic_id,
           count(distinct e.user_id)::integer as followers,
           count(distinct e.user_id) filter (where e.plan is distinct from 'uno')::integer
             as paid_followers
      from public.user_topics ut
      join eligible e on e.user_id = ut.user_id
     where ut.muted = false
     group by ut.topic_id
  ),
  mapped as (
    select st.topic_id, count(*)::integer as n
      from public.source_topics st
     group by st.topic_id
  ),
  recent as (
    select ev.id, ev.tags
      from public.events ev
     where ev.first_seen_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)))
  ),
  -- Both routes to an event, unioned rather than added, so an event reached by
  -- classification AND by tags counts once.
  reach as (
    select et.topic_id, et.event_id
      from public.event_topics et
      join recent r on r.id = et.event_id
    union
    select t.id, r.id
      from public.topics t
      join recent r on r.tags @> t.terms
     where t.terms <> '{}'
  ),
  reached as (
    select topic_id, count(*)::integer as n from reach group by topic_id
  )
  select t.id, t.slug, t.label, t.kind,
         coalesce(f.followers, 0),
         coalesce(f.paid_followers, 0),
         coalesce(m.n, 0),
         coalesce(rc.n, 0)
    from public.topics t
    left join followed f  on f.topic_id  = t.id
    left join mapped   m  on m.topic_id  = t.id
    left join reached  rc on rc.topic_id = t.id;
$fn$;

revoke all on function public.admin_topic_demand(integer)
  from public, anon, authenticated;
grant execute on function public.admin_topic_demand(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The console's price row is keyed by plan name in JSON
-- ---------------------------------------------------------------------------
--
-- `billing.prices` is a jsonb object whose keys are plan names, so unlike the
-- enum it does not rename itself. Rekeyed in place, keeping whatever figures
-- the operator actually set rather than resetting to the bundled defaults.
-- Must match pricesSchema in src/lib/site-content.ts.

update public.site_settings
   set value = (value - 'free' - 'personal' - 'pro' - 'personalAnnual' - 'proAnnual')
             || jsonb_build_object(
                  'uno',         coalesce(value -> 'free',           to_jsonb(0)),
                  'plura',       coalesce(value -> 'personal',       to_jsonb(14.99)),
                  'omni',        coalesce(value -> 'pro',            to_jsonb(29.99)),
                  'pluraAnnual', coalesce(value -> 'personalAnnual', to_jsonb(149.90)),
                  'omniAnnual',  coalesce(value -> 'proAnnual',      to_jsonb(299.90))
                ),
       updated_at = now()
 where key = 'billing.prices'
   -- jsonb_exists rather than the `?` operator: some SQL clients read a bare
   -- `?` as a bind placeholder and never send the statement.
   and (jsonb_exists(value, 'free')
        or jsonb_exists(value, 'personal')
        or jsonb_exists(value, 'pro')
        or jsonb_exists(value, 'personalAnnual')
        or jsonb_exists(value, 'proAnnual'));

commit;
