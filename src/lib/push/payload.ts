/**
 * JSON posted to the service worker. One object per story, so the OS shows
 * them as separate notices. Dismissing one only clears that notice.
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
