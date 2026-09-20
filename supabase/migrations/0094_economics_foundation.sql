-- Nyuz economics foundation.
--
-- This migration is accounting storage only. It does not change pipeline,
-- billing, AI routing, or customer-facing pricing. Provider adapters and admin
-- read/write functions are added separately; secrets never belong in these rows.

create table if not exists public.economics_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service text not null,
  scope text not null check (scope in ('account', 'organization', 'project', 'workspace', 'application', 'allocated', 'unallocated')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  captured_at timestamptz not null default now(),
  original_amount_minor bigint,
  original_currency text,
  jpy_amount_minor bigint,
  conversion_rate numeric,
  conversion_date date,
  conversion_source text,
  classification text not null check (classification in ('fixed', 'variable', 'mixed')),
  status text not null check (status in ('exact', 'imported', 'estimated', 'projected', 'allocated', 'manual', 'unavailable', 'incomplete', 'stale')),
  source text not null,
  usage jsonb not null default '{}'::jsonb,
  allowance jsonb,
  import_key text not null,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  check ((original_amount_minor is null) = (original_currency is null)),
  check (jpy_amount_minor is null or conversion_rate is not null),
  unique (provider, service, scope, period_start, period_end, import_key)
);

create index if not exists economics_snapshots_period_idx
  on public.economics_snapshots (period_start, period_end, provider);
create index if not exists economics_snapshots_captured_idx
  on public.economics_snapshots (captured_at desc);

comment on table public.economics_snapshots is
  'Immutable provider-reported or derived economics observations. Historical rows are never silently rewritten.';
comment on column public.economics_snapshots.scope is
  'Billing scope, not an ownership assertion. Organization/account values must not be attributed to Nyuz without an explicit allocation.';
comment on column public.economics_snapshots.import_key is
  'Provider-period identifier used to make sync retries idempotent.';
comment on column public.economics_snapshots.jpy_amount_minor is
  'JPY reporting value captured with conversion metadata; later FX changes do not rewrite this value.';

create table if not exists public.economics_manual_costs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service text not null,
  scope text not null check (scope in ('account', 'organization', 'project', 'workspace', 'application', 'allocated', 'unallocated')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  jpy_amount_minor bigint,
  conversion_rate numeric,
  conversion_date date,
  conversion_source text,
  classification text not null check (classification in ('fixed', 'variable', 'mixed')),
  reference text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check (jpy_amount_minor is null or conversion_rate is not null)
);

create index if not exists economics_manual_costs_period_idx
  on public.economics_manual_costs (period_start, period_end, provider);

comment on table public.economics_manual_costs is
  'Manual fallback for provider charges that cannot be imported. Imported snapshots remain separate and take no silent override.';

alter table public.economics_snapshots enable row level security;
alter table public.economics_manual_costs enable row level security;

-- Browser clients never write accounting records directly. Server functions
-- using the verified admin actor and service-role boundary will be added with
-- the admin Economics surface.
revoke all on table public.economics_snapshots, public.economics_manual_costs from public, anon, authenticated;
grant select on table public.economics_snapshots, public.economics_manual_costs to service_role;
grant insert, update on table public.economics_manual_costs to service_role;
