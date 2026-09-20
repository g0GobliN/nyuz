-- Economics operations: sync health and immutable FX captures.
-- Accounting only; no pipeline or customer behavior changes.

create table if not exists public.economics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  requested_days integer not null check (requested_days > 0 and requested_days <= 365),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'healthy', 'warning', 'error')),
  imported_count integer not null default 0 check (imported_count >= 0),
  attempt integer not null default 1 check (attempt > 0),
  error text,
  source text not null,
  created_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at)
);
create index if not exists economics_sync_runs_provider_started_idx
  on public.economics_sync_runs (provider, started_at desc);

create table if not exists public.economics_fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency = 'JPY'),
  rate numeric not null check (rate > 0),
  rate_date date not null,
  source text not null,
  captured_at timestamptz not null default now(),
  unique (base_currency, quote_currency, rate_date, source)
);
create index if not exists economics_fx_rates_date_idx
  on public.economics_fx_rates (rate_date desc, base_currency);

alter table public.economics_sync_runs enable row level security;
alter table public.economics_fx_rates enable row level security;
revoke all on table public.economics_sync_runs, public.economics_fx_rates from public, anon, authenticated;
grant select, insert, update on table public.economics_sync_runs, public.economics_fx_rates to service_role;
