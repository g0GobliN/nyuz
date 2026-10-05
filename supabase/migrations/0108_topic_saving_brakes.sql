-- nyuz -- brakes on the topic-saving path
--
-- Saving a topic is a cheap request that used to do unbounded shared work.
-- `savePreferences` runs the whole of stage 5 (`backfill`) whenever the save
-- genuinely added a follow, and `topics` is minted server-side. Neither was
-- rate-limited, so an account could repeat the expensive half indefinitely:
--
--   add a topic -> remove it -> add it again
--
-- `toAdd` is "wanted and not already followed", so a remove makes the next add
-- new again and `backfill` runs once more. Nothing else stood in the way, and
-- stage 5 is the stage nearest the Workers CPU limit by this codebase's own
-- assessment — it is the only stage whose work grows with the number of
-- subscribers. One account could therefore spend shared compute on demand,
-- which is a cost every other reader pays for.
--
-- Two brakes, both enforced here rather than in a bundle a browser can read:
-- 0036's lesson. A number in application code is a display value, never a
-- guard.
--
--   claim_topic_backfill   one stage-5 run per account per cooldown window
--   topic_creation_room    a global ceiling on minting canonical topic rows
--
-- Neither brake can block FOLLOWING anything. `user_topics` rows are created
-- for topics that already exist — that is the overwhelmingly common case, and
-- the one the shared table exists for. Only minting a brand-new canonical row
-- is limited, so a reader who wants to follow a subject somebody else already
-- typed is never queued behind an attacker.

begin;

-- ---------------------------------------------------------------------------
-- 1. The stage-5 brake
-- ---------------------------------------------------------------------------

-- One row per account holding the last time a save was allowed to run the
-- matcher for it. A row is written by the claim and never deleted except with
-- the account, so the window survives a Worker restart: an in-memory cooldown
-- would reset on every cold start and be no brake at all.
create table if not exists public.topic_backfill_claims (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

comment on table public.topic_backfill_claims is
  'One row per account: when a topic save was last allowed to run stage 5. '
  'Backs claim_topic_backfill(). Written only by that function.';

alter table public.topic_backfill_claims enable row level security;

-- No policy on purpose. Nothing selects this table but the claim function, and
-- a reader has no reason to know their own cooldown. Naming PUBLIC explicitly
-- so the default grant cannot survive the revoke (0036).
revoke all on public.topic_backfill_claims from public, anon, authenticated;
grant all on public.topic_backfill_claims to service_role;

-- The claim itself, so two concurrent saves from one account cannot both pass.
-- The advisory lock serialises them for the length of the transaction, which
-- is the same technique 0082 used for the topic cap: no application check can
-- promise this across two Worker invocations, and a lock can.
create or replace function public.claim_topic_backfill(
  p_user_id uuid,
  p_cooldown_minutes integer default 30
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  window_minutes integer;
begin
  if p_user_id is null then return 'no-user'; end if;

  window_minutes := greatest(0, coalesce(p_cooldown_minutes, 30));

  perform pg_advisory_xact_lock(hashtextextended('backfill:' || p_user_id::text, 0));

  if window_minutes > 0 and exists (
    select 1 from public.topic_backfill_claims
     where user_id = p_user_id
       and claimed_at > now() - make_interval(mins => window_minutes)
  ) then
    return 'cooling-down';
  end if;

  -- The window is consumed even if the matcher then fails. That is the safe
  -- direction: a brake that refunds on failure is a brake an attacker can
  -- spend by making the work fail.
  insert into public.topic_backfill_claims (user_id, claimed_at)
  values (p_user_id, now())
  on conflict (user_id) do update set claimed_at = excluded.claimed_at;

  return 'ok';
end;
$fn$;

revoke all on function public.claim_topic_backfill(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_topic_backfill(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The global minting brake
-- ---------------------------------------------------------------------------

-- `topics` is read WHOLE by three stages on every run — `topicIndex` in
-- `match.ts`, and the vocabulary read in `analyse.ts` and `classify.ts` — so it
-- is shared infrastructure, not one reader's data. 0049's per-account brake
-- (30 rows a day, enforced in `resolveTopics`) bounds one account; it does not
-- bound a hundred accounts, and minting is the only way to grow the table.
--
-- This counts what exists and hands back the room, so the same clamp that
-- already applies per account also applies globally. The limit is passed in
-- rather than hard-coded so it can be moved by a deploy instead of a migration.
--
-- `kind = 'custom'` only: the editorial pool is human-curated and is not
-- growing from anything a reader typed.
create or replace function public.topic_creation_room(p_limit integer default 25000)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select greatest(
    0,
    coalesce(p_limit, 25000) - (select count(*) from public.topics where kind = 'custom')
  );
$fn$;

revoke all on function public.topic_creation_room(integer)
  from public, anon, authenticated;
grant execute on function public.topic_creation_room(integer) to service_role;

commit;