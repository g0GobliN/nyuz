import { topicSlug } from "@/lib/preferences-map";
import { TOPIC_POOL } from "@/lib/topics-pool";

/**
 * Topics we actually have sources for.
 *
 * Onboarding used to accept any string, which implied coverage we do not have.
 * Matching is a join onto `topics` that analysis filled from this same pool, so
 * a free-text "knitting" row can never select an event. The list is the product.
 */
const COVERED = new Set(TOPIC_POOL.map((label) => topicSlug(label)));

export function isCoveredTopic(label: string): boolean {
  return COVERED.has(topicSlug(label));
}

/** Pool labels only, first spelling of each slug, original order. */
export function keepCoveredTopics(labels: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!isCoveredTopic(trimmed)) continue;
    const slug = topicSlug(trimmed);
    if (seen.has(slug)) continue;
    seen.add(slug);
    kept.push(trimmed);
  }
  return kept;
}
