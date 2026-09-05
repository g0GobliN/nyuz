-- nyuz -- ask cache (docs/nyuz-cost-cutting.md)
--
-- This migration adds response caching for Story Ask. If the same question
-- is asked about the same event, the cached answer is returned. A hash of
-- (event_id + question_text + model_version) is used as the cache key.
--
-- The cache reduces 10-30% of Story Ask calls. Repeated questions (e.g.
-- "what actually happened?" about a breaking event) are common. A cache hit
-- costs zero tokens.
--
-- See docs/nyuz-cost-cutting.md item 9.

-------------------------------------------------------------------------------
-- 1. Ask cache table
-------------------------------------------------------------------------------
-- Each unique question+event combination gets one cached answer. The cache
-- key is (event_id, question_hash). A TTL of 1 hour allows answers to be
-- refreshed if the event changes.

create table public.ask_cache (
  event_id uuid not null references public.events (id) on delete cascade,
  question_hash text not null,
  answer text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, question_hash)
);

create index ask_cache_event_idx on public.ask_cache (event_id, created_at desc);

comment on table public.ask_cache is
  'Cached Story Ask responses. On a cache hit, the answer is returned '
  'without calling the model. TTL is handled at the application layer. '
  'See docs/nyuz-cost-cutting.md item 9.';

alter table public.ask_cache enable row level security;
-- No policies at all: operational data, service-role only, unreachable from a browser.

-------------------------------------------------------------------------------
-- 2. Ask cache lookup function
-------------------------------------------------------------------------------
-- Returns the cached answer if the (event_id, question_hash) matches,
-- null otherwise. Used by the ask handler to skip the model call.

create or replace function public.ask_cache_lookup(
  p_event_id uuid,
  p_question_hash text
)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select answer from public.ask_cache
  where event_id = p_event_id
    and question_hash = p_question_hash
  limit 1;
$fn$;

revoke execute on function public.ask_cache_lookup(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ask_cache_lookup(uuid, text)
  to service_role;

-------------------------------------------------------------------------------
-- 3. Ask cache insert function
-------------------------------------------------------------------------------
-- Stores the answer in the cache after a successful model call.

create or replace function public.ask_cache_insert(
  p_event_id uuid,
  p_question_hash text,
  p_answer text,
  p_model text
)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.ask_cache (event_id, question_hash, answer, model, created_at)
  values (p_event_id, p_question_hash, p_answer, p_model, now())
  on conflict (event_id, question_hash) do update
    set answer = excluded.answer,
        model = excluded.model,
        created_at = now();
$fn$;

revoke execute on function public.ask_cache_insert(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ask_cache_insert(uuid, text, text, text)
  to service_role;

-------------------------------------------------------------------------------
-- 4. Audit log
-------------------------------------------------------------------------------

insert into public.admin_audit_log (action, actor_email, target_type, target_id, meta)
values
  ('cost_cutting.ask_cache.applied', 'system', 'cost_cutting', '0062',
   jsonb_build_object(
     'table', 'ask_cache',
     'rpcs', jsonb_build_array('ask_cache_lookup', 'ask_cache_insert'),
     'applied_at', now()
   ));