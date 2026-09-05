-- nyuz -- remove the undocumented settle_ai_tokens(text, ...) overload (P0-2)
--
-- Symptom, observed live on 2026-09-05:
--
--   Could not choose the best candidate function between:
--     public.settle_ai_tokens(p_id => text,  p_prompt_tokens => integer, ...)
--     public.settle_ai_tokens(p_id => uuid,  p_prompt_tokens => integer, ...)
--
-- PostgREST sends `p_id` as a JSON string, which is equally coercible to `text`
-- and to `uuid`, so with both overloads present it cannot resolve the call and
-- every settlement fails. The provider call has already happened and already
-- cost money by that point, so the effect is real spend that never reaches the
-- ledger, plus a reservation left pending forever.
--
-- That is what the ledger shows: 211 unsettled rows on 2026-09-04 and every row
-- on 2026-09-05 unsettled, against 475 settled on 2026-09-03.
--
-- Which one goes:
--
--   `uuid` is the migration-backed signature. It is the only form that has ever
--   been declared in this repo -- 0017 (3-arg), 0043 (5-arg) and 0053 (6-arg,
--   current) all take `p_id uuid`. `ai_usage_ledger.id` is itself `uuid`
--   (0017:185), and src/lib/ai/config.ts:497 passes that id straight through.
--
--   The `text` variant is in no migration. It was created out-of-band and is
--   the stray. Dropping it leaves the declared function untouched.
--
-- Matching is done on `proargtypes`, the catalog's own argument type vector,
-- rather than on the rendered signature text. The first attempt at this
-- migration compared against `pg_get_function_identity_arguments(...)` on the
-- assumption that it renders types alone; on this server it renders parameter
-- names too ('p_id text, p_prompt_tokens integer, ...'), so the equality never
-- matched, nothing was dropped, and the assertion below correctly refused the
-- migration. Comparing type OIDs avoids depending on how a signature is
-- formatted.

do $$
declare
  target regprocedure;
begin
  select p.oid::regprocedure
    into target
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'settle_ai_tokens'
     and p.pronargs = 6
     and p.proargtypes[0] = 'text'::regtype;

  if target is null then
    raise notice 'settle_ai_tokens(text, ...) not present -- nothing to drop';
  else
    execute format('drop function %s', target);
    raise notice 'dropped %', target;
  end if;
end $$;

-- Confirm exactly one overload survives, and that it is the uuid one. A bare
-- count is not enough: the failure mode this migration exists to fix is "two
-- functions, wrong one chosen", so the surviving argument type is asserted too.
do $$
declare
  sigs text;
  n integer;
  first_arg oid;
begin
  select count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), ' | '),
         min(p.proargtypes[0])
    into n, sigs, first_arg
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public'
     and p.proname = 'settle_ai_tokens';

  if n <> 1 then
    raise exception 'settle_ai_tokens still has % overloads: %', n, sigs;
  end if;

  if first_arg <> 'uuid'::regtype then
    raise exception 'surviving settle_ai_tokens takes % as its first argument, not uuid: %',
      first_arg::regtype, sigs;
  end if;

  raise notice 'settle_ai_tokens resolved to a single signature: %', sigs;
end $$;

-------------------------------------------------------------------------------
-- Audit
-------------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('p0.settle_overload.repaired', 'system', 'p0', '0064',
   jsonb_build_object(
     'dropped', 'settle_ai_tokens(text, integer, integer, integer, bigint, text)',
     'kept', 'settle_ai_tokens(uuid, integer, integer, integer, bigint, text)',
     'reason', 'PostgREST could not resolve the overload; every settlement failed',
     'applied_at', now()
   ));
