/**
 * Why an event has no enriched evidence.
 *
 * The 30-day evaluation window reports 89.9% of complete events with zero
 * evidence units. That number is an alarm, not a diagnosis: it is produced by at
 * least four different mechanisms, and each is repaired by a different change —
 * or by no change at all. Collapsing them into one percentage is how a corpus
 * starts blaming the wrong layer.
 *
 * The four families, and what each one actually means:
 *
 *   never_attempted   No `article_evidence` row exists for the article. The
 *                     enrichment pass never reached it. A scheduling gap.
 *   pending           A row exists in `pending`: it was claimed and never
 *                     finished, which means a run died mid-flight.
 *   blocked           `robots.txt` disallows the path, or permission could not
 *                     be determined safely. Correct behaviour, not a defect —
 *                     and deliberately not worked around.
 *   unreachable       The page could not be fetched at all: a network failure, a
 *                     4xx/5xx, or a timeout.
 *   thin_content      The page fetched, but the extractable text was under the
 *                     usable-words floor — a paywall, a video page, or a
 *                     non-article. This is the family most likely to be
 *                     mistaken for "no source material" when it is really
 *                     "material exists but is not machine-readable".
 *   extraction_empty  The page fetched and had enough words, but the extractor
 *                     produced zero usable units. This is the family that
 *                     represents genuine loss: material was available and the
 *                     reader got nothing.
 *   failed            The pass threw. An outright bug or an unhandled shape.
 *   covered           The event has at least one article with usable evidence.
 *
 * `never_attempted` and `extraction_empty` are the two that a fix can act on.
 * `blocked` and `thin_content` are the two that a fix must NOT act on — the
 * first is a boundary this project keeps on purpose, and the second is a
 * property of the source rather than of the pipeline.
 *
 * Pure: no database, no clock, no I/O. The reader is
 * `scripts/reader-enrichment-census.ts`.
 */

/** The `article_evidence.status` vocabulary, from migration 0090. */
export type EnrichmentStatus = "pending" | "enriched" | "unavailable" | "blocked" | "failed";

export type EvidenceAbsence =
  | "covered"
  | "never_attempted"
  | "pending"
  | "blocked"
  | "unreachable"
  | "thin_content"
  | "extraction_empty"
  | "failed";

/**
 * One article, as the census reads it.
 *
 * `status` is `null` when no `article_evidence` row exists at all — the state a
 * `left join` reports and the reason this field is nullable rather than defaulted
 * to `"pending"`. Defaulting it would silently convert "never attempted" into
 * "in flight", which is exactly the confusion this module exists to prevent.
 */
export type ArticleRow = {
  articleId: string;
  /** `null` when no evidence row exists. */
  status: EnrichmentStatus | null;
  /** Units stored in `evidence`; 0 for every non-enriched row. */
  evidenceUnits: number;
  /** `source_word_count`, set only when a fetch succeeded. */
  wordCount: number;
};

/**
 * Which family one article falls into.
 *
 * Ordered so the earliest decisive fact wins: a row that does not exist cannot
 * also be pending, and an `enriched` row with zero units is a different finding
 * from an `enriched` row whose units were later filtered out by the reader
 * layer — the latter is counted by `evidenceUnits`, which is what the reader
 * actually gets.
 */
export function absenceFor(article: ArticleRow): EvidenceAbsence {
  if (article.status === null) return "never_attempted";
  switch (article.status) {
    case "pending":
      return "pending";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "unavailable":
      // A fetch that never produced text and a fetch that produced too little
      // are different findings: the first is a reachability problem, the second
      // is a property of the page. `wordCount` is what separates them, and it is
      // 0 only when no fetch succeeded.
      return article.wordCount > 0 ? "thin_content" : "unreachable";
    case "enriched":
      // The extractor ran and stored what it found. Zero units here is genuine
      // loss; units present means the reader has material.
      return article.evidenceUnits > 0 ? "covered" : "extraction_empty";
  }
}

/** One event, with every article attached to it. */
export type EventRow = {
  eventId: string;
  articles: ArticleRow[];
};

export type AbsenceBucket = {
  absence: EvidenceAbsence;
  /** Events whose *best* article is in this family. */
  events: number;
};

export type EnrichmentCensus = {
  events: number;
  /** Events with at least one article carrying usable evidence. */
  covered: number;
  /** Events with no usable evidence anywhere. */
  uncovered: number;
  /** Events with no articles at all — distinct from "articles, none enriched". */
  noArticles: number;
  coveredRate: Rate;
  /**
   * The family each uncovered event is attributed to, by its best article.
   *
   * "Best" is deliberate: an event with one blocked article and one thin one is
   * reported under whichever is closer to producing evidence, so the buckets sum
   * to the uncovered count without double-counting.
   */
  buckets: AbsenceBucket[];
  /** Articles seen, for a reader checking the denominator. */
  articles: number;
  /** Articles in each family, which is the raw material for a fix. */
  articlesByAbsence: { absence: EvidenceAbsence; articles: number }[];
  /** Of the uncovered events, how many carry an importance signal. */
  uncoveredNotable: number;
};

type Rate = { numerator: number; denominator: number; value: number | undefined };

const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  value: denominator === 0 ? undefined : numerator / denominator,
});

/**
 * How close a family is to producing evidence, worst first.
 *
 * The order is the repair order, not the frequency order: `never_attempted` and
 * `extraction_empty` are fixable, `failed` is a bug, and `blocked` /
 * `thin_content` / `unreachable` are boundaries a fix must respect. An event is
 * attributed to the *best* family it has, which is why this sorts ascending —
 * index 0 is the most promising.
 */
const PROMISE: readonly EvidenceAbsence[] = [
  "covered",
  "extraction_empty",
  "never_attempted",
  "pending",
  "failed",
  "thin_content",
  "unreachable",
  "blocked",
];

/** The best (most promising) family among an event's articles. */
export function bestAbsence(articles: readonly ArticleRow[]): EvidenceAbsence {
  if (articles.length === 0) return "never_attempted";
  // Seeded past the end of PROMISE, not at `articles.length`: with a one-article
  // event the old seed equalled the only index considered, so nothing ever beat
  // it and every event was reported as `never_attempted`. The fallback below is
  // unreachable for a non-empty list — `indexOf` always finds a real family —
  // and exists only so the function has a total return type.
  let best = PROMISE.length;
  let result: EvidenceAbsence = "never_attempted";
  for (const article of articles) {
    const family = absenceFor(article);
    const index = PROMISE.indexOf(family);
    if (index < best) {
      best = index;
      result = family;
    }
  }
  return result;
}

/**
 * The census over one window.
 *
 * Events with no articles are counted separately and are NOT attributed to a
 * family: an event whose coverage never attached has an ingestion problem
 * upstream of enrichment, and folding it into `never_attempted` would send a
 * reader looking in the wrong file.
 */
export function census(
  events: readonly EventRow[],
  notable: ReadonlySet<string> = new Set(),
): EnrichmentCensus {
  const articles = events.flatMap((event) => event.articles);
  const withArticles = events.filter((event) => event.articles.length > 0);
  const noArticles = events.length - withArticles.length;

  const coveredEvents = withArticles.filter((event) =>
    event.articles.some((article) => absenceFor(article) === "covered"),
  );
  const uncoveredEvents = withArticles.filter(
    (event) => !event.articles.some((article) => absenceFor(article) === "covered"),
  );

  const counts = new Map<EvidenceAbsence, number>();
  for (const event of uncoveredEvents) {
    const family = bestAbsence(event.articles);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  const articleCounts = new Map<EvidenceAbsence, number>();
  for (const article of articles) {
    const family = absenceFor(article);
    articleCounts.set(family, (articleCounts.get(family) ?? 0) + 1);
  }

  return {
    events: events.length,
    covered: coveredEvents.length,
    uncovered: uncoveredEvents.length,
    noArticles,
    coveredRate: rate(coveredEvents.length, withArticles.length),
    buckets: PROMISE.filter((family) => family !== "covered").map((absence) => ({
      absence,
      events: counts.get(absence) ?? 0,
    })),
    articles: articles.length,
    articlesByAbsence: PROMISE.map((absence) => ({
      absence,
      articles: articleCounts.get(absence) ?? 0,
    })),
    uncoveredNotable: uncoveredEvents.filter((event) => notable.has(event.eventId)).length,
  };
}

/** A percentage that prints an em dash for an empty denominator, never a zero. */
export function formatPercent(value: Rate, digits = 1): string {
  return value.value === undefined ? "—" : `${(value.value * 100).toFixed(digits)}%`;
}
