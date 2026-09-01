# Account deletion runbook

Use this operator procedure for every deletion request until self-service deletion ships. Never delete the Supabase authentication user first: that cascades the local subscription row and removes the Stripe identifiers needed to stop billing.

1. Verify the requester owns the email address and record the Supabase user UUID. Export their data first if they requested a copy.
2. Read `subscriptions` for that UUID and record `stripe_customer_id`, `stripe_subscription_id`, `status`, and `cancel_at_period_end` in the support ticket.
3. If `stripe_subscription_id` is present, open that exact subscription in the production Stripe Dashboard. Cancel it immediately (not only at period end) and record the Stripe cancellation result. Do not search by display name.
4. Wait for the signed `customer.subscription.deleted` webhook to appear as processed in `stripe_events`. Confirm the local subscription is `plan = 'free'`, `status = 'canceled'`, and `stripe_subscription_id is null`. If the webhook fails, retry it from Stripe; do not continue to deletion while billing is active or uncertain.
5. Check Stripe for any other active/trialing/past-due Nyuz subscription on the same customer. Cancel any duplicate before continuing. This is a safety check for historical data; the application now prevents creating a second subscription.
6. Delete the user from Supabase Authentication using the production dashboard. `profiles.id` references `auth.users` with `on delete cascade`, and the user-owned application tables cascade from `profiles`. Accounting rows deliberately retain non-identifying financial facts with `user_id = null`.
7. Verify the authentication user, profile, subscription, notification preferences, digests, deliveries, custom-source memberships, Telegram account, push subscriptions, and saved/feedback rows are gone. Verify again in Stripe that no subscription for the customer is billable.

Recovery rules:

- If Stripe cancellation fails, stop and retry; the account remains intact and recoverable.
- If local webhook synchronization fails, keep the account and replay the Stripe event.
- If Supabase deletion fails after Stripe cancellation, retry the deletion. The user may temporarily retain a Free account but cannot be charged.
- Never recreate or manually fake a webhook row. Replay the signed event from Stripe so idempotency and audit state remain correct.
