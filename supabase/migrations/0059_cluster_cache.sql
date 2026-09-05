-- nyuz -- cluster cache (docs/nyuz-cost-cutting.md item 7)
--
-- The trigram shortlist runs on every clustering cycle. If the same
-- article appears again (e.g., a feed republishes), it goes through the
-- full clustering pipeline again. The `articles.content_hash` catches
-- exact duplicates, but near-duplicates (same story, different outlet)
-- are not cached.
--
-- This table stores (title_hash, event_id) pairs. When an article's
-- title hash matches a cached entry, the model call is skipped entirely
-- and the article attaches to the cached event.
--
-- A title hash is a strong fingerprint: it includes the title text
-- which is unique enough to distinguish different stories. False
-- positives (two different stories with the same hash) are extremely
-- unlikely with SHA-256, and even if they occur, the worst case is
-- attaching an article to the wrong event — which is corrected when
-- the real analysis runs later.
--
-- See docs/nyuz-cost-cutting.md item 7.

create table public.cluster_cache (
  title_hash text primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index cluster_cache_event_idx on public.cluster_cache (event_id);

comment on table public.cluster_cache is
  'Title-hash → event mapping for skipping clustering model calls. '
  'When an article title matches a cached hash, the model call is '
  'skipped and the article attaches to the cached event. See docs/nyuz-cost-cutting.md item 7.';

alter table public.cluster_cache enable row level security;
-- No policies at all: operational data, service-role only, unreachable from a browser.

-- ---------------------------------------------------------------------------
-- The cache lookup function.
--
-- Returns the cached event_id if a matching title hash exists, null
-- otherwise. Used by the clustering pipeline to skip model calls.
--
-- A cache hit means this article is a near-duplicate of a previously
-- clustered article. The event already exists and has been analysed.
-- Attaching to it costs zero tokens.

create or replace function public.cluster_cache_lookup(p_title_hash text)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select event_id from public.cluster_cache where title_hash = p_title_hash limit 1;
$fn$;

revoke execute on function public.cluster_cache_lookup(text) from public, anon, authenticated;
grant execute on function public.cluster_cache_lookup(text) to service_role;

-- ---------------------------------------------------------------------------
-- The cache insert helper.
--
-- Called by the clustering pipeline after a model call succeeds, to
-- record the title hash → event mapping for future cache hits.
--
-- Only records articles that reached the model (prompt_tokens > 0).
-- Articles that were decided for free (no shortlist, CI ref) are not
-- cached because they were never analysed and their event may not be
-- stable.

create or replace function public.cluster_cache_insert(
  p_title_hash text,
  p_event_id uuid
)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.cluster_cache (title_hash, event_id)
  values (p_title_hash, p_event_id)
  on conflict (title_hash) do nothing;
$fn$;

revoke execute on function public.cluster_cache_insert(text, uuid) from public, anon, authenticated;
grant execute on function public.cluster_cache_insert(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Record the cost-cutting audit
-- ---------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('cost_cutting.cluster_cache.applied', 'system', 'cost_cutting', '0058',
   jsonb_build_object('action', 'cluster_cache_created', 'applied_at', now()));
