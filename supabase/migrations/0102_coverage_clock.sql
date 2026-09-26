-- nyuz -- the coverage clock: what the re-entry lane was always supposed to read.
--
-- ---------------------------------------------------------------------------
-- The defect
-- ---------------------------------------------------------------------------
--
-- 0098 gave the re-entry lane an index on `events.last_updated_at` and described
-- that column as "when coverage last arrived". Nothing has ever written it after
-- the insert. `mark_event_metadata_dirty` (0085), the trigger that runs when an
-- article attaches, bumps `coverage_revision` and sets `metadata_dirty` and
-- leaves `last_updated_at` at its insert default. So the lane's
--
--     last_updated_at >= now() - 14 days
--
-- was really "the event was *created* in the last fortnight". An event first
-- seen on day 1 that gains release-candidate coverage on day 21 was outside the
-- live horizon (by `first_seen_at`) and outside the re-entry lookback (by its
-- creation-time `last_updated_at`), so neither lane could reach it -- which is
-- the one case the re-entry lane exists for.
--
-- ---------------------------------------------------------------------------
-- Why a new column rather than writing `last_updated_at`
-- ---------------------------------------------------------------------------
--
-- `last_updated_at` has readers that depend on what it has actually meant for
-- its whole life: the retention sweep (0042/0045/0067) purges on it, and the
-- briefing and story diagnostics render it. Starting to move it on every
-- attachment would silently extend retention for any event a late article
-- touched and change what those screens say. So it keeps its meaning, and the
-- clock the queue needs gets its own name.
--
-- The three clocks on an event are now each written in exactly one place:
--
--   coverage_changed_at      when coverage last changed (an article attached,
--                            detached or was edited). Written by the attachment
--                            trigger, in the same statement that bumps
--                            `coverage_revision`. Drives re-entry eligibility.
--   last_material_change_at  when this system DISCOVERED a material change.
--                            Written by finish_event_finalization (0098).
--   material_occurrence_at   when the world's evidence for the current state was
--                            published. Written by finish_event_finalization.
--
-- Attachment activity is not a material change -- a reprint moves the first
-- clock and neither of the others -- and discovery is not occurrence. Keeping the
-- three apart is the whole point.

alter table public.events
  add column coverage_changed_at timestamptz;

-- Backfill: the newest ingest time among the event's articles, which is the
-- closest recorded value to "when coverage last attached" (clustering follows
-- ingestion by minutes), or `first_seen_at` for an event with no articles.
-- Conservative in the direction that matters: no row is dated *later* than
-- evidence it actually holds, so the backfill cannot pull an untouched event
-- into the re-entry lane.
update public.events e
   set coverage_changed_at = coalesce(
         (select max(a.fetched_at) from public.articles a where a.event_id = e.id),
         e.first_seen_at
       )
 where e.coverage_changed_at is null;

-- A new event's first coverage is its creation: `finish_article_cluster` inserts
-- the event and then attaches the article, and the trigger below stamps it again
-- in the same transaction.
alter table public.events
  alter column coverage_changed_at set default now(),
  alter column coverage_changed_at set not null;

comment on column public.events.coverage_changed_at is
  'When this event''s coverage last changed: an article attached, detached, or had its title/excerpt edited (0102). Written only by mark_event_metadata_dirty, atomically with coverage_revision. Drives the analysis re-entry lane. NOT a material change (see last_material_change_at) and NOT occurrence (see material_occurrence_at).';

comment on column public.events.last_updated_at is
  'Row creation time in practice: set on insert and never moved by the pipeline. Read by the retention sweep and rendered as-is. For "coverage last changed" read coverage_changed_at (0102).';

-- ---------------------------------------------------------------------------
-- The production write
-- ---------------------------------------------------------------------------
--
-- The same function 0085 installed, with one column added to each update. It
-- stays bound to `article_metadata_changed`, so every path that attaches an
-- article -- `finish_article_cluster`, a manual repair, a future bulk re-cluster
-- -- stamps the clock without knowing it exists.

create or replace function public.mark_event_metadata_dirty() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.event_id is not null then
    update events
       set metadata_dirty = true,
           coverage_revision = coverage_revision + 1,
           coverage_changed_at = now()
     where id = new.event_id;
  end if;
  if tg_op = 'UPDATE' and old.event_id is distinct from new.event_id and old.event_id is not null then
    update events
       set metadata_dirty = true,
           coverage_revision = coverage_revision + 1,
           coverage_changed_at = now()
     where id = old.event_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- The re-entry lane's index, on the clock it actually reads
-- ---------------------------------------------------------------------------
--
-- The predicate is the lane's work predicate (`analyse.ts`): dirty, pending or
-- analysing. 0098's index covered `metadata_dirty` only, so a pending event past
-- the horizon fell back to a scan.

drop index if exists public.events_material_reentry_idx;

create index events_coverage_reentry_idx
  on public.events (coverage_changed_at desc)
  where metadata_dirty or status in ('pending', 'analysing');

comment on index public.events_coverage_reentry_idx is
  'Supports the re-entry lane in analyse.ts: work-predicate events ordered by when coverage last changed, for events older than the live horizon. The live lane keeps events_metadata_work (0085).';
