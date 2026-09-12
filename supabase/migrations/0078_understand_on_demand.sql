-- nyuz -- Understand becomes on-demand, event-level and cached.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- The long reader-facing explanation lived in `events.understand`, written by
-- the background analysis pass. Every demanded event paid for 200-350 words of
-- prose whether or not one person ever opened it. Measured on 2026-09-12 that
-- was 615 calls and $4.47 of a $10 monthly ceiling, for an open rate nobody has
-- ever measured -- because the spend never depended on it.
--
-- The expensive work should happen when a reader asks for depth, not when the
-- cron runs. This migration adds the cache that makes that safe.
--
-- ---------------------------------------------------------------------------
-- The key: (event_id, content_version)
-- ---------------------------------------------------------------------------
--
-- No user appears in the key, and that is the whole cost argument. One hundred
-- readers of one story share one generation; the hundred-and-first is a table
-- read. `content_version` is a deterministic hash of the event's *material*
-- state -- see src/lib/pipeline/event-version.ts -- so a fourth outlet
-- publishing the same facts produces the same version and hits the same row,
-- while an acquisition moving from "in talks" to "confirmed" produces a new one
-- and earns exactly one regeneration.
--
-- ---------------------------------------------------------------------------
-- Single-flight
-- ---------------------------------------------------------------------------
--
-- The primary key IS the lock. `claim_event_understanding` inserts a
-- `generating` row and lets Postgres arbitrate: the winner gets 'won', everyone
-- else is told to wait and read. Two readers opening the same uncached story in
-- the same second cannot both buy a generation.
--
-- ---------------------------------------------------------------------------
-- Migration safety
-- ---------------------------------------------------------------------------
--
-- Nothing is copied, rewritten or regenerated. `events.understand` keeps every
-- word it already holds, and the application reads it as a cache hit when this
-- table has no row. This migration therefore costs zero AI and cannot lose
-- existing content. The column is not dropped.

create type understanding_status as enum ('generating', 'ready', 'failed');

create table public.event_understanding (
  event_id          uuid                 not null references public.events (id) on delete cascade,
  -- Deterministic hash of the event's material state. Not a source count and
  -- not a timestamp: both change without the story having changed.
  content_version   text                 not null,
  status            understanding_status not null default 'generating',
  -- The EventIntelligence block, the same shape `events.understand` holds, so
  -- the reader path is identical whichever side the cache hit came from.
  payload           jsonb,
  model             text,
  prompt_version    text,
  prompt_tokens     integer              not null default 0,
  completion_tokens integer              not null default 0,
  -- The ledger row that priced this generation. Joined rather than copied:
  -- two accounting systems drift, and the ledger is the one the cap counts.
  usage_id          uuid,
  source_count      integer              not null default 0,
  -- Bounded, so a permanently failing event cannot be retried forever by
  -- successive readers. See UNDERSTAND_MAX_ATTEMPTS in the application.
  attempts          integer              not null default 0,
  failure_reason    text,
  claimed_at        timestamptz,
  created_at        timestamptz          not null default now(),
  updated_at        timestamptz          not null default now(),
  primary key (event_id, content_version)
);

-- Serves "is there anything cached for this event", newest first, which is the
-- read every story open makes.
create index event_understanding_event_idx
  on public.event_understanding (event_id, updated_at desc);
create index event_understanding_status_idx
  on public.event_understanding (status, updated_at desc);

comment on table public.event_understanding is
  'On-demand reader explanations, keyed by (event, content_version) and never '
  'by user. One row serves every reader of that event at that material '
  'version. Written only when somebody actually opens the story.';

alter table public.event_understanding enable row level security;
-- No policy: service role only. Readers reach this through a server function
-- that has already checked their session, the same way digests do.
revoke all on public.event_understanding from public, anon, authenticated;
grant all on public.event_understanding to service_role;

-- ---------------------------------------------------------------------------
-- The claim
-- ---------------------------------------------------------------------------
--
-- Returns one of:
--   'won'        -- caller owns the generation and must settle the row
--   'generating' -- somebody else owns it; wait and re-read
--   'ready'      -- already generated; read the row
--   'failed'     -- generation failed too many times; do not retry
--
-- p_stale_after is retained for signature compatibility. An old claim may
-- already have paid the provider; recovery requires an operator to reconcile
-- the ledger before marking it failed. Readers never retake it based on age.
create function public.claim_event_understanding(
  p_event_id uuid,
  p_content_version text,
  p_max_attempts integer default 3,
  p_stale_after interval default '10 minutes'
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  existing public.event_understanding;
  inserted integer;
begin
  -- The insert is the lock. Two concurrent callers both reach this statement;
  -- the primary key means exactly one of them inserts.
  insert into public.event_understanding
    (event_id, content_version, status, attempts, claimed_at)
  values (p_event_id, p_content_version, 'generating', 1, now())
  on conflict (event_id, content_version) do nothing;

  -- GET DIAGNOSTICS rather than FOUND: an `on conflict do nothing` that
  -- conflicts still leaves FOUND true from the statement's own execution in
  -- some server versions, and "did I insert a row" is the entire question here.
  get diagnostics inserted = row_count;
  if inserted = 1 then
    return 'won';
  end if;

  select * into existing
    from public.event_understanding
   where event_id = p_event_id and content_version = p_content_version
   for update;

  if existing.status = 'ready' then
    return 'ready';
  end if;

  if existing.status = 'failed' then
    if existing.attempts >= p_max_attempts then
      return 'failed';
    end if;
    update public.event_understanding
       set status = 'generating', attempts = existing.attempts + 1,
           claimed_at = now(), updated_at = now()
     where event_id = p_event_id and content_version = p_content_version;
    return 'won';
  end if;

  -- A generating row stays claimed, regardless of age.
  return 'generating';
end;
$fn$;

revoke all on function public.claim_event_understanding(uuid, text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_event_understanding(uuid, text, integer, interval)
  to service_role;

-- ---------------------------------------------------------------------------
-- Feature label
-- ---------------------------------------------------------------------------
--
-- Every production model call carries a label; `understand_generation` is the
-- one this migration creates. 'unknown' stays in the constraint because rows
-- written before 0053 still exist and are honestly unattributable -- confirmed
-- on 2026-09-12: the newest unknown row is 2026-09-04T03:42, the first labelled
-- row is 2026-09-04T08:10, and there is nothing in between. Those rows are
-- history, not a live untagged path.
alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature_check;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature_check
  check (feature in (
    'cluster', 'analyse', 'enrich', 'translate', 'impact', 'ask', 'probe',
    'understand_generation', 'unknown'
  ));

-- Both `reserve_ai_tokens` and `settle_ai_tokens` fold an unrecognised label to
-- 'unknown' / leave it unchanged, so they must learn the new one -- otherwise
-- every on-demand generation would land back in the Unattributed bucket this
-- redesign exists to empty. Patched in place, preserving each function's
-- limits, grants and signature: the same technique 0070 used, and for the same
-- reason (these functions have been redefined five times and the installed
-- text, not this repo, is the authority on what they currently are).
do $$
declare
  entry record;
  definition text;
begin
  for entry in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'reserve_ai_tokens', 'ai_spend_this_month', 'ai_credit_balance',
      'ai_spend_windows', 'admin_cost_breakdown', 'admin_cost_by_model', 'settle_ai_tokens'
    )
  loop
    definition := pg_get_functiondef(entry.oid);
    if position('''understand_generation''' in definition) = 0 then
      -- Post-0070 text.
      definition := replace(
        definition,
        '''ask'',''probe''',
        '''ask'',''probe'',''understand_generation'''
      );
      definition := replace(
        definition,
        '''ask'', ''probe''',
        '''ask'', ''probe'', ''understand_generation'''
      );
      -- 0053's own text, for any deployment that never took 0070's widening.
      if position('''understand_generation''' in definition) = 0 then
        definition := replace(
          definition,
          '''impact'',''ask''',
          '''impact'',''ask'',''understand_generation'''
        );
      end if;
    end if;
    execute definition;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------
--
-- Two, because they roll back different things.
--
--   understand_on_demand   -- serve and generate from this table. OFF means the
--                             reader path behaves exactly as it does today.
--   understand_in_analysis -- whether the background pass still writes the long
--                             prose. ON preserves current behaviour. Turning it
--                             off is the change that actually saves the money,
--                             and it is reversible without a deploy.
--
-- Shipped as two so that "start serving on demand" and "stop paying in the
-- background" are separate decisions, taken in that order, with a working
-- product at every step. Both default to today's behaviour.
insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  ('understand_on_demand',
   'Understand on demand',
   'Serve the long explanation from event_understanding, generating it the first time a reader opens an uncached story.',
   false, 100),
  ('understand_in_analysis',
   'Understand written during analysis',
   'Keep writing the long reader article in the background analysis pass. Turn off once on-demand generation is proven.',
   true, 100)
on conflict (key) do nothing;
