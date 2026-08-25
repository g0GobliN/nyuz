-- Telegram delivery. Chat ids are written only by the bot webhook (service
-- role). No RLS write policy: a reader updating their own profile must not be
-- able to point someone else's Telegram at their account.
--
-- connect_nonce is the `start` payload on t.me/bot?start=…. Telegram allows 64
-- characters; 32 hex is inside that and has no punctuation the deep-link parser
-- would eat.

create table public.telegram_accounts (
  user_id              uuid primary key references public.profiles (id) on delete cascade,
  chat_id              text unique,
  connect_nonce        text unique,
  connect_expires_at   timestamptz,
  linked_at            timestamptz
);

alter table public.telegram_accounts enable row level security;
