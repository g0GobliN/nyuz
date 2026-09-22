import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { archiveAccount, saveList, saveStory, setArchiveAccount } from "@/lib/offline/archive";
import { listKeyForQuery, slimListPayload, storyIdForQuery } from "@/lib/offline/keys";
import type { Story } from "@/lib/story";

/**
 * Keep the archive in step with the query cache.
 *
 * ---------------------------------------------------------------------------
 * Why a cache subscriber rather than a call at each call site
 * ---------------------------------------------------------------------------
 *
 * The alternative is to persist from inside each of the four queries' `onSuccess`
 * — four places, and a fifth the next time somebody adds a list. Subscribing to
 * the cache is one place, and it archives exactly what the screens have already
 * agreed to render: the data React Query holds is the data the reader saw, so a
 * saved copy cannot disagree with the page it came from.
 *
 * It is client-only by construction. It is installed from a root effect with the
 * signed-in account, so no server render can write to it, and a signed-out
 * browser has no account to file anything under.
 */

/**
 * One write per query per data change.
 *
 * `updated` fires for every state transition — fetch status, error, observer
 * count — so without this the same payload would be rewritten many times per
 * successful fetch.
 */
export function installOfflineArchive(queryClient: QueryClient, userId: string): () => void {
  setArchiveAccount(userId);
  const written = new Map<string, number>();

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    // Only `updated`, and only for a query that has just produced data.
    if (event.type !== "updated") return;
    const { query } = event;
    if (query.state.status !== "success") return;

    const queryKey = query.queryKey as QueryKey;
    const stamp = query.state.dataUpdatedAt;
    const signature = JSON.stringify(queryKey);
    if (written.get(signature) === stamp) return;

    const listKey = listKeyForQuery(queryKey);
    if (listKey) {
      written.set(signature, stamp);
      // Slimmed here rather than in the archive, so what is stored is bounded by
      // what a list renders. See keys.ts.
      void saveList(userId, listKey, slimListPayload(query.state.data));
      return;
    }

    const storyId = storyIdForQuery(queryKey);
    if (storyId) {
      const story = query.state.data as Story | null;
      // `loadStory` returns null for a story the reader may not see. That is not
      // a story to keep.
      if (!story || typeof story !== "object" || story.id !== storyId) return;
      written.set(signature, stamp);
      void saveStory(userId, story);
    }
  });

  return () => {
    unsubscribe();
    // Guarded against clearing the pointer another account has since taken. The
    // account itself is only ever cleared through `clearOfflineArchive`.
    if (archiveAccount() === userId) setArchiveAccount(null);
  };
}
