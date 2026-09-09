-- nyuz -- reversible account deletion
--
-- A deletion request is a thirty-day quiet period, not an immediate cascade.
-- The authentication user and every owned row remain recoverable during that
-- window, while `notification_preferences.paused` removes the reader from
-- matching, alerts, digest scheduling and source demand immediately.

begin;

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_previous_paused boolean not null default false;

create index if not exists profiles_deletion_due_idx
  on public.profiles (deletion_requested_at)
  where deletion_requested_at is not null;

comment on column public.profiles.deletion_requested_at is
  'Account is paused now and permanently deleted after 30 days unless restored by sign-in (0074).';
comment on column public.profiles.deletion_previous_paused is
  'The reader pause state restored if a soft-deleted account returns during its grace period.';

-- These columns drive permanent deletion and cannot be writable through the
-- broad owner profile update policy inherited from 0002.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.id                       := old.id;
  new.email                    := old.email;
  new.created_at               := old.created_at;
  new.welcomed_at              := old.welcomed_at;
  new.paused_notified_at       := old.paused_notified_at;
  new.auto_paused_at           := old.auto_paused_at;
  new.deletion_requested_at    := old.deletion_requested_at;
  new.deletion_previous_paused := old.deletion_previous_paused;
  return new;
end;
$fn$;

-- Atomically records the grace period and removes every future delivery path.
-- Already-queued deliveries are retired as failed because the delivery enum has
-- no cancelled state; retaining them as queued would send stale mail on restore.
create or replace function public.request_account_deletion(p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  requested_at timestamptz;
  was_paused boolean;
begin
  if exists (
    select 1
      from public.subscriptions s
     where s.user_id = p_user
       and s.stripe_subscription_id is not null
       and s.cancel_at_period_end is not true
  ) then
    raise exception 'active_subscription';
  end if;

  select p.deletion_requested_at
    into requested_at
    from public.profiles p
   where p.id = p_user
   for update;

  if not found then
    raise exception 'account_not_found';
  end if;

  if requested_at is not null then
    return requested_at;
  end if;

  select coalesce(np.paused, false)
    into was_paused
    from public.notification_preferences np
   where np.user_id = p_user;

  requested_at := now();

  update public.profiles
     set deletion_requested_at = requested_at,
         deletion_previous_paused = coalesce(was_paused, false),
         auto_paused_at = null
   where id = p_user;

  update public.notification_preferences
     set paused = true,
         updated_at = requested_at
   where user_id = p_user;

  update public.deliveries d
     set status = 'failed',
         last_error = 'Account deletion requested',
         next_attempt_at = null
    from public.digests dg
   where d.digest_id = dg.digest_id
     and dg.user_id = p_user
     and d.status = 'queued';

  return requested_at;
end;
$fn$;

-- Presence calls this after a returning reader reaches the dashboard. The
-- original manual-pause choice is restored instead of assuming every return
-- means briefings should resume.
--
-- Restoration is gated on `last_sign_in_at` being newer than the request. The
-- session that asked for deletion outlives the request -- Settings signs out,
-- but a reader who closes the tab instead keeps a valid token -- and every
-- dashboard route mounts the shell, which pings presence. Without this gate the
-- first navigation after clicking delete would quietly undo it. Only a genuine
-- return, meaning a fresh sign-in, counts as changing their mind.
create or replace function public.restore_account_deletion(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  was_paused boolean;
begin
  select p.deletion_previous_paused
    into was_paused
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = p_user
     and p.deletion_requested_at is not null
     and u.last_sign_in_at > p.deletion_requested_at
   for update of p;

  if not found then
    return false;
  end if;

  update public.notification_preferences
     set paused = coalesce(was_paused, false),
         updated_at = now()
   where user_id = p_user;

  update public.profiles
     set deletion_requested_at = null,
         deletion_previous_paused = false,
         last_seen_at = now()
   where id = p_user;

  return true;
end;
$fn$;

-- Invoked by the daily dormant-maintenance stage. Deleting auth.users is the
-- single canonical cascade: profiles and every user-owned row follow it, while
-- anonymised billing ledger facts survive as designed.
create or replace function public.purge_expired_account_deletions(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  with due as materialized (
    select u.id
      from auth.users u
      join public.profiles p on p.id = u.id
     where p.deletion_requested_at <= now() - interval '30 days'
     order by p.deletion_requested_at asc
     limit greatest(p_limit, 0)
     for update of u skip locked
  )
  delete from auth.users u
   using due
   where u.id = due.id;

  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

revoke all on function public.request_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.restore_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_account_deletions(integer)
  from public, anon, authenticated;

grant execute on function public.request_account_deletion(uuid) to service_role;
grant execute on function public.restore_account_deletion(uuid) to service_role;
grant execute on function public.purge_expired_account_deletions(integer) to service_role;

commit;
