import { extractCompanies, extractProducts } from "./pipeline/extract";
import { claimKey } from "./pipeline/evidence-text";
import {
  hasSourceMetadata,
  metadataOnlyEvidence,
  normalizeSourceText,
  providerFurniture,
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

/** Whether the text reads as a clause with a predicate, rather than a label or a stub. */
export function hasPredicate(text: string): boolean {
  return (
    ACTION.test(text) ||
    IRREGULAR_PREDICATE.test(text) ||
    REGULAR_PREDICATE.test(text) ||
    PREDICATE_MORPHOLOGY.test(text)
  );
}
const NOISE =
  /\b(?:welcome back|weekly column|this week['’]s (?:column|newsletter)|as regular readers know|subscribe to|sign up for|click here|read more|continue reading|cookie policy|all rights reserved|follow us on|share this article|related articles|the coverage centers on|amount mentioned|percentage mentioned|entity mentioned|source count|evidence suggests|nyuz has also covered)\b|\bthe post\b.*\bappeared first on\b|^(?:advertisement|image credit|photo credit|hopefully\b|the takeaway\b)/i;
const VOICE = /\b(?:we|we['’](?:ve|re|ll|d)|our|ours|you|your|as I remember)\b/i;
const COMMENTARY =
  /\b(?:tales of woe|gaping hole|so swimmingly|popularity is undeniable|likely a contributing factor|more important changes are less|make so many enemies|gaining ground fast|winning supporters and boosters|just in case there was|eye[- ]popping|alarming valuations?|all[- ]encompassing|world away from|remember how to be|older,? less attractive)\b|^Even if\b|^[^.!?]{1,45},[^.!?]{1,45}\sThe problem\b/i;
const DEPENDENT_OPENING =
  /^(?:this|that|these|those|it|they|he|she|its|their|the figure|the result|the move|the change|using the same|use the same)\b/i;

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

export function contextDependent(text: string): boolean {
  return DEPENDENT_OPENING.test(text.trim()) || /\bthe figure\b/i.test(text);
}

/** Quoted speech belongs to its speaker, not the publication. */
export function publisherVoice(text: string): boolean {
  const unquoted = text.replace(/"[^"\n]*"|“[^”\n]*”/g, "");
  return VOICE.test(unquoted);
}

export function editorialNoise(text: string): boolean {
  return NOISE.test(text) || publisherVoice(text) || COMMENTARY.test(text);
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
const HTML_LEFTOVER = /<\/?[a-z][^>]*>|&(?:amp|nbsp|quot|lt|gt|#\d+);/i;

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
  let text = stripControls(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|nbsp|quot|lt|gt);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  if (HTML_LEFTOVER.test(text) || DANGLING_OPENING.test(text) || FRAGMENT_OPENING.test(text))
    return false;
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
  return sources[evidence[0]! - 1]?.name?.trim() || undefined;
}

function recoverContext(text: string, previousText?: string): string {
  const previousSubject = previousText?.match(
    /^(?:The )?([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\b/,
  )?.[1];
  if (!previousSubject) return text;
  return text
    .replace(/^The figure\b/i, "The figure described above")
    .replace(/^That figure\b/i, "That figure described above")
    .replace(/^Its\b/i, `${previousSubject}'s`)
    .replace(/^It\b/i, previousSubject);
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
};

/**
 * Why one candidate unit did not become evidence. Counted per unit, and the
 * counts add up to `rejectedCount`, so a dropped sentence is always explicable.
 */
export type EvidenceRejectionReason =
  | "invalid_sentence"
  | "no_predicate"
  | "editorial_noise"
  | "trailing_ellipsis"
  | "unbalanced_quote"
  | "unassigned_quote";

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
    nearDuplicateMerges: 0,
    preferredCleanVariant: 0,
  };
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
  const context: SourceContext = { name: source.name, url: undefined };
  const keep = (text: string): string | undefined => {
    const normalization = normalizeSourceText(context, text);
    if (normalization.removedFields.length) {
      stats.removedMetadataFields += normalization.removedFields.length;
      stats.cleanedEvidence += 1;
    }
    stats.authorialVoiceRewrites += normalization.authorialVoiceRewrites;
    if (normalization.metadataOnly || metadataOnlyEvidence(normalization.text)) {
      stats.rejectedMetadataOnly += 1;
      return undefined;
    }
    return normalization.text;
  };

  const excerpt = source.excerpt === undefined ? undefined : keep(source.excerpt);
  const enrichedEvidence = source.enrichedEvidence?.flatMap((unit) => {
    const text = keep(unit.text);
    return text === undefined ? [] : [{ ...unit, text }];
  });

  return {
    ...source,
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
      if (contextDependent(text)) {
        // Keep comparative/pronominal sentences only when their source-local
        // context gives them an explicit subject. Never guess a missing noun.
        if (!previousText || contextDependent(previousText)) continue;
        text = recoverContext(text, previousText);
      }
      text = cleanDeterministicSentence(normalizeEvidenceText(text));
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
      });
    }
  });
  const accepted: ReaderFact[] = [];
  let rejected = 0;
  let duplicates = 0;
  // One entry per refused unit, so the counts always explain `rejectedCount`.
  const rejectionReasons: Record<EvidenceRejectionReason, number> = {
    invalid_sentence: 0,
    no_predicate: 0,
    editorial_noise: 0,
    trailing_ellipsis: 0,
    unbalanced_quote: 0,
    unassigned_quote: 0,
  };
  for (const fact of raw) {
    const text = fact.text;
    const unbalanced =
      (text.match(/"/g)?.length ?? 0) % 2 !== 0 ||
      (text.match(/“/g)?.length ?? 0) !== (text.match(/”/g)?.length ?? 0);
    const unassignedQuote = /^["“]/.test(text) && !/\b(?:said|says|told|according to)\b/.test(text);
    const reason: EvidenceRejectionReason | null = !validDeterministicSentence(text)
      ? "invalid_sentence"
      : fact.score <= -100
        ? "editorial_noise"
        : /…$|\.\.\.$/.test(text)
          ? "trailing_ellipsis"
          : unbalanced
            ? "unbalanced_quote"
            : unassignedQuote
              ? "unassigned_quote"
              : !fact.quote && !hasPredicate(text)
                ? "no_predicate"
                : null;
    if (reason) {
      rejectionReasons[reason] += 1;
      rejected++;
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
    contextDependencyRejections: raw.filter((fact) => contextDependent(fact.text)).length,
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
    },
    dedupe: {
      nearDuplicateMerges: stats.nearDuplicateMerges,
      preferredCleanVariant: stats.preferredCleanVariant,
    },
  };
}
