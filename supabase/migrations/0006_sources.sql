-- nyuz — the feeds, and the shared topic vocabulary
--
-- Until this migration ran, `sources` and `topics` were empty and the pipeline
-- had nothing to watch. Every table it needs has existed since 0001; none had
-- ever been filled. This is the first half of turning a dashboard of fixtures
-- into a briefing built from real news, and it costs nothing to run: no model
-- calls, no network, just rows.
--
-- ---------------------------------------------------------------------------
-- Re-runnability
-- ---------------------------------------------------------------------------
--
-- Both inserts end in `on conflict do nothing`, keyed on the natural unique
-- column each table already has — `sources.feed_url` and `topics.slug`. That
-- makes this safe to run twice, and safe to run after an operator has disabled
-- a feed from the console: a second run will NOT reactivate a source somebody
-- deliberately turned off, because the conflicting row is skipped entirely
-- rather than updated.
--
-- The consequence worth stating: correcting a URL in this file does not fix an
-- existing row. Dead feeds are pruned through the console or by the ingester's
-- own backoff, not by editing history here.
--
-- ---------------------------------------------------------------------------
-- On the topic seed
-- ---------------------------------------------------------------------------
--
-- `topics` is a SHARED table and that is the entire cost argument — two readers
-- following "OpenAI" must point at one row so an event is analysed once and
-- serves both. `replaceTopics()` in src/lib/server/preferences.ts already
-- creates topics on demand as readers pick them, so this seed is not strictly
-- required for correctness.
--
-- It is here because the labels in `TOPIC_POOL` are the ones onboarding
-- actually offers, and seeding them means stage 4 can link `event_topics`
-- against a stable vocabulary on the very first run — before any reader has
-- signed up. Without it the first event analysed would invent its own topic
-- rows and the pool would fragment.
--
-- The slugs below MUST match `topicSlug()` in src/lib/preferences-map.ts
-- exactly: lowercase, combining marks stripped, every run of non-alphanumerics
-- collapsed to a single hyphen. If they drift, a reader picking "Next.js" from
-- the pool creates a second row and the sharing quietly stops working. That is
-- why "Next.js" is 'next-js' here and not 'nextjs'.
-- ---------------------------------------------------------------------------

insert into public.topics (slug, label) values
  ('ai',            'AI'),
  ('openai',        'OpenAI'),
  ('anthropic',     'Anthropic'),
  ('nvidia',        'NVIDIA'),
  ('cursor',        'Cursor'),
  ('react',         'React'),
  ('next-js',       'Next.js'),
  ('typescript',    'TypeScript'),
  ('startups',      'Startups'),
  ('cybersecurity', 'Cybersecurity'),
  ('gaming',        'Gaming'),
  ('funding',       'Funding'),
  ('chips',         'Chips'),
  ('open-source',      'Open source'),
  ('robotics',         'Robotics'),
  ('linux',            'Linux'),
  ('hardware',         'Hardware'),
  ('developer-tools',  'Developer tools'),
  ('consumer-tech',    'Consumer tech')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- The feeds
-- ---------------------------------------------------------------------------
--
-- Coverage is chosen against `TOPIC_POOL`, because a reader who picks a topic
-- onboarding offered and then receives nothing has been mis-sold. Every seeded
-- topic above has at least two sources that plausibly cover it, except the four
-- added later in 0009 (Linux, hardware, developer tools, consumer tech), which
-- reuse existing feeds rather than adding new ones.
--
-- What this does NOT solve: onboarding also accepts free text, so a reader can
-- still ask for something no feed here covers. That gap is a product decision
-- recorded in docs/status.md, and it becomes real the moment these rows exist.
-- The honest behaviour is an empty briefing that says so, which is what the
-- matching stage does.
--
-- `kind` is used for weighting later, not for parsing — every row below is RSS
-- or Atom and the parser sniffs which. The distinction that matters:
--
--   company_blog  the primary source. An announcement here is the event; a
--                 news article about it is coverage OF the event. Clustering
--                 leans on this to pick which article titles an event by.
--   news          secondary coverage. High volume, high duplication.
--   research      papers. Slow, low novelty individually, occasionally major.
--   github        release feeds. Structurally clean, very high volume.
--   product       changelogs. Small announcements that matter to users of one
--                 tool and to nobody else.
--   rss           a feed that is none of the above.
--
-- Every URL below was fetched and parsed on 2026-08-23 by `npm run check:feeds`,
-- which uses the same fetcher and parser the ingester does. All of them returned a
-- feed that parsed. Three that did not are gone from this list rather than left in
-- to fail quietly:
--
--   Anthropic            https://www.anthropic.com/rss.xml       404
--   Meta AI              https://ai.meta.com/blog/rss/           404
--   Andreessen Horowitz  https://a16z.com/feed/                  404
--
-- None of the three publishes a feed any more — no `<link rel="alternate">` on
-- their index pages, and every conventional path (/feed, /rss.xml, /news/rss.xml,
-- /sitemap.xml) answers with the site's 404 page. Anthropic is the loss worth
-- naming: the 'anthropic' topic is in TOPIC_POOL and now has no primary source, so
-- an Anthropic announcement reaches a reader as somebody else's coverage of it
-- rather than as the announcement. Meta Engineering below replaces Meta AI in the
-- company_blog slot; a16z's absence leaves 'funding' to Crunchbase News and
-- TechCrunch, which is thinner but not empty.
--
-- Two entries carry a query string for a reason, and it is not cosmetic. Blogger
-- serves the full post body and the entire archive by default: Project Zero's
-- `feeds/posts/default` is 12.9MB, which is over the fetcher's 2MB ceiling and
-- would have been dropped on every run. `feeds/posts/summary?max-results=25` is
-- 15KB of the same articles.
--
-- What a green check does not promise: that a feed keeps working, or that it is
-- still being updated. Several parse perfectly and have published nothing for
-- months. The ingester's failure backoff deactivates anything that starts
-- 404ing, so a stale entry degrades quietly instead of breaking a run.
-- ---------------------------------------------------------------------------

insert into public.sources (name, homepage, feed_url, kind) values
  -- --- Primary sources: AI labs and platform companies --------------------
  ('OpenAI',                  'https://openai.com',                  'https://openai.com/news/rss.xml',                                  'company_blog'),
  ('Google DeepMind',         'https://deepmind.google',             'https://deepmind.google/blog/rss.xml',                              'company_blog'),
  ('Google Research',         'https://research.google',             'https://research.google/blog/rss/',                                 'company_blog'),
  ('Meta Engineering',        'https://engineering.fb.com',          'https://engineering.fb.com/feed/',                                  'company_blog'),
  ('Microsoft Research',      'https://www.microsoft.com/research',  'https://www.microsoft.com/en-us/research/feed/',                    'company_blog'),
  ('Hugging Face',            'https://huggingface.co',              'https://huggingface.co/blog/feed.xml',                              'company_blog'),
  ('NVIDIA Blog',             'https://blogs.nvidia.com',            'https://blogs.nvidia.com/feed/',                                    'company_blog'),
  ('Apple Machine Learning',  'https://machinelearning.apple.com',   'https://machinelearning.apple.com/rss.xml',                         'company_blog'),
  ('AWS News',                'https://aws.amazon.com',              'https://aws.amazon.com/blogs/aws/feed/',                            'company_blog'),
  ('Cloudflare',              'https://blog.cloudflare.com',         'https://blog.cloudflare.com/rss/',                                  'company_blog'),
  ('GitHub',                  'https://github.blog',                'https://github.blog/feed/',                                         'company_blog'),
  ('Stripe',                  'https://stripe.com/blog',             'https://stripe.com/blog/feed.rss',                                  'company_blog'),
  ('Netflix Technology',      'https://netflixtechblog.com',         'https://netflixtechblog.com/feed',                                  'company_blog'),
  ('Mozilla Hacks',           'https://hacks.mozilla.org',           'https://hacks.mozilla.org/feed/',                                   'company_blog'),
  ('Android Developers',      'https://android-developers.googleblog.com', 'https://android-developers.googleblog.com/feeds/posts/default', 'company_blog'),

  -- --- Technology news ----------------------------------------------------
  ('TechCrunch',              'https://techcrunch.com',              'https://techcrunch.com/feed/',                                      'news'),
  ('The Verge',               'https://www.theverge.com',            'https://www.theverge.com/rss/index.xml',                            'news'),
  ('Ars Technica',            'https://arstechnica.com',             'https://feeds.arstechnica.com/arstechnica/index',                   'news'),
  ('Hacker News',             'https://news.ycombinator.com',        'https://news.ycombinator.com/rss',                                  'news'),
  ('VentureBeat',             'https://venturebeat.com',             'https://venturebeat.com/feed/',                                     'news'),
  ('Wired',                   'https://www.wired.com',               'https://www.wired.com/feed/rss',                                    'news'),
  ('MIT Technology Review',   'https://www.technologyreview.com',    'https://www.technologyreview.com/feed/',                             'news'),
  ('Engadget',                'https://www.engadget.com',            'https://www.engadget.com/rss.xml',                                  'news'),
  ('The Register',            'https://www.theregister.com',         'https://www.theregister.com/headlines.atom',                        'news'),
  ('TechRadar Pro',           'https://www.techradar.com',           'https://www.techradar.com/rss/news/pro',                            'news'),

  -- --- Analysis. Lower volume, higher signal, strong on chips and funding --
  ('Stratechery',             'https://stratechery.com',             'https://stratechery.com/feed/',                                     'rss'),
  ('SemiAnalysis',            'https://www.semianalysis.com',        'https://www.semianalysis.com/feed',                                 'rss'),
  ('Simon Willison',          'https://simonwillison.net',           'https://simonwillison.net/atom/everything/',                        'rss'),
  ('Import AI',               'https://importai.substack.com',       'https://importai.substack.com/feed',                                'rss'),

  -- --- Security -----------------------------------------------------------
  ('Krebs on Security',       'https://krebsonsecurity.com',         'https://krebsonsecurity.com/feed/',                                 'news'),
  ('BleepingComputer',        'https://www.bleepingcomputer.com',    'https://www.bleepingcomputer.com/feed/',                            'news'),
  ('The Hacker News',         'https://thehackernews.com',           'https://feeds.feedburner.com/TheHackersNews',                       'news'),
  ('Google Project Zero',     'https://googleprojectzero.blogspot.com', 'https://googleprojectzero.blogspot.com/feeds/posts/summary?max-results=25', 'research'),
  ('Schneier on Security',    'https://www.schneier.com',            'https://www.schneier.com/feed/atom/',                               'rss'),
  ('CISA Advisories',         'https://www.cisa.gov',                'https://www.cisa.gov/cybersecurity-advisories/all.xml',              'news'),

  -- --- Chips and hardware -------------------------------------------------
  ('Tom''s Hardware',         'https://www.tomshardware.com',        'https://www.tomshardware.com/feeds/all',                            'news'),
  ('Phoronix',                'https://www.phoronix.com',            'https://www.phoronix.com/rss.php',                                  'news'),

  -- --- Startups and funding -----------------------------------------------
  ('Y Combinator',            'https://www.ycombinator.com',         'https://www.ycombinator.com/blog/rss',                              'company_blog'),
  ('Crunchbase News',         'https://news.crunchbase.com',         'https://news.crunchbase.com/feed/',                                 'news'),

  -- --- Gaming -------------------------------------------------------------
  ('Polygon',                 'https://www.polygon.com',             'https://www.polygon.com/rss/index.xml',                             'news'),
  ('Eurogamer',               'https://www.eurogamer.net',           'https://www.eurogamer.net/feed',                                    'news'),
  ('Rock Paper Shotgun',      'https://www.rockpapershotgun.com',    'https://www.rockpapershotgun.com/feed',                             'news'),

  -- --- Robotics -----------------------------------------------------------
  ('IEEE Spectrum Robotics',  'https://spectrum.ieee.org',           'https://spectrum.ieee.org/feeds/topic/robotics.rss',                'news'),
  ('The Robot Report',        'https://www.therobotreport.com',      'https://www.therobotreport.com/feed/',                               'news'),

  -- --- Research. arXiv is deliberately narrow: five categories that map to
  -- --- the pool, not the firehose. cs.AI alone runs to hundreds a day.
  -- ---
  -- --- All five declare <skipDays>Saturday, Sunday</skipDays> and serve a valid
  -- --- channel with zero items at the weekend. That is not a broken feed and
  -- --- must not be treated as one: check:feeds reads skipDays, and the ingester
  -- --- does not count an empty feed as a failure.
  ('arXiv cs.AI',             'https://arxiv.org/list/cs.AI/recent', 'https://export.arxiv.org/rss/cs.AI',                                'research'),
  ('arXiv cs.LG',             'https://arxiv.org/list/cs.LG/recent', 'https://export.arxiv.org/rss/cs.LG',                                'research'),
  ('arXiv cs.CL',             'https://arxiv.org/list/cs.CL/recent', 'https://export.arxiv.org/rss/cs.CL',                                'research'),
  ('arXiv cs.RO',             'https://arxiv.org/list/cs.RO/recent', 'https://export.arxiv.org/rss/cs.RO',                                'research'),
  ('arXiv cs.CR',             'https://arxiv.org/list/cs.CR/recent', 'https://export.arxiv.org/rss/cs.CR',                                'research'),
  ('Berkeley AI Research',    'https://bair.berkeley.edu/blog',      'https://bair.berkeley.edu/blog/feed.xml',                            'research'),

  -- --- Release feeds. GitHub serves Atom at <repo>/releases.atom, which is
  -- --- the cleanest structured signal available for the tooling topics.
  ('React releases',          'https://github.com/facebook/react',        'https://github.com/facebook/react/releases.atom',              'github'),
  ('TypeScript releases',     'https://github.com/microsoft/TypeScript',  'https://github.com/microsoft/TypeScript/releases.atom',        'github'),
  ('Next.js releases',        'https://github.com/vercel/next.js',        'https://github.com/vercel/next.js/releases.atom',              'github'),
  ('Node.js releases',        'https://github.com/nodejs/node',           'https://github.com/nodejs/node/releases.atom',                 'github'),
  ('Bun releases',            'https://github.com/oven-sh/bun',           'https://github.com/oven-sh/bun/releases.atom',                 'github'),
  ('Deno releases',           'https://github.com/denoland/deno',         'https://github.com/denoland/deno/releases.atom',               'github'),
  ('Vite releases',           'https://github.com/vitejs/vite',           'https://github.com/vitejs/vite/releases.atom',                 'github'),
  ('Tailwind CSS releases',   'https://github.com/tailwindlabs/tailwindcss', 'https://github.com/tailwindlabs/tailwindcss/releases.atom', 'github'),
  -- GitHub's releases.atom for pytorch/pytorch is CI branch tags (`trunk/16ee…`),
  -- not versioned releases. The company blog is the actual news feed.
  ('PyTorch blog',            'https://pytorch.org/blog',            'https://pytorch.org/blog/feed/',                             'company_blog'),
  ('vLLM releases',           'https://github.com/vllm-project/vllm',     'https://github.com/vllm-project/vllm/releases.atom',           'github'),
  ('llama.cpp releases',      'https://github.com/ggml-org/llama.cpp',    'https://github.com/ggml-org/llama.cpp/releases.atom',          'github'),
  ('Supabase releases',       'https://github.com/supabase/supabase',     'https://github.com/supabase/supabase/releases.atom',            'github'),

  -- --- Product changelogs -------------------------------------------------
  ('Product Hunt',            'https://www.producthunt.com',         'https://www.producthunt.com/feed',                                  'product'),
  ('Cursor changelog',        'https://cursor.com/changelog',        'https://cursor.com/changelog/rss.xml',                              'product')
on conflict (feed_url) do nothing;

-- Retarget an already-seeded pytorch/pytorch releases.atom. GitHub's feed for
-- that repo is CI tags, not releases; the blog is the news.
update public.sources
set
  name = 'PyTorch blog',
  homepage = 'https://pytorch.org/blog',
  feed_url = 'https://pytorch.org/blog/feed/',
  kind = 'company_blog',
  last_fetched_at = null
where feed_url = 'https://github.com/pytorch/pytorch/releases.atom';
