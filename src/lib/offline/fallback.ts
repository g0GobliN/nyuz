import { archiveAccount, readList, readStory } from "@/lib/offline/archive";
import { listKeyForQuery, storyIdForQuery } from "@/lib/offline/keys";
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
 */
export async function withOfflineFallback<T>(
  queryKey: readonly unknown[],
  fetchLive: () => Promise<T>,
): Promise<T> {
  const userId = archiveAccount();
  const offline = !isOnline();

  if (offline && userId) {
    const saved = await readArchived<T>(userId, queryKey);
    if (saved !== null) return saved;
  }

  try {
    return await fetchLive();
  } catch (error) {
    // Online and failing: a saved copy still beats an error screen, because the
    // alternative is a reader with no way to see the briefing they already have.
    if (userId) {
      const saved = await readArchived<T>(userId, queryKey);
      if (saved !== null) return saved;
    }
    throw error;
  }
}

/** The archived payload for a cache key, or null when nothing is stored. */
export async function readArchived<T>(
  userId: string,
  queryKey: readonly unknown[],
): Promise<T | null> {
  const listKey = listKeyForQuery(queryKey);
  if (listKey) {
    const row = await readList<T>(userId, listKey);
    return row ? row.payload : null;
  }

  const storyId = storyIdForQuery(queryKey);
  if (storyId) {
    const story = await readStory(userId, storyId);
    return (story as T | null) ?? null;
  }

  // Not a key the archive knows. Returning null rather than guessing means a
  // query added later cannot be served somebody else's shape.
  return null;
}
