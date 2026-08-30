-- nyuz -- disable 4 sources confirmed dead, again
--
-- Anthropic (/rss.xml), Meta AI (/blog/rss/) and Andreessen Horowitz (/feed/)
-- were live-checked on 2026-08-29 and all return HTTP 404 -- the exact same
-- failure 0006's own comments recorded when these three were first disabled,
-- months earlier. Google Project Zero's /feeds/posts/default redirects to
-- the 12.9MB feed 0006 specifically moved away from in favour of
-- /feeds/posts/summary?max-results=25, which is a separate row, already
-- active, already mapped in source_topics (0019).
--
-- These four were re-added at some point after 0006 -- most likely through
-- the admin console's "Add source" form, which validates a URL's shape but
-- does not fetch it, unlike 0006's original seed which was verified with
-- check:feeds before being committed. This migration is that same disabling
-- decision, made the same way 0006 made it: this is not a new judgement, it
-- is re-applying an old one to rows that came back.
--
-- Disable, never delete, matching every other source lifecycle decision in
-- this project -- src/lib/server/sources.ts:
-- "articles.source_id is `on delete set null`, so dropping a source would
-- orphan every article it ever contributed."

update public.sources
set active = false
where feed_url in (
  'https://www.anthropic.com/rss.xml',
  'https://ai.meta.com/blog/rss/',
  'https://a16z.com/feed/',
  'https://googleprojectzero.blogspot.com/feeds/posts/default'
);

insert into public.admin_audit_log (actor_email, action, target_type, target_id, meta)
select
  'migration:0025',
  'source.disable',
  'source',
  s.id::text,
  jsonb_build_object('name', s.name, 'feed_url', s.feed_url, 'reason', 'confirmed 404 or duplicate of a known-oversized feed, re-verified 2026-08-29')
from public.sources s
where s.feed_url in (
  'https://www.anthropic.com/rss.xml',
  'https://ai.meta.com/blog/rss/',
  'https://a16z.com/feed/',
  'https://googleprojectzero.blogspot.com/feeds/posts/default'
);
