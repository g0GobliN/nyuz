-- nyuz — per-source counts for the console
--
-- The source list needs two numbers per feed: how many articles it has ever
-- contributed, and when the newest one was published. Sixty-six sources means
-- sixty-six round trips if the console asks per row, and PostgREST cannot group
-- by, so the grouping lives here — the same reasoning as
-- `admin_daily_counts` in 0003.
--
-- A left join rather than an inner one, deliberately: a freshly added feed that
-- has never been fetched must appear in the list with a count of zero. Inner
-- joining would hide exactly the sources an operator is most likely to be
-- looking for.
--
-- Not granted to anon or authenticated. `listSources` in
-- src/lib/server/sources.ts calls it with the service-role key, after
-- `adminOnly` has established who the caller is.
-- ---------------------------------------------------------------------------

create or replace function public.admin_source_stats()
returns table (
  source_id         uuid,
  article_count     integer,
  latest_article_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    s.id,
    count(a.id)::integer,
    max(coalesce(a.published_at, a.fetched_at))
  from public.sources s
  left join public.articles a on a.source_id = s.id
  group by s.id;
$fn$;

revoke execute on function public.admin_source_stats() from anon, authenticated;
