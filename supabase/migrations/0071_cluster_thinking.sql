-- nyuz -- cluster extended thinking becomes a runtime setting
--
-- ---------------------------------------------------------------------------
-- 1. Default row
-- ---------------------------------------------------------------------------
--
-- `ai.cluster_thinking` controls whether deepseek cluster calls may use
-- extended thinking. deepseek-v4-flash can spend the entire token allowance
-- on hidden reasoning before writing any JSON; disabling extended thinking
-- for clustering keeps the ceiling effective without changing analysis.

insert into public.ai_runtime_config (key, value, note)
values (
  'ai.cluster_thinking',
  '{"value": true}'::jsonb,
  'Cluster extended thinking toggle. Disabled when reasoning burn makes clustering unreliable at the configured ceiling.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values (
  'ai.cluster_thinking.added', 'system', 'ai_runtime_config', '0071',
  jsonb_build_object(
    'cluster_thinking', true,
    'applied_at', now()
  )
);
