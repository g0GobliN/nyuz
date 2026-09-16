/**
 * The card shape the dashboard renders.
 *
 * Shared by the marketing fixtures and the live mapper so StoryCard has one
 * prop type. Fields that only exist on a real event (source URLs, a generated
 * why) stay optional on the list; the story page fills them in.
 */
export type Story = {
  id: string;
  org: string;
  title: string;
  what: string;
  why: string;
  importance: "High" | "Medium" | "Notable";
  score: { relevance: number; importance: number; novelty: number };
  sources: number;
  topics: string[];
  /** Clock time on its own, for places that already sit under a date heading. */
  time: string;
  /** The same moment as `time`, dated. Rendered through `formatStoryTime`. */
  publishedAt: string;
  /** Most recent evidence attachment or analysis update, when available. */
  updatedAt?: string;
  sourceList: {
    articleId?: string;
    name: string;
    at: string;
    url?: string;
    headline?: string;
    excerpt?: string;
  }[];
  before: string;
  after: string;
  timeline: { at: string; label: string }[];
  /** Shared, structured event knowledge. Absent for events analysed before 0046. */
  understand?: EventIntelligence;
  matched?: string[];
  /**
   * Why this reader specifically is seeing this event, when it's genuinely true.
   *
   * Only set when the event actually reached this reader through their own
   * subscriptions (a `user_events` row exists) and shares a topic they follow --
   * never a guess. Absent otherwise, and the page renders nothing in its place.
   */
  personalization?: { heading: string; explanation: string };
};

/** Shared 0–10 score → the three bands the cards already print. */
export function importanceBand(score: number): Story["importance"] {
  if (score >= 6) return "High";
  if (score >= 3) return "Medium";
  return "Notable";
}

/** 0–10 (or unbounded relevance) as the 0–100 the bars were drawn for. */
export function asPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 10)));
}

export function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}
import type { EventIntelligence } from "@/lib/understand";
