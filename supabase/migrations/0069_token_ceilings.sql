-- nyuz -- the clustering ceiling becomes a setting, and the analysis ceiling is raised
--
-- ---------------------------------------------------------------------------
-- 1. Clustering had a ceiling nobody could see or move
-- ---------------------------------------------------------------------------
--
-- 0056 moved the analysis, digest and Ask ceilings into `ai_runtime_config`.
-- Clustering was missed, and its number came from whichever of two places
-- answered first:
--
--   `ai_model_routes.max_tokens` for the `cluster` capability, if a row exists
--   `ENV_FALLBACK.cluster` in src/lib/ai/config.ts, if one does not
--
-- In this project no row existed -- 0060 tried to insert one for a `groq`
-- provider that was never seeded, so the insert matched nothing, and 0063's
-- repair was an UPDATE, which no-ops on an absent row. So every clustering call
-- ran on the code fallback of 1024, which is `MIN_COMPLETION_TOKENS`, the floor.
-- deepseek-v4-flash spends its whole allowance on hidden reasoning at that
-- ceiling and returns HTTP 200 with empty content, so the article fails with
-- "hit the token ceiling during reasoning (1024 reasoning tokens of 1024)".
--
-- The ceiling is now `ai.cluster_max_tokens`, read by the Worker and by
-- `npm run pipeline` alike, and editable at /admin -> AI runtime.
--
-- 2048, not more. Clustering is the highest-volume model call nyuz makes -- once
-- per shortlisted article, where every other stage is once per event or once per
-- reader -- so a ceiling raised here multiplies across the entire ingest. The
-- reply is a JSON array of integers; 2048 is headroom for the reasoning that
-- precedes it, not for a longer answer. The bound in
-- src/lib/ai/runtime-config.ts caps the console at 4096 for the same reason.

insert into public.ai_runtime_config (key, value, note)
values (
  'ai.cluster_max_tokens',
  '{"value": 2048}'::jsonb,
  'Moved out of the code fallback in 0069: clustering was running on the 1024 floor and failing with empty content.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The missing cluster route
-- ---------------------------------------------------------------------------
--
-- Restored so the console shows what clustering actually uses instead of
-- "env-fallback", and so turning `ai.provider_fallback` off does not take
-- clustering down with it. Same provider, same model and now the same ceiling
-- as the setting above, so nothing about the calls changes -- what changes is
-- that the routing is visible and configurable rather than implicit in a
-- constant.
--
-- `max_tokens` here is display and last-resort only: cluster.ts passes
-- `ai.cluster_max_tokens` explicitly on every call, precisely so that this row
-- and the runtime setting cannot drift into two different live ceilings.

insert into public.ai_model_routes (capability, provider_id, model, max_tokens)
select 'cluster'::ai_capability, p.id, 'deepseek-v4-flash', 2048
  from public.ai_providers p
 where p.slug = 'deepseek'
on conflict (capability) do update
   set max_tokens = excluded.max_tokens,
       updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Analysis: 4096 -> 6144
-- ---------------------------------------------------------------------------
--
-- `ai.analyse_max_tokens` has been read from this table since 0056, but no row
-- was ever written, so the effective value was the code default of 4096. That
-- is enough for most events and not for all of them: a deepseek-v4-pro analysis
-- of a well-covered event returned empty content after 4096 reasoning tokens.
--
-- Raised for analysis ONLY. The other ceilings are untouched: the failures were
-- specific to the full analysis contract, which asks for the largest JSON
-- document nyuz requests anywhere, and raising every ceiling to cover one
-- stage's worst case would raise the reservation held against the monthly
-- budget for calls that never needed it.
--
-- This is a starting value, not a constant. It is an operator setting -- change
-- it at /admin -> AI runtime, not here.

insert into public.ai_runtime_config (key, value, note)
values (
  'ai.analyse_max_tokens',
  '{"value": 6144}'::jsonb,
  'Raised from the 4096 code default in 0069 after a deepseek-v4-pro analysis exhausted 4096 tokens on reasoning.'
)
on conflict (key) do update
   set value = excluded.value,
       note = excluded.note,
       changed_at = now();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values (
  'ai.token_ceilings.applied', 'system', 'ai_runtime_config', '0069',
  jsonb_build_object(
    'cluster_max_tokens', 2048,
    'analyse_max_tokens', 6144,
    'cluster_route_restored', true,
    'applied_at', now()
  )
);
