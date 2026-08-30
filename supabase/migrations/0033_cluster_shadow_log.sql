-- nyuz -- persist cluster v2 shadow verdicts (docs/plan2.md phase 7, section 26)
--
-- 0022 turned on shadow mode, and `describeCluster` reports an agreement rate
-- per run. That number is written to a cron log and then lost. plan2 section
-- 26 asks for measurement across runs -- incorrect merges, incorrect splits,
-- AI calls avoided -- and a per-run line in a log nobody keeps cannot answer
-- any of that.
--
-- Worse, checked on 2026-08-30: the flag has been on since the previous day
-- and ZERO articles have been clustered in that window, so there is no
-- measurement at all yet. Deciding thresholds from that would be deciding
-- them from nothing.
--
-- This table is what makes phase 7's actual promotion decision possible
-- later. It is deliberately built BEFORE the skip behaviour is enabled, not
-- alongside it.
--
-- ---------------------------------------------------------------------------
-- What a row means
-- ---------------------------------------------------------------------------
--
-- One row per article that reached the clustering model while shadow mode was
-- on. `model_matched_id` is what the model actually decided (and what was
-- acted on); `shadow_verdict` is what the deterministic layer would have
-- decided. `agreed` is the comparison, null when the shadow layer was not
-- confident enough to have an opinion -- which is the common case and must
-- not be counted as either agreement or disagreement.
--
-- The disagreements are the whole point. An article where the shadow said
-- `same` and the model said different is a potential wrong merge, which is
-- the expensive kind of error: plan2 section 25, "a wrongly merged event
-- silently misinforms every reader who receives it."

create table public.cluster_shadow_log (
  id               bigint      generated always as identity primary key,
  article_id       uuid        not null references public.articles (id) on delete cascade,
  -- Snapshot, not a join: the point is to review the decision later, and
  -- titles get rewritten by publishers (see updateRetitled in ingest.ts).
  article_title    text        not null,
  candidates       integer     not null,
  shadow_verdict   text        not null check (shadow_verdict in ('same', 'different', 'ambiguous')),
  shadow_matched_id uuid,
  model_matched_id  uuid,
  -- null when the shadow verdict was 'ambiguous' -- nothing to compare.
  agreed           boolean,
  created_at       timestamptz not null default now()
);

create index cluster_shadow_agreed_idx on public.cluster_shadow_log (agreed, created_at desc);
create index cluster_shadow_created_idx on public.cluster_shadow_log (created_at desc);

comment on table public.cluster_shadow_log is
  'What the deterministic cluster layer would have decided, versus what the '
  'model did. Measurement only -- nothing reads this to make a decision. '
  'Feeds the phase 7 promotion decision; see docs/track.md.';

alter table public.cluster_shadow_log enable row level security;
-- No policies at all: operational data, service-role only, unreachable from a
-- browser. Same treatment as ai_providers and the AI ledger.

-- ---------------------------------------------------------------------------
-- The summary the promotion decision actually needs
-- ---------------------------------------------------------------------------
--
-- Split by verdict, because the two directions are not equally safe:
--
--   shadow said 'different', model agreed -> safe to skip. The cheap half.
--   shadow said 'same',      model agreed -> skippable, but a wrong one here
--                                            merges two unrelated stories.
--
-- plan2 section 25 is explicit that these carry different costs, so a single
-- blended accuracy number would hide exactly the thing worth knowing.

create or replace function public.cluster_shadow_summary(p_days integer default 30)
returns table (
  verdict        text,
  decided        integer,
  agreed         integer,
  agreement_rate numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    l.shadow_verdict,
    count(*)::integer,
    count(*) filter (where l.agreed)::integer,
    round(
      (count(*) filter (where l.agreed))::numeric
        / nullif(count(*), 0) * 100,
      1
    )
  from public.cluster_shadow_log l
  where l.agreed is not null
    and l.created_at > now() - make_interval(days => p_days)
  group by l.shadow_verdict;
$fn$;

revoke execute on function public.cluster_shadow_summary(integer) from anon, authenticated;
