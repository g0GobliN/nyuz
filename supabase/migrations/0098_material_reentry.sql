-- nyuz -- M2: re-entry admission support.
--
-- Two things, both required before an old event with a genuine material change
-- can reach analysis at all:
--
--   1. `finish_event_finalization` learns about the material state. The write
--      has to be atomic with the rest of finalization -- the fingerprint, the
--      revision and the occurrence clock are read back by the delivery path, so
--      a crash between two statements would leave a revision with no state or a
--      state with no revision.
--
--   2. A partial index for the re-entry lane. The live lane's index
--      (`events_metadata_work`, 0085) is ordered by `first_seen_at desc`, which
--      is exactly the column the re-entry lane is *outside* of: without a second
--      index, admitting old dirty work means scanning every dirty row.
--
-- The live-work guarantee from 0068 is untouched. Ordering and the lane share
-- are enforced in `analyse.ts`; this migration only makes the query affordable.

-- ---------------------------------------------------------------------------
-- Finalization writes the material state
-- ---------------------------------------------------------------------------
--
-- `p_material` is an optional object, so every existing 5-argument call site
-- keeps working unchanged:
--
--   { "fingerprint": "<hash>", "changed": true, "occurrence_at": "<iso|null>" }
--
--   fingerprint    written when present; null/absent leaves the stored value
--                  alone (a rejected change must not overwrite the state the
--                  reader's delivered revision was built from)
--   changed        true advances revision by exactly one and stamps
--                  last_material_change_at -- the discovery clock
--   occurrence_at  written when present -- the world clock
--
-- The old 5-argument function is dropped rather than left in place: with a
-- defaulted sixth parameter both signatures would be callable and a 5-argument
-- call would be ambiguous. 0068 dropped a superseded queue function for the same
-- reason, "so a stale plan cannot be chosen".

drop function if exists public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[]);

create function public.finish_event_finalization(
  p_event_id   uuid,
  p_owner      uuid,
  p_revision   integer,
  p_metadata   jsonb,
  p_topics     uuid[],
  p_material   jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed        boolean := coalesce((p_material->>'changed')::boolean, false);
  v_fingerprint    text    := p_material->>'fingerprint';
  v_occurrence     timestamptz := nullif(p_material->>'occurrence_at', '')::timestamptz;
begin
  perform 1 from events
   where id = p_event_id
     and finalization_owner = p_owner
     and finalization_lease_until > now()
     for update;
  if not found then return false; end if;

  insert into event_topics(event_id, topic_id)
    select p_event_id, unnest(p_topics)
    on conflict do nothing;

  update events set
    title           = p_metadata->>'title',
    what_happened   = p_metadata->>'what_happened',
    importance      = (p_metadata->>'importance')::real,
    novelty         = (p_metadata->>'novelty')::real,
    tags            = array(select jsonb_array_elements_text(p_metadata->'tags')),
    article_count   = (p_metadata->>'article_count')::integer,
    publisher_count = (p_metadata->>'publisher_count')::integer,
    status          = 'complete',
    analysed_at     = coalesce(analysed_at, now()),
    analysis_deferred_until = null,
    metadata_dirty  = (coverage_revision <> p_revision),
    finalization_owner = null,
    finalization_lease_until = null,
    material_fingerprint = coalesce(v_fingerprint, material_fingerprint),
    material_revision = case when v_changed then material_revision + 1 else material_revision end,
    last_material_change_at = case when v_changed then now() else last_material_change_at end,
    material_occurrence_at = coalesce(v_occurrence, material_occurrence_at)
  where id = p_event_id;

  return true;
end
$$;

comment on function public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb) is
  'Atomic finalization. p_material carries the material-state decision from event-version.ts: fingerprint (written when present), changed (advances material_revision and stamps the discovery clock), occurrence_at (the world clock). Optional, so pre-0098 call sites are unaffected.';

revoke all on function public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- The re-entry lane's index
-- ---------------------------------------------------------------------------
--
-- Shape follows the query: dirty events that have moved since the last
-- material measurement, most recently touched first, bounded by the live
-- horizon. `last_updated_at` is exactly "when coverage last arrived", which is
-- what distinguishes a re-entry candidate from a permanently stale row.

create index events_material_reentry_idx
  on public.events (last_updated_at desc)
  where metadata_dirty;

comment on index public.events_material_reentry_idx is
  'Supports the re-entry lane in analyse.ts: metadata_dirty events ordered by last attachment, for events older than the live horizon. The live lane keeps events_metadata_work (0085).';

-- The material clock, for match candidate ordering. Partial because only
-- materially revised events need this ordering; everything else sorts on
-- first_seen_at as before.
create index events_material_clock_idx
  on public.events (material_occurrence_at desc)
  where material_revision > 0;
