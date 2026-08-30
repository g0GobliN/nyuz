-- nyuz -- expose a pending cancellation to the billing page
--
-- The webhook has known Stripe's cancel_at_period_end since 0005, but only used
-- it to pick which email to send -- it was never written to a column, so a
-- reader who cancelled had no way to see "you keep Pro until <date>, then
-- Free" anywhere but that one email. This adds the column so the billing page
-- can say it too.

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.subscriptions.cancel_at_period_end is
  'Set from Stripe''s cancel_at_period_end on customer.subscription.updated '
  '(0041). True between a cancellation and the period actually ending, at '
  'which point customer.subscription.deleted clears it by moving the row to '
  'plan = free.';
