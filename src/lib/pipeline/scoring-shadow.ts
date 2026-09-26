/**
 * Does the deterministic scorer make the same product decisions as the model?
 *
 * ---------------------------------------------------------------------------
 * Why decisions and not scores
 * ---------------------------------------------------------------------------
 *
 * The obvious measurement — mean absolute error between `events.importance` and
 * `scoreEvent().importanceEstimate` — is the wrong one, and comfortably the
 * easiest to be misled by. Nothing in this product reads `importance` as a
 * number a reader sees. Three things read it, and all three read it through a
 * threshold:
 *
 *   - `match.ts` admits an event when `importance >= floorFor(topic, density)`,
 *     which is one of 0, 1, 3 or 6;
 *   - `relevanceOf` orders a briefing by `importance + novelty/2 + …`;
 *   - `alerts.ts` fires when `importance >= IMPORTANT_FLOOR`, which is 6.
 *
 * So a deterministic 5 against a model 7 is a catastrophe at the alert floor and
 * completely invisible at Focused density, while a deterministic 2 against a
 * model 4 changes nothing anywhere. An error metric averages those together and
 * reports a number that means nothing. This module asks the only question that
 * matters instead: **given the same event, does the reader's briefing, ordering
 * and phone behave the same way?**
 *
 * ---------------------------------------------------------------------------
 * Which error is worse
 * ---------------------------------------------------------------------------
 *
 * Not symmetric, and the asymmetry decides whether this is promotable.
 *
 *   - A **false positive** admits something the model would have kept out. The
 *     reader sees one story too many. Mildly annoying.
 *   - A **false negative** keeps out something the model would have admitted. At
 *     the briefing floor the reader silently never learns it happened; at the
 *     alert floor, a genuinely important breaking event does not reach their
 *     phone. There is no error message and nothing to notice.
 *
 * `missedImportant` below is therefore reported separately from the general
 * false-negative rate, because a miss at the alert floor is the number that
 * should stop a promotion on its own.
 *
 * Nothing here calls a model, changes a score, or writes a row. It measures.
 */

import { floorFor, thresholdFor } from "@/lib/density";
import { IMPORTANT_FLOOR } from "./alert-floor";
import type { TopicImportance } from "@/lib/supabase/types";

/** One event, scored both ways. The unit this whole module operates on. */
export type ScoredPair = {
  eventId: string;
  /** What the model wrote to `events.importance` / `.novelty`. */
  ai: { importance: number; novelty: number };
  /** What `scoreEvent` produces from the same coverage, at the same clock. */
  deterministic: { importance: number; novelty: number; confidence: string };
};

export type AdmissionMetrics = {
  floor: number;
  label: string;
  /** Events both scorers admit. */
  truePositives: number;
  /** Events both scorers exclude. */
  trueNegatives: number;
  /** Deterministic admits, model would not. The reader sees one extra story. */
  falsePositives: number;
  /** Model admits, deterministic would not. The reader silently misses it. */
  falseNegatives: number;
  /** Share of events where both reach the same verdict. */
  agreement: number;
  /** Of everything the model admitted, the share deterministic would drop. */
  missRate: number;
};

/** The floors that actually exist in the product, named as a reader would see them. */
export const PRODUCT_FLOORS: { floor: number; label: string }[] = [
  { floor: thresholdFor(10), label: "Minimal density / only_major" },
  { floor: thresholdFor(30), label: "Focused density" },
  { floor: thresholdFor(60), label: "Broad density" },
  { floor: thresholdFor(90), label: "Deep density / everything" },
];

/** The alert floor, kept separate because a miss here is the expensive one. */
export const ALERT_FLOOR = IMPORTANT_FLOOR;

function admits(floor: number, importance: number): boolean {
  return importance >= floor;
}

/**
 * Admission agreement at one floor.
 *
 * Deliberately counts four cells rather than one accuracy figure: a floor where
 * the model admits three events out of nine hundred can look 99.7% accurate
 * while missing every single one of them.
 */
export function admissionAt(pairs: ScoredPair[], floor: number, label: string): AdmissionMetrics {
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const pair of pairs) {
    const modelAdmits = admits(floor, pair.ai.importance);
    const codeAdmits = admits(floor, pair.deterministic.importance);
    if (modelAdmits && codeAdmits) truePositives++;
    else if (!modelAdmits && !codeAdmits) trueNegatives++;
    else if (codeAdmits) falsePositives++;
    else falseNegatives++;
  }

  const total = pairs.length || 1;
  const modelAdmitted = truePositives + falseNegatives;
  return {
    floor,
    label,
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
    agreement: (truePositives + trueNegatives) / total,
    missRate: modelAdmitted === 0 ? 0 : falseNegatives / modelAdmitted,
  };
}

/**
 * `relevanceOf` from match.ts, reduced to the part the scorer controls.
 *
 * The per-reader terms — how many of their topics matched, whether a source is
 * a priority, the topic weight — are identical whichever scorer produced the
 * importance, so they cancel out of an ordering comparison and are omitted.
 * What remains is exactly `importance + novelty / 2`, which is the contribution
 * this change is capable of altering.
 */
export function orderingKey(importance: number, novelty: number): number {
  return importance + novelty / 2;
}

export type RankingMetrics = {
  n: number;
  /** Share of the model's top N that deterministic also puts in its top N. */
  topNOverlap: number;
  /** Share of event pairs the two scorers order the same way. */
  pairwiseAgreement: number;
};

/**
 * Ranking agreement, measured two ways because they fail differently.
 *
 * `topNOverlap` is what a reader sees: a briefing has a finite per-plan story cap, so
 * the only ordering question that reaches them is which events make the cut.
 * `pairwiseAgreement` is the underlying ordering quality, and catches a scorer
 * that picks the same set but shuffles it.
 *
 * Ties are counted as agreement. Two events with an equal claim on attention are
 * a real tie in `relevanceOf`, and calling a tie a disagreement would penalise
 * the deterministic scorer for the coarseness the product already tolerates.
 */
export function rankingAgreement(pairs: ScoredPair[], n: number): RankingMetrics {
  const byAi = [...pairs].sort(
    (a, b) =>
      orderingKey(b.ai.importance, b.ai.novelty) - orderingKey(a.ai.importance, a.ai.novelty),
  );
  const byCode = [...pairs].sort(
    (a, b) =>
      orderingKey(b.deterministic.importance, b.deterministic.novelty) -
      orderingKey(a.deterministic.importance, a.deterministic.novelty),
  );

  const topAi = new Set(byAi.slice(0, n).map((p) => p.eventId));
  const topCode = new Set(byCode.slice(0, n).map((p) => p.eventId));
  const overlap = [...topAi].filter((id) => topCode.has(id)).length;

  let concordant = 0;
  let comparable = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i];
      const b = pairs[j];
      if (!a || !b) continue;
      comparable++;
      const aiDelta =
        orderingKey(a.ai.importance, a.ai.novelty) - orderingKey(b.ai.importance, b.ai.novelty);
      const codeDelta =
        orderingKey(a.deterministic.importance, a.deterministic.novelty) -
        orderingKey(b.deterministic.importance, b.deterministic.novelty);
      if (Math.sign(aiDelta) === Math.sign(codeDelta)) concordant++;
    }
  }

  return {
    n,
    topNOverlap: topAi.size === 0 ? 1 : overlap / topAi.size,
    pairwiseAgreement: comparable === 0 ? 1 : concordant / comparable,
  };
}

export type ShadowReport = {
  events: number;
  /** Admission agreement at every floor the product actually uses. */
  admission: AdmissionMetrics[];
  /** The alert floor, called out separately — see the module header. */
  alerts: AdmissionMetrics;
  ranking: RankingMetrics[];
  /** Distribution of both scores, because a scorer that never reaches 6 cannot alert. */
  distribution: {
    ai: Record<number, number>;
    deterministic: Record<number, number>;
  };
  /**
   * The events the model called important and the deterministic scorer would
   * drop from an alert. The list, not the count — these have to be read.
   */
  missedImportant: string[];
};

function histogram(values: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (let score = 0; score <= 10; score++) out[score] = 0;
  for (const value of values) {
    const bucket = Math.max(0, Math.min(10, Math.round(value)));
    out[bucket] = (out[bucket] ?? 0) + 1;
  }
  return out;
}

export function shadowReport(pairs: ScoredPair[]): ShadowReport {
  const alerts = admissionAt(pairs, ALERT_FLOOR, "Alert floor");
  return {
    events: pairs.length,
    admission: PRODUCT_FLOORS.map(({ floor, label }) => admissionAt(pairs, floor, label)),
    alerts,
    ranking: [3, 6, 10, 18].map((n) => rankingAgreement(pairs, n)),
    distribution: {
      ai: histogram(pairs.map((p) => p.ai.importance)),
      deterministic: histogram(pairs.map((p) => p.deterministic.importance)),
    },
    missedImportant: pairs
      .filter(
        (p) =>
          admits(ALERT_FLOOR, p.ai.importance) && !admits(ALERT_FLOOR, p.deterministic.importance),
      )
      .map((p) => p.eventId),
  };
}

/**
 * Whether this scorer is safe to promote.
 *
 * Deliberately strict on the alert floor and forgiving elsewhere, for the
 * asymmetry reason in the header. The thresholds are a starting position to
 * argue with once there are real numbers to argue about, not a law — which is
 * why the function returns the failing reasons rather than a bare boolean.
 */
export function promotionVerdict(report: ShadowReport): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (report.alerts.missRate > 0.1) {
    blockers.push(
      `Alert miss rate ${(report.alerts.missRate * 100).toFixed(1)}% — the deterministic scorer ` +
        `would not have alerted on ${report.alerts.falseNegatives} events the model called important.`,
    );
  }
  for (const floor of report.admission) {
    if (floor.missRate > 0.2) {
      blockers.push(
        `${floor.label}: would drop ${(floor.missRate * 100).toFixed(1)}% of what the model admitted.`,
      );
    }
  }
  const topSix = report.ranking.find((r) => r.n === 6);
  if (topSix && topSix.topNOverlap < 0.6) {
    blockers.push(
      `Top-6 overlap ${(topSix.topNOverlap * 100).toFixed(1)}% — the briefing would be a different briefing.`,
    );
  }

  return { ready: blockers.length === 0, blockers };
}

/** Per-topic floors, for reporting what `only_major` and `everything` readers get. */
export function topicFloor(importance: TopicImportance, density: number): number {
  return floorFor(importance, thresholdFor(density));
}
