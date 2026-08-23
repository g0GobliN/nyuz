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
 * warns about; the plan limits that actually matter are enforced when a briefing
 * is built, against the same row read server-side.
 */

export type PlanState = {
  plan: PlanTier;
  topicLimit: number;
  retention: string;
  /** True while the row is still loading — treat limits as unknown, not exceeded. */
  loading: boolean;
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
    queryFn: async (): Promise<PlanTier> => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("subscriptions")
        .select("plan")
        .maybeSingle();

      // Falling back to the most restrictive plan on error is the safe
      // direction: it warns somebody who did not need warning, rather than
      // silently letting a Free reader build a briefing that will be truncated.
      if (error || !data) return "free";
      return data.plan;
    },
  });

  const plan: PlanTier = data ?? "free";
  const limits = PLAN_LIMITS[plan];

  return {
    plan,
    topicLimit: limits.topics,
    retention: limits.retention,
    loading: authLoading || isLoading,
  };
}
