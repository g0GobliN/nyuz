-- nyuz -- remove the undocumented reserve_ai_tokens(..., 10 args) overload
--
-- Symptom, observed live on 2026-09-16: 0085's patch DO block requires exactly
-- one `reserve_ai_tokens` signature before it rewrites the function body, and
-- found two:
--
--   public.reserve_ai_tokens(uuid, text, text, integer, integer, integer,
--     bigint, bigint, bigint, bigint)              -- 10 args, no p_feature
--   public.reserve_ai_tokens(uuid, text, text, integer, integer, integer,
--     bigint, bigint, bigint, bigint, text)         -- 11 args, p_feature
--
-- This is the same failure class 0064 fixed for settle_ai_tokens: a stray
-- overload alongside the migration-backed one.
--
-- Which one goes: the 11-arg form is the only one any migration ever created.
-- 0053 dropped the prior 6-arg and 8-arg forms and created the 11-arg form
-- (with `p_feature text default 'unknown'`); 0064, 0070, 0079 and 0080 have
-- since patched its body in place via pg_get_functiondef/replace/execute,
-- never its signature, and 0080's `comment on function` names that exact
-- 11-arg signature. No migration has ever created a 10-arg form. It was
-- created out-of-band and is the stray.

do $$
declare
  target regprocedure;
begin
  select p.oid::regprocedure
    into target
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'reserve_ai_tokens'
     and p.pronargs = 10;

  if target is null then
    raise notice 'reserve_ai_tokens(..., 10 args) not present -- nothing to drop';
  else
    execute format('drop function %s', target);
    raise notice 'dropped %', target;
  end if;
end $$;

-- Confirm exactly one overload survives, and that it is the 11-arg form.
do $$
declare
  sigs text;
  n integer;
  last_arg oid;
begin
  select count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), ' | '),
         min(p.proargtypes[p.pronargs - 1])
    into n, sigs, last_arg
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public'
     and p.proname = 'reserve_ai_tokens';

  if n <> 1 then
    raise exception 'reserve_ai_tokens still has % overloads: %', n, sigs;
  end if;

  if last_arg <> 'text'::regtype then
    raise exception 'surviving reserve_ai_tokens takes % as its last argument, not text (p_feature): %',
      last_arg::regtype, sigs;
  end if;

  raise notice 'reserve_ai_tokens resolved to a single signature: %', sigs;
end $$;

-------------------------------------------------------------------------------
-- Audit
-------------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('p0.reserve_overload.repaired', 'system', 'p0', '0086',
   jsonb_build_object(
     'dropped', 'reserve_ai_tokens(uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint)',
     'kept', 'reserve_ai_tokens(uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text)',
     'reason', '0085''s patch DO block requires exactly one reserve_ai_tokens signature and found two',
     'applied_at', now()
   ));
