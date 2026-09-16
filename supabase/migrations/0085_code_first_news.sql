-- Shared deterministic processing and reader-initiated story spending.
alter table public.ai_usage_ledger add column accounted_at timestamptz;
alter table public.articles add column cluster_owner uuid, add column cluster_lease_until timestamptz;
alter table public.events
  add column metadata_dirty boolean not null default false,
  add column coverage_revision integer not null default 0,
  add column finalization_owner uuid,
  add column finalization_lease_until timestamptz,
  add column article_count integer not null default 0,
  add column publisher_count integer not null default 0;
create index events_metadata_work on public.events(first_seen_at desc) where metadata_dirty or status in ('pending','analysing');

create function public.mark_event_metadata_dirty() returns trigger language plpgsql set search_path=public as $$
begin
  if new.event_id is not null then
    update events set metadata_dirty=true, coverage_revision=coverage_revision+1 where id=new.event_id;
  end if;
  if tg_op='UPDATE' and old.event_id is distinct from new.event_id and old.event_id is not null then
    update events set metadata_dirty=true, coverage_revision=coverage_revision+1 where id=old.event_id;
  end if;
  return new;
end $$;
create trigger article_metadata_changed after insert or update of event_id,title,excerpt on public.articles
for each row execute function public.mark_event_metadata_dirty();

create function public.claim_article_cluster(p_article_id uuid,p_owner uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update articles set cluster_owner=p_owner,cluster_lease_until=now()+interval '2 minutes'
  where id=p_article_id and event_id is null and (cluster_lease_until is null or cluster_lease_until<now());
  return found;
end $$;
create function public.release_article_cluster(p_article_id uuid,p_owner uuid) returns void
language sql security definer set search_path=public as $$
  update articles set cluster_owner=null,cluster_lease_until=null where id=p_article_id and cluster_owner=p_owner;
$$;
create function public.finish_article_cluster(p_article_id uuid,p_owner uuid,p_event_id uuid,p_ignored boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare a articles; target uuid:=p_event_id;
begin
  select * into a from articles where id=p_article_id for update;
  if a.cluster_owner is distinct from p_owner or a.cluster_lease_until<now() or a.event_id is not null then return null; end if;
  if target is null then
    insert into events(title,status,first_seen_at) values(a.title,case when p_ignored then 'failed'::event_status else 'pending'::event_status end,coalesce(a.published_at,now())) returning id into target;
  elsif not exists(select 1 from events where id=target) then return null;
  end if;
  update articles set event_id=target,cluster_owner=null,cluster_lease_until=null where id=a.id;
  if p_ignored then update events set metadata_dirty=false where id=target; end if;
  return target;
end $$;
create function public.claim_event_finalization(p_event_id uuid,p_owner uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update events set finalization_owner=p_owner,finalization_lease_until=now()+interval '2 minutes',
    status=case when analysed_at is null then 'analysing'::event_status else status end
  where id=p_event_id and (finalization_lease_until is null or finalization_lease_until<now());
  return found;
end $$;
create function public.finish_event_finalization(p_event_id uuid,p_owner uuid,p_revision integer,p_metadata jsonb,p_topics uuid[])
returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform 1 from events where id=p_event_id and finalization_owner=p_owner and finalization_lease_until>now() for update;
  if not found then return false; end if;
  insert into event_topics(event_id,topic_id) select p_event_id,unnest(p_topics) on conflict do nothing;
  update events set title=p_metadata->>'title',what_happened=p_metadata->>'what_happened',
    importance=(p_metadata->>'importance')::real,novelty=(p_metadata->>'novelty')::real,
    tags=array(select jsonb_array_elements_text(p_metadata->'tags')),
    article_count=(p_metadata->>'article_count')::integer,publisher_count=(p_metadata->>'publisher_count')::integer,
    status='complete',analysed_at=coalesce(analysed_at,now()),analysis_deferred_until=null,
    metadata_dirty=(coverage_revision<>p_revision),finalization_owner=null,finalization_lease_until=null
  where id=p_event_id;
  return true;
end $$;
create function public.fail_event_finalization(p_event_id uuid,p_owner uuid) returns void
language sql security definer set search_path=public as $$
  update events set status=case when analysed_at is null then 'failed'::event_status else 'complete'::event_status end,
    metadata_dirty=false,finalization_owner=null,finalization_lease_until=null
  where id=p_event_id and finalization_owner=p_owner;
$$;

-- Runtime settings share the existing configuration table.
insert into public.ai_runtime_config(key,value) values
 ('ai.monthly_cost_usd','{"value":10}'),
 ('ai.daily_cost_usd','{"value":0.5}'),
 ('ai.story_concurrency','{"value":2}'),
 ('ai.story_attempts','{"value":3}'),
 ('ai.story_user_daily_starts','{"value":10}'),
 ('ai.story_failure_cooldown_minutes','{"value":30}'),
 ('ai.story_uncertain_cooldown_minutes','{"value":120}')
on conflict(key) do nothing;
update public.ai_runtime_config set value='{"value":10}' where key='ai.monthly_cost_usd' and (value->>'value')::numeric>10;

create function public.story_limit(p_key text,p_default numeric) returns numeric
language plpgsql stable security definer set search_path=public as $$
declare v numeric;
begin
  select (value->>'value')::numeric into v from ai_runtime_config where key=p_key;
  if v::text in ('NaN','Infinity','-Infinity') then return 0; end if;
  return greatest(0,coalesce(v,p_default));
exception when others then return 0;
end;
$$;

alter table public.event_understanding
  add column owner uuid,
  add column lease_until timestamptz,
  add column next_retry_at timestamptz,
  add column phase text not null default 'idle' check(phase in ('idle','claimed','requesting','uncertain','persisting','ready','failed'));
create table public.story_generation_starts(
  usage_id uuid primary key references ai_usage_ledger(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.story_generation_starts enable row level security;
revoke all on public.story_generation_starts from public,anon,authenticated;
grant all on public.story_generation_starts to service_role;
create index story_starts_user_day on public.story_generation_starts(user_id,created_at);

create function public.claim_shared_story(p_event_id uuid,p_version text,p_owner uuid,p_user_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare r event_understanding;
begin
  perform pg_advisory_xact_lock(18295,1);
  if not exists(select 1 from auth.users where id=p_user_id) then return 'denied'; end if;
  -- A crashed owner never gains permission to spend just by losing its lease.
  update event_understanding set status='failed',phase=case when phase='claimed' then 'idle' else 'uncertain' end,owner=null,lease_until=null,
    next_retry_at=case when phase='claimed' then null else now()+make_interval(mins=>story_limit('ai.story_uncertain_cooldown_minutes',120)::integer) end
  where status='generating' and phase<>'persisting'
    and coalesce(lease_until,claimed_at+interval '2 minutes',created_at+interval '2 minutes')<now();
  insert into event_understanding(event_id,content_version,status,phase) values(p_event_id,p_version,'failed','idle')
    on conflict do nothing;
  select * into r from event_understanding where event_id=p_event_id and content_version=p_version for update;
  if r.status='ready' and jsonb_typeof(r.payload->'article')='object' then return 'ready'; end if;
  if r.phase='persisting' then return 'persisting'; end if;
  if r.phase='uncertain' then return 'reconciliation'; end if;
  if r.lease_until>now() then return 'generating'; end if;
  if r.attempts>=story_limit('ai.story_attempts',3) then return 'exhausted'; end if;
  if r.next_retry_at>now() then return 'cooldown'; end if;
  if (select count(*) from story_generation_starts where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=story_limit('ai.story_user_daily_starts',10) then return 'rate'; end if;
  if (select count(*) from event_understanding where phase in ('claimed','requesting') and lease_until>now())>=story_limit('ai.story_concurrency',2) then return 'capacity'; end if;
  update event_understanding set status='generating',phase='claimed',owner=p_owner,
    lease_until=now()+interval '2 minutes',claimed_at=now(),updated_at=now()
    where event_id=p_event_id and content_version=p_version;
  return 'won';
end $$;

create function public.begin_shared_story_attempt(p_event_id uuid,p_version text,p_owner uuid,p_user_id uuid,p_usage_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(18295,1);
  if exists(select 1 from feature_flags where key='ai_kill_switch' and enabled) then return false; end if;
  if not exists(select 1 from ai_usage_ledger where id=p_usage_id and reserved_tokens>0 and feature='understand_generation') then return false; end if;
  if (select count(*) from story_generation_starts where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=story_limit('ai.story_user_daily_starts',10) then return false; end if;
  update event_understanding set attempts=attempts+1,phase='requesting',usage_id=p_usage_id
    where event_id=p_event_id and content_version=p_version and owner=p_owner and lease_until>now()
      and phase='claimed' and attempts<story_limit('ai.story_attempts',3);
  if not found then return false; end if;
  insert into story_generation_starts(usage_id,user_id) values(p_usage_id,p_user_id);
  return true;
end $$;

create function public.stage_shared_story(p_event_id uuid,p_version text,p_owner uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update event_understanding set phase='persisting',payload=p_payload,prompt_version='story:2',updated_at=now()
    where event_id=p_event_id and content_version=p_version and owner=p_owner and phase in ('requesting','persisting');
  return found;
end $$;
create function public.finish_shared_story(p_event_id uuid,p_version text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update event_understanding set status='ready',phase='ready',owner=null,lease_until=null,updated_at=now()
    where event_id=p_event_id and content_version=p_version and phase='persisting' and payload is not null;
  return found;
end $$;
create function public.fail_shared_story(p_event_id uuid,p_version text,p_owner uuid,p_reason text,p_uncertain boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  update event_understanding set status='failed',phase=case when p_uncertain then 'uncertain' else 'failed' end,
    failure_reason=left(p_reason,500),owner=null,lease_until=null,
    next_retry_at=now()+make_interval(mins=>story_limit(case when p_uncertain then 'ai.story_uncertain_cooldown_minutes' else 'ai.story_failure_cooldown_minutes' end,case when p_uncertain then 120 else 30 end)::integer)
    where event_id=p_event_id and content_version=p_version and owner=p_owner and phase<>'persisting';
end $$;

-- Extend the installed reservation gate; retain credit, model/day and token checks.
do $$
declare d text; signatures integer; anchor text:='perform pg_advisory_xact_lock(18295, 1);';
begin
  select count(*) into signatures from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reserve_ai_tokens';
  if signatures<>1 then raise exception 'Expected exactly one reservation signature, found %',signatures; end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reserve_ai_tokens';
  if d is null or position(anchor in d)=0 then raise exception 'Reservation gate missing'; end if;
  d:=replace(d,anchor,anchor||$gate$
  if p_feature not in ('understand_generation','probe') or p_feature is null then return null; end if;
  if p_estimated_cost_microusd is null or p_estimated_cost_microusd<0 then return null; end if;
  if (select coalesce(sum(coalesce(cost_microusd,estimated_cost_microusd,0)),0) from ai_usage_ledger
      where cost_microusd is null or coalesce(accounted_at,created_at) >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))
      + p_estimated_cost_microusd > least(500000,story_limit('ai.daily_cost_usd',0.5)*1000000) then return null; end if;
  if (select coalesce(sum(coalesce(cost_microusd,estimated_cost_microusd,0)),0) from ai_usage_ledger
      where cost_microusd is null or coalesce(accounted_at,created_at) >= (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'))
      + p_estimated_cost_microusd > least(10000000,story_limit('ai.monthly_cost_usd',10)*1000000) then return null; end if;
  $gate$);
  execute d;
end $$;

-- The obsolete claim cannot bypass initiation policy.
create or replace function public.claim_event_understanding(p_event_id uuid,p_content_version text,p_max_attempts integer default 3,p_stale_after interval default '10 minutes')
returns text language sql security definer set search_path=public as $$ select 'failed'::text $$;

-- Record observed usage in typed columns atomically as well as metadata.
create or replace function public.record_ai_attempt(p_id uuid,p_meta jsonb,p_usage jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update ai_usage_ledger set request_meta=request_meta||p_meta||case when request_meta->>'state'='failed' and p_meta->>'state'='settled' then '{"state":"failed"}'::jsonb else '{}'::jsonb end||case when p_usage is null then '{}'::jsonb else jsonb_build_object('observed_usage',p_usage) end,
    prompt_tokens=coalesce((p_usage->>'prompt_tokens')::integer,prompt_tokens),
    completion_tokens=coalesce((p_usage->>'completion_tokens')::integer,completion_tokens),
    cached_prompt_tokens=coalesce((p_usage->>'cached_tokens')::integer,cached_prompt_tokens),
    cost_microusd=case when p_usage is null then cost_microusd else (p_usage->>'cost_microusd')::bigint end,
    reserved_tokens=case when p_usage is null then reserved_tokens else 0 end,
    accounted_at=case when p_usage is null then accounted_at else coalesce(accounted_at,now()) end,
    reasoning_tokens=coalesce((p_usage->>'reasoning_tokens')::integer,reasoning_tokens),
    latency_ms=coalesce((p_usage->>'latency_ms')::integer,latency_ms)
  where id=p_id and (p_meta->>'state' is distinct from 'started' or reserved_tokens>0);
  if not found then raise exception 'AI reservation does not exist'; end if;
end $$;

-- Only positively unstarted reservations are safe to release by age.
update public.ai_usage_ledger
set prompt_tokens=(request_meta->'observed_usage'->>'prompt_tokens')::integer,
    completion_tokens=(request_meta->'observed_usage'->>'completion_tokens')::integer,
    cached_prompt_tokens=coalesce((request_meta->'observed_usage'->>'cached_tokens')::integer,0),
    cost_microusd=coalesce((request_meta->'observed_usage'->>'cost_microusd')::bigint,cost_microusd),
    reserved_tokens=0
where prompt_tokens=0 and completion_tokens=0
  and jsonb_typeof(request_meta->'observed_usage'->'prompt_tokens')='number'
  and jsonb_typeof(request_meta->'observed_usage'->'completion_tokens')='number';

create or replace function public.void_stale_ai_reservations(p_older_than interval default '1 hour')
returns integer language plpgsql security definer set search_path=public as $$
declare cleared integer;
begin
  perform pg_advisory_xact_lock(18295,1);
  update ai_usage_ledger set reserved_tokens=0,cost_microusd=0,estimated_cost_microusd=0,
    request_meta=request_meta||'{"state":"voided"}'::jsonb
  where reserved_tokens>0 and cost_microusd is null and request_meta->>'state'='reserved'
    and created_at<now()-greatest(p_older_than,interval '1 hour');
  get diagnostics cleared=row_count;
  return cleared;
end $$;

create view public.ai_daily_financial_report as
select date_trunc('day',coalesce(accounted_at,created_at) at time zone 'UTC') as utc_day,
  case when feature='understand_generation' then 'understanding' when feature in ('cluster','analyse') then feature else 'other' end as feature,
  count(*) filter(where request_meta->>'state' in ('started','settled','failed') or prompt_tokens+completion_tokens>0) as requests,
  sum(prompt_tokens) as input_tokens,sum(completion_tokens) as output_tokens,sum(cached_prompt_tokens) as cached_tokens,
  count(*) filter(where request_meta->>'state'='failed') as failed,
  count(*) filter(where cost_microusd is not null and request_meta->>'state' is distinct from 'voided') as settled,
  count(*) filter(where cost_microusd is null) as unresolved,
  count(*) filter(where request_meta->>'state'='voided') as voided,
  sum(coalesce(cost_microusd,0))/1000000.0 as actual_spend_usd,
  sum(case when cost_microusd is null then coalesce(estimated_cost_microusd,0) else 0 end)/1000000.0 as reserved_or_uncertain_usd
from ai_usage_ledger group by 1,2;
revoke all on public.ai_daily_financial_report from public,anon,authenticated;
grant select on public.ai_daily_financial_report to service_role;

create view public.ai_budget_status as
select
  coalesce(sum(cost_microusd) filter(where coalesce(accounted_at,created_at) >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)/1000000.0 as actual_today_usd,
  coalesce(sum(cost_microusd) filter(where coalesce(accounted_at,created_at) >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0)/1000000.0 as actual_month_usd,
  coalesce(sum(estimated_cost_microusd) filter(where cost_microusd is null),0)/1000000.0 as reserved_or_uncertain_usd,
  greatest(0,least(10,story_limit('ai.monthly_cost_usd',10))-
    (coalesce(sum(cost_microusd) filter(where coalesce(accounted_at,created_at) >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0)+
     coalesce(sum(estimated_cost_microusd) filter(where cost_microusd is null),0))/1000000.0) as monthly_available_usd
from public.ai_usage_ledger;
revoke all on public.ai_budget_status from public,anon,authenticated;
grant select on public.ai_budget_status to service_role;

do $$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('claim_article_cluster','release_article_cluster','finish_article_cluster','claim_event_finalization','finish_event_finalization','fail_event_finalization','story_limit','claim_shared_story','begin_shared_story_attempt','stage_shared_story','finish_shared_story','fail_shared_story')
 loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
