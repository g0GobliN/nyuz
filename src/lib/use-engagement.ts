import { useEffect, useRef } from "react";
import { recordEngagement } from "@/lib/server/feedback";

/**
 * Watching how a story is actually read, and saying nothing about it.
 *
 * The product is supposed to improve on its own. A reader should open their
 * briefing one morning and find it noticeably better aimed than it was a
 * fortnight ago, without ever having been asked to rate anything. The thumbs on
 * the story page stay, and they count for more when used, but they are a bonus —
 * these hooks are the part that works for everyone else.
 *
 * Nothing here renders. Nothing here blocks. Every call is best-effort and
 * failures are swallowed, because no reader should see an error about a
 * measurement they did not ask for and cannot act on.
 *
 * ---------------------------------------------------------------------------
 * Foreground time, not wall-clock time
 * ---------------------------------------------------------------------------
 *
 * `useReadTracking` accumulates only the time the page is actually visible. A
 * story left open in a background tab over lunch is not an hour of interest, and
 * counting it would make "left the tab open" the strongest signal in the system.
 * The clock stops on `visibilitychange` and restarts when the tab comes back.
 *
 * The total is flushed once, on unmount or when the page is hidden, rather than
 * ticking to the server. One request per story read is enough for a signal this
 * coarse, and `visibilitychange` is the last event reliably delivered before a
 * tab is discarded — `beforeunload` is not, on mobile especially.
 */

/** Below this, the visit is noise: a mis-tap, or a back button pressed at once. */
const MIN_FLUSH_MS = 1_000;

/**
 * Counts one impression per story the reader was actually shown.
 *
 * Deliberately fires once per mount rather than on every render, and only for
 * stories present in the list — an impression means "this was put in front of
 * you", which is what makes a skip meaningful later.
 */
export function useImpressions(eventIds: string[]): void {
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const fresh = eventIds.filter((id) => id && !seen.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.current.add(id);

    // Sequential rather than parallel: a briefing is a handful of stories, and a
    // burst of simultaneous writes to the same table gains nothing.
    void (async () => {
      for (const eventId of fresh) {
        try {
          await recordEngagement({ data: { eventId, impressions: 1 } });
        } catch {
          /* best effort */
        }
      }
    })();
  }, [eventIds]);
}

/**
 * Tracks one story being read: the open, the foreground time, and whether the
 * reader got to the end.
 *
 * `reachedEnd` is passed in as a ref by the caller, which owns the sentinel that
 * observes the bottom of the article. Keeping the observer out of here means
 * this hook has no opinion about the page's layout.
 */
export function useReadTracking(eventId: string | undefined, reachedEnd: { current: boolean }) {
  const startedAt = useRef<number | null>(null);
  const accumulated = useRef(0);
  const flushed = useRef(false);

  useEffect(() => {
    if (!eventId) return;

    startedAt.current = Date.now();
    accumulated.current = 0;
    flushed.current = false;

    const stopClock = () => {
      if (startedAt.current === null) return;
      accumulated.current += Date.now() - startedAt.current;
      startedAt.current = null;
    };

    const flush = () => {
      if (flushed.current) return;
      stopClock();
      const readMs = accumulated.current;
      // The open itself is always worth recording, even from a visit too short
      // to count as reading — a click-through is mild interest on its own.
      if (readMs < MIN_FLUSH_MS && !reachedEnd.current) {
        flushed.current = true;
        void recordEngagement({ data: { eventId, opened: true } }).catch(() => {});
        return;
      }
      flushed.current = true;
      void recordEngagement({
        data: { eventId, opened: true, readMs, reachedEnd: reachedEnd.current },
      }).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else if (startedAt.current === null && !flushed.current) startedAt.current = Date.now();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [eventId, reachedEnd]);
}
