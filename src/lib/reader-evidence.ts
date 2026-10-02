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

/** Whether the text reads as a clause with a predicate, rather than a label or a stub. */
export function hasPredicate(text: string): boolean {
  // Checked first, because it can only take a predicate away: every rule below is
  // a scan for a verb, and a scan cannot tell a name that looks like a verb from the
  // verb. A unit that is nothing but one inventory has no clause in it.
  if (creditInventory(text)?.whole) return false;
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
 * The seam, if this unit contains one: two source blocks published as one sentence.
 *
 * Returns the offending fragment rather than a boolean so the reason a fact was
 * refused can name it, and so a regression test can assert on the shape instead of
 * on "this string is bad".
 */
export function sourceSeam(text: string): string | null {
  return headingSeam(text) ?? creditInventory(text)?.run ?? null;
}
const NOISE =
  /\b(?:welcome back|weekly column|this week['’]s (?:column|newsletter)|as regular readers know|subscribe to|sign up for|click here|read more|continue reading|cookie policy|all rights reserved|follow us on|share this article|related articles|the coverage centers on|amount mentioned|percentage mentioned|entity mentioned|source count|evidence suggests|nyuz has also covered)\b|\bthe post\b.*\bappeared first on\b|^(?:advertisement|image credit|photo credit|hopefully\b|the takeaway\b)/i;

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
    String.raw`\bSubscribe (?:now|today|to this|for)\b`,
    String.raw`\bSign up (?:now|today|for your|to)\b`,
    String.raw`\bRegister (?:now|today|free)\b`,
    String.raw`\bDownload (?:the|our|your) (?:free )?(?:guide|report|ebook|whitepaper)\b`,
    String.raw`\bsponsored (?:content|post|by)\b`,
    String.raw`\baffiliate (?:links?|commission)\b`,
    String.raw`\blearn more at\b`,
    String.raw`\bLet['’]s show how it works\b`,
    // Campaign copy, which arrives inside a news post as a caption or a slogan.
    String.raw`\bStop (?:calling|pretending|selling) it\b`,
  ].join("|"),
  "i",
);

/**
 * Whether a candidate sentence is the publication talking about itself or
 * selling something, rather than reporting. Exported so the enrichment pass and
 * the composer both read one rule.
 */
export function publisherFurniture(text: string): boolean {
  return PUBLISHER_FURNITURE.test(text);
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
  return NOISE.test(text) || PUBLISHER_FURNITURE.test(text) || PUBLISHER_SOLICITATION.test(text);
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
  return !publisherSelfReference(text) && unitTextRejection(text, false) === null;
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
  return text
    .replace(/\bthat makes a [^,]+ remember how to be a [^,]+/gi, "")
    .replace(/\bworld away from\b/gi, "different from")
    .replace(/\beye[- ]popping\s+/gi, "")
    .replace(/\balarming\s+(?=(?:valuations?|investments?|figures?)\b)/gi, "")
    .replace(/\ball[- ]encompassing\s+/gi, "")
    .replace(/\bolder,?\s+less attractive\s+/gi, "older ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Whether the sentence needs a subject from somewhere else to be readable. */
export function contextDependent(text: string): boolean {
  const trimmed = text.trim();
  return (
    PRONOUN_SUBJECT_OPENING.test(trimmed) ||
    frontedClauseNeedsContext(trimmed) ||
    /\bthe figure\b/i.test(trimmed)
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
 * A sentence that would publish an unresolvable pronoun.
 *
 * Exported because the audit script counts it on the *published* prose: a gate
 * that no longer produces these is only proven by reading what came out, not by
 * trusting the counter that refused them.
 */
export function unresolvedContextOpening(text: string): boolean {
  return contextDependent(text) && !recoverableContext(text);
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
    PUBLISHER_FURNITURE.test(text)
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
  const clause = /(^|,\s*)(I|we)\b/.exec(text);
  if (!clause || clause.index === undefined) return null;
  // The narrator's own number decides the label: a paper that writes "I" is one
  // author, and "the authors propose" about a single author is a different claim.
  const plural = clause[2] === "we" || person === "authors";
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
  if (!/\b(?:I|we|my|our)\b/i.test(unquoted)) return null;
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

  // 5. Anything else: the narrator's subject cannot be restored without guessing.
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
const RELATIVE_WEEK = /\b(?:this|last|next)\s+week\b/i;
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

/** `in July 2026`, unless a preposition is already in front of the phrase. */
function monthPhrase(shift: number, at: Date, before: string): string {
  const date = new Date(at.getTime());
  date.setDate(1);
  date.setMonth(date.getMonth() + shift);
  const label = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  return PREPOSED.test(before) ? label : `in ${label}`;
}

function yearPhrase(shift: number, at: Date, before: string): string {
  const year = String(at.getFullYear() + shift);
  return PREPOSED.test(before) ? year : `in ${year}`;
}

function dayPhrase(shift: number, at: Date, before: string): string {
  const date = new Date(at.getTime());
  date.setDate(date.getDate() + shift);
  const label = `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
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
    .replace(
      /\b(?:in|on|at|during|since|after|before|by|through|throughout|within|around|from|until|for|over)\s+(?:this|last|next)\s+week\b/gi,
      "",
    )
    .replace(/\b(?:this|last|next)\s+week\b/gi, "")
    .replace(
      /\b(?:in|on|at|during|since|after|before|by|through|throughout|within|around|from|until|for|over)\s+(?:the|a|an|its|their|our|his|her|every|each)\s+(?:last|next|this)\s+(?:month|year)\b/gi,
      "",
    )
    .replace(
      /\b(?:the|a|an|its|their|our|his|her|every|each)\s+(?:last|next|this)\s+(?:month|year)\b/gi,
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
export function captionSeamSplit(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
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

/** Do not split a quotation away from its speaker or split decimals and versions. */
export function readerSentences(text: string): string[] {
  const out: string[] = [];
  // A caption pasted onto a sentence leaves no punctuation between them, so the
  // scanner below has no boundary to find. The seam is cut first, while it is
  // still detectable, and each half is then read as the sentence it is.
  for (const clean of captionSeamSplit(text)) {
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
        // not boundaries.
        (clean[i + 1] === " " ||
          (/[A-Z]/.test(clean[i + 1] ?? "") && /[a-z]/.test(clean[i - 1] ?? ""))) &&
        // A sentence does not end at a single-capital initial: "... by Wellington
        // and T. Rowe Price, large institutional investors..." was split into a
        // fragment ending "T." and a second starting "Rowe Price", which the
        // composer then published as two. Only a name's initial looks like this, so
        // the split is held back and the sentence stays whole.
        !/(?:^|\s)[A-Z]$/.test(clean.slice(Math.max(0, i - 2), i)) &&
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

function contains(text: string, name: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
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
  ) ?? [])
    add(name);
  for (const s of sources) if (s.name) add(s.name);
  // Article sentences do not depend on the candidate entity, so split each source
  // once rather than rescanning a long excerpt for every name in it.
  const sourceUnits = [...new Set(texts.flatMap(readerSentences))];
  const aliases = new Map<string, string[]>();
  for (const [key, name] of names) {
    const parts = name.split(" ");
    if (parts.length < 2) continue;
    const initials = parts.map((p) => p[0]).join("");
    // Require an explicit alias cue as well as matching initials.
    if (
      initials.length >= 3 &&
      names.has(initials.toLowerCase()) &&
      new RegExp(`(?:known as |aka |\\()${initials}\\b`).test(all)
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
            new RegExp(
              `^(?:The )?${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['’]s)?\\b`,
              "i",
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

/** A phrase repeated three times or more is padding or boilerplate, not prose. */
function repetitionBomb(text: string): boolean {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLowerCase());
  for (let size = 5; size <= 8; size++) {
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(" ");
      let occurrences = 0;
      for (let cursor = 0; cursor + size <= words.length; cursor++) {
        if (words.slice(cursor, cursor + size).join(" ") === phrase) occurrences++;
      }
      if (occurrences >= 3) return true;
    }
  }
  return false;
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
  if (HTML_LEFTOVER.test(text) || hasVisibleEntity(text)) return false;
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
  // front half of "T. Rowe Price", split at the initial's full stop.
  if (/\s[A-Z]\.$/.test(text)) return false;
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
  // The source's own typesetting, when safe normalization could not remove it.
  // `\textbf{OpenSpace Lab}` is unwrapped upstream and survives; `$2^{128}$`
  // cannot be rewritten without changing what the authors wrote, so the unit
  // goes. Measured over the 2026-10-03 corpus this reached 12 of the 100
  // shipping stories, all of them research abstracts -- the reader sees a
  // backslash, and a reader does not need to know LaTeX to notice that
  // something went wrong.
  if (sourceMarkupRemains(text)) return "source_markup";
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
 * Drop the furniture a source wrapped around its own text, before it is read.
 *
 * One shape: the item's headline repeated at the front of the description. That
 * is "what the provider shipped" rather than "what happened", which is the
 * boundary this module already owns, and the returned flag lets the caller count
 * the rewrite it made.
 */
export function stripSourceFurniture(
  text: string,
  headline: string | undefined,
): { text: string; strippedHeadline: boolean } {
  const withoutHeadline = stripHeadlinePrefix(text, headline);
  return { text: withoutHeadline.text, strippedHeadline: withoutHeadline.stripped };
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
  | "narrator_ambiguous";

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
    if (
      normalization.metadataOnly ||
      furniture.text === "" ||
      metadataOnlyEvidence(furniture.text)
    ) {
      stats.rejectedMetadataOnly += 1;
      return undefined;
    }
    // Last, because the frame is around the sentence that survives everything
    // else: `We present: <fact>` is the authors' pronoun before it is a label.
    const framing = normalizeReportFraming(furniture.text, name === undefined ? [] : [name]);
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

export function selectReaderEvidence(title: string, sources: ReaderSource[]) {
  const stats = emptyNormalizationStats();
  const normalizedSources = sources.map((source) => normalizeReaderSource(source, stats));
  const entities = rankEntities(title, normalizedSources);
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
          : captionSeamSplit(u.text).map((text) => ({
              ...u,
              text,
              origin: "enriched" as const,
              sourceOrder: enrichedOrder++,
            })),
      ),
      ...readerSentences(source.excerpt ?? "").map((text, order) => ({
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
