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

export const saveTopicControls = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    z
      .object({
        topicId: z.string().uuid(),
        importance: z.enum(["everything", "notable", "only_major"]),
        keywords: z.array(z.string().trim().min(1).max(80)).max(20),
        excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(20),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const control = PLAN_LIMITS[await currentPlan(context.actor)].notificationControl;
    if (control === "basic")
      throw new PlanAccessError("Per-topic controls are available on Plura and Omni.");
    if (control !== "advanced" && (data.keywords.length || data.excludeKeywords.length))
      throw new PlanAccessError("Keyword notification rules are available on Omni.");
    const { error } = await context.actor.db
      .from("user_topics")
      .update({
        importance: data.importance,
        ...(control === "advanced"
          ? { keywords: data.keywords, exclude_keywords: data.excludeKeywords }
          : {}),
      })
      .eq("user_id", context.actor.id)
      .eq("topic_id", data.topicId);
    if (error) throw new PlanAccessError(error.message);
    return { ok: true };
  });
