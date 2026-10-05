import { PlanAccessError } from "./plan-access";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { currentPlan } from "./plan-access";
import { PLAN_LIMITS } from "../plans";

export const loadTopicControls = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }) => {
    const { data, error } = await context.actor.db
      .from("user_topics")
      .select("topic_id, importance, keywords, exclude_keywords, topics(slug)")
      .eq("user_id", context.actor.id);
    if (error) throw new PlanAccessError(error.message);
    return data ?? [];
  });

/**
 * Prioritize and exclude terms share one pool, because the thing being sold is
 * "how finely can I tune a topic" and the reader experiences it as one number.
 * Two pools would let a Plura reader hold 50 + 50 and make the counter lie.
 */
const combined = (input: { keywords: string[]; excludeKeywords: string[] }): string[] => [
  ...input.keywords,
  ...input.excludeKeywords,
];

export const saveTopicControls = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => {
    const shape = z.object({
      topicId: z.string().uuid(),
      importance: z.enum(["everything", "notable", "only_major"]),
      keywords: z.array(z.string().trim().min(1).max(80)).max(100),
      excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(100),
    });
    const parsed = shape.parse(input);
    // The per-plan ceiling is checked in the handler against the reader's real
    // plan — a validator cannot read the actor, and a hard-coded 100 here would
    // be the display value pretending to be the guard.
    return parsed;
  })
  .handler(async ({ context, data }) => {
    const plan = PLAN_LIMITS[await currentPlan(context.actor)];
    if (plan.notificationControl === "basic")
      throw new PlanAccessError("Per-topic controls are available on Plura and Omni.");

    // Every plan tunes its topics now — that is the ladder the product runs
    // on. The dial is the Plura+ rung; the words are the free taste. A save
    // beyond the plan's pool is refused whole, never silently truncated: the
    // reader is looking at the panel, so the answer has to be readable too.
    if (combined(data).length > plan.topicKeywords)
      throw new PlanAccessError(
        plan.topicKeywords === PLAN_LIMITS.uno.topicKeywords
          ? `Your plan allows ${plan.topicKeywords} keywords per topic. Plura allows 50.`
          : `Your plan allows ${plan.topicKeywords} keywords per topic. Omni allows 100.`,
      );

    // The importance dial stays a Plura+ entitlement (the early return above
    // already removed basic plans, so TS narrows the comparison away). A stale
    // tab cannot smuggle a dial value into a plan whose panel never showed one.
    const importance = data.importance;

    const { error } = await context.actor.db
      .from("user_topics")
      .update({
        importance,
        keywords: data.keywords,
        exclude_keywords: data.excludeKeywords,
      })
      .eq("user_id", context.actor.id)
      .eq("topic_id", data.topicId);
    if (error) throw new PlanAccessError(error.message);
    return { ok: true };
  });
