import { useEffect, useRef } from "react";
import { archiveAccount, hasStory, saveStory } from "@/lib/offline/archive";
import { isOnline } from "@/lib/online";
import { loadStory } from "@/lib/server/briefing";
import type { Story } from "@/lib/story";

/**
 * Give the Saved list a reading copy while there is a network to fetch one.
 *
 * ---------------------------------------------------------------------------
 * Why Saved is warmed and Home is not
 * ---------------------------------------------------------------------------
 *
 * Save is the reader saying "I want this later" — an explicit promise about a
 * story they may open on a plane. Home is a feed: today's cards are worth
 * keeping as cards, but the reader did not ask to read any of them, and caching
 * every article in every briefing is how an offline feature quietly becomes a
 * full mirror of the archive on every device.
 *
 * Opening a story archives it anyway (the query cache does that). This exists
 * for the story that was saved and never opened — the exact one a reader would
 * be annoyed to find missing.
 *
 * ---------------------------------------------------------------------------
 * The cost, and how it is bounded
 * ---------------------------------------------------------------------------
 *
 * `loadStory` is a metadata read: it never generates, never spends, and takes
 * the same `prefetch: true` path the story page already takes when it warms the
 * next story in the reading queue. Five per visit, sequentially, only for
 * stories with no archived copy yet, and abandoned if the reader leaves the
 * page. A reader with forty saved stories pays for five a visit and no more.
 */
const WARM_PER_VISIT = 5;

export function useWarmSavedStories(stories: Story[]): void {
  // Survives a re-render, so a page that re-renders on a vote does not re-ask
  // for the same five stories.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    const userId = archiveAccount();
    if (!userId || !isOnline() || stories.length === 0) return;

    let cancelled = false;
    void (async () => {
      let budget = WARM_PER_VISIT;
      for (const story of stories) {
        if (cancelled || budget <= 0) return;
        if (attempted.current.has(story.id)) continue;
        attempted.current.add(story.id);
        budget -= 1;

        if (await hasStory(userId, story.id)) continue;
        try {
          const full = await loadStory({ data: { id: story.id, prefetch: true } });
          if (cancelled || !full) continue;
          await saveStory(userId, full);
        } catch {
          // One story that will not load must not stop the rest, and a failure
          // here is invisible by design: it costs a reading copy, not a screen.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stories]);
}
