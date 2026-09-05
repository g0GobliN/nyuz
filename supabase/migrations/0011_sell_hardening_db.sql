-- Sell-hardening: Postgres is the cap, not the UI.
--
-- Ask quota must survive parallel requests (select-then-insert is a race).
-- Topic cap must survive a browser client writing user_topics directly
-- (RLS only checks ownership). Numbers here must match PLAN_LIMITS in
-- src/lib/plans.ts.

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

drop trigger if exists enforce_topic_cap on public.user_topics;
create trigger enforce_topic_cap
  before insert or update on public.user_topics
  for each row execute function public.enforce_topic_cap();

create or replace function public.claim_ask(
  p_user_id uuid,
  p_event_id uuid,
  p_cap integer,
  p_cooldown_ms integer
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  used integer;
  last_at timestamptz;
begin
  if p_cap is null or p_cap <= 0 then
    return 'plan';
  end if;

  perform pg_advisory_xact_lock(
    ('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int,
    ('x' || substr(md5(p_user_id::text), 9, 8))::bit(32)::int
  );

  select count(*)::integer, max(created_at)
    into used, last_at
    from public.ask_log
   where user_id = p_user_id
     and created_at > now() - interval '24 hours';

  if coalesce(used, 0) >= p_cap then
    return 'quota';
  end if;

  if last_at is not null
     and last_at > now() - (interval '1 millisecond' * p_cooldown_ms) then
    return 'cooldown';
  end if;

  insert into public.ask_log (user_id, event_id)
  values (p_user_id, p_event_id);

  return 'ok';
end;
$fn$;

revoke all on function public.claim_ask(uuid, uuid, integer, integer) from public;
revoke all on function public.claim_ask(uuid, uuid, integer, integer) from anon;
revoke all on function public.claim_ask(uuid, uuid, integer, integer) from authenticated;
grant execute on function public.claim_ask(uuid, uuid, integer, integer) to service_role;

revoke all on function public.plan_topic_cap(text) from public;
revoke all on function public.plan_topic_cap(text) from anon;
revoke all on function public.plan_topic_cap(text) from authenticated;
grant execute on function public.plan_topic_cap(text) to service_role;
