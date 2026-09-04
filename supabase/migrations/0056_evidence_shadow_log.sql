  -- nyuz -- evidence selection shadow mode (docs/track.md phase 9)
  --
  -- This migration creates the table and feature flag for shadow-mode
  -- measurement of adaptive evidence selection and deterministic deduplication.
  --
  -- Shadow mode is OFF by default. It only records metrics — it never
  -- changes the analysis input, the model call, or the user-visible output.
  -- The full 12-article set is always sent to the model.
  --
  -- The evidence_shadow_log table records, for every event that reaches
  -- the analysis model while shadow mode is on:
  --   - How many articles were selected vs. the full set
  --   - How many facts were preserved vs. lost
  --   - How many conflicts were preserved
  --   - Whether source attribution was preserved
  --   - How many prompt tokens would be saved
  --   - The agreement rate between full and reduced evidence
  --
  -- This data is used to decide whether to enable evidence selection
  -- in production. The threshold is: factual coverage >= 95% AND
  -- no important conflicts lost.

  -- ---------------------------------------------------------------------------
  -- The feature flag
  -- ---------------------------------------------------------------------------

  insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
    (
      'evidence_selection_shadow',
      'Evidence selection shadow mode',
      'Computes adaptive evidence selection and deterministic deduplication '
      'metrics alongside the normal analysis pass. Records what would happen '
      'if evidence were reduced, but never changes the analysis input. '
      'OFF by default — see docs/track.md phase 9.',
      false,
      100
    )
  on conflict (key) do nothing;

  -- ---------------------------------------------------------------------------
  -- The shadow log table
  -- ---------------------------------------------------------------------------

  create table public.evidence_shadow_log (
    id bigint generated always as identity primary key,
    event_id uuid not null references public.events (id) on delete cascade,
    -- The full article count before selection
    full_article_count integer not null,
    -- The number of articles selected by the adaptive algorithm
    selected_article_count integer not null,
    -- Facts preserved by the reduced set
    facts_preserved integer not null,
    -- Facts lost by deduplication (identical repeats)
    facts_lost integer not null,
    -- Conflict categories where at least 2 different values are preserved
    conflicts_preserved integer not null,
    -- Whether each selected article keeps its source attribution
    source_attribution_preserved boolean not null default true,
    -- Estimated prompt tokens saved vs. the full set
    prompt_tokens_saved integer not null default 0,
    -- Agreement rate: facts_preserved / total_facts (0..1)
    agreement_rate numeric(5,4) not null default 0,
    -- Indices of the selected articles (0-based into the full set)
    selected_indices integer[] not null default '{}',
    -- Per-category fact preservation detail
    fact_preservation_detail jsonb not null default '[]',
    created_at timestamptz not null default now()
  );

  create index evidence_shadow_event_idx on public.evidence_shadow_log (event_id, created_at desc);
  create index evidence_shadow_created_idx on public.evidence_shadow_log (created_at desc);
  create index evidence_shadow_agreement_idx on public.evidence_shadow_log (agreement_rate, created_at desc);

  comment on table public.evidence_shadow_log is
    'Shadow-mode metrics for adaptive evidence selection and deduplication. '
    'Records what a reduced evidence set would look like vs. the full 12-article '
    'set. Measurement only — nothing reads this to make a decision until the '
    'phase 9 promotion threshold is met. See docs/track.md.';

  -- ---------------------------------------------------------------------------
  -- RLS — operational data, service-role only
  -- ---------------------------------------------------------------------------

  alter table public.evidence_shadow_log enable row level security;
  -- No policies at all: operational data, service-role only, unreachable from a
  -- browser. Same treatment as analysis_shadow_log and cluster_shadow_log.

  -- ---------------------------------------------------------------------------
  -- Summary function for the promotion decision
  -- ---------------------------------------------------------------------------

  create or replace function public.evidence_shadow_summary(p_days integer default 30)
  returns table (
    window_key text,
    events_count integer,
    avg_selected_article_count numeric,
    avg_facts_preserved integer,
    avg_facts_lost integer,
    avg_conflicts_preserved numeric,
    avg_agreement_rate numeric,
    avg_prompt_tokens_saved integer,
    events_above_95_pct integer
  )
  language sql
  stable
  security definer
  set search_path = public
  as $fn$
    select
      'overall'::text as window_key,
      count(*)::integer as events_count,
      round(avg(selected_article_count)::numeric, 2) as avg_selected_article_count,
      round(avg(facts_preserved)::numeric, 2) as avg_facts_preserved,
      round(avg(facts_lost)::numeric, 2) as avg_facts_lost,
      round(avg(conflicts_preserved)::numeric, 2) as avg_conflicts_preserved,
      round(avg(agreement_rate)::numeric, 4) as avg_agreement_rate,
      round(avg(prompt_tokens_saved)::numeric, 2) as avg_prompt_tokens_saved,
      count(*) filter (where agreement_rate >= 0.95)::integer as events_above_95_pct
    from public.evidence_shadow_log
    where created_at > now() - make_interval(days => p_days)
  $fn$;

  revoke execute on function public.evidence_shadow_summary(integer) from anon, authenticated;
