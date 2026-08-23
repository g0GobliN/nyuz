-- Grant the first superadmin.
--
-- Not a migration, and deliberately not run automatically. Migrations are
-- committed and run in every environment; an email address baked into one
-- would hand that person the console in staging, in a teammate's local
-- project, and in anything restored from this repo later.
--
-- Run this ONCE, by hand, in the Supabase SQL editor, after the account has
-- signed up through the normal flow:
--
--   1. Sign up at /auth with the address below.
--   2. Replace the placeholder.
--   3. Run it.
--
-- After that, every further role change goes through Admin → Team, which
-- writes an admin_audit_log row. This file leaves no trace, which is the other
-- reason to use it only for the first one.

insert into public.user_roles (user_id, role, granted_at)
select id, 'superadmin', now()
  from auth.users
 where lower(email) = lower('you@example.com')
on conflict (user_id) do update
  set role = 'superadmin', granted_at = now();

-- Confirm. Zero rows means the address has not signed up yet.
select p.email, r.role, r.granted_at
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
 where r.role in ('admin', 'superadmin');
