-- Browser push. One notification per story, not one chunk for the briefing.
-- Endpoints are written only by signed-in server functions (service role).
-- No RLS write policy: a reader must not be able to point someone else's
-- device at their account.

alter type public.delivery_channel add value if not exists 'push';

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text unique not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
