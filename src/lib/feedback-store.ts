import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearFeedback,
  loadFeedback,
  saveDismissed,
  saveMutedTopic,
  saveStory,
  saveVote,
} from "@/lib/server/feedback";
import { humanError } from "@/lib/errors";
import type { FeedbackVote } from "@/lib/feedback-weights";
import type { Story } from "@/lib/story";

export type Vote = "useful" | "not-useful";

export type FeedbackState = {
  votes: Record<string, Vote>;
  saved: string[];
  dismissed: string[];
  mutedTopics: string[];
};

export const EMPTY_FEEDBACK: FeedbackState = {
  votes: {},
  saved: [],
  dismissed: [],
  mutedTopics: [],
};

const SAVED_QUERY_KEY = ["briefing", "saved"] as const;

/**
 * Saves the reader has been shown and the server has not confirmed yet, keyed by
 * story id, in the order they were tapped.
 *
 * Module scope, not a `useRef`, for one reason: `useFeedback` is mounted once
 * per route, so a bookmark tapped on Home would be forgotten by the instance the
 * Saved shelf is drawn from — precisely the moment the reader goes to look for
 * it. An entry lives from the tap until its write has settled *and* the
 * authoritative list has landed, so the map is never larger than the saves
 * actually in flight.
 */
const pendingSaves = new Map<string, { saved: boolean; story: Story }>();

/**
 * The shelf, as the reader just changed it.
 *
 * `loadSavedStories` is a server list, so a response that overlaps a tap cannot
 * contain that tap's story — and a response that started before an un-save still
 * contains a story the reader has removed. The shelf renders whatever came back,
 * which is how a story saved on a slow connection read as "Nothing saved yet"
 * for the length of a round trip. Merging the unconfirmed changes over the
 * answer makes the shelf agree with the button immediately, and the refetch that
 * follows a settled write takes over from there.
 */
export function withPendingSaved(stories: Story[]): Story[] {
  if (pendingSaves.size === 0) return stories;

  const added: Story[] = [];
  const removed = new Set<string>();
  for (const entry of pendingSaves.values()) {
    if (entry.saved) added.push(entry.story);
    else removed.add(entry.story.id);
  }
  if (added.length === 0 && removed.size === 0) return stories;

  // Newest first, the same order the optimistic cache write uses. A story the
  // server also returned is dropped in favour of the copy the reader tapped, so
  // it cannot appear twice.
  const addedIds = new Set(added.map((story) => story.id));
  const server = stories.filter((story) => !removed.has(story.id) && !addedIds.has(story.id));
  return added.length === 0 ? server : [...added, ...server];
}

/**
 * The reader's signals — votes, saves, dismissals, and muted topics are all
 * server state now, keyed by user, so the same reader sees the same feed on
 * every device. `feedback`, `saved_stories`, `dismissed_stories`, and
 * `muted_topics` each carry one; a vote also moves `user_topics.weight`
 * before the call returns.
 *
 * Optimistic: state moves first and the request follows. If the request
 * fails, the local change is rolled back rather than left showing an action
 * the server never took — a thumb that looks recorded and is not is worse
 * than one that visibly did not stick, because the reader has no reason to
 * try again.
 *
 * A save also has to reach the shelf, which is a *different* cache entry — see
 * `toggleSaved`. The shelf is updated optimistically with the same full Story
 * the reader is looking at, and `withPendingSaved` holds that story there until
 * the server's own list can be trusted to contain it. Between them, a slow
 * connection never turns a just-saved story back into an empty shelf.
 */
export function useFeedback() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FeedbackState>(EMPTY_FEEDBACK);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  // Saves for one story are serialized. This keeps a quick Save → Unsave
  // sequence in the same order on the server as it appears in the UI, while
  // different stories can still save independently.
  const saveChains = useRef(new Map<string, Promise<unknown>>());

  useEffect(() => {
    let live = true;

    void loadFeedback()
      .then((server) => {
        if (!live) return;
        setState((prev) => ({
          ...prev,
          votes: fromServerVotes(server.votes),
          saved: mergePendingSaves(server.saved, pendingSaves),
          dismissed: server.dismissed,
          mutedTopics: server.mutedTopics,
        }));
      })
      .catch(() => {
        // Signed out, or the read failed. Nothing persists until there is a
        // session; the page just shows everything, unfiltered.
      })
      .finally(() => {
        if (live) setHydrated(true);
      });

    return () => {
      live = false;
    };
  }, []);

  const vote = useCallback((id: string, v: Vote) => {
    let sent: Vote | null = v;

    setState((prev) => {
      const votes = { ...prev.votes };
      // Pressing the same thumb again clears it; the other one replaces it.
      if (votes[id] === v) {
        delete votes[id];
        sent = null;
      } else {
        votes[id] = v;
        sent = v;
      }
      return { ...prev, votes };
    });

    void saveVote({ data: { eventId: id, vote: sent === null ? null : toServerVote(sent) } }).catch(
      () => {
        // Put it back the way it was rather than showing a vote nobody stored.
        setState((prev) => {
          const votes = { ...prev.votes };
          if (sent === null) votes[id] = v;
          else delete votes[id];
          return { ...prev, votes };
        });
      },
    );
  }, []);

  const toggleSaved = useCallback(
    (story: Story) => {
      const { id } = story;
      const nowSaved = !state.saved.includes(id);
      const previous = saveChains.current.get(id) ?? Promise.resolve();
      // Identity, not just the id: a newer toggle replaces this entry, and only
      // the newest tap is allowed to retire the hold on the shelf.
      const entry = { saved: nowSaved, story };

      // Change both views before the network call: the button and the Saved
      // shelf should agree immediately, even when the next response is slow.
      setState((prev) => ({
        ...prev,
        saved: nowSaved ? [...prev.saved, id] : prev.saved.filter((x) => x !== id),
      }));
      pendingSaves.set(id, entry);
      setSaveErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.setQueryData<Story[]>(SAVED_QUERY_KEY, (current) => {
        if (nowSaved) {
          return [story, ...(current ?? []).filter((item) => item.id !== id)];
        }
        return current?.filter((item) => item.id !== id);
      });

      // A later toggle waits for the earlier write, so the server cannot end in
      // the opposite state merely because two requests completed out of order.
      const request = previous
        .catch(() => undefined)
        .then(() => saveStory({ data: { eventId: id, saved: nowSaved } }));
      saveChains.current.set(id, request);

      void request
        .then(() => {
          // Now that the write has landed, ask for the authoritative list — and
          // keep this save's hold on the shelf until that answer arrives. A
          // response already in flight when the reader tapped cannot contain the
          // save, so retiring the hold any earlier is exactly when the shelf
          // would go empty again.
          void queryClient.invalidateQueries({ queryKey: SAVED_QUERY_KEY }).finally(() => {
            if (pendingSaves.get(id) === entry) pendingSaves.delete(id);
          });
        })
        .catch((error: unknown) => {
          // An older request must not undo a newer toggle. The newest request
          // owns the visible state and will either succeed or roll itself back.
          if (saveChains.current.get(id) !== request) return;

          if (pendingSaves.get(id) === entry) pendingSaves.delete(id);
          setState((prev) => ({
            ...prev,
            saved: nowSaved
              ? prev.saved.filter((item) => item !== id)
              : prev.saved.includes(id)
                ? prev.saved
                : [...prev.saved, id],
          }));
          queryClient.setQueryData<Story[]>(SAVED_QUERY_KEY, (current) => {
            if (nowSaved) return current?.filter((item) => item.id !== id);
            return [story, ...(current ?? []).filter((item) => item.id !== id)];
          });
          setSaveErrors((prev) => ({
            ...prev,
            [id]: humanError(
              error,
              nowSaved
                ? "Could not save this story. Try again."
                : "Could not remove this story from Saved. Try again.",
            ),
          }));
        })
        .finally(() => {
          if (saveChains.current.get(id) === request) saveChains.current.delete(id);
        });
    },
    [queryClient, state.saved],
  );

  const dismiss = useCallback((id: string) => {
    setState((prev) =>
      prev.dismissed.includes(id) ? prev : { ...prev, dismissed: [...prev.dismissed, id] },
    );
    void saveDismissed({ data: { eventId: id, dismissed: true } }).catch(() => {
      setState((prev) => ({ ...prev, dismissed: prev.dismissed.filter((x) => x !== id) }));
    });
  }, []);

  const restore = useCallback((id: string) => {
    setState((prev) => ({ ...prev, dismissed: prev.dismissed.filter((x) => x !== id) }));
    void saveDismissed({ data: { eventId: id, dismissed: false } }).catch(() => {
      setState((prev) =>
        prev.dismissed.includes(id) ? prev : { ...prev, dismissed: [...prev.dismissed, id] },
      );
    });
  }, []);

  const muteTopic = useCallback((topic: string) => {
    let nowMuted = false;

    setState((prev) => {
      nowMuted = !prev.mutedTopics.includes(topic);
      return {
        ...prev,
        mutedTopics: nowMuted
          ? [...prev.mutedTopics, topic]
          : prev.mutedTopics.filter((x) => x !== topic),
      };
    });

    void saveMutedTopic({ data: { topic, muted: nowMuted } }).catch(() => {
      setState((prev) => ({
        ...prev,
        mutedTopics: nowMuted
          ? prev.mutedTopics.filter((x) => x !== topic)
          : [...prev.mutedTopics, topic],
      }));
    });
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY_FEEDBACK);
    // Nothing the server has not confirmed can survive a reset, and leaving the
    // holds in place would re-add them to the shelf on the next feedback read.
    pendingSaves.clear();
    // Clears the stored votes and returns every topic weight to base. Without
    // this, "reset" would erase what the reader can see and keep what the
    // pipeline reads.
    void clearFeedback().catch(() => {
      /* Nothing useful to show; the settings page reports its own state. */
    });
  }, []);

  const signals =
    Object.keys(state.votes).length +
    state.dismissed.length +
    state.mutedTopics.length +
    state.saved.length;

  return {
    state,
    hydrated,
    signals,
    saveErrors,
    vote,
    toggleSaved,
    dismiss,
    restore,
    muteTopic,
    reset,
  };
}

/**
 * The interface has said `not-useful` since it was a prototype; the enum in
 * `0001_init.sql` says `not_useful`. Translating at this boundary keeps the
 * hyphen out of the database and the underscore out of the components.
 *
 * `not_interested` exists in the enum and has no control yet, so it is only ever
 * read, never written from here.
 */
function toServerVote(vote: Vote): FeedbackVote {
  return vote === "useful" ? "useful" : "not_useful";
}

function fromServerVotes(votes: Record<string, FeedbackVote>): Record<string, Vote> {
  const out: Record<string, Vote> = {};
  for (const [id, vote] of Object.entries(votes)) {
    out[id] = vote === "useful" ? "useful" : "not-useful";
  }
  return out;
}

function mergePendingSaves(
  saved: string[],
  pending: Map<string, { saved: boolean; story: Story }>,
): string[] {
  const merged = new Set(saved);
  for (const [id, entry] of pending) {
    if (entry.saved) merged.add(id);
    else merged.delete(id);
  }
  return [...merged];
}
