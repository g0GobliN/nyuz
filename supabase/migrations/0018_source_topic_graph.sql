-- nyuz — source coverage mode and the source↔topic graph
--
-- First schema step toward demand-driven collection (docs/plan2.md, tracked in
-- docs/track.md). This migration is deliberately inert: it adds structure and
-- changes no runtime behaviour. Nothing reads `coverage_mode` yet and
-- `source_topics` starts empty. Collection still fetches every active source on
-- its existing schedule.
--
-- ---------------------------------------------------------------------------
-- Why this table and not a column on `sources`
-- ---------------------------------------------------------------------------
--
-- A source can plausibly cover several topics (NVIDIA Blog is `chips` and
-- `ai`), and a topic draws from many sources — the same many-to-many shape
-- `event_topics` already uses for events. Reusing that shape here means the
-- eventual demand query (source demand = sum of interested users across a
-- source's topics) is one join, not a special case.
--
-- ---------------------------------------------------------------------------
-- Why `coverage_mode` defaults to 'demand' but the 68 seeded sources become
-- 'core'
-- ---------------------------------------------------------------------------
--
-- The sources in 0006 were hand-picked by a human, not requested by a reader —
-- that is what "core" means in docs/plan2.md §9: deliberately selected global
-- discovery sources, monitored without requiring a specific subscriber. Any
-- source added after this migration (custom-source follows, once built)
-- defaults to 'demand', because nobody has editorially vouched for it.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT in this migration
-- ---------------------------------------------------------------------------
--
-- No `source_topics` rows are seeded here. Which topics a source actually
-- covers is an editorial judgement (plan2 §9: "measured source value,
-- editorial/product requirements"), not something to infer from a feed name.
-- That mapping is entered through the admin console once it has a page for
-- it — see docs/track.md phase 3. Seeding it blind would produce a graph that
-- looks complete and is wrong, which is worse than an empty one.
--
-- No demand scoring, polling tiers, or custom-source table yet. Those are
-- later, separately-numbered migrations per plan2 §73 ("do NOT make one giant
-- migration").
-- ---------------------------------------------------------------------------

create type source_coverage_mode as enum ('core', 'demand');

alter table public.sources
  add column coverage_mode source_coverage_mode not null default 'demand';

update public.sources set coverage_mode = 'core';

create table public.source_topics (
  source_id  uuid not null references public.sources (id) on delete cascade,
  topic_id   uuid not null references public.topics (id)  on delete cascade,
  -- Same 0..1 scale as event_topics.confidence — how strongly this source
  -- covers this topic, not how much of its output is on-topic.
  confidence real        not null default 1.0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_id, topic_id)
);

create index source_topics_topic_id_idx on public.source_topics (topic_id);

comment on table public.source_topics is
  'Global source-to-topic map. Many sources per topic, many topics per source. '
  'Written by admin/pipeline only — see docs/track.md phase 3.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as topics/sources/events: read-only to signed-in users, no
-- write policy at all. The pipeline and the admin console both write with the
-- service-role key, which bypasses RLS entirely; the absence of a write
-- policy is the write guard, matching every other global-content table.
-- ---------------------------------------------------------------------------

alter table public.source_topics enable row level security;

create policy "source_topics readable" on public.source_topics
  for select to authenticated using (true);
