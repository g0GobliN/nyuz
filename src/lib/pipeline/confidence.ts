/**
 * Deterministic cluster confidence — cluster v2's shadow signal (docs/track.md phase 7).
 *
 * `cluster.ts` asks a model, over the shortlist, "which of these is the same event?"
 * on every article that gets a shortlist at all. Plan2 §25 asks whether some of those
 * calls are decidable for free: a headline overwhelmingly similar to exactly one
 * candidate is very likely the same story: one that shares no distinctive words with
 * any candidate is very likely a different one.
 *
 * This module only ever answers that question for comparison, never for a real
 * decision — see the shadow wiring in `cluster.ts`. Getting a merge wrong here would
 * cost nothing, because nothing acts on it yet; getting one wrong once this stops
 * being a shadow would misinform every reader who receives the wrongly-merged event,
 * which is why the thresholds below are deliberately conservative and `titleTokens`
 * — already tuned against the real corpus for the shortlist itself — is reused
 * rather than re-derived.
 */

import { titleTokens } from "./shortlist";

export type ConfidenceVerdict = "same" | "different" | "ambiguous";

/**
 * Overlap required to call two headlines confidently the same event, as a share of
 * the union of their distinctive tokens (Jaccard similarity).
 *
 * `titleTokens` returns at most three words per headline, so this is coarse by
 * construction: two of three shared is `same`, one of three or fewer is not. That
 * coarseness is deliberate — three tokens is thin evidence, and the bar for "skip
 * the model" has to be higher than the bar for "worth showing the model at all",
 * which is what the shortlist itself already applies.
 */
const SAME_THRESHOLD = 0.66;

/** Titles with fewer distinctive tokens than this are never called `same` or
 * `different` — too little to be confident either way. */
const MIN_TOKENS = 2;

function overlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const shared = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : shared / union;
}

/**
 * One headline against one candidate. Exported for testing; `verdictFor` below is
 * what `cluster.ts` actually calls.
 */
export function pairVerdict(titleA: string, titleB: string): ConfidenceVerdict {
  const tokensA = titleTokens(titleA);
  const tokensB = titleTokens(titleB);
  if (tokensA.length < MIN_TOKENS || tokensB.length < MIN_TOKENS) return "ambiguous";

  const score = overlap(tokensA, tokensB);
  if (score >= SAME_THRESHOLD) return "same";
  if (score === 0) return "different";
  return "ambiguous";
}

export type Verdict = {
  verdict: ConfidenceVerdict;
  /** The candidate id a confident `same` verdict points at. Null otherwise. */
  matchedId: string | null;
};

/**
 * The whole-shortlist verdict a deterministic-only decision would reach.
 *
 * `same` only when exactly one candidate is a confident match and every other
 * candidate is confidently different — an article that is a confident match against
 * two different candidates is not decidable without the model, because attaching to
 * the wrong one of two plausible events is exactly the failure this stage cannot
 * afford. `different` only when every candidate is confidently different from this
 * headline. Anything else — including an empty shortlist, which this function is not
 * called on — is `ambiguous`, which is `cluster.ts`'s existing behaviour: ask the
 * model.
 */
export function verdictFor(
  articleTitle: string,
  candidates: { id: string; title: string }[],
): Verdict {
  // Nothing to compare against is not evidence of difference — it is no evidence
  // at all. `cluster.ts` never reaches this with an empty shortlist in practice
  // (that path is decided before the shadow check runs), but the function should
  // not claim "different" from a vacuous truth if it ever is.
  if (candidates.length === 0) return { verdict: "ambiguous", matchedId: null };

  const pairs = candidates.map((c) => ({ id: c.id, verdict: pairVerdict(articleTitle, c.title) }));

  if (pairs.some((p) => p.verdict === "ambiguous"))
    return { verdict: "ambiguous", matchedId: null };

  const same = pairs.filter((p) => p.verdict === "same");
  if (same.length === 1 && same[0]) return { verdict: "same", matchedId: same[0].id };
  if (same.length === 0) return { verdict: "different", matchedId: null };

  // More than one confident match. Two candidates cannot both be "the same event"
  // as this article without also being the same event as each other, which the
  // shortlist does not establish — deferring to the model is the only safe answer.
  return { verdict: "ambiguous", matchedId: null };
}
