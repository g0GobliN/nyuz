-- nyuz -- restore known-good prompts and the DeepSeek cluster route (P0)
--
-- Two things applied by 0060 and 0061 were speculative cost optimizations that
-- P0 is not willing to keep. This migration reverses both. It touches no table
-- structure: `cluster_cache`, `digest_cache` and `ask_cache` stay exactly where
-- they are, dormant, along with their RPCs and the indexes from 0061. Only the
-- two rows that change live behaviour are put back.
--
--   1. `ai_prompts` for cluster/digest/reason, back to the 0003_admin.sql text.
--   2. `ai_model_routes` for the cluster capability, back to DeepSeek.

-------------------------------------------------------------------------------
-- 1. Restore the known-good system prompts
-------------------------------------------------------------------------------
--
-- 0061 rewrote these three purely to shave prompt tokens, with no before/after
-- quality measurement. The saving is a rounding error against the monthly
-- ceiling; the risk to what a reader actually receives is not. These are the
-- exact strings seeded in 0003_admin.sql:459-464.

update public.ai_prompts
   set system_prompt = case
     when key = 'cluster' then
       'You group near-duplicate headlines into a single real-world event. Answer only with JSON.'
     when key = 'digest' then
       'You write one short paragraph explaining why a story matters to this specific reader. No preamble, no hedging, no restating the headline.'
     when key = 'reason' then
       'You explain a story in depth for a reader who asked for more. Say what changed and what it means. Never invent sources.'
   end
 where key in ('cluster', 'digest', 'reason');

-------------------------------------------------------------------------------
-- 2. Restore the cluster route to DeepSeek
-------------------------------------------------------------------------------
--
-- 0060 added Groq as a provider and then repointed the existing cluster route
-- at it with `on conflict (capability) do update`, overwriting the DeepSeek
-- provider_id and model in place. Groq is `active = false`, so resolveRoute()
-- currently falls back to the env route (src/lib/ai/config.ts:158) and no
-- clustering has gone to Groq. That is a safety net, not a configuration:
-- activating Groq in the admin console would silently switch clustering to
-- llama-3.1-8b with no code change and no review.
--
-- So the stored route is put back to DeepSeek explicitly. The Groq provider row
-- itself is left in place -- it is harmless while inactive, and dropping it
-- would be destructive cleanup for tidiness.
--
-- max_tokens is 1024, which is the P0-6 cluster allowance and already what the
-- env fallback in config.ts uses. Restoring the route without it would silently
-- raise the ceiling back to 0058's 2048 the moment the DB route took effect.

update public.ai_model_routes
   set provider_id = (select id from public.ai_providers where slug = 'deepseek'),
       model = 'deepseek-v4-flash',
       max_tokens = 1024,
       updated_at = now()
 where capability = 'cluster';

-- Belt and braces: Groq must not be active. 0060 inserted it inactive, but an
-- operator may have toggled it while testing.
update public.ai_providers set active = false where slug = 'groq';

-------------------------------------------------------------------------------
-- Audit
-------------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('p0.restore.applied', 'system', 'p0', '0063',
   jsonb_build_object(
     'prompts_restored', jsonb_build_array('cluster', 'digest', 'reason'),
     'cluster_route', jsonb_build_object(
       'provider', 'deepseek',
       'model', 'deepseek-v4-flash',
       'max_tokens', 1024
     ),
     'caches_deactivated_in_code', jsonb_build_array(
       'cluster_cache', 'digest_cache', 'ask_cache'
     ),
     'tables_dropped', false,
     'applied_at', now()
   ));
