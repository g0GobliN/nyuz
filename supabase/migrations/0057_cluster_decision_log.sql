-- nyuz -- make stage 3 as auditable as stage 4 (docs/track.md phase 7)
--
-- Stage 4 can be audited from a column: `events.analysis_tokens` says what an
-- event cost and `events` says how many there are, so "what does understanding
-- cost" is one query. Stage 3 had no equivalent, and the gap was not that the
-- spend went unrecorded -- `ai_usage_ledger` has held every clustering call
-- since 0017, tagged `feature = 'cluster'` since 0053 -- but that the spend
-- could not be joined to the decision it bought. The ledger knows a call cost
-- 1,201 tokens; it does not know whether that call attached an article to an
-- event or concluded it was alone.
--
-- ---------------------------------------------------------------------------
-- Why the denominator was missing
-- ---------------------------------------------------------------------------
--
-- 0033 created `cluster_shadow_log` to answer the phase 7 promotion question:
-- can a confident deterministic verdict skip the model? It recorded a row only
-- where there was something to compare -- `recordShadow` is called under
-- `shadowAgreed !== null`, which is false for every `ambiguous` verdict.
--
-- That makes the table unable to answer the one question it exists for.
-- Measured 2026-09-05 against the live project:
--
--     cluster calls, 2026-09-01 .. 09-04     884
--     rows in cluster_shadow_log              98      <- 11.1%
--     of those: 'different'                   93      (93/93 agreed with model)
--     of those: 'same'                         5      (3/5 agreed)
--     'ambiguous' rows                          0      <- never written
--
-- Read from the table alone, the deterministic layer looks 94.9% confident and
-- 98% accurate. Read against the real denominator, it is confident on 11.1% of
-- calls. The first reading justifies switching the skip flag on; the second
-- says it would remove about a tenth of the calls. The table was recording the
-- numerator of its own success rate and discarding the denominator.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
--
-- One row per article that reaches a shortlist, whatever happens next --
-- ambiguous, bypassed, or sent to the model. Plus a link to the ledger row
-- that priced it, so tokens and cost are joined rather than copied.
--
-- Deliberately NOT a second accounting system. `prompt_tokens`,
-- `completion_tokens`, `cost_microusd`, `model` and `capability` stay where
-- they already are, in `ai_usage_ledger`, and `usage_id` reaches them. A
-- token count copied into two tables is a token count that will disagree with
-- itself, and the ledger is the one the monthly ceiling is computed from.
--
-- Nothing here changes a clustering decision. The skip flag
-- (`deterministic_cluster_skip`) is untouched and stays off.

-------------------------------------------------------------------------------
-- 1. The decision, alongside the verdict.
-------------------------------------------------------------------------------

alter table public.cluster_shadow_log
  -- The ledger row this decision paid for. Null when no model was called,
  -- which is now a recorded case rather than an absent row.
  add column if not exists usage_id uuid
    references public.ai_usage_ledger (id) on delete set null,
  add column if not exists model_called boolean not null default true,
  -- What stage 3 actually did with the article. Mirrors ArticleOutcome.decision
  -- in src/lib/pipeline/cluster.ts.
  add column if not exists decision text,
  -- Why the model was not called. Null whenever it was.
  add column if not exists bypass_reason text,
  -- Groups the rows written by one cluster() invocation, so a run can be read
  -- back whole -- the per-run agreement line in `describeCluster` is otherwise
  -- gone by morning, which is what 0033 set out to fix and only half fixed.
  add column if not exists run_id uuid;

-- Every existing row was written under the old rule, which fired only after a
-- real model call. Stating that explicitly beats leaving it to a default that
-- a later reader has to date-check.
update public.cluster_shadow_log
   set model_called = true
 where model_called is null;

alter table public.cluster_shadow_log
  drop constraint if exists cluster_shadow_log_decision_check;
alter table public.cluster_shadow_log
  add constraint cluster_shadow_log_decision_check
  check (decision is null or decision in (
    'attached', 'created', 'alone', 'ignored', 'skipped', 'deferred', 'failed'
  ));

-- A bypass without a reason is unauditable, and a reason attached to a call
-- that really happened is a contradiction. Both directions are refused here
-- rather than left to the application.
alter table public.cluster_shadow_log
  drop constraint if exists cluster_shadow_log_bypass_check;
alter table public.cluster_shadow_log
  add constraint cluster_shadow_log_bypass_check
  check (
    (model_called and bypass_reason is null)
    or (not model_called and bypass_reason is not null)
  );

create index if not exists cluster_shadow_verdict_created_idx
  on public.cluster_shadow_log (shadow_verdict, created_at desc);
create index if not exists cluster_shadow_run_idx
  on public.cluster_shadow_log (run_id);
create index if not exists cluster_shadow_usage_idx
  on public.cluster_shadow_log (usage_id);

comment on table public.cluster_shadow_log is
  'One row per article that reached a clustering shortlist: what the '
  'deterministic layer would have decided, whether the model was called, what '
  'it decided, and which ai_usage_ledger row priced it. Rows written before '
  '0057 exist only for articles where the deterministic layer was confident, '
  'so the bypass rate is measurable only from 0057 onward.';

comment on column public.cluster_shadow_log.usage_id is
  'The ai_usage_ledger row for this call. Tokens and cost are read through '
  'this rather than copied -- the ledger is what the monthly ceiling counts.';

-------------------------------------------------------------------------------
-- 2. The bypass question, with its denominator.
-------------------------------------------------------------------------------
--
-- Replaces nothing: `cluster_shadow_summary` from 0033 still answers "when the
-- deterministic layer was confident, how often was it right". This answers the
-- separate question that decides whether that matters -- how often is it
-- confident at all, and what would skipping have saved.
--
-- Split by verdict because the two directions carry different costs, exactly as
-- 0033 argued. A wrong 'different' creates one extra event: one analysis, no
-- misinformation. A wrong 'same' merges two stories and misinforms every reader
-- who receives the result. They must never be averaged into one accuracy number.

create or replace function public.cluster_bypass_summary(p_days integer default 30)
returns table (
  shadow_verdict   text,
  articles         integer,
  share_of_calls   numeric,
  model_agreed     integer,
  model_disagreed  integer,
  agreement_rate   numeric,
  tokens           bigint,
  cost_microusd    bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with scoped as (
    select l.*, u.prompt_tokens, u.completion_tokens,
           coalesce(u.cost_microusd, u.estimated_cost_microusd, 0) as cost
      from public.cluster_shadow_log l
      left join public.ai_usage_ledger u on u.id = l.usage_id
     where l.created_at > now() - make_interval(days => p_days)
  )
  select
    s.shadow_verdict,
    count(*)::integer,
    round(count(*)::numeric / nullif((select count(*) from scoped), 0) * 100, 1),
    count(*) filter (where s.agreed)::integer,
    count(*) filter (where s.agreed is false)::integer,
    round(
      (count(*) filter (where s.agreed))::numeric
        / nullif(count(*) filter (where s.agreed is not null), 0) * 100,
      1
    ),
    coalesce(sum(s.prompt_tokens + s.completion_tokens), 0)::bigint,
    coalesce(sum(s.cost), 0)::bigint
  from scoped s
  group by s.shadow_verdict;
$fn$;

revoke execute on function public.cluster_bypass_summary(integer) from anon, authenticated;

comment on function public.cluster_bypass_summary(integer) is
  'Deterministic verdict distribution over every shortlisted article, with the '
  'tokens each verdict actually consumed. share_of_calls is the number 0033 '
  'could not produce: how often the deterministic layer has an opinion at all.';

-------------------------------------------------------------------------------
-- 3. Clustering unit economics, per day.
-------------------------------------------------------------------------------
--
-- The questions this exists to answer, all from one row per day: calls/day,
-- tokens/day, tokens per article, share bypassed, cost per collected article,
-- cost per resulting event.
--
-- `events` is counted by `first_seen_at` rather than by joining the log,
-- because an event can be created by an article that never reached a shortlist
-- (a version tag, a headline with no distinctive words) and those are part of
-- the denominator for "cost per event" whether or not they cost anything.

create or replace function public.cluster_cost_by_day(p_days integer default 30)
returns table (
  day             date,
  articles        integer,
  model_calls     integer,
  bypassed        integer,
  bypass_rate     numeric,
  tokens          bigint,
  tokens_per_call numeric,
  cost_microusd   bigint,
  events_created  integer,
  cost_per_event_microusd numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  with scoped as (
    select
      date_trunc('day', l.created_at)::date as day,
      l.model_called,
      coalesce(u.prompt_tokens, 0) + coalesce(u.completion_tokens, 0) as tokens,
      coalesce(u.cost_microusd, u.estimated_cost_microusd, 0) as cost
    from public.cluster_shadow_log l
    left join public.ai_usage_ledger u on u.id = l.usage_id
    where l.created_at > now() - make_interval(days => p_days)
  ),
  events_per_day as (
    select date_trunc('day', e.first_seen_at)::date as day, count(*)::integer as n
      from public.events e
     where e.first_seen_at > now() - make_interval(days => p_days)
     group by 1
  )
  select
    s.day,
    count(*)::integer,
    count(*) filter (where s.model_called)::integer,
    count(*) filter (where not s.model_called)::integer,
    round(count(*) filter (where not s.model_called)::numeric / nullif(count(*), 0) * 100, 1),
    sum(s.tokens)::bigint,
    round(sum(s.tokens)::numeric / nullif(count(*) filter (where s.model_called), 0), 1),
    sum(s.cost)::bigint,
    coalesce(e.n, 0),
    round(sum(s.cost)::numeric / nullif(e.n, 0), 1)
  from scoped s
  left join events_per_day e on e.day = s.day
  group by s.day, e.n
  order by s.day desc;
$fn$;

revoke execute on function public.cluster_cost_by_day(integer) from anon, authenticated;

comment on function public.cluster_cost_by_day(integer) is
  'Clustering unit economics per day, joined to ai_usage_ledger for tokens and '
  'cost. Only covers articles that reached a shortlist; articles decided free '
  'before the shortlist are not rows here and cost nothing.';
