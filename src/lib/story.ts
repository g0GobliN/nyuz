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
    /**
     * The publisher's stored kind (`sources.kind`), when the loader selected it.
     *
     * The dashboard gate reads this to tell a vendor's own announcement from
     * reportage — the first-party celebration class needs "every carrier a
     * `company_blog`" — so a loader that omits it makes that class fail open.
     * Optional because a card fixture or an older caller may not carry it.
     */
    kind?: string;
    at: string;
    url?: string;
    headline?: string;
    excerpt?: string;
    /** Structured facts from the article's own page, when enrichment ran (0090). */
    enrichedEvidence?: EvidenceUnit[];
  }[];
  before: string;
  after: string;
  timeline: { at: string; label: string }[];
  /** Shared, structured event knowledge. Absent for events analysed before 0046. */
  understand?: EventIntelligence;
  /**
   * Prior nyuz events sharing central entities or specific headline facts, for the deterministic
   * reader's background paragraph. Only attached when there is no authored
   * article to render instead -- see `relatedEventsFor` in briefing.ts.
   */
  relatedEvents?: { id: string; title: string; summary?: string; publishedAt?: string }[];
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

/**
 * "1 source" or "3 sources", so no screen ever prints "Based on 1 sources".
 *
 * Every single-source story in the 2026-09-30 briefing rendered that exact
 * string, twenty-five times over, on the briefing list, the card and History.
 * One helper because the fix in `story-article.tsx` had not travelled: each
 * call site re-deciding the plural is how four of them disagreed.
 */
export function sourceCount(n: number): string {
  return `${n} ${n === 1 ? "source" : "sources"}`;
}
import type { EventIntelligence, EvidenceUnit } from "@/lib/understand";
