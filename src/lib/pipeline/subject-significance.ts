/**
 * Is this a big deal *for this subject*? Answered without knowing the subject.
 *
 * ---------------------------------------------------------------------------
 * The question the scorer cannot answer
 * ---------------------------------------------------------------------------
 *
 * `scoreEventV2` answers "would the world notice". It is built from the anchors
 * of world news: casualties, conflict, money past a threshold, a regulatory
 * decision, how many outlets carried it. Those anchors are why it works, and
 * they are also why it cannot answer the only question a briefing needs:
 *
 *   A Rust minor release with a changed borrow checker, a band announcing an
 *   album, a bus network publishing new routes, a paper posting a preprint,
 *   an architecture practice winning a competition -- each is negligible by
 *   every one of those anchors, and each is the entire reason somebody is
 *   following the subject.
 *
 * The obvious fix is a list of "important things" per domain, which is the one
 * fix this architecture forbids: the list is a taxonomy, the taxonomy decides
 * what exists, and the interests nobody wrote a list for are the ones the
 * product is supposed to serve.
 *
 * ---------------------------------------------------------------------------
 * So: the subject is its own baseline
 * ---------------------------------------------------------------------------
 *
 * Significance here is **contrast against the subject's own history**, and it
 * needs no vocabulary at all:
 *
 *   First occurrence   a material transition this subject's coverage has never
 *                      carried. Rust 2.0's release candidate after weeks of
 *                      announcements; a band's album finally shipping; an
 *                      acquisition moving from announced to completed. The
 *                      signal is that the marker is *new to this subject*, not
 *                      that anyone decided it was big.
 *
 *   Rarity             a transition this subject carries occasionally rather
 *                      than habitually. A paywalled artist's surprise release
 *                      in a feed that normally reports festivals.
 *
 *   Magnitude          the event's material numbers sitting in the top of this
 *                      subject's own observed range, dimension by dimension.
 *                      Not "$1B is big" but "bigger than this subject's usual
 *                      numbers of that kind", which is the same rule for a
 *                      funding round, a casualty count and a stadium capacity.
 *
 * Every input is already computed for other reasons: `materialState` (which is
 * `markersIn`'s language packs plus the extracted numbers) exists to decide
 * whether a story materially moved. Significance reads the same values
 * against a different baseline, which is why it costs nothing to add and cannot
 * drift from the revision model: one definition of what a material transition
 * is, two questions asked of it.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately is not
 * ---------------------------------------------------------------------------
 *
 * Not a score a reader ever sees, and not a replacement for importance. It is
 * an *admission* signal for one topic: the interest-conditional half of the
 * briefing rule. Importance still leads the ordering, because the world-wide
 * score is the only term that was computed after reading the coverage.
 *
 * Not activated by this module. `match.ts` applies it only when the
 * `subject_significance_enabled` flag is on; until then the shadow comparison
 * below measures what turning it on would do -- to be read before it is turned
 * on, which is the same bargain the deterministic scorer struck.
 */

import { IMPORTANT_FLOOR } from "./alert-floor";
import { materialState } from "./event-version";
import type { MatchSpec, SpecMatch } from "@/lib/match-spec";
import { ALERT_FLOOR, shadowReport, type ScoredPair, type ShadowReport } from "./scoring-shadow";

/* ---------------------------------------------------------------------- */
/* Observations: what one event's coverage contains                        */
/* ---------------------------------------------------------------------- */

export type SubjectObservations = {
  /** Material transitions in the coverage, across every language pack. */
  markers: string[];
  /** `label:bucket` magnitude strings, the same form the revision hash uses. */
  magnitudes: string[];
};

/**
 * The material observations in one event's coverage.
 *
 * `text` is the event's own title and summary, so this is one call per event
 * per run rather than one per reader. Nothing is extracted that the revision
 * model would not have extracted anyway.
 */
export function observationsFor(text: string): SubjectObservations {
  const state = materialState(text);
  return { markers: state.markers, magnitudes: state.magnitudes };
}

/* ---------------------------------------------------------------------- */
/* History: what this subject's coverage has carried                       */
/* ---------------------------------------------------------------------- */

/**
 * Events of one subject needed before "rarer than usual" means anything.
 *
 * Four, and it is a floor against small-sample noise rather than a tuned
 * quantity: with three observations, a marker that appears once looks
 * "occasional" when it is simply new, and everything looks first-time. Below
 * the floor a first occurrence is not claimed at all -- see `subjectSignificance`
 * -- because the honest answer about a subject seen twice is "not enough
 * history", and inventing significance from it is how a fresh topic would spam
 * its reader.
 */
export const MIN_BASELINE_EVENTS = 4;

/** A marker carried by at most this share of the subject's events is unusual. */
export const RARE_SHARE = 0.2;

export type SubjectHistory = {
  /** marker -> how many of the subject's observed events carried it. */
  markerCounts: Map<string, number>;
  /** Every observed magnitude string, one entry per observation. */
  magnitudes: string[];
  /** How many events the history was built from. */
  events: number;
};

/**
 * A subject's history with one of its own events taken back out.
 *
 * The baseline an event is judged against must not contain that event: a marker
 * that only it carries would otherwise count as "seen once", and a first
 * occurrence could never be recognised as one. The history is built once per
 * topic per run, and this subtracts one observation's contribution rather than
 * rebuilding it per event.
 */
export function historyWithout(
  history: SubjectHistory,
  observation: SubjectObservations,
): SubjectHistory {
  const markerCounts = new Map(history.markerCounts);
  for (const marker of new Set(observation.markers)) {
    const count = (markerCounts.get(marker) ?? 0) - 1;
    if (count > 0) markerCounts.set(marker, count);
    else markerCounts.delete(marker);
  }
  const magnitudes = [...history.magnitudes];
  for (const magnitude of observation.magnitudes) {
    const at = magnitudes.indexOf(magnitude);
    if (at >= 0) magnitudes.splice(at, 1);
  }
  return { markerCounts, magnitudes, events: Math.max(0, history.events - 1) };
}

export function historyFrom(observations: readonly SubjectObservations[]): SubjectHistory {
  const markerCounts = new Map<string, number>();
  const magnitudes: string[] = [];
  for (const observation of observations) {
    for (const marker of new Set(observation.markers)) {
      markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + 1);
    }
    magnitudes.push(...observation.magnitudes);
  }
  return { markerCounts, magnitudes, events: observations.length };
}

/* ---------------------------------------------------------------------- */
/* The score                                                               */
/* ---------------------------------------------------------------------- */

/** Points for the first material transition this subject has ever carried. */
const FIRST_OCCURRENCE_POINTS = 2;
/** Points for each additional first-occurrence marker, up to the cap below. */
const EXTRA_FIRST_OCCURRENCE_POINTS = 1;
/** Points for a transition this subject carries unusually rarely. */
const RARE_POINTS = 1;
/** Points for a magnitude at or above the subject's own p90. */
const TOP_MAGNITUDE_POINTS = 2;
/** Points for a magnitude above the subject's own p75. */
const HIGH_MAGNITUDE_POINTS = 1;
/** Ceiling, so no combination of inputs can make a subject term beat the scale. */
export const MAX_SUBJECT_SIGNIFICANCE = 5;
/** One marker plus one first occurrence is already a development. */
export const SUBJECT_SIGNIFICANT_FLOOR = 2;

/** The percentile at or above which a magnitude is "top of this subject's range". */
const P90 = 0.9;
const P75 = 0.75;

export type SubjectSignificance = {
  /** 0..MAX_SUBJECT_SIGNIFICANCE. Compared against `SUBJECT_SIGNIFICANT_FLOOR`. */
  score: number;
  /** Transition markers this subject's history has never carried. */
  firstTime: string[];
  /** Markers the subject carries rarely. */
  rare: string[];
  /** Where the event's largest magnitude sits in this subject's range. */
  magnitudePercentile: number | null;
  /** Why, in the order the score was built. Read by the report, never a reader. */
  reasons: string[];
};

/**
 * The percentile of one observation's magnitudes inside the subject's own range.
 *
 * Compared **within a dimension**, and that word is doing real work. The
 * magnitude strings are `label:bucket`, where the label is what the number
 * counts (`money`, `count`, `pct`, `casualty`). Ranking a `count` against a
 * mixture of counts and money measures nothing: an event's `count:4` would look
 * tiny beside a subject's usual `money:8` funding rounds and enormous beside its
 * `count:1` fixtures, and neither comparison says anything about the event.
 *
 * Bucket indices are the same logarithmic scale across labels, so within one
 * dimension a percentile is meaningful for any subject -- a transfer fee against
 * transfer fees, a stadium capacity against stadium capacities, a casualty count
 * against casualty counts -- without naming which is which.
 *
 * The best (highest) percentile across the event's dimensions is the answer,
 * because one dimension standing out is the development: an album with an
 * ordinary track count and an unusual first-week figure is a development.
 *
 * Null when there is no comparable history: an event with no material numbers,
 * or a dimension the subject has not been observed across at least
 * `MIN_BASELINE_EVENTS` times, has no percentile -- and inventing 1.0 for it
 * would make every first story about a subject maximally significant.
 */
export function magnitudePercentile(
  magnitudes: readonly string[],
  history: readonly string[],
): number | null {
  if (magnitudes.length === 0) return null;

  const observed = new Map<string, number[]>();
  for (const value of history) {
    const parsed = dimensionOf(value);
    if (!parsed) continue;
    const buckets = observed.get(parsed.label);
    if (buckets) buckets.push(parsed.bucket);
    else observed.set(parsed.label, [parsed.bucket]);
  }

  let best: number | null = null;
  for (const value of magnitudes) {
    const parsed = dimensionOf(value);
    if (!parsed) continue;
    const buckets = observed.get(parsed.label);
    if (!buckets || buckets.length < MIN_BASELINE_EVENTS) continue;
    const percentile = buckets.filter((bucket) => bucket < parsed.bucket).length / buckets.length;
    if (best === null || percentile > best) best = percentile;
  }

  return best;
}

/** `label:bucket`, split at the last colon. The label is the dimension. */
function dimensionOf(value: string): { label: string; bucket: number } | null {
  const at = value.lastIndexOf(":");
  if (at <= 0) return null;
  const bucket = Number.parseInt(value.slice(at + 1), 10);
  if (!Number.isFinite(bucket)) return null;
  return { label: value.slice(0, at), bucket };
}

/** The subject-relative score for one event against one subject's history. */
export function subjectSignificance(
  observation: SubjectObservations,
  history: SubjectHistory,
): SubjectSignificance {
  const reasons: string[] = [];
  let score = 0;

  const enoughHistory = history.events >= MIN_BASELINE_EVENTS;

  const firstTime: string[] = [];
  const rare: string[] = [];
  if (enoughHistory) {
    for (const marker of observation.markers) {
      const seen = history.markerCounts.get(marker) ?? 0;
      if (seen === 0) {
        firstTime.push(marker);
        continue;
      }
      if (seen / history.events <= RARE_SHARE) rare.push(marker);
    }
  }

  // A first occurrence is the strongest domain-free signal available: the
  // subject's own coverage has never said this before. Ordered so the score is
  // stable whatever order the markers were extracted in.
  firstTime.sort();
  for (const [index, marker] of firstTime.entries()) {
    score += index === 0 ? FIRST_OCCURRENCE_POINTS : EXTRA_FIRST_OCCURRENCE_POINTS;
    reasons.push(`first ${marker} for this subject`);
  }

  rare.sort();
  for (const marker of rare) {
    score += RARE_POINTS;
    reasons.push(`rare ${marker} for this subject`);
  }

  const percentile = magnitudePercentile(observation.magnitudes, history.magnitudes);
  if (percentile !== null && percentile >= P90) {
    score += TOP_MAGNITUDE_POINTS;
    reasons.push(`magnitude above this subject's p90`);
  } else if (percentile !== null && percentile >= P75) {
    score += HIGH_MAGNITUDE_POINTS;
    reasons.push(`magnitude above this subject's p75`);
  }

  // With no history at all there is nothing subject-relative to say, so the
  // score is zero rather than "everything is new". A brand-new topic's first
  // events are admitted by importance, exactly as they are today.
  if (!enoughHistory && score > 0) reasons.push("insufficient subject history");

  return {
    score: Math.min(MAX_SUBJECT_SIGNIFICANCE, score),
    firstTime,
    rare,
    magnitudePercentile: percentile,
    reasons,
  };
}

/* ---------------------------------------------------------------------- */
/* Relevance: how firmly the interest matched                              */
/* ---------------------------------------------------------------------- */

/** A bare require-group hit is the weakest form of "this is about the subject". */
const CONJUNCTIVE_GROUPS = 2;

/**
 * How strongly one interest matched one event, from the specification.
 *
 * `strong` is the gate the interest-conditional briefing rule uses, and it is
 * deliberately hard to satisfy by accident. Two ways to earn it:
 *
 *   - the interest was expressed as a conjunction (two or more groups), because
 *     "India vs China" matching at all is already precise; or
 *   - the match carried more than the bare groups -- an exact phrase, or an
 *     optional alias the subject's own coverage kept confirming.
 *
 * A single word hit on a broad single-group interest is *not* strong. That is
 * the case where widening admission would be most tempting and most wrong: a
 * subject named by one common word would start promoting its own noise.
 */
export function relevanceStrength(
  spec: MatchSpec,
  match: SpecMatch,
): { strong: boolean; strength: number } {
  const groups = spec.require.length;
  const strong =
    match.matched && groups > 0 && (groups >= CONJUNCTIVE_GROUPS || match.strength > groups);
  return { strong, strength: match.strength };
}

/* ---------------------------------------------------------------------- */
/* Novelty: whether *this reader* already has it                           */
/* ---------------------------------------------------------------------- */

/**
 * Novelty for one reader, from the revision they hold.
 *
 * Not the event's `novelty` column: that is a shared property of the story, and
 * it is the same for everybody. What makes an update worth re-delivering is
 * that the reader has not received *this revision* -- so the reader who holds
 * revision N gets 1 for N+1 and 0 for N.
 *
 * A reader who has never received the event (`null`) gets 1: novelty is about
 * what they have, and they have nothing.
 */
export function readerNovelty(deliveredRevision: number | null, currentRevision: number): number {
  if (deliveredRevision === null) return 1;
  return currentRevision > deliveredRevision ? 1 : 0;
}

/**
 * How long ago the event's current state came into being, in hours.
 *
 * `occurrence` is `events.material_occurrence_at` when the event has materially
 * moved, and `firstSeenAt` otherwise -- the same choice `match.ts` makes for
 * ordering, and for the same reason: a development discovered this morning that
 * happened last week is a week old, and dating it from discovery is the bug this
 * whole layer exists to remove.
 */
export function ageInHours(
  occurrenceAt: string | null,
  firstSeenAt: string,
  now: Date,
): number | null {
  const at = Date.parse(occurrenceAt ?? firstSeenAt);
  if (!Number.isFinite(at)) return null;
  return (now.getTime() - at) / 3_600_000;
}

/* ---------------------------------------------------------------------- */
/* The consumer rule, and its shadow                                       */
/* ---------------------------------------------------------------------- */

export type ConsumerSignals = {
  /** `events.importance` -- the world-facing accelerator. Unchanged. */
  importance: number;
  /** Whether the interest matched firmly. See `relevanceStrength`. */
  relevanceStrong: boolean;
  /** `subjectSignificance(...).score`. */
  subject: number;
  /** `readerNovelty(...)`. */
  novelty: number;
};

/**
 * The importance this event is worth *for this topic*.
 *
 * Never lowers the shared score; only the interest-conditional term can raise
 * it, and only for a topic that matched firmly. That asymmetry is the whole
 * design in one line: a subject-significant development reaches the readers of
 * that subject, and nothing reaches anybody else.
 */
export function subjectTerm(signals: Pick<ConsumerSignals, "relevanceStrong" | "subject">): number {
  if (!signals.relevanceStrong || signals.subject < SUBJECT_SIGNIFICANT_FLOOR) return 0;
  // Two bands, matching the density dial's own floor for "worth knowing if this
  // is your area" (3) and for "you would regret missing it" (6).
  return signals.subject >= MAX_SUBJECT_SIGNIFICANCE - 1 ? 6 : 3;
}

/** What the briefing floor compares for one (event, topic) pair. */
export function briefingScore(signals: ConsumerSignals): number {
  return Math.max(signals.importance, subjectTerm(signals));
}

/**
 * Whether the phone should ring.
 *
 * Deliberately more demanding than the briefing rule: an interruption costs a
 * reader's attention wherever they are, so it needs the same interest-conditional
 * evidence *and* either a subject development or the shared alert floor. Nothing
 * about the existing importance path changes -- a genuine world event alarms
 * exactly as it did before.
 */
export function alertEligible(
  signals: ConsumerSignals,
  options: { importanceFloor?: number; subjectFloor?: number } = {},
): boolean {
  const importanceFloor = options.importanceFloor ?? IMPORTANT_FLOOR;
  const subjectFloor = options.subjectFloor ?? SUBJECT_SIGNIFICANT_FLOOR;
  if (signals.importance >= importanceFloor) return true;
  return signals.relevanceStrong && signals.subject >= subjectFloor && signals.novelty > 0;
}

/**
 * What turning the interest-conditional rule on would change.
 *
 * Expressed as a pair of scores so it measures the thing that matters -- the
 * reader's briefing and their phone -- rather than the distance between two
 * numbers. `ai` is today's behaviour, `deterministic` is the
 * interest-conditional rule, and the shared shadow machinery then reports
 * agreement at every floor the product actually uses, plus the alert misses
 * that would stop a promotion on their own.
 *
 * The two sides differ in the *rule* and in nothing else. Both carry the same
 * novelty -- the shared `events.novelty` that `relevanceOf` orders by -- because
 * the rule under test changes admission, not novelty. An earlier version fed
 * the new side `max(novelty, readerNovelty(...))`, mixing a 0..10 score with a
 * 0/1 flag; that moved the ranking metrics for events the rule never touched,
 * and a shadow that measures its own change of units measures nothing.
 * Reader novelty is still used where the rule uses it: alert eligibility.
 */
export function significanceShadow(rows: readonly SignificanceRow[]): SignificanceShadow {
  const pairs: ScoredPair[] = rows.map((row) => ({
    eventId: row.eventId,
    ai: { importance: row.importance, novelty: row.novelty },
    deterministic: {
      importance: briefingScore({
        importance: row.importance,
        relevanceStrong: row.relevanceStrong,
        subject: row.subject,
        novelty: row.novelty,
      }),
      novelty: row.novelty,
      confidence: "high",
    },
  }));

  const report = shadowReport(pairs);
  return {
    report,
    changedAdmissions: pairs.filter((pair) => pair.ai.importance !== pair.deterministic.importance)
      .length,
    alertChanges: alertShadow(rows),
  };
}

export type SignificanceRow = {
  eventId: string;
  importance: number;
  novelty: number;
  relevanceStrong: boolean;
  subject: number;
  deliveredRevision: number | null;
  currentRevision: number;
};

export type SignificanceShadow = {
  report: ShadowReport;
  /** Rows where the interest-conditional score differs from importance. */
  changedAdmissions: number;
  /** Alerts before and after, and the events that differ. */
  alertChanges: {
    before: number;
    after: number;
    gained: string[];
    lost: string[];
  };
};

function alertShadow(rows: readonly SignificanceRow[]): SignificanceShadow["alertChanges"] {
  const gained: string[] = [];
  const lost: string[] = [];
  let before = 0;
  let after = 0;

  for (const row of rows) {
    const wasAlert = row.importance >= ALERT_FLOOR;
    const isAlert = alertEligible({
      importance: row.importance,
      relevanceStrong: row.relevanceStrong,
      subject: row.subject,
      novelty: readerNovelty(row.deliveredRevision, row.currentRevision),
    });
    if (wasAlert) before += 1;
    if (isAlert) after += 1;
    if (isAlert && !wasAlert) gained.push(row.eventId);
    if (wasAlert && !isAlert) lost.push(row.eventId);
  }

  return { before, after, gained, lost };
}
