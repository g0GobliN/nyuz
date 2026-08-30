-- nyuz -- adaptive polling (docs/plan2.md phase 6, sections 19-21)
--
-- Today every source is read on the same cadence: `isDue` in
-- src/lib/pipeline/ingest.ts allows a fetch every MIN_INTERVAL_MINUTES (30)
-- regardless of whether the source publishes hourly or twice a year. With 87
-- sources and a Workers subrequest budget, that uniformity is what makes a
-- run reach fewer feeds than it could.
--
-- This replaces the uniform interval with a per-source one, derived from two
-- things the database already knows: how much demand there is, and how often
-- the source actually publishes.
--
-- ---------------------------------------------------------------------------
-- Learned, not configured
-- ---------------------------------------------------------------------------
--
-- `last_new_content_at` is the only new fact required. Everything else is
-- derived from rows that already exist -- `articles.published_at` gives the
-- publication interval, `last_demand_at` (0031) gives demand,
-- `failure_count` gives health. plan2 section 21 asks for exactly this: learn
-- the source's behaviour rather than asking an operator to declare it.
--
-- No AI. This is arithmetic over timestamps.

alter table public.sources
  add column last_new_content_at timestamptz,
  add column polling_tier        text not null default 'normal'
    check (polling_tier in ('hot', 'normal', 'low', 'cold', 'paused'));

comment on column public.sources.last_new_content_at is
  'When this source last produced an article nyuz had not seen. Drives the '
  'cadence decay in recompute_polling_tiers -- see docs/track.md phase 6.';

comment on column public.sources.polling_tier is
  'Learned cadence band. Recomputed by recompute_polling_tiers; read by '
  'src/lib/pipeline/ingest.ts. Never set by hand.';

-- Backfill from what is already known, so the first run after this migration
-- has real tiers rather than everything sitting at the default.
update public.sources s
   set last_new_content_at = (
     select max(coalesce(a.published_at, a.fetched_at))
       from public.articles a
      where a.source_id = s.id
   );

-- ---------------------------------------------------------------------------
-- The tiers
-- ---------------------------------------------------------------------------
--
-- Cadences are minutes, and they are a starting point rather than sacred
-- (plan2 section 19 says so explicitly). They are stored in a table rather
-- than hardcoded in the function so an operator can retune the product's
-- collection behaviour without a migration -- the same reasoning that put AI
-- routes and prompts in tables.
--
--   hot     something new within the last day, or a direct follower waiting
--   normal  publishes regularly; the default
--   low     quiet for a week
--   cold    quiet for a month
--   paused  demand gone (phase 5 decides this; recorded here for the console)

create table public.polling_tiers (
  tier             text    primary key
                     check (tier in ('hot', 'normal', 'low', 'cold', 'paused')),
  interval_minutes integer not null check (interval_minutes > 0),
  label            text    not null default '',
  description      text    not null default ''
);

insert into public.polling_tiers (tier, interval_minutes, label, description) values
  ('hot',    15,   'Hot',    'Published within a day, or somebody follows it directly.'),
  ('normal', 60,   'Normal', 'Publishes regularly. The default.'),
  ('low',    360,  'Low',    'Nothing new for a week.'),
  ('cold',   1440, 'Cold',   'Nothing new for a month.'),
  ('paused', 10080,'Paused', 'No reader wants it. Collected rarely, not never.')
on conflict (tier) do nothing;

alter table public.polling_tiers enable row level security;
create policy "polling_tiers readable" on public.polling_tiers
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Recompute
-- ---------------------------------------------------------------------------
--
-- Runs on every ingest, before selection. Cheap: one UPDATE over 87 rows
-- against timestamps that are already indexed.
--
-- Ordering inside the CASE is the whole design. Demand is checked before
-- publication frequency, because a source somebody explicitly asked for
-- should be read promptly even if it has been quiet -- a changelog that
-- publishes twice a year is exactly the kind of thing a Pro reader adds, and
-- the one post that matters is the one they must not wait six hours for.

create or replace function public.recompute_polling_tiers()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  touched integer;
begin
  update public.sources s
     set polling_tier = case
       -- Explicitly requested by a reader: always responsive, whatever its
       -- publication rhythm.
       when exists (
         select 1 from public.user_custom_sources ucs
          where ucs.source_id = s.id and ucs.active = true
       ) then 'hot'
       -- No demand at all and not core: phase 5 will stop collecting it
       -- entirely once its grace period expires. Until then, rarely.
       when s.coverage_mode <> 'core'
            and s.last_demand_at is not null
            and s.last_demand_at < now() - interval '72 hours' then 'paused'
       when s.last_new_content_at is null then 'normal'
       when s.last_new_content_at > now() - interval '1 day'   then 'hot'
       when s.last_new_content_at > now() - interval '7 days'  then 'normal'
       when s.last_new_content_at > now() - interval '30 days' then 'low'
       else 'cold'
     end
   where s.active = true;

  get diagnostics touched = row_count;
  return touched;
end;
$fn$;

revoke execute on function public.recompute_polling_tiers() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------
--
-- Off by default. Tiers are computed and visible either way, so the cadence
-- the product *would* adopt can be inspected before it adopts it -- the same
-- sequencing every other phase in this series used.

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'adaptive_polling',
    'Adaptive polling',
    'Read each source on a cadence learned from its demand and publication '
    'rate, instead of one interval for everything. Off by default; tiers are '
    'computed and shown either way. See docs/track.md phase 6.',
    false,
    100
  )
on conflict (key) do nothing;
