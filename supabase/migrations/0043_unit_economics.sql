-- Actual unit economics: immutable payment facts, AI cost snapshots and the
-- small fixed bills the operator enters from provider invoices.

alter table public.ai_usage_ledger
  add column plan plan_tier,
  add column cached_prompt_tokens integer not null default 0
    check (cached_prompt_tokens >= 0),
  add column cost_microusd bigint check (cost_microusd >= 0);

create table public.billing_ledger (
  charge_id text primary key,
  invoice_id text not null,
  user_id uuid references public.profiles(id) on delete set null,
  plan plan_tier not null check (plan <> 'uno'),
  interval text not null check (interval in ('month', 'year')),
  price_id text not null,
  currency text not null,
  gross_cents integer not null check (gross_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  stripe_fee_amount integer not null check (stripe_fee_amount >= 0),
  stripe_fee_currency text not null,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  paid_at timestamptz not null,
  livemode boolean not null,
  updated_at timestamptz not null default now()
);

create index billing_ledger_period_idx
  on public.billing_ledger(period_start, period_end);
create index billing_ledger_user_idx
  on public.billing_ledger(user_id, paid_at desc);
alter table public.billing_ledger enable row level security;

create table public.operating_cost_settings (
  provider text primary key check (provider in ('cloudflare', 'supabase', 'resend', 'domain', 'other')),
  monthly_cents integer not null check (monthly_cents >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.operating_cost_settings enable row level security;

-- Snapshot the plan when tokens are reserved. Joining the current subscription
-- later would rewrite history whenever somebody upgrades or cancels.
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
  user_plan plan_tier;
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

  if p_user_id is not null then
    select plan into user_plan
      from public.subscriptions
     where user_id = p_user_id;
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

  insert into public.ai_usage_ledger (user_id, plan, capability, model, reserved_tokens)
  values (p_user_id, user_plan, p_capability, p_model, p_reserve)
  returning id into reservation_id;
  return reservation_id;
end;
$fn$;

drop function public.settle_ai_tokens(uuid, integer, integer);

create function public.settle_ai_tokens(
  p_id uuid,
  p_prompt_tokens integer,
  p_cached_prompt_tokens integer,
  p_completion_tokens integer,
  p_cost_microusd bigint
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.ai_usage_ledger
     set prompt_tokens = greatest(0, p_prompt_tokens),
         cached_prompt_tokens = greatest(0, least(p_prompt_tokens, p_cached_prompt_tokens)),
         completion_tokens = greatest(0, p_completion_tokens),
         cost_microusd = case
           when p_cost_microusd is null then null
           else greatest(0, p_cost_microusd)
         end,
         reserved_tokens = 0
   where id = p_id;
$fn$;

revoke all on table public.billing_ledger, public.operating_cost_settings
  from public, anon, authenticated;
revoke all on function public.reserve_ai_tokens(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tokens(uuid, text, text, integer, integer, integer)
  to service_role;
revoke all on function public.settle_ai_tokens(uuid, integer, integer, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.settle_ai_tokens(uuid, integer, integer, integer, bigint)
  to service_role;
