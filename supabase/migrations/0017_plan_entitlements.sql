-- Launch entitlements: source priority and alert limits are database-enforced.
-- UI checks are guidance; these triggers/RPCs are the boundary for direct writes
-- and concurrent alert runs.

alter table public.user_source_prefs
  add column if not exists created_at timestamptz not null default now();

alter table public.profiles
  add column if not exists auto_paused_at timestamptz;

alter table public.user_events
  add column if not exists briefed_at timestamptz;

update public.user_events ue
   set briefed_at = seen.briefed_at
  from (
    select d.user_id, di.event_id, max(coalesce(d.generated_at, d.scheduled_for)) as briefed_at
      from public.digest_items di
      join public.digests d on d.digest_id = di.digest_id
     group by d.user_id, di.event_id
  ) seen
 where ue.user_id = seen.user_id
   and ue.event_id = seen.event_id
   and ue.briefed_at is null;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.id                 := old.id;
  new.email              := old.email;
  new.created_at         := old.created_at;
  new.welcomed_at        := old.welcomed_at;
  new.paused_notified_at := old.paused_notified_at;
  new.auto_paused_at     := old.auto_paused_at;
  return new;
end;
$fn$;

create or replace function public.plan_priority_source_cap(p_plan text)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'pro' then null
    when 'personal' then 15
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
  cap := public.plan_priority_source_cap(coalesce(plan, 'free'));
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

drop trigger if exists enforce_priority_source_cap on public.user_source_prefs;
create trigger enforce_priority_source_cap
  before insert or update on public.user_source_prefs
  for each row execute function public.enforce_priority_source_cap();

create table if not exists public.alert_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists alert_claims_user_created_idx
  on public.alert_claims (user_id, created_at desc);

alter table public.alert_claims enable row level security;
-- No browser policy: claims are made only by the service-role pipeline.

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
  plan text;
  used integer;
  cap integer;
  quota_window interval;
begin
  select s.plan into plan
    from public.subscriptions s
   where s.user_id = p_user_id;
  plan := coalesce(plan, 'free');

  if plan = 'free' then
    return 'plan';
  elsif plan = 'personal' then
    if p_importance < 6 then
      return 'importance';
    end if;
    cap := 3;
    quota_window := interval '7 days';
  else
    cap := 10;
    quota_window := interval '24 hours';
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
     and created_at > now() - quota_window;

  if coalesce(used, 0) >= cap then
    return 'quota';
  end if;

  insert into public.alert_claims (user_id, event_id)
  values (p_user_id, p_event_id);
  return 'ok';
end;
$fn$;

revoke all on function public.plan_priority_source_cap(text) from public, anon, authenticated;
grant execute on function public.plan_priority_source_cap(text) to service_role;
revoke all on function public.claim_alert(uuid, uuid, real) from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real) to service_role;

create table if not exists public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  capability text not null check (capability in ('cluster', 'digest', 'reason')),
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_ledger_month_idx
  on public.ai_usage_ledger (created_at desc);
create index if not exists ai_usage_ledger_user_month_idx
  on public.ai_usage_ledger (user_id, created_at desc);
alter table public.ai_usage_ledger enable row level security;
-- No browser policy: the server owns cost accounting.

create or replace function public.reserve_ai_tokens(
  p_user_id uuid,
  p_capability text,
  p_model text,
  p_reserve integer,
  p_user_monthly_cap integer,
  p_global_monthly_cap integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  global_used bigint;
  user_used bigint;
  reservation_id uuid;
  month_start timestamptz := date_trunc('month', now());
begin
  if p_reserve <= 0 or p_global_monthly_cap <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(18295, 1);
  select coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)
    into global_used
    from public.ai_usage_ledger
   where created_at >= month_start;
  if global_used + p_reserve > p_global_monthly_cap then
    return null;
  end if;

  if p_user_id is not null and p_user_monthly_cap > 0 then
    select coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)
      into user_used
      from public.ai_usage_ledger
     where user_id = p_user_id
       and created_at >= month_start;
    if user_used + p_reserve > p_user_monthly_cap then
      return null;
    end if;
  end if;

  insert into public.ai_usage_ledger (user_id, capability, model, reserved_tokens)
  values (p_user_id, p_capability, p_model, p_reserve)
  returning id into reservation_id;
  return reservation_id;
end;
$fn$;

create or replace function public.settle_ai_tokens(
  p_id uuid,
  p_prompt_tokens integer,
  p_completion_tokens integer
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.ai_usage_ledger
     set prompt_tokens = greatest(0, p_prompt_tokens),
         completion_tokens = greatest(0, p_completion_tokens),
         reserved_tokens = 0
   where id = p_id;
$fn$;

revoke all on function public.reserve_ai_tokens(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tokens(uuid, text, text, integer, integer, integer)
  to service_role;
revoke all on function public.settle_ai_tokens(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.settle_ai_tokens(uuid, integer, integer) to service_role;

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
         when 'pro' then 365
         when 'personal' then 90
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

revoke all on function public.purge_expired_digests(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_digests(integer) to service_role;
