-- General-interest topics the landing and onboarding now offer.
--
-- Until this ran, TOPIC_POOL was labs and frameworks. A reader who tapped
-- Sports on the marketing site then found Politics listed under "ignore" and
-- no Music chip at all. The pool is the product: keepCoveredTopics will only
-- persist labels seeded here (or already in 0006).
--
-- Every new topic has at least two feeds. URLs were chosen from outlets that
-- still publish RSS; a 404 here is worse than a missing topic because matching
-- would silently produce empty briefings.
--
-- on conflict do nothing: an operator who already inserted a slug or feed is
-- not overwritten.

insert into public.topics (slug, label) values
  ('world',    'World'),
  ('politics', 'Politics'),
  ('sports',   'Sports'),
  ('music',    'Music'),
  ('film',     'Film'),
  ('climate',  'Climate'),
  ('economy',  'Economy'),
  ('health',   'Health'),
  ('claude',   'Claude')
on conflict (slug) do nothing;

insert into public.sources (name, homepage, feed_url, kind) values
  ('BBC World',       'https://www.bbc.com/news/world',     'https://feeds.bbci.co.uk/news/world/rss.xml',                    'news'),
  ('BBC Politics',    'https://www.bbc.com/news/politics',  'https://feeds.bbci.co.uk/news/politics/rss.xml',                 'news'),
  ('BBC Sport',       'https://www.bbc.com/sport',          'https://feeds.bbci.co.uk/sport/rss.xml',                         'news'),
  ('BBC Business',    'https://www.bbc.com/news/business',  'https://feeds.bbci.co.uk/news/business/rss.xml',                 'news'),
  ('BBC Health',      'https://www.bbc.com/news/health',    'https://feeds.bbci.co.uk/news/health/rss.xml',                   'news'),
  ('BBC Science',     'https://www.bbc.com/news/science_and_environment', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'news'),
  ('BBC Entertainment','https://www.bbc.com/news/entertainment_and_arts', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'news'),
  ('The Guardian World',     'https://www.theguardian.com/world',       'https://www.theguardian.com/world/rss',              'news'),
  ('The Guardian Politics',  'https://www.theguardian.com/politics',    'https://www.theguardian.com/politics/rss',           'news'),
  ('The Guardian Sport',     'https://www.theguardian.com/uk/sport',    'https://www.theguardian.com/uk/sport/rss',           'news'),
  ('The Guardian Music',     'https://www.theguardian.com/music',       'https://www.theguardian.com/music/rss',              'news'),
  ('The Guardian Film',      'https://www.theguardian.com/film',        'https://www.theguardian.com/film/rss',               'news'),
  ('The Guardian Environment','https://www.theguardian.com/environment','https://www.theguardian.com/environment/rss',        'news'),
  ('The Guardian Business',  'https://www.theguardian.com/business',    'https://www.theguardian.com/business/rss',           'news'),
  ('NPR News',        'https://www.npr.org',                'https://feeds.npr.org/1001/rss.xml',                             'news'),
  ('NPR World',       'https://www.npr.org/sections/world', 'https://feeds.npr.org/1004/rss.xml',                             'news'),
  ('NPR Health',      'https://www.npr.org/sections/health','https://feeds.npr.org/1128/rss.xml',                             'news'),
  ('Pitchfork',       'https://pitchfork.com',              'https://pitchfork.com/feed/feed-news/rss',                      'news'),
  ('ESPN',            'https://www.espn.com',               'https://www.espn.com/espn/rss/news',                             'news')
on conflict (feed_url) do nothing;
