import { useQuery } from "@tanstack/react-query";
import { PLAN_LIMITS } from "@/lib/plans";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PlanTier } from "@/lib/supabase/types";
import { useAuth } from "@/lib/auth";

/**
 * The plan this browser session is actually on.
 *
 * Read straight from `subscriptions` through the browser client rather than a
 * server function: the "own subscription" policy in 0002 already scopes the row
 * to the caller, so the database is doing the authorisation and a server hop
 * would add nothing but latency.
 *
 * Not a security boundary. This decides what the interface says and what it
 * warns about; the plan limits that actually matter are enforced in
 * `savePreferences`, `loadReaders`, `askStory`, and the `enforce_topic_cap`
 * trigger on `user_topics`.
 */

export type PlanState = {
  plan: PlanTier;
  topicLimit: number;
  prioritySourceLimit: number;
  asksPerDay: number;
  retention: string;
  retentionDays: number;
  /**
   * Set when Stripe's `cancel_at_period_end` is true — the plan is still the
   * paid one until this date, then the webhook drops it to free (0041).
   */
  cancelsOn: Date | null;
  /** True while the row is still loading — treat limits as unknown, not exceeded. */
  loading: boolean;
};

type SubscriptionRow = {
  plan: PlanTier;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
};

export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["plan", userId],
    // Signed out has no subscription to read, and firing the query anyway would
    // return an RLS-empty result that is indistinguishable from "free".
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<SubscriptionRow> => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("subscriptions")
        .select("plan, cancel_at_period_end, current_period_end")
        .maybeSingle();

      // Falling back to the most restrictive plan on error is the safe
      // direction: it warns somebody who did not need warning, rather than
      // silently letting an Uno reader build a briefing that will be truncated.
      if (error || !data)
        return { plan: "uno", cancel_at_period_end: false, current_period_end: null };
      return data;
    },
  });

  const plan: PlanTier = data?.plan ?? "uno";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;
  const cancelsOn =
    data?.cancel_at_period_end && data.current_period_end
      ? new Date(data.current_period_end)
      : null;

  return {
    plan,
    topicLimit: limits.topics,
    prioritySourceLimit: limits.prioritySources,
    asksPerDay: limits.asksPerDay,
    retention: limits.retention,
    retentionDays: limits.retentionDays,
    cancelsOn,
    loading: authLoading || isLoading,
  };
}
