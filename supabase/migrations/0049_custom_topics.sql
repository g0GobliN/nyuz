-- nyuz -- reader-created interests (custom topics)
--
-- Until this migration, a topic had to exist in `TOPIC_POOL` before anybody
-- could follow it. Four independent gates enforced that -- the Add button, the
-- `keepCoveredTopics` filter on save, a drop in stage 5's `loadReaders`, and
-- the closed vocabulary the analysis prompt hands the model -- so "Nepal" could
-- not be saved, and a row inserted by hand would have matched nothing.
--
-- This migration makes the interest free text while keeping the property the
-- whole cost argument rests on: CONTENT IS GLOBAL, INTERESTS ARE REFERENCES.
-- A custom topic is one shared row in `topics` that many readers point at, in
-- exactly the way `user_custom_sources` (0030) made a reader-requested feed one
-- shared row in `sources`. If a hundred readers follow Nepal, nothing is
-- crawled, clustered or understood a hundred times.
--
-- ---------------------------------------------------------------------------
-- Why `kind`, and why it is the load-bearing column here
-- ---------------------------------------------------------------------------
--
-- `analyse.ts` reads every row of `topics` and embeds the slugs in the system
-- prompt as a closed classification vocabulary. Lifting the gate without this
-- column would put every label any reader has ever typed into the prompt of
-- every event analysis, for ever -- an unbounded prompt that grows with signups
-- and is paid for on every event. `kind` is what keeps the model's vocabulary
-- the editorial list it was, while readers follow whatever they like.
--
-- So: predefined topics are classified by the model into `event_topics`.
-- Custom topics are matched deterministically against the shared concept
-- signal below. Two routes, one table, no per-reader model call either way.
--
-- The default is 'custom' because after this migration the only thing creating
-- rows is a reader typing one. A future editorial seed must say `kind` out
-- loud -- which is the right amount of friction for adding to a vocabulary
-- that costs prompt tokens on every event.

create type topic_kind as enum ('predefined', 'custom');

alter table public.topics
  add column kind       topic_kind  not null default 'custom',
  -- The deterministic match terms derived from `label` at creation:
  -- lowercased, punctuation flattened, stopwords dropped. "India vs China"
  -- becomes {india,china}, and an event has to mention BOTH to be selected.
  -- Stored rather than derived at match time so the rule that admitted an
  -- event is inspectable afterwards, and so SQL can use it (see below).
  add column terms      text[]      not null default '{}',
  -- Who typed it first. `on delete set null` on purpose: deleting an account
  -- must not destroy a canonical topic other readers are following.
  add column created_by uuid        references public.profiles (id) on delete set null,
  add column created_at timestamptz not null default now();

-- Everything seeded by 0006, 0009 and 0012 was chosen by a human and is already
-- in the model's vocabulary. This is the only place that assumption is made.
update public.topics set kind = 'predefined';

-- The hot path: analysis reads the vocabulary once per run and must not pay for
-- the custom rows it is not allowed to use.
create index topics_predefined_idx on public.topics (slug) where kind = 'predefined';

-- Backs the per-reader creation rate limit in replaceTopics(). A plan cap
-- bounds how many topics a reader HOLDS; nothing bounded how many they could
-- CREATE by adding and removing in a loop, and `topics` is read whole by both
-- the analyser and the matcher on every run.
create index topics_creator_idx on public.topics (created_by, created_at desc)
  where created_by is not null;

comment on column public.topics.kind is
  'predefined = editorial, in the model classification vocabulary. custom = '
  'reader-created, matched deterministically against events.tags. Only '
  'predefined slugs may reach the analysis prompt -- see 0049.';

-- ---------------------------------------------------------------------------
-- The shared concept signal
-- ---------------------------------------------------------------------------
--
-- A custom interest needs something to match against that is richer than the
-- headline and cheaper than a model call per reader. `tags` is that: a bounded
-- list of concepts, places and organisations the event is about, produced by
-- the analysis pass that ALREADY RUNS, in the same completion. No new model
-- call, no per-reader work -- one extraction, shared by every reader for ever,
-- which is the same shape as `importance` and `event_topics`.
--
-- That is what lets "Nepal" reach a story headlined "Monsoon rains kill 200 in
-- the Kathmandu valley" without the literal word appearing in the title, and
-- without asking a model "does this reader care?" for every article x reader.
--
-- NORMALISED ON WRITE: lowercase, punctuation flattened to single spaces. Tags
-- are a matching signal, never display copy, and storing them normalised is
-- what lets `tags @> terms` use the index below instead of re-normalising every
-- row at query time.
alter table public.events
  add column tags text[] not null default '{}';

create index events_tags_idx on public.events using gin (tags);

comment on column public.events.tags is
  'Normalised concept tags from the shared analysis pass. Lowercase, '
  'punctuation flattened. The signal custom topics match against -- computed '
  'once per event, read by every reader. Never rendered.';

-- Deliberately NOT backfilled. Populating tags for the existing corpus would
-- mean re-analysing it, which is exactly the cost this design exists to avoid.
-- Events analysed before this migration keep an empty array and remain
-- reachable through their title and what_happened, which stage 5 also reads.

-- ---------------------------------------------------------------------------
-- RLS -- the policy has to change, and this is not optional
-- ---------------------------------------------------------------------------
--
-- 0002 made `topics` readable to every signed-in user with `using (true)`,
-- which was right when every row was an editorial label. It is wrong the moment
-- a row can be free text somebody typed: any authenticated caller could read
-- every custom label in the database straight through PostgREST, and no
-- suggestion-side gate would matter because the table itself was open.
--
-- Predefined topics stay world-readable. A custom topic is visible to the
-- reader who created it and to the readers who follow it, and to nobody else.
-- Reuse across strangers still works, because the resolve-or-create path runs
-- server-side under the service role, which bypasses RLS entirely -- two
-- readers who independently type "Nepal" still land on one row (see
-- replaceTopics), they simply cannot enumerate each other's interests.
--
-- Safe to tighten: every reader of this table is service-role today --
-- preferences.ts, analytics.ts, source-topics.ts, analyse.ts and match.ts all
-- hold the service key. Nothing in the browser selects from `topics`.

drop policy if exists "topics readable" on public.topics;

create policy "topics readable" on public.topics
  for select to authenticated
  using (
    kind = 'predefined'
    or created_by = auth.uid()
    or exists (
      select 1 from public.user_topics ut
       where ut.topic_id = topics.id and ut.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Suggestion search
-- ---------------------------------------------------------------------------
--
-- What the selector may offer, and the rule is a privacy rule before it is a
-- product one:
--
--   * predefined topics -- always, they are the editorial list;
--   * the caller's own topics -- always, including a custom one nobody else
--     follows, or they could not find the thing they created yesterday;
--   * other readers' custom topics -- only once at least two distinct readers
--     follow them.
--
-- The threshold is what stops the first person to type a private phrase from
-- making it globally autocompletable. A topic that later drops below two
-- followers is not deleted and nothing about it changes; it simply stops being
-- offered to strangers, because the reason to offer it was that it had been
-- independently useful to more than one person.
--
-- Follower counts and creator identity are computed here and deliberately NOT
-- returned. The caller gets what to draw -- label, kind, whether they already
-- follow it -- and learns nothing about anybody else.
--
-- `p_query` is escaped before it reaches LIKE. `!` is the escape character
-- rather than a backslash so the doubling is legible and does not depend on
-- standard_conforming_strings.

-- The slug rule lives in TypeScript (`topicSlug`), because that is where topics
-- are created. This is a deliberately partial mirror used only to sort an exact
-- hit to the top of a suggestion list -- a cosmetic decision. It must never
-- become the identity: a disagreement here costs one row's ordering, whereas a
-- second implementation of the identity would silently fork the canonical row.
create or replace function public.topic_slug_hint(p_label text)
returns text
language sql
immutable
as $fn$
  select btrim(
    regexp_replace(lower(btrim(coalesce(p_label, ''))), '[^[:alnum:]]+', '-', 'g'),
    '-'
  );
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
  -- Two distinct followers, counted over non-muted rows. A muted topic is one
  -- the reader switched off, and a switched-off interest is not evidence that
  -- the label is worth offering to somebody else.
  shared as (
    select ut.topic_id
      from public.user_topics ut
     where ut.muted = false
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

-- ---------------------------------------------------------------------------
-- Topic demand -- the source-discovery queue
-- ---------------------------------------------------------------------------
--
-- A custom topic is a `topics` row, so `user_topics` already flows into
-- `admin_source_demand` (0020/0030), `events_with_demand` (0021) and
-- `refresh_source_demand` (0031). The one broken link is `source_topics`: a
-- brand-new interest has no sources mapped to it, so it contributes nothing to
-- demand and nothing collects for it.
--
-- Two things close that, and neither of them crawls the internet because
-- somebody typed a word:
--
--   1. Observed coverage. When a custom topic selects an event in stage 5, the
--      sources that reported it get a low-confidence `source_topics` row. That
--      is written by the pipeline from evidence rather than guessed, it is the
--      shape `source_topics` was built for, and it is what makes a hundred
--      Nepal followers converge onto the same handful of feeds and keep them
--      alive through `refresh_source_demand`.
--
--   2. This function. Followed subjects with no mapped coverage are the queue
--      an operator works through by hand in the console. Demand is measured and
--      shown first, acted on second -- the sequencing plan2 section 104 asks
--      for and phases 4, 5 and 8 already followed.
--
-- `eligible` is 0030's definition verbatim rather than a second idea of "active
-- reader": not paused, not auto-paused for inactivity, not banned.

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
    select p.id as user_id, coalesce(s.plan, 'free') as plan
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
           count(distinct e.user_id) filter (where e.plan is distinct from 'free')::integer
             as paid_followers
      from public.user_topics ut
      join eligible e on e.user_id = ut.user_id
     where ut.muted = false
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- Both take a user id as an argument, so both are only safe once the caller has
-- been authenticated -- that is the service role, after `signedInOnly` or
-- `adminOnly` has established who is asking. 0036's lesson applies: name PUBLIC
-- explicitly or the default grant survives and the revoke is decorative.

revoke all on function public.search_topics(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_topics(uuid, text, integer) to service_role;

revoke all on function public.admin_topic_demand(integer)
  from public, anon, authenticated;
grant execute on function public.admin_topic_demand(integer) to service_role;

revoke all on function public.topic_slug_hint(text) from public, anon, authenticated;
grant execute on function public.topic_slug_hint(text) to service_role;
