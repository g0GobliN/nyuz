-- nyuz -- alerts: a daily ceiling instead of a weekly ration
--
-- Personal was 3 per rolling 7 days. Two things were wrong with that.
--
-- The number was chosen as if alerts were expensive. They are not: an alert
-- reuses the shared event analysis and writes `generation_tokens = 0` (see
-- src/lib/pipeline/alerts.ts). Nothing in the AI budget needed protecting, so
-- the cap was doing no work except making a $19 plan feel mean.
--
-- The window was worse than the number. A ROLLING seven days means three
-- alerts on a busy Tuesday buys silence until the FOLLOWING Tuesday — and
-- nothing in the product tells the reader that has happened. Somebody paying
-- to be told when something important happens is instead told nothing,
-- because something important already happened. That is precisely backwards,
-- and it contradicts the promise the product is sold on.
--
-- The rule now: quiet because nothing important happened, never quiet because
-- a quota ran out days ago.
--
--   Free      0            briefing only, unchanged
--   Personal  10 / day     importance >= 6 only, unchanged floor
--   Pro       25 / day     reader chooses the sensitivity
--
-- These are CEILINGS, not targets. Personal still only alerts on events
-- scoring 6 or higher, so a normal day sends zero or one; ten is what an
-- extraordinary day is allowed to reach rather than what a Tuesday looks
-- like. The importance floor is the thing keeping the volume sane, and it is
-- unchanged. The cap is only here so that a scoring bug cannot empty itself
-- into somebody's phone overnight.
--
-- Pro keeps a real ceiling rather than going unlimited for the same reason:
-- 'everything' mode has no importance floor at all, so the cap is the only
-- backstop between a busy news day and an unusable notification tray.
--
-- Only the two `cap`/`quota_window` assignments change. The advisory lock, the
-- duplicate check and the free/importance branches are copied forward
-- unaltered -- this replaces the whole function because Postgres has no way to
-- patch a body, not because the rest was wrong.

create or replace function public.claim_alert(
  p_user_id uuid,
  p_event_id uuid,
  p_importance real
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  plan text;
  used integer;
  cap integer;
  quota_window interval;
begin
  select s.plan into plan
    from public.subscriptions s
   where s.user_id = p_user_id;
  plan := coalesce(plan, 'free');

  if plan = 'free' then
    return 'plan';
  elsif plan = 'personal' then
    -- Unchanged: Personal alerts only on what it would be a problem to miss.
    -- This floor, not the cap, is what keeps the daily count near zero.
    if p_importance < 6 then
      return 'importance';
    end if;
    cap := 10;
    quota_window := interval '24 hours';
  else
    cap := 25;
    quota_window := interval '24 hours';
  end if;

  perform pg_advisory_xact_lock(
    ('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int,
    ('x' || substr(md5(p_user_id::text), 9, 8))::bit(32)::int
  );

  if exists (
    select 1 from public.alert_claims
     where user_id = p_user_id and event_id = p_event_id
  ) then
    return 'duplicate';
  end if;

  select count(*)::integer into used
    from public.alert_claims
   where user_id = p_user_id
     and created_at > now() - quota_window;

  if coalesce(used, 0) >= cap then
    return 'quota';
  end if;

  insert into public.alert_claims (user_id, event_id)
  values (p_user_id, p_event_id);
  return 'ok';
end;
$fn$;

-- `create or replace function` preserves neither grants nor the revoke, so
-- both are restated. 0036 exists because `revoke ... from anon, authenticated`
-- leaves the default PUBLIC grant in place and reads like a lock while doing
-- nothing -- so PUBLIC is named explicitly here, as it is there.
revoke all on function public.claim_alert(uuid, uuid, real) from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real) to service_role;
