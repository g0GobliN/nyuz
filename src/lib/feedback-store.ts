import { useCallback, useEffect, useState } from "react";

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

/** Local-only signal store. Stands in for the server-side personalisation loop. */
export function useFeedback() {
  const [state, setState] = useState<FeedbackState>(EMPTY_FEEDBACK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...EMPTY_FEEDBACK, ...(JSON.parse(raw) as Partial<FeedbackState>) });
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const write = useCallback((fn: (prev: FeedbackState) => FeedbackState) => {
    setState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const vote = useCallback(
    (id: string, v: Vote) =>
      write((p) => {
        const votes = { ...p.votes };
        if (votes[id] === v) delete votes[id];
        else votes[id] = v;
        return { ...p, votes };
      }),
    [write],
  );

  const toggleSaved = useCallback(
    (id: string) =>
      write((p) => ({
        ...p,
        saved: p.saved.includes(id) ? p.saved.filter((x) => x !== id) : [...p.saved, id],
      })),
    [write],
  );

  const dismiss = useCallback(
    (id: string) =>
      write((p) => ({
        ...p,
        dismissed: p.dismissed.includes(id) ? p.dismissed : [...p.dismissed, id],
      })),
    [write],
  );

  const restore = useCallback(
    (id: string) => write((p) => ({ ...p, dismissed: p.dismissed.filter((x) => x !== id) })),
    [write],
  );

  const muteTopic = useCallback(
    (topic: string) =>
      write((p) => ({
        ...p,
        mutedTopics: p.mutedTopics.includes(topic)
          ? p.mutedTopics.filter((x) => x !== topic)
          : [...p.mutedTopics, topic],
      })),
    [write],
  );

  const reset = useCallback(() => write(() => EMPTY_FEEDBACK), [write]);

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
