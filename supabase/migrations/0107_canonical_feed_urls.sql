-- nyuz -- store `sources.feed_url` in the canonical form the app looks it up by
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
--
-- A reader who pasted `https://a16z.com/feed/` -- the exact string the
-- catalogue has held for that outlet since 0006 -- got a second source row for
-- it. Not a rejected duplicate and not an error: a working duplicate.
--
-- `followCustomSource` (src/lib/server/custom-sources.ts) canonicalises the
-- submitted address with `canonicalUrl`, which drops the trailing slash, and
-- then looks the feed up by comparing that canonical string to the stored
-- column. `https://a16z.com/feed` != `https://a16z.com/feed/`, so the lookup
-- found nothing and the code correctly concluded the feed was new.
--
-- `sources.feed_url` is UNIQUE, and it caught nothing, because to Postgres
-- those are two different strings. The unique constraint protects the column
-- against byte-identical repeats; it says nothing about a feed reachable at
-- two spellings.
--
-- What it cost, for one reader, one add:
--
--   - a second row in a table where the whole cost argument is one row per
--     feed, so a second crawler, a second backoff state and a second admin
--     row to reason about,
--   - a follow on the COPY rather than on the curated row, so the reader's
--     source list showed a feed nyuz does not treat as theirs (no topics, no
--     listed flag, `coverage_mode = 'demand'`).
--
-- Only that direction was broken. A reader pasting the UNSLASHED form of a
-- slashed row matched fine, because `canonicalUrl` produced exactly what the
-- catalogue held. The damage was one-directional: it needed the catalogue to
-- hold a slash and the reader to paste the same slash, which is the ordinary
-- case -- the catalogue's own links are where a reader copies from.
--
-- 21 of the 87 rows in the catalogue were in the slashed form when this was
-- written, so this was reachable from roughly a quarter of the catalogue.
--
-- ---------------------------------------------------------------------------
-- WHY THE ROWS LOOKED LIKE THAT
-- ---------------------------------------------------------------------------
--
-- Three writers, one rule between them until now:
--
--   followCustomSource   canonicalUrl()  -- canonical
--   register.ts          canonicalUrl()  -- canonical
--   createSource         whatever the operator pasted   <-- here
--
-- The console's add form validated the URL's SHAPE and stored it verbatim.
-- 0039 says so in as many words: "the console's add form validates a URL's
-- shape and never fetched it". That is exactly the gap: a shape check cannot
-- tell `…/feed` from `…/feed/`, and the seed migration in 0006 was written by
-- hand with trailing slashes the way the publishers' own links have them.
--
-- Both writers now canonicalise, and both look a feed up through
-- `feedUrlVariants` so the lookup is right even for a row this migration
-- does not reach. This statement is the cleanup that makes the table honest
-- today rather than the guard that stops it happening tomorrow.
--
-- ---------------------------------------------------------------------------
-- ONLY THE TRAILING SLASH IS TOUCHED
-- ---------------------------------------------------------------------------
--
-- `canonicalUrl` also removes tracking parameters, AMP suffixes, a default
-- port and a trailing dot on the host. None of those are in this table and
-- none are added here: reproducing the canonicaliser in SQL would be a second
-- implementation of a rule that has a tested one, and the two would drift
-- exactly as the writer and the lookup already had. Every difference this
-- migration can see is a trailing slash, and every one of those feeds was
-- confirmed to still serve its feed at the canonical URL before this was
-- written -- a canonical URL that 404s is not a fix, it is a dead catalogue.
--
-- ---------------------------------------------------------------------------
-- COLLISIONS ARE SKIPPED, NEVER RESOLVED
-- ---------------------------------------------------------------------------
--
-- If a row's canonical form is already taken by another row, this leaves both
-- alone and says so. Merging two sources means moving `source_topics`,
-- `user_custom_sources` and `articles.source_id` across and deciding which row
-- keeps the history -- an operator's call, made in the console, not a side
-- effect of a migration. At the time of writing there are no collisions (0),
-- so this is a guard rather than a known case.
--
-- Safe to re-run: a second pass finds nothing left to do.

begin;

do $$
declare
  rewritten integer;
begin
  update public.sources s
     set feed_url = regexp_replace(s.feed_url, '/+$', '')
   where s.feed_url ~ '/+$'
     -- `https://example.com/` is root, and root has no trailing slash to
     -- remove: strip it to the bare origin, which is the same page.
     and s.feed_url <> regexp_replace(s.feed_url, '/+$', '')
     and not exists (
       select 1 from public.sources t
        where t.id <> s.id
          and t.feed_url = regexp_replace(s.feed_url, '/+$', '')
     );

  get diagnostics rewritten = row_count;
  raise notice 'canonicalised % source feed url(s)', rewritten;
end
$$;

-- What was deliberately left, so the skip is visible rather than silent.
do $$
declare
  skipped text;
begin
  select string_agg(feed_url, ', ')
    into skipped
    from public.sources s
   where s.feed_url ~ '/+$'
     and exists (
       select 1 from public.sources t
        where t.id <> s.id
          and t.feed_url = regexp_replace(s.feed_url, '/+$', '')
     );

  if skipped is not null then
    raise notice 'left alone (canonical form already held by another row): %', skipped;
  end if;
end
$$;

commit;