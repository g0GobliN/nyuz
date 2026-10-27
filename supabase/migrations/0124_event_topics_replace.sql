-- nyuz -- H-16: reader chips anchor to the current rule.
--
-- Reader-visible chips come from `event_topics`, written here and read by the
-- story join. Before this migration the write was append-only
-- (`on conflict do nothing`), so a link written under a retired vocabulary --
-- or under incident names classify.ts no longer matches -- stayed on the card
-- after every later finalization. Measured on the audited digest
-- 7268ba11-28c6-4d2d-abe6-db483dccb897 (card 04): the store held six labels --
-- `Politics · Music · Economy · AI · NVIDIA · Robotics` -- where the current
-- rule yields `NVIDIA · AI · Politics · Robotics`. `Music` and `Economy` are
-- labels today's rule no longer produces, and the over-cap sixth label existed
-- only because nothing ever subtracted.
--
-- A chip an analysis pass would not produce is a chip on borrowed text. The
-- write becomes replace, not accumulate: within the same lease-held atomic
-- transaction, links the caller did not send are deleted and those it did are
-- inserted. `analyse.ts` (H-16 slice) sends exactly the current rule's recompute
-- -- predefined topics through assignTopics' 5-cap, custom topics through the
-- spec as it stands now -- so after finalization the store can only hold what
-- today's rule derives. An ingest-era candidate loses nothing it is entitled
-- to: candidates remain classification's cheap guess for the demand gate and
-- were never part of this write's mandate to preserve.
--
-- `p_topics` may repeat an id; the insert de-duplicates. The delete runs before
-- the insert inside the single transaction, so partial writes are impossible.
--
-- The 6-argument signature is replaced in place rather than dropped-and-added:
-- every live call site passes six arguments (0098's shape), and a second
-- callable overload of the same name would make the call ambiguous -- the same
-- reason 0098 gave for dropping the 5-argument predecessor.

drop function if exists public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb);

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

  -- Replace, not accumulate: the caller's list is the whole truth now.
  delete from event_topics where event_id = p_event_id;
  insert into event_topics(event_id, topic_id)
    select distinct p_event_id, topic_id
      from unnest(p_topics) as topic_id;

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
  'Atomic finalization. p_topics is the complete set of reader-visible chips: existing links are replaced, never accumulated, so a retired vocabulary label cannot survive a re-finalization. p_material carries the material-state decision from event-version.ts: fingerprint (written when present), changed (advances material_revision and stamps the discovery clock), occurrence_at (the world clock). Optional, so pre-0098 call sites are unaffected.';

revoke all on function public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_event_finalization(uuid, uuid, integer, jsonb, uuid[], jsonb)
  to service_role;
