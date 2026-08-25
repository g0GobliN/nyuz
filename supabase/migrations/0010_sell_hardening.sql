-- Sell-hardening: Ask quota, signup gate, pause-mail stamp.
--
-- Ask logs are unreachable from the browser (RLS on, no policy). Writes go
-- through the service-role key in askStory. Signups are refused in Postgres
-- so the anon Auth API cannot bypass the flag.

alter table public.profiles
  add column if not exists paused_notified_at timestamptz;

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
  new.id                 := old.id;
  new.email              := old.email;
  new.created_at         := old.created_at;
  new.welcomed_at        := old.welcomed_at;
  new.paused_notified_at := old.paused_notified_at;
  return new;
end;
$fn$;

create table if not exists public.ask_log (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  event_id   uuid        not null,
  created_at timestamptz not null default now()
);

create index if not exists ask_log_user_created_idx
  on public.ask_log (user_id, created_at desc);

alter table public.ask_log enable row level security;

create or replace function public.enforce_signups_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  open boolean;
begin
  select enabled into open
    from public.feature_flags
   where key = 'signups_open';
  if open is not true then
    raise exception 'signups are closed';
  end if;
  return new;
end;
$fn$;

drop trigger if exists enforce_signups_open on auth.users;
create trigger enforce_signups_open
  before insert on auth.users
  for each row execute function public.enforce_signups_open();
