-- nyuz -- demand- and deadline-aware pipeline queues
--
-- Freshness at digest time is not enough if fresh relevant work is still in an
-- upstream queue when the briefing becomes due. These selectors keep the one
-- shared pipeline, but reserve its expensive work for content an active reader
-- needs and move that work forward as the reader's briefing approaches.

begin;

create index if not exists articles_unclustered_published_idx
  on public.articles (published_at desc)
  where event_id is null;

-- Stage 3: fresh articles wanted by active readers occupy the priority lane.
-- Direct follows are retained as an explicit demand signal, while an upcoming
-- scheduled briefing moves all of that reader's relevant sources to the front.
-- The background lane is fixed rather than allowed to consume unused priority
-- slots, so a quiet demand queue does not turn into extra model spend.
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
        on ut.topic_id = st.topic_id and ut.muted = false
      join active_readers ar on ar.user_id = ut.user_id
      left join public.user_source_prefs usp
        on usp.user_id = ut.user_id and usp.source_id = st.source_id
     where coalesce(usp.pref, 'normal'::source_pref) <> 'muted'::source_pref
    union all
    select ucs.source_id, ucs.user_id, true as direct
      from public.user_custom_sources ucs
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

revoke all on function public.priority_articles_to_cluster(integer, integer, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.priority_articles_to_cluster(integer, integer, numeric, integer)
  to service_role;

-- Stage 5: retain the existing RPC contract, but rank live demanded events by
-- the readers and deadlines they serve. Old demanded events get only the fixed
-- background slice. Coverage count is the pre-analysis proxy for an unusually
-- important older event: a widely corroborated event wins that lane before an
-- ordinary single-source backlog item.
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
        on ut.topic_id = etc.topic_id and ut.muted = false
      join active_readers ar on ar.user_id = ut.user_id
    union all
    select a.event_id, ut.user_id, false as direct
      from public.articles a
      join public.source_topics st on st.source_id = a.source_id
      join public.user_topics ut
        on ut.topic_id = st.topic_id and ut.muted = false
      join active_readers ar on ar.user_id = ut.user_id
    where a.event_id is not null
    union all
    select a.event_id, ucs.user_id, true as direct
      from public.articles a
      join public.user_custom_sources ucs
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

revoke all on function public.pending_events_with_demand(integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.pending_events_with_demand(integer, integer, numeric)
  to service_role;

-- Operational readiness for the next two hours. A briefing is under-supplied
-- only when it has fewer than the target number of fresh matched stories AND
-- relevant fresh work is still upstream. A genuinely quiet day therefore stays
-- healthy and is never "fixed" by widening the freshness window.
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
      join public.user_topics ut on ut.user_id = u.user_id and ut.muted = false
      join public.source_topics st on st.topic_id = ut.topic_id
      join public.articles a on a.source_id = st.source_id and a.event_id is null
      cross join bounds
    where a.published_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, a.id
      from upcoming u
      join public.user_custom_sources ucs
        on ucs.user_id = u.user_id and ucs.active = true
      join public.articles a on a.source_id = ucs.source_id and a.event_id is null
      cross join bounds
    where a.published_at >= bounds.fresh_cutoff
  ),
  waiting_analysis_by_user as (
    select distinct u.user_id, e.id as event_id
      from upcoming u
      join public.user_topics ut on ut.user_id = u.user_id and ut.muted = false
      join public.event_topic_candidates etc on etc.topic_id = ut.topic_id
      join public.events e on e.id = etc.event_id and e.analysed_at is null
      cross join bounds
    where e.status in ('pending', 'analysing')
      and e.first_seen_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, e.id
      from upcoming u
      join public.user_topics ut on ut.user_id = u.user_id and ut.muted = false
      join public.source_topics st on st.topic_id = ut.topic_id
      join public.articles a on a.source_id = st.source_id and a.event_id is not null
      join public.events e on e.id = a.event_id and e.analysed_at is null
      cross join bounds
    where e.status in ('pending', 'analysing')
      and e.first_seen_at >= bounds.fresh_cutoff
    union
    select distinct u.user_id, e.id
      from upcoming u
      join public.user_custom_sources ucs
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

revoke all on function public.briefing_readiness(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.briefing_readiness(integer, integer, integer)
  to service_role;

commit;
