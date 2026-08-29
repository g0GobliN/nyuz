-- nyuz -- cost intelligence (docs/plan2.md phase 10, sections 77-79)
--
-- One function answering "what is this costing, and what did the V2 work
-- actually save". Everything it reports is counted from rows that exist --
-- nothing here is modelled, extrapolated, or asserted from a comment.
--
-- plan2 section 79 is blunt about the standard: "Do not claim savings that
-- cannot be measured. If not measured: not measured yet." So every figure
-- below is a count, and a number that cannot be counted is absent rather than
-- estimated. In particular there is deliberately NO "tokens avoided" or
-- "money saved" figure: the honest version of that requires knowing what the
-- skipped calls would have cost, which is unknowable, and the dishonest
-- version is what this project has consistently refused to ship.
--
-- The one arithmetic claim is `analysis_tokens` divided by analysed events,
-- which is a real mean of real recorded spend.

create or replace function public.admin_cost_intelligence(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'window_days', p_days,

    -- Sources: how much of the network is being collected, and how much is
    -- being held back by demand rather than by failure.
    'sources', (
      select jsonb_build_object(
        'total',      count(*),
        'active',     count(*) filter (where active),
        'core',       count(*) filter (where coverage_mode = 'core'),
        'demand',     count(*) filter (where coverage_mode = 'demand'),
        'hot',        count(*) filter (where polling_tier = 'hot'),
        'normal',     count(*) filter (where polling_tier = 'normal'),
        'low',        count(*) filter (where polling_tier = 'low'),
        'cold',       count(*) filter (where polling_tier = 'cold'),
        'paused_tier',count(*) filter (where polling_tier = 'paused'),
        -- Would be skipped by phase 5 right now. Reported whether or not the
        -- flag is on, so the effect can be seen before it is adopted.
        'no_demand',  count(*) filter (
                        where active
                          and coverage_mode <> 'core'
                          and last_demand_at is not null
                          and last_demand_at < now() - interval '72 hours'
                      )
      )
      from public.sources
    ),

    'articles', (
      select jsonb_build_object(
        'total',       count(*),
        'in_window',   count(*) filter (where fetched_at > now() - make_interval(days => p_days)),
        'unclustered', count(*) filter (where event_id is null)
      )
      from public.articles
    ),

    'events', (
      select jsonb_build_object(
        'total',            count(*),
        'analysed',         count(*) filter (where analysed_at is not null),
        'awaiting',         count(*) filter (where analysed_at is null and status = 'pending'),
        'failed',           count(*) filter (where status = 'failed'),
        'analysis_tokens',  coalesce(sum(analysis_tokens), 0),
        -- The number the whole cost argument is audited against. A mean, from
        -- recorded spend, not a rate card.
        'tokens_per_event', round(
                              coalesce(sum(analysis_tokens), 0)::numeric
                                / nullif(count(*) filter (where analysed_at is not null), 0),
                              0
                            )
      )
      from public.events
    ),

    -- Phase 2: the shared explanation that replaced one model call per reader
    -- per story. `reuse_ratio` is the property itself, stated as a number:
    -- how many briefing appearances each generated impact has served.
    'impacts', (
      select jsonb_build_object(
        'total',     count(*),
        'complete',  count(*) filter (where status = 'complete'),
        'failed',    count(*) filter (where status = 'failed'),
        'tokens',    coalesce(sum(prompt_tokens + completion_tokens), 0)
      )
      from public.event_impacts
    ),
    'digest_items_total', (select count(*) from public.digest_items),

    -- Phase 1: one row per event per language, however many readers see it.
    'translations', (
      select jsonb_build_object(
        'total',     count(*),
        'complete',  count(*) filter (where status = 'complete'),
        'failed',    count(*) filter (where status = 'failed'),
        'languages', count(distinct language),
        'tokens',    coalesce(sum(prompt_tokens + completion_tokens), 0)
      )
      from public.event_translations
    ),

    -- Phase 7: measured agreement, not a claim. Null-safe: an empty log
    -- reports zeroes rather than pretending to a rate.
    'cluster_shadow', (
      select jsonb_build_object(
        'decided',        count(*) filter (where agreed is not null),
        'agreed',         count(*) filter (where agreed),
        'same_decided',   count(*) filter (where agreed is not null and shadow_verdict = 'same'),
        'same_agreed',    count(*) filter (where agreed and shadow_verdict = 'same'),
        'diff_decided',   count(*) filter (where agreed is not null and shadow_verdict = 'different'),
        'diff_agreed',    count(*) filter (where agreed and shadow_verdict = 'different')
      )
      from public.cluster_shadow_log
      where created_at > now() - make_interval(days => p_days)
    ),

    -- What the AI ledger actually recorded, by capability. The invoice-facing
    -- number, as opposed to the per-stage columns above.
    'ai_usage', (
      select coalesce(
        jsonb_object_agg(capability, tokens),
        '{}'::jsonb
      )
      from (
        select capability, sum(prompt_tokens + completion_tokens) as tokens
          from public.ai_usage_ledger
         where created_at > now() - make_interval(days => p_days)
         group by capability
      ) t
    ),

    -- Which V2 behaviours are actually switched on. Without this, every
    -- number above is ambiguous: a low skip count could mean the gate is
    -- working well or simply off.
    'flags', (
      select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb)
        from public.feature_flags
       where key in (
         'pre_analysis_demand_gate', 'demand_driven_sources', 'adaptive_polling',
         'deterministic_cluster_v2', 'deterministic_cluster_skip'
       )
    )
  );
$fn$;

revoke execute on function public.admin_cost_intelligence(integer) from anon, authenticated;
