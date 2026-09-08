-- nyuz -- freshness as an invariant, and demand measured on content
--
-- ---------------------------------------------------------------------------
-- What went wrong
-- ---------------------------------------------------------------------------
--
-- On 2026-09-08 a briefing generated at 07:30 led with a story from 1 September
-- and carried items from 25 August. Three independent defects lined up, and each
-- one on its own would have been survivable:
--
--   1. `pre_analysis_demand_gate` measured demand through `source_topics`, a
--      static publisher->topic map. A multi-topic publisher cannot be described
--      by one mapping: Wired covers AI and culture and health, the Guardian
--      covers everything. Measured live, the gate admitted ZERO of the fifteen
--      newest pending events while returning a hundred from 25 August, because
--      the outlets producing today's news had no mapping reaching the reader
--      and a fortnight-old arXiv batch did. Analysis fell from ~120 events a
--      day to one.
--
--   2. Neither `pending_events_with_demand` nor any other queue had an opinion
--      about age. `order by first_seen_at desc` is only a preference: with 1,392
--      pending events and a batch of six, a backlog large enough simply is the
--      queue. Nothing structurally reserved capacity for live news.
--
--   3. `user_events` accumulated unbriefed candidates for ever. The test account
--      had 24 going back to 25 August, and the digest ranked them
--      `relevance DESC` with no time term at all, so they outranked everything
--      current whenever the pipeline recovered.
--
-- Fixing (1) alone would have restored volume and still produced stale
-- briefings. Fixing (3) alone would have emptied the briefing. They are one
-- problem -- the pipeline had no concept of "now" -- and this migration gives it
-- one, in the three places that decide what a reader sees.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
-- ---------------------------------------------------------------------------
--
-- **Demand moves from the publisher to the story.** `event_topic_candidates`
-- records what an event is probably about, computed in `classify.ts` from
-- headlines by the same deterministic term matching stage 5 already uses. No
-- model, no per-reader work, one row per (event, topic), read by every reader.
-- The demand gate gains that as a third route alongside the two it had.
--
-- This does NOT relax the cost model, which is the entire reason the gate
-- exists. An event still has to reach a real, reachable, unpaused reader before
-- anyone pays to understand it. What changes is that the question is asked of
-- the story rather than of its publisher, so a Wired piece about AI reaches an
-- AI reader and a Wired piece about running shoes still costs nothing.
--
-- **Every live-news queue gets two lanes.** A fixed share of each batch is
-- reserved for events inside a 48-hour window, and the remainder drains history.
-- A backlog can therefore never occupy more than its share, however large it
-- grows -- which is a guarantee, where `order by ... desc` was only a hope.
--
-- **Unbriefed candidates expire.** `user_events.expired_at` marks a match that
-- was never briefed and is now too old to be. It is a mark, never a delete:
-- `user_events` is the record of what reached whom, and history, analytics and
-- dedupe all read it. 0067 already purges the table on the reader's retention
-- window; this is about eligibility, not retention, and the two are independent.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- No change to `event_topics`. That table is what the analysis pass concluded,
-- with a model behind it, and it stays the thing a reader is matched on and the
-- thing a story page renders. `event_topic_candidates` is a cheap guess used to
-- decide whether that conclusion is worth buying, and letting a guess into the
-- curated table would make every downstream consumer less trustworthy to save
-- one join.
--
-- No AI anywhere in this file or in the stage that fills the new table.

-- ---------------------------------------------------------------------------
-- 1. Candidate topics: what an event is probably about, before analysis
-- ---------------------------------------------------------------------------

create table if not exists public.event_topic_candidates (
  event_id   uuid        not null references public.events (id) on delete cascade,
  topic_id   uuid        not null references public.topics (id) on delete cascade,
  -- Below `match.ts`'s observed 0.3 and far below an editorial 1.0. Nothing
  -- reads it as a threshold yet; it is recorded so the ordering between the
  -- three ways a link can arise is already correct when something does.
  confidence real        not null default 0.2,
  created_at timestamptz not null default now(),
  primary key (event_id, topic_id)
);

-- The gate's hot path is "does this event have a candidate topic that some
-- reader follows", which walks topic_id -> user_topics. The primary key already
-- covers event_id; this covers the other direction.
create index if not exists event_topic_candidates_topic_idx
  on public.event_topic_candidates (topic_id);

-- Global content, same trust class as `event_topics`: readable by any signed-in
-- reader, written only by the pipeline through the service role. RLS on with a
-- select policy and no write policy IS the write guard -- see 0002.
alter table public.event_topic_candidates enable row level security;

drop policy if exists "event_topic_candidates readable" on public.event_topic_candidates;
create policy "event_topic_candidates readable"
  on public.event_topic_candidates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Classification bookkeeping
-- ---------------------------------------------------------------------------

-- Null means "not yet looked at". Stamped even when an event matched nothing,
-- which is the difference between "we have not looked" and "we looked and it is
-- about nothing anyone here follows". Without it the classifier would re-examine
-- the same unmatched events for ever and never reach the ones behind them.
alter table public.events
  add column if not exists classified_at timestamptz;

-- Partial, because the only query that uses it asks for the unclassified ones
-- and that set shrinks to near-empty in steady state.
create index if not exists events_unclassified_idx
  on public.events (first_seen_at desc)
  where classified_at is null;

-- The two-lane selector orders live and backlog by first_seen_at within
-- status = 'pending'. Without this it is a seq scan over every event.
create index if not exists events_pending_first_seen_idx
  on public.events (first_seen_at desc)
  where status = 'pending' and analysed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Briefing candidate expiry
-- ---------------------------------------------------------------------------

-- Set when a match was never briefed and has aged out of every cadence's
-- window. A mark, not a delete: the row still records that this reader matched
-- this event, which dedupe and analytics both depend on.
alter table public.user_events
  add column if not exists expired_at timestamptz;

create index if not exists user_events_briefable_idx
  on public.user_events (user_id, matched_at desc)
  where briefed_at is null and expired_at is null;

-- ---------------------------------------------------------------------------
-- 4. Demand, measured on the story
-- ---------------------------------------------------------------------------
--
-- Three routes, and an event needs only one:
--
--   a. a candidate topic from `classify.ts` that a reachable reader follows
--      -- the new one, and the one that makes multi-topic publishers work;
--   b. the publisher-level `source_topics` mapping -- kept, because an
--      editorial mapping entered in the console is a stronger statement than a
--      headline match and must not be thrown away;
--   c. a reader who explicitly added the source themselves.
--
-- "Reachable" is unchanged from 0054 and is the whole point: an unmuted topic,
-- an account that is not auto-paused, briefings that are not paused, and a login
-- that is not banned. A reader who cannot receive a briefing generates no demand
-- and therefore no spend.

-- One definition of demand, as a predicate over a single event.
--
-- Written as a `stable` SQL function taking one uuid so Postgres can INLINE it
-- into a query's plan rather than executing it per row. That matters: the queue
-- below applies this to every pending event, and a function boundary there
-- would turn three index lookups into 1,400 function invocations. Declaring it
-- `language sql`, `stable`, and a single expression is what makes inlining
-- legal, so none of those three is stylistic.

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
        join public.user_topics ut on ut.topic_id = etc.topic_id and ut.muted = false
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
        join public.user_topics ut on ut.topic_id = st.topic_id and ut.muted = false
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

-- The batch form the console and `analyse.ts` already call. One definition of
-- demand, reused rather than restated -- 0054 documents what happened the last
-- time these two drifted apart.
create or replace function public.events_with_demand(p_event_ids uuid[])
returns table (event_id uuid, has_demand boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id, public.event_has_demand(e.id)
    from public.events e
   where e.id = any(p_event_ids);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The analysis queue, with lanes
-- ---------------------------------------------------------------------------
--
-- `p_live_hours` is what counts as live news for this queue, and `p_live_share`
-- is how much of the batch it may not lose. The defaults mirror
-- `src/lib/pipeline/freshness.ts` -- 48 hours and five slots in six -- and the
-- parameters exist so a test can pin a window without waiting for one.
--
-- The live lane takes its share; the backlog lane takes the rest PLUS whatever
-- the live lane could not fill. So on a quiet night the queue still runs at full
-- width and drains history, and on a busy morning history is capped at one slot
-- in six. Neither lane can starve the other, which is the property `order by
-- first_seen_at desc` never had.
--
-- Each lane applies its time filter BEFORE the demand predicate, so the
-- expensive check runs against a handful of rows the index already narrowed
-- rather than against the whole pending backlog.

create or replace function public.pending_events_with_demand(
  p_limit      integer default 6,
  p_live_hours integer default 48,
  p_live_share numeric default 0.8333333
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
          greatest(1, least(coalesce(p_limit, 6), 100)) * coalesce(p_live_share, 0.8333333)
        )::integer
      ) as live_slots
  ),
  live as (
    select e.id, e.title, e.status, e.analysis_tokens, e.first_seen_at
      from public.events e, sizes
     where e.analysed_at is null
       and e.status = 'pending'
       and (e.analysis_deferred_until is null or e.analysis_deferred_until <= now())
       and e.first_seen_at >= sizes.cutoff
       and public.event_has_demand(e.id)
     order by e.first_seen_at desc
     limit (select live_slots from sizes)
  ),
  backlog as (
    select e.id, e.title, e.status, e.analysis_tokens, e.first_seen_at
      from public.events e, sizes
     where e.analysed_at is null
       and e.status = 'pending'
       and (e.analysis_deferred_until is null or e.analysis_deferred_until <= now())
       and e.first_seen_at < sizes.cutoff
       and public.event_has_demand(e.id)
     order by e.first_seen_at desc
     limit (select batch from sizes) - (select count(*)::integer from live)
  )
  select id, title, status, analysis_tokens
    from (
      select id, title, status, analysis_tokens, first_seen_at from live
      union all
      select id, title, status, analysis_tokens, first_seen_at from backlog
    ) picked
   order by first_seen_at desc;
$fn$;

-- 0054's single-argument signature is replaced by the three-argument one above;
-- the existing one-argument call site in `analyse.ts` still resolves because the
-- new arguments have defaults. The old function is dropped so a stale plan
-- cannot be chosen.
drop function if exists public.pending_events_with_demand(integer);

revoke all on function public.pending_events_with_demand(integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.pending_events_with_demand(integer, integer, numeric)
  to service_role;

revoke all on function public.event_has_demand(uuid) from public, anon, authenticated;
grant execute on function public.event_has_demand(uuid) to service_role;

revoke all on function public.events_with_demand(uuid[]) from public, anon, authenticated;
grant execute on function public.events_with_demand(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Expiring stale briefing candidates
-- ---------------------------------------------------------------------------
--
-- Ten days, matching `CANDIDATE_EXPIRY_DAYS`. Deliberately wider than the
-- eight-day weekly briefing ceiling so expiry can never be the thing that
-- removes a row a weekly reader was still entitled to receive -- the ceiling
-- decides what a briefing may show, this stops the candidate set growing a
-- permanent tail of rows no briefing will ever show again.
--
-- Bounded per call and ordered oldest-first, so the daily `dormant` run does a
-- predictable amount of work rather than one unbounded update on the day someone
-- notices. Returns the count so the cron can report it.

create or replace function public.expire_stale_user_events(
  p_days  integer default 10,
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  expired integer := 0;
begin
  with stale as (
    select ue.user_id, ue.event_id
      from public.user_events ue
     where ue.briefed_at is null
       and ue.expired_at is null
       and ue.matched_at < now() - make_interval(days => greatest(1, coalesce(p_days, 10)))
     order by ue.matched_at asc
     limit greatest(1, least(coalesce(p_limit, 5000), 50000))
     for update skip locked
  )
  update public.user_events ue
     set expired_at = now()
    from stale
   where ue.user_id = stale.user_id
     and ue.event_id = stale.event_id;

  get diagnostics expired = row_count;
  return expired;
end;
$fn$;

revoke all on function public.expire_stale_user_events(integer, integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_user_events(integer, integer) to service_role;
