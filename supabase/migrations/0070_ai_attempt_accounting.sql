-- Deploy before the application. Does not change budgets, routes or model modes.
alter table public.ai_usage_ledger
  add column if not exists request_meta jsonb not null default '{}',
  add column if not exists reasoning_tokens integer not null default 0,
  add column if not exists latency_ms integer;

alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature_check;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature_check
  check (feature in ('cluster', 'analyse', 'enrich', 'translate', 'impact', 'ask', 'probe', 'unknown'));

create or replace function public.record_ai_attempt(
  p_id uuid, p_meta jsonb, p_usage jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_usage_ledger
     set request_meta = request_meta || p_meta || case when p_usage is null then '{}'::jsonb else jsonb_build_object('observed_usage', p_usage) end,
         reasoning_tokens = coalesce((p_usage->>'reasoning_tokens')::integer, reasoning_tokens),
         latency_ms = coalesce((p_usage->>'latency_ms')::integer, latency_ms)
   where id = p_id;
  if not found then raise exception 'AI reservation does not exist'; end if;
end;
$$;
revoke all on function public.record_ai_attempt(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_attempt(uuid, jsonb, jsonb) to service_role;
create index if not exists ai_usage_event_ids on public.ai_usage_ledger
  using gin ((request_meta->'event_ids'));

-- An elapsed timeout does not establish that the provider did not bill.
-- Preserve the callable cron interface, but require explicit reconciliation.
create or replace function public.void_stale_ai_reservations(p_older_than interval default '1 hour')
returns integer language sql security definer set search_path = public as $$ select 0; $$;

-- Retain each installed function's limits, grants and signature. Only disable
-- its obsolete age-based exclusion. This also keeps console totals consistent
-- with the reservation gate, including deployments with repaired overloads.
do $$
declare
  entry record;
  definition text;
begin
  for entry in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'reserve_ai_tokens', 'ai_spend_this_month', 'ai_credit_balance',
      'ai_spend_windows', 'admin_cost_breakdown', 'admin_cost_by_model', 'settle_ai_tokens'
    )
  loop
    definition := pg_get_functiondef(entry.oid);
    if position('''probe''' in definition) = 0 then
      definition := replace(definition, '''cluster'',''analyse'',''enrich'',''translate'',''impact'',''ask''', '''cluster'',''analyse'',''enrich'',''translate'',''impact'',''ask'',''probe''');
    end if;
    definition := replace(definition, 'created_at < stale_before', 'created_at < ''-infinity''::timestamptz');
    definition := replace(definition, 'created_at < now() - interval ''1 hour''', 'created_at < ''-infinity''::timestamptz');
    definition := replace(definition, 'date_trunc(''month'', now())', '(date_trunc(''month'', now() at time zone ''UTC'') at time zone ''UTC'')');
    execute definition;
  end loop;
end;
$$;

comment on function public.void_stale_ai_reservations(interval) is
  'No-op: ambiguous provider charges remain reserved until explicitly reconciled.';

-- Read-only operational view; service role only, no private prompts.
create or replace view public.ai_operation_usage as
select date_trunc('day', created_at at time zone 'UTC') as utc_day, feature, model,
  count(*) as attempts,
  sum(prompt_tokens) as input_tokens, sum(completion_tokens) as output_tokens,
  sum(reasoning_tokens) as reasoning_tokens, sum(cached_prompt_tokens) as cached_tokens,
  sum(coalesce(cost_microusd, estimated_cost_microusd, 0)) as cost_microusd,
  count(*) filter (where cost_microusd is null and reserved_tokens > 0) as unresolved,
  percentile_cont(array[0.5, 0.9, 0.95, 0.99]) within group (order by completion_tokens)
    filter (where cost_microusd is not null and completion_tokens > 0) as output_percentiles
from public.ai_usage_ledger group by 1, 2, 3;
revoke all on public.ai_operation_usage from public, anon, authenticated;
grant select on public.ai_operation_usage to service_role;
