import type { Prefs } from "@/lib/prefs-store";
import { related } from "@/lib/relate";
import type { Story } from "@/lib/story";

/**
 * Which of the sample stories a given person should actually see.
 *
 * This exists because the dashboard used to show all six stories to everybody.
 * Someone who onboarded asking for singing and cooking was shown NVIDIA
 * allocation and the TypeScript checker, each captioned "You follow chips and
 * AI infrastructure" — a claim about them that was simply untrue. A briefing
 * product that ignores the interests it just finished collecting is worse than
 * one that admits it has nothing: the empty state is honest, the mismatch is
 * not.
 *
 * The rule below is deliberately the same one `0001_init.sql` specifies for the
 * real pipeline — topics and keywords select, exclusions veto — so that when
 * ingestion lands, this module is replaced by a database query with the same
 * semantics rather than a different idea of what "relevant" means.
 *
 * It is matching over fixtures, not over real events. What it makes honest is
 * the RELATIONSHIP between what you asked for and what you are shown.
 */

/** Everything about a story a user's term could reasonably match against. */
function haystack(story: Story): string[] {
  return [story.org, ...story.topics];
}

export type Match = {
  story: Story;
  /** The user's own topics that caused this match, in their own words. */
  matched: string[];
};

/**
 * Applies exclusions first and topics second.
 *
 * Order matters and is a product rule, not an implementation detail: an
 * excluded term must not be reintroduced by a topic that happens to overlap it.
 * Someone following "AI" who excluded "NVIDIA" gets the AI stories without the
 * NVIDIA one.
 */
export function matchStories(stories: Story[], prefs: Prefs): Match[] {
  const topics = prefs.topics.filter((t) => t.trim());
  const exclusions = prefs.exclusions.filter((t) => t.trim());

  // No stated interests means nothing has been asked for. Returning everything
  // here would restore exactly the bug this module exists to fix, so the
  // caller gets an empty list and shows the "finish onboarding" state.
  if (topics.length === 0) return [];

  const out: Match[] = [];

  for (const story of stories) {
    const fields = haystack(story);

    if (exclusions.some((term) => fields.some((f) => related(f, term)))) continue;

    const matched = topics.filter((topic) => fields.some((f) => related(f, topic)));
    if (matched.length > 0) out.push({ story, matched });
  }

  return out;
}

/**
 * The "why it matters to you" preamble, built from the topics that actually
 * matched rather than asserted.
 *
 * Every story's `why` used to begin with a hard-coded sentence naming interests
 * the reader may never have chosen. Now the sentence can only name terms the
 * reader typed themselves, so it cannot be wrong.
 */
export function becauseYouFollow(matched: string[]): string {
  const list = matched.slice(0, 3);
  if (list.length === 0) return "";
  if (list.length === 1) return `You follow ${list[0]}.`;
  if (list.length === 2) return `You follow ${list[0]} and ${list[1]}.`;
  return `You follow ${list[0]}, ${list[1]} and ${list[2]}.`;
}
