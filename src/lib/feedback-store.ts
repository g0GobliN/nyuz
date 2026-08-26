import { useCallback, useEffect, useState } from "react";
import { clearFeedback, loadFeedback, saveStory, saveVote } from "@/lib/server/feedback";
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

const KEY = "nyuz.feedback.v1";

/**
 * The reader's signals.
 *
 * This used to describe itself as standing in for the personalisation loop:
 * everything went to `localStorage` and stopped there, so a thumb was a UI state
 * change and nothing more, and clearing site data threw away every judgement a
 * reader had ever made. `feedback` and `saved_stories` now carry the two signals
 * that have tables, and a vote moves `user_topics.weight` before the call
 * returns.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of signal, on purpose
 * ---------------------------------------------------------------------------
 *
 *   - **Votes and saves are server state.** They survive a new browser, and they
 *     are what the pipeline reads. The server is the truth.
 *   - **Dismissals and muted topics stay local.** There is no table for either,
 *     and adding one is DDL, which cannot be applied from a development machine
 *     here (see docs/plan.md). They are also genuinely session-shaped — hiding a
 *     card you have already read is not a lasting statement about a topic.
 *
 * Keeping the split explicit matters more than the storage detail: a reader who
 * mutes a topic expects that to persist, so when `user_topics.muted` is wired to
 * this, `mutedTopics` moves to the first group and the local copy goes away.
 *
 * ---------------------------------------------------------------------------
 * Optimistic, and what happens when the write loses
 * ---------------------------------------------------------------------------
 *
 * A thumb has to respond instantly, so state moves first and the request follows.
 * If the request fails, the local change is rolled back rather than left showing
 * a vote the server never took — a thumb that looks recorded and is not is worse
 * than one that visibly did not stick, because the reader has no reason to try
 * again.
 */
export function useFeedback() {
  const [state, setState] = useState<FeedbackState>(EMPTY_FEEDBACK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let live = true;

    // Local first, so dismissals and mutes are right immediately even if the
    // network is slow or the reader is signed out.
    let local = EMPTY_FEEDBACK;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) local = { ...EMPTY_FEEDBACK, ...(JSON.parse(raw) as Partial<FeedbackState>) };
    } catch {
      /* ignore */
    }
    if (live) setState(local);

    void loadFeedback()
      .then((server) => {
        if (!live) return;
        setState((prev) => ({
          ...prev,
          votes: fromServerVotes(server.votes),
          saved: server.saved,
        }));
      })
      .catch(() => {
        // Signed out, or the read failed. The local half is already showing and
        // votes simply will not persist until there is a session.
      })
      .finally(() => {
        if (live) setHydrated(true);
      });

    return () => {
      live = false;
    };
  }, []);

  /** Writes local-only fields through to `localStorage`. */
  const writeLocal = useCallback((fn: (prev: FeedbackState) => FeedbackState) => {
    setState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ dismissed: next.dismissed, mutedTopics: next.mutedTopics }),
        );
      } catch {
        /* ignore */
      }
      return next;
    });
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

  const dismiss = useCallback(
    (id: string) =>
      writeLocal((p) => ({
        ...p,
        dismissed: p.dismissed.includes(id) ? p.dismissed : [...p.dismissed, id],
      })),
    [writeLocal],
  );

  const restore = useCallback(
    (id: string) => writeLocal((p) => ({ ...p, dismissed: p.dismissed.filter((x) => x !== id) })),
    [writeLocal],
  );

  const muteTopic = useCallback(
    (topic: string) =>
      writeLocal((p) => ({
        ...p,
        mutedTopics: p.mutedTopics.includes(topic)
          ? p.mutedTopics.filter((x) => x !== topic)
          : [...p.mutedTopics, topic],
      })),
    [writeLocal],
  );

  const reset = useCallback(() => {
    setState(EMPTY_FEEDBACK);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
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
