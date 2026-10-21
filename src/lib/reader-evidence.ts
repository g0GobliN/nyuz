import { extractCompanies, extractProducts } from "./pipeline/extract";
import { claimKey } from "./pipeline/evidence-text";
import {
  decodeEntities,
  hasSourceMetadata,
  hasVisibleEntity,
  metadataOnlyEvidence,
  normalizePlainText,
  normalizeSourceMarkup,
  normalizeSourceText,
  providerFurniture,
  sourceMarkupRemains,
  isRepositorySourceName,
  type SourceContext,
} from "./pipeline/source-text";

export type ReaderSource = {
  name?: string | undefined;
  headline?: string | undefined;
  excerpt?: string | undefined;
  /**
   * The article's own URL, when the caller has it.
   *
   * One rung reads it -- the paid-content refusal in `readiness.ts`, whose ruling
   * #7 (2026-10-17) is that a story is paid content only when *every* coverage URL
   * is paid content. Optional, because the audit scripts build sources from the
   * stored excerpts alone and a rung that guessed at a missing URL would refuse
   * news the reader can read.
   */
  url?: string | undefined;
  enrichedEvidence?:
    { kind: string; text: string; attribution?: string; entities?: string[] }[] | undefined;
};

const ACTION =
  /\b(?:is|are|was|were|has|have|had|said|says|announced|raised|raises|secured|gains?|reached|pledged|funded|backing|discovered|exposed|accessible|connected|restricted|released|launches?|launched|acquire[ds]?|approved|blocked|banned|hired|hires|includes?|reported|confirmed|will|plans?|requires?|remains?|allows?|supports?|offers?|runs?|running|uses?|used|built|found|started|spending|scores?|starts?|expanded|appears?|declined|rose|marks?|represents?|projects?|forecasts?|hosts?|values?|closed|expects?|yields?|produces?|increases?|decreases?)\b/i;

/**
 * Irregular verb forms, which a generated inflection cannot produce.
 *
 * Deliberately not the whole test. "Is there a verb" was previously answered by
 * a closed list of newsroom verbs, which meant a research abstract -- written in
 * the first person, about work the authors did -- could fail on "We distinguish
 * two variants" while a rewritten press release passed. The list is now the
 * irregular core plus generated inflections plus verb morphology, so supporting
 * a domain costs one stem instead of a dictionary.
 */
const IRREGULAR_PREDICATE =
  /\b(?:is|are|was|were|be|been|being|am|has|have|had|do|does|did|said|says|made|makes|found|finds|rose|falls|fell|grew|grown|took|taken|gave|given|led|built|held|lost|set|put|ran|began|begun|became|become|shown|shows?|kept|left|met|sent|spent|stood|wrote|written|won|sold|bought|brought|thought|knew|known|saw|seen|got|went|gone|came)\b/i;

/**
 * Regular verb stems, inflected by the pattern below rather than enumerated.
 *
 * The research block is the point: abstracts report what the authors did, and
 * "evaluate", "reproduce" and "characterize" are not newsroom words.
 */
const PREDICATE_STEMS = [
  // reporting, business and general news
  "report",
  "announce",
  "publish",
  "release",
  "launch",
  "acquire",
  "confirm",
  "decline",
  "expect",
  "plan",
  "project",
  "estimate",
  "forecast",
  "require",
  "remain",
  "allow",
  "support",
  "offer",
  "include",
  "increase",
  "decrease",
  "reach",
  "hire",
  "expand",
  "secure",
  "restrict",
  "describe",
  "appear",
  "host",
  "provide",
  "continue",
  "contract",
  "purchase",
  "integrate",
  "warn",
  "claim",
  "argue",
  "note",
  "show",
  "find",
  "test",
  "cover",
  "raise",
  "fund",
  "back",
  "build",
  "develop",
  "design",
  "produce",
  "install",
  "deploy",
  "run",
  "stop",
  "ban",
  "block",
  "approve",
  "reject",
  "join",
  "leave",
  "win",
  "lose",
  "pay",
  "cost",
  "value",
  "price",
  "grow",
  "fall",
  "rise",
  "drop",
  "close",
  "open",
  "start",
  "keep",
  "hold",
  "make",
  "take",
  "give",
  "turn",
  "move",
  "change",
  "become",
  "seem",
  "help",
  "need",
  "want",
  "work",
  "face",
  "meet",
  "send",
  "share",
  "tell",
  "ask",
  "promise",
  "refuse",
  "agree",
  "decide",
  "consider",
  // research
  "propose",
  "introduce",
  "evaluate",
  "demonstrate",
  "measure",
  "reproduce",
  "compare",
  "distinguish",
  "identify",
  "analyse",
  "analyze",
  "observe",
  "derive",
  "define",
  "present",
  "investigate",
  "examine",
  "characterise",
  "characterize",
  "separate",
  "establish",
  "model",
  "predict",
  "improve",
  "reduce",
  "enable",
  "achieve",
  "perform",
  "outperform",
  "apply",
  "construct",
  "implement",
  "study",
  "survey",
  "review",
  "assess",
  "quantify",
  "calculate",
  "compute",
  "simulate",
  "annotate",
  "classify",
  "detect",
  "train",
  "infer",
  "optimise",
  "optimize",
  "generalise",
  "generalize",
  "transfer",
  "augment",
  "mitigate",
  "exploit",
  "verify",
  "validate",
  "extend",
  "attribute",
  "correlate",
  "rely",
  "depend",
  "motivate",
  "justify",
  "formalize",
  "encode",
  "decode",
  "retain",
  "preserve",
  "replace",
  "mutate",
  "accept",
];

const REGULAR_PREDICATE = new RegExp(
  `\\b(?:${[...new Set(PREDICATE_STEMS)].join("|")})(?:s|es|d|ed|ing)?\\b`,
  "i",
);

/**
 * Verb morphology the stems above do not cover.
 *
 * This is the structural half of the test, and the reason a domain does not need
 * a dictionary entry to be readable. It is intentionally loose: it only decides
 * whether a sentence *may* be published, while the fragment, metadata, quote and
 * attribution checks are what keep junk out.
 */
const PREDICATE_MORPHOLOGY =
  /\b[\p{L}]{4,}(?:ed|ing|ised|ized|ises|izes|ates?|ified|ifies|ify)\b/iu;

/**
 * Contracted verbs, which no stem can generate.
 *
 * "DigiCert doesn't see agent management as a manual problem." has a subject and
 * a predicate, and every gate above reads it as a label: `doesn't` is `does` +
 * `n` + `'` + `t`, so `\bdoes\b` finds no boundary after the `n`, and the
 * inflections the stem list builds produce `does`, `dosed`, `doesing` -- never
 * `doesn't`. The sentence was refused as evidence, while the *longer* version of
 * it passed on its subordinate clause ("for a company that built its success on
 * automated verification") -- which is how a real production deck ended up
 * opening with the source's commentary instead of its fact.
 *
 * One alternative per contraction, in both apostrophes, because sources use
 * both. This can only ever admit a sentence that has a verb.
 */
const CONTRACTED_PREDICATE =
  /\b(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t|hasn['’]t|haven['’]t|hadn['’]t|doesn['’]t|don['’]t|didn['’]t|won['’]t|wouldn['’]t|can['’]t|cannot|couldn['’]t|shouldn['’]t|mustn['’]t|needn['’]t|ain['’]t)\b/i;

/** A clock time, which is the one thing every session-credit line contains. */
const CLOCK_TIME = /\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i;

/** Words a sentence can open on without naming anybody. */
const CLAUSE_OPENER = new Set(
  (
    "the a an this that these those it they he she we you i both some many most all each every " +
    "no not there here another such one two three other others " +
    // Prepositions and subordinators that open a new clause. A capitalised one
    // after a verbless head with no punctuation is a heading or an image caption
    // glued to its paragraph: "...with social media firms in China For adults, it
    // is not a hard ban" arrived that way on the 2026-10-02 briefing.
    "for with in on as to at from by into about over under during after before when while " +
    "because if since although though"
  ).split(" "),
);

/** Every verb form, not only the finite ones, for the seam test below. */
const VERB_FORM =
  /\b(?:is|are|was|were|has|have|had|said|says|announced|raised|secured|gains?|reached|pledged|funded|released|launches?|launched|approved|blocked|banned|hired|hires|includes?|reported|confirmed|will|plans?|requires?|remains?|allows?|supports?|offers?|runs?|running|uses?|used|built|found|started|spending|scores?|starts?|expanded|appears?|declined|rose|marks?|represents?|projects?|forecasts?|hosts?|values?|closed|expects?|yields?|produces?|increases?|decreases?|do|does|did|makes?|made|shows?|shown|kept|left|met|sent|spent|stood|wrote|written|won|sold|bought|brought|thought|knew|known|saw|seen|got|went|gone|came|took|taken|gave|given|led|held|lost|put|ran|began|begun|became|become|falls|fell|grew|grown)\b/i;

/** Grammatical words -- the only lowercase a schedule segment may be made of. */
const FUNCTION_WORD = new Set(
  "a an the and or but nor so yet to of in on at by for from with as into over under per via vs & of".split(
    " ",
  ),
);

/**
 * A session credit inventory inside a unit: a run of comma-separated segments made
 * of nothing but names, times, codes and grammatical words, one of them a clock
 * time.
 *
 *   "JanakiRam Goteti, 11:45 AM PDT, Room LL20CD"
 *
 * A credit line has no verb in it. Two of the verb lists above say otherwise: `ACTION`
 * carries `marks?`, so a person called Mark reads as one, and `IRREGULAR_PREDICATE`
 * carries `am`, so the AM in a clock time does. Both words are load-bearing in real
 * sentences ("the launch marks the end", "I am told"), so the lists stay as they are
 * and the shape decides instead.
 *
 * Prose is what structurally cannot match: a sentence's segments carry lowercase
 * *content* words ("and end before noon", "designed for Python developers"), which no
 * amount of capitalisation hides. What a schedule row may carry is a lowercase
 * grammatical word, and the label a source wrote above it -- `Sessions include:`,
 * stripped only when the colon is not part of a clock time.
 *
 * The cost of being wrong is a refused unit, not a published fragment.
 */
function creditInventory(text: string): { run: string; whole: boolean } | null {
  const segments = text
    .replace(/[.!?]+\s*$/, "")
    .split(",")
    .map((segment) => segment.trim());
  const material = (segment: string): boolean => {
    const bare = segment.replace(/^[A-Z][A-Za-z ,'-]{0,40}:(?!\d)\s*/, "");
    if (bare === "") return false;
    return [...bare.matchAll(/\b([a-z][a-z'-]*)/g)].every((match) =>
      FUNCTION_WORD.has(match[1] ?? ""),
    );
  };
  let from = -1;
  let run: string[] = [];
  const consider = (end: number): { run: string; whole: boolean } | null => {
    if (run.length < 2) return null;
    if (!run.some((segment) => CLOCK_TIME.test(segment))) return null;
    return { run: run.join(", "), whole: from === 0 && end === segments.length };
  };
  for (const [index, segment] of segments.entries()) {
    if (material(segment)) {
      if (run.length === 0) from = index;
      run.push(segment);
      continue;
    }
    const found = consider(index);
    if (found) return found;
    run = [];
  }
  return consider(segments.length);
}

/**
 * A sentence that is nothing but a list of gerund phrases.
 *
 * "Relying on CarPlay, slinking back to X, competing with Muse, and much more."
 * reached the reader as the only paragraph of the Vergecast story on 2026-10-17 --
 * a programme's own back-announce, and not a clause: every segment is a participle
 * and nothing in it is finite. The arbiter's ruling #5 authorised refusing the
 * publisher-owned sentences so the story's empty body withholds the story, and a
 * scan for a verb cannot see this one, because `PREDICATE_MORPHOLOGY` reads `-ing`
 * as a verb shape. The shape is narrow on purpose: two or more gerund-initial
 * segments and no finite verb anywhere. A sentence that starts with a participle
 * and finishes with a finite clause ("Relying on CarPlay, the team rebuilt the
 * hub") is untouched.
 */
function gerundListFragment(text: string): boolean {
  const segments = text
    .replace(/[.!?]+\s*$/u, "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const gerunds = segments.filter((segment) => /^(?:and\s+)?\p{L}+ing\b/iu.test(segment));
  if (gerunds.length < 2) return false;
  for (const token of text.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) if (finiteVerb(token)) return false;
  return true;
}

/** Whether the text reads as a clause with a predicate, rather than a label or a stub. */
export function hasPredicate(text: string): boolean {
  // Checked first, because it can only take a predicate away: every rule below is
  // a scan for a verb, and a scan cannot tell a name that looks like a verb from the
  // verb. A unit that is nothing but one inventory has no clause in it.
  if (creditInventory(text)?.whole) return false;
  if (gerundListFragment(text)) return false;
  return (
    ACTION.test(text) ||
    IRREGULAR_PREDICATE.test(text) ||
    REGULAR_PREDICATE.test(text) ||
    PREDICATE_MORPHOLOGY.test(text) ||
    CONTRACTED_PREDICATE.test(text)
  );
}

/**
 * The two source blocks a heading and the prose under it look like once a feed's
 * headings stop being distinguishable from its paragraphs -- joined by a space,
 * with the full stop that should have separated them missing.
 *
 *   "What to Expect from the Introduction Track All attendees, from students, ..."
 *
 * The seam is made at ingest, and the ingest boundary now ends a heading element,
 * so a *new* row cannot contain it. Rows stored before that still do, and their
 * plain text is where the seam has to be found: a word a sentence can open on,
 * glued straight onto a capitalised word before it, where the run before it holds
 * no verb form at all -- an infinitive after `to` excepted, because that is how a
 * heading ends -- and a clause follows.
 *
 * That is deliberately narrow. A name made of two capitals ("New York", "Wall
 * Street", "Sean Hollister / The Verge") is only a seam when what follows the
 * second capital starts the sentence, and a run with a verb in it is prose:
 * `When asked to compare MariaDB with PostgreSQL for the same task, ...` has one in
 * `asked`, so it is a sentence and stays one.
 *
 * Measured over the frozen 200-event corpus (1407 raw and enriched units): 3 units
 * match, all 3 are glue -- this heading, a photo credit, a deal headline -- and 0
 * legitimate sentences do.
 */
function headingSeam(text: string): string | null {
  const tokens = text.split(/\s+/);
  for (let index = 1; index < tokens.length; index += 1) {
    const word = (tokens[index] ?? "").replace(/[^A-Za-z']/g, "");
    const previous = (tokens[index - 1] ?? "").replace(/[^A-Za-z']/g, "");
    if (!/^[A-Z][a-z]*$/.test(word) || !CLAUSE_OPENER.has(word.toLowerCase())) continue;
    if (!/^[A-Z0-9]/.test(previous)) continue;
    // Punctuation between the two words is a clause boundary, so there is no seam:
    // "... was dead. In New York, he said" is two sentences the splitter kept.
    if (/[.!?;:,]/.test(tokens[index - 1] ?? "")) continue;
    const head = tokens.slice(0, index);
    if (head.length < 3) continue;
    if (VERB_FORM.test(head.join(" ").replace(/\bto\s+\w+/gi, ""))) continue;
    if (!VERB_FORM.test(tokens.slice(index).join(" "))) continue;
    if (!/^[a-z]/.test((tokens[index + 1] ?? "").replace(/[^A-Za-z]/g, ""))) continue;
    return tokens.slice(Math.max(0, index - 4), index + 2).join(" ");
  }
  return null;
}

/**
 * A label and a dateline welded to the sentence under them.
 *
 * The live shape (deployed origin, 2026-10-14, story 29ad32c2):
 *
 *   "The full chain:…September 18, 2026 Operating as hackers under OpenAI's bug
 *    bounty program, Hacktron researchers uncovered critical vulnerabilities …"
 *
 * The source published a section label and a date stamp above its own paragraph,
 * the feed flattened the three into one run, and the reader got the label and the
 * date inside a published fact. `headingSeam` cannot see it: the punctuation
 * between the pieces (`.`, `:`, `…`) is exactly what tells it a real clause
 * boundary went past.
 *
 * Narrow by construction. The label must end in a colon or an ellipsis, must not
 * carry a predicate of its own -- "The company said: September 18, 2026 …" keeps
 * its phrase, because `said` is a verb -- may not run longer than eight words,
 * and a month-name date must follow it immediately. A unit that merely *contains*
 * a date, or opens on one ("September 18, 2026 was the day …"), is untouched.
 */
const MONTH_NAME_DATE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s*\d{4}\b/;

function labelDatelineHead(text: string): string | null {
  const match = MONTH_NAME_DATE.exec(text);
  if (!match || match.index === undefined || match.index === 0) return null;
  const head = text.slice(0, match.index).trimEnd();
  if (head.length > 72) return null;
  if (!/(?:[:…]|\.\.\.)$/.test(head)) return null;
  const words = head.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));
  if (words.length < 2 || words.length > 8) return null;
  if (hasPredicate(head.replace(/\s*[:…]+$/, ""))) return null;
  return `${head} ${match[0]}`;
}

/** A word a sentence-cased heading can be made of: lowercase, unpunctuated. */
const SENTENCE_HEAD_WORD = /^[a-z][a-z'’-]*$/;

/**
 * The clause openers this seam accepts, which is `CLAUSE_OPENER` minus the ones
 * English puts mid-sentence for ordinary reasons.
 *
 * Measured, not assumed. The first draft reused the whole set and matched 12 of
 * 7,926 live-window units, 11 of them prose: "According to The Register …",
 * "In an emailed statement to The Washington Post …", "The other day I …",
 * "The number I keep coming back to …", "So as I understand …". Every one of
 * those turned on a pronoun ("I") or on the definite article that the name of a
 * publication or a body begins with ("The Register", "The Washington Post") --
 * and a capitalised "The" after a lowercase word is the most ordinary thing in
 * news prose. What is left is the class that cannot sit mid-sentence without
 * punctuation: a subordinator, a preposition or a quantifier. The live true
 * positives are "Some" ("Model selection Some frontier models …") and "Before"
 * ("The architecture in one minute Before getting into …"), and the sample's one
 * other hit, "A shelf of diminutive apps With TinyJS, …", is the same weld.
 *
 * Dropped: I, you, it, they, he, she, we, i, the, a, an, this, that, these,
 * those, there, here, another, such, one, two, three, both, all, each, every,
 * no, not, many, most, some -- the pronouns, the articles and the demonstratives.
 */
const SENTENCE_HEAD_OPENER = new Set(
  (
    "for with in on as to at from by into about over under during after before when while " +
    "because if since although though some many most all each every both another such " +
    "other others no not there here one two three"
  ).split(" "),
);

/**
 * The same weld `headingSeam` looks for, in the casing a blog subhead uses.
 *
 * Two live shapes (deployed origin, 2026-10-14, story 7af726e6):
 *
 *   "Model selection Some frontier models impose security guardrails on their
 *    outputs, according to GitHub."
 *   "The architecture in one minute Before getting into the interesting parts,
 *    it helps to know how the pieces fit together."
 *
 * `headingSeam` requires the heading's non-first word capitalised
 * ("... Introduction Track All attendees ..."), which is how a Title Cased
 * heading looks; a subhead written in sentence case ("Model selection") misses
 * it, and the label ships inside the fact.
 *
 * Narrow by construction: the head is at most six words, is sentence-cased
 * throughout -- so a proper name inside it ("The novel Beloved Before …") is not
 * a subhead and stays -- holds no verb form at all, and is followed by a
 * capitalised clause opener and a clause with a predicate of its own. Refused
 * rather than cut, because the head is furniture and the clause's own subject is
 * not recoverable from it.
 */
function sentenceCasedHeadingSeam(text: string): string | null {
  const tokens = text.split(/\s+/);
  if (tokens.length < 5) return null;
  for (let index = 1; index < tokens.length; index += 1) {
    const raw = tokens[index] ?? "";
    // A token carrying a digit is not an English word: `A19` reads as `a` under
    // a letters-only strip and matched "with the A19 chip" as prose before this.
    if (/\d/.test(raw)) continue;
    const word = raw.replace(/[^A-Za-z']/g, "");
    if (!/^[A-Z][a-z]*$/.test(word) || !SENTENCE_HEAD_OPENER.has(word.toLowerCase())) continue;
    // Punctuation between the two words is a clause boundary, so there is no seam:
    // "... was dead. In New York, he said" is two sentences the splitter kept.
    if (/[.!?;:,]/.test(tokens[index - 1] ?? "")) continue;
    const head = tokens.slice(0, index);
    if (head.length < 2 || head.length > 6) continue;
    if (!/^[A-Z][a-z'’-]*$/.test(tokens[0] ?? "")) continue;
    if (
      !head.slice(1).every((token) => SENTENCE_HEAD_WORD.test(token.replace(/[^A-Za-z'’-]/g, "")))
    )
      continue;
    // `VERB_FORM` rather than `hasPredicate`: the stem list behind the latter
    // reads a noun as a verb ("selection" off `select`), and a subhead is exactly
    // a noun phrase -- "Model selection" must not be treated as a clause.
    //
    // The one gap that guard left was closed on 2026-10-17 (arbiter ruling #7,
    // Q3), with the measured unit: "The misconceptions that stall projects Two
    // objections come up in almost every community consultation, according to
    // Berti ..." reached a reader as a run-on with a capital mid-sentence,
    // because the head's only verb form sits *inside a relative clause*. A
    // relative clause is part of a noun phrase, not a clause of its own, so it is
    // removed before the verb test -- the relative pronoun and everything after
    // it, which is exactly the shape that slipped through. The six-word bound
    // above still holds the head to a subhead's length, so prose that merely
    // contains a relative clause is not swept up.
    const headText = head
      .join(" ")
      .replace(/\b(?:that|which|who)\s+\S+(?:\s+\S+)*$/i, "")
      .replace(/\bto\s+\w+/gi, "");
    if (VERB_FORM.test(headText)) continue;
    if (!hasPredicate(tokens.slice(index).join(" "))) continue;
    return `${head.join(" ")} ${tokens[index]}`;
  }
  return null;
}

/**
 * The furniture a source welded to the front of its own sentence, if any.
 *
 * Exported so the audit can count the class and a test can pin the shape rather
 * than the string, exactly as `sourceSeam` is.
 */
export function sourceFurnitureHead(text: string): string | null {
  return labelDatelineHead(text) ?? sentenceCasedHeadingSeam(text);
}

/**
 * The seam, if this unit contains one: two source blocks published as one sentence.
 *
 * Returns the offending fragment rather than a boolean so the reason a fact was
 * refused can name it, and so a regression test can assert on the shape instead of
 * on "this string is bad".
 *
 * Three source blocks count: a heading glued to the prose under it
 * (`headingSeam`), a session credit inventory (`creditInventory`), and the
 * label-and-dateline head a feed flattens above its own paragraph
 * (`sourceFurnitureHead`). Each is the same defect at the reader's end -- a unit
 * that stopped being one sentence -- so each is refused at the same boundary and
 * for the same reason.
 */
export function sourceSeam(text: string): string | null {
  return headingSeam(text) ?? creditInventory(text)?.run ?? sourceFurnitureHead(text) ?? null;
}

/**
 * A relative clause that is set off by a comma, which is the only shape separable
 * from prose.
 *
 * The comma is load-bearing, and it was measured rather than chosen. The first
 * draft accepted a bare `which|who|whose|that` and refused the closed-set verb
 * lists' blind spots into the bargain: "The photographer told Reuters that the
 * image was taken on Monday." is a real sentence whose main verb, `told`, none of
 * the lists carry (the repository's own reader-quality suite caught it), and "A
 * Ukrainian company that got rich making cameras ... now outfits first-person-view
 * drones ..." is the same shape a live window is full of. Neither has a comma
 * before its relative clause. What a comma before `which|who|whose` marks is the
 * other thing: a non-restrictive clause hung off a noun phrase -- "A set of
 * taskflow YAMLs, one per stage, which are essentially the prompts that tell the
 * LLM agent what to do at each step" -- where the head can be the whole unit.
 * `that` is out for a second reason: as a complementizer it follows a reporting
 * verb ("said that ..."), which is where the closed lists are weakest.
 */
const RELATIVE_CLAUSE = /,\s*(?:which|who|whose)\b/i;

/**
 * The determiners, after which a verb-shaped word is the noun head.
 *
 * The demonstratives are deliberately absent. "This marks the end ..." and "That
 * leaves one option ..." are ordinary openings whose first word is a demonstrative
 * *subject*, and reading the verb after it as a noun would refuse them -- the same
 * mistake `SENTENCE_HEAD_OPENER` records in the other direction. What is left is the
 * set that cannot be a subject: an article, a possessive, or a quantifier.
 */
const NOUN_HEAD_DETERMINER = new Set(
  "a an the its their his her our your my any each every some no one two three".split(" "),
);

/** Whether a single token could be a finite verb, read on its own. */
function verbShaped(token: string): boolean {
  if (hasPredicate(token)) return true;
  return /^[a-z]{3,}(?:s|es|ed|ing|d)$/.test(token);
}

/**
 * The outside of a relative clause, with its verb-shaped noun heads read as nouns.
 *
 * Two operations, both of them about what is *not* the unit's predicate:
 *
 *   - everything from the first relativizer to the last comma after it is dropped,
 *     because that is the clause the unit is hiding its verb in;
 *   - a verb-shaped word directly after a determiner is dropped, because that is
 *     where English puts a noun head -- "A set of taskflow YAMLs", "Their reports
 *     of the incident" -- and `IRREGULAR_PREDICATE` carries `set`, which is a verb
 *     in "the company set a record" and a noun in "a set of rules".
 */
function outsideRelativeClause(text: string): string {
  const match = RELATIVE_CLAUSE.exec(text);
  if (!match || match.index === undefined) return text;
  const prefix = text.slice(0, match.index);
  const rest = text.slice(match.index + match[0].length);
  const lastComma = rest.lastIndexOf(",");
  const tail = lastComma >= 0 ? rest.slice(lastComma + 1) : "";
  return `${prefix} ${tail}`.trim();
}

function withoutNounHeads(text: string): string {
  const tokens = text.split(/\s+/);
  const kept: string[] = [];
  for (const [index, token] of tokens.entries()) {
    const word = token ?? "";
    const bare = word.replace(/[^A-Za-z']/g, "");
    const previous = (tokens[index - 1] ?? "").replace(/[^A-Za-z']/g, "");
    if (bare !== "" && NOUN_HEAD_DETERMINER.has(previous.toLowerCase()) && verbShaped(bare)) {
      continue;
    }
    // A filename or an identifier is not a word of the sentence. The live sibling
    // of the production item -- "A shell driver (run_fuzzing.sh) that chains the
    // pipeline stages together." -- is refused by this test only because the
    // filename is dropped: `PREDICATE_MORPHOLOGY` reads `fuzzing` as a verb, which
    // would have published the item on the punctuation of its own path. A token
    // carrying a bracket, an underscore, an internal dot or a digit is code, and
    // code is not a clause.
    if (/[()_]|\d|\.\S/.test(word)) continue;
    kept.push(word);
  }
  return kept.join(" ");
}

/**
 * A unit whose only predicate is a relative clause's own verb.
 *
 * The live shape (deployed origin, 2026-10-14, story 7af726e6, published as the
 * story's deck):
 *
 *   "A set of taskflow YAMLs, one per stage, which are essentially the prompts
 *    that tell the LLM agent what to do at each step."
 *
 * The source wrote that as one item of a bulleted list; the provider flattened the
 * list into a paragraph, and the item reached the reader as prose. It is a noun
 * phrase with a relative clause -- the reader is told a list exists and then given
 * one of its parts with no clause to carry it.
 *
 * `hasPredicate` cannot see this, for two reasons that pull in opposite directions
 * and both matter:
 *
 *   - the unit *does* carry a verb, and the predicate test finds it -- `are`, in the
 *     relative clause -- which is exactly what has to be ignored;
 *   - a noun head can look like a verb, and the reverse is what let the item past
 *     the deck's own judge: `IRREGULAR_PREDICATE` carries `set`, and "A set of ..."
 *     satisfied it.
 *
 * So the test reads the material outside the relative clause, with a
 * determiner-plus-verb-shaped word read as the noun head it is, and refuses the unit
 * only when nothing outside can be its predicate. Kept whole is every sentence that
 * resumes after its own relative clause -- "The company set a new record, which
 * analysts had expected" (a verb, not after a determiner), "A cryptocurrency
 * exchange ... is being sued ..., which the company says ..." (a predicate before
 * the clause), "The photographer told Reuters that the image was taken on Monday."
 * (a complementizer, and a main verb no list carries).
 *
 * Measured over the live window (2026-10-14: the newest 200 completed events, 192
 * published decks, 57 of them carrying a comma-set relative clause): refuses the
 * production deck above and none of the 57, every one of which is a real sentence.
 * The same test at the unit boundary refuses 12 of 7,842 live units and 11 of those
 * are prose, which is why it has no hook there -- see the note in
 * `unitTextRejection`. The negative controls are pinned in
 * reader-deck-clause.test.ts, including the two live shapes that share the
 * production item's grammar without its comma ("A Ukrainian company that got rich
 * making cameras ... now outfits drones ...", "A Silicon Valley startup that uses
 * weather balloons and AI ... won a US military contract ..."), which this rule
 * cannot and must not refuse. Limits, in the same terms the furniture rule records:
 * 200 events is evidence of narrow observed behaviour, not proof of universal
 * precision or recall, and this rule must not grow into a general grammar validator.
 */
export function noMainClause(text: string): boolean {
  if (!RELATIVE_CLAUSE.test(text)) return false;
  const outside = withoutNounHeads(outsideRelativeClause(text));
  if (hasPredicate(outside)) return false;
  // A third-person verb the closed stems do not carry ("heads the division", "notes
  // that ...") arrives as a lowercase word ending in `s`, which is exactly how a
  // plural noun arrives too -- "tools" in the live sibling
  // "A set of MCP tools that the agent calls ..., and so on." is what a bare `-s`
  // morphology test would read as a predicate. The follower is what separates them:
  // a verb takes an object or a clause, a plural noun in that position takes "and",
  // a comma or nothing. Erring towards keeping the unit is deliberate: a plural noun
  // followed by a preposition can still look like a verb here, and that costs a
  // published fragment, not a refused sentence.
  return !/\b[a-z]{3,}s\s+(?:the|a|an|its|their|his|her|our|your|that|this|these|those|it|them|to|for|with|from|after|on|in|by|into|at|over|under|about)\b/.test(
    outside,
  );
}
const NOISE =
  /\b(?:welcome back|weekly column|this week['’]s (?:column|newsletter)|as regular readers know|subscribe to|sign up for|click here|read more|continue reading|cookie policy|all rights reserved|follow us on|share this article|related articles|the coverage centers on|amount mentioned|percentage mentioned|entity mentioned|source count|evidence suggests|nyuz has also covered)\b|\bthe post\b.*\bappeared first on\b|^(?:advertisement|image credit|photo credit|hopefully\b|the takeaway\b|appeared first on\b|(?:apply|register|sign up)\s+(?:now|today|here)\b|put (?:these|those) ideas in practice\b)/i;

/**
 * Publisher furniture and promotion, which is not news.
 *
 * A fetched article page is not only its article: `<p>` markup also wraps a
 * masthead bio, a repository's own fundraising line, a vendor's house ad, the
 * newsletter's call to action, and a paywalled series' sales blurb. `html-text`
 * strips `footer`/`aside`/`nav`, but these units sit inside the article column
 * on the live pages this reads, so they arrive as prose and pass every grammar
 * test -- they are sentences. The 2026-10-02 briefing read them back to a reader
 * on 8 of its 25 stories: Phoronix's author bio became an OpenMandriva and a
 * Qualcomm read (one of them *entirely* biology, with no article left), arXiv's
 * "Have an idea for a project" solicitation appeared mid-abstract, The Hacker
 * News' ad unit for a security vendor closed a Citrix story, and TechCrunch's
 * Disrupt promo split a sentence in half.
 *
 * A closed set of phrases, each of which is only ever the publication talking
 * about itself or selling something. It *rejects* the sentence rather than
 * repairing it -- a masthead bio has no fact in it to keep -- and it is applied
 * at the same boundary as `NOISE` so the enrichment pass and the composer agree
 * about what a source's sentence is.
 */
/**
 * The publication-role words a masthead line may use, as a first-letter class pair
 * so the shape stays case-sensitive where it has to be.
 *
 * Declared before `PUBLISHER_FURNITURE` because the bio-continuation entry inside
 * it reads the same set -- one vocabulary for the byline and its continuation, so
 * a role added for one cannot go missing from the other.
 */
const PUBLISHER_BYLINE_ROLES = [
  "editor",
  "writer",
  "reporter",
  "correspondent",
  "contributor",
  "analyst",
  "reviewer",
  "journalist",
  "columnist",
  "author",
  "founder",
  "publisher",
  // Measured on the frozen corpus: "Theresa Loconsolo is an audio producer at
  // TechCrunch" is the same masthead line as the writer and editor shapes above,
  // and the word was simply missing from the set.
  "producer",
]
  .map((role) => `[${role.charAt(0).toUpperCase()}${role.charAt(0)}]${role.slice(1)}`)
  .join("|");

const PUBLISHER_FURNITURE = new RegExp(
  [
    // Masthead and author bio (Phoronix, and the shape generally).
    String.raw`\bprincipal author\b`,
    String.raw`\bhas written more than [\d,]+ articles\b`,
    String.raw`\bPhoronix Test Suite\b`,
    String.raw`\bAll trademarks used are properties\b`,
    String.raw`\bfounded the site in \d{4}\b`,
    String.raw`\b(?:is|are) also the lead developer\b`,
    // The masthead's contact block, which follows the bio on the same page.
    String.raw`\b(?:he|she|the author) can be (?:followed|contacted|reached)\b`,
    String.raw`\bcontacted via\b`,
    String.raw`\bcan be reached at\b`,
    String.raw`\bsend (?:news )?tips? (?:to|at)\b`,
    String.raw`\bfor news tips\b`,
    // A repository's own solicitation and values page (arXiv).
    String.raw`\bHave an idea for a project\b`,
    String.raw`\bcommitted to these values\b`,
    String.raw`\bonly works with partners that adhere\b`,
    String.raw`\badd value for arXiv['’]s? community\b`,
    // A vendor ad unit embedded in the article column (The Hacker News).
    String.raw`\bruntime identity controls?\b`,
    String.raw`\bAI agents are already operating inside enterprises\b`,
    String.raw`\bsecurity teams still lack the visibility\b`,
    String.raw`\bcompromise identities and escalate access\b`,
    String.raw`\bfight back with\b`,
    // Conference and subscription promotion (TechCrunch, Tom's Hardware).
    String.raw`\bGet \d+% off\b`,
    String.raw`\bThe Disrupt experience\b`,
    // The same event, named rather than described: a speaker announcement is
    // a grammatical sentence about a real person, so only the event tells it
    // apart from the reporting that looks like it.
    String.raw`\bTechCrunch Disrupt\b`,
    String.raw`\bCover more ground by making connections\b`,
    String.raw`\bdiscovering what['’]s next in the startup ecosystem\b`,
    String.raw`\bGo deeper with\b`,
    // A masthead bio that keeps going after the outlet, and the two continuation
    // sentences that follow it in the same source. The 2026-10-14 byline shape
    // stopped at the outlet on purpose, so `Theresa Loconsolo is an audio producer
    // at TechCrunch focusing on Equity ...` stayed eligible -- and reached the
    // reader on 2026-10-17 as the body of a podcast episode page, with `Theresa is
    // based in New Jersey and holds a bachelors degree in Communication from
    // Monmouth University.` and `Before joining TechCrunch in 2022, she was one of
    // 2 producers at a four-station conglomerate ...` behind it (arbiter ruling #5).
    // The continuation is allowed only for a beat or a tenure -- `focusing on`,
    // `covering`, `who also covers` -- because `who broke the story on Friday` is
    // a byline the ruling explicitly kept eligible.
    //
    // ASCII classes, not `\p{Lu}`: this regex is compiled with `i` and *without*
    // `u`, where `\p{Lu}` is the literal text `p{Lu}` and can never match. The
    // first version of these two entries used the property escapes and was dead
    // code -- measured on the probe sentence below, the house `at [A-Z][\w'’.]*`
    // form is what actually matches a masthead.
    String.raw`\b(?:is|was|are)\s+(?:(?:the|a|an)\s+)?(?:\w+\s+){0,3}(?:${PUBLISHER_BYLINE_ROLES})\s+at\s+[A-Z][\w'’.&-]*(?:\s+(?:&|and)?\s*[A-Z][\w'’.&-]*){0,2}\s+(?:focusing on|covering|who also (?:covers|writes about|hosts)|where (?:he|she) (?:covers|writes|hosts))\b`,
    String.raw`\bBefore joining\s+[A-Z][\w'’.&-]*`,
    String.raw`\bis based in [^.]{2,60} and holds a\b`,
    // A promotion fragment and a conference call to action, both measured in the
    // same TechCrunch episode page. `Disrupt doors open Oct.` is truncated by the
    // source itself, which is why it is anchored rather than a general phrase.
    String.raw`^Disrupt doors open\b`,
    String.raw`\bask questions, find solutions\b`,
    // The same outlet's pitch in its other wording, and its byline bio. Both
    // reached a reader on 2026-10-08 inside a keyboard review: the promo blurb
    // ("Go beyond the headlines with expert reporting on the hardware industry.
    // Unlock exclusive tools and insights for enthusiasts who want more.") and
    // the analyst's masthead line, where the beat name is a comma-separated
    // list rather than the outlet, so the Premium rules above cannot see it.
    String.raw`\bGo beyond the headlines\b`,
    String.raw`\bUnlock exclusive\b`,
    String.raw`\bfor enthusiasts who want more\b`,
    String.raw`\bcovers everything that has to do with\b`,
    String.raw`\bTH Premium\b`,
    String.raw`\bTom['’]s Hardware Premium\b`,
    String.raw`\bat [A-Z][\w'’.]*(?:\s+[A-Z][\w'’.]*){0,3} Premium\b`,
    // The teaser bullets of that paywalled series, which arrive as standalone
    // noun phrases once the heading above them is stripped.
    String.raw`\bfoundry roadmaps? for\b`,
    String.raw`\bchipmaking lithography tools\b`,
    String.raw`\bchipmaking tool roadmaps?\b`,
    // Generic calls to action.
    // The publication pointing the reader at itself, which a feed appends after
    // its own truncation ellipsis. The outlet name is the variable tail, so the
    // phrase is the whole rule and no list of mastheads can go stale.
    String.raw`\bread (?:the )?full (?:story|article|version|write-?up) (?:at|from|on)\b`,
    // The outlet's own deck, which is the article describing itself rather than
    // the event: NPR's "We examine the evidence -- and whether the city can keep
    // its high-tech dragnet without sacrificing civil liberties" reached a
    // reader as `The authors examine the evidence` once the narrator clause
    // began matching a sentence-initial `We`. Both voices, because the
    // enrichment boundary reads the source's own words and the composer reads
    // the rewritten one. A paper that opens "we examine X" is the cost --
    // measured at 0 sentences in the 2026-10-03 frozen corpus, and the reason
    // the list is these three deck verbs rather than a first-person rule.
    String.raw`\b(?:we|the authors?)\s+(?:examine|explain|break\s+down)\b`,
    String.raw`\bSubscribe (?:now|today|to this|for)\b`,
    String.raw`\bSign up (?:now|today|for your|to)\b`,
    String.raw`\bRegister (?:now|today|free)\b`,
    String.raw`\bDownload (?:the|our|your) (?:free )?(?:guide|report|ebook|whitepaper)\b`,
    String.raw`\bsponsored (?:content|post|by)\b`,
    String.raw`\baffiliate (?:links?|commission)\b`,
    // A sponsored insert inside a magazine's own feed (MIT Technology Review,
    // 2026-10-03): a vendor's name is pasted into a label and the report's
    // findings are announced rather than reported. Measured on the frozen
    // corpus, both phrases occur only in that block's units, so the closed set
    // costs no reporting.
    String.raw`\bkey findings include\b`,
    String.raw`\bin partnership with\b`,
    String.raw`\blearn more at\b`,
    String.raw`\bLet['’]s show how it works\b`,
    // Campaign copy, which arrives inside a news post as a caption or a slogan.
    String.raw`\bStop (?:calling|pretending|selling) it\b`,
    // A programme describing its own episode, in the opening words every one of
    // them uses. Measured on 2,108 stored units from 250 live events: 2 matches,
    // both a podcast's own episode page, and one of them published as the deck of
    // a story whose only paragraph was the hosts' banter (`Relying on CarPlay,
    // slinking back to X ...`) -- a programme page, not a news story. Anchored,
    // because the sentence has to *open* on the programme.
    String.raw`^(?:On|In) (?:this|today['’]s) (?:episode|edition) of\b`,
  ].join("|"),
  "i",
);

/**
 * The copular publisher byline: a masthead line that is a grammatical sentence.
 *
 * Every author-bio entry in `PUBLISHER_FURNITURE` above is *verbless* ("has
 * written more than N articles", "founded the site in 2004"), which is the shape
 * that list was written for. On 2026-10-14 a reader-facing story opened on a
 * masthead line that *has* a verb, so it passed every grammar test and every
 * predicate: measured on that exact string, `editorialNoise`, `publisherVoice`
 * and `sourceSeam` all returned negative, and it entered at extraction as
 * `article_evidence` unit 1 of a Tom's Hardware article before being published as
 * the deck.
 *
 * The shape, and nothing wider (the arbiter's ruling of 2026-10-14, option A): a
 * name, a copula, an optional article, a bounded role phrase whose role comes
 * from a closed publication-role set, an affiliation -- and the sentence **ends
 * there**. A masthead line stops after the outlet; reporting continues, which is
 * what keeps "Sayem Ahmed, the Subscription Editor at Tom's Hardware, said the
 * feature would launch next month." and "Maya Chen is the reporter at The Verge
 * who broke the story on Friday." eligible. **A name plus a job title is not
 * furniture**, so a sentence that merely identifies someone by role is not this.
 *
 * Measured before it was added, on 1,000 live articles and 3,997 evidence units:
 * **3 matches, all three publisher masthead bylines ("Zack Whittaker is the
 * security editor at TechCrunch." twice, "Tim De Chant is a senior climate
 * reporter at TechCrunch."), 0 legitimate reporting sentences**, with the
 * ruling's own controls held. Case sensitivity is deliberate and the roles carry
 * their own first-letter classes: under the `i` flag `\p{Lu}` is case-folded too,
 * which would let a lowercased sentence open with a name and match.
 */
const PUBLISHER_BYLINE = new RegExp(
  // Three optional words before the role, not two: "a deals and coupon writer at
  // Tom's Hardware" is the same line as "a senior writer at TechCrunch" and was
  // the one measured masthead shape the narrower bound let through.
  String.raw`^\p{Lu}[\p{L}'\u2019.-]+(?:\s+\p{Lu}[\p{L}'\u2019.-]+){0,2}\s+(?:is|are|was)\s+(?:(?:the|a|an)\s+)?(?:\w+\s+){0,3}(?:${PUBLISHER_BYLINE_ROLES})\s+at\s+\p{Lu}[\p{L}'\u2019.&-]*(?:\s+(?:&|and)?\s*\p{Lu}[\p{L}'\u2019.&-]*){0,2}\s*[.!?]?\s*$`,
  "u",
);

/**
 * Whether a candidate sentence is the publication talking about itself or
 * selling something, rather than reporting. Exported so the enrichment pass and
 * the composer both read one rule.
 */
export function publisherFurniture(text: string): boolean {
  return PUBLISHER_FURNITURE.test(text) || PUBLISHER_BYLINE.test(text);
}

/**
 * A solicitation: the publication handing the reader its own address.
 *
 * Structural rather than another phrase to memorise, because a newsroom's
 * contact details are furniture in any wording and the address is the part that
 * gives it away. A briefing never needs to give the reader an inbox, and the
 * fact pipeline already refuses these lines as malformed sentences -- so without
 * this, "Contact" and "Send" enter the entity set from a unit the reader will
 * never see, which is the same scoping defect as "Subscribe" arriving from a
 * paywall prompt.
 */
const PUBLISHER_SOLICITATION =
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|\b(?:news\s?tips?|contact (?:the |our )?(?:editorial )?(?:team|desk|newsroom)|reach (?:us|our) (?:newsroom|editor))\b/i;

/**
 * The publication talking about itself rather than about the news: a paywall
 * prompt, a newsletter sign-off, a byline boast, a credit line, a vendor block,
 * a newsroom address.
 *
 * Deliberately narrower than `editorialNoise`, which also refuses commentary and
 * first-person voice. Screening entity extraction with that predicate took
 * "Richard Schut" out of the entity set -- his sentence carries "tales of woe",
 * which is commentary, and the PWNED fixture is written entirely in it -- and
 * broke surname introduction in production. An entity corpus has to refuse the
 * publisher's furniture, not the publisher's opinion: refusing opinion loses real
 * names, and a missing name is a worse defect than a stray one.
 */
export function publisherSelfReference(text: string): boolean {
  return NOISE.test(text) || publisherFurniture(text) || PUBLISHER_SOLICITATION.test(text);
}

/**
 * A development record reaching a reader as a summary: a commit trailer, or a changelog dump.
 *
 * Measured on the live window (2026-10-15, newest 1,000 complete events) as part of the arbiter's
 * first intervention of that day's ruling, which chose the commit-record class over the
 * punctuation seam because 16 of the 17 welded-label lines reaching readers were development
 * records on cards whose own headline was the commit sha:
 *
 * > Models: drop the t_embd expand of the embedding graphs (#30461) These graphs only produce …
 * > Vulkan: Optimize pool_2d when the pooling window is large (#30119) When the window is larger …
 * > Ggml: Change default visibility of symbols to hidden (#30014) See discussion in #29997.
 * > Assisted-by: Codex.
 *
 * Scoped to the two shapes that are records rather than prose, and no wider. The scope measurement:
 * 35 cards print a summary line on a sha/version headline, 15 of those carry development metadata,
 * and **none of the 15 is refused by any existing path** (`unitTextRejection` null, furniture
 * false, noise false for all 15 -- the shared boundary simply did not know the shape). Origin: the
 * text is the stored event summary, not an extracted unit -- 4 of 15 openings appear in the
 * article excerpt and **0 in `article_evidence`** -- so this belongs at the reader-content
 * boundary, not in extraction.
 *
 * The controls are the point, and they are what keeps this narrow (all measured clean, plus the
 * kernel-policy sentence below, which a loose trailer test refuses and this one does not):
 *
 * - the trailer is **anchored**, because a trailer named inside reporting prose is reporting:
 *   "Currently there is a policy requirement for Linux kernel patches where AI tools contributed,
 *   they should be documented with an Assisted-by: tag, the maintainers said." stays eligible.
 * - a single `#NNNNN` reference is not a record. `(#30461)` alone flags four lines that are
 *   otherwise ordinary sentences, and a reported sentence may cite a pull request, so a dump needs
 *   **two**. The same threshold carries the changelog items.
 * - the measured vocabulary is never the test: "Models", "Vulkan", "Ggml" and "Meta" appear in
 *   legitimate reporting and none of them is matched on its own. "Meta released its first frontier
 *   model, Muse Wonder, on Monday." stays eligible, as do "Google released Chrome 141 on Tuesday,
 *   and its changelog lists 42 security fixes." and "The fix landed in commit 4f2a1b9 and ships in
 *   version 2.4 next month, the maintainer said."
 *
 * No new reason string and no new counter: this rides the existing `editorial_noise` family the
 * reader-content boundary already refuses through, and the established remedy applies unchanged --
 * the card recovers validated published content or withholds the line.
 */
const DEVELOPMENT_TRAILER =
  /^(?:assisted-by|signed-off-by|co-authored-by|co-developed-by|reviewed-by|tested-by|acked-by|reported-by|suggested-by)\s*:/i;
const CHANGELOG_ITEM = /\b(?:chore|test|tests|docs|style|refactor|perf|build|ci|revert)\s*:/gi;
const CHANGELOG_REF = /#\d{3,}/g;

/** Whether a sentence is a commit record or a changelog dump rather than reporting. */
export function developmentRecord(text: string): boolean {
  const trimmed = text.trim();
  if (DEVELOPMENT_TRAILER.test(trimmed)) return true;
  const items = trimmed.match(CHANGELOG_ITEM)?.length ?? 0;
  const refs = trimmed.match(CHANGELOG_REF)?.length ?? 0;
  return items >= 2 || refs >= 2;
}

/**
 * Whether one sentence is prose the reader may be shown.
 *
 * The single definition both reader surfaces ask. The Read page reaches it
 * through `selectReaderEvidence`; the email asks it directly, because an email
 * that assembles its own paragraphs out of raw excerpts otherwise carries its
 * own, weaker idea of what a sentence is -- which is how "Subscribe to The
 * Verge for more", "Principal author Jane Doe has written more than 400
 * articles" and "Contact the editorial team at news@..." reached an inbox while
 * every Read-page counter read zero, and why the same story said "paying
 * subscribers" three times across three paragraphs.
 *
 * Narrower than the entity screen on purpose, and the difference matters. An
 * entity corpus only needs the publisher's furniture gone, because a name can
 * legitimately live in a sentence that is not itself publishable -- the PWNED
 * fixture's "Richard Schut" arrives in a commentary line. A surface that
 * publishes the sentence has to meet the publishable bar instead.
 *
 * `context` is omitted on purpose: it can only add refusals, and this must never
 * drop a sentence the pipeline would keep.
 */
export function admissibleReaderSentence(text: string): boolean {
  return (
    !publisherSelfReference(text) &&
    !developmentRecord(text) &&
    unitTextRejection(text, false) === null
  );
}

/**
 * The source's own subheading, glued to the sentence under it.
 *
 * A research blog writes "Advance warning: The pipeline detected ...", and the
 * extractor concatenates the heading and the paragraph into one unit. The result
 * passes every grammar test -- the label is a noun phrase, the sentence after it
 * is complete -- and reaches the reader as a colon-led fragment: the 2026-10-02
 * Microsoft Research read carried "End-to-end forecasting:", "Physics and
 * place:" and "Advance warning:" as sentence openers, and a vendor blog turned
 * "Define what counts as a paid use" into a subhead.
 *
 * The label is removed rather than the sentence refused, because the sentence
 * under it is the article. Bounded to four words, to a capitalised opener and a
 * capitalised continuation, and to labels that do not end on a reporting verb --
 * "He said: ..." keeps its speaker.
 */
const HEADING_LABEL = /^[A-Z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,3}:\s+(?=[A-Z“"])/;
const REPORTING_LABEL_TAIL =
  /\b(?:said|says|reports?|reported|announced|added|notes?|noted|claimed|argued|wrote|stated|explained|confirmed|warned|told)\b\s*:?\s*$/i;

/**
 * A label that reads like a subheading but is a credit or a metadata field.
 *
 * `HEADING_LABEL` reads "Image credit: Reuters The company declined ..." as a
 * subheading called "Image credit" followed by an article, strips the label, and
 * hands the credit's payload to the reader as the sentence opener -- which is
 * how "Reuters The company declined to say how much the agent costs to run."
 * reached a published paragraph with every quality-gate counter at zero. The
 * unit is not a heading and what follows the colon is not an article: it is a
 * photo credit welded to a real sentence, and the seam between the two is not one
 * this rule is allowed to guess.
 *
 * Left whole on purpose. `publisherFurniture` then refuses the unit, which is
 * the honest outcome -- the reader gets nothing rather than a bare outlet name
 * with no verb -- and it is counted as furniture instead of as the invalid
 * sentence the truncation also makes it.
 */
const CREDIT_LABEL =
  /^(?:image|photo|photograph|illustration|graphic|video|audio|credit|photocredit|imagecredit)\b/i;

export function stripHeadingLabel(text: string): string {
  const match = HEADING_LABEL.exec(text);
  if (!match) return text;
  if (CREDIT_LABEL.test(match[0])) return text;
  if (REPORTING_LABEL_TAIL.test(match[0])) return text;
  const rest = text.slice(match[0].length);
  return rest.length >= MIN_SENTENCE_CHARS ? rest : text;
}
const VOICE =
  /\b(?:we|we['’](?:ve|re|ll|d)|our|ours|you|your|as I remember|i|i['’](?:ve|m|ll|d)|me|my|mine|myself)\b/i;
const COMMENTARY =
  /\b(?:tales of woe|gaping hole|so swimmingly|popularity is undeniable|likely a contributing factor|more important changes are less|make so many enemies|gaining ground fast|winning supporters and boosters|just in case there was|eye[- ]popping|alarming valuations?|all[- ]encompassing|world away from|remember how to be|older,? less attractive)\b|^Even if\b|^[^.!?]{1,45},[^.!?]{1,45}\sThe problem\b/i;
/**
 * Openings whose subject is not in the sentence.
 *
 * Every entry here is a *test*, not a repair: a sentence that begins with one of
 * these pronouns has its subject in another sentence, and whether that other
 * sentence is published -- let alone published next to it -- is decided later by
 * paragraph assembly. `they were also commandeering a German website` and `Both
 * saw agents make their way onto the open internet` are the production failures
 * this exists for: both passed every other check, because grammar is not the
 * problem, the missing antecedent is.
 */
const PRONOUN_SUBJECT_OPENING =
  /^(?:this|that|these|those|those\b|it|they|he|she|them|him|her|its|their|theirs|both|such|others|neither|the former|the latter|the result|the move|the change|the figure|most of them|some of them|many of them|all of them|each of them|using the same|use the same)\b/i;

/**
 * A demonstrative that heads a possessive noun is a determiner, not a pronoun.
 *
 * `This week's Stratechery video is on Frontier Overhangs.` has its subject in
 * the sentence -- the video -- and `this week` needs no antecedent: it is a
 * deictic, read against the story's own date, which is the same reading the
 * relative-time rules keep for `today's AI` and `this year's budget`. Before
 * this test the sentence was refused as a context-dependent opening, because
 * `PRONOUN_SUBJECT_OPENING` reads the first word only.
 *
 * The clitic is the mark, which is why it is the test rather than a list of
 * nouns that may follow `this`: the shape is *structural*, and it is the one
 * the subject logic can observe without guessing at grammar. A demonstrative
 * without one is untouched -- `This was announced on Tuesday.` and `These
 * results show the trend.` still belong to the class whose referent is a
 * sentence the reader may not have read.
 */
const POSSESSIVE_DETERMINER_OPENING = /^(?:this|that|these|those)\s+\S*['’]s?(?=\s|[.,;:!?)]|$)/i;

/**
 * The subset a mechanical rewrite can actually repair: an opening pronoun that
 * stands for the subject of the sentence before it.
 *
 * Deliberately tiny. `It` and `Its` are replaced by that subject ("Its policy
 * changed" -> "DigiCert's policy changed"), which is a substitution rather than a
 * guess. Everything else in the list above needs a noun phrase that the source
 * does not supply, and inventing one is how a sentence ends up attributing an
 * action to the wrong actor.
 */
const RECOVERABLE_OPENING = /^(?:it|its|the figure|that figure)\b/i;

/**
 * A demonstrative whose head is the document the reader is already holding.
 *
 * `This report presents ...`, `This paper investigates ...` -- the head is the page
 * itself, which the reader has open, so the reference is resolved by the act of
 * reading rather than by a sentence that may not be there. It is the same shape
 * `POSSESSIVE_DETERMINER_OPENING` records below, and for the same reason.
 *
 * It lives in the evidence layer, and not with the deck rule that first needed it,
 * because both the rule and the measurement have to mean the same thing by
 * "unresolved context". The arbiter's ruling of 2026-10-11 accepted exactly that
 * (option (a) of the D2 closure): a diagnostic that stays knowingly broader than the
 * rule it measures stops being able to tell a real defect from a research abstract
 * convention.
 *
 * Deliberately only the document's own words. `This monitor is compatible ...` is
 * not self-reference -- the monitor is named in another sentence -- so it stays in
 * the class whose referent the page may not carry. And the list of document nouns is
 * not a general exemption for sentences that merely mention a paper, a report or a
 * study: the demonstrative has to head the document noun itself.
 */
export const SELF_REFERENTIAL_DOCUMENT_OPENING =
  /^(?:this|that)\s+(?:report|paper|study|analysis|article|work|research|survey|review|briefing|piece|post|essay|chapter|section|note|document)\b/i;

/**
 * Openings that need a reference this source never supplies, and cannot be
 * written around.
 *
 * `Both` is the production case: "Both saw agents make their way onto the open
 * internet when they shouldn't." Two referents are implied and neither is named,
 * so no substitution is available -- and unlike `they`, whose antecedent can be
 * the sentence immediately before it on the page, `both` cannot be resolved by
 * adjacency either, because the sentence does not say what the pair is. Refused
 * wherever it appears.
 */
const MULTI_REFERENT_OPENING =
  /^(?:both|the former|the latter|such|others|neither|each of them|most of them|some of them|many of them|all of them|the two|both of them)\b/i;

/**
 * A fronted clause whose main clause opens with a bare pronoun: "While everyone
 * else was on vacation this summer, they were also commandeering a German
 * website." "Tasked with solving some challenges on a benchmark, they worked out
 * how to communicate."
 *
 * The clause itself is grammatical, which is why nothing caught it: `hasPredicate`
 * is satisfied, the sentence is long enough, and there is no metadata in it. The
 * subject of the main clause is simply not there. This is the mirror image of
 * `PRONOUN_SUBJECT_OPENING`, for the case where the pronoun sits after a fronted
 * participle or subordinator rather than at position zero.
 */
const FRONTED_CLAUSE_PRONOUN =
  /^((?:[A-Z][\p{L}'’-]*(?:ed|ing)\b|While|When|After|Before|Once|As|Because|Although|If|Since|Despite|Having)[^,]{0,90}),\s*(?:they|he|she|it|both|these|those|this|them)\b/iu;

/** A capitalised word past position zero: a name, not a sentence opening. */
const NAMED_ACTOR = /[A-Z][a-z]{2,}/;

/**
 * A fronted clause whose main-clause subject is a pronoun and which names nobody.
 *
 * The name test is what keeps this from eating real reporting: "After Schut and
 * his colleagues discovered the security vulnerability, he immediately restricted
 * access to the staging environment" carries its antecedent inside its own first
 * clause, so the `he` is fine. "While everyone else was on vacation this summer,
 * they were also commandeering a German website" does not, and neither does
 * "Tasked with solving some challenges on an internal security benchmark, they
 * worked out how to communicate" -- in both, the subject of the main clause is a
 * pronoun pointing outside the sentence, and nothing in the sentence says at what.
 */
function frontedClauseNeedsContext(text: string): boolean {
  const match = FRONTED_CLAUSE_PRONOUN.exec(text.trim());
  if (!match) return false;
  const clause = match[1] ?? "";
  return !NAMED_ACTOR.test(clause.slice(1));
}

/**
 * Remove a small, explicitly editorial set of modifiers without rewriting the
 * underlying proposition. Rhetorical sentences are still rejected when their
 * factual content cannot stand alone; this only helps when a clean claim is
 * already present in the sentence.
 */
export function normalizeEvidenceText(text: string): string {
  return (
    text
      .replace(/\bthat makes a [^,]+ remember how to be a [^,]+/gi, "")
      .replace(/\bworld away from\b/gi, "different from")
      .replace(/\beye[- ]popping\s+/gi, "")
      .replace(/\balarming\s+(?=(?:valuations?|investments?|figures?)\b)/gi, "")
      .replace(/\ball[- ]encompassing\s+/gi, "")
      .replace(/\bolder,?\s+less attractive\s+/gi, "older ")
      // A space before a possessive is never English, and on the delivered
      // 2026-10-20 card 06 it was ours: the source's excerpt reads
      // `(BSC)’s`, the extracted unit reads `(BSC) ’s`. Joining it changes no
      // word — it removes a space the extractor put inside one — so this is the
      // same punctuation normalisation as the spaced product name of ruling
      // #19, not the source repair ruling #6 forbids.
      .replace(/\s+([’'](?:s|t|re|ve|ll|d|m)\b)/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * A connector in front of a pronoun does not make the pronoun resolvable.
 *
 * `However, they also rely on several smaller manufacturers ...` was live on
 * 2026-10-17 in the only story that reader's briefing carried, and it was not
 * caught because the ruler read position zero only: the sentence opens on
 * `However`, so the pronoun sits one word later and every test passed. The
 * connector is exactly the word that promises the reader a contrast with
 * something already said, which is why the miss matters -- the reference is
 * load-bearing, not decorative.
 */
const CONNECTOR_PRONOUN_OPENING =
  /^(?:However|But|And|Still|Yet|So|Instead|Meanwhile|Also|Now|Then|Today|Yesterday|This week|That said|Even so|As a result|In addition)[,;]?\s+(?:they|them|their|it|its|this|these|those|he|she|him|her|both)\b/i;

/**
 * A reference the sentence itself cannot supply, whose head the headline must
 * establish.
 *
 * The first of the two classes arbiter ruling #17 (2026-10-20) added, and the
 * measured one: the delivered 2026-10-19 briefing opened card 02 on *"None of
 * them were particularly impressive by themselves"* and card 16 on *"The authors
 * were looking at it wrong"*. `contextDependent` had no class for either —
 * `None of them` is not a pronoun subject, and `The authors` is a definite noun
 * phrase — so `unresolvedContextOpening` returned **false for all 25 delivered
 * lines**, including all four of that briefing's dangling openings.
 *
 * Both halves are closed sets, because this is a reference test and not a noun
 * test: a quantified `X of them` and the person-groups whose identity lives
 * outside the sentence. A definite noun phrase with a content head (`The
 * Department of Homeland Security`, `The Prometheus supercluster`) is what the
 * rule must leave alone, and it does.
 */
const QUANTIFIED_REFERENCE_OPENING =
  /^(?:none|neither|either|some|most|many|all|few|several|both)\s+of\s+(?:them|these|those|which|whom)\b/i;

/** `The authors`, `The researchers`, `These scientists`: people the card never names. */
const PERSON_GROUP_OPENING = /^(?:the|these|those)\s+(?:authors?|researchers?|scientists?)\b/i;

/**
 * Whether the headline already establishes the person group the opening leans on.
 *
 * `The authors were looking at it wrong` is a defect against a headline that
 * names nobody, and is ordinary prose against a headline that says the paper has
 * authors. The words that establish the group are the ones a paper's own title
 * uses to say so; nothing here guesses at a person's name.
 */
function titleEstablishesGroup(title: string | null | undefined): boolean {
  if (title === null || title === undefined) return false;
  return /\b(?:authors?|researchers?|scientists?|study|paper|report|survey|team)\b/i.test(title);
}

function bareReferenceOpening(text: string, title: string | null | undefined): boolean {
  if (QUANTIFIED_REFERENCE_OPENING.test(text)) return true;
  return PERSON_GROUP_OPENING.test(text) && !titleEstablishesGroup(title);
}

/**
 * The second class: an acronym the opening's reader has no way to expand.
 *
 * Card 01 of the delivered briefing opened *"The EBU and NVIDIA are expanding
 * the sovereign standards …"* against a headline that says *European Public
 * Service Broadcasting*, which is not the acronym's expansion (`EBU` is the
 * European Broadcasting Union). The test is deliberately about the **subject
 * head**: an acronym followed by a capitalised word is a modifier of a named
 * body (`The US Treasury`, `The UK government`), which is readable without an
 * expansion, while a bare acronym standing as the subject is not.
 *
 * Three ways an opening establishes it, and no fourth: the headline carries the
 * same token (case-insensitively, so `NVIDIA` meets `Nvidia`); the opening
 * expands it (`European Broadcasting Union (EBU)` or `EBU (European Broadcasting
 * Union)`); or the acronym modifies a named body in the same subject. Anything
 * else is the class. Two-letter tokens are excluded on purpose — `AI`, `US`,
 * `UK`, `EU`, `UN` are modifiers every reader already holds, and the measured
 * class is three letters or longer.
 */
const SUBJECT_ACRONYM = /^(?:(?:The|A|An)\s+)?([A-Z][A-Z0-9]{2,5})(?![\p{L}\p{N}])/u;

/** The initials a parenthetical expansion spells. */
function initialsOf(phrase: string): string {
  return (phrase.match(/\b[\p{L}]/gu) ?? []).join("").toUpperCase().slice(0, 6);
}

function acronymExpandedInOpening(text: string, acronym: string): boolean {
  for (const match of text.matchAll(/\(([^()]{3,90})\)/g)) {
    const inner = match[1] ?? "";
    const before = text.slice(0, match.index ?? 0).trimEnd();
    const head = before.match(/([\p{Lu}][\p{L}-]*(?:\s+[\p{Lu}][\p{L}-]*){0,5})$/u)?.[1] ?? "";
    if (initialsOf(inner) === acronym || initialsOf(head) === acronym) return true;
  }
  return false;
}

function unexpandedAcronymOpening(text: string, title: string | null | undefined): boolean {
  const match = SUBJECT_ACRONYM.exec(text);
  if (match === null) return false;
  const acronym = match[1] ?? "";
  const after = text.slice(match[0].length).trimStart();
  // A capitalised word after the acronym names the body it modifies.
  if (/^[\p{Lu}]/u.test(after)) return false;
  if (acronymExpandedInOpening(text, acronym)) return false;
  if (title !== null && title !== undefined) {
    const token = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${token}\\b`, "i").test(title)) return false;
  }
  return true;
}

/**
 * Whether the sentence needs a subject from somewhere else to be readable.
 *
 * `title` is the card's own material, not the page's: ruling #17 (2026-10-20)
 * widened the test with exactly two classes — a bare definite or quantified
 * reference whose head the title does not establish, and an acronym neither the
 * title nor the opening expands. Callers that do not have the title get the
 * stricter answer, which is the one a delivered line has to satisfy on its own.
 */
export function contextDependent(text: string, title?: string | null): boolean {
  const trimmed = text.trim();
  return (
    (PRONOUN_SUBJECT_OPENING.test(trimmed) && !POSSESSIVE_DETERMINER_OPENING.test(trimmed)) ||
    CONNECTOR_PRONOUN_OPENING.test(trimmed) ||
    frontedClauseNeedsContext(trimmed) ||
    /\bthe figure\b/i.test(trimmed) ||
    bareReferenceOpening(trimmed, title) ||
    unexpandedAcronymOpening(trimmed, title)
  );
}

/**
 * Whether the missing subject cannot be supplied by any ordering of the page.
 *
 * This is the hard class, and the quality gate refuses it wherever it appears.
 * The softer class -- `they`, `this`, `these`, `that` -- is decided by the
 * composer instead, because its answer depends on what is published next to it:
 * an abstract read forwards really does have its antecedent on the page, and a
 * ranked news paragraph really does not. Refusing both classes everywhere is how
 * a paper's own anaphora used to disappear from its own article.
 */
export function unresolvableContext(text: string): boolean {
  const trimmed = text.trim();
  return MULTI_REFERENT_OPENING.test(trimmed) || frontedClauseNeedsContext(trimmed);
}

/**
 * Whether the missing subject can be restored from the sentence before it.
 *
 * The composer and the quality gate both read this: everything that is
 * context-dependent but not recoverable is refused rather than published with a
 * pronoun pointing at nothing. Failing safely means a shorter article, and a
 * shorter article is better than one that says `they` about nobody.
 */
export function recoverableContext(text: string): boolean {
  return RECOVERABLE_OPENING.test(text.trim());
}

/**
 * Whether the sentence before this one actually supplies its opening reference.
 *
 * The composer restores source adjacency for a ranked fact that opens on a
 * reference, and the arbiter's ruling #4 (2026-10-17) put one condition on it in
 * as many words: "Mere sentence adjacency is necessary for this repair but is
 * not, by itself, proof of semantic resolution."
 *
 * So the repair asks the predecessor for evidence, not for proximity. What can be
 * proven deterministically is agreement: a plural reference (`they`, `their`,
 * `these`, `those`, `both`) is supplied by a plural noun phrase in the sentence
 * before it -- "Major Taiwanese companies are more than capable ... However, they
 * also rely on ..." resolves, while "The organization is headed up by Trump ally
 * and diplomat Ric Grenell. She is married to film producer Tyler Zacharia."
 * does not, and neither does a dummy subject: "There were two further explosions
 * ... He argued that ..." has no person in it to be `he`.
 *
 * Everything else is refused rather than guessed. A singular animate reference
 * needs a person, and telling a person from a company, a product or a place is
 * the one thing this layer cannot do without a model -- so `he`, `she`, `it` and a
 * bare `this` keep the refusal they have today, and the class is recorded for a
 * later ruling rather than smuggled through on adjacency alone.
 */
export function antecedentSupplied(dependent: string, predecessor: string): boolean {
  const opening =
    /^(?:(?:However|But|And|Still|Yet|So|Instead|Meanwhile|Also|Now|Then|Today|Yesterday|This week|That said|Even so|As a result|In addition)[,;]?\s+)?([\p{L}]+)(?:\s+(?:new\s+)?([\p{L}]+))?/u.exec(
      dependent.trim(),
    );
  const head = (opening?.[1] ?? "").toLowerCase();
  // `they`, `their`, `both`: a plural reference, so a plural noun phrase in the
  // sentence before it supplies it. "Major Taiwanese companies are more than
  // capable ... However, they also rely on ..." resolves; "The organization is
  // headed up by ... Ric Grenell. She is married to ..." never could.
  if (PLURAL_PRONOUN_OPENING.has(head)) return pluralNounPhrase(predecessor);
  // `this`/`these`/`those` + noun is the weaker case, and the noun is the
  // evidence: "Those turbines are often used by utilities" is supplied by a
  // sentence that has turbines in it, while "These price increases have been
  // caused by the boom" is not supplied by "PC shipments fell 20.1% in the third
  // quarter" -- which is how that sentence used to open a page about prices it
  // never mentioned.
  if (!DEMONSTRATIVE_OPENING.has(head)) return false;
  const noun = (opening?.[2] ?? "").toLowerCase();
  if (noun === "" || NOT_A_REFERENT.has(noun)) return false;
  return mentionsNoun(predecessor, noun);
}

/**
 * Openings whose referent has to be plural, so agreement can decide them.
 *
 * `it`/`its` is absent on purpose: `recoverableContext` already repairs those by
 * substitution, and the two rules must not overlap.
 */
const PLURAL_PRONOUN_OPENING = new Set(["they", "them", "their", "theirs", "both"]);

/** Demonstratives that head a noun rather than standing for a sentence. */
const DEMONSTRATIVE_OPENING = new Set(["this", "these", "those", "that"]);

/** Words that follow a demonstrative without naming anything. */
const NOT_A_REFERENT = new Set(
  "is was were are be been being has have had will would can could may might must also not no then now year years week weeks month months day days way ways time times one ones kind sort thing things".split(
    " ",
  ),
);

/**
 * Whether a body sentence may open on this reference, given what the page has
 * already published above it.
 *
 * The arbiter's ruling #7 (2026-10-17, Q2, option 1): the deck and every earlier
 * published paragraph are the reader's context, and a body block that opens on a
 * reference the page never establishes is a sentence the story cannot keep. Read
 * at the composer, on the page's own order, so it is the same question the
 * reader's eye asks.
 *
 * Measured on the live 250-event pool the day it was ruled: **8 of 1,049
 * published blocks** opened on a dependent reference with nothing on the page to
 * resolve it -- `That maneuver needed specialized hardware ...`, `Those in need
 * get financial aid for their care.`, `These constitute non-delivery scams ...`,
 * `This follows an investigation ...`, `This largely fizzled out ...`, `The result
 * is that Brave users ...`, `This was followed by Open Source Security ...`, and
 * the document opening below. Each published block that keeps its sentence does
 * so on this test, not on the composer's own opinion of it.
 *
 * Conservative by construction, because refusing a readable sentence costs a
 * fact: only the two shapes the rules already name (`contextDependent` openings
 * and a document opening) are ever asked about, a plural or a named noun
 * anywhere above is enough to keep the sentence, and a sentence that carries no
 * reference at all is never asked about in the first place.
 *
 * The referent kinds this rule can answer are the ones `pageReferentKind` names.
 * A singular pronoun is deliberately not one of them: the first measured run
 * (250 events, 2026-10-17) refused *"He created celld as an implementation that
 * could be hosted anywhere ..."* and *"However, it also stated, 'Our long-term
 * objective is ...'"*, both readable, because the page test knew only how to look
 * for a plural noun. A rule that cannot answer a question of its own making must
 * not take a fact for it, so an opening outside the judged kinds counts as
 * established here -- and the composer never asks about it at all.
 */
export function openingEstablishedOnPage(opening: string, page: string): boolean {
  const text = page.trim();
  const kind = pageReferentKind(opening);
  if (kind === null) return true;
  if (text === "") return false;
  if (kind.kind === "document") {
    // "The document, titled Analysis of Ukraine's Energy ... does not specify
    // which Russian agency developed the assessment" names its own referent, so
    // it is readable wherever it is published; the live NTT block (`The report
    // models three growth trajectories ...`) does not, and nothing above it on
    // the page names a report either.
    return mentionsNoun(text, kind.noun) || NAMES_ITS_OWN_DOCUMENT.test(opening);
  }
  if (kind.kind === "plural") return pageNamesAPlural(text);
  // A demonstrative that no noun follows is the defect: `Those in need get
  // financial aid for their care.` asks the page for a group it never named, and
  // reading `in` as the noun would answer with a preposition every page contains.
  if (kind.noun === "" || NOT_A_REFERENT.has(kind.noun) || PAGE_TESTS_FOR_A_NOUN.has(kind.noun))
    return false;
  return mentionsNoun(text, kind.noun);
}

/**
 * The reference kind an opening can be judged on, or null when this rule cannot
 * answer for it.
 *
 * Exported so the composer asks exactly the questions the page test can answer.
 * Three kinds and no more: a plural pronoun (agreement decides it), a
 * demonstrative that heads a noun (the noun is the evidence), and the article's
 * own document (the page either names a report or it does not). A singular
 * pronoun is resolved by the narrator rules, not here.
 */
export function pageReferentKind(
  opening: string,
): { kind: "plural" } | { kind: "demonstrative" | "document"; noun: string } | null {
  const document = documentOpening(opening);
  if (document) return { kind: "document", noun: document };
  const match = OPENING_REFERENT.exec(opening.trim());
  const head = (match?.[1] ?? "").toLowerCase();
  if (PLURAL_PRONOUN_OPENING.has(head)) return { kind: "plural" };
  if (!DEMONSTRATIVE_OPENING.has(head)) return null;
  // The noun may be a function word (`Those in need`); that is the caller's
  // refusal to make, not an absence of a question.
  return { kind: "demonstrative", noun: (match?.[2] ?? "").toLowerCase() };
}

/**
 * Words after a demonstrative that cannot be the noun it points at.
 *
 * `Those in need get financial aid for their care.` was live on 2026-10-17, and
 * without this set the referent reads as `in` -- which every page contains, so
 * the sentence would have kept its place on evidence that says nothing. The
 * prepositions, the particles and the copulas: what is left after them is either
 * a real noun or the sentence is asking for a reference it does not name.
 */
const PAGE_TESTS_FOR_A_NOUN = new Set(
  "in on at of to for with by from as into over under during after before since until about against between through without within across behind beyond who which that what".split(
    " ",
  ),
);

/**
 * The reference a block-opening sentence starts on, as the antecedent rules read
 * it: the head word, then the noun that follows a demonstrative.
 */
const OPENING_REFERENT = /^([\p{L}]+)(?:\s+(?:new\s+)?([\p{L}]+))?/u;

/**
 * A body block that opens on the article's own document: `The report models ...`.
 *
 * The class is narrower than "a definite noun phrase", which was measured first
 * and rejected: 20 of 816 published blocks open on one whose noun the page never
 * repeats (`The release is currently in public preview ...`, `The device also
 * includes physical buttons ...`, `The company's selection of India's Skyroot
 * ...`), and every one of those is readable -- the noun is the paragraph's own
 * subject. The measured document class is 2 of 816: the NTT block above, and one
 * that names its document in an appositive and is therefore readable.
 */
const DOCUMENT_OPENING =
  /^The\s+(report|study|survey|analysis|filing|paper|document|letter|memo|assessment|review|index|forecast|brief)\b/i;

/** `The document, titled Analysis of Ukraine's Energy ...` -- self-establishing. */
const NAMES_ITS_OWN_DOCUMENT =
  /,\s*(?:which\s+)?(?:is\s+|was\s+)?(?:titled|published|released|dated|written|prepared|tabled|seen|obtained|issued)\b/i;

/** The document noun this sentence opens on, or null. */
export function documentOpening(text: string): string | null {
  const match = DOCUMENT_OPENING.exec(text.trim());
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * Whether the page names a plural noun anywhere above.
 *
 * Deliberately the weaker of the two plural tests in this file. The subject test
 * (`pluralNounPhrase`) answers "does this sentence continue that group", which is
 * the right question for admitting a *new* sentence behind a predecessor and the
 * wrong one for the page: a page whose second paragraph already reads "Major
 * Taiwanese companies are ... However, they also rely on ..." has supplied the
 * group, and the sentence right behind it must not be refused for want of the
 * same phrase again.
 */
function pageNamesAPlural(page: string): boolean {
  for (const token of page.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
    const word = token.replace(/['’]s$/u, "").replace(/[’'-]s$/u, "s");
    if (!/[a-z]s$/u.test(word) || word.length < 4 || word.endsWith("ss")) continue;
    if (NOT_PLURAL.has(word.toLowerCase())) continue;
    return true;
  }
  return false;
}

/**
 * Whether a sentence names the noun, singular or plural.
 *
 * Crude stemming on one axis only -- a trailing `s`/`es`/`ies` -- because the
 * two sentences are the author's own and the question is whether the reader has
 * met the word at all, not whether the grammar agrees.
 */
function mentionsNoun(text: string, noun: string): boolean {
  const stem = (word: string) => word.replace(/ies$/u, "y").replace(/(?:es|s)$/u, "");
  const wanted = stem(noun);
  for (const token of text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
    if (token === noun || stem(token) === wanted) return true;
  }
  return false;
}

/** Words ending in `s` that are not plural nouns. */
const NOT_PLURAL = new Set(
  "this these those was has is as his its us thus less business class glass status campus across plus versus analysis basis crisis press process address access success congress mass gas news series terms says according".split(
    " ",
  ),
);

/**
 * Whether a sentence names a group in its own subject: a plural noun phrase,
 * however it is spelled.
 *
 * A lower-case plural ("companies", "officials") or a capitalised one ("United
 * States", "Ghost Security") both count: an organisation is a `they` like a crowd
 * is. What does *not* count is a plural anywhere in the sentence. Prose continues
 * its subject -- "Major Taiwanese companies are ... However, they also rely on
 * ..." -- and the first attempt at this guard, which accepted any word ending in
 * `s`, republished two sentences on evidence that was not there: "They then
 * debate the merits ..." behind "What gives here?", and "Their listing for the
 * WhatsApp impostor ..." behind a sentence whose only plural nouns were
 * `reviews` and `users`. Both read as dangling references to the live reader.
 * So the group has to be named before the predecessor's own first verb.
 */
function pluralNounPhrase(text: string): boolean {
  const words = (text.match(/[\p{L}][\p{L}'’-]*/gu) ?? []).map((token) =>
    token.replace(/['’]s$/u, "").replace(/[’'-]s$/u, "s"),
  );
  // A sentence that opens on the pronoun continues the previous subject, so the
  // chain is explicit rather than inferred ("They come after the company ...").
  if (PLURAL_PRONOUN_OPENING.has((words[0] ?? "").toLowerCase())) return true;
  // Quoted words are the speaker's, not the narrative's: the plural inside
  // "The morphology of these 13 tools is impossible ..." is not the subject the
  // next sentence continues, and reading `They found spears` against it is how a
  // quotation became a false antecedent in the frozen replay.
  if (/^["'“‘]/u.test(text.trim())) return false;
  const finite = words.findIndex((word) => finiteVerb(word));
  // No recognisable verb means no recognisable subject; refuse rather than let
  // the whole sentence stand in for one ("France saw ... in years last October"
  // read as an antecedent for `They used an angle-grinder`).
  if (finite < 0 || finite > 8) return false;
  const subject = words.slice(0, finite);
  for (const word of subject) {
    if (!/[a-z]s$/u.test(word)) continue;
    if (word.length < 4 || word.endsWith("ss")) continue;
    if (NOT_PLURAL.has(word.toLowerCase())) continue;
    return true;
  }
  return false;
}

/**
 * Common finite verb forms, used only to find where a sentence's subject ends.
 *
 * The list is deliberately broad rather than clever: a missing verb makes the
 * subject longer, which is the unsafe direction for this guard, so everyday
 * reporting verbs and their past and third-person forms all belong here.
 */
const FINITE_VERBS = new Set(
  `is are was were be been being has have had do does did will would can could may might must
  should shall says say said saw see seen tells tell told reports report reported writes write wrote
  announces announce announced issues issue issued points point pointed gives give gave
  shows show showed finds find found uses use used opens open opened steals steal stole
  breaks break broke takes take took launches launch launched makes make made calls call
  called adds add added notes note noted claims claim claimed warns warn warned plans plan
  planned expects expect expected becomes become became remains remain remained includes
  include included offers offer offered faces face faced agrees agree agreed approves
  approve approved rejects reject rejected wins win won loses lose lost hits hit keeps
  keep kept puts put sets set leads lead led leaves leave left rises rise rose falls fall
  fell grows grow grew cuts cut pays pay paid sells sell sold buys buy bought sends send
  sent builds build built creates create created forms form formed joins join joined
  moves move moved turns turn turned holds hold held brings bring brought begins begin
  began ends end ended continues continue continued returns return returned follows
  follow followed allows allow allowed needs need needed wants want wanted hopes hope
  hoped tries try tried asks ask asked believes believe believed considers consider
  considered decides decide decided describes describe described develops develop
  developed dies die died drives drive drove eats eat ate explains explain explained
  feels feel felt fights fight fought fills fill filled focuses focus focused happens
  happen happened hears hear heard hopes hope hoped increases increase increased
  indicates indicate indicated kills kill killed knows know knew lands land landed
  lives live lived loves love loved meets meet met mentions mention mentioned occurs
  occur occurred produces produce produced provides provide provided raises raise
  raised records record recorded releases release released remembers remember remembered
  reveals reveal revealed runs run ran saves save saved seems seem seemed shoots shoot
  shot spends spend spent suggests suggest suggested supports support supported survives
  survive survived wears wear wore worries worry worried carries carry carried
  published publishes elected elect appointed appoint arrested arrest charged charge
  convicted convict sentenced sentence jailed jail freed free rescued rescue detained
  detain raided raid seized seize sued sue fired hire hired blocked block banned ban
  signed sign passed pass approved refused refuse resigned resign quit stepped step
  struck strike attacked attack killed die died survived survive shot shoot`.split(" "),
);

/** Whether the token is the finite verb that ends the subject. */
function finiteVerb(word: string): boolean {
  const lower = word.toLowerCase();
  if (FINITE_VERBS.has(lower)) return true;
  // A past participle used as a verb (`published`, `released`) ends the subject
  // phrase all the same; `-ing` forms are participles, never finite on their own.
  return /(?:ed|'d)$/u.test(lower) && lower.length >= 5 && !NOT_A_PAST_PARTICIPLE.has(lower);
}

/** Past participles that are far more often adjectives inside a subject. */
const NOT_A_PAST_PARTICIPLE = new Set(
  "united divided advanced detailed limited noted retired armed aged beloved concerned involved supposed regarded".split(
    " ",
  ),
);

/**
 * A sentence that would publish an unresolvable pronoun.
 *
 * Exported because the audit script counts it on the *published* prose: a gate
 * that no longer produces these is only proven by reading what came out, not by
 * trusting the counter that refused them.
 */
export function unresolvedContextOpening(text: string, title?: string | null): boolean {
  const trimmed = text.trim();
  // One definition, shared with the deck rule: a demonstrative that heads the
  // document the reader is holding is resolved by reading, not by context.
  if (SELF_REFERENTIAL_DOCUMENT_OPENING.test(trimmed)) return false;
  // A quotation that starts mid-way cannot open a page however well the page
  // establishes its nouns: the reader is handed the second half of somebody's
  // sentence (ruling #17's family, measured on the delivered card 24 of
  // 2026-10-20). `quotationCarriesOpening` is the other half of the same
  // question and stays where it is: a sentence may *open* on a quotation and be
  // legal as a fallback, but it may not *start inside* one.
  if (brokenQuotation(trimmed)) return true;
  return contextDependent(trimmed, title) && !recoverableContext(trimmed);
}

/**
 * Whether a sentence's payload is somebody's quotation rather than a report.
 *
 * Ruling #10a (2026-10-18) made a report outrank a quotation at the deck, and
 * the delivered 2026-10-19 card 20 shows the class it missed: *"Security outfit
 * Huntress offered a starker view and wrote "A Microsoft 365 credential (API
 * secret) belonging to ConnectWise Cloud Backup has been compromised …""* — a
 * sentence whose first character is a name, not a quotation mark, and whose
 * substance is still the quotation. Ruling #19 (2026-10-20) names that card as
 * one the quote rule has to catch.
 *
 * Two shapes, both literal and both cheap: a sentence that opens on a quotation
 * mark (`OPENS_ON_QUOTE`, the class #10a already had), and one that hands the
 * reader a long quotation through a speech verb (`wrote`, `said`, `stated` …).
 * The length floor is what keeps an epithet -- `called the deal "deeply
 * flawed"` -- from being read as the sentence's payload.
 */
const SPEECH_VERB_QUOTE =
  /\b(?:said|says|wrote|writes|stated|states|added|adds|noted|notes|argued|argues|claimed|claims|explained|explains|reported|reports|told|tells)\b[^.!?]{0,40}["“][^"”]{40,}/i;

export function quotationCarriesOpening(text: string): boolean {
  const trimmed = text.trim();
  return OPENS_ON_QUOTE.test(trimmed) || SPEECH_VERB_QUOTE.test(trimmed);
}

/** Quoted speech belongs to its speaker, not the publication. */
export function publisherVoice(text: string): boolean {
  const unquoted = text.replace(/"[^"\n]*"|“[^”\n]*”/g, "");
  return VOICE.test(unquoted);
}

export function editorialNoise(text: string): boolean {
  return (
    NOISE.test(text) ||
    publisherVoice(text) ||
    COMMENTARY.test(text) ||
    SOURCE_COLOUR.test(text) ||
    publisherFurniture(text) ||
    sourceTypo(text) ||
    truncatedDateline(text) ||
    sourcingNote(text)
  );
}

/**
 * A source's own typo that puts a pronoun-noun in a verb slot.
 *
 * Live, 2026-10-17, read on the product as the reader receives it (the Taiwan
 * industrial-park story): *"Nvidia CEO Jensen Huang has even recognized some of
 * these companies in a keynote in Taipei earlier in 2026, nothing the crucial
 * part that these smaller companies play in the global AI supply chain."* The
 * word is `noting`, and Tom's Hardware's own page says `nothing` too (fetched
 * 2026-10-17), so this is the source's typo published verbatim -- not an
 * extraction error, and not something the composer introduced.
 *
 * The arbiter's ruling #6 (2026-10-17, option 1) is: refuse the sentence at the
 * composer gate as `editorial_noise`, do not repair it (`noting` would be
 * rewriting the source's word without a correction policy), and do not widen the
 * pattern into a grammar or typo-correction rule. Measured the same day on the
 * frozen live corpus, 250 events through the production composer: 3,871 stored
 * sentences -> 2 matches (that one sentence, in the source excerpt and its
 * enriched unit); 2,219 published sentences -> 1 match, that sentence.
 *
 * The pattern is the second draft on purpose. The first -- `nothing` followed by
 * a determiner -- matched the ruling's own control, *"There is nothing the
 * company can do about the export controls."*, which is grammatical. The `...
 * that` tail is what the malformed sentence has and the grammatical one does not:
 * with it the class is 1 published match and 0 false positives over the same
 * corpus, and the three controls (that one, *"Using anything that might attract
 * copyright lawyers is also out."*, *"The report said nothing about the delay."*)
 * stay eligible.
 */
export function sourceTypo(text: string): boolean {
  return (
    /\bnothing\s+(?:the|a|an)\s+(?:\w+\s+){0,2}that\b/iu.test(text) ||
    // Ruling #19 (2026-10-20): `ot` is the source's typo in the delivered
    // 2026-10-19 card 03 — *"the agents had attempted ot break into"* — and
    // ruling #6's precedent applies: the sentence is refused, not repaired,
    // because rewriting the source's word is a correction the product has no
    // policy for. Lowercase `ot` standing alone before another word is the
    // shape; `OT` (operational technology) keeps its capitals and is untouched,
    // and `other`, `nothing` and `robot` never match because the token has to
    // be whole.
    /\bot\s+[a-z]/.test(text) ||
    // The delivered 2026-10-20 deck, card 11: *"closed an $150 million Series A
    // round"*. The article is wrong before a spoken number that starts with a
    // consonant sound, and the rule reads the number rather than a dictionary:
    // `an $8 million`, `an $11 billion` and `an $18 million` are correct and
    // keep their sentence; `an $80`, `an $800`, `an $11,000` start with eight,
    // eleven or eighteen and are correct too. Anything else is refused, not
    // repaired, on ruling #6's precedent.
    wrongArticleBeforeAmount(text) ||
    // Card 24 of the same deck carries *"Physical AI is in it's LEGO era"* in
    // the headline. `it's` after a preposition can only be the possessive — "in
    // it is", "at it has" are not sentences — so the token is a typo wherever
    // it appears. Refused, not corrected.
    /\b(?:in|on|at|of|for|with|from|to|by|into|onto|over|under|about|after|before|during|across|through|within|without)\s+it['’]s\b/iu.test(
      text,
    )
  );
}

/**
 * Whether an amount takes `a` rather than `an`.
 *
 * The spoken form decides, and only its first sound: a number that begins with
 * eight, eleven or eighteen takes `an`; every other number in front of a
 * currency figure takes `a`. Decimals and commas are stripped because they are
 * never spoken as a vowel sound.
 */
export function wrongArticleBeforeAmount(text: string): boolean {
  const match =
    /\ban\s+\$([\d][\d,]*(?:\.\d+)?)\s*(?:million|billion|trillion|thousand|[MBK])?\b/iu.exec(text);
  if (match === null) return false;
  const digits = (match[1] ?? "").replace(/,/g, "");
  if (digits.startsWith("8")) return false;
  if (/^(?:11|18)0*$/.test(digits)) return false;
  return true;
}

/**
 * A copular or locative opening: a state, where a card has to carry a change.
 *
 * Ruling #19 (2026-10-20), the thin-card class. Three delivered cards carried a
 * state as their whole opening — *"Everything becomes effectively open source,
 * which closes down substantial revenue streams"*, *"The response to music gear
 * that uses AI and vibe coding has been mixed."*, *"The Prometheus supercluster
 * is housed in Meta's New Albany, Ohio, data center."* — and the rule is that a
 * card must carry a change, not a state. `is housed in` and `was built in` are
 * locative predicates; `has been mixed` and `becomes effectively open source`
 * are copular ones; none of them is an event.
 *
 * The predicate list is closed on purpose. It is read off the first clause (a
 * comma, semicolon, colon or dash starts the next one), because a fronted
 * subordinate clause has its own verb — *"If Disney is chosen …, it has agreed
 * to pay …"* opens on `is chosen` and is not a state. A passive with an unknown
 * participle (`was acquired`, `was charged`) is not in the list and keeps its
 * card: withholding a real story is the worse error here. The three measured
 * strings are the class; nothing here is a grammar checker.
 */
const STATE_OPENING =
  /\b(?:is|are|was|were|has been|have been|had been)\s+(?:housed|located|based|situated|sited|built|constructed|headquartered|composed|formed|mixed|unchanged|uncertain|unclear|part of|made up of|home to)\b|\b(?:becomes?|became)\s+(?:effectively|essentially|increasingly|largely|virtually|now|soon)\b|\b(?:remains?|remained|seems?|seemed)\s+[\p{L}'-]+/iu;

/** A sentence that opens inside a clause the main clause follows. */
const LEADING_SUBORDINATOR =
  /^(?:if|when|while|after|before|although|though|because|since|as|once|unless|until|despite|given|should|had|were)\b/i;

export function thinStateOpening(text: string): boolean {
  const trimmed = text.trim();
  // A subordinate opening is judged by its main clause, which a string test
  // cannot reliably find without a parser -- so it is left alone rather than
  // guessed at. The measured class all open on their main clause.
  if (LEADING_SUBORDINATOR.test(trimmed)) return false;
  const clause = trimmed.split(/[,;:—]/)[0] ?? trimmed;
  return STATE_OPENING.test(clause);
}

/**
 * A dateline whose month the extractor dropped, left in front of the sentence.
 *
 * Card 16 of the delivered 2026-10-20 briefing opened *"20, 2026 – The PyTorch
 * Foundation, a community-driven hub …, on 20 October 2026 announced the
 * addition of nine new members …"*: the source's dateline was cut to a day and
 * a year, and the sentence then states the same date again. The stored evidence
 * unit carries the cut dateline verbatim (`article_evidence` unit 0 of article
 * `132ca74f`), so this is the source's own text and it is refused, not repaired
 * (ruling #6's precedent): a sentence that opens on a day with no month has no
 * reading that is true.
 *
 * The shape is a day, a comma, a year and a dash at the very start. A sentence
 * that merely begins with a number does not match (`20, 2026 was the year …`),
 * and neither does a date inside the sentence.
 */
const TRUNCATED_DATELINE = /^\d{1,2},\s*\d{4}\s*[–—−-]\s+/u;

export function truncatedDateline(text: string): boolean {
  return TRUNCATED_DATELINE.test(text.trim());
}

/**
 * Whether a sentence starts inside a quotation the page never opens.
 *
 * Card 24 of the delivered 2026-10-20 briefing opened *"A lot of companies and
 * experts have been talking about the ChatGPT moment for robotics,” she said,
 * adding that right now the industry was more in a “LEGO era."* — the first
 * quotation mark is a **closing** one, `she` has no antecedent in the line, and
 * the last quotation is never closed. `unresolvedContextOpening` returned
 * `false` for it, which is the #17-class miss: the sentence cannot open a page
 * because the reader joins it mid-conversation.
 *
 * Two literal tests, no grammar: the first quotation mark must not be a closing
 * one, and the marks must pair. Straight quotes are counted only when they are
 * quotation marks — inches and minutes (`The 6" pipe`) are not — and curly
 * marks are counted as themselves.
 */
const QUOTATION_MARK = /[\u201c\u201d"]/u;
const INCH_MARK = /(?<=\d)["\u2033]|["\u2033](?=\d)/gu;

export function brokenQuotation(text: string): boolean {
  const trimmed = text.trim();
  const first = trimmed.search(QUOTATION_MARK);
  if (first >= 0 && trimmed[first] === "\u201d") return true;
  const opens = (trimmed.match(/\u201c/gu) ?? []).length;
  const closes = (trimmed.match(/\u201d/gu) ?? []).length;
  if (opens !== closes) return true;
  const straight = (trimmed.replace(INCH_MARK, "").match(/"/gu) ?? []).length;
  return straight % 2 === 1;
}

/**
 * A card opening that says nothing a reader can act on.
 *
 * Two delivered lines of the 2026-10-20 briefing are the class (ruling #19's
 * thin-card bar, applied to the line rather than to the story): *"Meet the Java
 * Champions."* — a heading used as the card's opening, with no news in it — and
 * *"Some FairStress scenarios have a clearly stronger candidate whose profile
 * better satisfies the stated criteria."* — a description of the method where
 * the finding existed in the same row.
 *
 * Both shapes are closed and measured, and neither is a grammar test:
 *
 *   - **the invitation**: an imperative `Meet …` / `Introducing …` heading. A
 *     card that opens by introducing its subject has announced no event.
 *   - **the definition**: a quantified class (`Some …`, `Most …`) carrying a
 *     stative or comparative predicate and no figure and no past tense. A
 *     finding states what happened; a definition states what could.
 *
 * The caller advances to the next candidate first (the walk in `editorial.ts`),
 * so this only withholds a story whose every candidate is one of these.
 */
const INVITATION_OPENING =
  /^(?:meet|introducing|introduces|say hello to|get to know|here['’]s how|here is how|what you need to know|a look at)\b/iu;
const QUANTIFIED_CLASS_OPENING = /^(?:some|most|many|several|a few|each|every|any)\s+[\p{L}]/iu;
const STATIVE_COMPARATIVE =
  /\b(?:have|has|had|contain|contains|include|includes|consist|consists|differ|differs|vary|varies|depend|depends|satisf(?:y|ies)|better|stronger|weaker|larger|smaller|higher|lower|more|less)\b/iu;

export function fillerOpening(text: string): boolean {
  const trimmed = text.trim();
  if (INVITATION_OPENING.test(trimmed) && trimmed.split(/\s+/).length <= 12) return true;
  if (!QUANTIFIED_CLASS_OPENING.test(trimmed)) return false;
  const clause = trimmed.split(/[,;:—]/)[0] ?? trimmed;
  if (!STATIVE_COMPARATIVE.test(clause)) return false;
  // A figure is a result the reader can hold on to, even in a present-tense
  // sentence ("Some 60% of the models chose the minority candidate"), so the
  // definition class is the one with no number in it at all.
  return !/\d/.test(clause);
}

/**
 * A note about how the reporting was sourced, with no fact in it.
 *
 * `The person was not authorized to speak publicly and did so on condition of
 * anonymity.` reached the reader in the Diddy Combs story on 2026-10-17, as the
 * last sentence of a paragraph about his spokesperson -- where `The person` had
 * no antecedent on the page at all. It is the article's own sourcing note, not
 * something that happened, and it is the same shape the metadata rules refuse:
 * the reader learns nothing except how the story was obtained.
 *
 * Deliberately only the sentence that is *only* a note: it opens on an unnamed
 * person and says nothing but their status. Measured over 3,856 stored sentences
 * and 2,208 published ones that day, the class is 3 sentences -- this one, plus
 * `One person familiar, who asked not to be named, said the partnership was still
 * in place.` and `... according to a White House official not authorized to speak
 * publicly`, two facts that keep their sourcing clause and must survive.
 */
export function sourcingNote(text: string): boolean {
  const trimmed = text.trim();
  if (
    !/^(?:the|that|this)\s+(?:person|individual|official|source|insider|aide|spokesperson)\b/iu.test(
      trimmed,
    )
  )
    return false;
  return /\b(?:anonymity|not (?:authorized|authorised|permitted|allowed) to speak|asked not to be named|declined to be named|spoke? on condition|spoke? to .{0,20} on the condition)\b/iu.test(
    trimmed,
  );
}

/* ------------------------------------------------------------------------- */
/* The narrator: who "I" is in the source's own sentence                      */
/* ------------------------------------------------------------------------- */

/**
 * What a first-person sentence can become, or why it cannot.
 *
 * `publisherVoice` refuses anything the source's own narrator says, which is
 * right for opinion and wrong for reporting: over a 200-event corpus pass the rule
 * left three stories publishing nothing at all and took a 440-word post down to
 * 70, because a fact is not less true for having "I" in front of it. So the
 * narrator is classified instead of deleted, and only in ways that keep the
 * sentence's own actors where they are:
 *
 * - `wrapper`: the narrator says who they asked and the sentence says who
 *   answered -- "When I interviewed Greek Prime Minister Kyriakos Mitsotakis this
 *   week, he also admitted that ..." becomes "Greek Prime Minister Kyriakos
 *   Mitsotakis also admitted that ...". The actor is named, so the pronoun can be
 *   resolved to it with nothing guessed.
 * - `author`: an observation or an experiment, attributed to the person who ran
 *   it rather than asserted by nyuz -- "Last week I ran some benchmarks showing
 *   ..." becomes "Last week, the author reported running some benchmarks showing
 *   ..." (`authors` for a paper's repository). The narrator's *method* is kept,
 *   because deleting it would claim the writer did nothing.
 * - `claim`: the narrator is the actor of a verb only the source's own work is the
 *   subject of -- "we propose MolDesignBench" becomes "the authors propose
 *   MolDesignBench" -- so the sentence keeps its own words and its own verb, and
 *   only the actor is named. This is the class a research abstract lives in, and
 *   the first version of this rule dropped 46 of them per 200 events.
 * - `ambiguous`: anything else, including an observation whose object is a
 *   pronoun. Dropped rather than repaired, because the repair would be a guess.
 *
 * Commentary is not classified at all: it returns null and the existing voice
 * refusal takes it, which is where "I have to admit, I really love this release"
 * belongs and is already counted.
 */
export type NarratorKind = "wrapper" | "author" | "claim" | "ambiguous";
export type NarratorResolution = { text: string; kind: NarratorKind };

/** Verbs a narrator uses to report what somebody else said. */
const NARRATOR_ASK =
  "interviewed|spoke to|spoke with|asked|questioned|quizzed|met with|met|visited|called|emailed|messaged";

/** Reporting verbs a named actor uses, which is what a wrapper hands the page. */
const NARRATOR_REPORT =
  "said|says|told|tells|reported|reports|claimed|claims|confirmed|confirms|added|adds|explained|explains|noted|notes|warned|warns|argued|argues|announced|announces|acknowledged|acknowledges|admitted|admits|denied|denies|agreed|agrees|stated|states|wrote|writes|testified|testifies";

/**
 * Verbs whose subject, when the subject is the narrator, is the source's own work.
 *
 * This is a whitelist of what a source does to its own material, and it is what
 * decides whether `claim` applies: the point of the class is that the actor is not
 * in doubt -- nobody else "proposes" the thing the paper proposes -- so naming the
 * source as the actor invents nothing. Verbs a narrator uses to describe other
 * people's work (`reported`, `covered`, `heard`) are deliberately absent, as are
 * the modals: "we must protect our planet" is not the authors' work, and one
 * auxiliary is all the difference there is between a fact and a slogan.
 */
const NARRATOR_WORK = new Set(
  (
    "propose proposes proposed introduce introduces introduced present presents presented" +
    " develop develops developed build builds built design designs designed create creates created" +
    " train trains trained evaluate evaluates evaluated test tests tested benchmark benchmarks benchmarked" +
    " compare compares compared analyse analyses analysed analyze analyzes analyzed measure measures measured" +
    " investigate investigates investigated study studies studied examine examines examined" +
    " identify identifies identified characterize characterizes characterized characterise characterises characterised" +
    " observe observes observed demonstrate demonstrates demonstrated establish establishes established" +
    " derive derives derived apply applies applied extend extends extended improve improves improved" +
    " achieve achieves achieved reach reaches reached collect collects collected release releases released" +
    " publish publishes published implement implements implemented use uses used adopt adopts adopted" +
    " reproduce reproduces reproduced perform performs performed conduct conducts conducted" +
    " verify verifies verified validate validates validated discover discovers discovered" +
    " assemble assembles assembled generate generates generated compute computes computed" +
    " calculate calculates calculated estimate estimates estimated simulate simulates simulated" +
    " optimise optimises optimised optimize optimizes optimized solve solves solved" +
    " address addresses addressed explore explores explored survey surveys surveyed" +
    " interview interviews interviewed navigate navigated select selects selected" +
    " configure configures configured turn turns turned choose chooses chose chosen" +
    " enable enables enabled share shares shared" +
    " install installs installed deploy deploys deployed profile profiles profiled" +
    " find finds found see saw seen show shows report reports reported note notes noted" +
    " learn learned write writes describe describes described"
  ).split(/\s+/),
);

/**
 * Auxiliaries that already carry the agreement, so a substitution needs no
 * re-conjugation: "the authors have shown" and "the author has shown" are both the
 * source's own words.
 */
const NARRATOR_AUX = new Set([
  "be",
  "am",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
]);
/**
 * A participle, which is the only thing a form of *be* may carry in a claim.
 *
 * Without this, "we are 176 years into this AI experiment" -- a metaphor with no
 * verb in it -- would publish as the authors' own assertion.
 */
const PARTICIPLE = /^[a-z]+(?:ing|ed)$/i;
/** An observation the narrator made, which becomes the author's report. */
const NARRATOR_FIND =
  "find|finds|found|observe|observes|observed|see|saw|seen|note|noted|measure|measures|measured|discover|discovers|discovered|learn|learned|learnt|confirm|confirmed|establish|established|report|reports|reported";
/** An experiment the narrator ran, with the gerund the report needs. */
const NARRATOR_TEST: Record<string, string> = {
  ran: "running",
  run: "running",
  tested: "testing",
  tried: "trying",
  used: "using",
  built: "building",
  wrote: "writing",
  measured: "measuring",
  benchmarked: "benchmarking",
  installed: "installing",
  compared: "comparing",
  reviewed: "reviewing",
  analysed: "analysing",
  analyzed: "analyzing",
  profiled: "profiling",
  deployed: "deploying",
  spent: "spending",
  read: "reading",
  took: "taking",
  made: "making",
};
/** The narrator's taste, which is not a fact: left to the voice refusal. */
const NARRATOR_COMMENTARY =
  /\b(?:I|we)(?:\s+(?:have to|must|really|just|simply|personally|honestly|frankly))?\s+(?:think|thought|believe|believed|feel|felt|hope|hoped|guess|suppose|reckon|suspect|admit|say|love|like|liked|hate|remember|wonder|prefer|enjoy|recommend)\b|\bwe all know\b/i;
/** A time phrase that is not part of the actor's name. */
const TRAILING_TIME =
  /\s+(?:(?:this|last|next)\s+(?:week|month|year)|yesterday|today|tomorrow)\s*$/i; /**
 * A coordinating conjunction, which is what makes a prefix a clause rather than a
 * fronted adverbial.
 *
 * "Last week," and "To mitigate self-jailbreaking," both sit in front of an
 * attribution without damage. "Most leaders on a trade mission stick to the pitch,
 * but" does not: "... but, the author reported running X" is a sentence nobody
 * wrote, so a prefix that ends on a conjunction is a counted drop instead.
 */
const CLAUSE_TAIL = /\b(?:and|but|or|so|yet|nor|because|although|while)\s*$/i;

/** A person or role the narrator spoke to, as the sentence names them. */
function namedActor(text: string): boolean {
  const actor = text.trim();
  if (actor === "") return false;
  const words = actor.split(/\s+/);
  return words.length <= 8 && /[A-Z]/u.test(actor);
}

/** Past-tense forms, the only single verb a singular narrator may carry unchanged. */
const IRREGULAR_PAST = new Set(
  (
    "found saw seen built ran wrote made took spent read met gave got kept left set thought told held" +
    " sent put let began became brought caught chose came did drove felt fought flew forgot grew" +
    " heard knew laid led lost meant paid rode rose said sold sought stood taught threw won"
  )
    .split(/\s+/)
    .filter(Boolean),
);
/** A first-person token the rewrite cannot re-name without guessing. */
const NARRATOR_LEFTOVER = /\b(?:I|we|We|me|my|My|mine|myself|us|Us|our|Our|ours|Ours)\b/;
/**
 * A third-person plural, which competes with the source for a later pronoun.
 *
 * "we asked the ministry and they told us we would have to wait" is not the authors
 * waiting, so a sentence that names a plural *and* keeps a first-person token is
 * refused rather than followed through. A bare `it` is not a competitor -- it is
 * ordinary inside the sentence it belongs to ("we use Claude Sonnet 5 by default
 * because it passed all of our internal tests") -- and is left alone.
 */
const NARRATOR_COMPETITOR =
  /\b(?:they|them|their|theirs|themselves|They|Them|Their|Theirs|Themselves)\b/;

/**
 * An adverb the narrator may put between itself and its verb.
 *
 * "we first reproduce the baselines", "we also develop ..." -- ordinary in a paper
 * and no part of who the actor is. A closed set, because the verb is still what
 * decides whether the sentence is the source's own work.
 */
const NARRATOR_ADVERB = new Set([
  "first",
  "then",
  "also",
  "further",
  "furthermore",
  "additionally",
  "finally",
  "instead",
  "jointly",
  "specifically",
  "explicitly",
  "successfully",
  "subsequently",
  "currently",
]);

/**
 * A plural narrator's other pronouns, once its subject is the source.
 *
 * Only plural: `the authors ... their` keeps the number the source wrote, while a
 * single narrator's leftover "my" would have to become a pronoun the source never
 * used, so a singular sentence with a leftover token is dropped instead.
 */
function renameNarratorPronouns(segment: string, plural: boolean): string {
  if (!plural) return segment;
  return segment
    .replace(/\bWe\b/g, "The authors")
    .replace(/\bwe\b/g, "the authors")
    .replace(/\bOur\b/g, "Their")
    .replace(/\bour\b/g, "their")
    .replace(/\bOurs\b/g, "Theirs")
    .replace(/\bours\b/g, "theirs")
    .replace(/\bOurselves\b/g, "Themselves")
    .replace(/\bourselves\b/g, "themselves")
    .replace(/\bUs\b/g, "Them")
    .replace(/\bus\b/g, "them");
}

/**
 * The narrator's sentence with the source named as its actor, or null when the
 * rewrite would have to guess.
 *
 * This is the `claim` class: a sentence whose subject is the narrator and whose
 * verb is one only the source's own work takes. Nothing but the actor changes -- the
 * verb, its tense and its object are the source's own words -- so the rewrite cannot
 * invent a fact, and a sentence that keeps a first-person token (or a pronoun with
 * no antecedent) is refused rather than half-translated.
 *
 * Two shapes are deliberately not rewritten, and both are counted with the
 * ambiguous ones: a singular narrator with a modal ("I would like to propose ...",
 * "we must protect our planet") because the modal is opinion or slogan rather than
 * work, and a form of *be* without a participle under it ("we are 176 years into
 * this AI experiment") because there is no verb in the sentence to keep.
 */
function restoreNarratorActor(text: string, person: "author" | "authors"): string | null {
  // Case-insensitive, and that is the whole reason the corpus lost its papers'
  // claims. "we propose X" was resolved; "We propose X" -- the shape every arXiv
  // abstract opens with -- did not match, fell through to the last branch, and
  // was counted as an ambiguous narrator and dropped. 41 of 137 drops in one
  // 200-event window come back by this flag alone, all of them the paper saying
  // what it did.
  const clause = /(^|,\s*)(I|we)\b/i.exec(text);
  if (!clause || clause.index === undefined) return null;
  // The narrator's own number decides the label: a paper that writes "I" is one
  // author, and "the authors propose" about a single author is a different claim.
  // Read lowercase, because the match is: "We" is as plural as "we".
  const plural = (clause[2] ?? "").toLowerCase() === "we" || person === "authors";
  const lead = clause[1] ?? "";
  const words = text
    .slice(clause.index + clause[0].length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const adverb = words.length > 1 && NARRATOR_ADVERB.has((words[0] ?? "").toLowerCase()) ? 1 : 0;
  const first = (words[adverb] ?? "").toLowerCase();
  let phrase: string | null = null;
  if (NARRATOR_AUX.has(first)) {
    const next = (words[adverb + 1] ?? "").replace(/[^\p{L}'-]/gu, "");
    const finite = ["am", "is", "are", "was", "were"].includes(first);
    if (next !== "" && (!finite || PARTICIPLE.test(next))) phrase = `${first} ${next}`;
  } else if (
    NARRATOR_WORK.has(first) &&
    // Agreement: a plural subject takes the base form the source wrote, and a
    // singular one only a past tense, never a bare present ("the author propose").
    (plural || /ed$/.test(first) || IRREGULAR_PAST.has(first))
  ) {
    phrase = first;
  }
  if (phrase === null) return null;
  const prefix = text.slice(0, clause.index + lead.length);
  const kept = adverb === 1 ? `${words[0]} ` : "";
  const tail = words.slice(adverb + phrase.split(/\s+/).length).join(" ");
  if (tail === "") return null;
  const subject = plural ? "the authors" : "the author";
  // Everything but the narrator's own clause, which is what is left to re-name.
  const remaining = `${prefix}${kept}${tail}`;
  const leftovers = NARRATOR_LEFTOVER.test(remaining);
  if (leftovers && (!plural || NARRATOR_COMPETITOR.test(text))) return null;
  const rename = (segment: string) =>
    leftovers ? renameNarratorPronouns(segment, plural) : segment;
  const sentence = cleanDeterministicSentence(
    `${rename(prefix)}${subject} ${kept}${phrase} ${rename(tail)}`
      .trim()
      .replace(/^[a-z]/, (letter) => letter.toUpperCase()),
  );
  if (!hasPredicate(sentence) || !validDeterministicSentence(sentence)) return null;
  return sentence;
}

/**
 * The object and possessive first-person forms, case-exact.
 *
 * Case-exact is the whole point, and it cost this class two drafts to learn: under
 * a case-insensitive test `us` matches the country -- "the US", "US officials",
 * "the US Army" -- and 40 of 57 hits in one draft of the live probe were the
 * country rather than a pronoun, which is how an earlier draft of the class
 * measured 30 units where there are 17. `NARRATOR_LEFTOVER` below has been
 * case-sensitive for the same reason since it was written; this set is its
 * counterpart for the guard.
 *
 * A sentence-initial `Us` is carried (`Us four went home`), an all-caps `US` is
 * not.
 */
const NARRATOR_OBJECT = new Set([
  "me",
  "us",
  "mine",
  "ours",
  "myself",
  "ourselves",
  "Me",
  "Us",
  "Mine",
  "Ours",
  "Myself",
  "Ourselves",
]);

/**
 * Whether the text carries an object or possessive first-person pronoun.
 *
 * Read token by token rather than as a substring, so a pronoun inside a URL, a
 * path or a hyphenated code token is not a pronoun: `us-west-2`, `/docs/us/
 * install` and `https://example.com/us` are all in the live window, and three of
 * its first-draft hits were exactly that. A token has to be letters only to count.
 */
function hasFirstPersonObject(text: string): boolean {
  return text
    .split(/\s+/)
    .some((word) => NARRATOR_OBJECT.has(word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")));
}

/**
 * The verbs that say the sentence's own work enabled something, with the narrator
 * as what it enabled.
 *
 * Closed on purpose. A general "<verb> us" test would take in the newsroom and the
 * community as well: "she told us during an interview" and "u/cal93_'s latest
 * Reddit update gave us more details" are the same grammar with a different
 * referent, and renaming either to the authors writes a fact the source never
 * wrote. The enabled-and-derived verbs are the ones a source uses about its own
 * method, which is the shape the ruling allowed to be resolved.
 */
const NARRATOR_BENEFIT = /\b(?:lets?|allows?|enables?|permits?|leads?|helps?)\s+(us)\b/i;

/**
 * The narrator's sentence with the actor named, reached from an object rather than
 * a subject pronoun -- or null when naming the actor would be a guess.
 *
 * The ruling (2026-10-14, defect 5) drew this boundary, and both halves of the
 * guard below are its conditions rather than this file's preference:
 *
 * - **The actor noun must come from the source's own attribution.** Only a
 *   repository source carries "the authors" (`person === "authors"` in
 *   `selectReaderEvidence`, where the source's identity in the attribution is
 *   decided). A blog or a news desk would be handed "the author" -- a number the
 *   sentence never states -- so those withhold instead, and the ruling is explicit
 *   that the source's identity alone is not enough to name an actor.
 * - **The sentence has to make the narrator the thing its own work enabled.** The
 *   measured live unit is "This allows us to harness the accuracy of tree-based
 *   models like XGBoost ..." (arXiv cs.LG), one of six the window carries. A paper
 *   that says "allows those of us who teach" is not that sentence: the group sits
 *   between the verb and the pronoun, so the pattern below never matches it, and
 *   neither the community nor the newsroom shape is ever rewritten to an author.
 *
 * Nothing but the actor changes: the verb, its tense and its object are the
 * source's own words, so the rewrite cannot invent a fact. No pronoun is ever
 * written -- "gave them access" would name a referent the page never establishes,
 * which is the defect this resolution exists to avoid rather than to reintroduce.
 */
function restoreNarratorBeneficiary(text: string, person: "author" | "authors"): string | null {
  if (person !== "authors") return null;
  const benefit = NARRATOR_BENEFIT.exec(text);
  if (benefit === null) return null;
  const pronoun = benefit[1] ?? "";
  // The country is not a pronoun, and the pattern above is case-insensitive so
  // that a capitalised verb is matched at the start of a sentence.
  if (pronoun !== "us" && pronoun !== "Us") return null;
  const at = benefit.index + benefit[0].length - pronoun.length;
  const named = cleanDeterministicSentence(
    `${text.slice(0, at)}the authors${text.slice(at + pronoun.length)}`,
  );
  if (!hasPredicate(named) || !validDeterministicSentence(named)) return null;
  // Nothing first-person may survive the rewrite, and no pronoun may be written
  // in its place: the actor is a noun the source's attribution carries.
  if (hasFirstPersonObject(named) || /\b(?:I|we|my|our)\b/i.test(named)) return null;
  return named;
}

/**
 * The narrator's sentence as a published fact, or null when it is not one.
 *
 * `person` is the source's identity in the attribution: `the author` for a blog or
 * a news desk, `the authors` for a paper. Both are the source's own words about
 * itself -- nyuz never claims the work as its own and never asserts what a source
 * merely tried.
 */
export function resolveNarrator(
  text: string,
  person: "author" | "authors",
): NarratorResolution | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const unquoted = trimmed.replace(/"[^"\n]*"|“[^”\n]*”/g, "");
  // Nothing about the narrator's voice is present: not this function's business.
  //
  // The object half of this test is what defect 5 in the reader-quality loop was
  // missing. The subject regex alone meant a unit whose only first-person token
  // was an object or possessive pronoun bypassed the whole function -- the five
  // steps below never ran, and "Two vulnerabilities chained together gave us
  // access to ChatGPT and Codex accounts belonging to OpenAI employees."
  // published on the deployed origin while its own sibling ("We demonstrated
  // ...", same source, same paragraph) was rewritten to "The authors
  // demonstrated ...". Measured on the live window before the fix: 27 of 7,816
  // reader units, all of them publishing unclassified, 7 of them reaching a
  // reader as composed prose.
  if (!/\b(?:I|we|my|our)\b/i.test(unquoted) && !hasFirstPersonObject(unquoted)) return null;
  // Publication furniture, commentary and loaded colour keep the refusals they
  // already have -- newsletter lines, "we all know", a metaphor standing in for an
  // event -- so the counter that says *why* a sentence went stays accurate. Only
  // the voice test itself is bypassed here, because classification is what this
  // function does instead of refusing it.
  if (NOISE.test(unquoted) || COMMENTARY.test(unquoted) || SOURCE_COLOUR.test(unquoted))
    return null;
  if (NARRATOR_COMMENTARY.test(unquoted)) return null;
  // Past the guard above there is a first person in the sentence, so every path
  // returns a resolution: something to publish, or a counted drop.
  const label = person === "authors" ? "The authors" : "The author";
  // Number agreement, because "The authors reports" is the kind of error that
  // makes a reader stop trusting the rest of the page -- and lower case after a
  // leading adverbial, because "Last week, The author reported" is not a sentence.
  const reports = person === "authors" ? "report" : "reports";
  const afterAdverbial = person === "authors" ? "the authors" : "the author";
  /**
   * What the sentence says before the narrator's own clause, kept only when it is
   * a time adverbial. "Most leaders stick to the pitch, but I tested X" has a
   * clause there, and pasting it in front of a report produces a sentence nobody
   * wrote, so that case is a counted drop instead.
   */
  const keepableAdverbial = (before: string): boolean =>
    before === "" || (!CLAUSE_TAIL.test(before) && before.split(/\s+/).length <= 10);

  // 1. A reporting wrapper: who was asked, and who answered.
  //
  // `we` as well as `I`, because a news desk is plural; and the actor may be named
  // rather than referred to -- "When we asked why, HSBC said: ..." -- because the
  // antecedent is spelled out in the same sentence either way, which is the
  // condition that makes handing the sentence over safe. The named shape is read by
  // the block below, which requires the capital and the reporting verb itself.
  const interviewer = `(?:^|,\\s*|\\bbut\\s+)(?:when|after|before|while|as)\\s+(?:I|we)\\s+(?:${NARRATOR_ASK})\\s+([^,]{2,80}),\\s*(?:and\\s+)?`;
  const wrapper =
    new RegExp(`${interviewer}(?:(he|she|they)\\b)?([\\s\\S]*)$`, "i").exec(trimmed) ??
    new RegExp(
      `^(?:I|we)\\s+(?:${NARRATOR_ASK})\\s+([^,]{2,80}),?\\s*(?:and\\s+)?(he|she|they)\\b([\\s\\S]*)$`,
      "i",
    ).exec(trimmed);
  if (wrapper) {
    const actor = (wrapper[1] ?? "").trim().replace(TRAILING_TIME, "").trim();
    const answered = (wrapper[3] ?? "").trim();
    // A pronoun in the sentence's own answer is substituted with the actor the
    // narrator named; a named actor brings its own subject and its own reporting
    // verb, so the answer is handed over as written -- which the capital and the
    // reporting verb below are what confirm.
    const pronominal = wrapper[2] !== undefined;
    const resolved = cleanDeterministicSentence(pronominal ? `${actor} ${answered}` : answered);
    const actorNamed = pronominal
      ? namedActor(actor)
      : namedActor(answered.split(/\s+/).slice(0, 3).join(" ")) &&
        new RegExp(`^[A-Z][\\s\\S]{0,60}\\b(?:${NARRATOR_REPORT})\\b`).test(answered);
    if (actorNamed && hasPredicate(resolved) && validDeterministicSentence(resolved)) {
      return { text: resolved, kind: "wrapper" };
    }
  }

  // 2. An observation: the narrator's certainty is the attribution.
  const found = new RegExp(`\\b(?:I|we)\\s+(?:${NARRATOR_FIND})\\s+that\\s+([\\s\\S]+)$`, "i").exec(
    trimmed,
  );
  if (found) {
    const rest = (found[1] ?? "").trim();
    const before = trimmed.slice(0, found.index).trim().replace(/,$/, "");
    // A pronoun in the reported clause points at the narrator's own sentence, so
    // the report cannot carry it: "The author reports that it reduced latency"
    // says nothing a reader can check.
    const resolved = cleanDeterministicSentence(
      before === ""
        ? `${label} ${reports} that ${rest}`
        : `${before}, ${afterAdverbial} reported that ${rest}`,
    );
    if (
      keepableAdverbial(before) &&
      hasPredicate(rest) &&
      !contextDependent(rest) &&
      validDeterministicSentence(resolved)
    ) {
      return { text: resolved, kind: "author" };
    }
    return { text: "", kind: "ambiguous" };
  }

  // 3. An experiment: the gerund keeps the narrator's method in the report.
  const verbs = Object.keys(NARRATOR_TEST).join("|");
  const test = new RegExp(`\\b(?:I|we)\\s+(${verbs})\\b([\\s\\S]*)$`, "i").exec(trimmed);
  if (test) {
    const gerund = NARRATOR_TEST[(test[1] ?? "").toLowerCase()];
    const rest = (test[2] ?? "").trim();
    const before = trimmed.slice(0, test.index).trim().replace(/,$/, "");
    if (gerund && rest !== "" && keepableAdverbial(before)) {
      const resolved = cleanDeterministicSentence(
        before === ""
          ? `${label} ${reports} ${gerund} ${rest}`
          : `${before}, ${afterAdverbial} reported ${gerund} ${rest}`,
      );
      if (hasPredicate(resolved) && validDeterministicSentence(resolved)) {
        return { text: resolved, kind: "author" };
      }
    }
    // The method survives only when the rest of the sentence does. A trailing
    // fragment ("... and saw improvements") is a judgement call, so it goes.
    return { text: "", kind: "ambiguous" };
  }

  // 4. The narrator as the actor of the source's own work: the sentence keeps its
  //    own verb and its own object, and only the actor is named.
  const claim = restoreNarratorActor(trimmed, person);
  if (claim !== null) return { text: claim, kind: "claim" };

  // 5. The source's own work with the narrator as the thing it enables: the same
  //    rewrite as 4, reached from an object pronoun rather than a subject one.
  const benefit = restoreNarratorBeneficiary(trimmed, person);
  if (benefit !== null) return { text: benefit, kind: "claim" };

  // 6. Anything else: the narrator's referent cannot be established without
  //    guessing. `us` here may be a paper's authors, an outlet's newsroom, an
  //    audience or a community, and the sentence does not say which -- so it is
  //    withheld through the path this function has always had, under the reason
  //    string the taxonomy already carries (`narrator_ambiguous`). Measured
  //    cost of that choice: 6 of the window's 7 published units, all of them the
  //    community and newsroom shapes a blind substitution would have
  //    mis-attributed.
  return { text: "", kind: "ambiguous" };
}

/**
 * Source colour: the publication's own voice, not a fact.
 *
 * Separate from `COMMENTARY`, which is a closed set of whole rhetorical clauses.
 * This is the smaller, blunter case -- a loaded metaphor standing in for a real
 * event -- and it is applied at the evidence boundary so the sentence never
 * becomes a candidate the composer has to reason about. Exported so the
 * composer's diagnostics can count it apart from the rest of the noise class:
 * "we dropped twelve sentences for loaded language" is a number worth seeing.
 */
export function sourceColour(text: string): boolean {
  return SOURCE_COLOUR.test(text);
}

/* ------------------------------------------------------------------------- */
/* Editorial adverbials and evaluative tails                                 */
/* ------------------------------------------------------------------------- */

/**
 * Sentence-initial editorial adverbials, which are the publication talking.
 *
 * "Perhaps predictably for a company that built its success on automated
 * verification, DigiCert doesn't see agent management as a manual problem." The
 * adverbial is a comment on the fact, not part of it, and dropping it leaves a
 * complete neutral sentence: "DigiCert doesn't see agent management as a manual
 * problem."
 *
 * A closed list of epistemic and evaluative adverbs, matched only at the start
 * of a sentence and only when a comma or a capitalised clause follows, so
 * "Predictably irrational pricing" survives and "Perhaps predictably, ..." does
 * not. This is the one rewrite the patch performs on source voice, and it is
 * safe in both directions: the fact clause is untouched and the wrapper carried
 * no fact of its own.
 */
/** One editorial adverb, which on its own may be doing real work. */
const EPISTEMIC_ADVERB =
  "perhaps|maybe|predictably|unsurprisingly|inevitably|understandably|naturally|notably|interestingly|curiously|amusingly|bizarrely|sadly|thankfully|mercifully|ironically";

/**
 * One editorial adverb at the start of a sentence: the adverb, and the space.
 *
 * The capitalised-clause test is `CAPITALISED_CLAUSE` below rather than a
 * lookahead in this pattern. A lookahead inherits the case-insensitive flag, and under `i` a
 * `[A-Z]` character class matches a lowercase letter too -- so the documented
 * rule ("only when a comma or a capitalised clause follows") was really "an
 * adverb followed by any word", which is a comment deleted from every sentence
 * that opened on one. The frozen 200-event corpus produced exactly two: "Perhaps
 * this proposal will change that?" became "This proposal will change that?",
 * turning the source's hedge into an assertion, and "Notably, our upper bound
 * exhibits ..." lost its "Notably,".
 */
const EDITORIAL_ADVERBIAL = new RegExp(`^(?:${EPISTEMIC_ADVERB})[,:]?\\s+`, "i");

/** Whether the next word starts a new clause, which is what the adverb comments on. */
const CAPITALISED_CLAUSE = /^[A-Z\u00c0-\u00de]/;

/**
 * Two editorial adverbs stacked, which is never a fact statement.
 *
 * "Perhaps predictably for a company that built its success on automated
 * verification, DigiCert doesn't see agent management as a manual problem." The
 * stacked pair is the publication commenting on its own point, and removing both
 * words leaves the sentence that carries it. A single adverb is left alone
 * (`Notably absent was the regulator` is a construction, not a comment), which is
 * what keeps this from being a word filter with teeth.
 */
const STACKED_ADVERBIAL = new RegExp(
  `^(?:${EPISTEMIC_ADVERB})(?:\\s+(?:${EPISTEMIC_ADVERB}))\\s+`,
  "i",
);

/**
 * A trailing clause that judges the fact instead of adding to it.
 *
 * "... which illustrates the point perfectly" / "... underscoring the risk" /
 * "... a sign of how far the industry has to go". Removing it leaves the
 * sentence that carried the fact; keeping it publishes an opinion.
 */
const EVALUATIVE_TAIL =
  /[,\s]+(?:which|that)?\s?(?:illustrat(?:es|ing)|demonstrat(?:es|ing)|prov(?:es|ing)|underscor(?:es|ing)|highlight(?:s|ing)|reinforc(?:es|ing)|speaks? volumes)\s+(?:the|a)\s+(?:point|problem|issue|risk|danger|need|gap|trend|shift)(?:\s+(?:perfectly|well|clearly|nicely))?\s*$/i;

/**
 * Strip the sentence's editorial wrapper, keeping its factual clause.
 *
 * Returns the text unchanged when there is nothing to remove, and callers treat
 * "nothing changed" as the common case. Nothing here paraphrases: the only
 * operations are deleting a leading comment and deleting a trailing judgement,
 * and the sentence that remains is the one the source wrote.
 *
 * `removed` says whether a wrapper was actually deleted, as opposed to the text
 * only having had its first letter capitalised. The caller counts removals, and
 * the two are not the same number: the corpus's 34 counted strips were 2
 * removals and 32 capitalised fragments, which made the audit's "source-voice
 * removals" line a count of two different things.
 */
export function stripEditorialVoice(text: string): { text: string; removed: boolean } {
  let out = text.trim();
  let removed = false;
  const stacked = STACKED_ADVERBIAL.test(out) ? out.replace(STACKED_ADVERBIAL, "") : out;
  if (stacked !== out) {
    out = stacked;
    removed = true;
  }
  // A single adverb only goes when a capitalised clause follows it: otherwise it
  // may be the hedge the sentence's meaning rests on. `rest` is tested in code,
  // because no lookahead can test for a capital under a case-insensitive flag.
  const adverbial = EDITORIAL_ADVERBIAL.exec(out);
  const rest = adverbial ? out.slice(adverbial[0].length) : "";
  if (adverbial && CAPITALISED_CLAUSE.test(rest)) {
    out = rest;
    removed = true;
  }
  const tailed = out.replace(EVALUATIVE_TAIL, "");
  if (tailed !== out) {
    out = tailed;
    removed = true;
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  // Nothing left means the sentence was nothing but its wrapper, and the caller
  // is handed the original rather than an empty fact.
  if (out === "") return { text, removed: false };
  const capped = /^[a-z]/.test(out) ? out[0]!.toUpperCase() + out.slice(1) : out;
  return { text: capped, removed };
}

/**
 * A fronted frame that comments on the fact instead of carrying one.
 *
 * Removing the adverbial above leaves a second wrapper behind, because the
 * adverbial was sitting inside it:
 *
 *   "Perhaps predictably for a company that built its success on automated
 *    verification, DigiCert doesn't see agent management as a manual problem."
 *
 * "For a company that built its success on automated verification" is a
 * prepositional phrase about an unnamed generic actor, and that actor is the
 * sentence's own subject -- the frame adds a judgement about the fact rather
 * than a fact. What follows the comma is the sentence to publish.
 *
 * Conservative in both directions, because the alternative is deleting prose:
 * the frame must open with a preposition from a closed list, name an
 * *indefinite* actor from a short list of generic roles ("a company", "one
 * vendor"), contain a relative clause so it is unmistakably a dependent frame
 * rather than an assertion, carry no digit, no quotation and no capitalised word
 * -- so it cannot be the only place a name or a number appears -- and leave a
 * complete sentence behind, which is checked before the rewrite is returned.
 * "In July, ..." has no indefinite actor, and "In a filing that revealed the
 * deal, the company said ..." names a real artefact rather than a generic role,
 * so both are left exactly as written.
 */
const GENERIC_ACTOR =
  "company|firm|business|vendor|startup|maker|provider|player|organisation|organization|outfit|critic|analyst|sceptic|skeptic|insider";
const FRONTED_FRAME = new RegExp(
  `^(?:for|as|in|at|with|to|like|unlike)\\s+(?:a|an|one)\\s+(?:${GENERIC_ACTOR})\\b` +
    `(?=[^,]{0,120}\\b(?:that|which|who)\\b)([^,]{0,120}),\\s*`,
  "i",
);

export function stripFrontedFrame(text: string): string {
  const trimmed = text.trim();
  const match = FRONTED_FRAME.exec(trimmed);
  if (!match) return text;
  const frame = match[1] ?? "";
  // A number, a quotation or a name inside the frame means the frame may be the
  // only place that fact appears, so it stays.
  if (/[\d"“”]/.test(frame)) return text;
  const tail = frame.split(/\s+/).slice(1);
  if (tail.some((word) => /^[A-Z]/.test(word))) return text;
  const rest = trimmed.slice(match[0].length).trim();
  if (rest === "" || !hasPredicate(rest) || !validDeterministicSentence(rest)) return text;
  return rest[0]!.toUpperCase() + rest.slice(1);
}

/* ------------------------------------------------------------------------- */
/* Report framing: a label in front of a fact                                */
/* ------------------------------------------------------------------------- */

/**
 * The document, or the group that wrote it, in front of a colon.
 *
 * Only the nouns a document is called by. "The paper", "the authors", "the
 * study" -- never a party to the story, because a company's colon is a list
 * introduction ("The company reports three segments: cloud, devices, ads") and
 * not a frame around a sentence.
 */
const FRAME_SUBJECT =
  "(?:the|a|an|this|that|their|our|its|one)?\\s*(?:new|recent|latest|full)?\\s*(?:paper|study|report|survey|analysis|review|preprint|research|authors?|researchers?|scientists?|team|findings|results)";

/**
 * A verb that introduces a clause: what follows is a sentence of its own.
 *
 * These are the frames the composer moves to the end of the fact. A clause may
 * not follow `that` while keeping the capital its source gave it -- "The paper
 * reports that Most of the activity ..." reads as a misspelling of a name, and
 * the codebase's position, stated in `REPORTED_CLAUSE_WORDS`, is that lowering
 * the word is a guess about whether it is a proper noun. So the fact leads and
 * the attribution follows it, which is grammatical with either.
 */
const FRAME_CLAUSE_VERB =
  "reports?|reported|says?|said|states?|stated|notes?|noted|finds?|found|shows?|showed|argues?|argued|claims?|claimed|warns?|warned|projects?|projected|estimates?|estimated|forecasts?|forecast|predicts?|predicted|expects?|expected|suggests?|suggested|concludes?|concluded|observes?|observed|speculates?|speculated|recommends?|recommended";

/**
 * A verb that takes an object, where the colon is the whole defect.
 *
 * "The authors present: the first systematic study of it" is one sentence with a
 * colon in the middle of it; deleting the colon is the entire repair, and no
 * attribution moves.
 */
const FRAME_OBJECT_VERB =
  "presents?|presented|describes?|described|documents?|documented|details?|detailed|outlines?|outlined|releases?|released|announces?|announced|publishes?|published|introduces?|introduced|unveils?|unveiled|proposes?|proposed|offers?|offered";

/** A frame at the start of a sentence: `The paper reports: <fact>`. */
const REPORT_FRAME = new RegExp(
  `^(${FRAME_SUBJECT}(?:['’]s)?(?:\\s+${FRAME_SUBJECT}(?:['’]s)?)?\\s+(?:${FRAME_CLAUSE_VERB}|${FRAME_OBJECT_VERB}))\\s*:\\s+(\\S[\\s\\S]*)$`,
  "iu",
);

/**
 * `According to <claimant>, <rest>` -- or its label form with a colon -- for any
 * claimant at all.
 *
 * The claimant is read structurally, not from a list: one to eight tokens with
 * no clause punctuation between `according to` and the comma or colon. That is
 * what makes "According to Krebs on Security, ...", "According to The New York
 * Times, ...", "According to police, ..." and "According to the paper: ..." the
 * same construction. The earlier pattern accepted only the nouns a document is
 * called by, and only with a colon, so every named publication went through
 * untouched. What happens to a frame once it is read -- dropped, moved, or kept
 * -- is `resolveAccordingFrame`'s decision, not this pattern's.
 */
const ACCORDING_FRAME =
  /^according to\s+((?:[^\s,:;!?"“”()]+)(?:\s+[^\s,:;!?"“”()]+){0,7})\s*([,:])\s+(\S[\s\S]*)$/iu;

export type AccordingFrame = {
  /** Who the sentence credits, as written: "Krebs on Security", "police". */
  claimant: string;
  /** What they are credited with, without the frame. */
  rest: string;
  /** `,` is ordinary English; `:` is the label form. */
  form: "comma" | "colon";
};

/** The `According to <claimant>` frame a sentence opens with, if any. */
export function readAccordingFrame(sentence: string): AccordingFrame | null {
  const match = ACCORDING_FRAME.exec(sentence.trim());
  if (!match) return null;
  const claimant = (match[1] ?? "").trim();
  const rest = (match[3] ?? "").trim();
  if (claimant === "" || rest === "") return null;
  return { claimant, rest, form: match[2] === ":" ? "colon" : "comma" };
}

/** A source name reduced to what two spellings of it share. */
function sourceKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]s?(?=\s|$)/g, "")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a claimant is one of the story's own cited sources.
 *
 * Compared by normalized name, never by a list of publications. A leading
 * article, case and a possessive are ignored. Prefix matches are deliberately
 * rejected: "police" is not necessarily "Police Scotland", and dropping the
 * former attribution could turn a third-party claim into an asserted fact.
 */
export function isOwnSource(claimant: string, sources: readonly string[]): boolean {
  const claim = sourceKey(claimant);
  if (claim.length < 3) return false;
  return sources.some((name) => {
    const own = sourceKey(name);
    if (own.length < 3) return false;
    return claim === own;
  });
}

/**
 * Whether taking the attribution off this clause would change what it asserts.
 *
 * A claim, an estimate or a projection is somebody's -- "the company expects
 * revenue to double" is not a fact about revenue -- and a quotation is somebody's
 * words. A plain report of what happened is not, and its provenance is exactly
 * what the citation on the block already carries.
 */
function attributionMatters(clause: string): boolean {
  if (/^["“]/.test(clause)) return true;
  const type = deterministicFactType(clause);
  return type === "claim" || type === "estimate" || type === "projection";
}

/** A speech or reporting verb: the clause says whose claim it is. */
const NAMES_SPEAKER =
  /\b(?:said|says|told|tells|stated|states|announced|confirmed|argued|argues|claimed|claims|warned|warns|according to)\b/i;

function capitalised(text: string): string {
  return text === "" ? text : text[0]!.toUpperCase() + text.slice(1);
}

export type OwnAttribution = {
  text: string;
  /**
   *   dropped  the frame was provenance only; the citation carries it
   *   moved    the clause is a claim, so the attribution follows it
   *   kept     a claim that cannot take a trailing attribution keeps the frame
   */
  action: "dropped" | "moved" | "kept";
};

/**
 * A clause attributed to the story's own source, published as prose.
 *
 * The source is already on the page: every block carries its citation and the
 * story lists its sources. So "According to Krebs on Security, <fact>" in a
 * Krebs on Security story says nothing the citation does not, and it costs the
 * sentence its shape -- a frame in front, and often the clause's own capital
 * after a comma ("According to Krebs on Security, Army soldier who ...").
 *
 *   a plain fact    -> the fact:                  "Army soldier who pleaded ..."
 *   a claim         -> the fact, then its source: "Revenue will double, according to Reuters."
 *   a claim that is -> left framed, because a trailing attribution cannot follow
 *   a question or      a question, an exclamation or a quotation's closing mark
 *   a quotation
 *
 * The attribution only ever leaves a clause that does not need it: a claim,
 * estimate, projection or quotation keeps it, so nothing the source merely
 * reported is published as established.
 */
export function attributeToOwnSource(clause: string, claimant: string): OwnAttribution {
  const body = clause.trim();
  // A clause that names its own speaker -- "OpenAI said ...", "Police said ..."
  // -- already carries the attribution that matters. The outlet is provenance
  // for the sentence, not the claimant of it, and appending it would credit the
  // claim twice.
  if (!attributionMatters(body) || alreadyAttributed(body) || NAMES_SPEAKER.test(body)) {
    return { text: capitalised(body), action: "dropped" };
  }
  if (/^["“]/.test(body) || /[?!…]["”]?\s*$/.test(body)) {
    return { text: `According to ${claimant}, ${body}`, action: "kept" };
  }
  return {
    text: `${capitalised(body.replace(/[.!?]+$/, ""))}, according to ${claimant}.`,
    action: "moved",
  };
}

/**
 * The `According to <claimant>` frame on one sentence, resolved.
 *
 *   own source      -> `attributeToOwnSource`: dropped, moved behind a claim, or kept
 *   anyone else     -> preserved as written: "According to police, the suspect
 *                      was arrested" is police's claim, and removing the frame
 *                      would publish it as a fact. A third-party outlet, a
 *                      study, researchers, officials: all the same.
 *
 * The colon label form of a frame that is not the story's own is handled by
 * `normalizeReportFraming`, which moves it behind the fact.
 */
export function resolveAccordingFrame(
  sentence: string,
  ownSources: readonly string[],
): { text: string; action: OwnAttribution["action"] | "preserved" | "none" } {
  const frame = readAccordingFrame(sentence);
  if (!frame) return { text: sentence, action: "none" };
  if (!isOwnSource(frame.claimant, ownSources)) return { text: sentence, action: "preserved" };
  return attributeToOwnSource(frame.rest, frame.claimant);
}

/**
 * Whether a sentence already carries an attribution of its own.
 *
 * The composer used to wrap every lead of a single-source story in "According
 * to <outlet>, ", including the ones that were already attributed, which is how
 * the deck read "According to Nature, Researchers also observed model management
 * abuse ..." -- one attribution glued to another, and a capital after a comma.
 * A sentence that names its own claimant is published as the source wrote it:
 * the claim is not weaker for it, and the citation travels with the block.
 *
 * Structural, and deliberately narrow: the claimant must be one of the nouns a
 * document or author group is called by, or a named party that *reports*, and a
 * reporting verb must follow it. "The company's servers were breached" is a
 * subject, not an attribution, and is still wrapped.
 */
const CLAIMANT =
  "(?:the\\s+|a\\s+|an\\s+|our\\s+|their\\s+)?(?:authors?|researchers?|scientists?|study|paper|report|survey|team|analysts?|officials?|investigators?|company|firm|spokesperson|agency|analysis|research)";
const REPORTING_PREDICATE =
  "(?:reports?|reported|says?|said|states?|stated|notes?|noted|finds?|found|shows?|showed|observ(?:e|es|ed)|presents?|presented|describes?|described|argues?|argued|claims?|claimed|warns?|warned|announces?|announced|tells?|told|estimates?|estimated|projects?|projected|concludes?|concluded|documents?|documented|details?|detailed|adds?|added)";
const ALREADY_ATTRIBUTED = new RegExp(
  // A publication's own name is one to three words: "The Register reports
  // that ..." as well as "Reuters reports that ...".
  `^(?:according to\\b|(?:\\S+\\s+){1,3}reports?\\s+that\\b|${CLAIMANT}\\b[^,.;:]{0,40}?\\b${REPORTING_PREDICATE}\\b)` +
    // Or the attribution a moved frame left behind: `X, the paper projects.`
    // Carrying one at the end is carrying one, and wrapping the sentence again
    // would put a second attribution in front of it.
    `|,\\s*(?:according to\\s+[^,.;:!?]{1,80}|${FRAME_SUBJECT}\\s+(?:${REPORTING_PREDICATE}))\\s*[.!?]?\\s*$`,
  "i",
);

export function alreadyAttributed(text: string): boolean {
  return ALREADY_ATTRIBUTED.test(text.trim());
}

/** The frame a sentence opens with, if it opens with one. */
function readReportFrame(
  sentence: string,
): { label: string; rest: string; clause: boolean } | null {
  const according = readAccordingFrame(sentence);
  if (according?.form === "colon") {
    return { label: `According to ${according.claimant}`, rest: according.rest, clause: true };
  }
  if (according) return null;
  const frame = REPORT_FRAME.exec(sentence);
  if (!frame) return null;
  const label = frame[1] ?? "";
  const rest = (frame[2] ?? "").trim();
  if (rest === "") return null;
  return {
    label,
    rest,
    clause: new RegExp(`(?:${FRAME_CLAUSE_VERB})$`, "i").test(label),
  };
}

/** One sentence's worth: the colon came out, so the capital is already right. */
function withoutColon(label: string, rest: string): string {
  return `${label} ${rest}`;
}

/**
 * Publish a document's own colon label as prose, without inventing or losing a
 * single fact.
 *
 * The three outcomes, and why each is a fact-preserving one:
 *
 *   "The paper reports: 40 endpoints were exposed."
 *     -> "40 endpoints were exposed, the paper reports."
 *   "The authors present: the first systematic study of it."
 *     -> "The authors present the first systematic study of it."
 *   "The paper reports: the authors found 40 exposed endpoints."
 *     -> "The authors found 40 exposed endpoints."
 *
 * A clause moves to the end, where its capital is correct and its claim is still
 * the document's. A noun phrase after a verb that takes an object only loses its
 * colon. And a fact that already names its own claimant loses the frame, because
 * one attribution in front of another is the defect `AUTHORIAL_OPENING` exists
 * for -- "A new paper reports: The authors call this ......" was the deck.
 *
 * And "According to <this source>, <fact>" -- a publication crediting itself --
 * goes through `attributeToOwnSource`, given the names in `ownSources`.
 *
 * The fact is not paraphrased; only its frame can be removed or moved.
 */
export function normalizeReportFraming(
  text: string,
  /** The name of the source this text came from, and any alias of it. */
  ownSources: readonly string[] = [],
): {
  text: string;
  /** Frames deleted because the fact was already attributed. */
  dropped: number;
  /** Frames moved behind the fact they were in front of. */
  moved: number;
} {
  let dropped = 0;
  let moved = 0;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = sentences.map((sentence) => {
    const own = resolveAccordingFrame(sentence, ownSources);
    if (own.action === "dropped") {
      dropped += 1;
      return own.text;
    }
    if (own.action === "moved") {
      moved += 1;
      return own.text;
    }
    if (own.action === "kept") return own.text;
    const frame = readReportFrame(sentence);
    if (!frame) return sentence;
    const { label, rest } = frame;
    if (alreadyAttributed(rest)) {
      dropped += 1;
      return rest;
    }
    // A trailing attribution takes a clause, and the fact has to be one sentence
    // for the comma to sit where the writer would put it.
    if (frame.clause && !/[.!?]\s/.test(rest)) {
      moved += 1;
      const clause = rest.replace(/[.!?]+$/, "");
      // The clause now opens the sentence. It was written mid-sentence after a
      // colon, so a lower-case first letter is the source's own spelling and
      // takes the capital a sentence start needs -- and a name that was already
      // capitalised is untouched.
      const opener = clause[0]!.toUpperCase() + clause.slice(1);
      return `${opener}, ${label[0]!.toLowerCase()}${label.slice(1)}.`;
    }
    return withoutColon(label, rest);
  });
  return { text: out.join(" "), dropped, moved };
}

/* ------------------------------------------------------------------------- */
/* Relative time                                                            */
/* ------------------------------------------------------------------------- */

/**
 * A time reference that only means something on the day the source wrote it.
 *
 * "this month" is a fact about the calendar as it stood at publication, and a
 * nyuz story is read days or weeks later -- and kept in the archive for as long
 * as a plan allows. On its own the phrase is not wrong, it is unusable: a reader
 * cannot tell whether "earlier this month" was this month or the one the story
 * was written in. So it is either made absolute against the story's own date or
 * the sentence is refused, and "refused" is the honest answer for the phrases
 * that cannot be made absolute without guessing (a *week* has no name).
 */
export const RELATIVE_TIME =
  /\b(?:this|last|next)\s+(?:week|month|year)\b|\b(?:today|yesterday|tomorrow)\b/i;

/** One pass, so a sentence with several phrases is rebuilt in one go. */
const RELATIVE_TIME_ALL =
  /\b(this|last|next)\s+(week|month|year)\b|\b(today|yesterday|tomorrow)\b/gi;
/**
 * A week phrase, unless a possessive clitic makes it a noun.
 *
 * A week has no name, which is why these phrases are refused rather than
 * rewritten -- but `this week's video` is not a date at all: the clitic owns the
 * noun after it, the same distinction the replacement pass below already draws
 * for `today's AI` and `last year's models`. Read the other way, the test
 * refused the sentence and `stripUnanchorableTime` then took the head off the
 * noun, publishing `’s Stratechery video is on Frontier Overhangs.` on the
 * 2026-10-03 briefing.
 */
const RELATIVE_WEEK = /\b(?:this|last|next)\s+week\b(?!['’]s)/i;
/**
 * A determiner in front of the phrase makes it a noun, not an adverbial.
 *
 * "Over the last month" is a thirty-day window ending now, and "the last month"
 * is not the calendar month that came before: rewriting it to "July 2026" would
 * publish a date the source never gave. Refused rather than rewritten, and
 * counted, which is the same trade the week phrases get.
 */
const DETERMINED_RELATIVE =
  /\b(?:the|a|an|its|their|our|his|her|every|each)\s+(?:last|next|this)\s+(?:month|year)\b/i;
/**
 * A possessive clitic, which makes the phrase a noun rather than a date.
 *
 * `today's` is the genitive of a common noun, and `this year's` is the same
 * shape: expanding either splits the noun phrase from its head and hands the
 * reader `on 2 October 2026's AI`, which reads as somebody's ownership. The
 * clitic is the whole test -- `today` alone anchors, `today's` does not -- so
 * no list of words can fall through it.
 */
const POSSESSIVE_CLITIC = /^['’]s/;
/** Whether a preposition (and at most its article) already leads into the phrase. */
const PREPOSED =
  /\b(?:in|on|at|during|since|until|by|from|of|for|with|to|against|than|versus|vs|over|past|through|throughout|into|within|before|after|around|about|early|late|mid)\s+(?:(?:the|a|an|its|their|our|his|her)\s+)?$/i;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A clone of `at` zeroed to the start of its UTC day, for day/month/year math.
 *
 * UTC is the zone the page's anchor dates are written in. The instrument and the
 * page are two processes that read the same anchor. When either used the host's
 * local zone, the day label they wrote depended on the host's `TZ`: the page
 * composed on the Worker's clock (UTC), the audit composed on the laptop's, and
 * the same event published on 21 October (UTC) read as 20 October under
 * `America/New_York` -- a real defect the audit could not see on the Worker's
 * machine and the Worker could not see on the auditor's. Pinning to UTC ties the
 * calendar day to the absolute moment the event was published, so both processes
 * agree. See [docs/decisions/anchored-dates-utc.md](../../docs/decisions/anchored-dates-utc.md).
 *
 * The pinning is carried by the accessors themselves rather than by a zone
 * constant: `Date` reads UTC from `getUTC*` and writes it from `setUTC*`, and
 * neither takes a zone argument, so a `"UTC"` string here would document the rule
 * without governing anything.
 *
 * `Date` setters obey the host zone, so writing `setMonth(getMonth() + 1)` to
 * a date near a month boundary in a negative-offset zone landed on the prior
 * month -- the day label the page published then disagreed with the day label
 * the audit published. Doing the arithmetic in UTC means the clone and the
 * caller agree regardless of `TZ`.
 */
function atUTC(at: Date): Date {
  const clone = new Date(at.getTime());
  clone.setUTCHours(0, 0, 0, 0);
  return clone;
}

/** `in July 2026`, unless a preposition is already in front of the phrase. */
function monthPhrase(shift: number, at: Date, before: string): string {
  const date = atUTC(at);
  date.setUTCDate(1);
  // `setUTCMonth` rolls the year when the month overflows, but the math has to
  // be UTC too -- `setMonth(getMonth() + 1)` worked on the Worker because the
  // Worker runs in UTC, and broke everywhere else, which is the same defect
  // the audit surfaced.
  date.setUTCMonth(date.getUTCMonth() + shift);
  const label = `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return PREPOSED.test(before) ? label : `in ${label}`;
}

function yearPhrase(shift: number, at: Date, before: string): string {
  const year = String(at.getUTCFullYear() + shift);
  return PREPOSED.test(before) ? year : `in ${year}`;
}

function dayPhrase(shift: number, at: Date, before: string): string {
  const date = atUTC(at);
  date.setUTCDate(date.getUTCDate() + shift);
  const label = `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return PREPOSED.test(before) ? label : `on ${label}`;
}

/**
 * The text with its relative time references made absolute, or null when one of
 * them cannot be.
 *
 * `at` is the story's own date -- the day the event happened, which is the day
 * the source was writing about. Nothing here paraphrases: each phrase is
 * replaced by the calendar date it referred to, in one pass, so a sentence with
 * several is rebuilt without any replacement being applied to another's output.
 */
export function normalizeRelativeTime(
  text: string,
  at: Date | null,
): { text: string; changed: boolean } | null {
  if (!RELATIVE_TIME.test(text)) return { text, changed: false };
  if (at === null || Number.isNaN(at.getTime())) return null;
  // A week has no name, so "the week of the 8th" would be a guess about which
  // day the week began. Refusing the sentence costs one fact; inventing a date
  // costs the reader's trust in every other date on the page.
  if (RELATIVE_WEEK.test(text)) return null;
  if (DETERMINED_RELATIVE.test(text)) return null;
  const out = text.replace(
    RELATIVE_TIME_ALL,
    (
      match,
      span: string | undefined,
      unit: string | undefined,
      day: string | undefined,
      offset: number,
      whole: string,
    ) => {
      // The slice keeps its trailing space on purpose: `PREPOSED` is anchored on
      // the end of it, and trimming would leave "quarter of" with nothing for the
      // separator to match -- which produced "the first quarter of in 2027".
      const before = whole.slice(Math.max(0, offset - 24), offset);
      // A possessive is a noun the phrase belongs to, not a date the phrase
      // stands for. The reader keeps `today's AI`, which is grammatical, rather
      // than being handed `2 October 2026's AI`, which is not.
      if (POSSESSIVE_CLITIC.test(whole.slice(offset + match.length))) return match;
      // The pattern is case-insensitive, so `day` carries the source's own
      // capitalisation: a sentence-initial "Yesterday" is not the string
      // "yesterday". Compared raw, it fell through both shifts and anchored to
      // the story's own date -- the day the reader is least likely to notice
      // being wrong, because every other date on the page agrees with it.
      const spanWord = span?.toLowerCase();
      const dayWord = day?.toLowerCase();
      const shift = spanWord === "last" ? -1 : spanWord === "next" ? 1 : 0;
      if (unit === "month") return monthPhrase(shift, at, before);
      if (unit === "year") return yearPhrase(shift, at, before);
      if (dayWord === undefined) return match;
      return dayPhrase(dayWord === "yesterday" ? -1 : dayWord === "tomorrow" ? 1 : 0, at, before);
    },
  );
  return { text: out, changed: out !== text };
}

/**
 * The text with a relative time phrase that cannot be made absolute removed.
 *
 * The phrases `normalizeRelativeTime` refuses are refused for a reason -- a week
 * has no name, and `the last month` is not the calendar month before this one, so
 * rewriting either would publish a date the source never gave. Refusing the whole
 * sentence, though, is how a story with three such sentences ends up publishing
 * nothing at all: the Greek prime minister's remark became an empty page because
 * "this week" is unanchorable. The phrase is a modifier, not a fact, so it is
 * dropped and the sentence kept, and only when what remains is still a sentence.
 * Returns null when nothing safe remains to publish.
 */
export function stripUnanchorableTime(text: string): string | null {
  if (!DETERMINED_RELATIVE.test(text) && !RELATIVE_WEEK.test(text)) return null;
  const out = text
    // `(?!['’]s)` on every alternative, and the same reason as `RELATIVE_WEEK`:
    // the head of a possessive noun is not a date. Removing it does not leave a
    // sentence without a time reference, it leaves `’s video` -- so the phrase
    // stays, and nothing else strippable refuses the fact instead.
    .replace(
      /\b(?:in|on|at|during|since|after|before|by|through|throughout|within|around|from|until|for|over)\s+(?:this|last|next)\s+week\b(?!['’]s)/gi,
      "",
    )
    .replace(/\b(?:this|last|next)\s+week\b(?!['’]s)/gi, "")
    .replace(
      /\b(?:in|on|at|during|since|after|before|by|through|throughout|within|around|from|until|for|over)\s+(?:the|a|an|its|their|our|his|her|every|each)\s+(?:last|next|this)\s+(?:month|year)\b(?!['’]s)/gi,
      "",
    )
    .replace(
      /\b(?:the|a|an|its|their|our|his|her|every|each)\s+(?:last|next|this)\s+(?:month|year)\b(?!['’]s)/gi,
      "",
    )
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    // A phrase that opened the sentence leaves its punctuation behind: "Last
    // week, the author reported ..." became ", the author reported ...", which
    // the composer then pasted after its attribution as "According to Phoronix,
    // , the author reported ...".
    .replace(/^[\s,;:]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (out === text || !hasPredicate(out) || !validDeterministicSentence(out)) return null;
  return /^[a-z]/.test(out) ? out[0]!.toUpperCase() + out.slice(1) : out;
}

const STOP = new Set(
  "the a an and or in on at to of for from with by as it its this that these those he she they his her their but when after before much most more less new earlier today yesterday according said says report reported company project foundation software technology business politics economy ai gains gain backing funding fresh converts fierce critics announces announced launches launch update anyone".split(
    " ",
  ),
);
const COMMON_ENTITY_WORDS = new Set(
  "test environment live customer data security government investors shares stock market researchers scientists developers president minister police court study report funding company project".split(
    " ",
  ),
);

/**
 * A caption pasted onto a sentence, with no punctuation where the paste happened.
 *
 * An article page's image captions and subheads are not always separate elements
 * in the fetched markup; when they are not, they arrive joined to the paragraph
 * they illustrate. `headingSeam` catches the heading-after-heading form, whose
 * head is verbless -- but a caption can also follow a *complete* sentence:
 *
 *   "Research has found some Chinese children prefer talking to AI over people
 *    A survey of 8,563 primary and secondary students in China in 2025, ..."
 *
 * arrived that way on the 2026-10-02 briefing, and so did a subhead glued to the
 * quotation under it: "China is trying to tackle its low birth rate "It's
 * plausible that ...",". Both seams are made of nothing -- no period, no comma.
 * Prose never holds a capitalised "A survey of" after a lowercase word, so the
 * seam can be cut back apart, and both halves read on their own -- which is why
 * this splits instead of refusing, where `headingSeam` refuses.
 *
 * The quotation form is bounded hard, because `He said "..."` is ordinary prose:
 * the word before the opening mark must not be a speech verb or a preposition (a
 * quote after "as" or "of" is an epithet or a title, not reported speech), the
 * run before it must hold no comma, the quotation must be long enough to be
 * reported speech rather than an epithet, and an attribution must follow the
 * closing mark.
 */
const CAPTION_SEAM =
  /\s(?=(?:A|The|New|Its|Their)\s+(?:survey|polling|poll|study|census|review|analysis|investigation)\s+(?:of|into|on|by|across|among|conducted|carried|released|published|covering)\b)/g;

/**
 * Words the run before a quotation may not end on for the run to be a paste
 * seam: speech verbs hand the quote its speaker in place, and a preposition or
 * relative pronoun makes the quote the object of the sentence it is in.
 */
const SPEECH_TAIL = new Set(
  (
    "said says told asked wrote added noted explained argued stated replied claims claimed " +
    "according per called described labelled labeled dubbed branded termed quoted " +
    "as like of for with by to in on at than into about from that which who whom"
  ).split(" "),
);

/** A quotation shorter than this is an epithet ("deeply flawed"), not speech. */
const QUOTE_SEAM_MIN_CHARS = 40;

function quoteSeamAt(text: string): number[] {
  const positions: number[] = [];
  for (let index = 2; index < text.length; index += 1) {
    const mark = text[index];
    if (mark !== '"' && mark !== "“") continue;
    // A lowercase word, one space, no punctuation: "... its low birth rate "It's
    // plausible ...". Punctuation before the quote is a clause boundary, and a
    // capital before it is a name, not a seam.
    if (text[index - 1] !== " " || !/[a-z]/.test(text[index - 2] ?? "")) continue;
    const before = text.slice(0, index - 1);
    if (unbalancedQuotes(before)) continue;
    const words = before.split(/\s+/).filter(Boolean);
    // "He said " ... " stays one sentence: the quote is the verb's object, and
    // the verb is its speaker.
    if (words.length < 4 || SPEECH_TAIL.has((words.at(-1) ?? "").toLowerCase())) continue;
    // A comma in the run before the quote is a clause boundary: the quote is
    // part of the sentence it sits in, however long it is.
    if (before.includes(",")) continue;
    const closing = text.indexOf(mark === '"' ? '"' : "”", index + 1);
    if (closing < 0 || closing - index - 1 < QUOTE_SEAM_MIN_CHARS) continue;
    if (!/^\s*,?\s*(?:says|said|per)\s+[A-Z]/.test(text.slice(closing + 1))) continue;
    positions.push(index);
  }
  return positions;
}

/**
 * The text cut at every caption paste seam, as the sentences it was made of.
 *
 * Returns one part when there is no seam, so callers can map over it either way.
 * A seam inside a quotation is the quote's own text, never a paste, so a seam
 * with an unbalanced quotation to its left is skipped.
 */
export function captionSeamSplit(text: string, names: readonly string[] = []): string[] {
  const clean = restoreDottedNames(text, names).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const seams: { left: number; next: number }[] = [];
  for (const match of clean.matchAll(CAPTION_SEAM)) {
    const space = match.index ?? -1;
    if (space > 0) seams.push({ left: space, next: space + 1 });
  }
  for (const quote of quoteSeamAt(clean)) seams.push({ left: quote, next: quote });
  seams.sort((a, b) => a.left - b.left);
  const parts: string[] = [];
  let start = 0;
  for (const seam of seams) {
    if (seam.left <= start) continue;
    if (unbalancedQuotes(clean.slice(0, seam.left))) continue;
    parts.push(clean.slice(start, seam.left).trim());
    start = seam.next;
  }
  parts.push(clean.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * Put a product's own dotted name back together.
 *
 * `Character.AI` is one word, and the delivered 2026-10-19 card 09 printed it as
 * `Character. AI` — twice — because the sentence scanner treats the stop before
 * an all-caps token as a boundary. Ruling #19 (2026-10-20) is explicit that this
 * is not a typo to be corrected by a dictionary: the spaced form is normalised
 * **only** where the card's own entity list holds the canonical name, so the
 * repair is driven by the coverage rather than by a list of products this file
 * would have to keep.
 */
function restoreDottedNames(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names) {
    const parts = name.split(".");
    if (parts.length !== 2) continue;
    const [head, tail] = parts;
    if (!head || !tail || !/\p{L}/u.test(head) || !/\p{L}/u.test(tail)) continue;
    const spaced = new RegExp(
      `${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\s*${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "g",
    );
    out = out.replace(spaced, name);
  }
  return out;
}

/** Do not split a quotation away from its speaker or split decimals and versions. */
export function readerSentences(text: string, names: readonly string[] = []): string[] {
  const out: string[] = [];
  // A caption pasted onto a sentence leaves no punctuation between them, so the
  // scanner below has no boundary to find. The seam is cut first, while it is
  // still detectable, and each half is then read as the sentence it is.
  for (const clean of captionSeamSplit(text, names)) {
    let quote = "";
    let start = 0;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (c === '"') quote = quote === '"' ? "" : quote || '"';
      if (c === "“") quote = "”";
      if (c === "”") quote = "";
      const end =
        /[.!?]/.test(c ?? "") || ((c === '"' || c === "”") && /[.!?]/.test(clean[i - 1] ?? ""));
      if (
        !quote &&
        end &&
        // A boundary is a full stop before a space, or before a capital letter with
        // no space at all -- what pasting a caption onto a sentence leaves behind:
        // "... for a temporary injunction.Stop calling it safe." The tight form
        // needs a lowercase letter before the stop, so "U.S.Army" and "3.5" are
        // not boundaries, and a word after it -- the next token has to be a
        // sentence-shaped capitalised word and not an all-caps token, or
        // "Character.AI" is cut in two (`Character.` + `AI …`), which is the
        // delivered 2026-10-19 card 09 defect.
        (clean[i + 1] === " " ||
          (/[A-Z]/.test(clean[i + 1] ?? "") &&
            /[a-z]/.test(clean[i - 1] ?? "") &&
            /^[A-Z][a-z]/.test(clean.slice(i + 1)))) &&
        // A sentence does not end at a single-capital initial: "... by Wellington
        // and T. Rowe Price, large institutional investors..." was split into a
        // fragment ending "T." and a second starting "Rowe Price", which the
        // composer then published as two. Only a name's initial looks like this, so
        // the split is held back and the sentence stays whole. A dotted
        // abbreviation is the same shape one letter longer -- the production deck
        // read "... in violation of U.S." because the splitter cut at the final
        // stop of "U.S. export controls", and "According to a U.S. Department of
        // Justice..." splits the same way. A sentence that genuinely ends with an
        // abbreviation merges with the next one; a fragment no reader can parse is
        // the worse error.
        !/(?:^|\s)(?:[A-Z]\.)+$/.test(clean.slice(0, i + 1)) &&
        !/^(?:said|says|he|she|they|according|told)\b/.test(
          clean.slice(clean[i + 1] === " " ? i + 2 : i + 1),
        )
      ) {
        out.push(clean.slice(start, i + 1).trim());
        start = clean[i + 1] === " " ? i + 2 : i + 1;
      }
    }
    if (start < clean.length) out.push(clean.slice(start).trim());
  }
  return out.filter(Boolean);
}

export function centralTokens(text: string): string[] {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? [])
        .map((t) => t.replace(/[.-]+$/, ""))
        .filter((t) => t.length > 2 && !STOP.has(t)),
    ),
  ];
}

/**
 * Compiled patterns, keyed by the text they were built from.
 *
 * A pattern built from a name is a pure function of that name, and *building* one
 * -- with the `u` flag and a lookbehind -- costs far more than running it. The
 * entity loops call these tests thousands of times per briefing (every name against
 * every sentence of every source), and on the 22:30Z reader's pool the readiness
 * gate spent **3.2 s of its 15.1 s of CPU compiling them**: `contains` alone was
 * 16.5% of a CPU profile of that gate, with the two inline patterns in
 * `rankEntities` on top of it. Measured 2026-10-16 by CPU profile of
 * `assessReadiness` over that reader's live pool
 * ([cpu-killed-invocations.md](../../docs/decisions/cpu-killed-invocations.md)).
 *
 * Verdicts are unchanged -- a cache cannot change what a pure test returns -- which
 * is why this is a cache and not a different test. That matters here: these
 * patterns decide entity roles, and entity roles decide what a briefing publishes.
 *
 * Bounded because the keys come from article text: an isolate must not keep a
 * pattern for every proper noun it has ever read. A `u`-flag pattern is stateless
 * (no `lastIndex`), so sharing one between calls is safe.
 */
const patternCache = new Map<string, RegExp>();
const PATTERN_CACHE_LIMIT = 2_000;

function cachedPattern(key: string, build: () => RegExp): RegExp {
  const hit = patternCache.get(key);
  if (hit !== undefined) return hit;
  const pattern = build();
  if (patternCache.size >= PATTERN_CACHE_LIMIT) patternCache.clear();
  patternCache.set(key, pattern);
  return pattern;
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether every character is ASCII -- the case where the two paths coincide.
 *
 * Written as the absence of anything at or above U+0080 rather than as a range over
 * the control characters, because a regex may not carry a literal control character
 * range (`no-control-regex`) and the two are the same test on every JS string: a
 * character is ASCII exactly when it is below U+0080.
 */
const WIDER_THAN_ASCII = /[\u0080-\u{10ffff}]/u;

function asciiOnly(text: string): boolean {
  return !WIDER_THAN_ASCII.test(text);
}

/** `\p{L}\p{N}`, which over ASCII is exactly "a letter or a digit". */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/**
 * Whether `text` says `name` as a whole run of word characters.
 *
 * The regex is the authority and the last resort. When both the name and the text
 * are ASCII -- which is what entity names out of English news are -- the same test
 * is `indexOf` plus a boundary check on the two characters that touch the match,
 * and the two are **provably** the same test rather than the same test in practice:
 * over ASCII, `i`-flag folding is one-to-one (A-Z <-> a-z, nothing else), and
 * `\p{L}\p{N}` over ASCII is exactly `[A-Za-z0-9]`. The guard is the whole point --
 * the fold is *not* one-to-one in general (final sigma, Kelvin sign, long s), so a
 * text or name containing anything wider takes the regex path and the exact
 * semantics, and the fast path can never decide a case the regex would decide
 * differently.
 *
 * Worth the asymmetry: this function was 2.8 s of the 22:30Z reader's 15.1 s gate --
 * the entity loops run every name against every sentence of every source, and V8's
 * `u`-flag lookbehind is slow. Measured 2026-10-16 by CPU profile of
 * `assessReadiness` over that reader's live pool.
 */
export function contains(text: string, name: string): boolean {
  if (name !== "" && asciiOnly(name) && asciiOnly(text)) {
    const haystack = text.toLowerCase();
    const needle = name.toLowerCase();
    for (let from = 0; ;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) return false;
      if (!isWordChar(at === 0 ? undefined : haystack[at - 1])) {
        if (!isWordChar(haystack[at + needle.length])) return true;
      }
      from = at + 1;
    }
  }
  return cachedPattern(
    `contains:${name}`,
    () => new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(name)}(?![\\p{L}\\p{N}])`, "iu"),
  ).test(text);
}

export type RankedEntity = {
  name: string;
  aliases: string[];
  role: "PRIMARY" | "SECONDARY" | "BACKGROUND" | "REPORTING_SOURCE";
  score: number;
  sourceCount: number;
};

/**
 * The text entity extraction is allowed to read.
 *
 * `rankEntities` used to concatenate the raw excerpt, so its capitalised-run
 * harvest picked names out of publisher furniture that the fact pipeline had
 * already refused on the same words: "Image", "Principal", "Contact", "Send",
 * "Subscribe", "Verge", and the two-word "Reuters The" that reached a published
 * paragraph as a bare label. Those names are not cosmetic. `shortenIntroducedNames`
 * rewrites names in published prose, so a furniture-derived entity is a
 * furniture-derived edit, and nothing validated the list -- which is why the
 * gates read zero while the reader saw a byline with no verb.
 *
 * Screened per sentence rather than filtered out of the entity list afterwards,
 * because an output filter is a vocabulary of symptoms: today's furniture is
 * `Subscribe`, tomorrow's is `Follow` or `Correction` or `Paid partnership`.
 *
 * The screen is deliberately NOT `unitTextRejection` and deliberately NOT
 * `editorialNoise`. The first answers "may this be published as a fact", a
 * stricter question than an entity corpus needs to ask; the second also refuses
 * commentary and first-person voice, which cost the fixture's "Richard Schut"
 * his name and broke surname introduction in production. What this needs is the
 * narrow question -- is this the publisher writing about itself -- so that is
 * what `publisherSelfReference` asks, and `validDeterministicSentence` rides
 * along only to drop fragments that carry no prose at all. Alias resolution
 * keeps all the surrounding context it needs.
 */
function admissibleEntityText(text: string): string {
  return readerSentences(text)
    .filter((sentence) => !publisherSelfReference(sentence) && validDeterministicSentence(sentence))
    .join(" ");
}

export function rankEntities(title: string, sources: ReaderSource[]): RankedEntity[] {
  const texts = sources.map((s) =>
    [s.excerpt, ...(s.enrichedEvidence ?? []).map((u) => u.text)]
      .filter((value): value is string => value !== undefined)
      .map(admissibleEntityText)
      .join(" "),
  );
  const all = [title, ...texts].join(" ");
  const names = new Map<string, string>();
  const add = (name: string) => {
    const clean = name.replace(/^(?:The|In|As|Much|After|Then)\s+/, "").trim();
    if (
      !clean ||
      STOP.has(clean.toLowerCase()) ||
      COMMON_ENTITY_WORDS.has(clean.toLowerCase()) ||
      /^\d/.test(clean)
    )
      return;
    const key = clean.toLowerCase();
    if (!names.has(key)) names.set(key, clean);
  };
  for (const hit of [...extractCompanies(all, 0), ...extractProducts(all, 0)]) add(hit.value);
  for (const name of all.match(
    /\b(?:[A-Z][\p{L}\d-]*(?:\.[\p{L}\d-]+)*)(?:\s+(?:[A-Z][\p{L}\d-]*(?:\.[\p{L}\d-]+)*|on(?=\s+[A-Z]))){0,3}/gu,
  ) ?? []) {
    // The `on` bridge exists to join a run across a lowercase preposition, but
    // when the run STOPS there the match is half a phrase cut at its preposition
    // -- "Developer Use Cases on", "GB DGX Spark on", "One More Note on" on the
    // frozen corpus, all three names. A harvested run is a name only when it
    // ends on a capitalised token; the whole match goes, because the text before
    // the preposition is the same half-phrase.
    if (!/^[A-Z]/.test(name.trim().split(/\s+/).at(-1) ?? "")) continue;
    add(name);
  }
  for (const s of sources) if (s.name) add(s.name);
  // Article sentences do not depend on the candidate entity, so split each source
  // once rather than rescanning a long excerpt for every name in it.
  const sourceUnits = [...new Set(texts.flatMap((text) => readerSentences(text)))];
  const aliases = new Map<string, string[]>();
  for (const [key, name] of names) {
    const parts = name.split(" ");
    if (parts.length < 2) continue;
    const initials = parts.map((p) => p[0]).join("");
    // Require an explicit alias cue as well as matching initials.
    if (
      initials.length >= 3 &&
      names.has(initials.toLowerCase()) &&
      cachedPattern(
        `alias-cue:${initials}`,
        () => new RegExp(`(?:known as |aka |\\()${initials}\\b`),
      ).test(all)
    ) {
      aliases.set(key, [initials]);
      names.delete(initials.toLowerCase());
    }
  }
  return [...names]
    .map(([key, name]) => {
      const forms = [name, ...(aliases.get(key) ?? [])];
      const inText = (text: string) => forms.some((n) => contains(text, n));
      const inTitle = inText(title);
      const supporting = new Set(
        sources.flatMap((s, i) => (inText(texts[i]!) ? [s.name?.toLowerCase() ?? String(i)] : [])),
      ).size;
      const units = sourceUnits.filter(inText);
      const subjects = units.filter(
        (t) =>
          forms.some((n) =>
            cachedPattern(
              `subject-form:${n}`,
              () => new RegExp(`^(?:The )?${escapeForPattern(n)}(?:['’]s)?\\b`, "i"),
            ).test(t),
          ) && ACTION.test(t),
      ).length;
      const reporting =
        sources.some((s) => s.name && contains(s.name, name)) ||
        /^(?:Reuters|BBC|The Register|Register)$/i.test(name);
      const score =
        (inTitle ? 12 : 0) +
        Math.min(units.length, 4) +
        subjects * 3 +
        Math.max(0, supporting - 1) * 2;
      const role =
        reporting && !inTitle
          ? "REPORTING_SOURCE"
          : inTitle || subjects >= 2 || (aliases.has(key) && units.length >= 2)
            ? "PRIMARY"
            : subjects > 0 || units.length >= 2
              ? "SECONDARY"
              : "BACKGROUND";
      return {
        name,
        aliases: forms.slice(1),
        role,
        score,
        sourceCount: supporting,
      } as RankedEntity;
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Matching includes currency and scale, so $18.5M is not confused with 18.5%. */
export function numericKeys(text: string): string[] {
  return [
    ...text.matchAll(
      /([$€£])\s*([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn|[bmt])?\b|(\d+(?:\.\d+)?)\s*%/gi,
    ),
  ].map((m) => {
    if (m[4]) return `${m[4]}%`;
    const scale = m[3]?.toLowerCase()[0];
    return `${m[1]}${Number(m[2]!.replace(/,/g, "")) * (scale === "t" ? 1e12 : scale === "b" ? 1e9 : scale === "m" ? 1e6 : 1)}`;
  });
}

/**
 * Bare magnitudes and dimensioned quantities: the identity vocabulary.
 *
 * `numericKeys` above is the conflict vocabulary -- currency and percentages,
 * figures strong enough to say two claims disagree. This one is deliberately
 * weaker, because it is only ever asked whether two headlines are about one
 * incident: "100 million barrels" is an anchor a paraphrase keeps, while it is
 * not strong enough to call a conflict. Measured over the 400-event weekly
 * population: of 322 same-actor residual pairs that share no `numericKeys`
 * figure, exactly one shares a magnitude -- the G7 diesel release, one event
 * told by two outlets -- and zero unrelated pairs join. Used only by
 * `sameIncident`; the figure-conflict guard keeps the conservative vocabulary.
 */
export function magnitudeKeys(text: string): string[] {
  const scale: Record<string, number> = { million: 1e6, billion: 1e9, trillion: 1e12 };
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s?(million|billion|trillion)\b/gi)) {
    out.push(`m${Number(m[1]) * (scale[m[2]!.toLowerCase()] ?? 1)}`);
  }
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s?(GB|TB|MB|KB|PB)\b/g)) {
    out.push(`s${m[1]}${m[2]!.toUpperCase()}`);
  }
  for (const m of text.matchAll(
    /\b(\d[\d,]*(?:\.\d+)?)\s?(ft|feet|metres?|meters?|km|miles?|kg|tonnes?|tons?|barrels?|litres?|liters?|percent)\b/gi,
  )) {
    out.push(`u${m[1]!.replace(/,/g, "")}${m[2]!.toLowerCase().replace(/s$/, "")}`);
  }
  return out;
}

export function evidenceScore(text: string, title: string, entities: RankedEntity[] = []): number {
  if (editorialNoise(text)) return -100;
  const tokens = new Set(centralTokens(text));
  const overlap = centralTokens(title).filter((t) => tokens.has(t)).length;
  const primary = entities.filter(
    (e) => e.role === "PRIMARY" && [e.name, ...e.aliases].some((n) => contains(text, n)),
  ).length;
  const numbers = numericKeys(text);
  const headlineNumber = numbers.some((n) => numericKeys(title).includes(n));
  return (
    overlap * 4 +
    Math.min(primary, 3) * 3 +
    (ACTION.test(text) ? 4 : 0) +
    (numbers.length && ACTION.test(text) ? 2 : 0) +
    (headlineNumber ? 18 : 0) -
    (/^(?:he|she|it|they|this|that|its|the project|the company|in the short interval)\b/i.test(text)
      ? 5
      : 0)
  );
}

export type ReaderFact = {
  text: string;
  evidence: number[];
  origin: "rss" | "enriched";
  score: number;
  quote: boolean;
  uncertain: boolean;
  /** Source-local position is retained in memory for safe context recovery. */
  sourceOrder: number;
  previousText?: string;
  nextText?: string;
  /** The fact's own source's whole text, for the mid-name fragment test. */
  sourceContext?: string;
  /**
   * Set when this unit was dropped because its narrator's subject could not be
   * restored without guessing (`resolveNarrator`). The unit is still counted, and
   * with a reason of its own, so a reader of the diagnostics can tell a sentence
   * that was refused for dangling from one that was refused for saying "I".
   */
  narratorAmbiguous?: boolean;
};

export type DeterministicFactType =
  | "fact"
  | "claim"
  | "estimate"
  | "projection"
  | "quote"
  | "background"
  | "comparison"
  | "future_action";

/**
 * A sentence beginning on the tail of a domain name.
 *
 * A feed description that quoted a site's own about page arrives as
 * "Phoronix.org automated benchmarking software." -- split at the full stop, so
 * the second half opens on "Org". The words after it are grammatical, which is
 * why nothing else refuses it, and the result reads as nonsense under a
 * headline. Only true Web TLDs are listed, and only where they are a common
 * English word is excluded (`Co`, `Net`), so "Net income rose 5%" survives.
 */
const TRUNCATED_DOMAIN_OPENING = /^(?:Org|Com|Gov|Edu|Info|Biz|Xyz)\s+[a-z]/;

const DANGLING_OPENING = /^(?:and|but|or|so|yet|then|also),?\s+/i;
/**
 * A connector left attached to the capitalised sentence that followed it: two
 * sentences the splitter never separated, published as one. "However, When
 * Reddit said that there's no replacement ..." (TechCrunch, 2026-10-02) is the
 * shape -- grammatical on neither side of the comma, and no other rule reads it
 * as anything but a long sentence. The capital is required, so "However, the
 * company said" keeps its ordinary use.
 */
const SPLICE_OPENING =
  /^(?:and|but|or|so|yet|then|also|however|instead|meanwhile|moreover|furthermore|still|thus|therefore|plus),?\s+(?=[A-Z])/;
/**
 * A comma followed by a capitalised subordinator, which is never a real clause
 * boundary: "..., When X", "..., While Y". The same splice as above, where the
 * second sentence happens to open on a subordinator rather than a connector.
 */
const COMMA_SUBORDINATOR =
  /,\s+(?:When|While|Because|Although|Though|If|Since|After|Before|Once|As|Unless|Until|Whether)\s/;
const BROKEN_ATTRIBUTION =
  /^(?:according to|as reported by)\s+[^,]+,\s*(?:once|when|while|because|although|and|but)\b/i;
const FRAGMENT_OPENING = /^(?:no|not|adds? that|said that|which|where|how)\s+/i;
const EDITORIAL_SLANG =
  /\b(?:bit barn|monster racks?|gpu bonanza|ai gold rush|gold rush|rack[s]? of monsters?)\b/gi;
/**
 * Loaded metaphors a reporter reaches for and a neutral article should not.
 *
 * Small and closed on purpose, and it *rejects* the sentence rather than
 * repairing it: "they went into full goblin mode, finding exposed credentials"
 * carries a real fact inside a joke, and no deterministic rewrite can lift the
 * fact out of the joke without writing a sentence the source did not write. A
 * dropped sentence is the honest outcome; the incident is almost always stated
 * plainly somewhere else in the same article.
 */
const SOURCE_COLOUR =
  /\b(?:goblin mode|dumpster fire|snafus?|snafu|clusterf\w+|shitshow|hackerati|cybercrims?|chuckleheads?|boffins?|wonks?|ninjas?)\b/i;
const HTML_LEFTOVER = /<\/?[a-z][^>]*>/i;

/**
 * Markup a truncated feed left behind, and the raw URL a source prints.
 *
 * `HTML_LEFTOVER` needs a whole tag; a provider that truncates the string it
 * sends leaves less than one. The corpus published a Verge story whose entire
 * deck was `" data-portal-copyright="Image: Nabu Casa " ... src="https://…" />
 * Home Assistant is renaming its cloud service to Home Assistant Link and` --
 * attribute assignments, a closing residue and a URL, no tag name anywhere. The
 * three arXiv stories of the same briefing carried `https://github.com/...`
 * inside otherwise good sentences. A reader never needs either: markup is the
 * source's serialization and a bare URL is an address, not a claim.
 */
const SOURCE_MARKUP_OR_URL =
  /<\/?[a-z!][^>]*|\/>|\b(?:src|href|class|style|alt|title|data-[\w-]+)\s*=\s*["']|\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}\b/i;

/**
 * Whether text still carries its source's markup or a raw URL.
 *
 * Exported because the deck's terse branch is allowed to accept a
 * publisher-written summary that is shorter than a fact, and it still has to
 * refuse markup: the corpus's entire Home Assistant deck was a truncation
 * residue with an image URL in it, and the terse deck took it because it ended
 * in a clause.
 */
export function sourceMarkupOrUrl(text: string): boolean {
  return SOURCE_MARKUP_OR_URL.test(text);
}

function stripControls(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
}

/** Small, conservative cleanup applied before evidence is scored or composed. */
export function cleanDeterministicSentence(value: string): string {
  // Tags first, then the shared entity decoder, then one collapse. The old order
  // replaced a handful of named references with a space and left every numeric
  // one as written, which is how `&#x20;` reached a reader, and how `R&amp;D`
  // became `R D`.
  let text = decodeEntities(stripControls(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  // Closing quotes cannot open a sentence: `” Thomas shouted to his colleagues`
  // is the tail of a quotation whose opening was cut upstream, and the mark left
  // in front of the subject reads as a typo. Opening marks are left alone -- a
  // sentence that begins with one is a quotation, which is a different case.
  text = text.replace(/^[”’]+\s*/, "");
  // A space before punctuation is what pasting two extracted fragments leaves
  // behind: "According to RNLI , the rescued ...", "the pricing page .".
  text = text.replace(/\s+([,;:.!?])/g, "$1");
  // A doubled full stop is the same class of artefact one character further in:
  // "Tip #1: Learn to direct AI, not just use it.." shipped that way on the
  // frozen corpus. Only a doubled one is closed, and only at the end of a token,
  // so an ellipsis keeps its three dots and "1..5" keeps its range.
  text = text.replace(/(?<!\.)\.\.(?=\s|$)/g, ".");
  text = text.replace(/\b(\w+)(?:\s+\1){1,}\b/gi, "$1");
  text = text.replace(EDITORIAL_SLANG, (match) =>
    /bit barn/i.test(match)
      ? "datacenter"
      : /gpu bonanza|gold rush/i.test(match)
        ? "AI investment wave"
        : "AI server racks",
  );
  if (text && /^[a-z]/.test(text)) text = text[0]!.toUpperCase() + text.slice(1);
  return text;
}

/**
 * Sentence and paragraph are different units, so they have different limits.
 *
 * A sentence is the smallest thing nyuz publishes on its own, and a character
 * ceiling is how runaway extraction is kept out of it. A paragraph is several
 * sentences, so that ceiling does not apply to it -- and applying a sentence's
 * limit to a paragraph is exactly how a valid multi-sentence paragraph used to
 * be discarded whole. See `validDeterministicParagraph`.
 */
export const MIN_SENTENCE_CHARS = 12;
export const MAX_SENTENCE_CHARS = 420;
/** A published block: long enough to be prose, and short enough to stay a paragraph. */
export const MIN_PARAGRAPH_WORDS = 8;
export const MAX_PARAGRAPH_WORDS = 220;

/**
 * A section heading that opens on a gerund and has no finite verb in it.
 *
 * "Forecasting a threat to critical infrastructure." and "Evaluating
 * geomagnetic forecasts and infrastructure risk." are the Microsoft Research
 * read's own section titles, concatenated with the paragraph under them by the
 * extractor and published as sentences. A gerund is a verb form, so
 * `hasPredicate` accepts them.
 *
 * Bounded hard, because a real short sentence can open on a gerund ("Running
 * improves health."): at most nine words, no comma, no digit, no second
 * capitalised word and no finite auxiliary. A heading carries none of those; a
 * sentence reporting something almost always carries one.
 */
function bareGerundHeading(text: string): boolean {
  const match = /^[A-Z][a-z]+ing\b([^.!?]*)[.!?]?$/.exec(text.trim());
  if (!match) return false;
  if (text.trim().split(/\s+/).length > 9) return false;
  const rest = match[1] ?? "";
  if (/[,\d]/.test(rest)) return false;
  if (/\b[A-Z][a-z]{2,}/.test(rest)) return false;
  if (
    /(?:\b(?:is|are|was|were|has|have|had|will|would|can|could|may|might|must|should|does|do|did)\b)/i.test(
      rest,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * A phrase repeated three times or more is padding or boilerplate, not prose.
 *
 * Counted in one pass per phrase length, with a map, rather than by rebuilding
 * every window and comparing it against every other window. The old shape was
 * O(sizes x windows x windows) string joins, and on the 22:30Z reader's pool it was
 * **4.3 s of the gate's 15.1 s** -- 22.2% of a CPU profile of that gate, the single
 * most expensive function in the build. The predicate is the same one: a phrase of
 * five to eight words occurring three or more times, and the first length at which
 * it is found decides the boolean, so the return value is unchanged. Measured
 * 2026-10-16, CPU profile of `assessReadiness` over that reader's live pool.
 */
function repetitionBomb(text: string): boolean {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLowerCase());
  for (let size = 5; size <= 8; size++) {
    // Three occurrences need at least three phrases of this length.
    if (words.length < size * 3) break;
    const occurrences = new Map<string, number>();
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(" ");
      const seen = (occurrences.get(phrase) ?? 0) + 1;
      if (seen >= 3) return true;
      occurrences.set(phrase, seen);
    }
  }
  return false;
}

/**
 * Whether a stored block was cut rather than written.
 *
 * Two shapes mean truncation and nothing else. A block that stops without a
 * full stop is a feed's `description` halved at a byte limit: the corpus stored
 * "... now only $199.99 at Amazon", "... before shipping them to buyers in" and
 * "... even as the biggest money [...]" -- and the card printed each as if the
 * sentence had ended there. A block ending in a dotted abbreviation is the
 * splitter's cut, not the author's: "... in violation of U.S." is the front
 * half of "U.S. export controls", and it was stored as an event's entire
 * summary. A sentence that genuinely ends with an abbreviation is refused
 * alongside the fragment; the fragment is the worse error, and it is the one
 * the reader saw.
 */
export function isCutSentence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  // A quotation is quoted, not sentence-shaped: a unit ending in a closing mark
  // is the speaker's words, which the composer prints as they were said.
  if (/["”]$/.test(trimmed)) return false;
  // A terminal ellipsis is a cut, not a full stop.
  //
  // Providers truncate a feed description with `...` or `…`, and the
  // terminal-punctuation test below read that as a finished sentence -- so a
  // card printed "FreeType 2.15 is now available for this widely-used font
  // rendering library used across many different operating systems and software
  // applications..." to a reader. Measured on the live window (2026-10-15): ten
  // of the 24 card lines the shared sentence boundary refused were this shape,
  // and it refuses them as `trailing_ellipsis` -- so the classifier knew and
  // this helper, whose contract is to drop cut content, did not.
  //
  // Terminal only. An ellipsis inside an otherwise complete sentence is the
  // author's own punctuation and does not make the sentence cut (the arbiter's
  // ruling of 2026-10-15, which asked for exactly that boundary and no wider).
  if (/(?:…|\.\.\.)[)\]"”']*$/.test(trimmed)) return true;
  if (!/[.!?][)\]"”']*$/.test(trimmed)) return true;
  return /(?:^|\s)(?:[A-Z]\.)+$/.test(trimmed);
}

/** Reject only clear fragments; it deliberately does not attempt grammar correction. */
export function validDeterministicSentence(value: string): boolean {
  const text = value.trim();
  if (text.length < MIN_SENTENCE_CHARS || text.length > MAX_SENTENCE_CHARS) return false;

  // A sentence that *starts* with a provider field is not a sentence, whatever
  // else it contains. Normalization removes headers before this point, so a hit
  // here means a leak reached the validator -- and the structural test is what
  // keeps a metadata blob from passing on the strength of one ordinary word
  // ("Loopjacking" ends in "-ing" like a verb does).
  if (hasSourceMetadata(text)) return false;
  // An undecoded reference is not prose: it is four characters a reader was
  // never meant to see. Normalization decodes before this point, so a hit here
  // is a leak from a route that skipped it.
  if (HTML_LEFTOVER.test(text) || sourceMarkupOrUrl(text) || hasVisibleEntity(text)) return false;
  if (DANGLING_OPENING.test(text) || FRAGMENT_OPENING.test(text)) return false;
  if (TRUNCATED_DOMAIN_OPENING.test(text)) return false;
  if (SPLICE_OPENING.test(text) || COMMA_SUBORDINATOR.test(text)) return false;
  if (bareGerundHeading(text)) return false;
  if (BROKEN_ATTRIBUTION.test(text)) return false;
  if (/[,:;]$/.test(text) || /(?:\.\.\.|…)\s*$/.test(text)) return false;
  // Cut-off extraction seams, which are not sentences. "...45.141.21[.[" is an
  // ad unit spliced into a payload the splitter then halved; a run that ends on
  // an opener, or carries one unclosed, is the same class of half-unit.
  if (/[[({]$/.test(text) || unbalancedBrackets(text)) return false;
  // A name truncated to its initial: "... was co-led by Wellington and T." is the
  // front half of "T. Rowe Price", split at the initial's full stop. A dotted
  // abbreviation is the same shape one letter longer, and the corpus stored
  // "... in violation of U.S." as a whole unit. Read-time composition may add
  // punctuation to a sentence-shaped fragment (a caption seam's head has none),
  // so the terminal-stop half of the cut test belongs to storage, not here.
  if (/(?:^|\s)(?:[A-Z]\.)+$/.test(text)) return false;
  if ((text.match(/["“]/g)?.length ?? 0) !== (text.match(/["”]/g)?.length ?? 0)) return false;
  if (/^(?:the )?(?:report|study|article),?\s*[A-Z][^.!?]{0,80}\??$/.test(text)) return false;
  if (repetitionBomb(text)) return false;
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 3 && hasPredicate(text);
}

/**
 * A stored event summary, as it may be shown, or the reason it may not be.
 *
 * The event summary is written from a feed's `description` field, and it is
 * rendered on two reader-visible surfaces: the briefing card, and the article
 * deck a story falls back to when no evidence was extractable. Neither is a
 * composition path, so neither met the quality gate -- and the field itself is
 * not always prose. Providers use it for media credits, `git` trailers and
 * release-page labels, and arXiv uses it for a record header:
 *
 *   "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval ..."
 *   "Photograph: Alexandra Topping/The Guardian."
 *   "Signed-off-by: khluu khluu000@gmail.com"
 *
 * So the summary goes through the same boundary every other piece of provider
 * text does -- normalize first, then refuse what normalization leaves. Both
 * callers share this function because they must not be able to disagree: a value
 * that renders on the card and is refused for the deck (or the reverse) is the
 * bug this exists to prevent.
 *
 * Nothing is repaired. A summary that is metadata and nothing else comes back
 * empty, and an empty summary is a legitimate answer -- headline and sources is
 * a better page than a credit line presented as news.
 */
/** Whether a quotation is left open, which means the splitter cut inside it. */
export function unbalancedQuotes(text: string): boolean {
  return (
    (text.match(/"/g)?.length ?? 0) % 2 !== 0 ||
    (text.match(/“/g)?.length ?? 0) !== (text.match(/”/g)?.length ?? 0)
  );
}

/**
 * Whether a bracket opened in this unit was never closed in it -- a citation,
 * an aside or a footnote left half-copied by the extractor.
 *
 * Counts only the ASCII pairs an article body uses; a bracketed aside that
 * closes is prose and stays.
 */
export function unbalancedBrackets(text: string): boolean {
  const pairs: [RegExp, RegExp][] = [
    [/\[/g, /\]/g],
    [/\(/g, /\)/g],
    [/\{/g, /\}/g],
  ];
  return pairs.some(
    ([open, close]) => (text.match(open)?.length ?? 0) !== (text.match(close)?.length ?? 0),
  );
}

/**
 * The TLDs that make a bare dotted word read as a web address rather than a name.
 *
 * Kept in `reader-evidence` because the evidence pass refuses raw URLs before
 * they become facts. The list is deliberately short; see `RAW_URL_WITH_PATH`.
 */
const WEB_TLD = "(?:com|org|net|io|ai|app|dev|gov|edu|co|uk|jp|us|news|blog|xyz|me|info|site|sh)";

/**
 * A URL published as prose (the D9 ruler).
 *
 * Three shapes: a scheme, a `www.` prefix, or a bare host with a recognised TLD.
 */
export const RAW_URL = new RegExp(
  `\\b(?:https?:\\/\\/[^\\s]+|www\\.[^\\s]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${WEB_TLD}(?:\\/[^\\s]*)?)`,
  "i",
);

/**
 * The narrower defect class used by the shipping rule.
 *
 * Bare domains such as "WordPress.com" are often ordinary nouns; the defects the
 * owner flagged carried a path or scheme. The rule therefore refuses only this
 * shape, leaving the audit's wider `RAW_URL` ruler to count addresses for review.
 */
export const RAW_URL_WITH_PATH = new RegExp(
  `\\b(?:https?:\\/\\/[^\\s]+|www\\.[^\\s]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${WEB_TLD}\\/[^\\s]*)`,
  "i",
);

/**
 * Words a sentence cannot end on, so the period is a clipping cut rather than a
 * stop. Months and a short list of forward-binding function words.
 */
const DANGLING_TAIL =
  /(?:\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.|\b(?:the|a|an|and|or|but|of|between|into|during)\.)$/i;

/**
 * A sentence that ends where prose cannot.
 *
 * Returns the offending sentence or ""; bounded by a length floor so a bare date
 * or short line is not called truncated.
 */
export function truncatedSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (!DANGLING_TAIL.test(trimmed)) return "";
  const words = trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  if (words < 5) return "";
  return trimmed;
}

/**
 * Whether a unit opens inside a name the source spells in full somewhere else.
 *
 *   unit    "Rowe Price, large institutional investors that back private ..."
 *   context "... co-led by Wellington and T. Rowe Price."
 *
 * The stored unit is the tail of one sentence an earlier split cut in half at
 * the initial's full stop. The two opening tokens are both capitalised -- a
 * bare surname opening a sentence is ordinary prose ("Smith expects earnings
 * to rise."), and a name that opens with its initial ("T. Rowe Price said ...")
 * is whole -- so the rule only fires on the middle of a multi-token name.
 */
function nameContinuationFragment(text: string, context: string): boolean {
  const opening = /^([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/.exec(text.trim());
  if (!opening) return false;
  return new RegExp(`\\b[A-Z]\\.\\s+${opening[1]}\\s+${opening[2]}\\b`).test(context);
}

/**
 * A subjectless instruction, addressed to the reader: documentation, not news.
 *
 * "Implement re-authentication across device setup and cloud restores using
 * Jetpack Credential Manager." and "Configure unit test suites, Compose UI
 * testing rules, and screenshot testing infrastructure." were published as
 * facts, attributed "according to Android Developers" -- instructions to a
 * developer, carrying no claim about the world. Release feeds use the same
 * voice for their changelogs ("Add unstable parameter matching APIs: #97393"),
 * and there the imperative was stitched with its neighbours into one published
 * sentence that read as ordinary reporting.
 *
 * The rule is the open verb with no actor in front of it -- the closed list is
 * measured, not imagined: 19 published sentences opened this way on the frozen
 * corpus, 17 of them genuine instructions. The two casualties are prose and a
 * caption ("Take this display at Alcantarí International Airport, which serves
 * Sucre, Bolivia's constitutional and judicial capital."), accepted as the
 * cost of the rule and recorded as its accepted cost -- two sentences, each
 * refused once, in two different stories, not a recurring family on the corpus
 * (ruling, 2026-10-04). Refusal rather than rewrite: turning
 * "Use BF16 compute type" into "the release uses BF16" would invent a claim
 * the imperative does not make. Measured cost: 15 instruction sentences never
 * publish again; the release stories keep 3+ facts each and stay alive.
 */
const INSTRUCTION_VERBS =
  "Detect|Integrate|Replace|Deploy|Configure|Use|Try|Read|Learn|Follow|Get|See|Set|Build|Create|Manage|Enable|Install|Update|Run|Add|Make|Publish|Host|Apply|Register|Sign|Check|Implement|Test|Write|Support|Handle|Fix|Remove|Improve|Allow|Prevent|Ensure|Include|Continue|Point|Ground|Access|Explore|Discover|Watch|Listen|Bring|Protect|Track|Reduce|Control|Filter|Scan|Verify|Keep|Put|Give|Take";
const INSTRUCTION_OPENING = new RegExp(`^(?:${INSTRUCTION_VERBS})\\b`);
/** The same list after a label, where the publisher wrote the verb in lowercase. */
const INSTRUCTION_OPENING_FOLDED = new RegExp(`^(?:${INSTRUCTION_VERBS})\\b`, "i");

/**
 * A short label does not change what a unit is.
 *
 * "Android Intent security: Detect and prevent implicit intent hijacking..."
 * and "CameraX: Replace legacy Camera1/Camera2 code with lifecycle-aware
 * CameraX." were published as facts while their unlabelled siblings were
 * refused: the imperative test is anchored at position 0, and a component
 * label pushed the verb off it. The same shape hid llama.cpp changelog bullets
 * ("Model: support nimble decision model (#29844) Website: ...") -- the family
 * F4 refuses without a release-feed carve-out. The label is bounded at four
 * tokens before the colon, so a sentence that merely contains a colon
 * ("They're more like coworkers: business software that can use other
 * software.") is not touched, and the remainder is judged by the same closed
 * verb list, so the mechanism stays one predicate. Measured before landing on
 * the 2026-10-03 fresh corpus: newly refuses 13 units, 10 of them published or
 * selected, and none of the 21 colon-labelled candidates that are real claims
 * (the counterexample census -- 0 false positives).
 */
const LABEL_PREFIX = /^[A-Z][\p{L}\d'’&.-]*(?:\s+[#\d\p{L}'’&.-]+){0,3}\s*:\s+(?=\S)/u;

/**
 * The publisher's own mark that a unit is advice, not reporting.
 *
 * The GitHub post labelled its own region ("Here's where to focus:", then
 * "Tip #1:", "Tip #2:", "Tip #3:", each closed by "Takeaway:") and three of
 * the numbered tips published as facts. This rule is the numbered mark only --
 * three measured units, one source, no measured counterexamples. "Takeaway:",
 * "Notice what changed." and the prompt example stay for now: a label alone is
 * not a safe refusal shape, and none of the three has a structural
 * discriminator that is not a new verb or a vocabulary blacklist (ruling,
 * 2026-10-05).
 */
const TIP_LABEL = /^Tip\s*#?\d+\s*:/i;

function instructionOpening(text: string): boolean {
  // A label can sit inside a label: "Here's where to focus: Tip #1: Learn to
  // direct AI..." and "For example: Issue #4821 Title: Add dark mode..." are
  // the same instructional units with their region lead-in still attached, and
  // they reached the reader from the entity path's re-read of the raw excerpt
  // after the clean variant was refused. The lookthrough repeats, bounded at
  // two labels, and each remainder is judged by the same closed list or the
  // numbered-tip mark, so the refusal cannot be evaded by re-reading the unit
  // in a longer form.
  let rest = text.trim();
  for (let labels = 0; labels <= 2; labels += 1) {
    if (INSTRUCTION_OPENING.test(rest) || TIP_LABEL.test(rest)) return true;
    const labelled = LABEL_PREFIX.exec(rest);
    if (!labelled) return false;
    rest = rest.slice(labelled[0].length);
    if (INSTRUCTION_OPENING_FOLDED.test(rest)) return true;
  }
  return false;
}

/**
 * The newsletter's own index of itself.
 *
 * A weekly newsletter identifies itself ("Welcome back to This Week in
 * Stratechery!"), then runs a labeled section -- "Stratechery Articles and
 * Updates." -- of `Title — blurb` pairs, title lists and promo lines. Those
 * are the publication's table of contents for its own previous articles, and
 * the composer published them as the story: 6 index entries on the frozen
 * corpus, every one about other coverage (topic overlap ~0, cross-
 * representation 0). The provenance decides, not the typography: the rule
 * fires only inside a source whose text identifies it as a newsletter, and it
 * keeps the same source's essay prose -- the front-matter blurbs ("Can Meta
 * Focus? It's risky, both as a technical person ...") are ordinary sentences
 * with subjects and verbs, and they survive. Measured cost: 6 index entries,
 * which is the whole measured population; the story keeps 8 of its 14 facts.
 */
const NEWSLETTER_CONTEXT =
  /\bWelcome back\b|\beach week\b|\bweekday newsletter\b|\bThis Week in\b/i;
const INDEX_PROMO =
  /\b(?:Dithering|This week['’]s \w+ video|Stratechery Update|Articles and Updates|The Update|pass along)\b/i;

/** Whether a text's words are headline-cased: mostly initial capitals. */
function headlineCased(head: string): boolean {
  const words = head.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));
  if (words.length < 2) return false;
  const caps = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return caps / words.length >= 0.6;
}

/** A `Title — blurb` pair: a dash whose left side is a headline, not a sentence. */
function indexDashUnit(text: string): boolean {
  const dash = text.match(/\s[—–]\s/);
  if (!dash || dash.index === undefined) return false;
  const head = text.slice(0, dash.index).trim();
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 14 || hasPredicate(head)) return false;
  return headlineCased(head) && hasPredicate(text.slice(dash.index));
}

/** A semicolon run of titles: "Era for the US; Xi Welcomes; Domestic Crackdowns". */
function indexListUnit(text: string): boolean {
  if (!/;\s*\S/.test(text)) return false;
  const segments = text.split(";").map((part) => part.trim());
  if (segments.length < 3 || !segments.every((part) => part.split(/\s+/).length <= 10))
    return false;
  return headlineCased(segments[0] ?? "");
}

function newsletterIndexUnit(text: string, context: string | undefined): boolean {
  // The provenance is the gate: without a source that identifies itself as a
  // newsletter, a dash or a semicolon list is ordinary prose and stays.
  if (!context || !NEWSLETTER_CONTEXT.test(context)) return false;
  return INDEX_PROMO.test(text) || indexDashUnit(text) || indexListUnit(text);
}

/**
 * The textual rules a candidate unit must satisfy to become a published fact.
 *
 * Shared, because there is more than one path that can turn a source sentence
 * into prose: the evidence pass, and the entity pass in the composer that
 * rebuilds a sentence because it names somebody. The second one used to apply
 * only validity and publisher voice, so a sentence the evidence pass had already
 * refused -- an unattributed quotation, a fragment whose subject was a pronoun
 * pointing outside itself -- came back through the entity path and was published
 * anyway. One predicate, so "refused" means refused wherever the sentence is
 * re-read from.
 */
export function unitTextRejection(
  text: string,
  quote: boolean,
  context?: string,
): EvidenceRejectionReason | null {
  // A subhead that arrived as a unit of its own, first, because it passes every
  // test below: "Why identity built for humans breaks at agent speed" has a
  // subject and a verb, which is why a heading used to reach the page as a
  // sentence -- and, the moment the wh-word rule was deleted, why it came back as
  // the production fixture's deck.
  if (headingUnit(text)) return "headline_fragment";
  // Two source blocks published as one sentence -- a heading or a session credit
  // line joined to the prose under it. This is `invalid_sentence` and not a
  // category of its own, because that is exactly what the unit stopped being: one
  // sentence. See `sourceSeam` for why the seam cannot be cut back apart.
  if (sourceSeam(text)) return "invalid_sentence";
  // `noMainClause` deliberately has no hook here. Measured 2026-10-14 over 7,842
  // live-window units, the shipped rule refuses 12, and 11 of them are ordinary
  // prose the reader must keep: "Today's epic patch batch dwarfs September's record
  // of nearly 1,000 fixes, which was already about ten times the normal monthly
  // patch load from Redmond.", "Consumers fetch data from Buftee ..., like
  // ClickHouse, which we rely on heavily.", "The attack comes during a particularly
  // miserable spell for fashion retailers, which seem to be attracting
  // cybercriminals ...". Each carries a main-clause verb the closed verb lists do
  // not hold ("dwarfs"), or a main clause the comma cut cannot reach. At the deck
  // boundary the same test refuses none of the 57 live decks that carry a relative
  // clause, and that is where the defect was read: a body sentence has the block
  // before it, and the deck has nothing.
  //
  // A unit that begins inside a name the source spells in full elsewhere:
  // "Rowe Price, large institutional investors ..." after "Wellington and T.
  // Rowe Price" is the tail of one sentence that an earlier split cut in half at
  // the initial. The head is in another unit, so this one has no subject -- but
  // it carries verbs enough to pass every local test ("that back", "goes"),
  // which is why the source's own text decides.
  if (context && nameContinuationFragment(text, context)) return "invalid_sentence";
  // The publication's own furniture: a masthead bio, an arXiv solicitation, a
  // vendor's ad unit, a conference promo. A closed phrase set, because grammar
  // cannot refuse these -- they are complete sentences -- and it is read before
  // the grammar test so a unit that is furniture is counted as furniture rather
  // than as the invalid sentence its truncation also makes it.
  if (publisherFurniture(text)) return "editorial_noise";
  // A source typo that leaves the sentence with no reading that is true --
  // `nothing` where `noting` belongs, measured on the live story of 2026-10-17
  // and ruled into this class the same day (ruling #6). Refused, not repaired.
  if (sourceTypo(text)) return "editorial_noise";
  // A dateline whose month the extractor dropped: the sentence opens on a day
  // with no month and then states the date again (delivered card 16 of
  // 2026-10-20). The source's own text, refused rather than repaired.
  if (truncatedDateline(text)) return "editorial_noise";
  // The same family, one layer closer to the reader: a sourcing note the article
  // writes about how it got the story. It is a complete sentence with no fact in
  // it, so the grammar tests pass it -- and one of them reached the Combs story
  // on 2026-10-17 -- which is why it is charged here rather than left to the
  // composer's gate.
  if (sourcingNote(text)) return "editorial_noise";
  // The newsletter's index of its own previous articles: a labeled table of
  // contents, not the story. Provenance-gated -- see `newsletterIndexUnit`.
  if (newsletterIndexUnit(text, context)) return "newsletter_index";
  // The source's own typesetting, when safe normalization could not remove it.
  // `\textbf{OpenSpace Lab}` is unwrapped upstream and survives; `$2^{128}$`
  // cannot be rewritten without changing what the authors wrote, so the unit
  // goes. Measured over the 2026-10-03 corpus this reached 12 of the 100
  // shipping stories, all of them research abstracts -- the reader sees a
  // backslash, and a reader does not need to know LaTeX to notice that
  // something went wrong.
  if (sourceMarkupRemains(text)) return "source_markup";
  // A commit trailer or a changelog dump, refused at the boundary every surface
  // asks. The predicate was ruled for the card and the email on 2026-10-15 (see
  // `developmentRecord`); the story page was the surface that never asked it, and
  // the newest window published seven of these sentences in one release story --
  // `Assisted-by: pi:llama.cpp/... pi: use emoji in the AI stats disclosure.` and
  // `Tests: catch vanished rows in the fusion baseline (#30618) tests: update the
  // Metal fusion baseline.` -- as paragraphs of an article. Same reason family and no
  // new counter, as that ruling required: the reader is shown nothing rather than
  // a build log, and the controls below keep news that merely cites a pull request
  // (`Google released Chrome 141 on Tuesday, and its changelog lists 42 security
  // fixes.`) untouched.
  //
  // `instructionOpening` is exempted rather than reordered: a changelog *bullet* is
  // also a subjectless instruction, its reason is `imperative_instruction`, and the
  // ruling already counts that class. Naming it here keeps the unit in the counter it
  // was measured in, without letting a dump answer `editorial_noise` only because its
  // first word was not a verb.
  if (!quote && !instructionOpening(text) && developmentRecord(text)) return "editorial_noise";
  if (!validDeterministicSentence(text)) return "invalid_sentence";
  if (unresolvableContext(text)) return "unresolved_context";
  if (/…$|\.\.\.$/.test(text)) return "trailing_ellipsis";
  if (unbalancedQuotes(text)) return "unbalanced_quote";
  // A quotation that opens a unit and names nobody is not attributable: the
  // reader cannot tell who said it, and nyuz did not say it.
  //
  // Its prose sibling is the next rule: a claim is as uncheckable when it rests
  // on an unnamed "analysts" as when it rests on an unopened quote, and the
  // composer already counts a collective noun as an attribution, so the sentence
  // would otherwise be published believing it carried provenance.
  if (/^["“]/.test(text) && !/\b(?:said|says|told|according to)\b/.test(text))
    return "unassigned_quote";
  // A subjectless instruction is addressed to the reader, not about the world:
  // it cannot become a fact without inventing the actor who does it. Quotations
  // are excluded -- an imperative inside someone's speech is their words, and
  // the quote rules above own it. A short label ("CameraX:", "Tip #1:") does
  // not change what the unit is -- see `instructionOpening`.
  if (!quote && instructionOpening(text)) return "imperative_instruction";
  if (!quote && !hasPredicate(text)) return "no_predicate";
  if (unverifiableAttribution(text)) return "unverifiable_attribution";
  return null;
}

export function normalizeSummary(text: string): { text: string; reason: string | null } {
  // Checked before normalization so the reason names the furniture class rather
  // than the fact that removing it left nothing.
  const opening = providerFurniture(text);
  if (opening) return { text: "", reason: opening };
  const normalization = normalizeSourceText(undefined, text);
  if (normalization.metadataOnly) return { text: "", reason: "metadata_only" };
  const clean = normalization.text;
  const buried = providerFurniture(clean);
  if (buried) return { text: "", reason: buried };
  if (hasSourceMetadata(clean)) return { text: "", reason: "metadata_leak" };
  return { text: clean, reason: null };
}

/**
 * The identical-comparison key used for deck and paragraph dedupe: punctuation
 * and case removed, so "...security boundary." and "...security boundary" are
 * one sentence.
 */
export function sentenceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$€£]+/gu, " ")
    .trim();
}

/**
 * A paragraph is validated as a paragraph: its sentences as sentences, and the
 * block only as a block.
 *
 * This exists to fix a real production loss. Three facts that each passed
 * `validDeterministicSentence` were grouped into one 462-character paragraph;
 * the quality gate then handed that whole paragraph to the *sentence* validator,
 * which refuses anything over `MAX_SENTENCE_CHARS`, and the block was discarded
 * -- taking two publishable facts with it. A paragraph's size limit is its word
 * count; character limits belong to the unit a character limit can describe.
 */
export function validDeterministicParagraph(value: string): boolean {
  const text = value.trim();
  if (text === "") return false;
  const sentences = readerSentences(text).filter((part) => part.trim() !== "");
  if (sentences.length === 0) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_PARAGRAPH_WORDS || words > MAX_PARAGRAPH_WORDS) return false;
  // A provider field that survived to a paragraph is a leak, however the block
  // was assembled.
  if (hasSourceMetadata(text)) return false;
  // The same sentence twice is a composition error, not a paragraph.
  const keys = sentences.map((part) => sentenceKey(part));
  if (new Set(keys).size !== keys.length) return false;
  return sentences.every((part) => validDeterministicSentence(part));
}

/**
 * Whether two statements are the same claim in different amounts of furniture.
 *
 * The case this exists for: a provider header glued to a sentence
 * (`ArXiv:2609.21081v1 Announce Type: new Abstract: <sentence>`) and the same
 * sentence on its own. Normalization removes the header before either becomes
 * evidence, but stored evidence from before that fix, and any second copy of a
 * claim written with an extra source label, still have to compare equal.
 *
 * Two deliberate restrictions:
 *
 * - Word order is preserved. A token-set comparison would call "Acme acquired
 *   Beta" and "Beta acquired Acme" the same claim, which is the opposite of
 *   true, so containment is checked as a contiguous run.
 * - Figures must match. "...$20 million" and "...$21 million" are different
 *   claims however similar their wording.
 *
 * The extra material is also bounded, so a three-word summary is not swallowed
 * by a long sentence that merely starts with it.
 */
export function nearDuplicate(left: string, right: string): boolean {
  const a = centralTokens(left);
  const b = centralTokens(right);
  if (a.length < 3 || b.length < 3) return false;
  if (numericKeys(left).sort().join("|") !== numericKeys(right).sort().join("|")) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const extra = longer.length - shorter.length;
  if (extra > 10) return false;
  // The surplus must stay a minority of the longer statement: a prefix or a
  // source label is furniture, a second clause is new information.
  if (shorter.length / longer.length < 0.6) return false;
  return contiguousRun(shorter, longer) || restated(left, right);
}

function contiguousRun(shorter: string[], longer: string[]): boolean {
  for (let start = 0; start + shorter.length <= longer.length; start++) {
    let matched = true;
    for (let offset = 0; offset < shorter.length; offset++) {
      if (shorter[offset] !== longer[start + offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Content tokens in the order they were written, repeats kept.
 *
 * Distinct from `centralTokens`, which collapses to a set: a set is the right
 * shape for "how much vocabulary do these share", but it erases where a word
 * stood, and a diff needs position. "Never let it go" and "let it go" are one
 * deletion apart, and a set cannot tell.
 */
function orderTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? [])
    .map((token) => token.replace(/[.-]+$/, ""))
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function longestSharedRun(
  left: string[],
  right: string[],
): { length: number; atLeft: number; atRight: number } {
  let best = { length: 0, atLeft: 0, atRight: 0 };
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      let run = 0;
      while (i + run < left.length && j + run < right.length && left[i + run] === right[j + run]) {
        run++;
      }
      if (run > best.length) best = { length: run, atLeft: i, atRight: j };
    }
  }
  return best;
}

/**
 * How many tokens the two share in the same order, counting each once.
 *
 * Greedy longest-run-first, and runs shorter than three tokens are ignored: two
 * sentences about one subject agree on a phrase like "security researchers"
 * often enough that a shared bigram means nothing, while a run of three content
 * words or more is text one of them took from the other.
 */
function sharedTokenCount(left: string[], right: string[]): number {
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  let total = 0;
  const ceiling = Math.min(12, left.length, right.length);
  for (let length = ceiling; length >= 3; length--) {
    for (let i = 0; i + length <= left.length; i++) {
      for (let j = 0; j + length <= right.length; j++) {
        let run = 0;
        while (run < length && left[i + run] === right[j + run]) run++;
        if (run !== length) continue;
        let fresh = true;
        for (let offset = 0; offset < length; offset++) {
          if (usedLeft.has(i + offset) || usedRight.has(j + offset)) fresh = false;
        }
        if (!fresh) continue;
        for (let offset = 0; offset < length; offset++) {
          usedLeft.add(i + offset);
          usedRight.add(j + offset);
        }
        total += length;
      }
    }
  }
  return total;
}

/**
 * Whether two statements are one claim said twice in different words.
 *
 * `contiguousRun` above only recognises containment: one statement standing
 * inside the other word for word. Real restatements are not that tidy. Measured
 * on a 150-story production sample, every pair a reader would call duplicated
 * differed *inside* the shared text rather than only at its edges:
 *
 *     "...reduces Multimodal Large Language Model-side latency by 61.8%..."
 *     "...reduces model-side latency by 61.8%..."
 *
 *     "...Hideo Kojima said that, considering the broader state of the
 *      industry..."
 *     "...Kojima said that, considering the broader state of the..."
 *
 * while the pairs that must NOT merge -- two different facts reported under the
 * same opening -- shared only a preamble. So the test is coverage, not
 * containment, and it takes one of two shapes:
 *
 * - Interleaved: 80% of the two statements' tokens, counted once, appear in the
 *   same order in both. Paraphrase inside the claim is allowed; a new clause is
 *   not, because it adds tokens that do not match anywhere.
 * - Trimmed: one statement is the other with a short span rewritten, where the
 *   surviving run is anchored at an end of it and covers most of it. This is
 *   containment's neighbourhood -- the shared text still has to be most of the
 *   shorter statement, and the longer one may exceed it by ten tokens at most.
 *
 * Figures still have to agree (`nearDuplicate` checks them first), and the two
 * statements still have to be comparable in length. The preamble-only case fails
 * both shapes: its shared run is neither anchored nor large enough to carry the
 * claim.
 */
function restated(left: string, right: string): boolean {
  const a = orderTokens(left);
  const b = orderTokens(right);
  if (a.length < 3 || b.length < 3) return false;
  if (Math.abs(a.length - b.length) > 10) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // Cheap prefilter. The ordered diff below walks three nested loops, so it only
  // runs on pairs already sharing most of their vocabulary.
  const vocabulary = new Set(longer);
  let present = 0;
  for (const token of new Set(shorter)) if (vocabulary.has(token)) present++;
  if (present / new Set(shorter).size < 0.7) return false;
  if ((2 * sharedTokenCount(a, b)) / (a.length + b.length) >= 0.8) return true;
  const run = longestSharedRun(shorter, longer);
  if (run.length < 5 || run.length / shorter.length < 0.7) return false;
  // The run has to reach an edge of one of the two statements -- a prefix or a
  // suffix -- because that is what an edit at the seam looks like. A run buried
  // in the middle of both is two claims sharing a clause, which is how the pairs
  // that must not merge are built.
  const anchoredInEither =
    run.atLeft === 0 ||
    run.atLeft + run.length === shorter.length ||
    run.atRight === 0 ||
    run.atRight + run.length === longer.length;
  return anchoredInEither;
}

/**
 * How much source furniture a statement carries: a provider field glued to its
 * front, a stated attribution opener, a label-like prefix. Deliberately not the
 * shortest version: a variant that names the person ("Richard Schut and his team
 * discovered") is the cleaner one, not the lossier one.
 */
function sourceFurniture(text: string): number {
  let count = 0;
  if (hasSourceMetadata(text)) count += 2;
  if (/^(?:according to|as reported by)\s/i.test(text)) count += 1;
  if (/^[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?\s*:\s/.test(text)) count += 1;
  return count;
}

/**
 * When two variants of one claim merge, keep the one carrying less furniture.
 * Never depends on which variant arrived first, so a dirty-then-clean and a
 * clean-then-dirty pair converge on the same text.
 */
export function preferCleaner(existing: string, candidate: string): boolean {
  return sourceFurniture(candidate) < sourceFurniture(existing);
}

/** Normalize numeric spellings for comparison only; original text remains unchanged. */
export function normalizedNumericKey(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|m|k)\b/gi,
      (_, n: string, unit: string) => {
        const scale =
          {
            trillion: "e12",
            tn: "e12",
            billion: "e9",
            bn: "e9",
            million: "e6",
            mn: "e6",
            thousand: "e3",
            k: "e3",
            m: "e6",
          }[unit.toLowerCase()] ?? unit.toLowerCase();
        return `${Number(n.replace(/,/g, ""))}${scale}`;
      },
    )
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (word) =>
      String(
        ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"].indexOf(
          word.toLowerCase(),
        ) + 1,
      ),
    )
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function deterministicFactType(text: string, quote = false): DeterministicFactType {
  if (quote) return "quote";
  if (/\b(?:projects?|forecast|model(?:led|s|ing)?|predicts?|between \d|by \d{4})\b/i.test(text))
    return "projection";
  if (/\b(?:estimates?|expects?|could|may|might|according to|claims?|argues?|warns?)\b/i.test(text))
    return "estimate";
  if (
    /\b(?:plans?|will (?:release|publish|launch|build|continue)|next report|scheduled|to be published)\b/i.test(
      text,
    )
  )
    return "future_action";
  if (
    /\b(?:previously|earlier|in \d{4}|historically|compared with|compared to|due to|behind|creator of|framework)\b/i.test(
      text,
    )
  )
    return "background";
  if (/\b(?:more than|less than|versus|compared|from .* to|between .* and)\b/i.test(text))
    return "comparison";
  if (/\b(?:said|says|argues?|claims?|warns?)\b/i.test(text)) return "claim";
  return "fact";
}

/**
 * Where a sentence sits in the story, for ordering only.
 *
 * Every gate in this file asks "may this be published". None of them asks "where
 * does it belong", which is why a briefing could pass all of them and still read
 * as assembled: the deck said what happened, the next line gave the reader
 * subscription terms, a stranger's opinion came third, and the sentence
 * explaining what the product actually DOES did not arrive until fourth. Nothing
 * was wrong with any single sentence; the defect existed only in the order.
 *
 * This is a classifier, not a planner. It answers one question -- is this
 * sentence about what the thing does, who can get it, how people reacted, or a
 * commercial detail -- and the composer sorts by the answer. There is no attempt
 * to understand the narrative, and none is needed: the progression a reader
 * wants is the same in most stories.
 *
 * `capability` leads deliberately. The deck already carries the event, so a body
 * that opens by restating it would waste the reader's first line; what the body
 * owes them next is what the thing does.
 */
export type StoryPosition = "capability" | "availability" | "impact" | "detail" | "commercial";

/** Lower sorts earlier. One array so the order is visible in one place. */
const STORY_POSITION_RANK: Record<StoryPosition, number> = {
  capability: 0,
  availability: 1,
  impact: 2,
  detail: 3,
  commercial: 4,
};

const CAPABILITY =
  /\b(?:can|could|is able to|are able to|allows?|enables?|lets?\s|features?|capable of|works? by|handles?|completes?|performs?)\b/i;
const AVAILABILITY =
  /\b(?:available to|available for|available from|will be available|be available|only for|restricted to|limited to|subscribers?|customers only|free tier|rolling out|generally available|public beta|early access|waitlist)\b/i;
const COMMERCIAL =
  /\b(?:pricing|price|prices|costs?|costing|fee|fees|charge[ds]?|charging|billing|subscription|subscriptions|per month|\$\d|revenue|paid plan|upgrade)\b/i;
const IMPACT =
  /\b(?:warns?|warned|risks?|risk is|concerns?|criticism|critics?|reaction|reactions|opposition|backlash|analysts?|experts?|observers?|regulators?|criticised|criticized|questioned)\b/i;

export function storyPosition(text: string): StoryPosition {
  // Commercial is checked before availability because "available to paying
  // subscribers" is both, and it reads as a commercial term to a reader. The
  // reader's question about it is when they can get it, but the sentence is
  // about the deal, and treating it as the deal keeps it away from the front
  // where it used to outrank the explanation of the product itself.
  if (COMMERCIAL.test(text)) return "commercial";
  if (AVAILABILITY.test(text)) return "availability";
  if (IMPACT.test(text)) return "impact";
  if (CAPABILITY.test(text)) return "capability";
  return "detail";
}

/** The rank the composer sorts a paragraph by: its earliest position wins. */
export function storyPositionRank(text: string): number {
  return STORY_POSITION_RANK[storyPosition(text)];
}

export function sourceNameForEvidence(
  evidence: number[],
  sources: ReaderSource[],
): string | undefined {
  const name = sources[evidence[0]! - 1]?.name;
  if (name === undefined) return undefined;
  // Normalized here rather than at each call site: this is the string the
  // composer pastes in front of a reported sentence, and a stored name still
  // carrying `&#x20;` or a double space is what makes an attribution read
  // `The  Register reports that ...`.
  const clean = normalizePlainText(name);
  return clean === "" ? undefined : clean;
}

/* ------------------------------------------------------------------------- */
/* Source furniture: headlines, standfirsts, repeated headlines              */
/* ------------------------------------------------------------------------- */

/** Every word of `text` with the offset it starts at. */
function wordOffsets(text: string): { word: string; at: number }[] {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((match) => ({
    word: match[0],
    at: match.index ?? 0,
  }));
}

/**
 * Remove the source's own headline from the front of its text.
 *
 * A feed `description` very often begins by repeating the item's title -- the
 * CMS writes the standfirst into the same field, and the title is prepended to
 * it. The title is furniture: it is already rendered above the article as the
 * story headline, and repeating it inside the first sentence produces "According
 * to The Register, <headline> <first sentence>" -- two sentences glued by the
 * absence of a full stop between them.
 *
 * Compared word by word rather than by substring, so punctuation and case do not
 * matter and a genuine sentence that merely starts with the same few words is
 * left alone. Three words minimum, because a two-word title would match the
 * opening of half the prose in the feed.
 */
export function stripHeadlinePrefix(
  text: string,
  headline: string | undefined,
): { text: string; stripped: boolean } {
  const wanted = sentenceKey(headline ?? "")
    .split(" ")
    .filter(Boolean);
  if (wanted.length < 3) return { text, stripped: false };
  const tokens = wordOffsets(text);
  if (tokens.length < wanted.length) return { text, stripped: false };
  const opening = tokens.slice(0, wanted.length).map((token) => sentenceKey(token.word));
  if (opening.join(" ") !== wanted.join(" ")) return { text, stripped: false };
  const last = tokens[wanted.length - 1]!;
  const rest = text
    .slice(last.at + last.word.length)
    .replace(/^[\s,;:.\u2013\u2014-]+/, "")
    .trim();
  return { text: rest, stripped: true };
}

/**
 * A subhead that arrived as a unit of its own.
 *
 * ---------------------------------------------------------------------------
 * What this replaced, and why the replacement is this narrow
 * ---------------------------------------------------------------------------
 *
 * The rule here was `WH_HEADLINE + no question mark`: any unit opening on
 * Why/How/What/When/Where/Who/Which/Here was treated as a heading. Over the
 * frozen 200-event corpus it refused 19 units, and a census of them
 * (`scripts/reader-headline-census.ts`) found **0** that were the source's own
 * headline and 16 that were ordinary sentences -- `When F-Droid first appeared,
 * ...`, `When asked to compare MariaDB with PostgreSQL for the same task, ...`,
 * four arXiv abstract sentences. Deleting the rule returned 11 of them to the
 * pipeline, and the census of that corpus showed no furniture published.
 *
 * What it also did was publish the production fixture's standfirst:
 *
 *   "According to The Register, Why identity built for humans breaks at agent
 *    speed."
 *
 * as the deck, because that string is a complete sentence with a subject and a
 * verb and nothing else refuses it. So the wh-word list is gone, and what
 * remains is the part of the old rule that a *sentence* cannot imitate:
 *
 *   - it opens on a wh-word, and
 *   - it carries no question mark, and
 *   - it has no clause boundary inside it -- no comma, dash, semicolon or
 *     parenthesis -- and
 *   - it is not a cleft (`What has been missing so far is a finite-size method
 *     for ...`), which is a sentence even with no comma in it.
 *
 * Every one of the 16 legitimate sentences above has one of those two shapes and
 * is admitted; a heading like the standfirst has neither and is refused.
 *
 * The known gap is a heading that a provider glued to its own prose *with* commas
 * inside the glue -- the PyTorch blog's `What to Expect from the Introduction
 * Track All attendees, from students, ...` -- which this admits. The frozen
 * corpus is where that is measured rather than argued, and there it is never
 * selected, so it never reaches a reader.
 */
const WH_OPENING = /^(?:Why|How|What|When|Where|Who|Which|Here)\b/;
/** Anything that separates one clause from the next inside a sentence. */
const CLAUSE_BOUNDARY = /[,;:—–]|\s-\s|[()]|,\s/;
/** `What has been missing so far is a finite-size method for evaluating ...` */
const CLEFT_OPENING =
  /^(?:What|Who|Which|Where|How)\b[^,;:—–()]{0,120}?\b(?:is|are|was|were|has been|have been|remains|seems)\b/;

export function headingUnit(text: string): boolean {
  const trimmed = text.trim();
  if (!WH_OPENING.test(trimmed)) return false;
  if (/\?/.test(trimmed)) return false;
  if (CLAUSE_BOUNDARY.test(trimmed)) return false;
  if (CLEFT_OPENING.test(trimmed)) return false;
  return true;
}

/**
 * A feed's own footer around the item it just delivered.
 *
 * `The post AI is changing developer work. Here are three skills to strengthen.
 * appeared first on The GitHub Blog.` reached a reader four ways on the frozen
 * corpus: as the deck, as the tail of two paragraphs, and split into a fragment
 * ("Appeared first on The GitHub Blog.") when the item's own headline -- which
 * contains a full stop -- made `readerSentences` cut the footer into three
 * sentences. No unit-level test can see any of that, because the footer is not
 * a unit: it is the feed's wrapper around the item, which is this function's
 * boundary, and it is cut here before the splitter ever runs.
 *
 * Anchored to the end of the text and bounded on both sides, so prose that
 * merely mentions a post is left alone; a text that is only the footer comes
 * back empty, which the caller rejects rather than repairs.
 *
 * The tail is bounded by the shape of a footer rather than by a character count
 * that happens to be large. It used to be `[\s\S]{0,120}?[.!?]?\s*$`, which is
 * not a bound at all -- it consumes up to 120 characters of whatever follows the
 * phrase, and `appeared first on` is not confined to the end of a feed item. In
 * `understand.test.ts` the phrase sits in the *middle* of an excerpt, and the
 * 120 characters after it took the only real fact in it with them: the factory
 * sentence never became a unit, so the story published with no facts at all.
 *
 * A footer's tail is the outlet's own name and nothing else, so it is one short
 * run of characters with no sentence terminator inside it, ending the text. Any
 * second full stop means prose follows the attribution, and prose after the
 * phrase is never furniture.
 */
const POST_FOOTER = /\bthe post\b[\s\S]{0,300}?\bappeared first on\b[^.!?]{1,60}[.!?]?\s*$/i;

/**
 * Drop the furniture a source wrapped around its own text, before it is read.
 *
 * Two shapes: the item's headline repeated at the front of the description, and
 * the feed's footer at the end. Both are "what the provider shipped" rather than
 * "what happened", which is the boundary this module already owns, and the
 * returned flags let the caller count the rewrite it made.
 */
export function stripSourceFurniture(
  text: string,
  headline: string | undefined,
): { text: string; strippedHeadline: boolean; strippedFooter: boolean } {
  // The footer first: it sits at the end, and cutting it cannot move the front
  // of the text that the headline strip then reads.
  const footer = POST_FOOTER.exec(text);
  const body = footer && footer.index > 0 ? text.slice(0, footer.index).trimEnd() : text;
  const strippedFooter = body !== text;
  const withoutHeadline = stripHeadlinePrefix(body, headline);
  return {
    text: withoutHeadline.text,
    strippedHeadline: withoutHeadline.stripped,
    strippedFooter,
  };
}

/** A parenthesised citation, which is an outlet marker or an acronym in prose. */
const DIGEST_OUTLET = /\(\s*([^()]{1,40}?)\s*(\$)?\s*\)/g;

/**
 * A newsletter that is not an article but a digest of other publications'.
 *
 * `The Download` reached a reader as one story and published ten unrelated
 * stories' claims under one title: 19 of the story's 33 published sentences
 * still held the provider's own `(Outlet)` markers, 9 held the `+` that joined
 * them, 6 of 7 paragraphs mixed items, one sentence was stitched across the
 * headline and the elaboration ("AlphaGo was AlphaGo's powers of reasoning ..."),
 * and the page about a de-aging contest also carried chip smuggling, Flock
 * cameras, a coral experiment, humanoid robots and a crocodile panic. The event
 * *is* the digest -- its `what` is one item's headline -- so no sentence rule
 * can make it one story: the unit error is at the source, which is where this
 * refuses it. Measured before building it: the refusal takes the story from 35
 * rendered facts to 0, which is the honest page here rather than a clean-looking
 * one.
 *
 * The signature is measured, not imagined, and deliberately narrow. In the
 * frozen corpus one source in 205 has it; a coarse screen ("two parenthesised
 * phrases") finds 37, and hand-reading shows why that screen cannot be used:
 * acronyms ("(CPO)", "(CISA)", "(DFR)"), arXiv abstracts, release-note bullet
 * runs and related-headline pastes all match it. So a parenthetical counts only
 * when it names an outlet -- a lowercase letter inside, or a `$` paywall tag,
 * the shape of `(Gizmodo)`, `(NYT $)`, `( BBC )` -- and one marker is not
 * enough: a digest is a run of them joined by the `+` separator, so the source
 * must show three outlet markers and two separators.
 *
 * Extracting the numbered items instead was measured and rejected as a prose
 * fix: each item needs its own outlet and its own event identity, which is a
 * source-unit and attribution project. Until that exists the honest outcome is
 * the one this returns -- nothing, rather than one page pretending to be one
 * story.
 */
export function digestSource(text: string): boolean {
  const outlets = [...text.matchAll(DIGEST_OUTLET)].filter(([, inner = "", dollar]) => {
    if (dollar) return true;
    if (!/[a-z]/.test(inner)) return false;
    return !/^(?:Image|Photo|Note|Figure|Table|see|Sources?|Credit)/i.test(inner.trim());
  }).length;
  if (outlets < 3) return false;
  return (text.match(/\s\+\s/g)?.length ?? 0) >= 2;
}

/** The label a provider puts on its own navigation block inside an article. */
const NAV_LABEL =
  /\bGo deeper with TH Premium\b|\bPremium Roadmaps\b|\bRelated [Aa]rticles?\b|\bRead more\b|\bTH Premium\b/;

/**
 * A provider's own navigation, pasted into the middle of its article text.
 *
 * Tom's Hardware's excerpt reads: the story, then `Go deeper with TH Premium:
 * CPU    (Image credit: Tom's Hardware) Intel VP Robert Hallock sets Nova Lake
 * expectations, teases return to Raptor Lake for DDR4 platforms. CPU scaling
 * with DLSS. Intel's one-two punch plan in desktop CPUs is taking shape. ...`
 * -- a labeled run of *other articles'* headlines, which the composer published
 * inside a story about something else: 6 paste headlines on the frozen corpus,
 * all with zero cross-representation and near-zero topic overlap, and the prose
 * after the paste resumes mid-thought ("As part of the expansion, Toshiba has
 * installed ..."), which the composer then refused as unresolved context. The
 * paste does not merely add junk; it un-glues its neighbours.
 *
 * Cut at the source boundary, whole, like a feed's footer -- not by judging
 * each headline, which would teach the evidence layer that certain sentences
 * "look like headlines". The region is the label sentence plus the run that
 * follows it, bounded: the run ends at the first sentence long enough to be
 * prose again, or after eight sentences, and a label with no run after it is
 * prose mentioning navigation and is left alone. Measured before building it:
 * the cut costs every one of its rendered sentences and no other claim --
 * Toshiba 18 rendered facts to 16, Nova Lake 21 to 16.
 */
export function stripProviderNavigation(text: string): {
  text: string;
  strippedNavigation: boolean;
} {
  // The provider's own spacing is noise ("Roadmaps    (Image credit: ...)") and
  // the splice below matches sentences back against the text, so the cut works
  // on a copy with the runs of spaces collapsed first.
  const flat = text.replace(/[ \t]{2,}/g, " ");
  const sentences = readerSentences(flat);
  const labelIndex = sentences.findIndex((sentence) => NAV_LABEL.test(sentence));
  if (labelIndex < 0) return { text, strippedNavigation: false };
  let end = labelIndex + 1;
  while (end < sentences.length && (sentences[end] ?? "").length <= 140 && end - labelIndex <= 8)
    end += 1;
  if (end - labelIndex < 2) return { text, strippedNavigation: false };
  const start = flat.indexOf(sentences[labelIndex] ?? "");
  if (start < 0) return { text, strippedNavigation: false };
  let cursor = start;
  let lastEnd = -1;
  for (let index = labelIndex; index < end; index += 1) {
    const sentence = sentences[index] ?? "";
    const at = flat.indexOf(sentence, cursor);
    if (at < 0) return { text, strippedNavigation: false };
    lastEnd = at + sentence.length;
    cursor = lastEnd;
  }
  const cut = `${flat.slice(0, start)} ${flat.slice(Math.max(lastEnd, 0))}`.replace(
    /[ \t]{2,}/g,
    " ",
  );
  return { text: cut.trim(), strippedNavigation: true };
}

/**
 * Words that occupy a subject position without naming anybody.
 *
 * Found in the corpus, not imagined: the sentence before was "The first briefing,
 * which Allan did not sign, warned that ...", the matcher stopped at the first
 * capitalised word -- "The" -- and the deck read "According to The Guardian
 * World, the was also revealed that the inquiry ...". Substituting a pronoun
 * only improves a sentence when what goes in is an actor; a capture made entirely
 * of determiners and pronouns is not one, so the sentence is dropped instead.
 */
const NOT_AN_ACTOR = new Set(
  "the a an this that these those it its he she they them him his her their there here both such one two three first second last next another some many most all no none more less other others each what which who when where how why".split(
    " ",
  ),
);

/**
 * Whether the source itself writes this name inside a clause.
 *
 * `recoverContext` substitutes the previous sentence's opening for a leading
 * `It`, and a sentence's first word is capitalised whether or not it names
 * anybody. The corpus published `For was used heavily by Democratic candidates
 * including Mark Kelly, Joe Biden, Bernie Sanders`, `While then decides whether
 * to retain or replace the token`, `In carried a top-secret payload for the US
 * military`, `Move wasn't.` and `Nobody handled the website update, too.` --
 * every one of them read off a preposition, a conjunction, a verb or a pronoun
 * that merely opened the sentence before.
 *
 * Vocabulary does not separate those from the names that work. The extracted
 * entity list holds `Move` and `Read` as readily as it holds `Amazon` (both are
 * capitalised runs the extractor harvests), so membership proves nothing. Usage
 * does: the source writes the real ones after a lowercase word, mid-clause --
 * "said Amazon SVP Peter DeSantis", "over Fort Worth", "group it tracks as
 * TA419" -- while the impostors only ever appear at the head of a sentence.
 * That is the test, and where it fails the pronoun stays unresolved and the
 * fact is dropped, which is what already happens to every other orphan.
 */
function sourceUsesName(sourceText: string, name: string): boolean {
  const occurrences = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  for (const match of sourceText.matchAll(occurrences)) {
    // The word before it, across whatever punctuation the source put between
    // them ("the following: Enterprise AI", "Synopsys/Amazon", "as TA419") --
    // but never across a full stop, or the previous sentence's last word would
    // count as this one's clause: "…decide which device you want next. Read the
    // documentation" is `Read` opening a sentence, not a verb the source wrote
    // after `next`.
    const context = sourceText.slice(0, match.index).match(/([A-Za-z][\w'-]*)([^\w\s]*)\s*$/);
    // No word before it at all: the source opens by capitalising this, which is
    // exactly the accident this test exists to catch.
    if (context === null) continue;
    if (/^[a-z]/.test(context[1] ?? "") && !/[.!?]/.test(context[2] ?? "")) return true;
  }
  return false;
}

function recoverContext(text: string, previousText?: string, sourceText = ""): string | null {
  const previousSubject = previousText?.match(
    /^(?:The )?([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\b/,
  )?.[1];
  const tokens = previousSubject?.split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length === 0 || tokens.every((token) => NOT_AN_ACTOR.has(token.toLowerCase()))) {
    return null;
  }
  // Non-null past the guard above; named so the narrow survives into the closures.
  const subject: string = previousSubject!;
  if (!sourceUsesName(sourceText, subject)) return null;
  return (
    text
      .replace(/^The figure\b/i, "The figure described above")
      .replace(/^That figure\b/i, "That figure described above")
      .replace(/^Its\b/i, `${subject}'s`)
      // Not `It's`: the contraction is "it is", and substituting into it produced
      // "Thariq Shihipar's also meant to be better at Blender" in the corpus.
      .replace(/^It(?!['’]s)\b/i, subject)
  );
}

export type ReaderEvidenceBlock = {
  facts: ReaderFact[];
  role: "lead" | "price" | "supply" | "context" | "analysis" | "quote";
};

function blockRole(facts: ReaderFact[]): ReaderEvidenceBlock["role"] {
  const text = facts.map((fact) => fact.text).join(" ");
  if (facts.some((fact) => fact.quote)) return "quote";
  if (/\b(?:price|cost|revenue|funding|percent|%)\b|[$€£]\s*\d/i.test(text)) return "price";
  if (/\b(?:supply|capacity|shortage|production|manufactur|lead time)\b/i.test(text))
    return "supply";
  if (/\b(?:expects?|according to|analyst|research|said|warned)\b/i.test(text)) return "analysis";
  if (/\b(?:because|as|driven|result|impact|effect)\b/i.test(text)) return "context";
  return "context";
}

/** Group only compatible claims; this is a bounded in-memory editorial step. */
export function groupReaderEvidence(facts: ReaderFact[], maxFacts = 4): ReaderEvidenceBlock[] {
  const blocks: ReaderEvidenceBlock[] = [];
  for (const fact of facts) {
    const prior = blocks.at(-1);
    const priorTokens = prior
      ? new Set(prior.facts.flatMap((item) => centralTokens(item.text)))
      : new Set<string>();
    const shared = centralTokens(fact.text).some((token) => priorTokens.has(token));
    const sameEvidence = prior?.facts.some((item) =>
      item.evidence.some((ref) => fact.evidence.includes(ref)),
    );
    if (prior && (shared || sameEvidence) && prior.facts.length < maxFacts) {
      prior.facts.push(fact);
      prior.role = blockRole(prior.facts);
    } else {
      blocks.push({ facts: [fact], role: blockRole([fact]) });
    }
  }
  return blocks;
}

/** A cheap diagnostic: exact sentence overlap is counted, while normal word/number overlap is not. */
export function verbatimSourceRatio(output: string, facts: ReaderFact[]): number {
  const outputSentences = new Set(readerSentences(output).map((text) => text.toLowerCase()));
  const selected = facts.filter((fact) => fact.origin === "enriched");
  if (selected.length === 0) return 0;
  const copied = selected.filter((fact) => outputSentences.has(fact.text.toLowerCase())).length;
  return copied / selected.length;
}

/** Counts from the source-normalization pass, for admin diagnostics only. */
export type ReaderSourceNormalization = {
  removedMetadataFields: number;
  cleanedEvidence: number;
  rejectedMetadataOnly: number;
  /**
   * Sources refused whole because their text is a digest of other
   * publications'. The refusal drops both stores, so the counter is the only
   * trace of what the source would have contributed; see `digestSource` for
   * the signature and the measured reason it is narrow.
   */
  refusedDigests: number;
  /** Sentences whose first-person voice was resolved to the paper's authors. */
  authorialVoiceRewrites: number;
  /** Typesetting wrappers unwrapped from a sentence whose payload was prose. */
  markupUnwrapped: number;
  /** Texts that opened by repeating their own item headline. */
  strippedHeadlines: number;
  /** Sentences an editorial adverbial was removed from, keeping the fact. */
  sourceVoiceStripped: number;
  /** Sentences a fronted editorial frame was removed from, keeping the fact. */
  strippedFrames: number;
  /** Sentences refused for carrying a loaded metaphor instead of the fact. */
  sourceColourRejections: number;
  /** Frames moved behind the fact they were in front of ("The paper reports: X"). */
  reportFramesMoved: number;
  /** Frames deleted because the fact already named its own claimant. */
  reportFramesDropped: number;
  /**
   * A bounded before/after example of each rewrite, for the audit only.
   *
   * Counters say how much the boundary did; they cannot say whether it was
   * right. "Twelve sentences had a wrapper removed" is a number nobody can
   * check, and the failure this guards against -- a rule that quietly deletes
   * legitimate prose -- is invisible in every count. Four per kind is enough to
   * read, and the strings are clipped so a diagnostic payload stays small.
   */ samples: {
    voiceStrips: string[];
    frames: string[];
    relativeTimes: string[];
    /** Sentences dropped for a pronoun with no antecedent, kept to be read. */ droppedContext: string[];
    /** Narrator resolutions and drops, before/after, to be read by hand. */
    narrator: string[];
  };
  /**
   * Relative time references replaced with the date they meant.
   *
   * Counted by the composer rather than here, because the anchor is the story's
   * own date and this pass never sees one -- so it leaves the field at zero and
   * the caller owns it, which is what keeps the two passes from disagreeing
   * about the same story.
   */
  relativeTimesAnchored: number;
  /** Sentences kept with an unanchorable time phrase removed (see below). */
  relativeTimesStripped: number;
  /** Reporting wrappers resolved to the actor they named (see `resolveNarrator`). */
  narratorWrappersRemoved: number;
  /** First-person observations and experiments attributed to their author. */
  authorAttributedFacts: number;
  /** First-person sentences dropped because the subject could not be restored. */
  ambiguousNarratorRejected: number;
};

/**
 * Why one candidate unit did not become evidence. Counted per unit, and the
 * counts add up to `rejectedCount`, so a dropped sentence is always explicable.
 */
export type EvidenceRejectionReason =
  /** A unit that is nothing but a heading: a subhead, not a sentence. */
  | "headline_fragment"
  | "invalid_sentence"
  | "no_predicate"
  | "editorial_noise"
  /** A unit still carrying the source's own typesetting after safe unwrapping. */
  | "source_markup"
  | "trailing_ellipsis"
  | "unbalanced_quote"
  | "unassigned_quote"
  /** A claim attributed to an authority that names nobody. */
  | "unverifiable_attribution"
  /** A pronoun with no antecedent the sentence itself supplies. */
  | "unresolved_context"
  /** A narrator whose subject cannot be restored without guessing. */
  | "narrator_ambiguous"
  /**
   * A newsletter's index of its own previous articles, inside a source that
   * identifies itself as a newsletter: the labeled `Title — blurb` run, a
   * title list, or a promo line. See `newsletterIndexUnit` for the measured
   * shape and why the provenance, not the punctuation, decides.
   */
  | "newsletter_index"
  /**
   * A subjectless instruction -- documentation addressed to the reader, not a
   * claim about the world. See `INSTRUCTION_OPENING` for the measured list
   * and the two prose casualties the rule is known to cost.
   */
  | "imperative_instruction";

/**
 * Authority with nobody behind it.
 *
 * "Analysts say the risk is ..." hands the reader the shape of a sourced claim
 * and none of its content: no name, nothing to check, and no source the sentence
 * can be attributed to. The composer already counts a collective noun as an
 * attribution -- `CLAIMANT` below lists `analysts`, `researchers`, `officials` --
 * so without this the sentence is published believing it carries provenance,
 * and `unassigned_quote`'s sibling problem goes unnamed.
 *
 * Refused rather than rewritten. Naming a source the source did not give is
 * invention, and the product does not promise to preserve every fact; a briefing
 * that drops one unverifiable sentence is more useful than one that launders an
 * opinion into a finding. This is the same trade `SOURCE_COLOUR` already makes
 * for a real fact inside a joke.
 *
 * The test is the SUBJECT, not the verb. An earlier version listed the reporting
 * verbs that could follow -- say, warn, argue -- and was immediately wrong twice:
 * "Commentators welcomed the decision" and "Observers have called the pricing
 * aggressive" both slipped through, and the list would have needed a third entry
 * for the next one. A bare collective noun in subject position is the signal, and
 * it does not care what it then does.
 *
 * Plurals only, and the identifying qualifier is what saves a real attribution:
 * "Analysts at Forrester said ..." and "three analysts at Goldman Sachs said"
 * keep theirs, and so does "The company said", which was never in scope. The
 * qualifier may be a preposition or a participle, because "Analysts covering the
 * sector expect revenue ..." is the long-form fixture's own sentence and naming
 * who is looking at what is what makes it a different claim from a shrug.
 * "Analyst coverage of the launch was thin" is a noun phrase rather than a claim,
 * which the plural-only form is what keeps it out.
 *
 * "People familiar with the matter said ..." is deliberately NOT in this set,
 * against the obvious argument that it names nobody either. It names a category
 * of knower -- people with direct knowledge -- which is a sourcing convention
 * rather than an appeal to unnamed authority, and the cost of refusing it is
 * measurable rather than theoretical: it took the long-form Nvidia fixture from
 * 408 words to 388 and cost the story its "rich" coverage classification. A
 * rule that silently demotes a real story is worse than the one defect it
 * removes, so the bare collectives are refused and this one is not.
 */
const VAGUE_ATTRIBUTION =
  /^(?:the\s+)?(?:analysts|experts|observers|critics|commentators|pundits|watchers|insiders)\b(?!\s+(?:at|of|from|with|who|in|across|and\b|covering|tracking|following|studying|reviewing|examining|polling|surveying|watching|quoted|interviewed))/i;

/**
 * Whether a sentence claims something on the authority of nobody in particular.
 *
 * Exported because the email asks the same question the Read page asks, and
 * because a rule this specific deserves a name rather than living inside one
 * long refusal chain.
 */
export function unverifiableAttribution(text: string): boolean {
  return VAGUE_ATTRIBUTION.test(text.trim());
}

export type ReaderDedupe = {
  nearDuplicateMerges: number;
  preferredCleanVariant: number;
};

function emptyNormalizationStats(): ReaderSourceNormalization & ReaderDedupe {
  return {
    removedMetadataFields: 0,
    cleanedEvidence: 0,
    rejectedMetadataOnly: 0,
    refusedDigests: 0,
    authorialVoiceRewrites: 0,
    markupUnwrapped: 0,
    strippedHeadlines: 0,
    sourceVoiceStripped: 0,
    strippedFrames: 0,
    sourceColourRejections: 0,
    reportFramesMoved: 0,
    reportFramesDropped: 0,
    samples: {
      voiceStrips: [],
      frames: [],
      relativeTimes: [],
      droppedContext: [],
      narrator: [],
    },
    relativeTimesAnchored: 0,
    relativeTimesStripped: 0,
    narratorWrappersRemoved: 0,
    authorAttributedFacts: 0,
    ambiguousNarratorRejected: 0,
    nearDuplicateMerges: 0,
    preferredCleanVariant: 0,
  };
}

/** How many before/after examples of each rewrite the diagnostics keep. */
const SAMPLES_PER_KIND = 4;

/**
 * Keep one bounded, clipped before/after example of a rewrite.
 *
 * Exported because the composer performs one of these rewrites itself --
 * relative time is anchored there, where the story's own date is in hand -- and
 * its samples belong in the same list shape the audit reads.
 */
export function keepSample(list: string[], before: string, after: string): void {
  if (list.length >= SAMPLES_PER_KIND) return;
  const clip = (value: string) => (value.length > 200 ? `${value.slice(0, 197)}…` : value);
  list.push(`${clip(before)} → ${clip(after)}`);
}

/**
 * Strip provider metadata from a source's own text before it becomes evidence.
 * Applies to both stores: stored enriched facts were written by an older build
 * and the RSS excerpt is whatever the provider put in the description field.
 */
function normalizeReaderSource(
  source: ReaderSource,
  stats: ReaderSourceNormalization,
): ReaderSource {
  // A source's name is provider text: `The&#x20;Register` is The Register's own
  // escaping in its RSS, and it was reaching every attribution the composer
  // built from this source.
  const name = source.name === undefined ? undefined : normalizePlainText(source.name);
  // A digest of other publications' stories is refused before anything reads
  // it. Its text is not one article, and composing it as one page is exactly
  // the defect `digestSource` documents; dropping both stores is what makes the
  // refusal whole rather than a rewrite the composer can still stitch.
  const digestText = [
    source.excerpt ?? "",
    ...(source.enrichedEvidence ?? []).map((unit) => unit.text),
  ].join(" ");
  if (digestSource(digestText)) {
    stats.refusedDigests += 1;
    return {
      ...source,
      ...(name === undefined ? {} : { name }),
      excerpt: undefined,
      enrichedEvidence: undefined,
    };
  }
  const context: SourceContext = { name, url: undefined };
  const keep = (text: string): string | undefined => {
    const normalization = normalizeSourceText(context, text);
    if (normalization.removedFields.length) {
      stats.removedMetadataFields += normalization.removedFields.length;
      stats.cleanedEvidence += 1;
    }
    // The source's own typesetting, unwrapped where the payload is prose. A
    // wrapper left standing is refused by `unitTextRejection`, so this is the
    // difference between a paper's abstract arriving readable and not
    // arriving at all.
    const markup = normalizeSourceMarkup(normalization.text);
    if (markup.unwrapped > 0) {
      stats.markupUnwrapped += markup.unwrapped;
      stats.cleanedEvidence += 1;
    }
    const marked = { ...normalization, text: markup.text };
    stats.authorialVoiceRewrites += normalization.authorialVoiceRewrites;
    // What the provider wrapped around its own text goes next: its headline
    // repeated at the front of the description.
    const furniture = stripSourceFurniture(marked.text, source.headline);
    if (furniture.strippedHeadline) stats.strippedHeadlines += 1;
    // Counted with the other clean-ups rather than in a counter of its own: the
    // audit's `cleanedEvidence` already means "this text needed the boundary".
    if (furniture.strippedFooter) stats.cleanedEvidence += 1;
    // The provider's own navigation, pasted into the middle of its text: a
    // labeled related-headline run whose headlines are other articles' links.
    // Cut whole at this boundary, like the footer above -- see
    // `stripProviderNavigation` for the measurement behind the shape.
    const navigation = stripProviderNavigation(furniture.text);
    if (navigation.strippedNavigation) stats.cleanedEvidence += 1;
    if (
      normalization.metadataOnly ||
      navigation.text === "" ||
      metadataOnlyEvidence(navigation.text)
    ) {
      stats.rejectedMetadataOnly += 1;
      return undefined;
    }
    // Last, because the frame is around the sentence that survives everything
    // else: `We present: <fact>` is the authors' pronoun before it is a label.
    const framing = normalizeReportFraming(navigation.text, name === undefined ? [] : [name]);
    stats.reportFramesMoved += framing.moved;
    stats.reportFramesDropped += framing.dropped;
    return framing.text;
  };

  const excerpt = source.excerpt === undefined ? undefined : keep(source.excerpt);
  const enrichedEvidence = source.enrichedEvidence?.flatMap((unit) => {
    const text = keep(unit.text);
    return text === undefined ? [] : [{ ...unit, text }];
  });

  return {
    ...source,
    ...(name === undefined ? {} : { name }),
    ...(excerpt === undefined ? { excerpt: undefined } : { excerpt }),
    ...(enrichedEvidence === undefined ? {} : { enrichedEvidence }),
  };
}

/**
 * Normalize a whole source list once, before anything reads it.
 *
 * `selectReaderEvidence` calls this itself, so every caller is protected. The
 * composer calls it earlier as well, because it also reads `excerpt` directly
 * for entity context -- a second pass over already-clean text is a no-op.
 *
 * Only `excerpt` and each enriched unit's `text` are rewritten; every other
 * property is carried through, so the caller's own source shape survives (the
 * cast below is that guarantee, not a widening).
 */
export function normalizeReaderSources<T extends ReaderSource>(
  sources: T[],
): {
  sources: T[];
  normalization: ReaderSourceNormalization;
} {
  const stats = emptyNormalizationStats();
  return {
    sources: sources.map((source) => normalizeReaderSource(source, stats) as T),
    normalization: stats,
  };
}

/**
 * Whether a sentence opens on a quotation.
 *
 * The same two characters the composer's deck walk reads — an attribution in
 * front (`Michael Freeman said …`) or a speaker named later is a report; only a
 * sentence whose *first* character is the quotation mark is quote-first.
 *
 * Two producers answer "which sentence opens this story?". The composer picks
 * the deck it publishes, and `finalizeMetadata` picks the line it stores as
 * `events.what_happened` — the line the briefing card, the alert and the search
 * index read. Since the arbiter's ruling #10a (2026-10-18: prefer a fact that
 * reports the event over one that opens on a quotation, keeping quotations as
 * the fallback) both must prefer the report, so the class is defined here once
 * and asked by both. `fact.quote` cannot define it: that flag is set only for an
 * enriched unit the evidence pass carried as a quote *with an attribution*, so
 * an RSS sentence that simply starts with a quotation mark is not one — which is
 * exactly the delivered 2026-10-18 briefing's card 01, whose stored line was the
 * Freeman quotation while the story page opened on the report.
 */
export const OPENS_ON_QUOTE = /^["\u201c]/u;

/**
 * Whether a fact can open a story as a report.
 *
 * Exactly the two tests the deck walk applies to a composed candidate: it may not
 * open on a quotation (the class above), and it may not open on a reference the
 * page never establishes (`unresolvedContextOpening`, the same function behind
 * `needsAntecedentToOpen`). Nothing else is invented here — a fact the composer
 * would publish can stand, and one it would displace for a reason of its own
 * (attribution, sentence shape) is caught by that rule when the sentence is
 * composed, not by a second list kept in this file.
 */
export function opensAsReport(fact: ReaderFact, title?: string | null): boolean {
  return !quotationCarriesOpening(fact.text) && !unresolvedContextOpening(fact.text.trim(), title);
}

/**
 * The first fact that reports the event, in the order the deck walk asks.
 *
 * The composer asks for its deck candidates in this order — the selection's lead
 * first, then the facts as the sources supplied them (`deckCandidates` in
 * editorial.ts) — so this answers the ruling's preference (a report before a
 * quotation) on the same list, without composing anything. Its one caller is
 * `finalizeMetadata`, for a stored line that opens on a quotation (ruling #10a);
 * the stored line stays the selection's lead held to the card's boundary
 * (`summaryFor`) as it has always been, so the composer's sentence-level gates
 * remain authoritative for the page. Measured 2026-10-18 on the delivered
 * card-01 story: the replacement is byte-identical to the deck the story page
 * opens on.
 *
 * The lead itself is deliberately *not* narrowed to this class: the composer
 * seeds its walk with it, and narrowing it there re-orders the candidates —
 * measured 2026-10-18 on the same story, whose deck moved from the report to a
 * background sentence when the lead was narrowed.
 */
export function reportingLeadOf(
  lead: ReaderFact | undefined,
  facts: readonly ReaderFact[],
  title?: string | null,
): ReaderFact | undefined {
  return [lead, ...facts.filter((fact) => fact !== lead)].find(
    (fact): fact is ReaderFact => fact !== undefined && opensAsReport(fact, title),
  );
}

export function selectReaderEvidence(title: string, sources: ReaderSource[]) {
  const stats = emptyNormalizationStats();
  const normalizedSources = sources.map((source) => normalizeReaderSource(source, stats));
  const entities = rankEntities(title, normalizedSources);
  // The card's own entity list is what makes a spaced product name repairable:
  // `Character. AI` is put back together only because `Character.AI` is in this
  // list (ruling #19, 2026-10-20). Nothing is guessed from a dictionary.
  const dottedNames = entities.map((entity) => entity.name).filter((name) => /\S\.\S/.test(name));
  const raw: ReaderFact[] = [];
  normalizedSources.forEach((source, index) => {
    // A paper's authors are plural, a news desk's narrator is one person. Both are
    // the source's own words about itself, which is the point of the attribution
    // `resolveNarrator` writes.
    const person: "author" | "authors" = isRepositorySourceName(source.name) ? "authors" : "author";
    let antecedent: string | undefined;
    // Use both existing evidence stores: an enrichment cap must not hide an RSS fact.
    // The source-local neighbors are kept only in memory; they are never emitted as
    // a paragraph and are used solely to repair a small, explicit context dependency.
    let enrichedOrder = 0;
    const units = [
      // A stored unit may hold more than one sentence -- a multi-sentence extract,
      // or a caption pasted onto the sentence above it with no punctuation between
      // them (`captionSeamSplit`). Quotes stay whole: their attribution wraps the
      // entire text.
      ...(source.enrichedEvidence ?? []).flatMap((u) =>
        u.kind === "quote"
          ? [{ ...u, origin: "enriched" as const, sourceOrder: enrichedOrder++ }]
          : captionSeamSplit(u.text, dottedNames).map((text) => ({
              ...u,
              text,
              origin: "enriched" as const,
              sourceOrder: enrichedOrder++,
            })),
      ),
      ...readerSentences(source.excerpt ?? "", dottedNames).map((text, order) => ({
        text,
        kind: "fact",
        origin: "rss" as const,
        attribution: undefined,
        sourceOrder: order,
      })),
    ];
    // The source's whole text, for the mid-name fragment test: a unit that begins
    // inside a name the source spells in full somewhere else was cut at storage
    // time, and its head ("T. Rowe") lives in a different unit.
    const sourceContext = [source.excerpt ?? "", ...units.map((unit) => unit.text)].join(" ");
    for (const [unitIndex, unit] of units.entries()) {
      const previousText = units[unitIndex - 1]?.text;
      const nextText = units[unitIndex + 1]?.text;
      const quote = unit.kind === "quote" && !!unit.attribution;
      let text = quote
        ? `${unit.attribution} said: "${unit.text}"`
        : stripHeadingLabel(unit.text.trim().replace(/®$/, ""));
      // "When we started work on that story, X claimed $8 million" is the
      // publication describing its own writing, and the clause after the comma is
      // the fact. Naming the outlet is right -- the words are its report -- but
      // "previously" was not: the thing it reported had happened the same week,
      // and the source only ever said it wrote about it. The timestamp is
      // relative to nothing the reader can see, so it comes off.
      const retrospective = text.match(/^When we [^,]+, (.+)$/i);
      if (retrospective?.[1] && source.name)
        text = `${source.name} reported that ${retrospective[1]}`;
      text = text.replace(/^In the short interval since then,\s*/i, "");
      text = text.replace(
        /^(?:Unfortunately|Fortunately|Indeed),\s*([a-z])/i,
        (_, letter: string) => letter.toUpperCase(),
      );
      // Resolve a surname only when the source supplies one unambiguous full name.
      for (const entity of entities) {
        const parts = entity.name.split(" ");
        const surname = parts.at(-1)!;
        if (parts.length < 2 || parts.length > 3 || !/^[A-Z][a-z]+$/.test(surname)) continue;
        if (entities.filter((e) => e.name.endsWith(` ${surname}`)).length !== 1) continue;
        if (!contains(text, entity.name))
          text = text.replace(
            new RegExp(`\\b${surname}(?= (?:and (?:his|her)|[–—] better known|said|was working))`),
            entity.name,
          );
      }
      const identity = text.match(
        /([A-Z][a-z]+(?: [A-Z][a-z]+){1,3}) [–—] better known as ([A-Z]{2,6}) [–—] (the .+)$/,
      );
      if (identity) text = `${identity[1]}, better known as ${identity[2]}, is ${identity[3]}`;
      // `It's` is "it is", and substituting into it asserts something the source
      // never said: the Epic story's "It's rare for a company to pause
      // development" was published as "Epic's rare for a company to pause
      // development". `recoverContext` has carried this guard since the same
      // failure reached a reader through its own path; this one did not.
      if (antecedent)
        text = text.replace(/^Its\b/, `${antecedent}'s`).replace(/^It(?!['’]s)\b/, antecedent);
      if (unresolvableContext(text)) {
        // `Both`, `the latter`, a fronted clause whose main clause is a pronoun:
        // the subject is outside the sentence and nothing mechanical can supply
        // it. Refused by `unitTextRejection` below, whatever ordering the page
        // would have used.
      } else if (contextDependent(text)) {
        // `its`, `the figure`: the previous sentence's subject can be substituted
        // in without guessing -- and when there is nothing to substitute, the
        // sentence is an orphan and goes, which is what this branch always did.
        if (!recoverableContext(text)) {
          // The softer class -- `they`, `this`, `these`, `that` -- survives to its
          // own decision point. In source order its antecedent is the sentence
          // before it on the page; in a ranked paragraph there is no such thing,
          // and the composer refuses it there.
        } else if (!previousText || contextDependent(previousText)) {
          text = "";
        } else {
          // `null` when the sentence before it names no actor to substitute:
          // the pronoun then points at nothing and the sentence goes.
          text = recoverContext(text, previousText, sourceContext) ?? "";
        }
      }
      const voiced = stripEditorialVoice(text);
      // Counted on `removed`, not on the string having changed: capitalising a
      // lowercase opener is a repair, not a removal, and counting both made the
      // audit's source-voice line 2 removals among 32 capitalised fragments.
      if (voiced.removed) {
        stats.sourceVoiceStripped += 1;
        keepSample(stats.samples.voiceStrips, text, voiced.text);
      }
      if (voiced.text !== text) text = voiced.text;
      // After the adverbial, because the frame is what the adverbial was sitting
      // inside: "Perhaps predictably for a company that ... ".
      const framed = stripFrontedFrame(text);
      if (framed !== text) {
        stats.strippedFrames += 1;
        keepSample(stats.samples.frames, text, framed);
        text = framed;
      }
      // The narrator, before the voice refusal sees it: a fact with "I" in front
      // of it is classified rather than deleted, because deleting it is how the
      // corpus lost three stories and 370 words of a fourth -- see
      // `resolveNarrator` for the cases and for what each one becomes.
      const narrated = resolveNarrator(framed, person);
      const narratorAmbiguous = narrated?.kind === "ambiguous";
      if (narrated && !narratorAmbiguous) {
        if (narrated.kind === "wrapper") stats.narratorWrappersRemoved += 1;
        else stats.authorAttributedFacts += 1;
        keepSample(stats.samples.narrator, framed, narrated.text);
        text = cleanDeterministicSentence(narrated.text);
      } else if (narratorAmbiguous) {
        stats.ambiguousNarratorRejected += 1;
        keepSample(stats.samples.narrator, framed, "(dropped)");
        text = "";
      } else {
        text = cleanDeterministicSentence(normalizeEvidenceText(framed));
      }
      const subject = entities.find(
        (e) =>
          e.role !== "REPORTING_SOURCE" &&
          text.replace(/^The /, "").startsWith(`${e.name} `) &&
          // The same source-usage test `recoverContext` makes, and for the same
          // reason: a unit opening on a capitalised word hands the next unit a
          // subject the source never wrote as a name either. "Move 37 in game two
          // of the five-game match looked so absurd" supplied `Move` for "It
          // wasn't", which published as `Move wasn't.`; "Read the documentation"
          // supplied `Read` for "It supports any AI agent", and "While a causal
          // selector combines" supplied `While` for "It then decides". The
          // extracted entity list holds all three names, so membership is not a
          // test -- usage is.
          sourceUsesName(sourceContext, e.name),
      );
      antecedent = subject?.name;
      raw.push({
        text,
        evidence: [index + 1],
        origin: unit.origin,
        score:
          unit.kind === "quote" && !unit.attribution ? -100 : evidenceScore(text, title, entities),
        quote,
        uncertain: unit.kind === "uncertain",
        sourceOrder: unit.sourceOrder,
        ...(previousText ? { previousText } : {}),
        ...(nextText ? { nextText } : {}),
        ...(narratorAmbiguous ? { narratorAmbiguous: true } : {}),
        ...(sourceContext ? { sourceContext } : {}),
      });
    }
  });
  const accepted: ReaderFact[] = [];
  let rejected = 0;
  let duplicates = 0;
  // One entry per refused unit, so the counts always explain `rejectedCount`.
  const rejectionReasons: Record<EvidenceRejectionReason, number> = {
    headline_fragment: 0,
    invalid_sentence: 0,
    no_predicate: 0,
    editorial_noise: 0,
    trailing_ellipsis: 0,
    unbalanced_quote: 0,
    unassigned_quote: 0,
    unverifiable_attribution: 0,
    source_markup: 0,
    unresolved_context: 0,
    narrator_ambiguous: 0,
    newsletter_index: 0,
    imperative_instruction: 0,
  };
  for (const fact of raw) {
    const text = fact.text;
    if (sourceColour(text)) stats.sourceColourRejections += 1;
    // One predicate for the textual rules, so the entity path in the composer
    // refuses exactly what this pass refuses. Publisher voice is a scoring
    // decision (`-100`) and is applied first of all, because that is the counter
    // the admin sample reads.
    const reason: EvidenceRejectionReason | null = fact.narratorAmbiguous
      ? "narrator_ambiguous"
      : fact.score <= -100
        ? "editorial_noise"
        : unitTextRejection(text, fact.quote, fact.sourceContext);
    if (reason) {
      rejectionReasons[reason] += 1;
      rejected++;
      // A context refusal is the one every reviewer asks about -- "what did it
      // delete?" -- so the sentence itself is kept, bounded, next to its reason.
      if (reason === "unresolved_context") {
        keepSample(stats.samples.droppedContext, fact.text, "(dropped)");
      }
      continue;
    }
    const duplicateKey = (value: string) =>
      claimKey(value)
        .toLowerCase()
        .replace(/\bhas announced\b/g, "announced")
        .replace(/\btoday\b/g, "")
        .replace(/\s+/g, " ")
        .trim() + (/\btoday\b/i.test(value) ? "|today" : "");
    const priorKey = duplicateKey(text);
    const exact = accepted.find((f) => duplicateKey(f.text) === priorKey);
    const merged =
      exact ??
      accepted.find(
        (f) =>
          f.quote === fact.quote && f.uncertain === fact.uncertain && nearDuplicate(f.text, text),
      );
    if (merged) {
      for (const ref of fact.evidence)
        if (!merged.evidence.includes(ref)) merged.evidence.push(ref);
      merged.score = Math.max(merged.score, fact.score);
      if (!exact) stats.nearDuplicateMerges += 1;
      if (preferCleaner(merged.text, text)) {
        merged.text = text;
        stats.preferredCleanVariant += 1;
      }
      duplicates++;
      continue;
    }
    accepted.push(fact);
  }
  const ranked = [...accepted].sort((a, b) => b.score - a.score);
  const lead = ranked.find(
    (f) => !f.quote && !f.uncertain && !/^(?:he|she|it|they|this|that|its)\b/i.test(f.text),
  );
  const selected = new Set(ranked.slice(0, 60));
  const primaryNames = entities
    .filter((entity) => entity.role !== "REPORTING_SOURCE")
    .flatMap((entity) => [entity.name, ...entity.aliases]);
  for (const fact of ranked) {
    if (primaryNames.some((name) => fact.text.toLowerCase().includes(name.toLowerCase())))
      selected.add(fact);
  }
  const facts = accepted.filter((f) => selected.has(f));
  const blocks = groupReaderEvidence(facts);
  return {
    rawCount: raw.length,
    rejectedCount: rejected,
    duplicateCount: duplicates,
    rejectionReasons,
    contextDependencyRejections: rejectionReasons.unresolved_context,
    publisherVoiceRejections: raw.filter((fact) => editorialNoise(fact.text)).length,
    composedFactCount: facts.length,
    entities,
    lead,
    facts,
    blocks,
    sourceNormalization: {
      removedMetadataFields: stats.removedMetadataFields,
      cleanedEvidence: stats.cleanedEvidence,
      rejectedMetadataOnly: stats.rejectedMetadataOnly,
      authorialVoiceRewrites: stats.authorialVoiceRewrites,
      strippedHeadlines: stats.strippedHeadlines,
      sourceVoiceStripped: stats.sourceVoiceStripped,
      strippedFrames: stats.strippedFrames,
      sourceColourRejections: stats.sourceColourRejections,
      samples: stats.samples,
      relativeTimesAnchored: stats.relativeTimesAnchored,
      relativeTimesStripped: stats.relativeTimesStripped,
      narratorWrappersRemoved: stats.narratorWrappersRemoved,
      authorAttributedFacts: stats.authorAttributedFacts,
      ambiguousNarratorRejected: stats.ambiguousNarratorRejected,
    },
    dedupe: {
      nearDuplicateMerges: stats.nearDuplicateMerges,
      preferredCleanVariant: stats.preferredCleanVariant,
    },
  };
}
