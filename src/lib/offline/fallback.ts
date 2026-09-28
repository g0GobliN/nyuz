import { archiveAccount, readList, readStory } from "@/lib/offline/archive";
import { clearServedCopy, markServedCopy } from "@/lib/offline/copies";
import { copyMarkForQuery, listKeyForQuery, storyIdForQuery } from "@/lib/offline/keys";
import { isOnline } from "@/lib/online";

/**
 * Run a query, and when it cannot run, serve what the archive has.
 *
 * ---------------------------------------------------------------------------
 * `networkMode: "offlineFirst"` is not optional
 * ---------------------------------------------------------------------------
 *
 * React Query's default is `"online"`, and a query in that mode does not *fail*
 * while the browser is offline — it never runs at all. `queryFn` is not called,
 * nothing throws, and the query sits in `pending` forever, so an offline app
 * built on a fallback inside `queryFn` shows a spinner that never resolves and
 * no error to explain it. Every query wrapped by this function must therefore be
 * declared `networkMode: "offlineFirst"`, and
 * `src/lib/offline/offline-wiring.test.ts` holds the four of them to that.
 *
 * ---------------------------------------------------------------------------
 * Why the archive is read before the request, not after it fails
 * ---------------------------------------------------------------------------
 *
 * The obvious order is try-then-catch. It costs the reader three failed round
 * trips (React Query's retry default) before the saved copy appears, which on a
 * cold launch in a tunnel is several seconds of nothing. When the browser
 * already knows it is offline there is no request worth making, so the archive
 * is read first and the network is only tried when there is a network.
 *
 * ---------------------------------------------------------------------------
 * A served copy is marked, never passed off as fresh
 * ---------------------------------------------------------------------------
 *
 * Returning the archive as a *success* is what this function is for, and it has
 * one cost: the screen cannot tell a fresh answer from an old one. A reader who
 * was online, whose request failed, then saw yesterday's briefing rendered
 * exactly like today's will read it as the server having no news — which is the
 * failure the product exists to prevent, arrived at from the other side.
 *
 * So every copy this hands back is marked (`copies.ts`), and the strip in the
 * dashboard draws for it. A live answer for the same screen clears the mark, so
 * the caption disappears the moment the request succeeds again and needs no
 * timer to expire. The mark is never a source of truth about the data — it is
 * one sentence of context, and it is scoped to the account that saw it.
 */
export async function withOfflineFallback<T>(
  queryKey: readonly unknown[],
  fetchLive: () => Promise<T>,
): Promise<T> {
  const userId = archiveAccount();
  const offline = !isOnline();

  if (offline && userId) {
    const saved = await readArchivedCopy<T>(userId, queryKey);
    if (saved) return served(queryKey, saved);
  }

  try {
    const live = await fetchLive();
    // Live, so whatever the archive last said about this screen is history.
    clearCopy(queryKey);
    return live;
  } catch (error) {
    // Online and failing: a saved copy still beats an error screen, because the
    // alternative is a reader with no way to see the briefing they already have.
    if (userId) {
      const saved = await readArchivedCopy<T>(userId, queryKey);
      if (saved) return served(queryKey, saved);
    }
    throw error;
  }
}

/** An archived payload, and when the live answer that produced it arrived. */
type ArchivedCopy<T> = { payload: T; savedAt: number };

/**
 * Hand the screen a saved copy, and say so where the strip can see it.
 *
 * The mark is keyed by the archive's own key for the query, so a query the
 * archive cannot answer for is never marked — there would be nothing to caption.
 */
function served<T>(queryKey: readonly unknown[], copy: ArchivedCopy<T>): T {
  const mark = copyMarkForQuery(queryKey);
  if (mark) markServedCopy(mark, copy.savedAt);
  return copy.payload;
}

function clearCopy(queryKey: readonly unknown[]): void {
  const mark = copyMarkForQuery(queryKey);
  if (mark) clearServedCopy(mark);
}

/** The archived payload for a cache key and when it was saved, or null. */
export async function readArchivedCopy<T>(
  userId: string,
  queryKey: readonly unknown[],
): Promise<ArchivedCopy<T> | null> {
  const listKey = listKeyForQuery(queryKey);
  if (listKey) {
    const row = await readList<T>(userId, listKey);
    return row ? { payload: row.payload, savedAt: row.savedAt } : null;
  }

  const storyId = storyIdForQuery(queryKey);
  if (storyId) {
    const row = await readStory(userId, storyId);
    return row ? { payload: row.story as T, savedAt: row.savedAt } : null;
  }

  // Not a key the archive knows. Returning null rather than guessing means a
  // query added later cannot be served somebody else's shape.
  return null;
}
