-- Bounded operational run history. It stores counts and reasons, never article
-- bodies or provider payloads. Retention is enforced by a service-role RPC.
create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  stage text not null,
  trigger text not null default 'cron',
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'healthy', 'warning', 'error')),
  considered integer not null default 0,
  processed integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  reason_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_runs_stage_started_idx on public.pipeline_runs (stage, started_at desc);
create index if not exists pipeline_runs_started_idx on public.pipeline_runs (started_at desc);
alter table public.pipeline_runs enable row level security;
revoke all on public.pipeline_runs from public, anon, authenticated;
grant all on public.pipeline_runs to service_role;

create or replace function public.purge_pipeline_runs(p_limit integer default 5000)
returns integer
language plpgsql security definer set search_path = public
as $fn$
declare removed integer;
begin
  with old as (
    select id from public.pipeline_runs
    where started_at < now() - interval '90 days'
    order by started_at asc
    limit greatest(1, least(coalesce(p_limit, 5000), 50000))
  )
  delete from public.pipeline_runs p using old where p.id = old.id;
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;
revoke all on function public.purge_pipeline_runs(integer) from public, anon, authenticated;
grant execute on function public.purge_pipeline_runs(integer) to service_role;
