import { TOPIC_POOL } from "@/lib/topics-pool";
import {
  isValidTopic,
  topicSlug,
  type TopicRejection,
  type ValidatedTopic,
  validateTopicLabel,
} from "@/lib/topics";

/**
 * The editorial topic list, and what a reader is allowed to follow.
 *
 * These used to be the same question. `TOPIC_POOL` was the *only* thing anybody
 * could follow: onboarding accepted free text, `keepCoveredTopics` silently
 * dropped anything outside the pool on save, and stage 5 dropped it again at
 * match time. The stated reason was honesty — a topic with no sources behind it
 * implies coverage that does not exist — and the reasoning was sound for a
 * matcher that could only join `event_topics`, which analysis filled from this
 * same pool.
 *
 * It is no longer sound, because there is now a second route to an event that
 * costs nothing per reader (`events.tags`, written once by the shared analysis
 * pass — see 0049). So the two questions have come apart:
 *
 *   `isPredefinedTopic`  is this in the model's classification vocabulary?
 *                        Still the pool, still bounded, still the thing that
 *                        keeps the analysis prompt a fixed size.
 *
 *   `keepUsableTopics`   may a reader follow this? Now: anything well-formed.
 *
 * Following a subject nyuz has thin coverage of is a statement about the
 * future, not a false claim about the present. The honest handling is an empty
 * state that says so, plus the demand signal that eventually fixes it — not a
 * refusal to save.
 */
const PREDEFINED = new Set(TOPIC_POOL.map((label) => topicSlug(label)));

/**
 * Whether a label is one of the seeded editorial topics.
 *
 * This is the vocabulary the analyser classifies into, so it must stay a fixed
 * list a human curated. It is NOT a permission check on what a reader may
 * follow — it was, and conflating the two is what made "Nepal" unsaveable.
 */
export function isPredefinedTopic(label: string): boolean {
  return PREDEFINED.has(topicSlug(label));
}

export type KeptTopic = ValidatedTopic & { predefined: boolean };

export type TopicIntake = {
  /** Well-formed topics, first spelling of each slug, in the reader's order. */
  kept: KeptTopic[];
  /** What was refused and why, so a caller can say rather than silently drop. */
  refused: { label: string; reason: TopicRejection }[];
};

/**
 * What a save of a whole topic list should actually DO.
 *
 *   replace  bring `user_topics` in line with the list
 *   clear    the reader asked to follow nothing, so follow nothing
 *   refuse   the list named no usable subject, so change nothing and say so
 *
 * The third case is the one that used not to exist. `replaceTopics` branched on
 * `kept.length === 0` alone, so a request whose every entry had been refused --
 * `["!!"]`, `["   "]`, a stale tab holding one mangled label -- fell into the
 * same arm as `[]` and deleted every follow the reader had, then answered
 * `{ ok: true }`. A client bug destroyed a configuration with no error and no
 * way back. Empty and unusable are different claims: one says "none of these",
 * the other says "these are not subjects".
 */
export type TopicSaveIntent = "replace" | "clear" | "refuse";

export function topicSaveIntent(labels: string[], intake: TopicIntake): TopicSaveIntent {
  if (intake.kept.length > 0) return "replace";
  return labels.length === 0 ? "clear" : "refuse";
}

/**
 * Normalises a reader's list into canonical topics.
 *
 * Order is preserved because order is the weighting the product has — the tail
 * past a plan limit is what gets paused — so a save followed by a load must not
 * reshuffle it. Duplicates are collapsed by slug rather than by label, which is
 * what makes "Nepal", " nepal " and "NEPAL" one entry rather than three.
 */
export function keepUsableTopics(labels: string[]): TopicIntake {
  const seen = new Set<string>();
  const kept: KeptTopic[] = [];
  const refused: { label: string; reason: TopicRejection }[] = [];

  for (const raw of labels) {
    const result = validateTopicLabel(raw);
    if (!isValidTopic(result)) {
      refused.push({ label: raw, reason: result.rejected });
      continue;
    }
    if (seen.has(result.slug)) continue;
    seen.add(result.slug);
    kept.push({ ...result, predefined: PREDEFINED.has(result.slug) });
  }

  return { kept, refused };
}
