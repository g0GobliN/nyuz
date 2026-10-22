-- nyuz -- the reader's own timezone, from the moment the account exists
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `handle_new_user` (0003) seeded `notification_preferences` with every column
-- at its default, and the default for `timezone` is the literal `'UTC'`
-- (`0001_init.sql:55`; `profiles.timezone` carries the same default at `:38`).
--
-- The browser's own zone was adopted later, and only as far as the dashboard:
-- `prefs-store.ts` reads it into the local copy on hydration and it reaches
-- the account only when the reader finishes the schedule step and that save
-- goes through.
--
-- So a reader who signs up and stops before the schedule step is scheduled
-- from `'UTC'`. The delivery decision (`briefing-delivery-time.md` §6,
-- recommendation 1) keeps option B -- one build per reader at 07:30 in the
-- reader's own zone -- and names this as the one timezone defect the data
-- supports. The build is already per reader; what was missing is the default.
--
-- ---------------------------------------------------------------------------
-- Why the zone is read from the signup, not from the request
-- ---------------------------------------------------------------------------
-- GoTrue creates the auth row, and this trigger fires inside that insert, so
-- `raw_user_meta_data` is the only channel that can reach the first row. The
-- email one-time-code path populates it (`signInWithOtp`'s `options.data`);
-- Google and GitHub cannot, because those accounts are created at the provider
-- callback before any code of ours runs. Those are corrected by
-- `capture_signup_timezone` below, on the first authenticated load that sees a
-- difference -- and only while the reader has not onboarded, which is what
-- makes it a correction of a default rather than an overwrite of a choice.
--
-- ---------------------------------------------------------------------------
-- One gate, so the trigger and the correction cannot disagree
-- ---------------------------------------------------------------------------
-- A stored zone that `nextSlot` cannot resolve returns null and costs the
-- reader every briefing, silently. `raw_user_meta_data` is reader-writable
-- through `updateUser`, and the correction's argument arrives from the browser,
-- so neither value is trusted: both go through `usable_timezone`.
--
-- The gate is `pg_timezone_names`, this database's own tzdata. Measured
-- 2026-10-22 for the pairing that matters: PostgreSQL 16 reports 598 names and
-- Node 22's `Intl.supportedValuesOf("timeZone")` 418, and every one of the 418
-- was present in the catalog -- so a zone a browser reports as its canonical id
-- is a zone this gate keeps. The catalog also carries 180 alias spellings
-- (`Asia/Calcutta`, `US/Eastern`) that `supportedValuesOf` omits and that
-- `isSupportedTimezone` deliberately accepts; they pass here too.
--
-- `Factory` is excluded by name because it is the one catalog entry `Intl`
-- refuses, and `nextSlot` would return null for it. A gate that admits a value
-- the scheduler cannot use is not a gate.
--
-- What the gate cannot see is tzdata skew: a zone newer than this database's
-- catalog falls back to UTC. That direction is deliberate. UTC schedules a
-- briefing at the wrong local hour; an unresolvable zone schedules none at all,
-- and the wrong hour is the smaller harm.
--
-- `pg_timezone_names` is a stable view over tzdata the server has already
-- loaded, so this costs no I/O and no network.

create or replace function public.usable_timezone(zone text)
returns text
language sql
stable
set search_path = public
as $fn$
  select coalesce(
    (
      select name from pg_timezone_names
       where name = zone
         and name <> 'Factory'
      limit 1
    ),
    'UTC'
  );
$fn$;

comment on function public.usable_timezone(text) is
  'The zone if this database can schedule in it, and UTC otherwise. Never throws.';

-- Left callable, like `is_admin`: it takes no attacker-controlled action and
-- answers with what any caller could determine by reading the same catalog.

-- ---------------------------------------------------------------------------
-- The signup row
-- ---------------------------------------------------------------------------
-- Byte-for-byte the 0003 function it replaces, plus the timezone on both rows
-- that carry one. They are written from the same value so they cannot disagree
-- about where the reader is.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  zone text := public.usable_timezone(new.raw_user_meta_data ->> 'timezone');
begin
  insert into public.profiles (id, display_name, email, timezone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''), zone);

  insert into public.subscriptions (user_id) values (new.id);
  insert into public.notification_preferences (user_id, timezone) values (new.id, zone);
  insert into public.user_roles (user_id) values (new.id);

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The correction, for the signup paths that could not carry a zone
-- ---------------------------------------------------------------------------
-- Google and GitHub create the account at the provider callback with nothing
-- from our browser in it, so those readers still start on the `'UTC'` default.
-- This is the writer for them, and it is deliberately narrow.
--
-- **It never overwrites a choice.** `onboarded_at` is the product's own record
-- that a reader has been through the schedule step, and it is stamped by the
-- same save that writes their timezone: `onboarding.tsx` sends one
-- `update({ ...draft, onboarded: true })`, and `savePreferences` writes the
-- profile stamp and the schedule row from it. A reader who has not onboarded
-- cannot have chosen a zone through the product at all -- `/dashboard`
-- redirects to `/onboarding` until `onboarded` is true, and the schedule step
-- is the first place a zone can be chosen.
--
-- **And it only ever corrects the default.** The zone is a guess, so the second
-- thing this must not do is replace a better guess with a worse one: an email
-- signup already carried the browser's zone, and a reader who then opens the
-- dashboard from a trip must keep the zone they signed up in. So the stored
-- value has to still be the `'UTC'` column default for the row to be touched,
-- which is exactly the state Google, GitHub and every pre-0123 account are in
-- and a captured zone never is.
--
-- **The guard and the write are one statement**, so a reader who finishes
-- onboarding while this runs cannot have their zone replaced by a stale read:
-- either the capture sees `onboarded_at` set (or a stored zone) and matches
-- nothing, or it wins the race and onboarding's own save lands after it.
--
-- The insert exists for an account created before the trigger wrote a
-- preferences row at all. It is a no-op everywhere else, and the same
-- `onboarded_at` predicate guards it.

create or replace function public.capture_signup_timezone(p_user uuid, p_zone text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  offered text := public.usable_timezone(p_zone);
  stored  text;
begin
  insert into public.notification_preferences (user_id, timezone)
  select p_user, offered
    from public.profiles p
   where p.id = p_user
     and p.onboarded_at is null
  on conflict (user_id) do nothing;

  update public.notification_preferences np
     set timezone = offered,
         updated_at = now()
    from public.profiles p
   where np.user_id = p_user
     and p.id = p_user
     and p.onboarded_at is null
     and np.timezone = 'UTC'
  returning np.timezone into stored;

  -- Mirrored onto `profiles`, which the trigger also writes. Two columns
  -- holding one fact must not be left disagreeing for the next reader of them.
  if stored is not null then
    update public.profiles p
       set timezone = stored
     where p.id = p_user
       and p.onboarded_at is null;
  end if;

  -- What the account holds now, which is the stored value whether this call
  -- wrote it or the guard refused.
  select np.timezone into stored
    from public.notification_preferences np
   where np.user_id = p_user;

  return stored;
end;
$fn$;

-- `capture_signup_timezone` writes. 0036's lesson applies: revoking from
-- `anon, authenticated` alone removes grants those roles never held directly
-- and leaves the default PUBLIC grant standing, which reads like a lock and
-- does nothing. The only caller is the server function holding the service-role
-- key, behind `signedInOnly`.
revoke all on function public.capture_signup_timezone(uuid, text)
  from public, anon, authenticated;
grant execute on function public.capture_signup_timezone(uuid, text) to service_role;

comment on function public.capture_signup_timezone(uuid, text) is
  'Stores the reader''s browser zone while the account still holds its signup default. Refuses once the reader has onboarded. Returns the zone now stored.';
