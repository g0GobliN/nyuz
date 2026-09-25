-- nyuz -- M1: material revision and the two clocks.
--
-- ---------------------------------------------------------------------------
-- Why `coverage_revision` is not enough
-- ---------------------------------------------------------------------------
--
-- 0085's `coverage_revision` counts article attachment: it bumps on every insert
-- or edit that changes an event's coverage, including a reprint, a new outlet
-- running the same wire copy, and a correction to a figure that stays in the
-- same magnitude bucket. That is the right signal for "this event's stored
-- metadata is stale" and the wrong signal for "this event has new information a
-- reader should be told about".
--
-- `material_revision` counts accepted material transitions only: the event's
-- material fingerprint moved (event-version.ts) AND the coverage contains
-- evidence published after the state the current revision was built from. It is
-- the value `user_events.delivered_revision` and `digest_items.delivered_revision`
-- compare against, so:
--
--   reader has revision N, story still at revision N     -> nothing to send
--   reader has revision N, story now at revision N + 1   -> the update is sendable
--
-- ---------------------------------------------------------------------------
-- Two clocks, deliberately not one
-- ---------------------------------------------------------------------------
--
--   last_material_change_at   when NYUZ discovered the change. Drives the
--                             re-entry and re-match queues. Never rendered.
--
--   material_occurrence_at    when the world's evidence says it happened --
--                             the newest `published_at` in the coverage at the
--                             moment the state was established. Drives
--                             freshness lanes and briefing order.
--
-- A development reported last week and discovered today is dated last week, so
-- it can re-enter the pipeline without appearing as today's news. Collapsing
-- these into one timestamp is exactly the confusion this migration exists to
-- prevent.

alter table public.events
  add column material_revision      integer     not null default 0,
  add column material_fingerprint   text,
  add column last_material_change_at timestamptz,
  add column material_occurrence_at  timestamptz;

alter table public.events
  add constraint events_material_revision_nonnegative check (material_revision >= 0);

comment on column public.events.material_revision is
  'Accepted material transitions: how many times this event''s material state has genuinely moved. Distinct from coverage_revision (0085), which counts article attachment. Increments only in finish_event_finalization, only when the fingerprint changed against newer evidence.';

comment on column public.events.material_fingerprint is
  'The material state (event-version.ts) as of the last accepted transition. Null means "never measured": the first finalization after this migration adopts the current state and advances no revision, so no existing event is retroactively made re-deliverable.';

comment on column public.events.last_material_change_at is
  'When this system DISCOVERED the current material change. Drives queues only; never used for freshness, because discovery time is not occurrence time.';

comment on column public.events.material_occurrence_at is
  'When the evidence behind the current material state was published (newest `published_at` in coverage at that moment). Drives freshness and briefing order, so a late-discovered development does not become today''s news.';

-- ---------------------------------------------------------------------------
-- Backfill: conservative by construction
-- ---------------------------------------------------------------------------
--
-- The occurrence clock starts at the newest evidence an event has -- or at
-- `first_seen_at` when nothing is dated, which is the same value the clusterer
-- would have stored for an undated article. Newest rather than earliest, so the
-- backfilled value agrees with what `decideMaterialRevision` writes on the first
-- finalization: the publication time of the evidence behind the current state.
--
-- No revision is invented and no fingerprint is written: null means "not yet
-- measured", and the first finalization adopts whatever the event currently is.
-- An event that has been delivering to readers for a month is not, as a result
-- of applying this migration, suddenly one revision ahead of them.

update public.events e
   set material_occurrence_at = coalesce(
         (
           select max(a.published_at)
             from public.articles a
            where a.event_id = e.id
              and a.published_at is not null
         ),
         e.first_seen_at
       )
 where e.material_occurrence_at is null;
