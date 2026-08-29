-- nyuz — source→topic mapping for sources added since 0006/0019
--
-- 0019 mapped the 64 sources known from 0006. The live database now has 87 —
-- 23 more were added since, covering general news rather than technology
-- (Guardian/BBC/NPR sections, ESPN, Pitchfork), alongside new topics
-- (politics, world, sports, film, music, health, economy, climate) that
-- 0006/0009 predate. This migration maps the 19 of those 23 that are live,
-- working feeds. Confidence follows the same primary/secondary convention as
-- 0019: 1.0 for what a feed is centrally about, lower for what it also
-- touches.
--
-- ---------------------------------------------------------------------------
-- The four sources NOT mapped here, on purpose
-- ---------------------------------------------------------------------------
--
-- Anthropic (rss.xml), Meta AI (blog/rss/), Andreessen Horowitz (feed/), and
-- Google Project Zero (feeds/posts/default) all exist as rows in `sources`
-- but were verified dead or wrong on the date this migration was written:
-- the first three return HTTP 404, unchanged since 0006's comments recorded
-- the same failure; the fourth redirects to the 12.9MB feed 0006 specifically
-- moved away from in favour of `feeds/posts/summary?max-results=25`, which
-- is already a separate, working, already-mapped row.
--
-- Mapping a dead source to a topic would make it look like real coverage in
-- the admin Demand column when it produces nothing. They are left out of
-- `source_topics` and out of `coverage_mode` changes; disabling them (or
-- fixing Anthropic's URL, if a working one is ever found — it has none as of
-- this migration, per docs/plan.md's repeated note on the gap) is an admin
-- console action, not a migration.

insert into public.source_topics (source_id, topic_id, confidence)
select s.id, t.id, x.confidence
from (values
  ('https://www.theguardian.com/politics/rss',                    'politics', 1.0),
  ('https://www.theguardian.com/uk/sport/rss',                    'sports',   1.0),
  ('https://feeds.bbci.co.uk/news/science_and_environment/rss.xml','climate',  0.5),
  ('https://feeds.bbci.co.uk/news/politics/rss.xml',               'politics', 1.0),
  ('https://www.espn.com/espn/rss/news',                           'sports',   1.0),
  ('https://feeds.bbci.co.uk/news/world/rss.xml',                  'world',    1.0),
  ('https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'film',     0.6),
  ('https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'music',    0.6),
  ('https://www.theguardian.com/world/rss',                       'world',    1.0),
  ('https://feeds.bbci.co.uk/sport/rss.xml',                       'sports',   1.0),
  ('https://feeds.bbci.co.uk/news/business/rss.xml',               'economy',  1.0),
  ('https://feeds.bbci.co.uk/news/health/rss.xml',                 'health',   1.0),
  ('https://feeds.npr.org/1128/rss.xml',                           'health',   1.0),
  ('https://feeds.npr.org/1001/rss.xml',                           'world',    0.6),
  ('https://feeds.npr.org/1004/rss.xml',                           'world',    1.0),
  ('https://pitchfork.com/feed/feed-news/rss',                     'music',    1.0),
  ('https://www.theguardian.com/business/rss',                    'economy',  1.0),
  ('https://www.theguardian.com/environment/rss',                 'climate',  1.0),
  ('https://www.theguardian.com/music/rss',                       'music',    1.0),
  ('https://www.theguardian.com/film/rss',                        'film',     1.0)
) as x(feed_url, slug, confidence)
join public.sources s on s.feed_url = x.feed_url
join public.topics  t on t.slug     = x.slug
on conflict (source_id, topic_id) do nothing;
