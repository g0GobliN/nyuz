/**
 * The evaluation corpus: what a reader received, and what they did not.
 *
 * Audits 1–27 measured defects — duplicated cards, corrupted prose, evidence
 * that never reached a page. Those are questions about the output. This module
 * answers a different one: given a window of real events and the delivery
 * decisions the pipeline actually made, *which stories reached a reader, which
 * did not, and how do we tell the difference between a story that was correctly
 * withheld and one the briefing should have carried?*
 *
 * Three things make that measurable rather than a matter of opinion:
 *
 * 1. **Every rate is a pair of counts.** A rate without its denominator is a
 *    number nobody can check, and a corpus that silently drops a category
 *    reports a healthier world than the one it measured. So each metric here
 *    carries `numerator` and `denominator` together, and `undefined` is
 *    reserved for a genuinely empty denominator rather than for zero.
 *
 * 2. **Importance is a union of observables, never one proxy.** The obvious
 *    mechanical signal — "several outlets covered it" — is unusable in this
 *    corpus: measured over the live window, `publisher_count` is 1 for 446 of
 *    446 recent events, so cross-outlet corroboration would classify every
 *    story as unimportant. The alternative used here is breadth across
 *    *independent signals* (audience matching, delivery, material revision,
 *    corroboration, entity salience, significance), and the metric reports
 *    which signals fired. A single proxy silently becomes ground truth; six
 *    signals that disagree stay visible as disagreement.
 *
 * 3. **Absence of evidence is a measurement, not a zero.** A story whose
 *    evidence was never fetched is not a story with no evidence, and counting
 *    it as one would blame the reader-facing layer for an ingestion gap. Those
 *    rows are counted separately, as `unevaluable`.
 *
 * Pure: no database, no clock, no I/O. The script that reads Postgres is
 * `scripts/reader-eval-corpus.ts`, and it decides nothing this module does not
 * define.
 */

import { sourceFamily } from "./pipeline/source-text";

/* ---------------------------------------------------------------------- */
/* Rows                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * One event, as the evaluation sees it.
 *
 * Deliberately flat and deliberately small: this is the shape a label file
 * carries, so it has to be hand-editable by a human reading a diff.
 */
export type EvalRow = {
  id: string;
  title: string;
  /** The event's own `what_happened`, which may legitimately be empty. */
  what: string;
  /** `events.importance`, 0..10, set by the shared analysis pass. */
  importance: number;
  /** How many publishers the pipeline attached. 1 for nearly every event. */
  publisherCount: number;
  /** `events.status`; only `complete` rows belong in a briefing window. */
  status: string;
  /** Distinct source names attached to the event, read from `articles`. */
  sourceNames: string[];
  /** `published_at` values present on the event's articles. */
  sourceTimes: string[];
  /** Whether at least one article carries enriched reader evidence. */
  enriched: boolean;
  /** Reader evidence units available across the event's articles. */
  evidenceUnits: number;
  /** The event's `material_revision`; 0 for a story that never moved. */
  materialRevision: number;
  /** Topic labels the pipeline assigned, in rank order. */
  topics: string[];
  /** The reader profiles this event was matched to. */
  audience: number;
  /** Whether any digest ever carried it. */
  delivered: boolean;
  /**
   * Why the pipeline did not deliver it, when it says so itself.
   *
   * Read from the delivery decision, never inferred: `never_matched` is a
   * ranking outcome, `no_evidence` is an ingestion outcome, and `matched_not_sent`
   * is a delivery outcome. Treating those as one number is how a corpus starts
   * lying about its own failures — each of the three is repaired by a different
   * change, and only the third is a bug rather than a judgement.
   */
  withheldReason: WithheldReason;
  /** When the event was first seen, for the window census. */
  firstSeenAt: string;
};

export type WithheldReason =
  | "delivered"
  /** No user was ever matched to it: a ranking outcome, not a fetch failure. */
  | "never_matched"
  /** A user was matched and the match never expired, yet no digest carried it. */
  | "matched_not_sent"
  /** Zero enriched evidence anywhere on the event: nothing to compose a Read from. */
  | "no_evidence"
  /** The match window closed before delivery. */
  | "expired"
  | "unknown";

/** The reasons a story can be missing, in the order a report should read them. */
export const WITHHELD_REASONS: readonly WithheldReason[] = [
  "delivered",
  "never_matched",
  "matched_not_sent",
  "no_evidence",
  "expired",
  "unknown",
];

/* ---------------------------------------------------------------------- */
/* Rates                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * A rate that carries its own denominator.
 *
 * `value` is `undefined` when nothing was in the denominator, which is not the
 * same as zero: "no story was withheld" and "no story was considered" are
 * different findings, and a corpus that renders both as `0.00` cannot tell them
 * apart. Callers print `—` for `undefined`, never `0`.
 */
export type Rate = {
  numerator: number;
  denominator: number;
  value: number | undefined;
};

export function rate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? undefined : numerator / denominator,
  };
}

/** A rate as a terminal line: `38.9% (14/36)`, or `— (0/0)`. */
export function formatRate(value: Rate, digits = 1): string {
  const percent = value.value === undefined ? "—" : `${(value.value * 100).toFixed(digits)}%`;
  return `${percent} (${value.numerator}/${value.denominator})`;
}

/* ---------------------------------------------------------------------- */
/* Importance signals                                                      */
/* ---------------------------------------------------------------------- */

/**
 * The independent observables that argue a story deserved a briefing.
 *
 * Every one of these is read from the row, so a reader of the report can
 * disagree with the *thresholds* without having to trust the pipeline's own
 * opinion of itself. The names are the vocabulary the report and the labels
 * share.
 *
 * `has_evidence` is deliberately NOT here. Evidence is the precondition for
 * evaluating a story, not evidence that the story matters — a vendor's annual
 * security report has twelve evidence units and no claim on a briefing. Counting
 * it as an importance signal was measured and rejected: over the 30-day window
 * it made 100 withheld stories look notable when the real figure was 50, and 50
 * of the 54 `matched_not_sent` rows fired it *alone*. Availability is reported
 * separately, as `unevaluableRate`.
 */
export const IMPORTANCE_SIGNALS = [
  /** More than one independent source carried it. */
  "corroborated",
  /** More than one reader profile was matched to it. */
  "audience",
  /** The pipeline judged it worth 7 or more out of 10. */
  "high_importance",
  /** Its material fingerprint moved after first delivery. */
  "revised",
] as const;

export type ImportanceSignal = (typeof IMPORTANCE_SIGNALS)[number];

/**
 * How strong a story's claim on a briefing is, as the set of signals that fired.
 *
 * Deliberately a *set* and not a score. A score invites a threshold nobody can
 * argue with; a set lets the report say "this was withheld with two signals
 * firing" and lets the next audit ask which of the two was wrong.
 */
export function importanceSignals(row: EvalRow): ImportanceSignal[] {
  const fired: ImportanceSignal[] = [];
  if (row.publisherCount >= 2 || distinctSources(row) >= 2) fired.push("corroborated");
  if (row.audience >= 2) fired.push("audience");
  if (row.importance >= 7) fired.push("high_importance");
  if (row.materialRevision > 0) fired.push("revised");
  return fired;
}

/** Distinct publisher names, case- and whitespace-insensitive. */
export function distinctSources(row: EvalRow): number {
  return new Set(
    row.sourceNames.map((name) => name.trim().toLowerCase()).filter((name) => name !== ""),
  ).size;
}

/**
 * Whether a story is a research paper rather than reporting.
 *
 * Read through the pipeline's own `sourceFamily`, so the evaluation and the
 * ingestion layer cannot disagree about what an arXiv row is — the one thing
 * worse than a filter with no measurement is a measurement of a different
 * filter.
 */
export function isResearch(row: EvalRow): boolean {
  return row.sourceNames.some((name) => sourceFamily({ name, url: "" }) === "arxiv");
}

/**
 * The signals that fired on a withheld story, strongest first.
 *
 * "Strongest" is about how hard each signal is to explain away, not about how
 * many outlets it involves: a revision is a fact the pipeline itself recorded,
 * while corroboration is a count that is 1 for almost every row in this corpus.
 */
export function withheldSignalStrength(row: EvalRow): ImportanceSignal[] {
  const order: ImportanceSignal[] = ["revised", "corroborated", "audience", "high_importance"];
  const fired = new Set(importanceSignals(row));
  return order.filter((signal) => fired.has(signal));
}

/* ---------------------------------------------------------------------- */
/* Duplicates                                                              */
/* ---------------------------------------------------------------------- */

/**
 * A pair of rows that describe one real-world incident as two events.
 *
 * The pair is reported with its *shared* evidence so a human can adjudicate it:
 * a duplicate rate computed from a predicate nobody can inspect is a number
 * that cannot be argued with, and this corpus exists to be argued with.
 */
export type DuplicatePair = {
  leftId: string;
  rightId: string;
  leftTitle: string;
  rightTitle: string;
  /** Distinct source names the two events share. */
  sharedSources: string[];
  /** Entities both titles name, lowercased. */
  sharedEntities: string[];
  /** Numeric anchors both titles carry, verbatim. */
  sharedFigures: string[];
  /** Whether both were delivered — the case a reader actually saw twice. */
  bothDelivered: boolean;
};

/**
 * Duplicate rate over a window, in the two forms that matter.
 *
 * `eventRate` is the share of events entangled in at least one duplicate pair,
 * which is the number that tracks how often a reader sees one incident twice.
 * `pairRate` is the share of compared pairs that are duplicates, which is the
 * number that tracks the predicate's precision. They are reported separately
 * because a predicate can be very precise and still leave many events
 * entangled, and collapsing them into one "duplicate rate" hides which problem
 * is being solved.
 */
export type DuplicateCensus = {
  /** Events considered, after the window and completeness filter. */
  events: number;
  /** Pairs compared, after the proximity filter. */
  pairs: number;
  /** Pairs judged duplicates. */
  duplicatePairs: DuplicatePair[];
  /** Events appearing in at least one duplicate pair. */
  entangled: number;
  eventRate: Rate;
  pairRate: Rate;
  /** Duplicates where both copies were delivered — the reader-visible ones. */
  deliveredPairs: number;
};

/* ---------------------------------------------------------------------- */
/* Census                                                                  */
/* ---------------------------------------------------------------------- */

/** One bucket of the window, by the reason a story is where it is. */
export type WithheldBucket = {
  reason: WithheldReason;
  events: number;
  /** Of those, how many carry at least one importance signal. */
  withSignal: number;
};

export type EvalCensus = {
  /** Every row handed in. */
  rows: number;
  /** Rows excluded before measurement, and why. */
  excluded: { notComplete: number; noEvidence: number; noSources: number };
  /** Rows the metrics were computed over. */
  measured: number;
  delivered: number;
  withheld: number;
  /** Share of measured events that reached a reader. */
  deliveryRate: Rate;
  /** Share of measured events whose evidence was never enriched. */
  unevaluableRate: Rate;
  withheldByReason: WithheldBucket[];
  /** Withheld stories carrying at least one importance signal. */
  withheldWithSignal: number;
  /** Of those, the ones no reader-facing explanation can excuse. */
  withheldNotable: EvalRow[];
  /** Research papers, and how many reached a reader. */
  research: { events: number; delivered: number; withheldWithSignal: number };
  /** Events that moved after delivery. */
  revised: { events: number; delivered: number };
  /** The window's date span, for a reader who needs to know what it covers. */
  span: { from: string; to: string };
};

/**
 * The whole measurement, over one window.
 *
 * `measure` never throws on a partial row and never invents a denominator: a
 * window with no complete events reports `undefined` rates, which the report
 * prints as `—`, rather than a reassuring `0%`.
 */
export function measure(rows: readonly EvalRow[]): EvalCensus {
  const notComplete = rows.filter((row) => row.status !== "complete").length;
  const noSources = rows.filter((row) => row.sourceNames.length === 0).length;
  const measured = rows.filter((row) => row.status === "complete" && row.sourceNames.length > 0);

  const delivered = measured.filter((row) => row.delivered);
  const withheld = measured.filter((row) => !row.delivered);

  const withheldByReason = WITHHELD_REASONS.filter((reason) => reason !== "delivered").map(
    (reason) => {
      const bucket = withheld.filter((row) => row.withheldReason === reason);
      return {
        reason,
        events: bucket.length,
        withSignal: bucket.filter((row) => importanceSignals(row).length > 0).length,
      };
    },
  );

  const withheldNotable = withheld
    .filter((row) => importanceSignals(row).length > 0)
    .sort((left, right) => {
      const leftSignals = withheldSignalStrength(left).length;
      const rightSignals = withheldSignalStrength(right).length;
      if (rightSignals !== leftSignals) return rightSignals - leftSignals;
      return right.importance - left.importance;
    });

  const researchRows = measured.filter(isResearch);
  const revisedRows = measured.filter((row) => row.materialRevision > 0);

  const times = measured
    .map((row) => row.firstSeenAt)
    .filter((value) => value !== "")
    .sort();

  return {
    rows: rows.length,
    excluded: {
      notComplete,
      noEvidence: measured.filter((row) => !row.enriched).length,
      noSources,
    },
    measured: measured.length,
    delivered: delivered.length,
    withheld: withheld.length,
    deliveryRate: rate(delivered.length, measured.length),
    unevaluableRate: rate(measured.filter((row) => !row.enriched).length, measured.length),
    withheldByReason,
    withheldWithSignal: withheldNotable.length,
    withheldNotable,
    research: {
      events: researchRows.length,
      delivered: researchRows.filter((row) => row.delivered).length,
      withheldWithSignal: researchRows.filter(
        (row) => !row.delivered && importanceSignals(row).length > 0,
      ).length,
    },
    revised: {
      events: revisedRows.length,
      delivered: revisedRows.filter((row) => row.delivered).length,
    },
    span: {
      from: times[0] ?? "",
      to: times[times.length - 1] ?? "",
    },
  };
}
