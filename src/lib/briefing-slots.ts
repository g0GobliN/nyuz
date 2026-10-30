/**
 * A reader's day, as the slots their briefings arrive in.
 *
 * ---------------------------------------------------------------------------
 * The promise this file encodes
 * ---------------------------------------------------------------------------
 *
 * Owner ruling, 2026-10-30, stated twice in one hour: "No change the time
 * 9:30am and 4:30pm" and "change 7:30 to 9:30 and 20:30 to 16:30 thats all
 * permanently everyday."
 *
 * So the product has exactly two slots — a morning edition at 09:30 and an
 * evening edition at 16:30 — in the reader's own zone, on all seven days, for
 * every reader. There is no single "send time" any more, which is why
 * `notification_preferences.send_at` no longer decides the day on its own: it
 * is the *morning* slot, and only for the tiers that are allowed to move it.
 *
 * Two rules follow from that and are enforced here rather than at each call
 * site, because a page that computes its own idea of the schedule is how
 * reader-facing copy ends up naming a time the product does not use:
 *
 *   1. A reader's day is always two slots. `deliveryTimesFor` is total: it
 *      returns two clock times for every plan and every stored value, so no
 *      caller has to decide what a tier is entitled to.
 *   2. Copy reads the slot times from `BRIEFING_SLOTS` (or from `slotLabel`
 *      below) and formats them in the reader's zone. No page writes "09:30" or
 *      "07:30" into a sentence of its own.
 */

import { parseClock } from "@/lib/pipeline/schedule";
import { PLAN_LIMITS } from "@/lib/plans";
import { BRIEFING_SLOTS, EVENING_DELIVERY_TIME, STANDARD_DELIVERY_TIME } from "@/lib/launch-plans";
import type { PlanTier } from "@/lib/supabase/types";

export { BRIEFING_SLOTS, EVENING_DELIVERY_TIME, STANDARD_DELIVERY_TIME };

/**
 * Every clock time a reader's briefings are due at, in their own zone, in the
 * order of their day.
 *
 * `send_at` moves the morning slot only on the tiers that are entitled to move
 * it (`customDeliveryTime`, i.e. Plura and Omni). Everyone else gets the
 * standard 09:30 regardless of what an old row happens to store, which is the
 * defect this replaces: rows carried a 07:30 default from before the ruling and
 * were honoured literally.
 *
 * A reader who deliberately picks 16:30 as their morning time gets one briefing
 * a day, not two at the same instant — the two slots collapse rather than
 * duplicate, because two rows at one `scheduled_for` is not a second edition,
 * it is the same row twice.
 */
export function deliveryTimesFor(plan: PlanTier | string, sendAt: string): string[] {
  const limits = (PLAN_LIMITS as Record<string, (typeof PLAN_LIMITS)["uno"]>)[plan] ?? PLAN_LIMITS.uno;
  const morning = limits.customDeliveryTime ? normalizeClock(sendAt) : STANDARD_DELIVERY_TIME;
  const slots = [morning, EVENING_DELIVERY_TIME].filter(isClock);
  return [...new Set(slots)];
}

/**
 * "Morning" / "Evening" for a slot, from the clock alone.
 *
 * Before noon is the morning edition. This is a label for copy and for the
 * edition header, never a scheduling decision — the scheduler compares the
 * instant it computed, not this word.
 */
export function slotLabel(time: string): "Morning" | "Evening" {
  const clock = parseClock(time);
  return clock !== null && clock.hour < 12 ? "Morning" : "Evening";
}

/** `HH:MM` from a stored value, or "" when it is not a clock at all. */
function normalizeClock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function isClock(value: string): boolean {
  return parseClock(value) !== null;
}
