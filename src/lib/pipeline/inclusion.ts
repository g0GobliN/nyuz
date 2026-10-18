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
 * The contract (set by the quality arbiter, 2026-10-08)
 * ---------------------------------------------------------------------------
 *
 *   specific deterministic significance → useful provenance → nothing
 *
 * Every line states the strongest truthful thing this event's own stored
 * fields support, or the line is empty. An empty line is honest and every
 * template already renders around it; a generic one is filler, and the
 * arbiter scored filler as the defect that cost the briefing its top marks.
 *
 * ---------------------------------------------------------------------------
 * The ladder
 * ---------------------------------------------------------------------------
 *
 * Two bands, in order, then silence. Within a band, order is by how much the
 * rung says about *this* story, not by how easy it is to produce:
 *
 *   1. **The stored shared impact.** Written by analysis, already paid for, and
 *      genuinely about consequence. Nothing beats it and nothing here touches
 *      it — the rest of the ladder is only consulted when it is absent.
 *   2. **The change.** Before-state plus after-state as one sentence — "what
 *      changed" is a concrete development, and both halves are stored fields.
 *      Fires only when both are usable prose and differ from each other; the
 *      after-state-alone rung below covers a story whose before is missing.
 *   3. **The after state.** "What is true now that was not before" is the
 *      literal question `why_it_matters` asks, and analysis already extracted
 *      it into its own column. Source-derived, no inference.
 *   4. **The binding change** (2026-10-18): a sentence from the story's own
 *      stored evidence that says what a change requires or allows, and when it
 *      starts — the one shape a code-only product can print as significance
 *      without inferring it. See `bindingLine`.
 *
 *      The three **figure** rungs that sat here until 2026-10-18 are gone
 *      (arbiter ruling #10, option 2), removed after one of them printed as
 *      card 10 of the delivered 2026-10-18 briefing: "Why it matters · The
 *      story carries a $5,300 figure." under a card whose headline and summary
 *      already carried the $5,300. Its siblings restated a CVE ("The story
 *      names CVE-…") and a headcount ("The story involves 240 jobs.") the same
 *      way. The ruling was exact: a line that describes the article is not
 *      significance, and it is not repaired by a label ("$5,300 at stake") or
 *      by inferring a consequence from the number alone. The money rung that
 *      survives is `consequenceLine`, which requires the sentence to say what
 *      the money is doing; where no rung can say something substantive, the
 *      ladder ends in silence.
 *   5. **The coverage count.** How many independent outlets carried it.
 *      Multi-source only, because "one publisher" is the absence of a fact.
 *      This is the provenance band: weaker than a fact about the story, and
 *      stronger than silence, because the count varies story to story.
 *   6. **Nothing.** An empty string, which `digest_items.why_it_matters`
 *      already defaults to and every template already renders around — the
 *      email drops the whole line, the card falls back to the reader's own
 *      follow explanation under its own heading.
 *
 * A final gate blanks any rung whose normalized text equals the briefing
 * paragraph it would sit beside: a why-line that restates `what_happened`
 * verbatim (modulo case/punctuation/whitespace) fails the rubric even when
 * the rung above produced it honestly.
 *
 * ---------------------------------------------------------------------------
 * What is no longer here, and why
 * ---------------------------------------------------------------------------
 *
 * Two rungs were deleted on 2026-10-08, after the arbiter's ruling on the
 * deterministic contract:
 *
 *   - the **subject** line — `events.tags` restated as "This is a funding
 *     story from The Register." The ruling: it *"prefers nothing over exposing
 *     'This is a cybersecurity story from The Register.' as though that were
 *     genuinely answering 'why it matters'"*, and a generic sentence whose only
 *     purpose is to fill the visual slot is *"preferably absent"*.
 *   - the **follow** line — "You follow AI." Reader-generic, the same sentence
 *     under every card in a topic, and on 2026-10-01 it was every card's line.
 *     The reader's own follow graph is still rendered — under the honest
 *     heading "Why you're seeing this", by `personalizationFor` on the server
 *     and `becauseYouFollow` on the client — which is where the arbiter put
 *     provenance: the metadata band, not this slot.
 *
 * The inputs went with them. `events.tags`, the reader's topic labels and the
 * single outlet are no longer read: every remaining rung states a fact about
 * the story, which is what makes the line differ per card rather than per
 * template. That also removes two per-card queries from the read path.
 *
 * ---------------------------------------------------------------------------
 * Why rung 5 survived the purge
 * ---------------------------------------------------------------------------
 *
 * The count is a fact about the coverage that varies story to story — three
 * publishers is a different claim from five — so it differentiates the
 * briefing rather than repeating across it. On 2026-09-30 the single-source
 * version of this line did repeat ("So far only X has reported this", twenty-
 * five times), and the outlet it named was already on screen. Single-source
 * stories therefore fall through it to silence, and the line is never tied to
 * the reader's topics, which is the slot-fill the arbiter rejected.
 *
 * ---------------------------------------------------------------------------
 * Why it has to be a sentence
 * ---------------------------------------------------------------------------
 *
 * The email prints `Why it matters: ${why}` (email/templates.ts:392) and drops
 * the whole block when `why` is empty — never filling the significance slot
 * with provenance, which prints under its own heading (arbiter, 2026-10-09).
 * A metadata chip — "5 sources · Cybersecurity" — would be correct and read
 * like a bug in that position. So every rung is written as prose, and anything
 * that cannot be said as a sentence is left to the final rung rather than
 * forced.
 *
 * Never invents consequence. Rungs 2–5 state only developments, counts and
 * numbers that the event's own stored fields contain.
 */

import { rankEntities, readerSentences } from "@/lib/reader-evidence";

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
  /**
   * The story's own stored article evidence (0090) — the short facts the
   * enrichment stage extracted from the articles' own pages. The callers pass
   * it as the composer's own source list, unfiltered; the why-vs-what gate at
   * the bottom of the ladder is what stops a line restating the paragraph it
   * sits beside. Never generated here.
   */
  evidence?: readonly string[] | undefined;
  /** `events.before_state` — feeds the change rung together with afterState. */
  beforeState?: string | null;
  afterState?: string | null;
  /** Independent outlets on the event. */
  sourceCount: number;
  /** `events.title` — the story's own names come from it (see `storyNames`). */
  title?: string | null;
  /** `events.what_happened`, the shared briefing paragraph. */
  whatHappened?: string | null;
};

export type InclusionReason = {
  text: string;
  /** Which rung produced it, for the pipeline report and for tests. */
  source: "stored" | "change" | "after-state" | "consequence" | "binding" | "coverage" | "none";
};

/**
 * Normalized comparison for the why-vs-what gate: case, punctuation and
 * whitespace collapse, so trivial restatements fail exactly like verbatim
 * copies. Semantic restatement is out of scope — the gate catches copies,
 * manual sampling catches the rest.
 */ export function normalizeForCompare(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Rung 2 — the before/after pair as one development.
 *
 * Both halves must be usable prose on their own (via `sentence`) and must
 * differ from each other once normalized — a before that merely repeats the
 * after is one fact, and the after-state rung below already says it.
 */ function changeLine(
  before: string | null | undefined,
  after: string | null | undefined,
): string | null {
  const was = sentence(before);
  const now = sentence(after);
  if (!was || !now) return null;
  if (normalizeForCompare(was) === normalizeForCompare(now)) return null;
  const strip = (text: string): string => text.replace(/[.?!]+$/u, "");
  const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
  return `Was ${lowerFirst(strip(was))}; now ${lowerFirst(strip(now))}.`;
}

// ---------------------------------------------------------------------------
// Rung 4a — a money consequence the story's own text states
// ---------------------------------------------------------------------------

/**
 * Money with its currency sign intact — `extract.ts` strips the symbol into a
 * bare `2.4 billion`, and a clause about "2.4 billion" with no currency is not
 * the story's own claim. No `g` flag: `exec` on a shared regex would otherwise
 * carry `lastIndex` between cards.
 */
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|bn|mn|[kmb]\b)?/iu;

/**
 * What the money is doing, when the story's outcome turns on it.
 *
 * This rung reads the article's own stored evidence (0090) for money attached to
 * a consequence —
 * damages, a fine, a settlement, an award, restitution, a forfeited amount — the
 * shape a briefing can carry from the body when the headline names no number.
 *
 * Narrow on purpose. Measured on the 2026-10-09 pool with a looser rule (any
 * sentence with a date, an amount or an outcome verb) the yield was 21 of 60
 * events at roughly a third precision: it printed tournament heritage, collected-
 * quotation metadata, speculation and vendor truisms. Restricted to money the
 * story's outcome turns on, two of sixty events qualify and both are defensible.
 * Two lines is the honest price of not printing eighteen misleading ones.
 */
const CONSEQUENCE =
  /\b(damages|fines?|fined|penalt(?:y|ies)|restitution|settlements?|settled|awards?|awarded|judgment|judgement|forfeit(?:ed|ure)?|refund(?:ed)?|liable|payout)\b/i;

/** A clause that opens on a connective is a fragment the split created. */
const FRAGMENT =
  /^(?:and|but|or|which|that|while|although|though|because|so|then|also|still|however|whereas)\b/i;

/**
 * The clause the money sits in, cut from the sentence around it.
 *
 * Every word stays the article's: the text is sliced at the nearest comma,
 * semicolon, colon or dash on each side of the match, so nothing is paraphrased
 * and nothing is added but the full stop. A clause left too short to be a
 * statement, or one that starts mid-thought, is refused — silence beats a
 * fragment under a heading that promises a reason.
 */
function consequenceClause(text: string): string | null {
  const money = MONEY.exec(text);
  if (!money) return null;
  const index = money.index;
  const before = text.slice(0, index);
  const after = text.slice(index + money[0].length);
  // Sentence terminators are breaks too, on both sides: a clause must not run
  // into the next sentence ("Damages of $250 million. The filing was made ..."
  // is two statements) and must not be inherited from the one before it.
  const breaks = [",", ";", ":", ".", "!", "?", "\u2014", " \u2013 "];
  const start = Math.max(...breaks.map((mark) => before.lastIndexOf(mark))) + 1;
  const stops = breaks.map((mark) => after.indexOf(mark)).filter((stop) => stop >= 0);
  const end = stops.length === 0 ? text.length : index + money[0].length + Math.min(...stops);
  const clause = sentence(text.slice(start, end));
  if (clause === null) return null;
  if (clause.split(/\s+/u).length < 5) return null;
  if (FRAGMENT.test(clause)) return null;
  if (!CONSEQUENCE.test(clause)) return null;
  // The split can leave the clause opening on a lowercase word; the card prints
  // a sentence, so raise the first letter. Nothing else about it is rewritten.
  return clause.charAt(0) === clause.charAt(0).toLowerCase()
    ? `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`
    : clause;
}

/**
 * The first stored-evidence clause that states a money consequence.
 *
 * Exported so a read-only instrument can count how much of a reader's pool this
 * rung could fire over without re-implementing the predicate — the failure mode
 * that made three instruments report a pre-Q4 shipping set (2026-10-17).
 */
export function consequenceLine(evidence: readonly string[] | undefined): string | null {
  for (const unit of evidence ?? []) {
    const clause = consequenceClause(unit);
    if (clause !== null) return clause;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The binding change — what a rule now requires, and when it starts
// ---------------------------------------------------------------------------

/**
 * The one shape the stored evidence can prove that answers "why does this
 * matter" without inventing anything: a sentence that says what changed for a
 * party, and — where the story says so — when it starts.
 *
 * Measured 2026-10-18 on the live corpus (3,570 enriched article-evidence rows,
 * `npm run audit:binding`), against three shapes that were rejected:
 *
 * | shape | hits | defensible |
 * | --- | --- | --- |
 * | any change-of-state verb, entity-guarded (the 2026-10-17 attempt) | 432 | ~1 in 5 |
 * | an effective date alone | 39 | ~3 in 5 |
 * | this: an effective start **and** a verb that changes what a party may do, or the story's own instrument imposing a duty | 5 | **5 of 5** |
 *
 * The discarded hits are the reason for the guards: a change verb inside a
 * relative clause defines a class ("care plans, which mandate support for
 * conditions such as …"), a dated reporting frame is when the story was *told*
 * ("Ivanti said on October 13 …"), a launch date is availability
 * ("will launch on October 13th starting at $349"), and a spec sheet, a review
 * score and a newsletter's own furniture are not significance at all. Precision
 * is the whole point of this rung: the arbiter's rule is that a generic or
 * misleading line is worse than silence, and every widening measured worse than
 * this one.
 */
const BINDING_START =
  /\b(?:takes? effect|took effect|go(?:es)? into effect|went into effect|kick(?:s|ed|ing) in|effective (?:on|from|as of)|starting (?:on|from)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|\d{1,2}(?:st|nd|rd|th)))/i;
/**
 * What the change does to a party: requires, forbids, limits, allows.
 *
 * The apostrophe is matched in both forms — the live Meta sentence that this
 * rung exists for writes its refusal as “won’t allow”, and a straight `'` in the
 * rule silently missed it.
 */
const BINDING_CHANGE =
  /\b(?:requir(?:es|e|ed)|mandates?|mandatory|prohibits?|bans?|banned|bars?|blocks?|restricts?|restricted|limits?|limited|no longer|must|will have to|won[’']t allow|will not allow|not allowed|can use|may use|allowed to|permitted to|will be able to|applies to)\b/i;
/** A change inside a relative clause defines a class; it binds nobody. */
const BINDING_RELATIVE =
  /\b(?:which|that)\s+(?:mandate|requires?|limit|limits|ban|bans|restricts?|prohibits?)\b/i;
/**
 * An authority's own instrument — the subject that can impose a duty.
 *
 * "order" and "terms" were in the first draft and are gone: they matched "in
 * order to …" (the leap-second card) and "these terms" in a sentence with no
 * duty in it at all. "act" survives only capitalised, because "the EU AI Act"
 * is an instrument and "act on it" is a verb.
 */
const INSTRUMENT =
  /\b(?:directions?|rules?|regulation[s]?|guidelines?|law|advisory|requirements?|mandates?)\b/i;
const CAPITALISED_ACT = /\bAct\b/;
const IMPOSES = /\b(?:require[sd]?|mandates?|obliges?|must|will have to)\b/i;
const QUESTION_SHAPE = /\?\s*$/u;
const OPENS_ON_QUOTE = /^["\u201c]/u;
const FIRST_PERSON = /\b(?:I|we|our|my|us)\b/iu;
const SOURCE_FURNITURE =
  /\b(?:AD:|photograph|image:|credit:|newsletter|subscribe|sign up|%\s*off|offer|promo|discount|preorder|available for preorder|shipping)\b/iu;
/**
 * History reads like a change and is not one: "halted production in 2011", "has
 * passed several gun safety measures in recent years". Both were live hits this
 * rung would otherwise have printed.
 */
const RETROSPECTIVE =
  /\b(?:ago\b|last year|previously|recently|in recent\s+(?:years|months|weeks)|in (?:19|20)\d{2}\b|since (?:19|20)\d{2}\b|this day)\b/i;
/** A date in a reporting frame is when the story was told, not when it binds. */
const REPORTING_FRAME =
  /\b(?:said|says|told|reported|reports|announced|confirmed|revealed|noted)\s+on\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/iu;
const LAUNCH_TALK =
  /\b(?:will launch|launch(?:es|ed)? on|available (?:on|from)|goes on sale|releases? on)\b/i;
const CLAUSE_OPENER =
  /^(?:and|but|or|which|that|while|although|though|because|so|then|also|still|however|whereas)\b/i;

/** Whether a candidate sentence is the story's own statement at all. */
function standsAlone(text: string): boolean {
  return (
    !QUESTION_SHAPE.test(text) &&
    !OPENS_ON_QUOTE.test(text) &&
    !CLAUSE_OPENER.test(text) &&
    !FIRST_PERSON.test(text) &&
    !SOURCE_FURNITURE.test(text) &&
    !RETROSPECTIVE.test(text) &&
    !REPORTING_FRAME.test(text) &&
    !LAUNCH_TALK.test(text)
  );
}

/**
 * The first stored-evidence sentence that binds a party, or null.
 *
 * Two shapes, both the story's own words:
 *
 * - **the effective change** — when it starts and what it does ("The ban, which
 *   went into effect on Thursday, restricts ads and paid marketing messages from
 *   ByteDance …", "Starting on October 9th, anyone using Google Gemini on a free
 *   plan will be limited to the Flash Lite model.");
 * - **the story's own instrument** — the subject the event is about imposing a
 *   duty ("CERT-In's directions also require organizations to report cyber
 *   incidents to the agency within 6 hours.").
 *
 * Exported so a read-only instrument counts the same predicate the ladder runs,
 * which is the failure mode that made three earlier censuses disagree with
 * production.
 */
export function bindingLine(input: {
  evidence: readonly string[] | undefined;
  /** The event's own top-ranked names, from `rankEntities`. */
  names: readonly string[];
}): string | null {
  for (const unit of input.evidence ?? []) {
    for (const part of readerSentences(unit)) {
      const text = sentence(part);
      if (text === null || !standsAlone(text)) continue;
      if (BINDING_START.test(text) && BINDING_CHANGE.test(text) && !BINDING_RELATIVE.test(text))
        return text;
      // The relative-clause guard applies to both shapes: a duty inside one
      // describes a class of thing ("care plans, which mandate support for …"),
      // which is a definition rather than a change.
      if (BINDING_RELATIVE.test(text)) continue;
      const binds = input.names.some(
        (name) =>
          name.trim() !== "" &&
          (text.startsWith(name) || text.startsWith(`${name}'s `)) &&
          (INSTRUMENT.test(text) || CAPITALISED_ACT.test(text)) &&
          IMPOSES.test(text),
      );
      if (binds) return text;
    }
  }
  return null;
}

/**
 * The event's own top-ranked names, from the inputs the ladder already has.
 *
 * `rankEntities` is the composer's own ranker, so the ladder cannot disagree with
 * the article about who the story is about — and no caller has to pass a new
 * field for the one rung that reads them. Rebuilt per call rather than cached:
 * the ladder runs once per story at generation and once per card on the read
 * path, and a cache keyed on a few sentences would cost more than it saves.
 */
function storyNames(input: InclusionInput): string[] {
  const paragraph = (input.whatHappened ?? "").trim();
  return rankEntities(input.title ?? "", [
    {
      name: "",
      ...(paragraph === "" ? {} : { excerpt: paragraph }),
      enrichedEvidence: (input.evidence ?? []).map((text) => ({ kind: "unit", text })),
    },
  ])
    .filter((entity) => entity.role !== "REPORTING_SOURCE")
    .slice(0, 3)
    .map((entity) => entity.name)
    .filter((name) => name.trim() !== "");
}

/**
 * Whether the ladder produced anything to print — **not** whether the item ships.
 *
 * History, because the name is older than the rule it now serves. From 2026-10-12
 * to 2026-10-17 this was the Q4 shipping gate: an item whose ladder was silent
 * did not ship. On 2026-10-17 the owner ruled nyuz is not an AI product ("it
 * should be pure code"), and the ladder's three strongest rungs are written by
 * the `analyse` pass, so under the code-first policy they are permanently empty
 * — measured that day, 0 of the reader's 1,000 matches had a stored impact and 0
 * had an after-state. Gating silence therefore gated ~97% of the pool, which is
 * what took the reader's briefing 25 → 1 → 0. Rung 6 ("an empty string, which
 * `digest_items.why_it_matters` already defaults to and every template already
 * renders around") is the honest shipping state again, and the count of silent
 * cards is recorded in the digest note instead.
 *
 * So callers must not use this to withhold. It answers "is there a line?" for
 * reporting: the digest note, the preview's "of which carry a why-line", and the
 * checkpoint's rung census. It takes the ladder's text, not the input, because
 * the build already has the text from the `reasonFor` call it makes for
 * `why_it_matters` and must not pay for a second one.
 */
export function hasStorySpecificLine(text: string | null | undefined): boolean {
  return (text ?? "").trim() !== "";
}

export function reasonFor(input: InclusionInput): InclusionReason {
  const candidates: InclusionReason[] = [];

  const stored = sentence(input.storedImpact);
  if (stored) candidates.push({ text: stored, source: "stored" });

  const change = changeLine(input.beforeState, input.afterState);
  if (change !== null) candidates.push({ text: change, source: "change" });

  const after = sentence(input.afterState);
  if (after) candidates.push({ text: after, source: "after-state" });

  // A consequence: "asks for damages of more than $250 million" says what is at
  // stake, which is the only way a number earns this slot.
  const consequence = consequenceLine(input.evidence);
  if (consequence !== null) candidates.push({ text: consequence, source: "consequence" });

  // The binding change: a stored sentence that says what a rule now requires or
  // allows, and when it starts. Below a money consequence, because damages name
  // what the story costs where a duty names what it changes.
  const binding = bindingLine({ evidence: input.evidence, names: storyNames(input) });
  if (binding !== null) candidates.push({ text: binding, source: "binding" });

  // The provenance band. Multi-source only: "One publisher reported this" is
  // the absence of a fact, and the outlet count already sits on the card.
  if (input.sourceCount >= 2) {
    candidates.push({
      text: `${count(input.sourceCount)} publishers reported this.`,
      source: "coverage",
    });
  }

  // The why-vs-what gate: a line that restates the briefing paragraph it
  // sits beside fails the rubric even when its rung produced it honestly.
  // Normalized (not semantic) — exact and trivial copies fail here, deeper
  // restatement is for manual sampling.
  const normalizedWhat = normalizeForCompare(input.whatHappened);
  for (const candidate of candidates) {
    if (normalizedWhat === "") return candidate;
    if (normalizeForCompare(candidate.text) === normalizedWhat) continue;
    return candidate;
  }

  // Nothing story-specific to say. An empty line is honest and the templates
  // render around it; a generic one would fail the rubric's filler gate.
  return { text: "", source: "none" };
}
