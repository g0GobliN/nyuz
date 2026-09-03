-- nyuz -- totals counted by Postgres instead of by the console
--
-- `sumTokens` and `sumBlogViews` in analytics.ts selected rows and added them up
-- in JavaScript, under a `limit`. That works and is wrong in a specific way: the
-- limit does not error, it truncates. Past ten thousand analysed events the
-- console's "analysis tokens" figure silently stops growing, and the number an
-- operator uses to decide whether AI spend is under control becomes a floor
-- wearing the clothes of a total. Nothing on the page says so.
--
-- It is also the wrong work to do over a wire: three columns of every row are
-- transferred to add them, so the cost grows with the corpus for an answer that
-- is one number.
--
-- Postgres can produce all four figures in one statement over indexed columns,
-- which is both exact and cheaper. `coalesce` because `sum()` over no rows is
-- null, and a null here would surface as "NaN tokens" on the overview.

create or replace function public.admin_usage_totals()
returns table (
  analysis_tokens   bigint,
  generation_tokens bigint,
  analysed_events   bigint,
  blog_views        bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    coalesce((select sum(analysis_tokens)   from public.events   where analysis_tokens   > 0), 0),
    coalesce((select sum(generation_tokens) from public.digests  where generation_tokens > 0), 0),
    coalesce((select count(*)               from public.events   where analysis_tokens   > 0), 0),
    coalesce((select sum(view_count)        from public.blog_posts), 0);
$fn$;

-- Console-only, and it reads across every reader's digests. Service role only.
-- 0036's lesson applies: name PUBLIC explicitly or the default grant survives.
revoke all on function public.admin_usage_totals()
  from public, anon, authenticated;
grant execute on function public.admin_usage_totals() to service_role;
