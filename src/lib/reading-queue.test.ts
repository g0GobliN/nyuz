import { describe, expect, it } from "vitest";
import { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/feedback-store";
import { buildQueue, type QueueItem } from "@/lib/reading-queue";

/**
 * The pager is how a reader gets through fifty stories without going back to
 * the list fifty times, which makes it the thing standing between them and a
 * story they never see. Every case below is one where a wrong answer is silent:
 * a skipped Next, a count that disagrees with the list they came from, or a
 * pager that empties itself the moment they press a button on the page.
 */

const items: QueueItem[] = [
  { id: "a", title: "First", topics: ["ai"] },
  { id: "b", title: "Second", topics: ["chips"] },
  { id: "c", title: "Third", topics: ["ai", "policy"] },
];

const opts = (over: Partial<Parameters<typeof buildQueue>[2]> = {}) => ({
  label: "your nyuz",
  respectsFeedback: true,
  feedback: EMPTY_FEEDBACK,
  ...over,
});

const feedback = (over: Partial<FeedbackState>): FeedbackState => ({ ...EMPTY_FEEDBACK, ...over });

describe("buildQueue", () => {
  it("walks the list in order, and stops at both ends", () => {
    const first = buildQueue(items, "a", opts());
    expect(first.prev).toBeNull();
    expect(first.next?.id).toBe("b");
    expect(first.position).toBe(1);

    const middle = buildQueue(items, "b", opts());
    expect(middle.prev?.id).toBe("a");
    expect(middle.next?.id).toBe("c");
    expect(middle.position).toBe(2);

    const last = buildQueue(items, "c", opts());
    expect(last.prev?.id).toBe("b");
    expect(last.next).toBeNull();
    expect(last.position).toBe(3);
  });

  it("carries the headline, not just the id", () => {
    // The decision at the foot of a story is whether the next one is worth the
    // time, and nobody can make it from an arrow.
    expect(buildQueue(items, "a", opts()).next?.title).toBe("Second");
  });

  it("gives no pager for a story that is not in the list", () => {
    // A shared link or a search result: there is no list to walk, and inventing
    // one would send the reader somewhere they never asked to go.
    const queue = buildQueue(items, "elsewhere", opts());
    expect(queue).toEqual({ position: 0, total: 0, prev: null, next: null, label: "" });
  });

  it("gives no pager before the story is known", () => {
    expect(buildQueue(items, undefined, opts()).total).toBe(0);
  });

  it("counts what the reader can actually see on the list they came from", () => {
    // "2 of 3" under a feed showing two cards reads as a bug in the briefing.
    const queue = buildQueue(items, "a", opts({ feedback: feedback({ dismissed: ["b"] }) }));
    expect(queue.total).toBe(2);
    expect(queue.next?.id).toBe("c");
  });

  it("skips over muted topics rather than opening them", () => {
    const queue = buildQueue(items, "a", opts({ feedback: feedback({ mutedTopics: ["chips"] }) }));
    expect(queue.next?.id).toBe("c");
    expect(queue.total).toBe(2);
  });

  it("keeps the story being read even once it is dismissed from this page", () => {
    // Dismissing from the story page must not empty the pager underneath the
    // reader — they lose their place and the way on in the same click.
    const queue = buildQueue(items, "b", opts({ feedback: feedback({ dismissed: ["b"] }) }));
    expect(queue.position).toBe(2);
    expect(queue.total).toBe(3);
    expect(queue.next?.id).toBe("c");
  });

  it("leaves lists alone that their own page does not filter", () => {
    // Alerts are a delivery record. A dismissal on the feed says nothing about
    // whether an alert was sent.
    const queue = buildQueue(
      items,
      "a",
      opts({ respectsFeedback: false, feedback: feedback({ dismissed: ["b"] }) }),
    );
    expect(queue.total).toBe(3);
    expect(queue.next?.id).toBe("b");
  });

  it("offers nothing to page through when the list holds one story", () => {
    const queue = buildQueue([items[0]!], "a", opts());
    expect(queue.total).toBe(1);
    expect(queue.prev).toBeNull();
    expect(queue.next).toBeNull();
  });
});
