# Account deletion runbook

Readers delete their own account from Settings → Danger zone. Since migration `0074`, deletion is **reversible for 30 days**: `deleteAccount` in `src/lib/server/account.ts` starts a grace period rather than destroying anything. Nothing is cascaded until the daily dormant sweep purges an expired request.

Two rules replace the old cancel-Stripe-first ordering, and both are enforced in the database:

1. **A live subscription blocks deletion.** `request_account_deletion` raises `active_subscription` while `subscriptions.stripe_subscription_id` is set and `cancel_at_period_end` is not true. The reader cancels in Stripe's portal from Billing first. nyuz no longer cancels Stripe on their behalf — the old flow cancelled and hard-deleted in one click, which left nothing to undo if it was a mistake.
2. **Restoring requires a fresh sign-in.** `restore_account_deletion` only fires when `auth.users.last_sign_in_at` is newer than `deletion_requested_at`, so the session that asked for deletion cannot quietly undo it by navigating to another dashboard page.

## What self-service does

1. Confirms the typed address matches the account. This guards against a stray click, not against an attacker — the call is already behind `signedInOnly`.
2. Reads `subscriptions` and refuses with `reason: "subscription"` if billing is still live, pointing the reader at Billing. The same check is re-run inside the RPC, so a subscription that starts between the two is still caught.
3. Calls `request_account_deletion`, which in one transaction: stamps `profiles.deletion_requested_at`, records the reader's existing pause state in `profiles.deletion_previous_paused`, clears `auto_paused_at`, sets `notification_preferences.paused = true`, and retires queued `deliveries` as `failed`. Pausing is what removes the reader from matching, alerts, digest scheduling and `event_has_demand` — all four already gate on `paused = false`.
4. Shows the reader the exact date the account stops being recoverable, then lets them sign out. They are not signed out automatically: the account is still real, and the date is only visible while they are still on the screen.

## Restoration

Signing in during the window and loading any dashboard page calls `pingPresence`, which calls `restore_account_deletion`. That clears `deletion_requested_at`, restores the reader's _original_ pause preference (not "unpaused" — a reader who had briefings paused before deleting still wants them paused), and stamps `last_seen_at`. The shell reloads once and shows a "welcome back" notice so the reversal is never silent.

Deliveries retired in step 3 are not resurrected. The briefings they carried are stale by then; the next cycle generates current ones.

## Permanent deletion

`purge_expired_account_deletions(p_limit)` runs from the dormant stage of the daily maintenance job (`src/lib/pipeline/dormant.ts`), reported as `deletedAccounts`. It deletes from `auth.users` where `deletion_requested_at <= now() - interval '30 days'`, batched at 100 with `skip locked`. `profiles.id` references `auth.users` with `on delete cascade` and every user-owned table cascades from `profiles`, so that one delete is the whole cascade. `billing_ledger` deliberately retains non-identifying financial facts with `user_id = null`.

To confirm the sweep is working, check the dormant line in the maintenance log: `N expired accounts deleted`.

## Operator procedure (fallback)

For what self-service cannot reach: a reader who cannot sign in, a request arriving by email, or a deletion that must happen immediately rather than in 30 days.

1. Verify the requester owns the email address and record the Supabase user UUID. Export their data first if they requested a copy.
2. Read `subscriptions` for that UUID and record `stripe_customer_id`, `stripe_subscription_id`, `status`, and `cancel_at_period_end` in the support ticket.
3. If `stripe_subscription_id` is present, open that exact subscription in the production Stripe Dashboard and cancel it immediately (not only at period end). Do not search by display name.
4. Wait for the signed `customer.subscription.deleted` webhook to appear as processed in `stripe_events`. Confirm the local subscription is `plan = 'uno'`, `status = 'canceled'`, and `stripe_subscription_id is null`. If the webhook fails, retry it from Stripe; do not continue while billing is active or uncertain.
5. Check Stripe for any other active/trialing/past-due nyuz subscription on the same customer and cancel duplicates. This is a safety check for historical data; the application now prevents creating a second subscription.
6. For a normal request, call `select public.request_account_deletion('<uuid>')` as `service_role` and tell the reader the returned date. For an immediate erasure request, delete the user from Supabase Authentication in the production dashboard — that is the same cascade the sweep performs, 30 days early.
7. Verify. After step 6's immediate path: the authentication user, profile, subscription, notification preferences, digests, deliveries, custom-source memberships, Telegram account, push subscriptions, and saved/feedback rows are gone, and no subscription for the customer is billable in Stripe.

Recovery rules:

- A reader who changes their mind only has to sign in. Do not intervene manually; `restore_account_deletion` restores their original pause state, and clearing `deletion_requested_at` by hand does not.
- If Stripe cancellation fails, stop. The account is untouched and the reader can retry.
- If local webhook synchronization fails, keep the account and replay the Stripe event.
- Never recreate or manually fake a webhook row. Replay the signed event from Stripe so idempotency and audit state remain correct.
