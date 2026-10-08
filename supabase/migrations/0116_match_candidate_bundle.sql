-- ---------------------------------------------------------------------------
--
-- Match's candidate bundle, built server-side in one call.
--
-- `loadCandidates` (match.ts) used to assemble one run's candidates from ~23
-- PostgREST reads: two event lanes, the whole sources table, then per-100
-- chunks of event_topics and articles. That fan-out is the fixed floor a loud
-- match tick dies on -- batching the per-reader work cannot move it, and the
-- surviving quiet ticks prove the model. This function builds the same bundle
-- inside Postgres and returns it in one subrequest.
--
-- What it owns: the two candidate lanes, the topic links, the source links.
-- What it does NOT own: matching, suppression, pacing, significance,
-- reopening, alerts, deliveries. The application receives the same candidate
-- information the chunked reads produced and decides exactly as before.
--
-- Equivalence notes, so a reviewer can check each one:
--   - Lane predicates are the two `loadCandidates` filters verbatim:
--     analysed + complete + first_seen window, and revised (revision > 0)
--     + occurrence window. Each lane keeps its own order and limit; UNION is
--     the old merge-into-a-Map-by-id.
--   - `event_topics` joins `topics`, so a link whose topic is gone is dropped
--     -- the same rows the old code skipped when the topic map missed. (In
--     practice the foreign key cascades, so this is belt and braces.)
--   - `articles` joins `sources`, so null or unknown source ids are dropped,
--     and sources are deduplicated per event -- the old per-event `some`
--     check. Ordering is deterministic by name; the old chunk reads had no
--     ORDER BY at all, and every consumer is order-independent.
--   - `has_articles` counts ANY article row for the event, including
--     source-less ones -- the old `withArticles` set did the same. Events
--     without articles are still returned; the caller filters them, as before.
--
-- Bounded one way: each lane is capped at 5000 rows whatever the caller
-- passes. The caller passes at most CANDIDATES * 3 (3000, only when
-- `sinceHours` over-fetches); the cap is headroom, not a limit change.

create function public.match_candidate_bundle(
  p_window_since timestamptz,
  p_fetch_limit integer
)
returns table (
  id uuid,
  title text,
  what_happened text,
  importance real,
  novelty real,
  tags text[],
  analysed_at timestamptz,
  first_seen_at timestamptz,
  material_revision integer,
  material_occurrence_at timestamptz,
  last_material_change_at timestamptz,
  topics jsonb,
  sources jsonb,
  has_articles boolean
)
language sql stable security definer set search_path = public as $fn$
  with lane as (
    (select e.id
       from public.events e
      where e.analysed_at is not null
        and e.status = 'complete'
        and e.first_seen_at >= p_window_since
      order by e.first_seen_at desc
      limit least(greatest(coalesce(p_fetch_limit, 0), 0), 5000))
    union
    (select e.id
       from public.events e
      where e.analysed_at is not null
        and e.status = 'complete'
        and e.material_revision > 0
        and e.material_occurrence_at >= p_window_since
      order by e.material_occurrence_at desc
      limit least(greatest(coalesce(p_fetch_limit, 0), 0), 5000))
  )
  select e.id,
         e.title,
         e.what_happened,
         e.importance,
         e.novelty,
         coalesce(e.tags, '{}'::text[]),
         e.analysed_at,
         e.first_seen_at,
         e.material_revision,
         e.material_occurrence_at,
         e.last_material_change_at,
         coalesce((
           select jsonb_agg(link order by link->>'slug')
             from (
               select distinct jsonb_build_object('id', t.id,
                                                  'slug', t.slug,
                                                  'label', t.label) as link
                 from public.event_topics et
                 join public.topics t on t.id = et.topic_id
                where et.event_id = e.id
             ) as topic_links
         ), '[]'::jsonb) as topics,
         coalesce((
           select jsonb_agg(link order by link->>'name')
             from (
               select distinct jsonb_build_object('id', s.id,
                                                  'name', s.name) as link
                 from public.articles a
                 join public.sources s on s.id = a.source_id
                where a.event_id = e.id
             ) as source_links
         ), '[]'::jsonb) as sources,
         exists(select 1 from public.articles a where a.event_id = e.id) as has_articles
    from lane
    join public.events e on e.id = lane.id
$fn$;

comment on function public.match_candidate_bundle(timestamptz, integer) is
  'One match run''s candidate events with their topic and source links, built server-side so the run spends one subrequest instead of ~23 chunked reads (0116, match.ts). Lanes and link rules reproduce loadCandidates; matching still happens in the application.';

revoke all on function public.match_candidate_bundle(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.match_candidate_bundle(timestamptz, integer) to service_role;
