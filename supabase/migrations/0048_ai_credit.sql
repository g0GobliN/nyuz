-- nyuz -- prepaid AI credit: what was deposited, what is left, how fast it drains
--
-- 0044 gave the pipeline a calendar-month ceiling read from AI_MONTHLY_COST_USD.
-- That models a monthly allowance, which is not how this project actually pays
-- for inference: credit is bought in one-off top-ups that deplete and do not
-- reset on the 1st. Those two shapes disagree in both directions -- a $5 top-up
-- against a $10 ceiling stops paying for calls the ceiling still authorizes,
-- and $30 of credit is stopped dead by the same ceiling on the 12th.
--
-- This migration records the deposits so the balance can be counted rather than
-- remembered. It deliberately does not touch `reserve_ai_tokens`: the provider
-- refuses calls once its own credit runs out, so a second gate here would add a
-- failure mode without removing one. What was missing is not another stop, it
-- is the warning *before* the stop, which is what a balance and a burn rate buy.
--
-- Spend is counted with 0047's stale-reservation predicate so an abandoned
-- reservation from a provider outage cannot make the balance look spent. Any
-- change to that predicate must be made in all three places at once.

create table public.ai_credit_topups (
  id uuid primary key default gen_random_uuid(),
  amount_microusd bigint not null check (amount_microusd > 0),
  note text check (note is null or length(note) <= 200),
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ai_credit_topups_occurred_idx
  on public.ai_credit_topups (occurred_at desc);

alter table public.ai_credit_topups enable row level security;
-- No browser policy: the server owns cost accounting, as with every other
-- ledger in 0043.

comment on table public.ai_credit_topups is
  'One row per credit purchase from the model provider. Amounts are what was '
  'paid, not what was promised: record the charge, not the advertised balance.';

/**
 * Deposits, spend and what is left.
 *
 * Spend is measured from the first recorded top-up rather than from all time,
 * and this is the one judgement call in the file. Calls made before the
 * operator started recording deposits were paid for by credit that was never
 * entered; subtracting them would report a balance lower than the provider
 * shows, and a console that disagrees with the invoice is a console nobody
 * trusts. That earlier spend is still returned, separately, as
 * `unfunded_spent_microusd` -- excluded from the balance but never hidden.
 */
create or replace function public.ai_credit_balance()
returns table (
  topped_up_microusd bigint,
  topups bigint,
  first_topup_at timestamptz,
  last_topup_at timestamptz,
  last_topup_microusd bigint,
  spent_microusd bigint,
  settled_microusd bigint,
  in_flight_microusd bigint,
  unfunded_spent_microusd bigint,
  calls bigint,
  unpriced_calls bigint
)
language sql
security definer
set search_path = public
as $fn$
  with deposits as (
    select
      coalesce(sum(amount_microusd), 0)::bigint as total,
      count(*)::bigint                          as n,
      min(occurred_at)                          as first_at,
      max(occurred_at)                          as last_at
    from public.ai_credit_topups
  ),
  latest as (
    select amount_microusd
      from public.ai_credit_topups
     order by occurred_at desc, created_at desc
     limit 1
  ),
  live as (
    select l.*
      from public.ai_usage_ledger l
     where not (
       l.reserved_tokens > 0
       and l.cost_microusd is null
       and l.prompt_tokens = 0
       and l.completion_tokens = 0
       and l.created_at < now() - interval '1 hour'
     )
  )
  select
    d.total,
    d.n,
    d.first_at,
    d.last_at,
    coalesce((select amount_microusd from latest), 0)::bigint,
    coalesce(sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0))
             filter (where d.first_at is not null and l.created_at >= d.first_at), 0)::bigint,
    coalesce(sum(coalesce(l.cost_microusd, 0))
             filter (where d.first_at is not null and l.created_at >= d.first_at), 0)::bigint,
    coalesce(sum(case when l.cost_microusd is null
                      then coalesce(l.estimated_cost_microusd, 0) else 0 end)
             filter (where d.first_at is not null and l.created_at >= d.first_at), 0)::bigint,
    coalesce(sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0))
             filter (where d.first_at is null or l.created_at < d.first_at), 0)::bigint,
    count(l.id) filter (where d.first_at is not null and l.created_at >= d.first_at)::bigint,
    count(l.id) filter (
      where d.first_at is not null
        and l.created_at >= d.first_at
        and l.cost_microusd is null
        and l.estimated_cost_microusd is null
    )::bigint
  from deposits d
  left join live l on true
  group by d.total, d.n, d.first_at, d.last_at;
$fn$;

/**
 * The same spend, sliced by trailing window, so "am I burning faster than
 * usual" is answerable without exporting the ledger.
 *
 * Fixed windows rather than a caller-supplied interval: these four are what the
 * console renders, and a free parameter on a security-definer aggregate over
 * every AI call is a scan nobody asked for.
 */
create or replace function public.ai_spend_windows()
returns table (
  window_key text,
  since timestamptz,
  spent_microusd bigint,
  settled_microusd bigint,
  in_flight_microusd bigint,
  tokens bigint,
  calls bigint
)
language sql
security definer
set search_path = public
as $fn$
  select
    w.key,
    w.since,
    coalesce(sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0)), 0)::bigint,
    coalesce(sum(coalesce(l.cost_microusd, 0)), 0)::bigint,
    coalesce(sum(case when l.cost_microusd is null
                      then coalesce(l.estimated_cost_microusd, 0) else 0 end), 0)::bigint,
    coalesce(sum(greatest(l.reserved_tokens, l.prompt_tokens + l.completion_tokens)), 0)::bigint,
    count(l.id)::bigint
  from (values
    (1, 'hour'::text,  now() - interval '1 hour'),
    (2, 'day'::text,   now() - interval '1 day'),
    (3, 'week'::text,  now() - interval '7 days'),
    (4, 'month'::text, now() - interval '30 days')
  ) as w(ord, key, since)
  left join public.ai_usage_ledger l
    on l.created_at >= w.since
   and not (
     l.reserved_tokens > 0
     and l.cost_microusd is null
     and l.prompt_tokens = 0
     and l.completion_tokens = 0
     and l.created_at < now() - interval '1 hour'
   )
  group by w.ord, w.key, w.since
  order by w.ord;
$fn$;

revoke all on table public.ai_credit_topups from public, anon, authenticated;
revoke all on function public.ai_credit_balance() from public, anon, authenticated;
grant execute on function public.ai_credit_balance() to service_role;
revoke all on function public.ai_spend_windows() from public, anon, authenticated;
grant execute on function public.ai_spend_windows() to service_role;
