/**
 * The "why it matters" line, without a model.
 *
 * ---------------------------------------------------------------------------
 * What this replaces
 * ---------------------------------------------------------------------------
 *
 * `digest.ts` used to call a model during briefing assembly to write
 * `digest_items.why_it_matters` for any event that did not already have one.
 * That was the last automatic AI call in the briefing path, and it fired
 * *because the daily job ran* — the exact shape of spend this redesign exists to
 * remove.
 *
 * It was never the main source of that text, which is why removing it costs so
 * little. `analyse.ts` already writes `event_impacts` from the `impact` field of
 * the analysis it was doing anyway (analyse.ts:1996), so the overwhelming
 * majority of events arrive at the briefing with a shared explanation already
 * paid for. The digest call was a backfill for the remainder — 7 calls and
 * $0.06 in the eleven days to 2026-09-12.
 *
 * ---------------------------------------------------------------------------
 * The ladder
 * ---------------------------------------------------------------------------
 *
 * Ordered by how much it tells the reader, not by how easy it is to produce:
 *
 *   1. **The stored shared impact.** Written by analysis, already paid for, and
 *      genuinely about consequence. Nothing beats it and nothing here touches
 *      it — `reasonFor` is only consulted when it is absent.
 *   2. **The after state.** "What is true now that was not before" is the
 *      literal question `why_it_matters` asks, and analysis already extracted
 *      it into its own column. Source-derived, no inference.
 *   3. **A coverage sentence.** How many independent outlets carried it and
 *      which of the reader's interests it landed in. Weaker, but true, and it
 *      answers "why am I seeing this" even when it cannot answer "why does it
 *      matter".
 *   4. **Nothing.** An empty string, which `digest_items.why_it_matters`
 *      already defaults to and every template already renders around.
 *
 * ---------------------------------------------------------------------------
 * Why rung 3 has to name the story
 * ---------------------------------------------------------------------------
 *
 * Rung 3 is only worth printing when it says something about *this* story. The
 * reader's topic labels do not: they are the same for every story that landed
 * in that topic, so a line built from them alone is one sentence repeated under
 * unrelated cards — which is what a briefing of twenty-five stories looked
 * like, and it reads as a bug because it is one. "You follow AI" in front of
 * two different stories is the reader's own selection, not a reason to read
 * either of them.
 *
 * So the count and the topics are the *shape* of rung 3, and the outlet name is
 * what makes it a sentence about the story. With exactly one outlet and a name
 * for it, the line says who has it. With one outlet and no name, there is
 * nothing story-shaped to say and the story is published without a line at all
 * — rung 4 — because an empty line is honest and a repeated one is not.
 *
 * ---------------------------------------------------------------------------
 * Why it has to be a sentence
 * ---------------------------------------------------------------------------
 *
 * The email prints `Why it matters: ${why}` (email/templates.ts:392). A
 * metadata chip — "5 sources · Cybersecurity" — would be correct and read like
 * a bug in that position. So rung 3 is written as prose, and anything that
 * cannot be said as a sentence is left to rung 4 rather than forced.
 *
 * Never invents consequence. Rung 3 states only counts and labels that are
 * facts about the coverage; it does not tell the reader what to conclude.
 */

const NUMBER_WORDS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];

/** Spelled out to ten, as the email copy elsewhere does; numerals past that. */
function count(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

function listOf(labels: string[]): string {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Trimmed, and rejected outright if it is not usable prose. */
function sentence(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length < 20) return null;
  // A fragment that is really a label, not a statement, reads badly after
  // "Why it matters:" and is better dropped than dressed up.
  if (!/[a-z]/u.test(text)) return null;
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

export type InclusionInput = {
  /** `event_impacts.text`, when analysis already produced one. */
  storedImpact?: string | null;
  afterState?: string | null;
  /** Independent outlets on the event. */
  sourceCount: number;
  /** The reader's topic labels this event matched. */
  topics: string[];
  /**
   * The outlet that carried it, when exactly one did and its name is known.
   *
   * Only the single-source line uses it, and it is the difference between a
   * reason and a repetition: see the header. Pass null rather than guessing —
   * a wrong name is worse than no line.
   */
  outlet?: string | null;
};

export type InclusionReason = {
  text: string;
  /** Which rung produced it, for the pipeline report and for tests. */
  source: "stored" | "after-state" | "coverage" | "none";
};

export function reasonFor(input: InclusionInput): InclusionReason {
  const stored = sentence(input.storedImpact);
  if (stored) return { text: stored, source: "stored" };

  const after = sentence(input.afterState);
  if (after) return { text: after, source: "after-state" };

  const topics = input.topics.filter((label) => label.trim().length > 0).slice(0, 3);
  if (input.sourceCount >= 2) {
    const outlets = `${count(input.sourceCount)} publisher${input.sourceCount === 1 ? "" : "s"} reported this`;
    return {
      text: topics.length > 0 ? `${outlets}, in ${listOf(topics)}.` : `${outlets}.`,
      source: "coverage",
    };
  }

  // One source and nothing else to say. "One outlet reported this" is not a
  // reason to read something, so the line has to earn its place by naming the
  // outlet. It used to name the topics instead, which produced the identical
  // sentence under every single-source story sharing those topics — the one
  // thing a line about *this* story cannot be.
  if (input.sourceCount === 1) {
    const outlet = (input.outlet ?? "").replace(/\s+/gu, " ").trim();
    if (outlet === "") return { text: "", source: "none" };
    const has = `So far only ${outlet} has reported this`;
    return {
      text: topics.length > 0 ? `${has}, in ${listOf(topics)}.` : `${has}.`,
      source: "coverage",
    };
  }

  return { text: "", source: "none" };
}
