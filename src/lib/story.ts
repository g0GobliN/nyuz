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
  importance: "High" | "Medium" | "Notable" | "Low";
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

/**
 * Shared 0–10 score → the three bands the cards print.
 *
 * **"Low", not "Notable"** — reader clarity audit 2026-10-22 (H-05): the bottom
 * band was "Notable", a compliment printed on the 14 of 25 cards that scored
 * below 3, in a scale that mixed registers ("Notable" / "Medium" / "High") so
 * the three could not be put in order by reading them. The ruling behind this
 * slice is the same one S9 took for the score itself: one scale, one register.
 * Over the shared 0–10 score the bands read Low / Medium / High.
 *
 * "Notable" stays in the `Story["importance"]` union only so existing fixtures,
 * the evaluation corpus and older call sites keep compiling — nothing a reader
 * is handed can print it, because this function is the only producer of a band
 * from a score (`operations-diagnostics.ts` carries its own internal copy for
 * diagnostics tables, not reader chrome).
 */
export function importanceBand(score: number): Story["importance"] {
  if (score >= 6) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}

/**
 * The outlet whose stored headline the card reads, when one carries it verbatim.
 *
 * Part of the ruling behind the H-01 family (reader clarity audit 2026-10-22):
 * **nyuz writes its own sentence-case headline from the event, and where the
 * original wording is carried it is framed as the outlet's ("as published by
 * …").** The rewrite half belongs to the composer's headline policy — measured
 * separately, no pure code today derives a headline without inventing facts a
 * source headline does not state. What the card surfaces can do honestly today
 * is the frame: the headline the card prints is `events.title`, which the
 * digest's loader copies verbatim from one outlet's article, so the outlet that
 * actually stores those words is knowable — it is the source row whose stored
 * `headline` equals the card's title. On a clustered event the first article's
 * outlet can differ from the title's own outlet (measured on digest
 * `7268ba11` card 12: title "Musk confirms SpaceX and Tesla exploring merger"
 * is Al Jazeera's headline while the four-publisher row sorted The Verge
 * first), so the match is per-source-row, never "the first outlet".
 *
 * Returns null when no stored headline carries the title — a composed or
 * rewritten title, nyuz's voice, which the card prints without the frame.
 */
export function headlineOutlet(story: Story): string | null {
  const title = story.title.trim();
  if (title === "") return null;
  for (const source of story.sourceList) {
    const headline = source.headline?.trim();
    if (headline !== undefined && headline !== "" && source.name.trim() !== "") {
      if (headline === title) return source.name;
    }
  }
  return null;
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
