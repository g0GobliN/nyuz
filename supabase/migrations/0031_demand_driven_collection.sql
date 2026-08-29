-- nyuz -- demand-driven collection (docs/plan2.md phase 5, section 105)
--
-- Phase 8 stopped paying to *understand* events nobody wants. This stops
-- paying to *fetch* sources nobody wants. Fetching costs no model tokens
-- (docs/architecture.md stage 1: "network and parsing, no model"), so this is
-- not a token saving -- it is a subrequest saving, and on Workers that is a
-- real constraint: a free-plan invocation gets 50 subrequests and every feed
-- fetch plus every PostgREST call counts against it (see SCHEDULED_LIMIT in
-- docs/plan.md stage 2). A run that skips 27 zero-demand sources is a run
-- that can reach 27 more that somebody is waiting for.
--
-- ---------------------------------------------------------------------------
-- Why a grace period, and why it is stored rather than computed
-- ---------------------------------------------------------------------------
--
-- plan2 section 10 is explicit that demand reaching zero must not immediately
-- stop collection, because ON/OFF/ON/OFF thrashing is worse than either
-- state: a source that pauses the moment its last follower mutes a topic and
-- resumes when they unmute it produces gaps in coverage that look like bugs.
--
-- `last_demand_at` is a timestamp rather than a computed value because the
-- question is "when was this source last wanted", and that is a fact about
-- the past that no present-tense query can recover. Once demand is gone,
-- nothing remains to compute it from.
--
-- Refreshed by `refresh_source_demand()` on every ingest run, before
-- selection. A source is eligible while it is `core`, OR has demand now, OR
-- had demand within the grace window.

alter table public.sources
  add column last_demand_at timestamptz;

comment on column public.sources.last_demand_at is
  'When this source last had a reader interested in it. Drives the grace '
  'period before a zero-demand source stops being collected -- see '
  'docs/track.md phase 5.';

-- Backfilled to now() rather than null: every existing source is treated as
-- wanted as of this migration, so applying it cannot cause a collection gap
-- while the first refresh has yet to run. The alternative -- null meaning
-- "never wanted" -- would pause the entire corpus for one cycle.
update public.sources set last_demand_at = now();

-- ---------------------------------------------------------------------------
-- Refresh
-- ---------------------------------------------------------------------------
--
-- Stamps `last_demand_at` for every source that currently has an eligible
-- interested reader, by topic or by direct follow. Deliberately does NOT
-- clear the column for sources that have lost demand: the whole point is to
-- remember when demand was last seen.

create or replace function public.refresh_source_demand()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  touched integer;
begin
  with eligible as (
    select p.id as user_id
      from public.profiles p
      join public.notification_preferences np on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id and (au.banned_until is null or au.banned_until < now())
     where p.auto_paused_at is null
  ),
  wanted as (
    select distinct st.source_id
      from public.source_topics st
      join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
      join eligible e on e.user_id = ut.user_id
    union
    select distinct ucs.source_id
      from public.user_custom_sources ucs
      join eligible e on e.user_id = ucs.user_id
     where ucs.active = true
  )
  update public.sources s
     set last_demand_at = now()
    from wanted w
   where w.source_id = s.id;

  get diagnostics touched = row_count;
  return touched;
end;
$fn$;

revoke execute on function public.refresh_source_demand() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Selection
-- ---------------------------------------------------------------------------
--
-- Which sources a collection run should read, and why. Returns a reason per
-- source so the pipeline can report *why* something was skipped rather than
-- silently reading fewer feeds -- plan2 section 20: "source selection must
-- remain deterministic and observable."
--
-- `p_grace_hours` is a parameter rather than a constant so the cadence can be
-- tuned without a migration, and so a test can collapse it to zero.

create or replace function public.sources_to_collect(p_grace_hours integer default 72)
returns table (source_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    s.id,
    s.coverage_mode = 'core'
      or s.last_demand_at is null
      or s.last_demand_at > now() - make_interval(hours => p_grace_hours),
    case
      when s.coverage_mode = 'core' then 'core'
      -- Null is treated as eligible, not as "never wanted": a source added
      -- between a migration and the first refresh has not yet been measured,
      -- and refusing to collect something on the strength of a measurement
      -- that has not happened is how a new custom source would silently
      -- never be read.
      when s.last_demand_at is null then 'not yet measured'
      when s.last_demand_at > now() - make_interval(hours => p_grace_hours) then 'wanted'
      else 'no demand for ' ||
           extract(day from now() - s.last_demand_at)::text || ' days'
    end
  from public.sources s
  where s.active = true;
$fn$;

revoke execute on function public.sources_to_collect(integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------
--
-- Off by default, like every other behavioural change in this series. With it
-- off, `refresh_source_demand` still runs and `last_demand_at` still fills,
-- so the numbers can be inspected in the admin console before anything acts
-- on them (plan2 section 104's sequencing, which phases 4 and 8 already
-- followed).

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'demand_driven_sources',
    'Demand-driven collection',
    'Skip collecting non-core sources that no eligible reader has wanted for '
    'the grace period. Off by default; last_demand_at fills either way, so the '
    'numbers can be checked before behaviour changes. See docs/track.md phase 5.',
    false,
    100
  )
on conflict (key) do nothing;
