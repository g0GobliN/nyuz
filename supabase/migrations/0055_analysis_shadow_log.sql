-- nyuz -- persist deterministic extraction shadow comparisons (docs/track.md phase 7)
--
-- Phase 7 asks for measurement of deterministic entity/number extraction
-- and topic/tag assignment against AI results. This table stores the
-- comparison metrics so the promotion decision can be made from data
-- rather than intuition.
--
-- Like cluster_shadow_log (0033), this is measurement only. Nothing
-- reads from this table to make a decision. It is deliberately built
-- before any promotion, not alongside it.
--
-- What a row means:
--   One row per event that reached the analysis model while shadow mode
--   was on. `ai_facts` and `ai_topics` are what the model returned
--   (already stored in events.understand and event_topics).
--   `code_facts` and `code_topics` are what the deterministic layer
--   would have produced. The comparison metrics are computed here
--   so they can be aggregated without re-reading the coverage text.

create table public.analysis_shadow_log (
  id               bigint      generated always as identity primary key,
  event_id         uuid        not null references public.events (id) on delete cascade,
  article_id       uuid        references public.articles (id) on delete cascade,
  -- Snapshot of the article title at analysis time.
  article_title    text        not null,
  -- Deterministic extraction results (JSONB for flexible querying)
  code_facts       jsonb       not null default '{}',
  code_topics      text[]      not null default '{}',
  code_tags        text[]      not null default '{}',
  -- AI results (already stored in events.understand and event_topics)
  ai_facts         jsonb       not null default '{}',
  ai_topics        text[]      not null default '{}',
  ai_tags          text[]      not null default '{}',
  -- Comparison metrics per category
  comparisons      jsonb       not null default '[]',
  -- Aggregate agreement rate across all categories
  overall_agreement_rate numeric(5,4) not null default 0,
  -- Whether the deterministic layer was confident enough to have an opinion
  -- (i.e., it found something to compare). Null when there was nothing
  -- to compare — the common case for events with no extractable facts.
  has_opinion      boolean     not null default false,
  created_at       timestamptz not null default now()
);

create index analysis_shadow_agreed_idx on public.analysis_shadow_log (has_opinion, created_at desc);
create index analysis_shadow_event_idx on public.analysis_shadow_log (event_id, created_at desc);
create index analysis_shadow_created_idx on public.analysis_shadow_log (created_at desc);

comment on table public.analysis_shadow_log is
  'What the deterministic extraction layer would have produced, versus what '
  'the model did. Measurement only -- nothing reads this to make a decision. '
  'Feeds the phase 7 promotion decision; see docs/track.md.';

alter table public.analysis_shadow_log enable row level security;
-- No policies at all: operational data, service-role only, unreachable from a
-- browser. Same treatment as cluster_shadow_log and ai_providers.

-- ---------------------------------------------------------------------------
-- Summary function for the promotion decision
-- ---------------------------------------------------------------------------

create or replace function public.analysis_shadow_summary(p_days integer default 30)
returns table (
  category text,
  total_events integer,
  events_with_opinion integer,
  avg_agreement_rate numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  select category, total_events, events_with_opinion, avg_agreement_rate from (
    select
      'overall'::text as category,
      count(*)::integer as total_events,
      count(*) filter (where has_opinion)::integer as events_with_opinion,
      round(avg(overall_agreement_rate)::numeric, 4) as avg_agreement_rate
    from public.analysis_shadow_log
    where created_at > now() - make_interval(days => p_days)
    union all
    select
      (c->>'category')::text as category,
      count(*)::integer as total_events,
      count(*) filter (where l.has_opinion)::integer as events_with_opinion,
      round(avg((c->>'agreement_rate')::numeric), 4) as avg_agreement_rate
    from public.analysis_shadow_log l,
         jsonb_array_elements(l.comparisons) as c
    where l.created_at > now() - make_interval(days => p_days)
      and l.has_opinion
    group by (c->>'category')
  ) sub
  order by category;
$fn$;

revoke execute on function public.analysis_shadow_summary(integer) from anon, authenticated;
