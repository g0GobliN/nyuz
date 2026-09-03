import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "./guard";
import { TOPIC_POOL } from "@/lib/topics-pool";
import {
  creatableFrom,
  isValidTopic,
  type TopicRejection,
  topicSlug,
  validateTopicLabel,
} from "@/lib/topics";

/**
 * What the topic selector may offer, and what it may not.
 *
 * The selector searches two things at once: the editorial list, and the
 * canonical topics other readers have already created. The second half is what
 * makes reuse visible — somebody typing "Nep" should find the "Nepal" row that
 * already exists rather than minting a near-duplicate — and it is also the half
 * that has to be careful, because those labels are free text somebody typed.
 *
 * The rule is enforced in `search_topics` (0049), not here:
 *
 *   * predefined topics, always;
 *   * the caller's own topics, always, including one nobody else follows —
 *     otherwise they could not find the thing they created yesterday;
 *   * other readers' custom topics only once at least two distinct readers
 *     follow them.
 *
 * Follower counts and creator identity are computed inside that function and
 * never returned. This module cannot leak them because it is never told them.
 *
 * Reuse does NOT depend on visibility. A reader who types "Nepal" while it is
 * still invisible to them still lands on the existing canonical row, because
 * resolution happens server-side under the service role in `replaceTopics`.
 * Suggestion is a discovery affordance; deduplication is an invariant.
 */

const searchInput = z.object({
  query: z.string().max(80),
});

export type TopicSuggestion = {
  slug: string;
  label: string;
  predefined: boolean;
  /** Whether this reader already follows it, so the selector can show a tick. */
  followed: boolean;
};

export type TopicSearch = {
  suggestions: TopicSuggestion[];
  /**
   * The topic the typed text would create, if it is well-formed and does not
   * already exist. Null when the query is empty, malformed, too long, or names
   * something already in `suggestions` — which is what stops the selector
   * offering `+ Follow "Nepal"` underneath an existing Nepal row.
   */
  creatable: { label: string; slug: string } | null;
  /** Why nothing can be created from this text. Null when it can be. */
  rejection: TopicRejection | null;
};

/** Suggestions returned. Enough to fill the list, few enough to scan. */
const LIMIT = 20;

export const searchTopics = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => searchInput.parse(input))
  .handler(async ({ data, context }): Promise<TopicSearch> => {
    const { actor } = context;
    const query = data.query.trim();

    if (query === "") {
      return { suggestions: starters(), creatable: null, rejection: null };
    }

    const { data: rows, error } = await actor.db.rpc("search_topics", {
      p_user_id: actor.id,
      p_query: query,
      p_limit: LIMIT,
    });

    // A failed search must not block following something. The reader loses the
    // suggestion list for one keystroke and keeps the create action, which is
    // the half of this screen they cannot work around.
    if (error) console.warn(`searchTopics: ${error.message}`);

    const suggestions: TopicSuggestion[] = (rows ?? []).map((row) => ({
      slug: row.slug,
      label: row.label,
      predefined: row.kind === "predefined",
      followed: row.followed,
    }));

    const validated = validateTopicLabel(query);
    if (!isValidTopic(validated)) {
      return { suggestions, creatable: null, rejection: validated.rejected };
    }

    return {
      suggestions,
      creatable: creatableFrom(
        query,
        suggestions.map((s) => s.slug),
      ),
      rejection: null,
    };
  });

/**
 * What an empty search box offers.
 *
 * The editorial list, from the bundle rather than the database — an empty query
 * is not a search, and a round trip to render the starting state would make the
 * screen appear to load when it has nothing to load. Custom topics are not
 * offered here on purpose: a reader has to look for one, so browsing cannot
 * surface a stranger's phrasing to somebody who was not searching for it.
 */
function starters(): TopicSuggestion[] {
  return TOPIC_POOL.map((label) => ({
    slug: topicSlug(label),
    label,
    predefined: true,
    followed: false,
  }));
}
