-- nyuz -- applying retitles in one statement instead of one per article
--
-- `updateRetitled` in ingest.ts did two round-trip loops per run. First it read
-- the stored `content_hash` for every URL in the batch, chunked into several
-- requests because a `url=in.(…)` filter travels in the request line and
-- overflows (see URL_FILTER_BUDGET). Then it issued one UPDATE per article
-- whose hash had moved.
--
-- Neither loop is expensive in isolation, and retitles are usually a handful
-- per run. The reason to collapse them anyway is the runtime: on Cloudflare
-- Workers every one of those is a subrequest against a per-invocation cap, and
-- the burst case — a live story whose headline is being sharpened across many
-- of the sixty-odd sources at once — is exactly when ingest is already doing
-- the most work. A stage that gets less reliable precisely when the news is
-- busiest is the wrong shape.
--
-- ---------------------------------------------------------------------------
-- Why the comparison moved into SQL
-- ---------------------------------------------------------------------------
--
-- The read loop existed only to answer "which of these actually changed". That
-- is a question Postgres can answer while doing the update, so `is distinct
-- from` below replaces the whole first loop rather than just batching it. The
-- caller no longer needs the stored hashes at all.
--
-- `is distinct from` rather than `<>`: a stored null hash on a legacy row must
-- count as changed, and `null <> 'abc'` is null, which would silently skip it.
--
-- The `event_id is null` guard is carried over unchanged and is the load-bearing
-- part. Rewriting the title of an article an event was built from would leave
-- that event's analysis describing text that is no longer there, and
-- re-analysing to repair it would break the property the product is priced on:
-- an event is understood once. Before clustering a better title is a better
-- input; after it, the event is the record and the article is history.
--
-- Passing rows as jsonb in the body also retires the URL-length problem the
-- read loop was chunked around: a POST body has no request-line limit.

create or replace function public.update_retitled_articles(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  changed integer;
begin
  with incoming as (
    select
      r ->> 'url'          as url,
      r ->> 'title'        as title,
      r ->> 'excerpt'      as excerpt,
      r ->> 'author'       as author,
      r ->> 'content_hash' as content_hash
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
    where r ->> 'url' is not null
  ),
  updated as (
    update public.articles a
       set title        = i.title,
           excerpt      = i.excerpt,
           author       = i.author,
           content_hash = i.content_hash
      from incoming i
     where a.url = i.url
       and a.event_id is null
       and a.content_hash is distinct from i.content_hash
    returning 1
  )
  select count(*) into changed from updated;

  return coalesce(changed, 0);
end;
$fn$;

-- Writes to a global pipeline table, so it is service-role only. 0036's lesson
-- applies: name PUBLIC explicitly or the default grant survives and the revoke
-- is decorative.
revoke all on function public.update_retitled_articles(jsonb)
  from public, anon, authenticated;
grant execute on function public.update_retitled_articles(jsonb) to service_role;
