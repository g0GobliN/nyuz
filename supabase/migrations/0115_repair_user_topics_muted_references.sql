-- nyuz -- repair the ten SQL objects that 0110 left reading a dropped column
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED
-- ---------------------------------------------------------------------------
--
-- 0110 dropped `user_topics.muted` and updated every TypeScript read site. It
-- did not update the SQL read sites, and no migration after it does: nine live
-- functions and one live trigger still name the column, and since the drop
-- every one of them has failed at run time.
--
-- The failures are not hypothetical. Against production on 2026-10-07:
--
--   GET  /rest/v1/user_topics?select=muted       42703 column does not exist
--   POST /rest/v1/rpc/{search_topics, reader_sources, admin_source_demand,
--        admin_topic_demand, event_has_demand, priority_articles_to_cluster}
--                                                42703 column does not exist
--   Postgres logs                               briefing_readiness 786x/24h,
--                                              refresh_source_demand 94x/24h
--
-- The trigger is worse than the functions. `enforce_topic_cap` is a BEFORE
-- INSERT/UPDATE trigger on `user_topics`, so every insert raised
--
--   record "new" has no field "muted"
--
-- which means no reader could follow a topic at all while this went unrepaired,
-- and the dashboard's sources screen failed outright rather than degrading,
-- because `reader_sources` is one of the two functions whose caller throws.
--
-- The chain test could not catch it, and says so in its own caveats: `create
-- function` parses a `language sql` body and plans it at first use, and a
-- plpgsql `new.muted` resolves when the trigger fires. Applying a chain is not
-- executing it. `schema-migrations.test.ts` now calls these objects, which is
-- the guard this migration should have needed to exist first.
--
-- ---------------------------------------------------------------------------
-- CORRECTED BEFORE FIRST APPLICATION
-- ---------------------------------------------------------------------------
--
-- The first attempt to apply this file failed at `pending_events_with_demand`
-- with 42P01, because the live project does not have `active_custom_sources`.
-- The file now creates it first (section 0) and recreates the rest unchanged;
-- nothing else was edited. It has never been applied to any database, which is
-- why it is corrected here rather than superseded by a second file: the operator
-- needs one paste that works.
--
-- ---------------------------------------------------------------------------
-- WHY REMOVING THE PREDICATE IS A REPAIR AND NOT A BEHAVIOUR CHANGE
-- ---------------------------------------------------------------------------
--
-- Every reference removed below is the predicate `ut.muted = false`, or its
-- negated twin in `reader_sources`, and the predicate was true for every row
-- that has ever existed:
--
--   - 0001 created the column `not null default false`;
--   - no migration and no code path ever wrote `true` (`git log -S'muted: true'`
--     over `src` is empty), which is 0110's own stated reason for dropping it;
--   - mute state moved to `muted_topics` in 0089, keyed by topic *label*, with
--     a writer (`save_muted_topic`, 0109) and a reader-side veto in the
--     matcher. None of that is touched here.
--
-- Deleting the filter therefore cannot change a row count, and it leaves mute
-- semantics in exactly one place. 0110's ruling explicitly refused the
-- alternative of restoring the column to silence the errors.
--
-- `priority_articles_to_cluster` keeps its
-- `coalesce(usp.pref, 'normal') <> 'muted'` clause: that reads
-- `user_source_prefs.pref`, a different and still-live concept.
--
-- `enforce_topic_cap` loses its muted branch and keeps the half that matters:
-- an update that does not move a row to another account is an edit, and only a
-- row that changes owner has to fit the destination account's cap.
--
-- ---------------------------------------------------------------------------
-- APPLYING IT
-- ---------------------------------------------------------------------------
--
-- By hand, in the SQL editor, before the Worker that ships alongside it, per
-- the standing order. Every signature and return type is unchanged, which is
-- what makes `create or replace` safe here; owner and grants survive it, so no
-- re-grant is needed. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. The view the functions below read, which the live project lost
-- ---------------------------------------------------------------------------
--
-- `pending_events_with_demand`, `priority_articles_to_cluster` and
-- `briefing_readiness` read `public.active_custom_sources`, and 0083 creates it.
-- The live project does not have it, which is why the first attempt to apply
-- this file stopped inside `pending_events_with_demand` with
--
--   ERROR: 42P01: relation "public.active_custom_sources" does not exist
--
-- A `language sql` body is validated when it is created, so a missing relation
-- is a hard error there and not a silent one; the plpgsql objects earlier in
-- this file were recreated successfully and would have failed at run time.
--
-- The definition is 0083's, verbatim, because the chain is the only record of
-- what the object was meant to be and nothing in the chain drops it: the live
-- copy was lost outside the migration history, which this file cannot explain
-- and does not pretend to. The guard in `schema-migrations.test.ts` cannot see
-- this class of drift either -- it applies the chain, and the chain creates the
-- view -- which is exactly what its own caveat warns about: "A green run says
-- the files agree with each other, never that they agree with what is
-- deployed." `npm run verify:live` is the tool for that half.

create or replace view public.active_custom_sources as
select user_id,source_id,active,created_at,updated_at from (
  select u.*, row_number() over(partition by u.user_id order by u.created_at,u.source_id) as position,
    (public.launch_plan(coalesce(s.plan::text,'uno'))->>'customSources')::integer as cap
  from public.user_custom_sources u left join public.subscriptions s on s.user_id=u.user_id
  where u.active=true
) ranked where position <= cap;
revoke all on public.active_custom_sources from public,anon,authenticated;
grant select on public.active_custom_sources to service_role;

create or replace function public.enforce_topic_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  plan text;
  cap integer;
  used integer;
begin
  -- A row that keeps its owner is an edit, not a new follow: only a row
  -- that moves to another account has to fit the destination's cap.
  if tg_op = 'UPDATE' and new.user_id = old.user_id then
    return new;
  end if;

  select s.plan into plan
    from public.subscriptions s
   where s.user_id = new.user_id;

  cap := public.plan_topic_cap(coalesce(plan, 'uno'));
  if cap is null then
    return new;
  end if;

  select count(*)::integer into used
    from public.user_topics
   where user_id = new.user_id
     and (tg_op = 'INSERT' or topic_id is distinct from new.topic_id);

  if coalesce(used, 0) >= cap then
    raise exception 'topic cap exceeded';
  end if;
  return new;
end;
$fn$;

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
      join public.user_topics ut on ut.topic_id = st.topic_id
      join eligible e on e.user_id = ut.user_id
    union
    select distinct ucs.source_id
      from public.active_custom_sources ucs
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

create or replace function public.pending_events_with_demand(
  p_limit      integer default 6,
  p_live_hours integer default 48,
  p_live_share numeric default 5.0 / 6.0
)
returns table (id uuid, title text, status event_status, analysis_tokens integer)
language sql
stable
security definer
set search_path = public
as $fn$
  with sizes as (
    select
      greatest(1, least(coalesce(p_limit, 6), 100)) as batch,
      now() - make_interval(hours => greatest(1, coalesce(p_live_hours, 48))) as cutoff,
      greatest(
        1,
        floor(
          greatest(1, least(coalesce(p_limit, 6), 100))
          * least(1, greatest(0, coalesce(p_live_share, 5.0 / 6.0)))
        )::integer
      ) as live_slots,
      now() + interval '2 hours' as deadline_cutoff
  ),
  active_readers as (
    select p.id as user_id
      from public.profiles p
      join public.notification_preferences np
        on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id
       and (au.banned_until is null or au.banned_until < now())
    where p.auto_paused_at is null
  ),
  upcoming as (
    select d.user_id, min(d.scheduled_for) as scheduled_for
      from public.digests d
      join active_readers ar on ar.user_id = d.user_id
      cross join sizes
    where d.kind = 'briefing'
      and d.status in ('scheduled', 'generating')
      and d.scheduled_for >= now()
      and d.scheduled_for <= sizes.deadline_cutoff
    group by d.user_id
  ),
  event_reader_routes as (
    select etc.event_id, ut.user_id, false as direct
      from public.event_topic_candidates etc
      join public.user_topics ut
        on ut.topic_id = etc.topic_id
      join active_readers ar on ar.user_id = ut.user_id
    union all
    select a.event_id, ut.user_id, false as direct
      from public.articles a
      join public.source_topics st on st.source_id = a.source_id
      join public.user_topics ut
        on ut.topic_id = st.topic_id
      join active_readers ar on ar.user_id = ut.user_id
    where a.event_id is not null
    union all
    select a.event_id, ucs.user_id, true as direct
      from public.articles a
      join public.active_custom_sources ucs
        on ucs.source_id = a.source_id and ucs.active = true
      join active_readers ar on ar.user_id = ucs.user_id
    where a.event_id is not null
  ),
  event_readers as (
    select event_id, user_id, bool_or(direct) as direct
      from event_reader_routes
    group by event_id, user_id
  ),
  coverage as (
    select a.event_id, count(*)::integer as article_count
      from public.articles a
    where a.event_id is not null
    group by a.event_id
  ),
  demanded as (
    select
      e.id,
      e.title,
      e.status,
      e.analysis_tokens,
      e.first_seen_at,
      coalesce(c.article_count, 0) as article_count,
      count(distinct er.user_id) filter (where u.user_id is not null) as deadline_readers,
      min(u.scheduled_for) as next_deadline,
      count(distinct er.user_id) filter (where er.direct) as direct_readers,
      count(distinct er.user_id) as active_readers
      from public.events e
      join event_readers er on er.event_id = e.id
      left join upcoming u on u.user_id = er.user_id
      left join coverage c on c.event_id = e.id
    where e.analysed_at is null
      and e.status = 'pending'
      and (e.analysis_deferred_until is null or e.analysis_deferred_until <= now())
    group by e.id, e.title, e.status, e.analysis_tokens, e.first_seen_at, c.article_count
  ),
  live_ranked as (
    select
      d.*,
      row_number() over (
        order by
          (d.deadline_readers > 0) desc,
          d.next_deadline asc nulls last,
          d.first_seen_at desc,
          d.direct_readers desc,
          d.active_readers desc,
          d.id
      ) as lane_rank
      from demanded d, sizes
    where d.first_seen_at >= sizes.cutoff
  ),
  live as (
    select lr.*
      from live_ranked lr, sizes
    where lr.lane_rank <= sizes.live_slots
  ),
  backlog_ranked as (
    select
      d.*,
      row_number() over (
        order by
          (d.deadline_readers > 0) desc,
          d.next_deadline asc nulls last,
          d.article_count desc,
          d.direct_readers desc,
          d.active_readers desc,
          d.first_seen_at desc,
          d.id
      ) as lane_rank
      from demanded d, sizes
    where d.first_seen_at < sizes.cutoff
  ),
  backlog as (
    select br.*
      from backlog_ranked br, sizes
    where br.lane_rank <= greatest(0, sizes.batch - sizes.live_slots)
  )
  select picked.id, picked.title, picked.status, picked.analysis_tokens
    from (
      select l.id, l.title, l.status, l.analysis_tokens, 0 as lane, l.lane_rank from live l
      union all
      select b.id, b.title, b.status, b.analysis_tokens, 1 as lane, b.lane_rank from backlog b
    ) picked
  order by picked.lane, picked.lane_rank;
$fn$;

create or replace function public.priority_articles_to_cluster(
  p_limit            integer default 40,
  p_live_hours       integer default 48,
  p_live_share       numeric default 5.0 / 6.0,
  p_deadline_minutes integer default 120
)
returns table (id uuid, title text, published_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  with sizes as (
    select
      greatest(1, least(coalesce(p_limit, 40), 100)) as batch,
      now() - make_interval(hours => greatest(1, coalesce(p_live_hours, 48))) as live_cutoff,
      now() - interval '7 days' as backlog_cutoff,
      greatest(
        1,
        floor(
          greatest(1, least(coalesce(p_limit, 40), 100))
          * least(1, greatest(0, coalesce(p_live_share, 5.0 / 6.0)))
        )::integer
      ) as live_slots,
      now() + make_interval(mins => greatest(1, coalesce(p_deadline_minutes, 120)))
        as deadline_cutoff
  ),
  active_readers as (
    select p.id as user_id
      from public.profiles p
      join public.notification_preferences np
        on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id
       and (au.banned_until is null or au.banned_until < now())
    where p.auto_paused_at is null
  ),
  upcoming as (
    select d.user_id, min(d.scheduled_for) as scheduled_for
      from public.digests d
      join active_readers ar on ar.user_id = d.user_id
      cross join sizes
    where d.kind = 'briefing'
      and d.status in ('scheduled', 'generating')
      and d.scheduled_for >= now()
      and d.scheduled_for <= sizes.deadline_cutoff
    group by d.user_id
  ),
  source_reader_routes as (
    select st.source_id, ut.user_id, false as direct
      from public.source_topics st
      join public.user_topics ut
        on ut.topic_id = st.topic_id
      join active_readers ar on ar.user_id = ut.user_id
      left join public.user_source_prefs usp
        on usp.user_id = ut.user_id and usp.source_id = st.source_id
     where coalesce(usp.pref, 'normal'::source_pref) <> 'muted'::source_pref
    union all
    select ucs.source_id, ucs.user_id, true as direct
      from public.active_custom_sources ucs
      join active_readers ar on ar.user_id = ucs.user_id
     where ucs.active = true
  ),
  source_readers as (
    select source_id, user_id, bool_or(direct) as direct
      from source_reader_routes
    group by source_id, user_id
  ),
  live_ranked as (
    select
      a.id,
      a.title,
      a.published_at,
      count(distinct sr.user_id) filter (where u.user_id is not null) as deadline_readers,
      min(u.scheduled_for) as next_deadline,
      count(distinct sr.user_id) filter (where sr.direct) as direct_readers,
      count(distinct sr.user_id) as active_readers,
      row_number() over (
        order by
          (count(distinct sr.user_id) filter (where u.user_id is not null) > 0) desc,
          min(u.scheduled_for) asc nulls last,
          a.published_at desc,
          count(distinct sr.user_id) filter (where sr.direct) desc,
          count(distinct sr.user_id) desc,
          a.id
      ) as lane_rank
      from public.articles a
      join source_readers sr on sr.source_id = a.source_id
      left join upcoming u on u.user_id = sr.user_id
      cross join sizes
    where a.event_id is null
      and a.published_at >= sizes.live_cutoff
      and (a.clustering_deferred_until is null or a.clustering_deferred_until <= now())
    group by a.id, a.title, a.published_at
  ),
  live as (
    select lr.*
      from live_ranked lr, sizes
    where lr.lane_rank <= sizes.live_slots
  ),
  background_ranked as (
    select
      a.id,
      a.title,
      a.published_at,
      row_number() over (order by a.published_at desc, a.id) as lane_rank
      from public.articles a
      cross join sizes
    where a.event_id is null
      and a.published_at >= sizes.backlog_cutoff
      and (a.clustering_deferred_until is null or a.clustering_deferred_until <= now())
      and not exists (select 1 from live l where l.id = a.id)
  ),
  background as (
    select br.*
      from background_ranked br, sizes
    where br.lane_rank <= greatest(0, sizes.batch - sizes.live_slots)
  )
  select picked.id, picked.title, picked.published_at
    from (
      select l.id, l.title, l.published_at, 0 as lane, l.lane_rank from live l
      union all
      select b.id, b.title, b.published_at, 1 as lane, b.lane_rank from background b
    ) picked
  order by picked.lane, picked.lane_rank;
$fn$;

create or replace function public.event_has_demand(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    -- (a) what the story is about, matched against what readers follow.
    exists (
      select 1
        from public.event_topic_candidates etc
        join public.user_topics ut on ut.topic_id = etc.topic_id
        join public.profiles p on p.id = ut.user_id and p.auto_paused_at is null
        join public.notification_preferences np
          on np.user_id = ut.user_id and np.paused = false
        join auth.users au
          on au.id = ut.user_id
         and (au.banned_until is null or au.banned_until < now())
       where etc.event_id = p_event_id
    )
    -- (b) the publisher-level mapping, unchanged from 0054.
    or exists (
      select 1
        from public.articles a
        join public.source_topics st on st.source_id = a.source_id
        join public.user_topics ut on ut.topic_id = st.topic_id
        join public.profiles p on p.id = ut.user_id and p.auto_paused_at is null
        join public.notification_preferences np
          on np.user_id = ut.user_id and np.paused = false
        join auth.users au
          on au.id = ut.user_id
         and (au.banned_until is null or au.banned_until < now())
       where a.event_id = p_event_id
    )
    -- (c) an explicit follow is demand by definition.
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
       where a.event_id = p_event_id
    );
$fn$;

create or replace function public.briefing_readiness(
  p_horizon_minutes integer default 120,
  p_fresh_hours     integer default 24,
  p_target          integer default 3
)
returns table (
  upcoming_briefings integer,
  fresh_matching_stories_ready integer,
  fresh_relevant_waiting_clustering integer,
  fresh_relevant_waiting_analysis integer,
  under_supplied_briefings integer,
  next_deadline timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  with bounds as (
    select
      now() + make_interval(mins => greatest(1, coalesce(p_horizon_minutes, 120)))
        as horizon,
      now() - make_interval(hours => greatest(1, coalesce(p_fresh_hours, 24)))
        as fresh_cutoff,
      greatest(1, least(coalesce(p_target, 3), 50)) as target
  ),
  active_readers as (
    select p.id as user_id
      from public.profiles p
      join public.notification_preferences np
        on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id
       and (au.banned_until is null or au.banned_until < now())
    where p.auto_paused_at is null
  ),
  upcoming as (
    select d.user_id, min(d.scheduled_for) as scheduled_for
      from public.digests d
      join active_readers ar on ar.user_id = d.user_id
      cross join bounds
    where d.kind = 'briefing'
      and d.status in ('scheduled', 'generating')
      and d.scheduled_for >= now()
      and d.scheduled_for <= bounds.horizon
    group by d.user_id
  ),
  ready_by_user as (
    select u.user_id, count(distinct ue.event_id)::integer as ready
      from upcoming u
      join public.user_events ue
        on ue.user_id = u.user_id
       and ue.briefed_at is null
       and ue.expired_at is null
      join public.events e
        on e.id = ue.event_id
       and e.status = 'complete'
       and e.analysed_at is not null
      cross join bounds
    where e.first_seen_at >= bounds.fresh_cutoff
    group by u.user_id
  ),
  waiting_cluster_by_user as (
    select distinct u.user_id, a.id as article_id
      from upcoming u
      join public.user_topics ut on ut.user_id = u.user_id
      join public.source_topics st on st.topic_id = ut.topic_id
      join public.articles a on a.source_id = st.source_id and a.event_id is null
      cross join bounds
    where a.published_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, a.id
      from upcoming u
      join public.active_custom_sources ucs
        on ucs.user_id = u.user_id and ucs.active = true
      join public.articles a on a.source_id = ucs.source_id and a.event_id is null
      cross join bounds
    where a.published_at >= bounds.fresh_cutoff
  ),
  waiting_analysis_by_user as (
    select distinct u.user_id, e.id as event_id
      from upcoming u
      join public.user_topics ut on ut.user_id = u.user_id
      join public.event_topic_candidates etc on etc.topic_id = ut.topic_id
      join public.events e on e.id = etc.event_id and e.analysed_at is null
      cross join bounds
    where e.status in ('pending', 'analysing')
      and e.first_seen_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, e.id
      from upcoming u
      join public.user_topics ut on ut.user_id = u.user_id
      join public.source_topics st on st.topic_id = ut.topic_id
      join public.articles a on a.source_id = st.source_id and a.event_id is not null
      join public.events e on e.id = a.event_id and e.analysed_at is null
      cross join bounds
    where e.status in ('pending', 'analysing')
      and e.first_seen_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, e.id
      from upcoming u
      join public.active_custom_sources ucs
        on ucs.user_id = u.user_id and ucs.active = true
      join public.articles a on a.source_id = ucs.source_id and a.event_id is not null
      join public.events e on e.id = a.event_id and e.analysed_at is null
      cross join bounds
    where e.status in ('pending', 'analysing')
      and e.first_seen_at >= bounds.fresh_cutoff
  ),
  waiting_cluster_counts as (
    select wc.user_id, count(distinct wc.article_id)::integer as clustering
      from waiting_cluster_by_user wc
     group by wc.user_id
  ),
  waiting_analysis_counts as (
    select wa.user_id, count(distinct wa.event_id)::integer as analysis
      from waiting_analysis_by_user wa
     group by wa.user_id
  ),
  waiting_by_user as (
    select
      u.user_id,
      coalesce(wc.clustering, 0) as clustering,
      coalesce(wa.analysis, 0) as analysis
      from upcoming u
      left join waiting_cluster_counts wc on wc.user_id = u.user_id
      left join waiting_analysis_counts wa on wa.user_id = u.user_id
  ),
  supply as (
    select
      u.user_id,
      coalesce(r.ready, 0) as ready,
      coalesce(w.clustering, 0) as clustering,
      coalesce(w.analysis, 0) as analysis
      from upcoming u
      left join ready_by_user r on r.user_id = u.user_id
      left join waiting_by_user w on w.user_id = u.user_id
  )
  select
    (select count(*)::integer from upcoming),
    coalesce((select sum(s.ready)::integer from supply s), 0),
    (select count(distinct wc.article_id)::integer from waiting_cluster_by_user wc),
    (select count(distinct wa.event_id)::integer from waiting_analysis_by_user wa),
    coalesce((
      select count(*)::integer
        from supply s, bounds
      where s.ready < bounds.target
        and s.clustering + s.analysis > 0
    ), 0),
    (select min(u.scheduled_for) from upcoming u);
$fn$;

create or replace function public.admin_source_demand()
returns table (
  source_id             uuid,
  interested_users      integer,
  paid_interested_users integer,
  direct_followers      integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select p.id as user_id, coalesce(s.plan, 'uno') as plan
      from public.profiles p
      join public.notification_preferences np on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id and (au.banned_until is null or au.banned_until < now())
      left join public.subscriptions s on s.user_id = p.id
     where p.auto_paused_at is null
  ),
  by_topic as (
    select st.source_id, e.user_id, e.plan
      from public.source_topics st
      join public.user_topics ut on ut.topic_id = st.topic_id
      join eligible e on e.user_id = ut.user_id
  ),
  by_follow as (
    select ucs.source_id, e.user_id, e.plan
      from public.user_custom_sources ucs
      join eligible e on e.user_id = ucs.user_id
     where ucs.active = true
  ),
  combined as (
    select * from by_topic
    union
    select * from by_follow
  )
  select
    s.id,
    count(distinct c.user_id)::integer,
    count(distinct c.user_id) filter (where c.plan is distinct from 'uno')::integer,
    (select count(distinct f.user_id)::integer from by_follow f where f.source_id = s.id)
  from public.sources s
  left join combined c on c.source_id = s.id
  group by s.id;
$fn$;

create or replace function public.admin_topic_demand(p_days integer default 14)
returns table (
  topic_id       uuid,
  slug           text,
  label          text,
  kind           public.topic_kind,
  followers      integer,
  paid_followers integer,
  mapped_sources integer,
  recent_events  integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with eligible as (
    select p.id as user_id, coalesce(s.plan, 'uno') as plan
      from public.profiles p
      join public.notification_preferences np on np.user_id = p.id and np.paused = false
      join auth.users au
        on au.id = p.id and (au.banned_until is null or au.banned_until < now())
      left join public.subscriptions s on s.user_id = p.id
     where p.auto_paused_at is null
  ),
  followed as (
    select ut.topic_id,
           count(distinct e.user_id)::integer as followers,
           count(distinct e.user_id) filter (where e.plan is distinct from 'uno')::integer
             as paid_followers
      from public.user_topics ut
      join eligible e on e.user_id = ut.user_id
     group by ut.topic_id
  ),
  mapped as (
    select st.topic_id, count(*)::integer as n
      from public.source_topics st
     group by st.topic_id
  ),
  recent as (
    select ev.id, ev.tags
      from public.events ev
     where ev.first_seen_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)))
  ),
  -- Both routes to an event, unioned rather than added, so an event reached by
  -- classification AND by tags counts once.
  reach as (
    select et.topic_id, et.event_id
      from public.event_topics et
      join recent r on r.id = et.event_id
    union
    select t.id, r.id
      from public.topics t
      join recent r on r.tags @> t.terms
     where t.terms <> '{}'
  ),
  reached as (
    select topic_id, count(*)::integer as n from reach group by topic_id
  )
  select t.id, t.slug, t.label, t.kind,
         coalesce(f.followers, 0),
         coalesce(f.paid_followers, 0),
         coalesce(m.n, 0),
         coalesce(rc.n, 0)
    from public.topics t
    left join followed f  on f.topic_id  = t.id
    left join mapped   m  on m.topic_id  = t.id
    left join reached  rc on rc.topic_id = t.id;
$fn$;

create or replace function public.reader_sources(
  p_user_id uuid,
  p_limit   integer default 100,
  p_offset  integer default 0
)
returns table (
  id           uuid,
  name         text,
  kind         public.source_kind,
  homepage     text,
  is_own       boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with own as (
    select s.id, s.name, s.kind, s.homepage, true as is_own
      from public.sources s
      join public.user_custom_sources u
        on u.source_id = s.id
       and u.user_id = p_user_id
       and u.active
     where s.active
  ),
  relevant as (
    select distinct s.id, s.name, s.kind, s.homepage, false as is_own
      from public.sources s
      join public.source_topics st on st.source_id = s.id
      join public.user_topics ut
        on ut.topic_id = st.topic_id
       and ut.user_id = p_user_id
     where s.active
       and s.listed
       and not exists (select 1 from own o where o.id = s.id)
  )
  select * from (
    select * from own
    union all
    select * from relevant
  ) rows
  -- Own sources first: a reader looking at this page is usually looking for
  -- something they added. Then alphabetical, so paging is stable.
  order by is_own desc, name
  limit greatest(0, least(coalesce(p_limit, 100), 200))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

create or replace function public.search_topics(
  p_user_id uuid,
  p_query   text,
  p_limit   integer default 20
)
returns table (
  id       uuid,
  slug     text,
  label    text,
  kind     public.topic_kind,
  followed boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with q as (
    select
      btrim(coalesce(p_query, '')) as raw,
      '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '!', '!!'), '%', '!%'), '_', '!_') || '%'
        as pattern
  ),
  mine as (
    select ut.topic_id from public.user_topics ut where ut.user_id = p_user_id
  ),
  -- Two distinct followers. Until 0110 this counted only rows the reader
  -- had not switched off, because a switched-off interest is not evidence
  -- the label is worth offering to somebody else. Nothing ever wrote that
  -- boolean -- mute state lives in `muted_topics` (0089), keyed by label --
  -- so the filter was always true and dropping it changes no count.
  shared as (
    select ut.topic_id
      from public.user_topics ut
     group by ut.topic_id
    having count(distinct ut.user_id) >= 2
  )
  select t.id, t.slug, t.label, t.kind, (m.topic_id is not null) as followed
    from public.topics t
    cross join q
    left join mine   m on m.topic_id = t.id
    left join shared s on s.topic_id = t.id
   where q.raw <> ''
     and t.label ilike q.pattern escape '!'
     and (
       t.kind = 'predefined'
       or m.topic_id is not null
       or t.created_by = p_user_id
       or s.topic_id is not null
     )
   -- Exact slug first so typing a topic that already exists surfaces the
   -- canonical row at the top and the selector can suppress its create action.
   -- Then the editorial list, then alphabetical, so paging is stable and the
   -- ordering leaks no popularity signal.
   order by (t.slug = public.topic_slug_hint(q.raw)) desc,
            (t.kind = 'predefined') desc,
            t.label
   limit greatest(0, least(coalesce(p_limit, 20), 50));
$fn$;
