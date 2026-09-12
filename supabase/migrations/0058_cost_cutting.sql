    -- nyuz -- cost-cutting measures (docs/nyuz-cost-cutting.md)
    --
    -- This migration implements the highest-impact, lowest-effort cost
    -- reductions from the cost-cutting plan. Each change is backwards-
    -- compatible for callers.
    --
    -- ---------------------------------------------------------------------------
    -- 1. Enable demand-driven collection
    -- ---------------------------------------------------------------------------
    --
    -- `demand_driven_sources` (0031) is coded and tested but currently
    -- off. When enabled, `sources_to_collect()` returns only sources that
    -- are core, or have demand within the grace period. Non-core sources
    -- with no eligible reader are skipped entirely.
    --
    -- This saves subrequests (fetch calls) on Workers, which is the binding
    -- constraint on the free plan. A run that skips 27 zero-demand sources
    -- can reach 27 more that somebody is waiting for.
    --
    -- The `last_demand_at` column is already populated (0031 backfilled to
    -- now()). The `refresh_source_demand()` function already runs on every
    -- ingest. Flipping this flag changes behaviour immediately.
    --
    -- See docs/track.md phase 5 and docs/nyuz-cost-cutting.md item 3.

    update public.feature_flags
      set enabled = true,
          updated_at = now()
    where key = 'demand_driven_sources';

    -- ---------------------------------------------------------------------------
    -- 2. Enable adaptive polling
    -- ---------------------------------------------------------------------------
    --
    -- `adaptive_polling` (0032) is coded and tested but currently off.
    -- When enabled, `recompute_polling_tiers()` adjusts source cadences
    -- based on recent publication activity. Quiet sources get longer
    -- intervals. Active sources keep short intervals.
    --
    -- This reduces fetch calls for sources that haven't published in days.
    -- Fewer fetches → fewer articles → fewer clustering candidates →
    -- fewer analysis calls.
    --
    -- See docs/nyuz-cost-cutting.md item 8.

    update public.feature_flags
      set enabled = true,
          updated_at = now()
    where key = 'adaptive_polling';

    -- ---------------------------------------------------------------------------
    -- 3. Reduce max_tokens to the minimum viable size
    -- ---------------------------------------------------------------------------
    --
    -- The current max_tokens are sized for the worst case (reasoning +
    -- output). But measured actuals are far lower:
    --
    --   cluster: ~610 tokens/article, max_tokens=8192 → using ~7%
    --   digest: ~1,700 tokens/event, max_tokens=8192 → using ~21%
    --   reason: ~1,700 tokens/event, max_tokens=16384 → using ~10%
    --
    -- Reducing max_tokens does two things:
    --   1. Reduces the per-call token reservation, extending the monthly
    --      token budget
    --   2. Reduces the per-call cost estimate, extending the monthly
    --      dollar ceiling
    --
    -- The reduction is conservative with headroom for reasoning bursts.
    -- If a call needs more tokens than max_tokens, it returns
    -- finish_reason "length" with empty content. The complete() function
    -- handles this as a failure and throws TruncatedCompletionError.
    -- The retry in completeJson() then needs more headroom.
    --
    -- These values are sized for the measured actuals plus 2-3x headroom.
    -- Monitor TruncatedCompletionError rate after applying and adjust.
    --
    -- See docs/nyuz-cost-cutting.md item 4.

    update public.ai_model_routes
      set max_tokens = case
        when capability = 'cluster' then 2048
        when capability = 'digest' then 4096
        when capability = 'reason' then 8192
      end,
      updated_at = now()
    where capability in ('cluster', 'digest', 'reason');

    -- ---------------------------------------------------------------------------
    -- 4. Reclassify low-value sources to demand
    -- ---------------------------------------------------------------------------
    --
    -- Sources classified as `core` are always collected and clustered
    -- regardless of reader demand. The `0024` and `0026` migrations already
    -- moved many sources to `demand`, but some remain `core` that are
    -- not confirmed high-value always-publishing outlets.
    --
    -- This reclassifies sources that are not confirmed, high-value,
    -- always-publishing outlets to `coverage_mode = 'demand'`. The
    -- demand gate and demand-driven collection will then skip them when
    -- no reader is interested.
    --
    -- Core should be only sources that publish breaking news multiple
    -- times daily and are confirmed to drive reader engagement.
    -- Everything else should be demand.
    --
    -- See docs/nyuz-cost-cutting.md item 2.
    --
    -- NOTE: This is a conservative reclassification. Sources that are
    -- currently `core` and have high demand (measured by last_demand_at)
    -- are NOT reclassified. Only sources that are core AND have no
    -- recent demand are moved to demand. This preserves coverage for
    -- sources that readers actually want.

    update public.sources
      set coverage_mode = 'demand',
          updated_at = now()
    where coverage_mode = 'core'
      and id not in (
        -- Sources with recent demand (within 72 hours) stay core
        select s.id
          from public.sources s
          join public.source_topics st on st.source_id = s.id
          join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
          join public.profiles p on p.id = ut.user_id and p.auto_paused_at is null
          join public.notification_preferences np on np.user_id = ut.user_id and np.paused = false
          join auth.users au on au.id = ut.user_id and (au.banned_until is null or au.banned_until < now())
          where s.coverage_mode = 'core'
            and s.last_demand_at > now() - interval '72 hours'
      )
      and id not in (
        -- Sources with direct custom-source follows stay core
        select s.id
          from public.sources s
          join public.user_custom_sources ucs on ucs.source_id = s.id and ucs.active = true
          where s.coverage_mode = 'core'
      );

    -- ---------------------------------------------------------------------------
    -- 5. Record the cost-cutting audit
    -- ---------------------------------------------------------------------------
    --
    -- Insert an audit log entry so the operator knows what changed and when.
    -- This is not a migration that the pipeline reads — it's a record.

    insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
    values
      ('cost_cutting.0058.applied', 'system', 'cost_cutting', '0058',
      jsonb_build_object(
        'demand_driven_sources', true,
        'adaptive_polling', true,
        'max_tokens', jsonb_build_object('cluster', 2048, 'digest', 4096, 'reason', 8192),
        'source_reclassification', 'core sources without recent demand moved to demand',
        'applied_at', now()
      ));
