import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FeedbackState } from "@/lib/feedback-store";
import { buildQueue, EMPTY_QUEUE, type QueueItem, type ReadingQueue } from "@/lib/reading-queue";
import { loadHomeFeed, loadRecentAlerts } from "@/lib/server/briefing";

/**
 * The list a reader is working through, made available on the story page.
 *
 * Reading a briefing is a sequence, not a set of lookups. Without this the only
 * way to the next story is back to the list and click again — fine for two
 * stories, exhausting for fifty, and it costs the reader their place every time.
 * So the story page has to know which list it was opened from, and where in it
 * the current story sits.
 *
 * It works that out by re-running the list page's own query rather than by
 * carrying the list through navigation state. The key and the function here are
 * the ones the list route already uses, so the answer is in the React Query
 * cache the moment a reader clicks a card: no request, no pager appearing a beat
 * late. It also survives a reload or a link opened cold from an email, where
 * navigation state would be gone — there the fetch simply happens for real.
 *
 * `select` is what keeps that sharing honest. The cache entry stays exactly the
 * shape the list route stores; this only projects out the part a pager needs.
 */

export const QUEUE_SOURCES = ["home", "alerts"] as const;

export type QueueSource = (typeof QUEUE_SOURCES)[number];

/** Narrows a URL search value, so an edited `?from=` cannot name a bad list. */
export function asQueueSource(value: unknown): QueueSource | undefined {
  return typeof value === "string" && (QUEUE_SOURCES as readonly string[]).includes(value)
    ? (value as QueueSource)
    : undefined;
}

type SourceConfig = {
  queryKey: readonly unknown[];
  staleTime: number;
  queryFn: () => Promise<unknown>;
  select: (data: unknown) => QueueItem[];
  label: string;
  respectsFeedback: boolean;
};

/** Erases the payload type at the edge, so the configs stay checked against it. */
function defineSource<T>(config: {
  queryKey: readonly unknown[];
  staleTime: number;
  queryFn: () => Promise<T>;
  select: (data: T) => QueueItem[];
  label: string;
  respectsFeedback: boolean;
}): SourceConfig {
  return { ...config, select: (data) => config.select(data as T) };
}

const SOURCES: Record<QueueSource, SourceConfig> = {
  home: defineSource({
    queryKey: ["briefing", "home"],
    staleTime: 60_000,
    queryFn: () => loadHomeFeed(),
    select: (feed) =>
      feed.stories.map((story) => ({ id: story.id, title: story.title, topics: story.topics })),
    label: "your nyuz",
    respectsFeedback: true,
  }),
  alerts: defineSource({
    queryKey: ["alerts", "recent"],
    staleTime: 30_000,
    queryFn: () => loadRecentAlerts(),
    // One event can be alerted on more than once, and the same story arriving
    // twice in a row would make Next look broken. First delivery wins.
    select: (alerts) => {
      const seen = new Set<string>();
      return alerts.flatMap((alert) => {
        if (seen.has(alert.eventId)) return [];
        seen.add(alert.eventId);
        return [{ id: alert.eventId, title: alert.title, topics: [] }];
      });
    },
    label: "your alerts",
    respectsFeedback: false,
  }),
};

export function useReadingQueue(
  from: QueueSource,
  currentId: string | undefined,
  feedback: FeedbackState,
): ReadingQueue {
  const config = SOURCES[from];
  const { data } = useQuery({
    queryKey: config.queryKey,
    queryFn: config.queryFn,
    select: config.select,
    staleTime: config.staleTime,
  });

  return useMemo(() => {
    if (!data) return EMPTY_QUEUE;
    return buildQueue(data, currentId, {
      label: config.label,
      respectsFeedback: config.respectsFeedback,
      feedback,
    });
  }, [data, currentId, config, feedback]);
}
