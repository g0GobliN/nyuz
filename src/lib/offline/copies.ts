import { useSyncExternalStore } from "react";
import { archiveAccount } from "@/lib/offline/archive";

/**
 * Which of the answers on screen came out of the archive rather than the network.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 *
 * `withOfflineFallback` returns a saved copy as a *success* — that is the point
 * of it, and the alternative is an error screen in front of a briefing the
 * reader already has. The cost was that nothing could tell a fresh briefing from
 * a two-day-old one. The strip that exists for exactly this
 * (`components/dashboard/offline-notice.tsx`) rendered only while the browser
 * reported no network at all, so the case that actually happened — the network
 * is up, the request fails, the archive answers — showed a stale feed with no
 * caption, and a reader reasonably read it as the server having no news.
 *
 * So a served copy is marked, by the one function that serves one, and the strip
 * draws for it. Nothing else reads this: it is a caption, not a source of truth.
 *
 * ---------------------------------------------------------------------------
 * Why the marks are account-scoped and why they are a store
 * ---------------------------------------------------------------------------
 *
 * Keyed by the archive's own key for the query, so a mark cannot outlive the
 * data it describes by much: a live answer for the same screen clears it, which
 * is what makes the strip go away by itself rather than needing a timer. Marks
 * carry the account that was signed in when the copy was served, so a sign-out
 * cannot leave a caption about somebody else's briefing on screen — the same
 * rule the archive itself follows.
 *
 * The snapshot is a number (the newest copy on screen) rather than a map,
 * because `useSyncExternalStore` compares snapshots by identity and a new
 * object every render is an infinite loop.
 */

type Mark = {
  /** Who was signed in when this copy was served. */
  userId: string;
  /** When the archive row was written: the moment the live answer last worked. */
  savedAt: number;
};

const marks = new Map<string, Mark>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Record that a screen is showing a saved copy rather than a live answer. */
export function markServedCopy(key: string, savedAt: number): void {
  const userId = archiveAccount();
  if (!userId) return;
  const current = marks.get(key);
  if (current && current.userId === userId && current.savedAt === savedAt) return;
  marks.set(key, { userId, savedAt });
  notify();
}

/** A live answer arrived for this screen, so it is no longer a copy. */
export function clearServedCopy(key: string): void {
  if (marks.delete(key)) notify();
}

/**
 * The newest copy currently on screen, or null.
 *
 * Newest rather than a list: the caption says when the copy was last updated,
 * and the freshest of several is the honest answer for a strip that stands for
 * the whole page. Scoped to the signed-in account at read time as well as write
 * time, so a mark left by the previous reader is invisible even before the next
 * write clears it.
 */
export function servedCopySavedAt(): number | null {
  const userId = archiveAccount();
  if (!userId) return null;

  let newest: number | null = null;
  for (const mark of marks.values()) {
    if (mark.userId !== userId) continue;
    newest = newest === null ? mark.savedAt : Math.max(newest, mark.savedAt);
  }
  return newest;
}

export function subscribeToServedCopies(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The hook the strip uses. Server snapshot is null: no window, no copy. */
export function useServedCopySavedAt(): number | null {
  return useSyncExternalStore(subscribeToServedCopies, servedCopySavedAt, () => null);
}
