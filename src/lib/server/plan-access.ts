import type { Actor } from "./guard";
import { PLAN_LIMITS, PLAN_NAMES, STANDARD_DELIVERY_TIME } from "../plans";
import type { PrefsInput } from "./preferences";

/** Keep actionable validation errors out of the generic HTML error response. */
export class PlanAccessError extends Error {
  readonly statusCode = 400;
}

export async function currentPlan(actor: Actor) {
  const { data, error } = await actor.db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", actor.id)
    .maybeSingle();
  if (error) throw new PlanAccessError("Could not verify your plan. Try again.");
  return data?.plan ?? "uno";
}

export function validatePlanPreferences(plan: keyof typeof PLAN_LIMITS, data: PrefsInput) {
  const limits = PLAN_LIMITS[plan];
  if (data.time !== undefined && !limits.customDeliveryTime && data.time !== STANDARD_DELIVERY_TIME)
    throw new PlanAccessError("Custom delivery time is available on Plura and Omni.");
  if (data.channels?.telegram && !limits.telegram)
    throw new PlanAccessError("Telegram delivery is available on Plura and Omni.");
  if (data.channels?.whatsapp) throw new PlanAccessError("This delivery channel is not available.");
  if (data.breaking === "everything" && limits.notificationControl !== "advanced")
    throw new PlanAccessError("Advanced notification controls are available on Omni.");
  if (data.frequency !== undefined && data.frequency !== "daily")
    throw new PlanAccessError("V1 supports one daily briefing.");
}

export function assertTopicAddition(
  plan: keyof typeof PLAN_LIMITS,
  wanted: string[],
  existing: Set<string>,
) {
  if (wanted.length > PLAN_LIMITS[plan].topics && wanted.some((slug) => !existing.has(slug)))
    throw new PlanAccessError(
      `You've reached ${PLAN_NAMES[plan]}'s ${PLAN_LIMITS[plan].topics}-topic limit.`,
    );
}
