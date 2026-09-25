import { extractCompanies, extractProducts } from "./pipeline/extract";
import { claimKey } from "./pipeline/evidence-text";
import {
  decodeEntities,
  hasSourceMetadata,
  hasVisibleEntity,
  metadataOnlyEvidence,
  normalizePlainText,
  normalizeSourceText,
  providerFurniture,
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

/** Whether the text reads as a clause with a predicate, rather than a label or a stub. */
export function hasPredicate(text: string): boolean {
  return (
    ACTION.test(text) ||
    IRREGULAR_PREDICATE.test(text) ||
    REGULAR_PREDICATE.test(text) ||
    PREDICATE_MORPHOLOGY.test(text) ||
    CONTRACTED_PREDICATE.test(text)
  );
}
const NOISE =
  /\b(?:welcome back|weekly column|this week['’]s (?:column|newsletter)|as regular readers know|subscribe to|sign up for|click here|read more|continue reading|cookie policy|all rights reserved|follow us on|share this article|related articles|the coverage centers on|amount mentioned|percentage mentioned|entity mentioned|source count|evidence suggests|nyuz has also covered)\b|\bthe post\b.*\bappeared first on\b|^(?:advertisement|image credit|photo credit|hopefully\b|the takeaway\b)/i;
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
    NOISE.test(text) || publisherVoice(text) || COMMENTARY.test(text) || SOURCE_COLOUR.test(text)
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

/** `Perhaps predictably, ...` -- an adverbial before a capitalised clause. */
const EDITORIAL_ADVERBIAL = new RegExp(`^(?:${EPISTEMIC_ADVERB})[,:]?\\s+(?=[A-Z])`, "i");

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
 * "nothing changed" as the common case. Nothing here paraphrases: the only two
 * operations are deleting a leading comment and deleting a trailing judgement,
 * and the sentence that remains is the one the source wrote.
 */
export function stripEditorialVoice(text: string): string {
  let out = text.trim();
  out = out.replace(STACKED_ADVERBIAL, "");
  out = out.replace(EDITORIAL_ADVERBIAL, "");
  out = out.replace(EVALUATIVE_TAIL, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  if (out === "") return text;
  return /^[a-z]/.test(out) ? out[0]!.toUpperCase() + out.slice(1) : out;
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
      const shift = span === "last" ? -1 : span === "next" ? 1 : 0;
      if (unit === "month") return monthPhrase(shift, at, before);
      if (unit === "year") return yearPhrase(shift, at, before);
      if (day === undefined) return match;
      return dayPhrase(day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0, at, before);
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

/** Do not split a quotation away from its speaker or split decimals and versions. */
export function readerSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
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
      clean[i + 1] === " " &&
      !/^(?:said|says|he|she|they|according|told)\b/.test(clean.slice(i + 2))
    ) {
      out.push(clean.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  if (start < clean.length) out.push(clean.slice(start).trim());
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

export function rankEntities(title: string, sources: ReaderSource[]): RankedEntity[] {
  const texts = sources.map((s) =>
    [s.excerpt ?? "", ...(s.enrichedEvidence ?? []).map((u) => u.text)].join(" "),
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
      const units = [...new Set(texts.flatMap(readerSentences))].filter(inText);
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

const DANGLING_OPENING = /^(?:and|but|or|so|yet|then|also),?\s+/i;
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
  if (BROKEN_ATTRIBUTION.test(text)) return false;
  if (/[,:;]$/.test(text) || /(?:\.\.\.|…)\s*$/.test(text)) return false;
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
export function unitTextRejection(text: string, quote: boolean): EvidenceRejectionReason | null {
  // A heading, first, because most headings pass every test below: "Why identity
  // built for humans breaks at agent speed" has a subject and a verb, which is
  // exactly why a heading used to reach the page as a sentence -- and why it had
  // to be refused again by the composer's gate, after the lead had already been
  // chosen out of it and the deck built from it. A unit that is nothing but a
  // headline is furniture, and it is refused with the furniture.
  if (headlineFragment(text)) return "headline_fragment";
  if (!validDeterministicSentence(text)) return "invalid_sentence";
  if (unresolvableContext(text)) return "unresolved_context";
  if (/…$|\.\.\.$/.test(text)) return "trailing_ellipsis";
  if (unbalancedQuotes(text)) return "unbalanced_quote";
  // A quotation that opens a unit and names nobody is not attributable: the
  // reader cannot tell who said it, and nyuz did not say it.
  if (/^["“]/.test(text) && !/\b(?:said|says|told|according to)\b/.test(text))
    return "unassigned_quote";
  if (!quote && !hasPredicate(text)) return "no_predicate";
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

/** A clause that opens a headline rather than a sentence. */
const WH_HEADLINE = /^(?:Why|How|What|When|Where|Who|Which|Here)\b/;
/**
 * A wh-word opening with no question mark: a headline, never a body sentence.
 *
 * A real `Why ...` sentence is a question and ends in `?`. Without one, the unit
 * is a subhead or a headline that lost its punctuation on the way into a feed,
 * and the composer drops it rather than attributing a headline to its source.
 *
 * A heading *glued* to the sentence after it is not repaired here. That seam is
 * known where the markup is: `htmlToText` ends a heading element, so the heading
 * and the prose after it arrive as two units and this refuses the heading as its
 * own unit. It is unknowable in a plain-text excerpt -- the splitter that guessed
 * produced one reader-visible corruption in the frozen 200-event corpus, cutting
 * "When asked to compare MariaDB with PostgreSQL for the same task, however, it
 * had plenty to say." down to "MariaDB with PostgreSQL for the same task, however,
 * it had plenty to say." -- and glue already stored in an excerpt is a backfill,
 * not a composition rule.
 */
export function headlineFragment(text: string): boolean {
  const trimmed = text.trim();
  return WH_HEADLINE.test(trimmed) && !/\?/.test(trimmed);
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

function recoverContext(text: string, previousText?: string): string | null {
  const previousSubject = previousText?.match(
    /^(?:The )?([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\b/,
  )?.[1];
  const tokens = previousSubject?.split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length === 0 || tokens.every((token) => NOT_AN_ACTOR.has(token.toLowerCase()))) {
    return null;
  }
  // Non-null past the guard above; named so the narrow survives into the closures.
  const subject: string = previousSubject!;
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
  /** Texts that opened by repeating their own item headline. */
  strippedHeadlines: number;
  /** Sentences an editorial adverbial was removed from, keeping the fact. */
  sourceVoiceStripped: number;
  /** Sentences a fronted editorial frame was removed from, keeping the fact. */
  strippedFrames: number;
  /** Sentences refused for carrying a loaded metaphor instead of the fact. */
  sourceColourRejections: number;
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
  /** A unit that is nothing but a headline: a heading, not a sentence. */
  | "headline_fragment"
  | "invalid_sentence"
  | "no_predicate"
  | "editorial_noise"
  | "trailing_ellipsis"
  | "unbalanced_quote"
  | "unassigned_quote"
  /** A pronoun with no antecedent the sentence itself supplies. */
  | "unresolved_context"
  /** A narrator whose subject cannot be restored without guessing. */
  | "narrator_ambiguous";

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
    strippedHeadlines: 0,
    sourceVoiceStripped: 0,
    strippedFrames: 0,
    sourceColourRejections: 0,
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
    stats.authorialVoiceRewrites += normalization.authorialVoiceRewrites;
    // What the provider wrapped around its own text goes next: its headline
    // repeated at the front of the description.
    const furniture = stripSourceFurniture(normalization.text, source.headline);
    if (furniture.strippedHeadline) stats.strippedHeadlines += 1;
    if (
      normalization.metadataOnly ||
      furniture.text === "" ||
      metadataOnlyEvidence(furniture.text)
    ) {
      stats.rejectedMetadataOnly += 1;
      return undefined;
    }
    return furniture.text;
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
    const units = [
      ...(source.enrichedEvidence ?? []).map((u, order) => ({
        ...u,
        origin: "enriched" as const,
        sourceOrder: order,
      })),
      ...readerSentences(source.excerpt ?? "").map((text, order) => ({
        text,
        kind: "fact",
        origin: "rss" as const,
        attribution: undefined,
        sourceOrder: order,
      })),
    ];
    for (const [unitIndex, unit] of units.entries()) {
      const previousText = units[unitIndex - 1]?.text;
      const nextText = units[unitIndex + 1]?.text;
      const quote = unit.kind === "quote" && !!unit.attribution;
      let text = quote
        ? `${unit.attribution} said: "${unit.text}"`
        : unit.text.trim().replace(/®$/, "");
      const retrospective = text.match(/^When we [^,]+, (.+)$/i);
      if (retrospective?.[1] && source.name)
        text = `${source.name} previously reported that ${retrospective[1]}`;
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
      if (antecedent) text = text.replace(/^Its\b/, `${antecedent}'s`).replace(/^It\b/, antecedent);
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
          text = recoverContext(text, previousText) ?? "";
        }
      }
      const voiced = stripEditorialVoice(text);
      if (voiced !== text) {
        stats.sourceVoiceStripped += 1;
        keepSample(stats.samples.voiceStrips, text, voiced);
        text = voiced;
      }
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
        (e) => e.role !== "REPORTING_SOURCE" && text.replace(/^The /, "").startsWith(`${e.name} `),
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
        : unitTextRejection(text, fact.quote);
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
