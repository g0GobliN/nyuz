import type { Subscription } from "@/lib/supabase/types";

export const ACCOUNT_DELETION_GRACE_DAYS = 30;

export function deletionRequiresCancellation(
  subscription:
    Pick<Subscription, "stripe_subscription_id" | "cancel_at_period_end"> | null | undefined,
): boolean {
  return Boolean(subscription?.stripe_subscription_id && !subscription.cancel_at_period_end);
}

/**
 * The moment the account stops being recoverable.
 *
 * `purge_expired_account_deletions` compares `deletion_requested_at` against
 * `now() - interval '30 days'`, so this is the same arithmetic on the client
 * side of the same fact — the date shown to the reader has to be the date the
 * sweep will act on, or the promise made in Settings is not the one kept.
 */
export function deletionDeadline(requestedAt: string | Date): Date {
  const requested = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  return new Date(requested.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
}
