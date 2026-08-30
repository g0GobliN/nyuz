-- nyuz -- complete the core/demand split for general news and security
--
-- 0024 reclassified the confident subset (arXiv, sport, entertainment). This
-- migration completes the remaining sources that were deliberately left for
-- a product-positioning call: the rest of the general-news expansion
-- (politics, world, business, health, environment, science across
-- BBC/Guardian/NPR) and the security feeds (CISA, BleepingComputer, Ars
-- Technica).
--
-- The reasoning that changed: `core` in this schema means "deliberately
-- curated bootstrap coverage" -- the original 64 sources in 0006, chosen
-- because a personalised-briefing product needs baseline event discovery to
-- match against before any reader exists. It does not mean "important." The
-- product's own stated philosophy (docs/product-brief.md: "Less
-- information. More relevance. Zero searching," "NOT a generic news
-- aggregator") is personalisation-first everywhere else in this system --
-- every topic a reader sees is one they chose. There is no existing
-- mechanism, and no documented decision, that makes source-level breadth
-- (as opposed to reader-chosen topics) exempt from that. Security content
-- reaching a reader who cares is still governed by the same importance
-- score and breaking-alert threshold either way; `core` status does not
-- change that path, only whether the event is pre-analysed before someone
-- asks.
--
-- The original 64 technology sources (OpenAI, DeepMind, TechCrunch, and so
-- on) are NOT touched here and remain `core` -- they are this product's
-- founding identity, not an open question.

update public.sources
set coverage_mode = 'demand'
where feed_url in (
  'https://www.theguardian.com/politics/rss',
  'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  'https://feeds.bbci.co.uk/news/politics/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://www.theguardian.com/world/rss',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://feeds.bbci.co.uk/news/health/rss.xml',
  'https://feeds.npr.org/1128/rss.xml',
  'https://feeds.npr.org/1001/rss.xml',
  'https://feeds.npr.org/1004/rss.xml',
  'https://www.theguardian.com/business/rss',
  'https://www.theguardian.com/environment/rss',
  'https://www.theguardian.com/music/rss',
  'https://www.theguardian.com/film/rss',
  'https://www.cisa.gov/cybersecurity-advisories/all.xml',
  'https://www.bleepingcomputer.com/feed/',
  'https://feeds.arstechnica.com/arstechnica/index'
);
