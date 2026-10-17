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
 *   4. **The figure.** A number the story itself names — money at stake, a CVE,
 *      a headcount — restated as a sentence. Regex over the event's own
 *      headline and briefing paragraph: if the text does not contain it, the
 *      rung cannot claim it. Money is claimed only when the same sentence says
 *      what the money is doing (see `MONEY_AT_STAKE`): a price tag is not
 *      significance, and the arbiter ruled it out on 2026-10-08.
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
  /** `events.title` — the figure rung searches it before the paragraph. */
  title?: string | null;
  /** `events.what_happened`, the shared briefing paragraph. */
  whatHappened?: string | null;
};

export type InclusionReason = {
  text: string;
  /** Which rung produced it, for the pipeline report and for tests. */
  source: "stored" | "change" | "after-state" | "consequence" | "figure" | "coverage" | "none";
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
// Rung 4 — a figure the story itself names
// ---------------------------------------------------------------------------

/**
 * Money with its currency sign intact — `extract.ts` strips the symbol into a
 * bare `2.4 billion`, and "The story carries a 2.4 billion figure." would be
 * nonsense without it. No `g` flag: `exec` on a shared regex would otherwise
 * carry `lastIndex` between cards.
 */
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|bn|mn|[kmb]\b)?/iu;
/**
 * What the money is doing, in the sentence that names it.
 *
 * The 2026-10-08 ruling: a product price is not significance, so the rung
 * claims money only when the same sentence says what the money is — a raise, a
 * valuation, a deal, a fine, a settlement, damages, an award, capital spent or
 * earned. Measured against the live pool that day: "nabs $60M" (Sequoia), "$500M
 * valuation", and "$4.5 billion in revenue" survive; "laptops cost up to
 * $7,000", "starting at $2,599" and "$65 off" fall through to silence, which
 * the arbiter prefers to a price dressed as a reason.
 *
 * Scoped to one sentence on purpose, so a raise mentioned elsewhere in the
 * paragraph cannot make a price tag claimable — and a sentence that names no
 * purpose at all ("a $50 million contract" does, "it was $50 million" does not)
 * stays silent rather than guessing.
 */
// Two verbs are deliberately not here, because the live sentences that prompted
// the ruling contain them as something else: "secure" is the imperative in a
// shop's own pitch ("secure the Surface Laptop Ultra ... starting at $2,599")
// where "secures"/"secured" is the funding verb, and bare "buy" is the retailer
// in "Best Buy has a limited lineup ... for $2,599" where "buys"/"bought" is
// the acquisition verb.
const MONEY_AT_STAKE =
  /\b(?:raise[sd]?|raising|funding|round|seed|series\s[a-e]\b|valuation|valued|nabs?|lands?|secures|secured|closes|closed|scores?|pays|paid|payout|backed|invest(?:s|ed|ment)|buys|bought|acquires?|acquired|acquisition|merger|merges?|deal|contract|award(?:ed)?|fine[sd]?|penalt(?:y|ies)|settles?|settled|settlement|damages|lawsuit|subsidy|revenue|profit|loss(?:es)?|spending|budget|worth)\b/i;
const CVE = /\bCVE-\d{4}-\d{4,7}\b/iu;
/**
 * The noun must sit directly after the number, optionally with a magnitude:
 * "50 million users" is claimed in full (never shrunk to "50 users"), while
 * "50 very contented users" is not a count at all. Source-and-article nouns
 * are excluded — they count the coverage, not the story.
 */
const COUNT =
  /\b(\d[\d,.]*(?:\s*(?:thousand|million|billion))?)\s+(jobs|positions|employees|workers|users|customers|members|subscribers|readers|downloads)\b/iu;

// ---------------------------------------------------------------------------
// Rung 4a — a money consequence the story's own text states
// ---------------------------------------------------------------------------

/**
 * What the money is doing, when the story's outcome turns on it.
 *
 * The figure rung reads the *headline* for money with a purpose. This one reads
 * the article's own stored evidence (0090) for money attached to a consequence —
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

/** The sentence the match sits in, terminators included. */
function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const after = text.slice(index + length);
  const start =
    Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?")) + 1;
  const stops = [after.indexOf("."), after.indexOf("!"), after.indexOf("?")].filter(
    (stop) => stop >= 0,
  );
  const end = stops.length === 0 ? text.length : index + length + Math.min(...stops) + 1;
  return text.slice(start, end);
}

function moneyFigure(text: string): string | null {
  const match = MONEY.exec(text);
  if (!match) return null;
  const raw = match[0].replace(/\s+/gu, " ").trim();
  const hasUnit = /[a-z]/iu.test(raw.replace(/[$€£\d\s.,]/gu, ""));
  if (!hasUnit) {
    // "$13" with no unit is almost always a per-share price, and a bare
    // two-digit amount makes a nonsense figure. Only a bare amount that is
    // plausibly an amount on its own is printed. Commas go before the rest of
    // the non-digits or "$1,200" reads as the number 1.2.
    const bare = Number(raw.replace(/,/gu, "").replace(/[^\d.]/gu, ""));
    if (!Number.isFinite(bare) || bare < 1000) return null;
  }
  // Money at stake only. The sentence has to say what the money is doing; a
  // figure with no purpose in its own sentence is a price or a trivia, and
  // silence is the better answer for both.
  if (!MONEY_AT_STAKE.test(sentenceAround(text, match.index, match[0].length))) return null;
  return raw;
}

/** The headline first, then the briefing paragraph — lead facts lead. */
function figureLine(
  title: string | null | undefined,
  what: string | null | undefined,
): string | null {
  for (const text of [title ?? "", what ?? ""]) {
    if (text.trim() === "") continue;
    const money = moneyFigure(text);
    if (money !== null) return `The story carries a ${money} figure.`;
    const cve = CVE.exec(text)?.[0];
    if (cve !== undefined) return `The story names ${cve}.`;
    const counted = COUNT.exec(text);
    if (counted?.[1] !== undefined && counted[2] !== undefined) {
      return `The story involves ${counted[1]} ${counted[2]}.`;
    }
  }
  return null;
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

  // A consequence outranks a bare figure: "asks for damages of more than $250
  // million" says what is at stake, where "carries a $250 million figure" says
  // only that a number exists.
  const consequence = consequenceLine(input.evidence);
  if (consequence !== null) candidates.push({ text: consequence, source: "consequence" });

  const figure = figureLine(input.title, input.whatHappened);
  if (figure !== null) candidates.push({ text: figure, source: "figure" });

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
