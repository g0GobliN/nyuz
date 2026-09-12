-- nyuz -- provider top-up credit becomes an enforced operating budget.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- 0048 gave the console a balance -- what was topped up, what has been spent
-- since, how fast it is draining -- and said out loud that it would not gate
-- anything: "the provider refuses calls once its own credit runs out, so a
-- second gate here would add a failure mode without removing one."
--
-- That was true until `ai.monthly_cost_usd` (0044/0056) became, in practice,
-- the thing operators actually top up against. Measured 2026-09-12: $8.32
-- recorded across two top-ups, $9.03 spent since the first one, and the
-- $10.00 monthly safety cap is what is actually stopping calls right now --
-- not the provider, and not the recorded balance. A top-up does not buy any
-- more room once the safety cap binds, and the safety cap resets on the 1st
-- whether or not the operator has paid for that.
--
-- ---------------------------------------------------------------------------
-- The two ceilings, and why both stay
-- ---------------------------------------------------------------------------
--
--   ai.monthly_cost_usd   -- emergency ceiling. Resets every calendar month.
--                            Independently configurable, deliberately set
--                            ABOVE routine spend (docs/deployment.md already
--                            recommends this). A top-up never raises it and
--                            it never fabricates credit. Never touched here.
--
--   provider top-up credit -- operating budget. Does not reset. Depletes with
--                            settled and in-flight spend; a recorded top-up
--                            is the only thing that refills it.
--
-- A reservation is authorised only when it fits under BOTH: the existing
-- monthly/daily checks are untouched, and this migration adds one more of the
-- same shape, under the same advisory lock, so the two ceilings are checked
-- atomically alongside each other rather than one gating a call the other
-- would have refused a moment later.
--
-- ---------------------------------------------------------------------------
-- An explicit switch, not an implicit one
-- ---------------------------------------------------------------------------
--
-- An earlier draft of this migration skipped the whole gate whenever
-- `ai_credit_topups` was empty, on the reasoning that enforcing a zero
-- balance against a project nobody had told about top-ups would refuse every
-- call forever. That is true, but it means the gate's enforcement depended on
-- a side effect of whether anyone had happened to insert a row -- which is
-- silent, and silent is exactly what a spend gate must not be.
--
-- `provider_credit_gate_enabled` (a `feature_flags` row, defaulting to OFF)
-- replaces that inference with a decision an operator makes on purpose:
--
--   gate OFF               -- no enforcement at all. Development, a fresh
--                             migration, or an emergency where the operator
--                             needs AI back on before recording a top-up.
--                             Exactly today's behaviour.
--   gate ON, no top-up      -- available credit is exactly zero. Every
--                             reservation is refused. This is the point: a
--                             production deployment that turns the gate on
--                             cannot spend without someone having deliberately
--                             funded it.
--   gate ON, top-ups exist  -- available credit = top-ups minus settled and
--                             in-flight spend since the first one. A new
--                             top-up raises it immediately.
--
-- Applying this migration only creates the flag, OFF. Nothing about
-- production behaviour changes until an operator turns it on -- a second,
-- deliberate step, the same two-step shape 0078 used for on-demand
-- Understand.
--
-- ---------------------------------------------------------------------------
-- Why a patch, not a rewrite
-- ---------------------------------------------------------------------------
--
-- `reserve_ai_tokens` has been redefined five times (0053, then patched by
-- 0064, 0070, 0079 among others); the installed text, not any single
-- migration file, is the authority on its current body. This migration reads
-- that installed text, inserts one self-contained check immediately after the
-- advisory lock is taken (so it participates in the same atomic
-- read-then-insert everything else here relies on), and writes the function
-- back. No new declared variables, no change to the existing checks, no
-- change to its signature, grants or callers.
--
-- Idempotent: if the check is already present, this is a no-op. If the
-- expected anchor line is missing -- meaning the installed function's shape
-- has changed in a way this migration did not anticipate -- it fails loudly
-- rather than silently shipping without the new gate.

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  ('provider_credit_gate_enabled',
   'Provider credit gate',
   'When on, an AI reservation is refused unless enough recorded provider '
   'top-up credit remains -- and refused outright if no top-up has ever been '
   'recorded. When off (the default), recorded top-ups remain purely '
   'informational, as they were before this flag existed. Off is for '
   'development, a fresh migration, or an emergency needing AI back on before '
   'a top-up can be recorded -- not a normal production state. The monthly '
   'safety cap is separate and keeps applying either way.',
   false, 100)
on conflict (key) do nothing;

do $$
declare
  definition text;
  anchor text := 'perform pg_advisory_xact_lock(18295, 1);';
  credit_check text := $ck$
  -- Provider top-up credit (0080): an operating budget independent of the
  -- monthly safety cap below, enforced only while `provider_credit_gate_enabled`
  -- is on. With the gate on and no top-up ever recorded, available credit is
  -- exactly zero -- this is deliberate, not a fallback: a production
  -- deployment must be funded on purpose before it can spend. Nothing here
  -- changes the safety cap, and nothing in the safety cap fabricates credit.
  if coalesce(
       (select enabled from public.feature_flags where key = 'provider_credit_gate_enabled'),
       false
     )
     and (
       coalesce((select sum(t.amount_microusd) from public.ai_credit_topups t), 0)
     ) < (
       coalesce((
         select sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0))
           from public.ai_usage_ledger l
          where l.created_at >= (select min(occurred_at) from public.ai_credit_topups)
       ), 0) + p_estimated_cost_microusd
     )
  then
    return null;
  end if;
$ck$;
begin
  select pg_get_functiondef(p.oid) into definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserve_ai_tokens';

  if definition is null then
    raise exception 'reserve_ai_tokens does not exist -- cannot install the provider-credit gate';
  end if;

  -- Already installed (a re-run, or applied by hand already): nothing to do.
  if position('provider_credit_gate_enabled' in definition) > 0 then
    return;
  end if;

  if position(anchor in definition) = 0 then
    raise exception
      'reserve_ai_tokens: expected anchor (advisory lock line) not found -- '
      'the installed function''s shape has moved and this migration''s patch '
      'was not applied. Update 0080 rather than skipping it.';
  end if;

  definition := replace(definition, anchor, anchor || credit_check);
  execute definition;
end;
$$;

comment on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text
) is
  'Reserves tokens/cost for one AI call under an advisory lock, atomically '
  'against: the daily per-model caps, the monthly token and cost safety caps, '
  'the per-user monthly cap, and (0080) recorded provider top-up credit when '
  'the provider_credit_gate_enabled flag is on. Returns null on refusal, the '
  'new ai_usage_ledger row id on success.';
