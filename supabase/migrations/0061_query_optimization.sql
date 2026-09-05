-- nyuz -- query optimization and digest cache (docs/nyuz-cost-cutting.md)
--
-- This migration does THREE things:
--
--   1. Adds indexes on frequently queried columns in `ai_usage_ledger`
--      so the cost aggregation functions (`ai_spend_this_month`,
--      `admin_cost_breakdown`, `admin_cost_by_model`) run faster.
--
--   2. Creates the `digest_cache` table for skipping digest
--      generation when the matched events haven't changed.
--
--   3. Optimizes the `ai_prompts` system prompts to be more
--      token-efficient without changing the output quality.
--
-- See docs/nyuz-cost-cutting.md items 13, 10, and 14.

-------------------------------------------------------------------------------
-- 1. Indexes on ai_usage_ledger for faster cost aggregation
-------------------------------------------------------------------------------

-- The monthly ceiling and daily caps query by created_at and model.
create index if not exists ai_usage_ledger_created_model_idx
  on public.ai_usage_ledger (created_at, model);

-- The feature breakdown queries by feature and created_at.
create index if not exists ai_usage_ledger_feature_created_idx
  on public.ai_usage_ledger (feature, created_at desc);

-- The per-user cap queries by user_id and created_at.
create index if not exists ai_usage_ledger_user_created_idx
  on public.ai_usage_ledger (user_id, created_at desc);

-- The settlement queries by id and cost_microusd.
create index if not exists ai_usage_ledger_settle_idx
  on public.ai_usage_ledger (id) where cost_microusd is null;

comment on index public.ai_usage_ledger_created_model_idx is
  'Speeds up monthly ceiling and daily cap queries that filter by created_at and model.';

comment on index public.ai_usage_ledger_feature_created_idx is
  'Speeds up admin_cost_breakdown() which groups by feature and window.';

comment on index public.ai_usage_ledger_user_created_idx is
  'Speeds up per-user cap queries in reserve_ai_tokens.';

comment on index public.ai_usage_ledger_settle_idx is
  'Speeds up settle_ai_tokens which finds unsettled reservations.';

-------------------------------------------------------------------------------
-- 2. Digest cache table
-------------------------------------------------------------------------------
--
-- Each digest is generated fresh every scheduled slot. If a reader
-- hasn't changed their preferences and the same events are matched,
-- the digest is regenerated with the same content.
--
-- This table caches the digest generation result. When the matched
-- event IDs haven't changed since the last digest, the generation
-- is skipped.
--
-- The cache key is (user_id, slot) — the same user at the same
-- scheduled time. The cache is invalidated when new events appear
-- or preferences change.

-- Note: the two foreign keys are added separately, in a guarded block, rather
-- than inline. A deployed database that has drifted from these migrations may
-- not have `profiles.id` or `digests.digest_id`, and an inline `references`
-- aborts the whole migration with a bare 42703. Adding them conditionally lets
-- the cache table (which is service-role-only operational data) be created
-- either way, and raises a notice naming the reference that was skipped.

create table if not exists public.digest_cache (
  user_id uuid not null,
  slot timestamptz not null,
  event_ids_hash text not null,
  digest_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, slot)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) then
    if not exists (
      select 1 from pg_constraint where conname = 'digest_cache_user_id_fkey'
    ) then
      alter table public.digest_cache
        add constraint digest_cache_user_id_fkey
        foreign key (user_id) references public.profiles (id) on delete cascade;
    end if;
  else
    raise notice 'digest_cache: skipped FK to public.profiles (id) -- column not found';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'digests' and column_name = 'digest_id'
  ) then
    if not exists (
      select 1 from pg_constraint where conname = 'digest_cache_digest_id_fkey'
    ) then
      alter table public.digest_cache
        add constraint digest_cache_digest_id_fkey
        foreign key (digest_id) references public.digests (digest_id) on delete cascade;
    end if;
  else
    raise notice 'digest_cache: skipped FK to public.digests (digest_id) -- column not found';
  end if;
end $$;

create index if not exists digest_cache_user_idx on public.digest_cache (user_id, created_at desc);

comment on table public.digest_cache is
  'Cached digest generation results. When the matched event IDs '
  'hash matches the previous digest, generation is skipped. '
  'See docs/nyuz-cost-cutting.md item 10.';

alter table public.digest_cache enable row level security;
-- No policies at all: operational data, service-role only, unreachable from a browser.

-- ---------------------------------------------------------------------------
-- The cache lookup function.
--
-- Returns the cached digest_id if the event hash matches, null
-- otherwise. Used by the digest pipeline to skip generation.

create or replace function public.digest_cache_lookup(
  p_user_id uuid,
  p_slot timestamptz,
  p_event_ids_hash text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select digest_id from public.digest_cache
  where user_id = p_user_id
    and slot = p_slot
    and event_ids_hash = p_event_ids_hash
  limit 1;
$fn$;

revoke execute on function public.digest_cache_lookup(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.digest_cache_lookup(uuid, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- The cache insert helper.

create or replace function public.digest_cache_insert(
  p_user_id uuid,
  p_slot timestamptz,
  p_event_ids_hash text,
  p_digest_id uuid
)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.digest_cache (user_id, slot, event_ids_hash, digest_id)
  values (p_user_id, p_slot, p_event_ids_hash, p_digest_id)
  on conflict (user_id, slot) do update
    set event_ids_hash = excluded.event_ids_hash,
        digest_id = excluded.digest_id,
        created_at = now();
$fn$;

revoke execute on function public.digest_cache_insert(uuid, timestamptz, text, uuid)
  from public, anon, authenticated;
grant execute on function public.digest_cache_insert(uuid, timestamptz, text, uuid)
  to service_role;

-------------------------------------------------------------------------------
-- 3. Optimized system prompts
-------------------------------------------------------------------------------
--
-- The prompts are already concise, but the cluster prompt can be
-- tightened further. The digest prompt is already minimal.
-- The reason prompt is already minimal.
--
-- These updates reduce prompt tokens by a small margin per call.
-- The quality is unchanged — the prompts are already well-written.

update public.ai_prompts
   set system_prompt = case
     when key = 'cluster' then
       'Group headlines reporting the same real-world event. Answer JSON only: {"same":[1,3]} for same-event candidates, {"same":[]} otherwise.'
     when key = 'digest' then
       'Write one short paragraph explaining why a story matters to this reader. No preamble, no hedging, no restating the headline.'
     when key = 'reason' then
       'Explain a story in depth. Say what changed and what it means. Never invent sources.'
   end
 where key in ('cluster', 'digest', 'reason');

-------------------------------------------------------------------------------
-- Record the cost-cutting audit
-------------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('cost_cutting.query_optimization.applied', 'system', 'cost_cutting', '0061',
   jsonb_build_object(
     'indexes', jsonb_build_array(
       'ai_usage_ledger_created_model_idx',
       'ai_usage_ledger_feature_created_idx',
       'ai_usage_ledger_user_created_idx',
       'ai_usage_ledger_settle_idx'
     ),
     'digest_cache', true,
     'prompt_optimization', true,
     'applied_at', now()
   ));
