-- nyuz — pre-analysis demand gate (docs/track.md phase 8)
--
-- Adds the flag and the SQL this stage needs, both inert until an operator
-- turns the flag on. Analysis behaviour is unchanged while it is off, which
-- is its default state here and the only state this has been verified in —
-- see the note in src/lib/pipeline/analyse.ts.
--
-- ---------------------------------------------------------------------------
-- What "has demand" means, pre-analysis
-- ---------------------------------------------------------------------------
--
-- An event has no `event_topics` yet — that write happens *during* analysis
-- (0001, stage 4), so the gate cannot ask "does this event's topic match a
-- reader's topic," the question `admin_source_demand` (0020) answers for a
-- source. What it can ask, before spending anything, is whether any *source*
-- that contributed an article to this event either is core coverage or has
-- at least one currently-eligible reader interested in one of its topics —
-- the same eligibility rule as 0020 (not muted, not paused, not
-- auto-paused, not banned).
--
-- A source with zero rows in `source_topics` cannot contribute demand by
-- this measure. That is the same honest-empty-graph behaviour 0020 already
-- has: the map has to be filled in before it means anything.
--
-- Not granted to anon or authenticated, same as every other admin/pipeline
-- aggregate function in this project.

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'pre_analysis_demand_gate',
    'Pre-analysis demand gate',
    'Skip understanding an event when none of its contributing sources are core '
    'coverage or currently reach an eligible reader. Leaves the event pending '
    'rather than analysing it — see docs/track.md phase 8. Off by default; turn '
    'on only after checking admin_source_demand() numbers against real coverage.',
    false,
    100
  )
on conflict (key) do nothing;

create or replace function public.events_with_demand(p_event_ids uuid[])
returns table (event_id uuid, has_demand boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    e.id,
    exists (
      select 1
      from public.articles a
      join public.sources s on s.id = a.source_id
      where a.event_id = e.id and s.coverage_mode = 'core'
    )
    or exists (
      select 1
      from public.articles a
      join public.source_topics st on st.source_id = a.source_id
      join public.user_topics   ut on ut.topic_id  = st.topic_id and ut.muted = false
      join public.profiles p
        on p.id = ut.user_id and p.auto_paused_at is null
      join public.notification_preferences np
        on np.user_id = ut.user_id and np.paused = false
      join auth.users au
        on au.id = ut.user_id and (au.banned_until is null or au.banned_until < now())
      where a.event_id = e.id
    )
  from public.events e
  where e.id = any(p_event_ids);
$fn$;

revoke execute on function public.events_with_demand(uuid[]) from anon, authenticated;
