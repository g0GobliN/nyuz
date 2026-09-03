/**
 * JSON posted to the service worker.
 *
 * Two shapes, because two things are being said. An alert is one event that
 * could not wait for `send_at`, so it is its own notice and carries the event's
 * own title. A briefing is a reading session the reader scheduled, so it is one
 * notice that names its lead stories and opens the feed — the briefing itself
 * lives in the email and the dashboard, and reproducing it as N OS notifications
 * is how a reader ends up turning notifications off for good.
 */

export type StoryPush = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export function storyPush(input: {
  title: string;
  why: string;
  href: string;
  eventId: string;
  breaking?: boolean;
}): StoryPush {
  const why = input.why.trim();
  return {
    title: input.breaking ? `Breaking · ${input.title}` : input.title,
    body: why || "Open to read the story.",
    url: input.href,
    tag: input.eventId,
  };
}

/** How much of a headline survives into a notification body before the OS clips it. */
const LEAD_TITLE_MAX = 60;

/** Headlines named in the body. Two fits one line on most phones; three does not. */
const LEAD_COUNT = 2;

export type PartOfDay = "morning" | "afternoon" | "evening";

/** The same three bands the dashboard greeting uses, so the product agrees with itself. */
export function partOfDay(hour: number | null): PartOfDay | null {
  if (hour === null || !Number.isFinite(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function clip(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= LEAD_TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, LEAD_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * One notice for a whole briefing.
 *
 * `tag` is the digest id rather than an event id, so a delivery that is retried
 * replaces the notice instead of stacking a second copy beside it.
 *
 * `total` is what the reader actually got, not what they asked for: it is used
 * to count what the body does not name, and promising eighteen more stories
 * when the briefing holds twelve is the kind of small lie that costs the whole
 * notification.
 */
export function briefingPush(input: {
  titles: string[];
  total: number;
  href: string;
  tag: string;
  when?: PartOfDay | null;
}): StoryPush {
  const when = input.when ? `${input.when} ` : "";
  const named = input.titles
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, LEAD_COUNT);
  const rest = Math.max(0, input.total - named.length);

  return {
    title: `Your ${when}nyuz is ready`,
    body: bodyFor(named.map(clip), rest),
    url: input.href,
    tag: input.tag,
  };
}

function bodyFor(named: string[], rest: number): string {
  const more = `${rest} more ${rest === 1 ? "story" : "stories"}`;
  if (named.length === 0) {
    return rest === 0 ? "Open to read it." : `${more[0]?.toUpperCase()}${more.slice(1)}.`;
  }
  if (rest === 0) {
    return `${named.join(" and ")}.`;
  }
  return `${named.join(", ")}, and ${more}.`;
}
