-- nyuz — billing identifiers and webhook idempotency
--
-- 0001 designed `subscriptions` with a plan, a status and a period end, which is
-- everything the app needs to *read*. It has no way to be written from a payment
-- provider, because there was no provider: nothing tied a row here to anything at
-- Stripe.
--
-- Three things are added.
--
--   1. The Stripe identifiers, so an incoming webhook can find the user it is
--      about. A webhook arrives naming a customer and a subscription, never a
--      Supabase user id.
--   2. `stripe_events`, so a redelivered webhook is a no-op. Stripe retries for
--      up to three days and explicitly does not guarantee delivery exactly once;
--      without this, one retried `invoice.payment_failed` sends the reader a
--      second "your card was declined" email for a card that was fine.
--   3. `profiles.welcomed_at`, so the welcome email is sent once per account
--      rather than on every visit to the page that triggers it.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

-- Unique rather than merely indexed: two Supabase users sharing one Stripe
-- customer means a webhook cannot say who it is about, and the failure would be
-- silent — the handler would update whichever row it happened to read first.
-- Partial, because `null` is the normal state for everyone on the free plan.
create unique index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_idx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.profiles
  add column if not exists welcomed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Webhook idempotency
-- ---------------------------------------------------------------------------

-- One row per Stripe event id we have finished processing. The handler inserts
-- before doing the work and treats a unique violation as "already done".
--
-- `type` and `received_at` are kept for the audit trail rather than the logic:
-- when a subscription state looks wrong, the question is always which events
-- arrived and in what order.
create table if not exists public.stripe_events (
  event_id    text        primary key,
  type        text        not null,
  received_at timestamptz not null default now()
);

-- No policies at all, by the same rule 0003 uses throughout: this table is
-- written only by the webhook handler with the service-role key, and the absence
-- of a write policy is the write guard. Nothing in the browser has any business
-- reading it either.
alter table public.stripe_events enable row level security;

-- Retention. These rows exist to reject a retry, and Stripe stops retrying after
-- roughly three days, so anything older is dead weight. Not a scheduled job —
-- there is no cron in the database — just an index that makes the eventual
-- cleanup cheap.
create index if not exists stripe_events_received_idx
  on public.stripe_events (received_at);
