import { useCallback, useEffect, useState } from "react";
import {
  clearFeedback,
  loadFeedback,
  saveDismissed,
  saveMutedTopic,
  saveStory,
  saveVote,
} from "@/lib/server/feedback";
import type { FeedbackVote } from "@/lib/feedback-weights";

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
 */
export function useFeedback() {
  const [state, setState] = useState<FeedbackState>(EMPTY_FEEDBACK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let live = true;

    void loadFeedback()
      .then((server) => {
        if (!live) return;
        setState((prev) => ({
          ...prev,
          votes: fromServerVotes(server.votes),
          saved: server.saved,
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

  const toggleSaved = useCallback((id: string) => {
    let nowSaved = false;

    setState((prev) => {
      nowSaved = !prev.saved.includes(id);
      return {
        ...prev,
        saved: nowSaved ? [...prev.saved, id] : prev.saved.filter((x) => x !== id),
      };
    });

    void saveStory({ data: { eventId: id, saved: nowSaved } }).catch(() => {
      setState((prev) => ({
        ...prev,
        saved: nowSaved ? prev.saved.filter((x) => x !== id) : [...prev.saved, id],
      }));
    });
  }, []);

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
