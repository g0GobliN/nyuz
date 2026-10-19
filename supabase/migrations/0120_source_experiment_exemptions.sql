-- nyuz -- per-source exemptions for the ruling #12c reactivation experiment
--
-- Ruling #12c (arbiter, 2026-10-18) authorises a bounded 30-day experiment: exactly eight dormant
-- sources are exempted from the demand gate, the other 18 stay withheld, and the global
-- `demand_driven_sources` flag is NOT flipped. The ruling's order was baseline first; that baseline is
-- recorded in docs/decisions/reader-delivery.md and re-runnable with `npm run baseline:sources`.
--
-- ---------------------------------------------------------------------------
-- Why a table rather than a column on `sources`
-- ---------------------------------------------------------------------------
--
-- The experiment has to be auditable and reversible, and it has to end by itself. A boolean column
-- would record none of that: no experiment name, no reason, no window, and nothing stopping an
-- exemption from outliving the ruling that granted it. One row per source, carrying the experiment,
-- the reason it was granted, and a mandatory start and end, is the smallest shape that answers
-- "why is this feed being fetched when nobody asked for it, and until when".
--
-- The window is a constraint, not a convention: `starts_at` and `ends_at` are either both null
-- (granted but never started -- the state this migration leaves every row in) or both set with
-- `ends_at > starts_at`. An open-ended exemption cannot be written, so "temporary" is enforced by the
-- database rather than remembered by a session.
--
-- ---------------------------------------------------------------------------
-- Why the gate reads it, rather than ingest replacing the gate
-- ---------------------------------------------------------------------------
--
-- `sources_to_collect` is the one producer of the collection decision; ingest has always printed its
-- `reason` verbatim rather than reconstructing one (plan2 section 20: selection must be observable).
-- The exemption therefore lives inside that function, on the same row as the demand verdict, and the
-- audit script reads the same function the pipeline calls. Two implementations of "who may be
-- collected" is exactly the defect that made the briefing gate and the briefing page disagree; there
-- is one here.
--
-- With the flag off, or before any window is started, this changes nothing: every row below is
-- `enabled = false`, so the function's answers are identical to 0031's.

create table public.source_exemptions (
  source_id  uuid primary key references public.sources (id) on delete cascade,
  -- Which experiment this exemption belongs to. One named experiment at a time per source.
  experiment text not null,
  -- Why it was granted, in the ruling's own words. Read by an operator, not by the pipeline.
  reason     text not null,
  -- Granted (false) versus running (true). Seeded false: applying this migration changes no behaviour.
  enabled    boolean not null default false,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint source_exemptions_window_bounded check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

comment on table public.source_exemptions is
  'Per-source exemptions from the demand gate, one named bounded experiment per source. Read by '
  'sources_to_collect(); an exemption is active only while enabled and now() is inside [starts_at, '
  'ends_at). Applying the table changes nothing: rows are seeded disabled. See ruling #12c in '
  'docs/decisions/reader-delivery.md.';

-- Service-role only, exactly like `user_roles`: a policy would let a browser resurrect a feed nobody
-- asked for, and the only writer is an operator running SQL. No policies at all is the policy.
alter table public.source_exemptions enable row level security;

-- ---------------------------------------------------------------------------
-- The gate, one join wider
-- ---------------------------------------------------------------------------
--
-- Same signature and same columns, so every existing caller -- ingest, the baseline script,
-- verify-live -- keeps working and keeps reading the same reasons. The exemption is checked first so
-- an exempt source says so in its reason; without that, an operator looking at a fetched feed nobody
-- wanted would have to guess why.

create or replace function public.sources_to_collect(p_grace_hours integer default 72)
returns table (source_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    s.id,
    e.experiment is not null
      or s.coverage_mode = 'core'
      or s.last_demand_at is null
      or s.last_demand_at > now() - make_interval(hours => p_grace_hours),
    case
      when e.experiment is not null then 'exempt: ' || e.experiment
      when s.coverage_mode = 'core' then 'core'
      -- Null is treated as eligible, not as "never wanted": a source added between a migration and
      -- the first refresh has not yet been measured, and refusing to collect something on the
      -- strength of a measurement that has not happened is how a new custom source would silently
      -- never be read.
      when s.last_demand_at is null then 'not yet measured'
      when s.last_demand_at > now() - make_interval(hours => p_grace_hours) then 'wanted'
      else 'no demand for ' ||
           extract(day from now() - s.last_demand_at)::text || ' days'
    end
  from public.sources s
  left join lateral (
    select x.experiment
      from public.source_exemptions x
     where x.source_id = s.id
       and x.enabled
       and x.starts_at is not null
       and now() >= x.starts_at
       and (x.ends_at is null or now() < x.ends_at)
     limit 1
  ) e on true
  where s.active = true;
$fn$;

revoke execute on function public.sources_to_collect(integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The eight, seeded off
-- ---------------------------------------------------------------------------
--
-- Selected by the ruling's own criteria -- complementary UK/US general news, distinct publishers, no
-- two feeds from one publisher, each beat carried by two outlets:
--
--   BBC Politics          <-> The Guardian Politics
--   BBC Health            <-> NPR Health
--   BBC Science           <-> The Guardian Environment
--   Wired                 <-> Engadget
--
-- Matched by name because the ids are per-environment. The all-or-nothing check is what makes a name
-- drift loud instead of silent: on a database that has any of these sources, a seed that matches only
-- some of them raises, because a seven-source experiment is not the experiment the ruling approved.
-- On an empty database (the migration-chain test) zero matches is correct and seeds nothing.

do $seed$
declare
  matched integer;
begin
  select count(*) into matched
    from public.sources s
   where s.name in (
     'BBC Politics',
     'The Guardian Politics',
     'BBC Health',
     'NPR Health',
     'BBC Science',
     'The Guardian Environment',
     'Wired',
     'Engadget'
   );

  if matched > 0 and matched <> 8 then
    raise exception
      'ruling #12c: expected 8 named sources, matched % -- refusing to seed a partial experiment',
      matched;
  end if;

  insert into public.source_exemptions (source_id, experiment, reason)
  select s.id,
         '12c-30d',
         'Ruling #12c: complementary UK/US pair for the coverage rung, bounded 30-day experiment'
    from public.sources s
   where s.name in (
     'BBC Politics',
     'The Guardian Politics',
     'BBC Health',
     'NPR Health',
     'BBC Science',
     'The Guardian Environment',
     'Wired',
     'Engadget'
   )
  on conflict (source_id) do nothing;
end;
$seed$;
