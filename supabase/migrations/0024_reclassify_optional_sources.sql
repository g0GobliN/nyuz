-- nyuz -- reclassify clearly-optional sources from core to demand
--
-- 0018 marked all 87 then-existing sources `core`, correctly, to preserve
-- behaviour while the graph was empty. Measured against the real backlog
-- (docs/track.md, "the demand gate's real impact, measured"), a handful of
-- high-volume sources account for a disproportionate share of it while
-- reaching almost no current reader -- dominated by four of the five arXiv
-- research feeds (cs.LG, cs.RO, cs.CR, cs.CL: 417 of 1,000 sampled pending
-- events between them, one interested reader each; cs.AI reclassified here
-- too for editorial consistency, though it did not rank in that top 20)
-- plus sport and entertainment coverage.
--
-- These are reclassified here because they are content a reader opts into
-- rather than a baseline editorial commitment, unlike security advisories
-- (CISA, BleepingComputer, Ars Technica -- left `core`, consistent with this
-- project's treatment of security content as high-value regardless of
-- subscriber count) or general world/politics/business/environment/science
-- coverage, which is left `core` pending an actual product decision about
-- whether the general-news expansion is meant to be baseline coverage.
--
-- Reclassifying to `demand` does not disable or delete anything. It changes
-- nothing about collection today (adaptive polling, phase 6, is not built),
-- and it only changes analysis behaviour once `pre_analysis_demand_gate` is
-- turned on -- still off as of this migration. It only means: once that flag
-- is on, these sources' events are analysed when a reader's interests
-- reach them, not unconditionally.

update public.sources
set coverage_mode = 'demand'
where feed_url in (
  'https://export.arxiv.org/rss/cs.AI',
  'https://export.arxiv.org/rss/cs.LG',
  'https://export.arxiv.org/rss/cs.CL',
  'https://export.arxiv.org/rss/cs.RO',
  'https://export.arxiv.org/rss/cs.CR',
  'https://www.espn.com/espn/rss/news',
  'https://feeds.bbci.co.uk/sport/rss.xml',
  'https://www.theguardian.com/uk/sport/rss',
  'https://pitchfork.com/feed/feed-news/rss',
  'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'
);
