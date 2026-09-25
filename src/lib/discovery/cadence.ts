/**
 * How well is this subject covered? Answered relative to the subject's own pace.
 *
 * ---------------------------------------------------------------------------
 * The mistake this exists to prevent
 * ---------------------------------------------------------------------------
 *
 * The obvious coverage reading is "events in the last 24 hours". It is also
 * wrong for most of the catalogue. A national daily produces an event or two a
 * day; a niche modular-synth scene produces one every fortnight and is perfectly
 * well covered; a local transit authority produces one when a route changes,
 * which may be twice a year. Judging all three by a one-day window declares the
 * second and third uncovered and sends discovery hunting for sources the subject
 * already has -- spending a search budget to fix a subject that was never broken.
 *
 * The fix is not a longer window. It is to measure the subject against **its own
 * observed pace**: the median gap between its relevant events, from its own
 * history. Then:
 *
 *   current gap > max(3 x median gap, 7-day floor, 30-day ceiling)   ->  stale
 *
 * The floor is what stops a subject that normally moves hourly (a live sports
 * feed) being called stale overnight. The ceiling is what stops a subject whose
 * measured pace is noisy from buying itself months of silence. And a subject
 * whose gap is inside its own envelope is **strong** -- provided at least two
 * distinct sources contribute to it, because one source is a single point of
 * failure rather than coverage.
 *
 * ---------------------------------------------------------------------------
 * Frequency is not importance, and neither is coverage
 * ---------------------------------------------------------------------------
 *
 * Nothing here says a quiet subject matters less. `stale` means "this subject has
 * gone unusually quiet for itself, so look for what it is not telling us";
 * `none` means "demand exists and nothing has ever arrived". The two call for
 * different actions -- steady discovery for the first, immediate discovery for
 * the second -- and conflating them is how a fortnightly subject gets treated as
 * a failure on its first quiet Tuesday.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from
 * ---------------------------------------------------------------------------
 *
 * `coverageSignalsFrom` is the reading: event timestamps for the subject, the
 * sources mapped to it, how many readers follow it, and how many trials are open.
 * It is pure so this file can be tested against every cadence above without a
 * database; the fetch that produces its input is one bounded query per topic in
 * a batch, and belongs to the discovery stage rather than here.
 */

/** Observations of a subject's gaps needed before its pace means anything. */
export const MIN_INTERVALS = 3;

/** Never call a subject stale before this long, whatever its measured pace. */
export const STALE_FLOOR_DAYS = 7;

/**
 * Never wait longer than this before looking again.
 *
 * A subject whose only observed gaps are enormous would otherwise be considered
 * healthy forever, and a source that silently died would never be replaced.
 */
export const STALE_CEILING_DAYS = 30;

/** Multiple of the subject's median gap at which it counts as unusually quiet. */
export const STALE_MULTIPLE = 3;

/** Distinct sources needed for coverage to count as strong rather than thin. */
export const STRONG_SOURCE_DIVERSITY = 2;

export type CoverageClass =
  /** Nobody follows it. Coverage is not a question worth answering. */
  | "untracked"
  /** Followed, and nothing has ever arrived. */
  | "none"
  /** Sources are being tried right now; do not add more until they report. */
  | "trial"
  /** Unusually quiet for itself: look for what it is not telling us. */
  | "stale"
  /** Inside its own envelope, with more than one source contributing. */
  | "strong"
  /** Inside its own envelope, but on a single source. */
  | "thin";

export type CoverageSignals = {
  /** Readers following the subject. */
  demandUsers: number;
  /** Publication times (or first-seen times) of the subject's relevant events. */
  eventTimes: readonly string[];
  /** Sources mapped to the subject in `source_topics`. */
  mappedSources: number;
  /** Discovery trials currently running for the subject. */
  openTrials: number;
  /** The clock to measure against. */
  now: Date;
};

export type CoverageReading = {
  classification: CoverageClass;
  /** Hours since the most recent relevant event, or null if there has never been one. */
  gapHours: number | null;
  /** Median observed gap in hours, or null below `MIN_INTERVALS` observations. */
  baselineHours: number | null;
  /** The threshold this reading was judged against, in hours. */
  staleAfterHours: number;
  /** Why, in the order the reading was built. Read by an operator, never a reader. */
  reasons: string[];
};

/**
 * The median gap between consecutive observations, in hours.
 *
 * Median rather than mean, deliberately: one long silence (a quiet summer, a
 * cancelled season) would drag a mean up and make every later gap look normal,
 * which is the opposite of what this is for.
 */
export function medianIntervalHours(times: readonly string[]): number | null {
  const parsed = [...new Set(times)]
    .map((time) => Date.parse(time))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (parsed.length < MIN_INTERVALS + 1) return null;

  const gaps: number[] = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const previous = parsed[i - 1];
    const current = parsed[i];
    if (previous === undefined || current === undefined) continue;
    gaps.push((current - previous) / 3_600_000);
  }
  if (gaps.length === 0) return null;

  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const high = gaps[middle] ?? 0;
  const low = gaps[middle - 1];
  return gaps.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

/**
 * The gap beyond which a subject is unusually quiet *for itself*.
 *
 * `3 x` the median, floored at a week and capped at a month -- plus one
 * self-consistency rule: the threshold is never tighter than the subject's own
 * normal gap.
 *
 * Without that rule the ceiling backfires on exactly the subjects the ceiling
 * was not written for. A transit authority that changes a route every ninety
 * days would be "stale" for sixty of them, and a reading that is true most of
 * the time is not a reading -- it would put a permanent discovery job on every
 * slow subject and starve the ones that genuinely went quiet. Slow subjects are
 * re-examined after their own pace; the ceiling binds where it belongs, on a
 * subject whose usual gap is between ten and thirty days.
 */
export function staleAfterHours(baselineHours: number | null): number {
  const floor = STALE_FLOOR_DAYS * 24;
  const ceiling = STALE_CEILING_DAYS * 24;
  if (baselineHours === null) return floor;
  const window = Math.min(ceiling, Math.max(floor, baselineHours * STALE_MULTIPLE));
  return Math.max(window, baselineHours);
}

/**
 * Classify one subject's coverage.
 *
 * Order matters and is the same order a person would reason in: is anybody
 * following this, is anything being tried, has anything ever arrived, then is it
 * quiet for itself, and finally is it strong or merely single-sourced.
 */
export function classifyCoverage(signals: CoverageSignals): CoverageReading {
  const reasons: string[] = [];
  const baselineHours = medianIntervalHours(signals.eventTimes);
  const staleAfter = staleAfterHours(baselineHours);

  const newest = signals.eventTimes
    .map((time) => Date.parse(time))
    .filter((value) => Number.isFinite(value))
    .reduce<number | null>((max, value) => (max === null || value > max ? value : max), null);
  const gapHours = newest === null ? null : (signals.now.getTime() - newest) / 3_600_000;

  const base = { gapHours, baselineHours, staleAfterHours: staleAfter, reasons };

  if (signals.demandUsers <= 0) {
    return { ...base, classification: "untracked", reasons: [...reasons, "no readers follow it"] };
  }
  if (signals.openTrials > 0) {
    return {
      ...base,
      classification: "trial",
      reasons: [...reasons, `${signals.openTrials} trial source(s) in progress`],
    };
  }
  if (gapHours === null) {
    return {
      ...base,
      classification: "none",
      reasons: [...reasons, "readers follow it and no relevant event has ever arrived"],
    };
  }

  if (baselineHours !== null) reasons.push(`usual gap is about ${Math.round(baselineHours)}h`);
  if (gapHours > staleAfter) {
    return {
      ...base,
      classification: "stale",
      reasons: [
        ...reasons,
        `quiet for ${Math.round(gapHours)}h against a threshold of ${Math.round(staleAfter)}h`,
      ],
    };
  }

  if (signals.mappedSources >= STRONG_SOURCE_DIVERSITY) {
    return {
      ...base,
      classification: "strong",
      reasons: [...reasons, `${signals.mappedSources} sources contributing`],
    };
  }

  return {
    ...base,
    classification: "thin",
    reasons: [
      ...reasons,
      signals.mappedSources === 0
        ? "inside its own pace, but no source is mapped to it"
        : "inside its own pace, but only one source",
    ],
  };
}

/**
 * What the discovery stage should do about a reading.
 *
 * The scheduling model, stated once so it is the same rule everywhere:
 *
 *   none      immediate  demand exists and nothing has ever arrived
 *   trial     paused     sources are being tried; wait for them to report
 *   stale     active     look for what the subject is not telling us
 *   thin      backoff    covered by one source: worth a second, not urgent
 *   strong    off        leave it alone
 *   untracked off        nobody is waiting for it
 *
 * `thin` waiting behind `stale` is the priority the product actually wants: a
 * single-source subject that is producing is not broken, and a subject that has
 * gone silent is.
 */
export type DiscoveryAppetite = "immediate" | "active" | "paused" | "backoff" | "off";

export function discoveryAppetite(reading: CoverageReading): DiscoveryAppetite {
  switch (reading.classification) {
    case "none":
      return "immediate";
    case "trial":
      return "paused";
    case "stale":
      return "active";
    case "thin":
      return "backoff";
    case "strong":
    case "untracked":
      return "off";
  }
}

/**
 * The pure part of reading coverage: rows in, signals out.
 *
 * The discovery stage's query produces these fields per topic; keeping the
 * assembly here means the classification can be tested against every cadence in
 * this file's tests and cannot disagree with the fetch that feeds it.
 */
export function coverageSignalsFrom(input: {
  topicId: string;
  demandUsers: number;
  eventTimes: readonly string[];
  mappedSources: number;
  openTrials: number;
  now: Date;
}): CoverageSignals & { topicId: string } {
  return {
    topicId: input.topicId,
    demandUsers: input.demandUsers,
    eventTimes: input.eventTimes,
    mappedSources: input.mappedSources,
    openTrials: input.openTrials,
    now: input.now,
  };
}
