/**
 * Briefing density, and the importance bar it sets.
 *
 * ---------------------------------------------------------------------------
 * Why this is not in the dial component
 * ---------------------------------------------------------------------------
 *
 * The reader turns one slider, 0 to 100. Matching has to turn that number into a
 * minimum `events.importance`, and the two have to agree about what the labels
 * mean — otherwise the dial says "Focused: clear developments in the areas you
 * track" and the query admits something else entirely. So the bands live here, in
 * a module with no React in it, and `density-dial.tsx` renders them rather than
 * owning them.
 *
 * ---------------------------------------------------------------------------
 * Where the thresholds come from
 * ---------------------------------------------------------------------------
 *
 * Not from a curve. Each band's threshold is read off the scoring anchors the
 * model was given in `pipeline/analyse.ts`, by matching the dial's wording to the
 * anchor that says the same thing:
 *
 *   Minimal   "only the things you would regret missing"      -> 6
 *             anchor 6-8: "matters to the whole field. A major release, an
 *             acquisition, an outage or breach with real consequences, a
 *             regulatory decision."
 *
 *   Focused   "clear developments in the areas you track"     -> 3
 *             anchor 3-5: "worth knowing if this is your area. A notable launch,
 *             a funding round." The two sentences are the same sentence.
 *
 *   Broad     "adds context and adjacent industry moves"      -> 1
 *   Deep      "everything with a plausible claim"             -> 0
 *             Both subdivide anchor 0-2, "routine. A point release, a blog post,
 *             a conference talk." Deep takes all of it; Broad drops the floor of
 *             it, the release note with nothing to say.
 *
 * Reading the threshold off the anchors rather than interpolating matters because
 * the anchors are what the scores mean. A linear `(100 - density) / 10` looks
 * principled and puts the default 35 at 6.5, which is above the top of the
 * "worth knowing if this is your area" band — a reader on the default setting
 * would be told they had opted into their own field and then shown almost
 * nothing. The scale is not linear, so the map onto it cannot be either.
 *
 * The bands are also coarse on purpose. Four thresholds for a hundred slider
 * positions is exactly what the reader sees: the label does not change as they
 * drag from 20 to 44, so neither should their briefing.
 */

import { PLAN_LIMITS, type DensityBand } from "@/lib/plans";
import type { PlanTier, TopicImportance } from "@/lib/supabase/types";

export type DensityLevel = {
  key: DensityBand;
  /** Exclusive upper bound, so `density < max` picks the band. */
  max: number;
  label: string;
  detail: string;
  /**
   * Stories a day, as printed on the dial.
   *
   * Display copy. The hard cap digest generation actually applies is `cap`.
   */
  count: string;
  /** Inclusive upper bound of `count`. Digest generation will not exceed this. */
  cap: number;
  /** Minimum `events.importance` that reaches a reader at this setting. */
  threshold: number;
};

const DEEP: DensityLevel = {
  key: "deep",
  max: 101,
  label: "Deep",
  detail: "Everything with a plausible claim on your attention.",
  count: `Up to ${PLAN_LIMITS.uno.storiesPerBriefing}`,
  cap: PLAN_LIMITS.uno.storiesPerBriefing,
  threshold: 0,
};

export const LEVELS: DensityLevel[] = [
  {
    key: "minimal",
    max: 20,
    label: "Minimal",
    detail: "Only the things you would regret missing.",
    count: `Up to ${PLAN_LIMITS.uno.storiesPerBriefing}`,
    cap: PLAN_LIMITS.uno.storiesPerBriefing,
    threshold: 6,
  },
  {
    key: "focused",
    max: 45,
    label: "Focused",
    detail: "Clear developments in the areas you track.",
    count: `Up to ${PLAN_LIMITS.uno.storiesPerBriefing}`,
    cap: PLAN_LIMITS.uno.storiesPerBriefing,
    threshold: 3,
  },
  {
    key: "broad",
    max: 70,
    label: "Broad",
    detail: "Adds context and adjacent industry moves.",
    count: `Up to ${PLAN_LIMITS.uno.storiesPerBriefing}`,
    cap: PLAN_LIMITS.uno.storiesPerBriefing,
    threshold: 1,
  },
  DEEP,
];

export function levelFor(value: number): DensityLevel {
  return LEVELS.find((l) => value < l.max) ?? DEEP;
}

/** The minimum `events.importance` a reader at this density will be shown. */
export function thresholdFor(density: number): number {
  return levelFor(density).threshold;
}

/** How many stories a briefing at this density is allowed to carry. */
export function capFor(density: number, plan: PlanTier = "uno"): number {
  const level = levelFor(density);
  return PLAN_LIMITS[plan]?.storyCaps[level.key] ?? level.cap;
}

/** Honest UI copy: availability can make a briefing shorter, never longer. */
export function countFor(density: number, plan: PlanTier = "uno"): string {
  return `Up to ${capFor(density, plan)}`;
}

/**
 * Per-topic overrides of the dial, from `user_topics.importance`.
 *
 * `notable` is the column default and means "the dial decides", which is what a
 * default should mean — a reader who has never touched a per-topic control gets
 * exactly the bar the slider shows them. The other two are absolute, because a
 * per-topic setting that the global dial could override would not be a control.
 * `only_major` lands on the same anchor Minimal does.
 */
export const TOPIC_FLOOR: Record<TopicImportance, number | null> = {
  everything: 0,
  notable: null,
  only_major: 6,
};

/** The bar for one followed topic: its own, or the dial's where it defers. */
export function floorFor(importance: TopicImportance, densityFloor: number): number {
  return TOPIC_FLOOR[importance] ?? densityFloor;
}
