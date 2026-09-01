-- Idempotent repair for a production project where 0042 was applied only in
-- part, followed by 0043 and 0044. Every statement is safe when its intended
-- predecessor is already present. Existing customer and pipeline rows are
-- preserved.

-- ---------------------------------------------------------------------------
-- Reassert 0037: paid alert ceilings are daily, with one atomic claim.
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
  user_plan := coalesce(user_plan, 'free');

  if user_plan = 'free' then
    return 'plan';
  elsif user_plan = 'personal' then
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

revoke all on function public.claim_alert(uuid, uuid, real)
  from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real) to service_role;

-- ---------------------------------------------------------------------------
-- Finish every intended 0042 statement without replaying destructive DDL.
-- ---------------------------------------------------------------------------

update public.site_settings
   set value = value || jsonb_build_object(
         'personal', 14.99,
         'pro', 29.99,
         'personalAnnual', 149.90,
         'proAnnual', 299.90
       ),
       updated_at = now()
 where key = 'billing.prices'
   and value @> '{"personal":19,"pro":29,"personalAnnual":190,"proAnnual":290}'::jsonb;

update public.site_settings
   set value = jsonb_set(value, '{userLimit}', '90'::jsonb, true),
       updated_at = now()
 where key = 'site.access'
   and value ->> 'userLimit' = '400';

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
       where e.last_updated_at < now() - interval '400 days'
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
       and coalesce(published_at, fetched_at) < now() - interval '400 days'
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

revoke all on function public.purge_expired_corpus(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_corpus(integer) to service_role;

create table if not exists public.source_probe_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists source_probe_log_user_created_idx
  on public.source_probe_log(user_id, created_at desc);
alter table public.source_probe_log enable row level security;

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
  cap := case coalesce(user_plan, 'free')
           when 'pro' then 25
           when 'personal' then 5
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

revoke all on function public.claim_source_probe(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_source_probe(uuid) to service_role;

alter table public.stripe_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz;

update public.stripe_events
   set processed_at = received_at
 where processed_at is null;

drop policy if exists "site settings readable" on public.site_settings;
drop policy if exists "flags readable" on public.feature_flags;

-- ---------------------------------------------------------------------------
-- Billing lifecycle: one checkout at a time and ordered subscription events.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists stripe_event_created_at timestamptz,
  add column if not exists retired_stripe_subscription_id text,
  add column if not exists checkout_started_at timestamptz;

create or replace function public.claim_subscription_checkout(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  sub_row public.subscriptions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('checkout:' || p_user_id::text));
  select * into sub_row from public.subscriptions where user_id = p_user_id for update;
  if not found then return 'missing'; end if;
  if sub_row.stripe_subscription_id is not null then return 'subscription'; end if;
  if sub_row.checkout_started_at is not null
     and sub_row.checkout_started_at > now() - interval '30 minutes' then
    return 'pending';
  end if;
  update public.subscriptions
     set checkout_started_at = now(), updated_at = now()
   where user_id = p_user_id;
  return 'ok';
end;
$fn$;

create or replace function public.release_subscription_checkout(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.subscriptions
     set checkout_started_at = null, updated_at = now()
   where user_id = p_user_id
     and stripe_subscription_id is null;
$fn$;

revoke all on function public.claim_subscription_checkout(uuid)
  from public, anon, authenticated;
revoke all on function public.release_subscription_checkout(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_subscription_checkout(uuid) to service_role;
grant execute on function public.release_subscription_checkout(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Demand-aware analysis and temporary AI-capacity deferral.
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists analysis_deferred_until timestamptz;
alter table public.articles
  add column if not exists clustering_deferred_until timestamptz;
alter table public.digests
  add column if not exists generation_deferred_until timestamptz;
alter table public.event_impacts
  add column if not exists deferred_until timestamptz;
alter table public.event_translations
  add column if not exists deferred_until timestamptz;

create index if not exists events_analysis_deferred_idx
  on public.events(first_seen_at desc)
  where analysed_at is null and status = 'pending';
create index if not exists articles_clustering_deferred_idx
  on public.articles(published_at desc)
  where event_id is null;
create index if not exists digests_generation_deferred_idx
  on public.digests(scheduled_for)
  where status = 'scheduled';

create or replace function public.pending_events_with_demand(p_limit integer default 6)
returns table (id uuid, title text, status event_status, analysis_tokens integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id, e.title, e.status, e.analysis_tokens
    from public.events e
   where e.analysed_at is null
     and e.status = 'pending'
     and (e.analysis_deferred_until is null or e.analysis_deferred_until <= now())
     and (
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
           join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
           join public.profiles p on p.id = ut.user_id and p.auto_paused_at is null
           join public.notification_preferences np
             on np.user_id = ut.user_id and np.paused = false
           join auth.users au
             on au.id = ut.user_id
            and (au.banned_until is null or au.banned_until < now())
          where a.event_id = e.id
       )
     )
   order by e.first_seen_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 100));
$fn$;

revoke all on function public.pending_events_with_demand(integer)
  from public, anon, authenticated;
grant execute on function public.pending_events_with_demand(integer) to service_role;

create or replace function public.release_ai_reservation(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  changed integer;
begin
  update public.ai_usage_ledger
     set reserved_tokens = 0,
         estimated_cost_microusd = 0
   where id = p_id
     and cost_microusd is null
     and prompt_tokens = 0
     and completion_tokens = 0
     and reserved_tokens > 0;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$fn$;

revoke all on function public.release_ai_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.release_ai_reservation(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic delivery leases and failure-safe alert materialisation.
-- ---------------------------------------------------------------------------

alter table public.deliveries
  add column if not exists processing_started_at timestamptz;

create or replace function public.claim_delivery(
  p_id uuid,
  p_lease_minutes integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  changed integer;
begin
  update public.deliveries
     set processing_started_at = now()
   where id = p_id
     and status = 'queued'
     and (
       processing_started_at is null
       or processing_started_at < now() - make_interval(mins => greatest(1, p_lease_minutes))
     );
  get diagnostics changed = row_count;
  return changed = 1;
end;
$fn$;

revoke all on function public.claim_delivery(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_delivery(uuid, integer) to service_role;

create or replace function public.create_alert_delivery(
  p_user_id uuid,
  p_event_id uuid,
  p_importance real,
  p_scheduled_for timestamptz,
  p_why text,
  p_channels delivery_channel[]
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  admission text;
  new_digest uuid;
begin
  admission := public.claim_alert(p_user_id, p_event_id, p_importance);
  if admission <> 'ok' then return admission; end if;

  insert into public.digests (
    user_id, scheduled_for, generated_at, status, item_count,
    generation_tokens, kind
  ) values (
    p_user_id, p_scheduled_for, now(), 'ready', 1, 0, 'alert'
  ) returning digest_id into new_digest;

  insert into public.digest_items (digest_id, event_id, position, why_it_matters)
  values (new_digest, p_event_id, 0, p_why);

  insert into public.deliveries (digest_id, channel, status)
  select new_digest, c.channel, 'queued'
    from unnest(p_channels) as c(channel)
  on conflict (digest_id, channel) do nothing;

  update public.user_events
     set briefed_at = now()
   where user_id = p_user_id and event_id = p_event_id;

  return 'ok:' || new_digest::text;
end;
$fn$;

revoke all on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[]
) from public, anon, authenticated;
grant execute on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[]
) to service_role;

-- ---------------------------------------------------------------------------
-- Small durable status surface for launch monitoring and heartbeat checks.
-- ---------------------------------------------------------------------------

create table if not exists public.ops_status (
  key text primary key,
  status text not null check (status in ('healthy', 'warning', 'error')),
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ops_status enable row level security;

create or replace function public.record_ops_status(
  p_key text,
  p_status text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_status not in ('healthy', 'warning', 'error') then
    raise exception 'invalid operational status';
  end if;
  insert into public.ops_status(key, status, detail, updated_at)
  values (p_key, p_status, coalesce(p_detail, '{}'::jsonb), now())
  on conflict (key) do update
    set status = excluded.status,
        detail = excluded.detail,
        updated_at = excluded.updated_at;
end;
$fn$;

revoke all on table public.ops_status from public, anon, authenticated;
revoke all on function public.record_ops_status(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ops_status(text, text, jsonb) to service_role;
