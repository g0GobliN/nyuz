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
 *      which of the reader's interests it landed in. True, and it answers
 *      "why am I seeing this" even when it cannot answer "why does it matter".
 *      Multi-source only — see below.
 *   4. **The figure.** A number the story itself names — a money amount, a
 *      CVE, a headcount — restated as a sentence. Regex over the event's own
 *      headline and briefing paragraph: if the text does not contain it, the
 *      rung cannot claim it.
 *   5. **The subject.** `events.tags` (0049) says what concrete kind of thing
 *      happened — an acquisition, a layoff, a fine — up to two kinds, tied to
 *      the reader's own followed topics when they overlap, so "An acquisition
 *      story in your AI topic." is per-story *and* per-reader. The single
 *      outlet joins as an attribution slot where kind and topics coincide;
 *      it is a qualifier in the sentence, never the sentence itself.
 *   6. **The follow graph.** "You follow X." — honest, but the least
 *      story-specific thing that can be said, which is why it now sits last
 *      instead of being every card's line. Consumers pass `followed` and get
 *      the whole ladder from one call; without it, this rung is skipped.
 *   7. **Nothing.** An empty string, which `digest_items.why_it_matters`
 *      already defaults to and every template already renders around.
 *
 * ---------------------------------------------------------------------------
 * Why rungs 4 and 5 exist
 * ---------------------------------------------------------------------------
 *
 * On 2026-10-01 all twenty-five single-source cards without a stored impact
 * read "You follow X." — one sentence repeated under unrelated stories,
 * differentiated only by its topic list. Story-specific beats reader-generic:
 * a figure or a subject varies with the story, so the briefing reads like twenty-
 * five reasons rather than one reason twenty-five times. Both rungs state only
 * what the event's own stored fields contain — a regex match or a tag row —
 * so neither can invent consequence. When neither is available the ladder still
 * falls all the way to rung 7 rather than repeating itself, because an empty
 * line is honest and a repeated one is not.
 *
 * ---------------------------------------------------------------------------
 * Why rung 3 stays silent on single-source stories
 * ---------------------------------------------------------------------------
 *
 * Rung 3 is only worth printing when it says something about *this* story.
 * The multi-source count does: "Three publishers reported this" is a fact
 * about the coverage that varies story to story. The single-source line did
 * not, even after it named the outlet — on 2026-09-30 all twenty-five lines
 * read "So far only X has reported this, in ...", differentiated without
 * being different. The outlet is already on screen (card header, source
 * count, source rail), so the sentence added repetition, not information.
 * Single-source stories fall through to the story-specific rungs instead.
 *
 * ---------------------------------------------------------------------------
 * Why it has to be a sentence
 * ---------------------------------------------------------------------------
 *
 * The email prints `Why it matters: ${why}` (email/templates.ts:392). A
 * metadata chip — "5 sources · Cybersecurity" — would be correct and read like
 * a bug in that position. So every rung is written as prose, and anything that
 * cannot be said as a sentence is left to the final rung rather than forced.
 *
 * Never invents consequence. Rungs 3–5 state only counts, labels and numbers
 * that are facts about the coverage; none of them tells the reader what to
 * conclude.
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
   * The subject rung uses it as an attribution slot — `A funding story from
   * X, in your AI topic.` — where it separates stories whose kind and topics
   * coincide. Never the whole line: the header documents why an
   * outlet-only sentence was rejected. Pass null rather than guessing — a
   * wrong name is worse than no line.
   */
  outlet?: string | null;
  /** `events.title` — the figure rung searches it before the paragraph. */
  title?: string | null;
  /** `events.what_happened`, the shared briefing paragraph. */
  whatHappened?: string | null;
  /** `events.tags` — the concrete kind of thing that happened (0049). */
  tags?: readonly string[] | null;
  /**
   * The reader's followed topic labels, lowercased — enables the subject
   * rung's tie and the follow rung. Omit when the caller has no session and
   * will apply `followedLine` itself; the ladder then skips rung 6.
   */
  followed?: ReadonlySet<string> | null;
};

export type InclusionReason = {
  text: string;
  /** Which rung produced it, for the pipeline report and for tests. */
  source: "stored" | "after-state" | "coverage" | "figure" | "subject" | "follow" | "none";
};

/**
 * Rung 6 — the reader's own follow graph.
 *
 * The honest answer to "why am I seeing this" when nothing *about the story*
 * can be said: the event matched a topic the reader follows. A fact about this
 * reader rather than filler, but the least story-specific line in the ladder —
 * on 2026-10-01 it was every card's line — so `reasonFor` consults it only
 * after the figure and subject rungs have had their say. `digest` passes the
 * follow set it already fetched; the read path passes its own.
 */
export function followedLine(
  topics: readonly string[],
  followedLabels: ReadonlySet<string>,
): string {
  const overlap = topics.filter(
    (label) => label.trim().length > 0 && followedLabels.has(label.toLowerCase()),
  );
  if (overlap.length === 0) return "";
  return `You follow ${listOf(overlap)}.`;
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
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|bn|mn|[kmb])?/iu;
const CVE = /\bCVE-\d{4}-\d{4,7}\b/iu;
/**
 * The noun must sit directly after the number, optionally with a magnitude:
 * "50 million users" is claimed in full (never shrunk to "50 users"), while
 * "50 very contented users" is not a count at all. Source-and-article nouns
 * are excluded — they count the coverage, not the story.
 */
const COUNT =
  /\b(\d[\d,.]*(?:\s*(?:thousand|million|billion))?)\s+(jobs|positions|employees|workers|users|customers|members|subscribers|readers|downloads)\b/iu;

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

// ---------------------------------------------------------------------------
// Rung 5 — what kind of story this is, tied to what the reader follows
// ---------------------------------------------------------------------------

/**
 * `events.tags` (0049) are lowercase concept labels from `assignTags` — the
 * concrete kind of thing that happened, not a category claim. Each glosses to
 * a stem that stays grammatical in a list: "layoffs" and "regulation" need one
 * because "a layoffs story" and "a regulation story" are not English, and the
 * article follows the first stem ("an acquisition and funding story").
 */
const SUBJECT_STEMS: Record<string, string> = {
  funding: "funding",
  cybersecurity: "cybersecurity",
  layoffs: "layoff",
  regulation: "regulatory",
  "product launch": "product launch",
  partnership: "partnership",
  acquisition: "acquisition",
  research: "research",
  controversy: "controversy",
  expansion: "expansion",
};

function subjectLine(
  tags: readonly string[] | null | undefined,
  topics: readonly string[],
  followed: ReadonlySet<string> | null | undefined,
  outlet: string | null | undefined,
): string | null {
  // Up to two kinds: a second tag is what tells two stories in the same
  // subject apart ("product launch, research" vs "product launch"), and past
  // two the line becomes the tag list the email heading cannot carry.
  const kinds: string[] = [];
  for (const raw of tags ?? []) {
    const value = raw.trim().toLowerCase();
    if (!Object.hasOwn(SUBJECT_STEMS, value) || kinds.includes(value)) continue;
    kinds.push(value);
    if (kinds.length === 2) break;
  }
  const stems = kinds.flatMap((kind) => {
    const stem = SUBJECT_STEMS[kind];
    return stem === undefined ? [] : [stem];
  });
  const first = stems[0];
  if (first === undefined) return null;
  const article = /^[aeiou]/u.test(first) ? "an" : "a";
  const subject = `${article} ${stems.join(" and ")} story`;
  // The attribution slot: single-source stories always have one, and its name
  // varies where kind and topics coincide. It is furniture on screen already,
  // so it is one qualifier inside a sentence about the story — never the
  // sentence itself, which is the line the header documents as rejected.
  const name = (outlet ?? "").trim();
  const credited = name === "" ? "" : ` from ${name}`;

  // The tie is a claim about *this* reader, so it only fires on the labels
  // they actually follow — the same test `followedLine` applies. Two at most:
  // the clause is a qualifier, not a topic list.
  const overlap = (followed ? topics : []).filter(
    (label) => label.trim().length > 0 && followed?.has(label.toLowerCase()) === true,
  );
  if (overlap.length === 0) {
    return `This is ${subject}${credited}.`;
  }

  const picks = overlap.slice(0, 2);
  const head = subject.charAt(0).toUpperCase() + subject.slice(1);
  const topicsWord = picks.length === 1 ? "topic" : "topics";
  const attribution = credited === "" ? "" : `${credited},`;
  return `${head}${attribution} in your ${listOf(picks)} ${topicsWord}.`;
}

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

  // The single-source rungs the coverage count used to end at. Both are
  // facts about this story that vary story to story — a number the text names
  // or a tag the event carries — so neither repeats across a briefing the way
  // "So far only X has reported this" and "You follow X." each did.
  const figure = figureLine(input.title, input.whatHappened);
  if (figure !== null) return { text: figure, source: "figure" };

  const subject = subjectLine(input.tags, input.topics, input.followed, input.outlet);
  if (subject !== null) return { text: subject, source: "subject" };

  if (input.followed) {
    const follow = followedLine(input.topics, input.followed);
    if (follow !== "") return { text: follow, source: "follow" };
  }

  // Nothing story-specific and no follow to name. An empty line is honest
  // and a repeated one is not.
  return { text: "", source: "none" };
}
