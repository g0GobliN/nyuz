-- nyuz -- Analyse thinking becomes a runtime setting
--
-- ---------------------------------------------------------------------------
-- What this fixes
-- ---------------------------------------------------------------------------
--
-- 0071 made cluster thinking configurable. This migration adds the
-- counterpart for analysis: `ai.analyse_thinking`. When true (the
-- launch default), all analysis calls use thinking as before. When
-- false, the pipeline routes routine events to `standard-no-thinking`
-- (thinking disabled) and only complex events to `complex-thinking`
-- (thinking enabled). This is the DB-backed control that lets an
-- operator restore "Analyse thinking = always enabled" without a
-- deployment.
--
-- ---------------------------------------------------------------------------
-- Precedence
-- ---------------------------------------------------------------------------
--
--   this table  ->  environment variable  ->  code default
--
-- The code default is `true` so the launch behaviour is unchanged:
-- every analysis call uses thinking until an operator explicitly turns
-- it off.

insert into public.ai_runtime_config (key, value, note)
values (
  'ai.analyse_thinking',
  '{"value": true}'::jsonb,
  'Analyse thinking toggle. When false, routine events use standard-no-thinking (thinking disabled) and only complex events use complex-thinking (thinking enabled). Set to true to restore always-enabled thinking.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values (
  'ai.analyse_thinking.added', 'system', 'ai_runtime_config', '0072',
  jsonb_build_object(
    'analyse_thinking', true,
    'applied_at', now()
  )
);
