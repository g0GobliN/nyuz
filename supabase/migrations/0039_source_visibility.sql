-- nyuz -- catalogue visibility, kept separate from coverage and provenance
--
-- Three questions about a source that were previously answered by one column
-- or by nothing at all. They are genuinely independent and conflating any two
-- of them produces a wrong answer somewhere:
--
--   coverage_mode  WHY we crawl it        core | demand        (0018, unchanged)
--   listed         whether a READER may discover it            (new)
--   origin         where it CAME FROM     curated | user       (new)
--
-- `coverage_mode` was the tempting shortcut for visibility and it is wrong:
-- 27 of the curated catalogue are already `demand`, so hiding non-core sources
-- would hide 27 real feeds from the very readers who asked for those subjects.
-- Coverage answers a scheduling question. Listing answers a product one.
--
-- THE BUG THIS CLOSES
--
-- `0002_rls.sql` grants `for select to authenticated using (true)` on
-- `public.sources`. Since 0030 let readers add their own feeds into that same
-- global table, every signed-in account could read every other account's
-- private sources -- a local paper, an employer's release feed -- both through
-- the reader source page and by querying PostgREST directly with their own
-- token. The policy is replaced below.
--
-- WHY NO created_by_user_id
--
-- Because ownership already exists, in `user_custom_sources`, and it is a
-- many-to-many on purpose: a hundred readers submitting the same feed follow
-- ONE canonical `sources` row and one crawler. A `created_by` column would
-- describe only whoever happened to be first, would go stale when that reader
-- left, and would tempt somebody into treating it as ownership. `origin`
-- records provenance without naming a person, which is all provenance needs.

create type public.source_origin as enum ('curated', 'user');

alter table public.sources
  add column if not exists listed boolean not null default false,
  add column if not exists origin public.source_origin not null default 'curated';

comment on column public.sources.listed is
  'Whether readers may discover this source in the catalogue. Independent of '
  'coverage_mode, which says why we crawl it. Default false so a reader-'
  'submitted feed is private until somebody deliberately promotes it.';

comment on column public.sources.origin is
  'Where the source came from. Provenance only -- never ownership, which lives '
  'in user_custom_sources because one source has many followers.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Every source that exists right now came from a seed migration: `0006` and its
-- successors, re-verified in `0024`-`0026`, counted at 87 rows / 87 distinct
-- feed urls in docs/v2-report.md. The reader-submitted path shipped in 0030 and
-- has not been exercised end to end (v2-report criterion 25), so there is
-- nothing here to misclassify.
--
-- This is deliberately NOT "anything with a follower is user-submitted".
-- `claim_custom_source` adds a follow row for a source a reader asked for even
-- when that source was already in the curated catalogue -- so that test would
-- unlist a curated feed the moment one reader followed it, which is exactly the
-- regression this migration must not cause.
--
-- If a genuinely reader-submitted source does predate this, it becomes visible
-- in the catalogue and an admin can unlist it from /admin/sources. That is the
-- safe direction to be wrong in: a curated feed wrongly hidden is a silent loss
-- of coverage, where a private feed wrongly shown is one visible row an
-- operator can act on.

update public.sources set listed = true, origin = 'curated';

-- Reader page filters on this constantly, and it is highly selective once the
-- table fills with unlisted submissions.
create index if not exists sources_listed_idx on public.sources (listed) where listed;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

drop policy if exists "sources readable" on public.sources;

-- A reader sees the catalogue, plus whatever they personally follow. The
-- `exists` runs under the caller's own privileges, and `user_custom_sources`
-- already restricts select to `auth.uid() = user_id` (0030), so this cannot
-- leak another account's follows even if the subquery were written loosely.
create policy "catalogue and own sources readable" on public.sources
  for select to authenticated
  using (
    listed
    or exists (
      select 1
        from public.user_custom_sources u
       where u.source_id = sources.id
         and u.user_id = auth.uid()
    )
  );

-- Still no insert, update or delete policy for readers. Adding a source goes
-- through `claim_custom_source`, which holds the plan cap.

-- ---------------------------------------------------------------------------
-- The reader's source list
-- ---------------------------------------------------------------------------
--
-- Replaces an unbounded `select * from sources where active` that every reader
-- ran on every visit to the source page. At 87 rows that was merely wasteful;
-- with reader-submitted feeds in the same table it was also the leak above, and
-- it grows without limit.
--
-- Bounded three ways: to the catalogue, to subjects this reader actually
-- follows, and by an explicit limit/offset. The reader's own custom sources are
-- unioned in regardless of topic -- they asked for those by name, so a topic
-- filter has no business hiding them.

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
       and not ut.muted
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

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------
--
-- Searching is deliberately wider than the list: the whole catalogue, not only
-- the subjects already followed, because somebody searching "Nikkei" is trying
-- to find a source they do NOT yet have. Still never wider than
-- `listed = true` plus the caller's own.

create or replace function public.search_reader_sources(
  p_user_id uuid,
  p_query   text,
  p_limit   integer default 40
)
returns table (
  id       uuid,
  name     text,
  kind     public.source_kind,
  homepage text,
  is_own   boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select s.id, s.name, s.kind, s.homepage,
         exists (
           select 1 from public.user_custom_sources u
            where u.source_id = s.id and u.user_id = p_user_id and u.active
         ) as is_own
    from public.sources s
   where s.active
     and (
       s.listed
       or exists (
         select 1 from public.user_custom_sources u
          where u.source_id = s.id and u.user_id = p_user_id and u.active
       )
     )
     and p_query is not null
     and length(btrim(p_query)) >= 2
     and s.name ilike '%' || btrim(p_query) || '%'
   order by is_own desc, s.name
   limit greatest(0, least(coalesce(p_limit, 40), 100));
$fn$;

-- Both are security definer so they can read `user_topics` and
-- `user_custom_sources` without depending on the caller's policies, and both
-- take the user id as an argument -- so they are only safe when the caller has
-- already been authenticated. That is the service role, after `signedInOnly`
-- has verified the token. 0036's lesson applies: name PUBLIC explicitly, or the
-- default grant survives and the revoke is decorative.
revoke all on function public.reader_sources(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reader_sources(uuid, integer, integer) to service_role;

revoke all on function public.search_reader_sources(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_reader_sources(uuid, text, integer) to service_role;
