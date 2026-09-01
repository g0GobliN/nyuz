-- A token budget is not a money budget.
--
-- 0043 made every settled call carry `cost_microusd`, which means spend is now
-- a number the database can add up rather than something inferred from a token
-- count. That distinction matters because a token is not a fixed price: one
-- million `deepseek-v4-pro` output tokens cost thirty times one million
-- `deepseek-v4-flash` cached input tokens. A ceiling expressed in tokens
-- therefore permits wildly different bills depending on which route happens to
-- run, which is precisely the guarantee the operator needs and the one the
-- token cap cannot give.
--
-- So the token cap stays — it still bounds a single runaway loop — and a cost
-- ceiling is added beside it. The token cap protects the pipeline from itself;
-- the cost ceiling protects the operator's card.
--
-- In-flight calls have no settled cost yet, so a reservation records what the
-- caller authorizes, priced at the worst reasonable rate rather than the likely
-- one: peak tariff, no cache hits, completion at its full ceiling. Settlement
-- then overwrites that with measured cost. Month spend is
-- `coalesce(actual, estimate, 0)`, so a call counts at its authorized ceiling
-- while in flight and at its true cost the moment it settles — the ceiling is
-- never crossed by calls we had not yet finished paying for.

alter table public.ai_usage_ledger
  add column estimated_cost_microusd bigint check (estimated_cost_microusd >= 0);

create or replace function public.reserve_ai_tokens(
  p_user_id uuid,
  p_capability text,
  p_model text,
  p_reserve integer,
  p_user_monthly_cap integer,
  p_global_monthly_cap integer,
  p_estimated_cost_microusd bigint default null,
  p_global_monthly_cost_microusd bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  global_used bigint;
  user_used bigint;
  spent bigint;
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

  -- The money ceiling, and the reason this function fails closed twice over.
  --
  -- The two cost arguments carry defaults so the signature stays callable, but
  -- a missing or unpriceable cost is refused rather than waved through. Both
  -- nulls are the same mistake wearing different clothes: "no ceiling given"
  -- and "cannot price this call" each end with spend nobody bounded, and the
  -- permissive reading of either would quietly restore the uncapped behaviour
  -- this migration exists to remove.
  if p_global_monthly_cost_microusd is null or p_estimated_cost_microusd is null then
    return null;
  end if;

  select coalesce(sum(coalesce(cost_microusd, estimated_cost_microusd, 0)), 0)
    into spent
    from public.ai_usage_ledger
   where created_at >= month_start;
  if spent + p_estimated_cost_microusd > p_global_monthly_cost_microusd then
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

  insert into public.ai_usage_ledger (
    user_id, plan, capability, model, reserved_tokens, estimated_cost_microusd
  )
  values (
    p_user_id, user_plan, p_capability, p_model, p_reserve,
    greatest(0, p_estimated_cost_microusd)
  )
  returning id into reservation_id;
  return reservation_id;
end;
$fn$;

-- 0043's six-argument signature would otherwise stay callable beside the new
-- one, and PostgREST would keep resolving to whichever matched first — an
-- uncapped path left open by accident.
drop function if exists public.reserve_ai_tokens(uuid, text, text, integer, integer, integer);

revoke all on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint
) to service_role;

-- What the console reads to show burn. Returns one row so the page can render
-- spend, ceiling and share without adding up a ledger in the browser.
create or replace function public.ai_spend_this_month()
returns table (
  spent_microusd bigint,
  settled_microusd bigint,
  in_flight_microusd bigint,
  tokens bigint,
  calls bigint,
  unpriced_calls bigint,
  month_start timestamptz
)
language sql
security definer
set search_path = public
as $fn$
  select
    coalesce(sum(coalesce(cost_microusd, estimated_cost_microusd, 0)), 0)::bigint,
    coalesce(sum(coalesce(cost_microusd, 0)), 0)::bigint,
    coalesce(sum(case when cost_microusd is null
                      then coalesce(estimated_cost_microusd, 0) else 0 end), 0)::bigint,
    coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)::bigint,
    count(*)::bigint,
    count(*) filter (
      where cost_microusd is null and estimated_cost_microusd is null
    )::bigint,
    date_trunc('month', now())
  from public.ai_usage_ledger
  where created_at >= date_trunc('month', now());
$fn$;

revoke all on function public.ai_spend_this_month() from public, anon, authenticated;
grant execute on function public.ai_spend_this_month() to service_role;
