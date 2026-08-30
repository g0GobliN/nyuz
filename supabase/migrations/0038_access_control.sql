-- nyuz -- capacity, waitlist and maintenance
--
-- Three levers the operator needs before letting strangers in, and one place
-- that enforces all of them.
--
--   1. A user cap. Let 400 people in and hold the rest.
--   2. A waitlist. Somebody turned away leaves an address; when room appears
--      they are invited and can get in past a cap that is still full.
--   3. Maintenance. Close the doors now, without a deploy.
--
-- WHY THIS IS A TRIGGER ON auth.users
--
-- Signup does not go through this application. A reader signing in with Google
-- or GitHub talks to GoTrue directly, and never touches a server function we
-- wrote. A cap checked in TypeScript would therefore be checked on exactly one
-- of the three signup paths, and bypassed by the two that need no password.
--
-- `before insert on auth.users` is the only point every path passes through.
-- 0010 already established this for the on/off flag; this replaces that
-- function with one that also knows about capacity, maintenance and invites.
-- The UI checks the same conditions first, but only so it can say something
-- useful -- exactly the `viewer.ts` / `guard.ts` split the console uses.
--
-- WHY THE COUNT IS TAKEN UNDER A LOCK
--
-- Two people signing up simultaneously against one remaining seat both read
-- 399 and both proceed. The window is small and the consequence is small, but
-- an off-by-one on a promise the operator made is exactly the kind of bug that
-- is impossible to explain later. One advisory lock on a constant serialises
-- admission; signups are rare enough that contention is not a concern.

-- ---------------------------------------------------------------------------
-- Where the numbers live
-- ---------------------------------------------------------------------------
--
-- `site_settings` rather than a new table: the admin console already renders a
-- form per key, validates against the matching zod schema in
-- src/lib/site-content.ts, and audits the write. A second settings mechanism
-- would need all three again.
--
-- Seeded here so the trigger below has something to read on a database that
-- has never opened the console. `on conflict do nothing` keeps a re-run from
-- resetting an operator's real numbers.

insert into public.site_settings (key, value)
values (
  'site.access',
  jsonb_build_object(
    'userLimit', 400,
    'maintenance', false,
    'maintenanceMessage', 'nyuz is down for a short while. We will be back shortly.',
    'waitlistOpen', true
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The waitlist
-- ---------------------------------------------------------------------------

create table if not exists public.waitlist (
  id           uuid        primary key default gen_random_uuid(),
  -- Stored lower-cased by the insert path. A case-different duplicate is the
  -- same person, and inviting them twice would send two mails.
  email        text        not null unique,
  name         text        not null default '',
  note         text        not null default '',
  created_at   timestamptz not null default now(),
  -- Set when an operator invites them. A non-null value is what lets this
  -- address past a full cap, so it is the closest thing here to a permission.
  invited_at   timestamptz,
  -- Set by the signup trigger when the invite is spent. Kept rather than
  -- deleted: it is the record of who was let in and when.
  signed_up_at timestamptz
);

create index if not exists waitlist_created_idx on public.waitlist (created_at desc);
create index if not exists waitlist_pending_idx
  on public.waitlist (created_at) where invited_at is null;

alter table public.waitlist enable row level security;

-- No policy at all, deliberately. Reading it would expose every applicant's
-- address to any signed-in account, and writing it happens through
-- `joinWaitlist`, which holds the service-role key and lower-cases the address
-- first. Same posture as `cluster_shadow_log` in 0033.

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

create or replace function public.enforce_signups_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  open_flag  boolean;
  access     jsonb;
  user_limit integer;
  in_maint   boolean;
  seats_used integer;
  invited    uuid;
begin
  select enabled into open_flag
    from public.feature_flags
   where key = 'signups_open';
  if open_flag is not true then
    raise exception 'signups are closed';
  end if;

  select value into access
    from public.site_settings
   where key = 'site.access';

  -- Every read is defensive. This function stands between a stranger and an
  -- account, and a malformed settings row must not be able to either lock
  -- everybody out or throw the doors open. Missing or unparseable reads as
  -- "not in maintenance, no limit" -- the state this database was in before
  -- this migration existed.
  in_maint := coalesce((access ->> 'maintenance')::boolean, false);
  if in_maint then
    raise exception 'signups are closed for maintenance';
  end if;

  user_limit := coalesce((access ->> 'userLimit')::integer, 0);
  if user_limit <= 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('nyuz.signup.admission'));

  select count(*)::integer into seats_used from public.profiles;
  if seats_used < user_limit then
    return new;
  end if;

  -- Full. The only way past is an unspent invitation for this address.
  select w.id into invited
    from public.waitlist w
   where w.email = lower(new.email)
     and w.invited_at is not null
     and w.signed_up_at is null
   limit 1;

  if invited is null then
    raise exception 'nyuz is at capacity';
  end if;

  -- Spend it, so one invitation admits one account.
  update public.waitlist
     set signed_up_at = now()
   where id = invited;

  return new;
end;
$fn$;

drop trigger if exists enforce_signups_open on auth.users;
create trigger enforce_signups_open
  before insert on auth.users
  for each row execute function public.enforce_signups_open();

-- ---------------------------------------------------------------------------
-- What the console needs to draw the page
-- ---------------------------------------------------------------------------
--
-- One round trip rather than four counts issued from TypeScript, and it keeps
-- the definition of "a seat" -- a row in profiles -- in the same file as the
-- trigger that enforces it.

create or replace function public.admin_access_state()
returns table (
  seats_used      integer,
  waiting         integer,
  invited_pending integer,
  admitted        integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    (select count(*)::integer from public.profiles),
    (select count(*)::integer from public.waitlist
      where invited_at is null and signed_up_at is null),
    (select count(*)::integer from public.waitlist
      where invited_at is not null and signed_up_at is null),
    (select count(*)::integer from public.waitlist
      where signed_up_at is not null);
$fn$;

-- 0036's lesson: `revoke ... from anon, authenticated` leaves the default
-- PUBLIC grant untouched and reads like a lock while doing nothing. Name
-- PUBLIC explicitly, then grant back only the service role.
revoke all on function public.admin_access_state() from public, anon, authenticated;
grant execute on function public.admin_access_state() to service_role;
revoke all on function public.enforce_signups_open() from public, anon, authenticated;
