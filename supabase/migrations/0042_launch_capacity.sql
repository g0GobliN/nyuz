-- Move an untouched console override with the old catalogue to the new launch
-- prices. Preserve any values the operator deliberately set to something else.
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

-- Keep the first public cohort inside the free email provider's 100-send daily
-- ceiling, with a small reserve for welcome, billing and lifecycle messages.
-- Preserve any value deliberately changed in the console; only replace the old
-- bundled default introduced by 0038.

update public.site_settings
   set value = jsonb_set(value, '{userLimit}', '90'::jsonb, true),
       updated_at = now()
 where key = 'site.access'
   and value ->> 'userLimit' = '400';

-- Keep the shared news corpus bounded on Supabase Free. Reader history already
-- expires by plan through purge_expired_digests; this removes global material
-- after the longest plan window while preserving anything explicitly saved.
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

-- A failed feed probe is still an outbound request. Gate it before fetching so
-- a Free account cannot turn the add-source form into a request relay, and so
-- a paid account cannot hammer arbitrary publishers with repeated bad URLs.
create table public.source_probe_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index source_probe_log_user_created_idx
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

-- A claimed Stripe event is not the same as a completed one. Keep a short
-- processing lease so a database/provider failure can be retried without two
-- concurrent deliveries both sending customer mail.
alter table public.stripe_events
  add column processing_started_at timestamptz,
  add column processed_at timestamptz;

-- Rows written by older builds were acknowledged as complete.
update public.stripe_events
   set processed_at = received_at
 where processed_at is null;

-- Public pages read these through a server loader. Direct PostgREST access only
-- exposed internal rollout names and capacity/configuration with no benefit.
drop policy if exists "site settings readable" on public.site_settings;
drop policy if exists "flags readable" on public.feature_flags;
