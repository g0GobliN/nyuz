import type { FeedbackState } from "@/lib/feedback-store";

/**
 * Where a story sits in the list a reader is working through.
 *
 * Pure, and separate from the hook that fetches the list, because this is the
 * part that can be wrong in ways nobody notices: an off-by-one in Next skips a
 * story out of a briefing silently, and a count that disagrees with the list
 * page tells the reader their briefing is longer than it is.
 */

export type QueueItem = { id: string; title: string; topics: string[] };

export type ReadingQueue = {
  /** 1-based place in the list. 0 when this story is not part of it. */
  position: number;
  total: number;
  prev: QueueItem | null;
  next: QueueItem | null;
  /** How the reader would name the list, for "3 of 12 in ___". */
  label: string;
};

export const EMPTY_QUEUE: ReadingQueue = {
  position: 0,
  total: 0,
  prev: null,
  next: null,
  label: "",
};

export function buildQueue(
  items: QueueItem[],
  currentId: string | undefined,
  options: {
    label: string;
    /**
     * Whether dismissals and muted topics take stories out of this list.
     *
     * True only for lists whose own page applies the same filter. A pager that
     * counts cards the reader cannot see where they came from is lying about
     * how much is left.
     */
    respectsFeedback: boolean;
    feedback: FeedbackState;
  },
): ReadingQueue {
  if (!currentId) return EMPTY_QUEUE;

  // The story being read stays in the list even once the reader has dismissed
  // or muted it from this very page — dropping it would empty the pager under
  // them and lose the thread they were following.
  const visible = options.respectsFeedback
    ? items.filter(
        (item) =>
          item.id === currentId ||
          (!options.feedback.dismissed.includes(item.id) &&
            !item.topics.some((topic) => options.feedback.mutedTopics.includes(topic))),
      )
    : items;

  const index = visible.findIndex((item) => item.id === currentId);
  if (index < 0) return EMPTY_QUEUE;

  return {
    position: index + 1,
    total: visible.length,
    prev: visible[index - 1] ?? null,
    next: visible[index + 1] ?? null,
    label: options.label,
  };
}
