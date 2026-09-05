# Account deletion runbook

Readers delete their own account from Settings → Danger zone. `deleteAccount` in `src/lib/server/account.ts` performs the sequence below automatically, in the same order this runbook always prescribed: **cancel Stripe first, delete the authentication user second.** Never invert that. `profiles.id` references `auth.users` with `on delete cascade`, so deleting the authentication user first destroys the `subscriptions` row holding `stripe_subscription_id` — the reader vanishes from the product and keeps being charged, with nothing left to link the charge back to.

The operator procedure below is now the fallback, for the cases self-service cannot reach: a reader who cannot sign in, a deletion that failed partway, or a request arriving by email.

## What self-service does

1. Confirms the typed address matches the account. This guards against a stray click, not against an attacker — the call is already behind `signedInOnly`.
2. Reads `subscriptions` for `stripe_subscription_id`.
3. If a subscription id is present, cancels it immediately via `DELETE /v1/subscriptions/{id}`. Immediate rather than at period end: a subscription outliving the account bills a reader who can no longer sign in.
4. Aborts the whole deletion if cancellation fails, leaving the account intact and recoverable. A `resource_missing` from Stripe is treated as already-cancelled and does not block.
5. Deletes the authentication user, which cascades to every user-owned table. `billing_ledger` deliberately retains non-identifying financial facts with `user_id = null`.

If step 5 fails after step 3 succeeded, the reader is told so and can retry. Billing is already stopped at that point, so the worst case is a Free account that outlives its owner's intent.

## Operator procedure (fallback)

1. Verify the requester owns the email address and record the Supabase user UUID. Export their data first if they requested a copy.
2. Read `subscriptions` for that UUID and record `stripe_customer_id`, `stripe_subscription_id`, `status`, and `cancel_at_period_end` in the support ticket.
3. If `stripe_subscription_id` is present, open that exact subscription in the production Stripe Dashboard. Cancel it immediately (not only at period end) and record the Stripe cancellation result. Do not search by display name.
4. Wait for the signed `customer.subscription.deleted` webhook to appear as processed in `stripe_events`. Confirm the local subscription is `plan = 'uno'`, `status = 'canceled'`, and `stripe_subscription_id is null`. If the webhook fails, retry it from Stripe; do not continue to deletion while billing is active or uncertain.
5. Check Stripe for any other active/trialing/past-due Nyuz subscription on the same customer. Cancel any duplicate before continuing. This is a safety check for historical data; the application now prevents creating a second subscription.
6. Delete the user from Supabase Authentication using the production dashboard. `profiles.id` references `auth.users` with `on delete cascade`, and the user-owned application tables cascade from `profiles`. Accounting rows deliberately retain non-identifying financial facts with `user_id = null`.
7. Verify the authentication user, profile, subscription, notification preferences, digests, deliveries, custom-source memberships, Telegram account, push subscriptions, and saved/feedback rows are gone. Verify again in Stripe that no subscription for the customer is billable.

Recovery rules:

- If Stripe cancellation fails, stop and retry; the account remains intact and recoverable.
- If local webhook synchronization fails, keep the account and replay the Stripe event.
- If Supabase deletion fails after Stripe cancellation, retry the deletion. The user may temporarily retain a Free account but cannot be charged.
- Never recreate or manually fake a webhook row. Replay the signed event from Stripe so idempotency and audit state remain correct.
