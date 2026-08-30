-- nyuz — first-pass source→topic mapping
--
-- Fills `source_topics` (0018) for the 64 active feeds seeded in 0006, using
-- the same groupings that file's own comments already describe (AI labs,
-- security, chips, gaming, robotics, and so on). This is a first pass, not an
-- editorial verdict — confidence is a rough primary/secondary split (1.0 for
-- what a source is mainly about, lower for what it also covers), and every
-- row is editable from the admin console once that page exists
-- (docs/track.md phase 3/4).
--
-- Still inert. Nothing reads `source_topics` yet — this is data for the
-- demand-visibility step to compute against, not a behaviour change.
--
-- Re-runnable: `on conflict do nothing`, keyed on the table's own primary key.
-- A source or topic that does not exist (migration order, or a feed an
-- operator has since removed) is silently skipped by the join rather than
-- failing the whole statement.
--
-- One deliberate omission: nothing here is mapped to 'anthropic'. No active
-- source has that as more than incidental coverage — Anthropic's own feed is
-- the dead one recorded in 0006's comments — and mapping an unrelated source
-- to it would misrepresent a real coverage gap as a covered topic.

insert into public.source_topics (source_id, topic_id, confidence)
select s.id, t.id, x.confidence
from (values
  -- --- AI labs and platform companies --------------------------------------
  ('https://openai.com/news/rss.xml',                                          'openai',           1.0),
  ('https://openai.com/news/rss.xml',                                          'ai',               0.8),
  ('https://deepmind.google/blog/rss.xml',                                     'ai',               1.0),
  ('https://research.google/blog/rss/',                                       'ai',               1.0),
  ('https://engineering.fb.com/feed/',                                        'developer-tools',  0.8),
  ('https://engineering.fb.com/feed/',                                        'ai',               0.6),
  ('https://www.microsoft.com/en-us/research/feed/',                          'ai',               1.0),
  ('https://huggingface.co/blog/feed.xml',                                    'ai',               1.0),
  ('https://huggingface.co/blog/feed.xml',                                    'open-source',      0.7),
  ('https://blogs.nvidia.com/feed/',                                          'nvidia',           1.0),
  ('https://blogs.nvidia.com/feed/',                                          'chips',            0.8),
  ('https://blogs.nvidia.com/feed/',                                          'ai',               0.6),
  ('https://machinelearning.apple.com/rss.xml',                               'ai',               1.0),
  ('https://aws.amazon.com/blogs/aws/feed/',                                  'developer-tools',  0.8),
  ('https://blog.cloudflare.com/rss/',                                        'developer-tools',  0.8),
  ('https://blog.cloudflare.com/rss/',                                        'cybersecurity',    0.5),
  ('https://github.blog/feed/',                                               'developer-tools',  1.0),
  ('https://github.blog/feed/',                                               'open-source',      0.6),
  ('https://stripe.com/blog/feed.rss',                                        'startups',         0.6),
  ('https://stripe.com/blog/feed.rss',                                        'developer-tools',  0.6),
  ('https://netflixtechblog.com/feed',                                        'developer-tools',  0.8),
  ('https://hacks.mozilla.org/feed/',                                         'developer-tools',  0.8),
  ('https://hacks.mozilla.org/feed/',                                         'open-source',      0.6),
  ('https://android-developers.googleblog.com/feeds/posts/default',           'developer-tools',  0.8),

  -- --- Technology news -------------------------------------------------------
  ('https://techcrunch.com/feed/',                                            'startups',         0.7),
  ('https://techcrunch.com/feed/',                                            'ai',               0.6),
  ('https://techcrunch.com/feed/',                                            'funding',          0.6),
  ('https://techcrunch.com/feed/',                                            'consumer-tech',    0.5),
  ('https://www.theverge.com/rss/index.xml',                                  'consumer-tech',    0.8),
  ('https://www.theverge.com/rss/index.xml',                                  'ai',               0.5),
  ('https://feeds.arstechnica.com/arstechnica/index',                         'consumer-tech',    0.7),
  ('https://feeds.arstechnica.com/arstechnica/index',                         'cybersecurity',    0.5),
  ('https://news.ycombinator.com/rss',                                        'developer-tools',  0.7),
  ('https://news.ycombinator.com/rss',                                        'startups',         0.6),
  ('https://news.ycombinator.com/rss',                                        'ai',               0.5),
  ('https://venturebeat.com/feed/',                                           'ai',               0.6),
  ('https://venturebeat.com/feed/',                                           'startups',         0.6),
  ('https://venturebeat.com/feed/',                                           'funding',          0.5),
  ('https://www.wired.com/feed/rss',                                          'consumer-tech',    0.7),
  ('https://www.technologyreview.com/feed/',                                  'ai',               0.8),
  ('https://www.engadget.com/rss.xml',                                        'consumer-tech',    0.8),
  ('https://www.theregister.com/headlines.atom',                              'cybersecurity',    0.6),
  ('https://www.theregister.com/headlines.atom',                              'hardware',         0.5),
  ('https://www.techradar.com/rss/news/pro',                                  'consumer-tech',    0.6),
  ('https://www.techradar.com/rss/news/pro',                                  'hardware',         0.5),

  -- --- Analysis ----------------------------------------------------------
  ('https://stratechery.com/feed/',                                           'ai',               0.5),
  ('https://stratechery.com/feed/',                                           'startups',         0.5),
  ('https://www.semianalysis.com/feed',                                       'chips',            1.0),
  ('https://www.semianalysis.com/feed',                                       'hardware',         0.7),
  ('https://simonwillison.net/atom/everything/',                              'ai',               0.7),
  ('https://simonwillison.net/atom/everything/',                              'developer-tools',  0.6),
  ('https://importai.substack.com/feed',                                      'ai',               1.0),

  -- --- Security ------------------------------------------------------------
  ('https://krebsonsecurity.com/feed/',                                       'cybersecurity',    1.0),
  ('https://www.bleepingcomputer.com/feed/',                                  'cybersecurity',    1.0),
  ('https://feeds.feedburner.com/TheHackersNews',                             'cybersecurity',    1.0),
  ('https://googleprojectzero.blogspot.com/feeds/posts/summary?max-results=25','cybersecurity',   1.0),
  ('https://www.schneier.com/feed/atom/',                                     'cybersecurity',    1.0),
  ('https://www.cisa.gov/cybersecurity-advisories/all.xml',                   'cybersecurity',    1.0),

  -- --- Chips and hardware --------------------------------------------------
  ('https://www.tomshardware.com/feeds/all',                                  'hardware',         1.0),
  ('https://www.tomshardware.com/feeds/all',                                  'chips',            0.6),
  ('https://www.phoronix.com/rss.php',                                        'linux',            0.8),
  ('https://www.phoronix.com/rss.php',                                        'hardware',         0.6),

  -- --- Startups and funding ------------------------------------------------
  ('https://www.ycombinator.com/blog/rss',                                    'startups',         1.0),
  ('https://www.ycombinator.com/blog/rss',                                    'funding',          0.5),
  ('https://news.crunchbase.com/feed/',                                       'funding',          1.0),
  ('https://news.crunchbase.com/feed/',                                       'startups',         0.6),

  -- --- Gaming ----------------------------------------------------------------
  ('https://www.polygon.com/rss/index.xml',                                   'gaming',           1.0),
  ('https://www.eurogamer.net/feed',                                          'gaming',           1.0),
  ('https://www.rockpapershotgun.com/feed',                                   'gaming',           1.0),

  -- --- Robotics --------------------------------------------------------------
  ('https://spectrum.ieee.org/feeds/topic/robotics.rss',                      'robotics',         1.0),
  ('https://www.therobotreport.com/feed/',                                    'robotics',         1.0),

  -- --- Research ----------------------------------------------------------
  ('https://export.arxiv.org/rss/cs.AI',                                      'ai',               1.0),
  ('https://export.arxiv.org/rss/cs.LG',                                      'ai',               1.0),
  ('https://export.arxiv.org/rss/cs.CL',                                      'ai',               1.0),
  ('https://export.arxiv.org/rss/cs.RO',                                      'robotics',         0.8),
  ('https://export.arxiv.org/rss/cs.RO',                                      'ai',               0.5),
  ('https://export.arxiv.org/rss/cs.CR',                                      'cybersecurity',    0.7),
  ('https://export.arxiv.org/rss/cs.CR',                                      'ai',               0.4),
  ('https://bair.berkeley.edu/blog/feed.xml',                                 'ai',               1.0),

  -- --- Release feeds -----------------------------------------------------
  ('https://github.com/facebook/react/releases.atom',                        'react',            1.0),
  ('https://github.com/facebook/react/releases.atom',                        'developer-tools',  0.5),
  ('https://github.com/microsoft/TypeScript/releases.atom',                  'typescript',       1.0),
  ('https://github.com/microsoft/TypeScript/releases.atom',                  'developer-tools',  0.5),
  ('https://github.com/vercel/next.js/releases.atom',                        'next-js',          1.0),
  ('https://github.com/vercel/next.js/releases.atom',                        'developer-tools',  0.5),
  ('https://github.com/nodejs/node/releases.atom',                           'developer-tools',  0.8),
  ('https://github.com/oven-sh/bun/releases.atom',                           'developer-tools',  0.8),
  ('https://github.com/denoland/deno/releases.atom',                         'developer-tools',  0.8),
  ('https://github.com/vitejs/vite/releases.atom',                           'developer-tools',  0.8),
  ('https://github.com/tailwindlabs/tailwindcss/releases.atom',              'developer-tools',  0.8),
  ('https://pytorch.org/blog/feed/',                                         'ai',               1.0),
  ('https://pytorch.org/blog/feed/',                                         'open-source',      0.6),
  ('https://github.com/vllm-project/vllm/releases.atom',                     'ai',               0.8),
  ('https://github.com/vllm-project/vllm/releases.atom',                     'developer-tools',  0.6),
  ('https://github.com/ggml-org/llama.cpp/releases.atom',                    'ai',               0.8),
  ('https://github.com/ggml-org/llama.cpp/releases.atom',                    'open-source',      0.6),
  ('https://github.com/supabase/supabase/releases.atom',                     'developer-tools',  0.8),
  ('https://github.com/supabase/supabase/releases.atom',                     'open-source',      0.5),

  -- --- Product changelogs --------------------------------------------------
  ('https://www.producthunt.com/feed',                                       'startups',         0.6),
  ('https://www.producthunt.com/feed',                                       'consumer-tech',    0.5),
  ('https://cursor.com/changelog/rss.xml',                                   'cursor',           1.0),
  ('https://cursor.com/changelog/rss.xml',                                   'developer-tools',  0.5)
) as x(feed_url, slug, confidence)
join public.sources s on s.feed_url = x.feed_url
join public.topics  t on t.slug     = x.slug
on conflict (source_id, topic_id) do nothing;
