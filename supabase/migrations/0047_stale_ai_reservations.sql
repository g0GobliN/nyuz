-- nyuz -- stale AI reservations must not spend the month's budget forever
--
-- `reserve_ai_tokens` writes a pessimistic reservation before a model call and
-- `settle_ai_tokens` replaces it with what the call actually used. A third case
-- was unhandled: a call that neither settles nor releases.
--
-- `release_ai_reservation` only fires for errors the application can prove were
-- unbilled -- auth failures and 4xx. A 5xx, a dropped connection or a timeout is
-- deliberately not in that set, because the provider may have generated a
-- response we never saw. The reservation is therefore kept as a conservative
-- charge, and kept is the operative word: nothing ever clears it.
--
-- On 2026-08-30 and 08-31 every model call failed for two days. 553 reservations
-- were written, none settled, and no event was analysed -- the pipeline produced
-- nothing at all. Those rows went on holding 2,556,264 tokens and $5.45 against a
-- 500,000-token and $10 monthly ceiling, so a provider outage that cost nothing
-- locked the pipeline out for the rest of the month. Cost control that fails
-- closed on spend that never happened is not cost control.
--
-- Two changes, belt and braces:
--
--   1. A reaper the cron calls, so the ledger reflects reality.
--   2. Both ceilings ignore stale reservations directly, so the cap self-heals
--      even if the reaper never runs.
--
-- One hour is the threshold. The transport's own timeout is 600 seconds with two
-- retries, so no call can still be in flight after that; a reservation older
-- than an hour is not pending, it is abandoned. Rows that recorded any usage are
-- never touched by either path -- those are real charges.

create or replace function public.void_stale_ai_reservations(
  p_older_than interval default '1 hour'
)
returns integer
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
   where reserved_tokens > 0
     and cost_microusd is null
     and prompt_tokens = 0
     and completion_tokens = 0
     and created_at < now() - p_older_than;
  get diagnostics changed = row_count;
  return changed;
end;
$fn$;

revoke all on function public.void_stale_ai_reservations(interval)
  from public, anon, authenticated;
grant execute on function public.void_stale_ai_reservations(interval) to service_role;

comment on function public.void_stale_ai_reservations(interval) is
  'Clears reservations that never settled and recorded no usage. Rows with any '
  'recorded prompt tokens, completion tokens or cost are real spend and are '
  'never touched.';

-- The same predicate, inlined into the ceiling so an unreaped ledger cannot
-- block the pipeline. Identical to 0044 except for the two `stale` clauses.
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
  stale_before timestamptz := now() - interval '1 hour';
begin
  if p_reserve <= 0 or p_global_monthly_cap <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(18295, 1);
  select coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)
    into global_used
    from public.ai_usage_ledger
   where created_at >= month_start
     and not (
       reserved_tokens > 0
       and cost_microusd is null
       and prompt_tokens = 0
       and completion_tokens = 0
       and created_at < stale_before
     );
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
  -- 0044 exists to remove.
  if p_global_monthly_cost_microusd is null or p_estimated_cost_microusd is null then
    return null;
  end if;

  select coalesce(sum(coalesce(cost_microusd, estimated_cost_microusd, 0)), 0)
    into spent
    from public.ai_usage_ledger
   where created_at >= month_start
     and not (
       reserved_tokens > 0
       and cost_microusd is null
       and prompt_tokens = 0
       and completion_tokens = 0
       and created_at < stale_before
     );
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
       and created_at >= month_start
       and not (
         reserved_tokens > 0
         and cost_microusd is null
         and prompt_tokens = 0
         and completion_tokens = 0
         and created_at < stale_before
       );
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

revoke all on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint
) to service_role;
