-- nyuz -- the pre-analysis demand gate stops treating "core source" as demand
--
-- `pre_analysis_demand_gate` (0021, enabled in 0027) decides which events are
-- worth a Pro analysis call. Since 0021 it has answered yes to two different
-- questions at once:
--
--   1. does a reader who would actually receive this event exist?
--   2. did this event come from a source we classified `core`?
--
-- The second is not demand. It is an editorial judgement about the source, made
-- once in 0018, and it means an instance with zero readers still pays for Pro
-- analysis on every event a core source produces. That is the single largest
-- item in the launch cost audit's idle burn, and at launch there are no readers
-- for it to be idle on behalf of.
--
-- This migration removes ONLY that branch, from ONLY the two functions the
-- expensive gate uses. `coverage_mode` keeps every other meaning it has:
--
--   KEPT, untouched:
--     - `sources_to_collect` (0031) still collects core sources on their own
--       cadence, so fetching, ingestion, deduplication and clustering are
--       unchanged. Events are still created and still accumulate coverage.
--     - `admin_source_demand` / `admin_source_stats` (0020/0030/0035) still
--       report core vs demand, so the console still distinguishes them.
--     - Nothing about how a core source is polled, ranked or displayed.
--
--   CHANGED, deliberately:
--     - `events_with_demand(uuid[])`      — the per-event check in analyse.ts
--     - `pending_events_with_demand(int)` — the batch selector in analyse.ts
--
-- After this, an event is worth analysing when a real, reachable reader is
-- attached to it: someone following one of its sources' topics, or someone who
-- added one of its sources themselves. Both are the definitions those functions
-- already used; only the core-source disjunct is gone.
--
-- Nothing here is retroactive. Events already analysed keep their analysis and
-- stay readable. An unanalysed event stays `pending` rather than being marked
-- failed, so the day a matching reader signs up it becomes eligible on the very
-- next analysis run — the gate is re-evaluated every time, not cached.
--
-- The two functions had also drifted apart: 0030 taught `events_with_demand`
-- about `user_custom_sources` and `pending_events_with_demand` (0045) was never
-- given the same branch. That did not show while `core` was carrying most
-- events through the selector; with `core` gone it would mean a reader who
-- follows a custom source never gets their events analysed at all. Both
-- functions now use the same definition of demand, written once below.

-------------------------------------------------------------------------------
-- The per-event check.
-------------------------------------------------------------------------------

create or replace function public.events_with_demand(p_event_ids uuid[])
returns table (event_id uuid, has_demand boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    e.id,
    -- A reader following one of this event's topics, through one of its
    -- sources. Every clause is about whether that reader could actually be
    -- sent the event: an unmuted topic, an account that is not auto-paused,
    -- briefings that are not paused, and a login that is not banned.
    exists (
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
    -- Or a reader who added one of its sources themselves (0030). An explicit
    -- follow is demand by definition, whatever the source's topics say.
    or exists (
      select 1
      from public.articles a
      join public.user_custom_sources ucs on ucs.source_id = a.source_id and ucs.active = true
      join public.profiles p
        on p.id = ucs.user_id and p.auto_paused_at is null
      join public.notification_preferences np
        on np.user_id = ucs.user_id and np.paused = false
      join auth.users au
        on au.id = ucs.user_id and (au.banned_until is null or au.banned_until < now())
      where a.event_id = e.id
    )
  from public.events e
  where e.id = any(p_event_ids);
$fn$;

revoke all on function public.events_with_demand(uuid[]) from public, anon, authenticated;
grant execute on function public.events_with_demand(uuid[]) to service_role;

comment on function public.events_with_demand(uuid[]) is
  'Whether each event has a reader who could actually receive it. Source '
  'coverage_mode is deliberately NOT consulted (0054): a core source is an '
  'editorial classification, not a reader, and analysis is the expensive step.';

-------------------------------------------------------------------------------
-- The batch selector, using the same definition.
-------------------------------------------------------------------------------

create or replace function public.pending_events_with_demand(p_limit integer default 6)
returns table (id uuid, title text, status event_status, analysis_tokens integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id, e.title, e.status, e.analysis_tokens
    from public.events e
   where e.analysed_at is null
     and e.status = 'pending'
     and (e.analysis_deferred_until is null or e.analysis_deferred_until <= now())
     and (
       exists (
         select 1
           from public.articles a
           join public.source_topics st on st.source_id = a.source_id
           join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
           join public.profiles p on p.id = ut.user_id and p.auto_paused_at is null
           join public.notification_preferences np
             on np.user_id = ut.user_id and np.paused = false
           join auth.users au
             on au.id = ut.user_id
            and (au.banned_until is null or au.banned_until < now())
          where a.event_id = e.id
       )
       or exists (
         select 1
           from public.articles a
           join public.user_custom_sources ucs
             on ucs.source_id = a.source_id and ucs.active = true
           join public.profiles p on p.id = ucs.user_id and p.auto_paused_at is null
           join public.notification_preferences np
             on np.user_id = ucs.user_id and np.paused = false
           join auth.users au
             on au.id = ucs.user_id
            and (au.banned_until is null or au.banned_until < now())
          where a.event_id = e.id
       )
     )
   order by e.first_seen_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 100));
$fn$;

revoke all on function public.pending_events_with_demand(integer)
  from public, anon, authenticated;
grant execute on function public.pending_events_with_demand(integer) to service_role;

comment on function public.pending_events_with_demand(integer) is
  'Pending events worth analysing, newest first. Same demand definition as '
  'events_with_demand, including custom-source follows (0054). An event with no '
  'reader stays pending and becomes eligible the moment one appears.';
