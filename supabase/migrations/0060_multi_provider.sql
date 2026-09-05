  -- nyuz -- multi-provider clustering (docs/nyuz-cost-cutting.md item 5)
  --
  -- Adds Groq as a provider for the cluster tier. Groq's Llama 3.1 8B
  -- is significantly cheaper than DeepSeek Flash for the same task:
  -- clustering is the highest-volume, lowest-visibility AI call, and
  -- it doesn't need the strongest model.
  --
  -- The cluster tier routes through `ai_model_routes` → `ai_providers`.
  -- Switching the cluster tier to Groq is a console toggle, not a code
  -- change. This migration adds the provider row and the route.
  --
  -- See docs/nyuz-cost-cutting.md item 5.

  -- ---------------------------------------------------------------------------
  -- Add Groq provider
  -- ---------------------------------------------------------------------------

  insert into public.ai_providers (slug, label, base_url, api_key_env, active)
  values
    ('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', false)
  on conflict (slug) do nothing;

  -- ---------------------------------------------------------------------------
  -- Add Groq model route for cluster tier
  --
  -- The route points to Groq's Llama 3.1 8B. max_tokens is set to 2048
  -- to match the reduced ceiling from migration 0058.
  --
  -- This upserts the cluster route to point at Groq. The provider is
  -- inactive by default, so `resolveRoute()` falls back to the env
  -- fallback until the operator activates it and sets the secret.
  --
  -- To switch the cluster tier to Groq:
  --   1. Set the GROQ_API_KEY secret with `wrangler secret put GROQ_API_KEY`
  --   2. Activate the Groq provider in the admin console
  --   3. The route cache is 60 seconds per isolate; a save invalidates it
  --
  -- See docs/ai-providers.md for the provider switching procedure.
  -- See docs/nyuz-cost-cutting.md item 5.

  insert into public.ai_model_routes (capability, provider_id, model, max_tokens)
  select 'cluster'::ai_capability, p.id, 'llama-3.1-8b', 2048
    from public.ai_providers p
  where p.slug = 'groq'
  on conflict (capability) do update
    set model = excluded.model,
        provider_id = excluded.provider_id,
        max_tokens = excluded.max_tokens,
        updated_at = now();

  -- ---------------------------------------------------------------------------
  -- Record the cost-cutting audit
  -- ---------------------------------------------------------------------------

  insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
  values
    ('cost_cutting.multi_provider.applied', 'system', 'cost_cutting', '0059',
    jsonb_build_object('provider', 'groq', 'model', 'llama-3.1-8b', 'action', 'provider_added', 'applied_at', now()));
