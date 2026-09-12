-- Preserve existing configuration. Enforce additions and effective capabilities.
begin;

create or replace function public.enforce_launch_preferences()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare p jsonb; tier text;
begin
  select plan::text into tier from subscriptions where user_id = new.user_id;
  p := launch_plan(coalesce(tier, 'uno'));
  if not (p->>'customDeliveryTime')::boolean and new.send_at <> standard_delivery_time()
     and (tg_op = 'INSERT' or new.send_at is distinct from old.send_at) then
    raise exception 'Custom delivery time is available on Plura and Omni.';
  end if;
  if 'telegram' = any(new.channels) and not (p->>'telegram')::boolean
     and (tg_op = 'INSERT' or new.channels is distinct from old.channels) then
    raise exception 'Telegram delivery is available on Plura and Omni.';
  end if;
  if 'whatsapp' = any(new.channels) then raise exception 'This delivery channel is not available.'; end if;
  if new.breaking = 'everything' and p->>'notificationControl' <> 'advanced'
     and (tg_op = 'INSERT' or new.breaking is distinct from old.breaking) then
    raise exception 'Advanced notification controls are available on Omni.';
  end if;
  if new.frequency <> 'daily' and (tg_op = 'INSERT' or new.frequency is distinct from old.frequency) then
    raise exception 'V1 supports one daily briefing.';
  end if;
  return new;
end; $fn$;
create trigger enforce_launch_preferences before insert or update on public.notification_preferences
for each row execute function public.enforce_launch_preferences();

-- Lock the account before the existing count triggers run. This also serializes
-- simultaneous direct PostgREST requests, not just server-function calls.
create or replace function public.lock_plan_configuration()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:' || new.user_id::text, 0));
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Configuration cannot be transferred to another account.';
  end if;
  return new;
end; $fn$;
create trigger aaa_lock_topic_plan before insert or update on public.user_topics
for each row execute function public.lock_plan_configuration();
create trigger aaa_lock_source_plan before insert or update on public.user_source_prefs
for each row execute function public.lock_plan_configuration();

create or replace function public.enforce_topic_controls()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare tier text; control text;
begin
  select plan::text into tier from subscriptions where user_id = new.user_id;
  control := launch_plan(coalesce(tier, 'uno'))->>'notificationControl';
  if control = 'basic' and new.importance <> 'notable'
    and (tg_op = 'INSERT' or new.importance is distinct from old.importance) then
    raise exception 'Per-topic controls are available on Plura and Omni.';
  end if;
  if control <> 'advanced' and (cardinality(new.keywords) > 0 or cardinality(new.exclude_keywords) > 0)
    and (tg_op = 'INSERT' or new.keywords is distinct from old.keywords or new.exclude_keywords is distinct from old.exclude_keywords) then
    raise exception 'Keyword notification rules are available on Omni.';
  end if;
  return new;
end; $fn$;
create trigger enforce_topic_controls before insert or update on public.user_topics
for each row execute function public.enforce_topic_controls();

create or replace function public.claim_custom_source(p_user_id uuid, p_source_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare tier text; cap integer; used integer;
begin
  perform pg_advisory_xact_lock(hashtext('custom_source:' || p_user_id::text));
  if exists(select 1 from user_custom_sources where user_id=p_user_id and source_id=p_source_id) then return 'exists'; end if;
  select plan::text into tier from subscriptions where user_id=p_user_id;
  cap := (launch_plan(coalesce(tier,'uno'))->>'customSources')::integer;
  select count(*) into used from user_custom_sources where user_id=p_user_id;
  if used >= cap then return 'limit'; end if;
  insert into user_custom_sources(user_id,source_id) values(p_user_id,p_source_id);
  return 'ok';
end; $fn$;

create or replace function public.claim_alert(p_user_id uuid, p_event_id uuid, p_importance real)
returns text language plpgsql security definer set search_path = public as $fn$
declare tier text; cap integer; used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('alert:' || p_user_id::text,0));
  select plan::text into tier from subscriptions where user_id=p_user_id;
  -- Retain the important-event floor for all launch tiers.
  if p_importance is null or p_importance < 6 then return 'importance'; end if;
  cap := (launch_plan(coalesce(tier,'uno'))->>'alertDailyCap')::integer;
  if exists(select 1 from alert_claims where user_id=p_user_id and event_id=p_event_id) then return 'duplicate'; end if;
  select count(*) into used from alert_claims where user_id=p_user_id and created_at > now()-interval '24 hours';
  if used >= cap then return 'quota'; end if;
  insert into alert_claims(user_id,event_id) values(p_user_id,p_event_id);
  return 'ok';
end; $fn$;

-- Account-local day deduplication at scheduling AND generation. Existing rows
-- survive; an old duplicate cannot generate after this migration.
create or replace function public.enforce_daily_briefing()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare zone text;
begin
  if new.kind <> 'briefing' then return new; end if;
  if tg_op = 'UPDATE' and new.status <> 'generating' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('briefing:' || new.user_id::text,0));
  select timezone into zone from notification_preferences where user_id=new.user_id;
  zone := coalesce(zone,'UTC');
  if exists(select 1 from digests d where d.user_id=new.user_id and d.kind='briefing'
    and d.digest_id <> new.digest_id
    and not (d.status='failed' and d.generation_started_at is null)
    and (d.scheduled_for at time zone zone)::date = (new.scheduled_for at time zone zone)::date
    and (tg_op='INSERT' or d.status in ('generating','ready','sent','skipped'))) then
    return null;
  end if;
  return new;
end; $fn$;
create trigger enforce_daily_briefing before insert or update of status on public.digests
for each row execute function public.enforce_daily_briefing();

-- Supersede only unstarted future jobs when a custom-time entitlement ends.
-- Their rows and the reader's saved time survive. The next scheduler tick
-- creates the default-time job; completed/in-progress briefings are untouched.
create or replace function public.refresh_launch_schedule()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if new.plan is distinct from old.plan and not (launch_plan(new.plan::text)->>'customDeliveryTime')::boolean then
    update digests set status='failed',generation_failure_reason='Superseded by standard plan delivery time'
    where user_id=new.user_id and kind='briefing' and status='scheduled'
      and generation_started_at is null and scheduled_for>now();
  end if;
  return new;
end; $fn$;
create trigger refresh_launch_schedule after update of plan on subscriptions
for each row execute function public.refresh_launch_schedule();
update digests d set status='failed',generation_failure_reason='Superseded by standard plan delivery time'
from notification_preferences np left join subscriptions s on s.user_id=np.user_id
where d.user_id=np.user_id and d.kind='briefing' and d.status='scheduled'
  and d.generation_started_at is null and d.scheduled_for>now()
  and not (launch_plan(coalesce(s.plan::text,'uno'))->>'customDeliveryTime')::boolean
  and (d.scheduled_for at time zone np.timezone)::time <> standard_delivery_time();

create table public.registered_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id uuid not null,
  label text not null default 'Browser / PWA',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key(user_id,install_id)
);
alter table public.registered_devices enable row level security;
create policy "own devices" on public.registered_devices for select to authenticated using(user_id=auth.uid());
grant select on public.registered_devices to authenticated;
grant all on public.registered_devices to service_role;
-- All writes use guarded server functions and service-only atomic RPCs.
alter table public.push_subscriptions add column install_id uuid;
insert into public.registered_devices(user_id,install_id,first_seen,last_seen,label)
select user_id,id,created_at,created_at,'Existing browser / PWA' from public.push_subscriptions;
update public.push_subscriptions set install_id=id;
alter table public.push_subscriptions add constraint push_registered_device
foreign key(user_id,install_id) references public.registered_devices(user_id,install_id) on delete cascade;
create unique index push_one_per_install on public.push_subscriptions(user_id,install_id);

create or replace function public.register_device(p_user_id uuid,p_install_id uuid,p_label text default 'Browser / PWA',p_endpoint text default null)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare tier text; cap integer; used integer; legacy uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_user_id::text,0));
  if exists(select 1 from registered_devices where user_id=p_user_id and install_id=p_install_id) then
    update registered_devices set last_seen=now() where user_id=p_user_id and install_id=p_install_id;
    return p_install_id;
  end if;
  -- Reuse a migrated endpoint's installation; never count it a second time.
  select install_id into legacy from push_subscriptions where user_id=p_user_id and endpoint=p_endpoint;
  if legacy is not null then return legacy; end if;
  select plan::text into tier from subscriptions where user_id=p_user_id;
  cap := (launch_plan(coalesce(tier,'uno'))->>'devices')::integer;
  select count(*) into used from registered_devices where user_id=p_user_id;
  if used >= cap then raise exception '% supports % registered device(s). Remove an existing device or upgrade.',initcap(coalesce(tier,'uno')),cap; end if;
  insert into registered_devices(user_id,install_id,label) values(p_user_id,p_install_id,left(p_label,80));
  return p_install_id;
end; $fn$;
revoke all on function public.register_device(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_device(uuid,uuid,text,text) to service_role;

-- Direct push table writes must also provide a registered installation.
alter table public.push_subscriptions alter column install_id set not null;
create or replace function public.enforce_push_install()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if tg_op='UPDATE' and (new.user_id<>old.user_id or new.install_id<>old.install_id) then
    raise exception 'A push subscription cannot be transferred.';
  end if;
  return new;
end; $fn$;
create trigger enforce_push_install before update on public.push_subscriptions
for each row execute function public.enforce_push_install();
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
  cap := (public.launch_plan(coalesce(user_plan,'uno'))->>'customSources')::integer;
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
revoke all on function public.claim_alert(uuid,uuid,real) from public,anon,authenticated;
revoke all on function public.claim_custom_source(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_source_probe(uuid) from public,anon,authenticated;
grant execute on function public.claim_alert(uuid,uuid,real) to service_role;
grant execute on function public.claim_custom_source(uuid,uuid) to service_role;
grant execute on function public.claim_source_probe(uuid) to service_role;
commit;
