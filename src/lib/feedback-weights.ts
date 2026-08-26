/**
 * Turning what a reader did into topic weights.
 *
 * `user_topics.weight` has existed since `0001_init.sql`, where its comment says
 * it is "adjusted by the feedback loop; multiplies relevance at match time".
 * `match.ts` has always read it. Nothing ever wrote it, so every reader sat at
 * 1.0 forever. This module is the missing half.
 *
 * ---------------------------------------------------------------------------
 * Behaviour is the signal. The buttons are a bonus.
 * ---------------------------------------------------------------------------
 *
 * The product should get better without ever asking. Nobody wants a briefing
 * that interrogates them — a thumbs-up prompt after every story is a tax on
 * reading, and the readers most worth keeping are the ones least willing to pay
 * it. So the primary input here is what happened: which stories were shown,
 * which were opened, which were read to the end, which were skipped.
 *
 * The explicit controls stay exactly as they are, and when a reader does use one
 * it **overrides** the inference for that story. Someone who takes the trouble
 * to press a thumb has told us something more reliable than dwell time, and we
 * should believe them over our own guess. But nothing prompts for it, and a
 * reader who never touches a chip still gets a briefing that improves.
 *
 * ---------------------------------------------------------------------------
 * Not opening a story is barely evidence at all
 * ---------------------------------------------------------------------------
 *
 * This is the trap in applying engagement scoring to a briefing, and getting it
 * wrong would make the product worse in a way that looks like it is working.
 *
 * In a feed, ignoring an item means you did not want it. Here it very often
 * means the opposite: the briefing paragraph told you what you needed, so there
 * was no reason to click. Treating that as rejection would systematically
 * demote the topics the product serves *best* — the ones where the summary is
 * complete enough to be the whole answer.
 *
 * So a skip is worth a fraction of an open, needs several impressions before it
 * counts at all, and can never on its own drive a topic far from base. What
 * carries real weight is time spent on a story that was opened.
 *
 * ---------------------------------------------------------------------------
 * Recomputed, never nudged
 * ---------------------------------------------------------------------------
 *
 * A weight is a pure function of the signals that exist right now, rather than a
 * running total that gets adjusted. That is what makes changing a vote undo
 * itself, makes a double-submitted request harmless, and means a weight that is
 * somehow wrong is repaired by the next recompute instead of staying wrong
 * forever. Replay the same signals in any order and the answer is identical.
 */

export type FeedbackVote = "useful" | "not_useful" | "not_interested";

/** How far one unit of net signal moves the multiplier. */
const STEP = 0.15;

/**
 * Floor and ceiling.
 *
 * The floor is above zero on purpose. `weight` multiplies relevance, so zero
 * would silently remove a topic the reader still has selected — a preference
 * they set, overridden by inference, with nothing on screen saying so. A quarter
 * still lets a genuinely important story through, which is the honest behaviour
 * for "you keep skipping these" as opposed to "mute this".
 */
const MIN_WEIGHT = 0.25;
const MAX_WEIGHT = 3;

/** The default every `user_topics` row starts at. */
export const BASE_WEIGHT = 1;

/* ---------------------------------------------------------------------- */
/* Signal strength                                                        */
/* ---------------------------------------------------------------------- */

/** An explicit vote is worth this much, positive or negative. */
const VOTE_USEFUL = 1;
const VOTE_NOT_USEFUL = -1;
/** "Not interested" is about the subject, not the story. It counts harder. */
const VOTE_NOT_INTERESTED = -1.5;

/** Read to the end, or long enough that it does not matter. */
const READ_FULLY = 0.6;
/** Opened and stayed a while. */
const READ_SOME = 0.3;
/** Opened at all. Clicking through is itself mild interest. */
const OPENED = 0.1;
/** Opened and gone again immediately — the headline drew, the story did not. */
const BOUNCED = -0.2;

/**
 * Shown repeatedly and never opened. Small on purpose: see the note above about
 * a good briefing paragraph removing the reason to click.
 */
const SKIPPED = -0.15;

/** Impressions before a skip counts as anything. */
const SKIP_PATIENCE = 3;

/** Foreground milliseconds that count as having read it. */
const READ_FULLY_MS = 45_000;
const READ_SOME_MS = 15_000;
/** Below this, the page was opened and abandoned. */
const BOUNCE_MS = 5_000;

export type EventSignal = {
  eventId: string;
  /** The reader's explicit vote, if they gave one. Overrides behaviour. */
  vote?: string | null;
  impressions?: number;
  openCount?: number;
  readMs?: number;
  reachedEnd?: boolean;
};

/**
 * How strongly one story argues for or against its topics.
 *
 * Returns 0 for a story we know nothing useful about, so it contributes nothing
 * rather than dragging a topic toward some default.
 */
export function signalStrength(signal: EventSignal): number {
  // An explicit vote is a statement. Believe it over any inference.
  if (signal.vote === "useful") return VOTE_USEFUL;
  if (signal.vote === "not_useful") return VOTE_NOT_USEFUL;
  if (signal.vote === "not_interested") return VOTE_NOT_INTERESTED;

  const opens = signal.openCount ?? 0;
  const readMs = signal.readMs ?? 0;

  if (opens === 0) {
    const impressions = signal.impressions ?? 0;
    return impressions >= SKIP_PATIENCE ? SKIPPED : 0;
  }

  if (signal.reachedEnd || readMs >= READ_FULLY_MS) return READ_FULLY;
  if (readMs >= READ_SOME_MS) return READ_SOME;
  // A recorded open with implausibly little time is a bounce, but only once we
  // actually have a duration — a missing one means the flush never arrived.
  if (readMs > 0 && readMs < BOUNCE_MS) return BOUNCED;
  return OPENED;
}

/* ---------------------------------------------------------------------- */
/* Weights                                                                */
/* ---------------------------------------------------------------------- */

/**
 * The weight a topic should have, given the net signal across every story
 * carrying it.
 *
 * A net of exactly zero returns `BASE_WEIGHT` unchanged, so a topic nobody has
 * engaged with behaves as it always did and `match.ts` sees no difference.
 */
export function weightForNet(net: number): number {
  const raw = BASE_WEIGHT + STEP * net;
  const clamped = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, raw));
  // `weight` is a Postgres `real`. Rounding keeps the stored value equal to the
  // one this returns, so a recompute that changes nothing writes nothing.
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Tallies signals per topic, then weights them.
 *
 * `topicsOf` maps an event to the topics the analysis pass attached to it. An
 * event carrying three topics moves all three: the reader engaged with the
 * story, and the story is about all of them.
 *
 * Topics with no signal at all are absent from the result rather than present at
 * base, so a caller can tell "nothing known" from "known to be average" — the
 * server uses that to decide what to reset.
 */
export function weightsFromSignals(
  signals: EventSignal[],
  topicsOf: Map<string, string[]>,
): Map<string, number> {
  const explicit = new Map<string, number>();
  const implicit = new Map<string, number>();

  for (const signal of signals) {
    const topics = topicsOf.get(signal.eventId);
    if (!topics || topics.length === 0) continue;

    const strength = signalStrength(signal);
    const bucket = isExplicit(signal.vote) ? explicit : implicit;
    for (const topicId of topics) {
      // Recorded even when zero, so a topic the reader has seen is known about
      // and lands on base rather than being treated as untouched.
      bucket.set(topicId, (bucket.get(topicId) ?? 0) + strength);
      if (!explicit.has(topicId)) explicit.set(topicId, explicit.get(topicId) ?? 0);
    }
  }

  const weights = new Map<string, number>();
  for (const topicId of explicit.keys()) {
    const inferred = clampImplicit(implicit.get(topicId) ?? 0);
    weights.set(topicId, weightForNet((explicit.get(topicId) ?? 0) + inferred));
  }
  return weights;
}

function isExplicit(vote: string | null | undefined): boolean {
  return vote === "useful" || vote === "not_useful" || vote === "not_interested";
}

/**
 * How far inference alone may move a topic.
 *
 * Without this, enough skips reach the floor and the product quietly stops
 * showing a subject the reader explicitly selected, on the strength of never
 * having clicked — which, per the note at the top of this file, is frequently
 * what a *good* briefing paragraph produces. Anything that final should require
 * the reader to say it.
 *
 * Four units is roughly a 0.4–1.6 band around base: enough for behaviour to
 * visibly reorder a briefing, never enough to silence a topic or to let one
 * dominate. Explicit votes are not capped and can still reach either extreme.
 */
const IMPLICIT_LIMIT = 4;

function clampImplicit(net: number): number {
  return Math.min(IMPLICIT_LIMIT, Math.max(-IMPLICIT_LIMIT, net));
}
