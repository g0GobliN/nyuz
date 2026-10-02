/**
 * Source-aware normalization: the boundary between what a provider *shipped*
 * and what nyuz is allowed to treat as prose.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * A feed's description field is not the article. Several providers use it as a
 * small structured document -- arXiv's cs.* feeds publish
 *
 *   ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often ...
 *
 * -- so the header, the identifier and the abstract arrive as one string. Every
 * consumer downstream (sentence splitting, evidence validity, scoring, entity
 * ranking, the composer) has no way to tell the header from the sentence,
 * because by the time it sees the text the distinction is gone.
 *
 * Attempting to clean that up in the composer was the earlier mistake: a
 * `Label:` prefix is not a
 * grammar error, so sentence validation passes it; "Announce Type" is three
 * capitalised words, so entity ranking treats it as a subject; and a decorated
 * sentence and its clean twin do not compare equal, so deduplication keeps
 * both. Normalization therefore runs *first*, on the source text, before
 * anything is extracted from it.
 *
 * ---------------------------------------------------------------------------
 * What it recognises, and what it deliberately does not
 * ---------------------------------------------------------------------------
 *
 * Only a leading run of `Label: value` fields is touched, and only when the
 * first thing in the text is a label from a small closed set. That is a
 * structural test, not a word filter, so genuine prose survives untouched:
 *
 *   "The paper was posted to arXiv."            unchanged
 *   "The abstract describes three experiments." unchanged
 *   "The study is classified under computer security." unchanged
 *
 * but
 *
 *   "Abstract: Human approval is often the final boundary."
 *     -> "Human approval is often the final boundary."
 *
 * `Abstract:`, `Summary:` and `Description:` are *prose* fields: the label is
 * dropped and the value is kept, because that value is the actual abstract or
 * summary. Every other field in the set is metadata and its value is dropped --
 * unless the value plainly reads as a sentence, in which case only the label is
 * removed. A unit that is nothing but metadata comes back empty, which callers
 * reject rather than repair.
 *
 * It also resolves a repository's own first-person voice. A paper says "We call
 * this Loopjacking"; nyuz is not the author, so that pronoun becomes "The
 * authors" here -- at the same boundary, for the same reason. Fixing it later
 * would mean the evidence layer had already rejected the sentence as publisher
 * voice, and a lost sentence cannot be repaired by the composer.
 *
 * Nothing here is destructive to the underlying data: this is a pure function
 * over text that has already been fetched and sanitized, and the stored
 * `articles.excerpt` is never rewritten.
 */

/** The source a piece of text came from, as far as normalization needs to know. */
export type SourceContext = { name?: string | undefined; url?: string | undefined };

/* ------------------------------------------------------------------------- */
/* Entities: one decoder, before anything reads the text                    */
/* ------------------------------------------------------------------------- */

/**
 * Named references worth resolving. Deliberately a small, closed map: an
 * unknown `&foo;` is left exactly as it was written, because in a headline
 * `&foo;` is more likely to be text than to be a mistake.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  hellip: "…",
  middot: "·",
  bull: "•",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  laquo: "«",
  raquo: "»",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ccedil: "ç",
  ntilde: "ñ",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
};

/**
 * Resolve HTML/XML character references into plain text characters.
 *
 * This is the single decode path for everything a reader can see, and it exists
 * because the same reference arrived by several routes with different handling:
 * feed XML was decoded at ingest, article pages were decoded by their own
 * extractor, and stored text written by an older build was decoded by neither.
 * A page that published the literal string `&#x20;` is what that costs -- the
 * entity is not whitespace to `\s`, so it survived every collapse, compare and
 * dedupe downstream, and reached the reader as four characters.
 *
 * Numeric references are resolved by code point, decimal and hexadecimal both.
 * `&amp;#x20;` -- a reference escaped twice, which is what a CMS producing
 * `&#x20;` inside a description field looks like -- therefore decodes in one
 * pass to the text `&#x20;`, and the caller's second pass is what turns it into
 * a space. That is why every consumer of this function decodes and *then*
 * collapses whitespace: order matters, and a decoder without the collapse would
 * leave the space visible as a double space instead.
 *
 * Plain text only. Nothing here can produce markup that a renderer would
 * interpret, because the callers strip tags before decoding -- `<script>` that
 * was escaped in the source becomes the harmless text `&lt;script&gt;` -> `
 * <script>` only after the tag pass has already run.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
        // Surrogates and non-characters are not text; leave the reference alone
        // rather than emitting a lone half of a pair.
        if (code >= 0xd800 && code <= 0xdfff) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

/**
 * True when a reference survived every decoder and is still visible as text.
 *
 * The quality gate's backstop: normalization decodes and collapses, so a hit
 * here means the published string literally contains `&#x20;` or `&amp;`, which
 * no reader should ever be shown. Kept narrow -- an ampersand followed by a word
 * and a semicolon is a reference; `AT&T` and `R&D;` are not.
 */
export function hasVisibleEntity(text: string): boolean {
  return /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/.test(text);
}

/**
 * The same boundary, for callers holding a plain string rather than a record.
 *
 * A source's *name* is provider text too, and nothing was normalizing it: a feed
 * titled `The&#x20;Register` -- The Register's own RSS does exactly that, to keep
 * the space from collapsing -- carried those characters into every attribution
 * the composer built, which is how `The  Register reports that ...` reached a
 * reader. Names, labels and titles go through here.
 */
export function normalizePlainText(text: string): string {
  return collapse(text);
}

export type SourceFamily = "arxiv" | "generic";

export type SourceNormalization = {
  /** The text with any leading provider/feed metadata fields removed. */
  text: string;
  /** Lowercased labels of the fields that were removed, for diagnostics. */
  removedFields: string[];
  /** True when the text was metadata and nothing else survived. */
  metadataOnly: boolean;
  /** Sentences whose first-person voice was rewritten to their actual author. */
  authorialVoiceRewrites: number;
  family: SourceFamily;
};

/**
 * Fields whose value is the prose we want. The label is furniture; the value is
 * the article. Kept deliberately short: only fields that genuinely carry text.
 */
const PROSE_LABELS = new Set([
  "abstract",
  "summary",
  "description",
  "content",
  "body",
  "text",
  "excerpt",
  "extract",
  "highlights",
]);

/**
 * Fields that are metadata. Their value describes the record, not the world, so
 * the value goes with the label -- except when it is long enough and structured
 * enough to be a sentence, which is checked separately.
 *
 * Words with ordinary prose meanings and no fixed header use (`update`, `note`,
 * `warning`, `version`, `price`) are deliberately absent: a sentence that
 * happens to start "Note: ..." is text, and stripping it would be a worse bug
 * than the one this module fixes.
 */
const METADATA_LABELS = new Set([
  "arxiv",
  "announce",
  "announce type",
  "title",
  "authors",
  "author",
  "creator",
  "byline",
  "subject",
  "subjects",
  "primary subject",
  "categories",
  "category",
  "primary class",
  "cross-list",
  "crosslist",
  "taxonomy",
  "tags",
  "tag",
  "keywords",
  "comments",
  "journal-ref",
  "journal ref",
  "doi",
  "report-no",
  "report no",
  "msc-class",
  "msc class",
  "acm-class",
  "acm class",
  "cite as",
  "abstract id",
  "identifier",
  "id",
  "guid",
  "feed",
  "source",
  "publisher",
  "publication",
  "published",
  "updated",
  "posted",
  "date",
  "submitted",
  "license",
  "enclosure",
  "permalink",
  "link",
  "url",
  "volume",
  "pages",
  "issn",
  "isbn",
]);

/**
 * Fields that are furniture rather than content: a media credit, a repository
 * trailer, a release page's own labels.
 *
 * Kept apart from `METADATA_LABELS` because these are not merely uninteresting --
 * they are the exact class that used to reach readers as the article deck. A
 * story with no extractable evidence falls back to its stored summary, and that
 * summary is written from the feed's description field, so "Photograph:
 * Alexandra Topping/The Guardian." became the sentence under the headline.
 *
 * The *reason* is part of the type because the fallback path reports why it
 * refused a candidate, and "we published nothing" is only defensible if the
 * answer is legible.
 */
export type FurnitureKind =
  | "photo_credit"
  | "commit_trailer"
  | "release_metadata"
  | "metadata_heavy"
  | "url_heavy"
  | "email_heavy";

/**
 * The closed set of furniture labels, and which family each belongs to.
 *
 * Matched as `Label:` fields, never as words, so a sentence that merely mentions
 * a website, an image, a credit or a commit is untouched:
 *
 *   "The project website says the release includes new CUDA optimizations."  prose
 *   "Getty Images reported a rise in licensing revenue."                    prose
 *   "Developers signed off on the proposal after review."                   prose
 *   "Website: https://llama.app"                                            furniture
 *   "Signed-off-by: khluu khluu000@gmail.com"                                furniture
 */
const FURNITURE_LABELS = new Map<string, FurnitureKind>([
  // Media credits.
  ["photograph", "photo_credit"],
  ["photographs", "photo_credit"],
  ["photography", "photo_credit"],
  ["photographer", "photo_credit"],
  ["photo", "photo_credit"],
  ["photos", "photo_credit"],
  ["image", "photo_credit"],
  ["images", "photo_credit"],
  ["picture", "photo_credit"],
  ["pictures", "photo_credit"],
  ["video", "photo_credit"],
  ["illustration", "photo_credit"],
  ["graphic", "photo_credit"],
  ["credit", "photo_credit"],
  ["credits", "photo_credit"],
  ["composite", "photo_credit"],
  ["source image", "photo_credit"],
  ["file photo", "photo_credit"],
  ["ap photo", "photo_credit"],
  ["reuters photo", "photo_credit"],
  // Repository trailers -- what `git log` writes, not what a reporter writes.
  ["signed-off-by", "commit_trailer"],
  ["co-authored-by", "commit_trailer"],
  ["reviewed-by", "commit_trailer"],
  ["acked-by", "commit_trailer"],
  ["tested-by", "commit_trailer"],
  ["reported-by", "commit_trailer"],
  ["suggested-by", "commit_trailer"],
  ["change-id", "commit_trailer"],
  ["cherry picked from", "commit_trailer"],
  ["merge pull request", "commit_trailer"],
  ["merge branch", "commit_trailer"],
  ["commit", "commit_trailer"],
  ["revision", "commit_trailer"],
  // Release-page fields.
  ["website", "release_metadata"],
  ["attestation", "release_metadata"],
  ["attestations", "release_metadata"],
  ["assets", "release_metadata"],
  ["asset", "release_metadata"],
  ["artifacts", "release_metadata"],
  ["artefacts", "release_metadata"],
  ["checksum", "release_metadata"],
  ["checksums", "release_metadata"],
  ["sha256", "release_metadata"],
  ["sha-256", "release_metadata"],
  ["sha512", "release_metadata"],
  ["download", "release_metadata"],
  ["downloads", "release_metadata"],
  ["installation", "release_metadata"],
  ["install", "release_metadata"],
  ["release", "release_metadata"],
  ["tag", "release_metadata"],
  ["signature", "release_metadata"],
  ["signatures", "release_metadata"],
  ["sbom", "release_metadata"],
]);

/** One word of a label. */
const WORD_RE = /^[A-Za-z][A-Za-z0-9-]*/;
const MAX_LABEL_LENGTH = 24;
const MAX_LABEL_WORDS = 3;

/** How far ahead a following field is looked for. Bounds the work on long text. */
const SCAN_WINDOW = 600;

/** arXiv archive prefixes, so `cs.CR` is a subject code but `example.com` is not. */
const ARCHIVE_PREFIXES = new Set([
  "astro-ph",
  "cond-mat",
  "cs",
  "econ",
  "eess",
  "gr-qc",
  "hep-ex",
  "hep-lat",
  "hep-ph",
  "hep-th",
  "math",
  "math-ph",
  "nlin",
  "nucl-ex",
  "nucl-th",
  "physics",
  "q-bio",
  "q-fin",
  "quant-ph",
  "stat",
]);

const SUBJECT_CODE_RE = /^([a-z][a-z-]{1,14})\.([A-Za-z][A-Za-z-]{1,5})$/;

/** `cs.CR`, `stat.ML`, `hep-th` -- an arXiv subject classification, not a name. */
export function isSubjectCode(token: string): boolean {
  const match = SUBJECT_CODE_RE.exec(token.trim());
  if (!match) return false;
  return ARCHIVE_PREFIXES.has((match[1] ?? "").toLowerCase());
}

/** Which known family this source belongs to. Only arXiv needs special reading. */
export function sourceFamily(source: SourceContext | undefined): SourceFamily {
  const name = source?.name ?? "";
  const url = source?.url ?? "";
  return /\barxiv\b/i.test(name) || /arxiv\.org/i.test(url) ? "arxiv" : "generic";
}

export function normalizeSourceText(
  source: SourceContext | undefined,
  text: string,
): SourceNormalization {
  const family = sourceFamily(source);
  const clean = collapse(text);
  const removed: string[] = [];
  /** One exit, so a subject code, a stripped field and a voice rewrite all land in the same shape. */
  const result = (rest: string): SourceNormalization => finish(rest, removed, family, source);
  if (clean === "") return result("");

  let rest = clean;

  // An arXiv subject code can lead a listing row before any label appears.
  if (family === "arxiv") {
    const code = (rest.split(/\s/, 1)[0] ?? "").replace(/[,;]$/, "");
    if (isSubjectCode(code) && rest.length > code.length) {
      removed.push(code.toLowerCase());
      rest = rest.slice(rest.indexOf(code) + code.length).trim();
    }
  }

  const opening = readFieldAt(rest, 0);
  if (!opening) return result(rest);

  while (rest !== "") {
    const field = readFieldAt(rest, 0);
    if (!field) break;
    removed.push(field.label);
    rest = rest.slice(field.end).trim();
    // A prose field's value is the text we came for.
    if (PROSE_LABELS.has(field.label)) break;
    const next = nextFieldIndex(rest);
    if (next >= 0) {
      rest = rest.slice(next).trim();
      continue;
    }
    // Last field: keep its value only when it reads as a sentence rather than a
    // metadata value, so "Comments: the regulator will review the deal." is a
    // fact and "Comments: 12 pages, 3 figures" is not.
    rest = looksLikeProse(rest) ? rest : "";
    break;
  }

  return result(rest);
}

function finish(
  rest: string,
  removedFields: string[],
  family: SourceFamily,
  source?: SourceContext | undefined,
): SourceNormalization {
  const prose = collapse(rest);
  const voice = normalizeAuthorialVoice(prose, source);
  return {
    text: voice.text,
    removedFields,
    metadataOnly: voice.text === "",
    authorialVoiceRewrites: voice.rewrites,
    family,
  };
}

/**
 * How a research repository's first-person voice reads once reported.
 *
 * A paper says "We call failures of this binding Loopjacking". The verb is
 * right; the voice is not. nyuz is not the author, so publishing "we" makes the
 * article claim work it did not do -- and `publisherVoice` in the evidence layer
 * rejects first-person text outright, which is how an entire abstract written in
 * the first person plural used to disappear from the article. The actors are the
 * authors, and they are known, so the pronoun is resolved rather than dropped.
 *
 * Structural, not a word filter: only a pronoun that *opens* a sentence is
 * touched, because that is where the subject sits. "This lets us compare" and
 * "the approach we adopted" are left exactly as they were.
 *
 * A contraction is a pronoun *and* an auxiliary, so `We've` expands to "The
 * authors have" rather than becoming "The authors've".
 */
const AUTHORIAL_SUBJECT = /(^|(?<=[.!?])\s)(We|Our)(['’]ve|['’]re|['’]ll|['’]d)?\b/g;

const CONTRACTED_AUXILIARY: Record<string, string> = {
  "'ve": "have",
  "’ve": "have",
  "'re": "are",
  "’re": "are",
  "'ll": "will",
  "’ll": "will",
  "'d": "would",
  "’d": "would",
};

export function normalizeAuthorialVoice(
  text: string,
  source?: SourceContext | undefined,
): { text: string; rewrites: number } {
  if (!isRepositorySourceName(source?.name)) return { text, rewrites: 0 };
  let rewrites = 0;
  const out = text.replace(
    AUTHORIAL_SUBJECT,
    (_match: string, boundary: string, subject: string, contraction?: string) => {
      rewrites += 1;
      if (subject === "Our") return `${boundary}The authors'`;
      if (contraction)
        return `${boundary}The authors ${CONTRACTED_AUXILIARY[contraction] ?? "have"}`;
      return `${boundary}The authors`;
    },
  );
  return { text: rewrites > 0 ? out : text, rewrites };
}

/**
 * Typesetting commands that wrap a run of ordinary words.
 *
 * The payload is prose, so dropping the wrapper keeps the sentence and loses
 * nothing a reader could read. Deliberately a closed list of wrappers only: a
 * general "strip any LaTeX command" rule is what turns `$\textit{Parity-$G$
 * games}$` into a phrase that is no longer the authors' phrase, and nyuz has no
 * business rewriting a paper's terminology.
 */
const WORD_WRAPPERS = /\\(textbf|textit|emph|textnormal|textbfit)\{([^{}$^\\]*)\}/g;

/**
 * A wrapper whose entire payload is plain prose.
 *
 * The test is on the payload, not the command: `\textit{ordinary words}` is
 * recoverable and `\textit{Parity-$G$ games}` is not, and both use the same
 * command. Anything with a nested brace, a dollar, a backslash or a caret is
 * therefore left alone, which is what keeps a wrapper around a formula from
 * being flattened into the formula's neighbour.
 */
const SAFE_WRAPPED_PROSE = /\\(textbf|textit|emph|textnormal|textbfit)\{([^{}$^\\]*)\}/g;
/**
 * Mathematical markup whose syntax carries meaning.
 *
 * `$2^{128}$`, `$(3,6)$`: no deterministic rewrite preserves the expression, and
 * an ASCII transliteration is a change of content wearing a cleanup costume. A
 * unit carrying one of these is refused rather than published, which is the same
 * trade every other refusal in this module makes -- a shorter article beats an
 * article that shows the reader its source's serialization syntax.
 *
 * A dollar-delimited run counts as mathematics only when its content carries a
 * mathematical signal. A bare `$` pair does not: "range from $300 for a
 * 43-inch model to $2,300" is two prices, and the first draft of this rule
 * flagged six real news sentences as contaminated because of it.
 */
const MATH_SIGNAL = /[\\^_=+(){}]|\\frac|\\cdot/;
const MATH_PAIR = /\$[^$\n]{1,200}\$/;
const MATH_DELIMITED = /\\\(|\\\)|\\\[|\\\]/;

/**
 * Money is a dollar sign before a number, twice.
 *
 * `$300 for a 43-inch model to $2,300` opens on a digit and closes on a digit;
 * `$k$` and `$Parity Magic Square Game$` do neither. One test, no vocabulary,
 * and it settles every measured span: the prices stay prices and the symbols
 * become the words they were standing in for.
 */
function isCurrencySpan(span: string, next: string | undefined): boolean {
  return /\d/.test(span.charAt(1)) && /\d/.test(next ?? "");
}

/**
 * A backslash that only quotes punctuation, which the briefing can drop: `\%`
 * is a percent sign, not a command. The set is closed -- a backslash before a
 * letter is a real command and is left for the refusal path to judge.
 *
 * The lookbehind is what keeps `\\` intact. Two backslashes are LaTeX's own
 * line break, and a rule without it would rewrite the second one and turn a
 * pair into a single stray backslash.
 */
const PRESENTATIONAL_ESCAPE = /(?<!\\)\\([%&$#_{}])/g;

/**
 * What survives removing presentational escapes is the expression itself.
 *
 * `$98\%$` reduces to `98%` and is the number the authors reported. `$2^{128}$`
 * reduces to itself, and flattening it would read as the year 2128 -- so the
 * line is drawn after the escapes, not before them.
 */
const MATH_STRUCTURE = /[\^_{}=()+\\]/;

/**
 * An inline formula, rendered as the token it stands for.
 *
 * A briefing does not typeset. `$k$` is `k`, `$1/K$` is `1/K`, `$98\%$` is
 * `98%` -- the same value, without the source's serialization showing through.
 * A span with structure is left alone for `hasSemanticMath` to refuse.
 */
function unwrapInlineMath(text: string): { text: string; unwrapped: number } {
  let unwrapped = 0;
  const out = text.replace(
    /\$([^$\n]{1,200})\$/g,
    (span: string, body: string, offset: number, whole: string) => {
      if (isCurrencySpan(span, whole[offset + span.length])) return span;
      const payload = body.replace(PRESENTATIONAL_ESCAPE, "$1");
      if (MATH_STRUCTURE.test(payload)) return span;
      unwrapped += 1;
      return payload.trim();
    },
  );
  return { text: out, unwrapped };
}

function hasSemanticMath(text: string): boolean {
  if (MATH_DELIMITED.test(text)) return true;
  if (/\\[a-zA-Z]+/.test(text)) return true;
  // Every pair, not the first: an E91 abstract opened with `$0.135$` and hid
  // `$98\%$` behind it, which is how seven blocks of arithmetic reached a
  // reader while the check that was meant to stop them reported clean.
  for (const match of text.matchAll(/\$[^$\n]{1,200}\$/g)) {
    const span = match[0];
    if (span === undefined) continue;
    const next = text[match.index + span.length];
    if (isCurrencySpan(span, next)) continue;
    if (MATH_SIGNAL.test(span)) return true;
  }
  return false;
}

/**
 * Whether the text still shows its source's markup after safe normalization.
 *
 * A cheap diagnostic for the evidence layer and the audit: a gate that no
 * longer produces these is only proven by reading what came out.
 */
export function sourceMarkupRemains(text: string): boolean {
  if (hasSemanticMath(text)) return true;
  // A wrapper whose payload was not plain prose survives normalization.
  return /\\[a-zA-Z]+\{/.test(text);
}

/**
 * A source's own typesetting, normalized where that is safe and refused where
 * it is not.
 *
 * Applied to the unit, never to the story. A paper whose abstract is four facts
 * keeps the three that read as prose and loses the one that is a formula, and
 * the briefability floor then decides whether the story still ships -- the same
 * composition the empty-story gate already made.
 */
/**
 * Markup a publisher truncated before sending it, leaving no tag name behind.
 *
 * NPR shipped "intelligence personnel.'/>NAZA is an acronym", where the tag name
 * is simply absent from the feed -- there is no opening angle bracket anywhere
 * in the text, so there is no tag to strip and nothing to infer about what it
 * said. What the residue does carry is a boundary, and the source's own full
 * stop and the stray closing quote sit on either side of it.
 *
 * Measured rather than assumed. Replacing only the residue with a space leaves
 * the splitter with "personnel.' NAZA", which is one sentence, because the
 * apostrophe stands between the full stop and the space. Removing the quote with
 * it gives two sentences that read correctly on their own -- which is why the
 * quote comes off too: it has no function in either reading, and leaving it
 * publishes a sentence that is not English.
 */
const ORPHANED_TAG_BOUNDARY = /['’]\s*\/>/g;

/**
 * The dash and quote characters a source spells with punctuation runs.
 *
 * A paper typesets an em dash as three hyphens, an en dash as two, and a quote
 * as a doubled backtick and a doubled apostrophe. None of that is English, and
 * a reader who sees `Mermin--Peres` or a stray backtick before a quoted word
 * concludes the text was assembled by something rather than written by someone.
 *
 * The runs are resolved longest-first and each is anchored on the character
 * that makes it unambiguous: an en dash needs a hyphen on both sides of it, and
 * a closing quote needs a word before it, so `rock 'n' roll` keeps its
 * apostrophes.
 */
const LATEX_QUOTES = /(?<!`)\x60\x60|(?<=[^\s([{])''/g;

function normalizeLatexPunctuation(text: string): { text: string; rewritten: number } {
  // Two passes rather than one pattern: once the three-hyphen em dash is gone,
  // what is left between hyphens is unambiguous, so the en dash does not have
  // to be told apart from the first two of three.
  let em = 0;
  let en = 0;
  const dashed = text
    .replace(/---/g, () => {
      em += 1;
      return "\u2014";
    })
    .replace(/(^|[^-])--(?!-)/g, (_match, lead: string) => {
      en += 1;
      return `${lead}\u2013`;
    });
  let quotes = 0;
  const quoted = dashed.replace(LATEX_QUOTES, (match) => {
    quotes += 1;
    return match === "\x60\x60" ? "\u201C" : "\u201D";
  });
  return { text: quoted, rewritten: em + en + quotes };
}

export function normalizeSourceMarkup(text: string): { text: string; unwrapped: number } {
  // `/` is in the guard for the orphaned boundary: a unit can carry one with no
  // dollar, backtick, backslash or hyphen anywhere in it.
  if (!/[$`\\/-]/.test(text)) return { text, unwrapped: 0 };
  let unwrapped = 0;
  const out = text.replace(SAFE_WRAPPED_PROSE, (_match, _command: string, payload: string) => {
    unwrapped += 1;
    return payload;
  });
  const math = unwrapInlineMath(out);
  let orphaned = 0;
  const joined = math.text.replace(ORPHANED_TAG_BOUNDARY, () => {
    orphaned += 1;
    return " ";
  });
  unwrapped += orphaned;
  // The same escape class, on the bare text as well as inside a math span. The
  // first pass only reached `$98\%$`, and two abstracts that wrote `1.8\%` with
  // no dollar signs at all kept showing the reader a backslash.
  let bareEscapes = 0;
  const bare = joined.replace(PRESENTATIONAL_ESCAPE, (_match, literal: string) => {
    bareEscapes += 1;
    return literal;
  });
  unwrapped += bareEscapes;
  const punctuation = normalizeLatexPunctuation(bare);
  return { text: punctuation.text, unwrapped: unwrapped + math.unwrapped + punctuation.rewritten };
}

/**
 * A label from the closed set, lowercased. Anything else -- including a real
 * sentence that happens to contain a colon -- is not a field.
 */
function knownLabel(raw: string): string | null {
  const label = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (label === "" || label.length > MAX_LABEL_LENGTH) return null;
  if (PROSE_LABELS.has(label) || METADATA_LABELS.has(label) || FURNITURE_LABELS.has(label))
    return label;
  return null;
}

/**
 * The known field starting at `index`, and where its label and colon end.
 *
 * Every label length is tried from shortest to longest, and the result is the
 * first *known* label followed by a colon. Trying the longest run first -- which
 * is what a greedy `(word)( word){0,2}:` does -- silently eats a real boundary:
 * in `Comments: 14 pages, 2 figures Abstract: <prose>` the two-word candidate
 * "figures Abstract" matches and consumes the very colon that identifies the
 * `Abstract:` field, so the abstract gets treated as part of `Comments`.
 */
function readFieldAt(text: string, index: number): { label: string; end: number } | null {
  for (let words = 1; words <= MAX_LABEL_WORDS; words++) {
    const labelEnd = runEnd(text, index, words);
    if (labelEnd < 0) return null;
    if (text[labelEnd] !== ":") continue;
    const label = knownLabel(text.slice(index, labelEnd));
    if (!label) continue;
    // Whitespace after the colon is the usual separator, but not a required one:
    // arXiv writes `arXiv:2609.21081v1`, with the identifier tight to the colon.
    const after = labelEnd + 1;
    return { label, end: text[after] === " " ? after + 1 : after };
  }
  return null;
}

/** The offset just past `words` whitespace-separated words, or -1. */
function runEnd(text: string, index: number, words: number): number {
  let cursor = index;
  for (let word = 0; word < words; word++) {
    if (word > 0) {
      if (text[cursor] !== " ") return -1;
      cursor += 1;
    }
    const match = WORD_RE.exec(text.slice(cursor, cursor + MAX_LABEL_LENGTH + 1));
    if (!match) return -1;
    cursor += match[0].length;
  }
  return cursor;
}

/**
 * Index of the next known `Label:`, or -1. Bounded to `SCAN_WINDOW`, and only
 * positions after a space are considered, because a field boundary is a space.
 */
function nextFieldIndex(text: string): number {
  const window = text.slice(0, SCAN_WINDOW);
  for (let index = 1; index < window.length; index++) {
    if (window[index - 1] !== " ") continue;
    if (readFieldAt(window, index)) return index - 1;
  }
  return -1;
}

/**
 * Whether a metadata field's value is really a sentence. Deliberately crude and
 * conservative: a handful of words plus a verb. Under-detecting keeps a fact out
 * of an article; over-detecting publishes a header as prose, so this errs
 * toward stripping only obvious metadata values.
 */
function looksLikeProse(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  return /\b(?:is|are|was|were|be|has|have|had|will|would|can|could|may|might|said|says|reports?|reported|announced|found|shows?|released|requires?|uses?|used|plans?|expects?|argues?|proposes?|describes?|develops?|creates?|targets?|treats?|treated|executes?|runs?|builds?|raised|fell|rose|grew|remains?|continues?|includes?|supports?|offers?|leads?|gives?|takes?|makes?|works?)\b/i.test(
    value,
  );
}

/**
 * Decode references, then fold every kind of space into one ordinary space.
 *
 * The decode is *inside* the collapse on purpose. `&#x20;` and `&nbsp;` are not
 * matched by `\s`, so collapsing first and decoding second produces a double
 * space where the reader should see one -- and a double space is the visible
 * fingerprint of text that was decoded too late. Full-width spaces, zero-width
 * characters and the narrow no-break spaces are folded here too, because they
 * come from the same escaping layer and are equally invisible in a source API.
 *
 * Decoded twice. The second pass is what resolves a reference that was escaped
 * once more by an intermediary (`&amp;#x20;`, which is what a CMS publishing
 * `&#x20;` inside a description field looks like) -- one pass leaves the literal
 * characters on the page. A third level is left to `hasVisibleEntity` at the
 * gate, because at that point we are no longer looking at an escaping artefact.
 */
function collapse(text: string): string {
  return decodeEntities(decodeEntities(text))
    .replace(/\uFEFF|\u200B|\u200C|\u200D|\u2060/g, "")
    .replace(/[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * True when this text still *starts* with a provider field. The composer's
 * quality gate reads this: normalization should already have removed such a
 * prefix, so a hit here means a leak reached the final prose and the sentence
 * must not be published.
 */
export function hasSourceMetadata(text: string): boolean {
  return readFieldAt(collapse(text), 0) !== null;
}

/**
 * True when a unit carries no prose at all -- nothing survived normalization, or
 * what is left is only identifiers and subject codes. Such a unit is dropped
 * rather than repaired; it never said anything.
 */
export function metadataOnlyEvidence(text: string): boolean {
  const clean = collapse(text);
  if (clean === "") return true;
  const tokens = clean.split(/[\s,;|/]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 3) return false;
  return tokens.every(
    (token) =>
      isSubjectCode(token) ||
      /^[vV]?\d[\d.\-v]*$/.test(token) ||
      /^(?:cs|stat|math|eess|econ)$/i.test(token),
  );
}

/* ------------------------------------------------------------------------- */
/* Source semantics: who is speaking                                         */
/* ------------------------------------------------------------------------- */

/**
 * Repositories and aggregators. They publish what someone else claims, so they
 * are the wrong subject for "X reports that ...": arXiv does not assert that
 * human approval is the last security boundary, the paper's authors do.
 */
const REPOSITORY_NAMES =
  /\b(?:arxiv|biorxiv|medrxiv|chemrxiv|ssrn|osf|preprints?|pubmed|pmc|europepmc|doaj|repec|zenodo|hal|openreview|semantic scholar|dblp|researchgate|scilit|core)\b/i;

/**
 * True when a source name identifies a repository or a subject taxonomy rather
 * than a person or organisation that can make a claim. `arXiv cs.CR` is the
 * repository *and* a category; `cs.LG` is only a category.
 */
export function isRepositorySourceName(name: string | undefined): boolean {
  const clean = (name ?? "").trim();
  if (clean === "") return false;
  if (REPOSITORY_NAMES.test(clean)) return true;
  return clean.split(/[\s,;|/()]+/).some((token) => isSubjectCode(token));
}

/** An opening that attributes a claim to a repository or taxonomy. */
const ATTRIBUTION_OPENING = /^(?:according to|as reported by)\s+([^,;:]{1,80})[,;]/i;

/**
 * The function words that may not keep a capital in the clause after `that`.
 *
 * Exported because two rules need the same answer, and a disagreement between
 * them is a bug whichever way it goes: the composer lower-cases exactly these
 * when it builds a reported clause, and `GLUED_ATTRIBUTION` refuses a block that
 * still shows one capitalized. While they disagreed, `If the user's intent is
 * unclear ...` was refused as a malformed attribution *because* the composer had
 * stopped lowering `If` -- the gate was reading the composer's own output as a
 * defect, and the fact was dropped.
 *
 * A word that can begin a name is deliberately absent: `The`, `This`, `All`,
 * `These`. "The Register reports that DigiCert doesn't see ..." is correct
 * English and "all Things Considered host Mary Louise Kelly" is a name, so no
 * list can settle those; the composer leaves their capital alone and the gate
 * says nothing about them.
 */
export const REPORTED_CLAUSE_WORDS =
  "Once|When|While|Because|Although|After|Before|If|Since|Only|Both|But|And|Or|So|Yet|However|Meanwhile|In";

/**
 * Detects openings like `According to arXiv cs.CR, ...` -- a category presented
 * as a claimant. The composer is fixed to never build one; this is the gate's
 * backstop for any path that still does.
 */
export function malformedAttribution(text: string): boolean {
  const match = ATTRIBUTION_OPENING.exec(collapse(text));
  return !!match && isRepositorySourceName(match[1]);
}

/**
 * An attribution glued to a clause it cannot introduce.
 *
 * The composer is fixed not to build these, and this is the gate's backstop for
 * any path that still does. Three productions of the same mistake:
 *
 *   "The Register reports that Once they were out in the wild, ..."
 *   "The Register reports that Only half could trace AI decisions ..."
 *   "The Register reports that "But visibility into how many agents I have?""
 *
 * All three are one bug: a capitalised clause (or a quotation) pasted after
 * `reports that`, which only takes a lower-case declarative or a name. A name is
 * why this cannot simply test for a capital letter -- `reports that DigiCert
 * doesn't see ...` is correct English -- so the test is the closed set of
 * function words that must be lower-case in that position, plus an opening quote.
 */
const GLUED_ATTRIBUTION = new RegExp(
  `\\b(?:reports?|reported|said|says|told[^,.;:]{0,24})\\s+that\\s+(?:${REPORTED_CLAUSE_WORDS})\\b|\\b(?:reports?|said|says)\\s+that\\s+["“]`,
);

export function gluedAttribution(text: string): boolean {
  return GLUED_ATTRIBUTION.test(collapse(text));
}

/* ------------------------------------------------------------------------- */
/* Furniture: what a provider shipped that is not prose                      */
/* ------------------------------------------------------------------------- */

/**
 * Whether this text is provider furniture, and which kind.
 *
 * The class this exists for is the one that reaches readers without ever meeting
 * the composer: a story with no usable evidence publishes its stored summary as
 * the article deck, and that summary is written straight from a feed's
 * `description` field. Nothing between the feed and the page asked whether the
 * description was prose, so media credits, `git` trailers and release-page
 * labels shipped under headlines.
 *
 * Deliberately structural, and deliberately narrow. Every test below keys off a
 * `Label:` field, a name/credit shape, or machine data -- never off a word that
 * has an ordinary prose meaning:
 *
 *   "Getty Images reported a rise in licensing revenue."                    prose
 *   "The photographer told Reuters that the image was taken on Monday."     prose
 *   "Developers signed off on the proposal after review."                   prose
 *   "The project website says the release includes new CUDA optimizations." prose
 *
 * but
 *
 *   "Photograph: Alexandra Topping/The Guardian."                            photo_credit
 *   "Composite: Kin Cheung/Getty Images; Tasos Katopodis/Getty"             photo_credit
 *   "Signed-off-by: khluu khluu000@gmail.com"                                commit_trailer
 *   "Website: https://llama.app Attestations: ..."                           release_metadata
 *
 * A buried field is only furniture when the text carries *two* of them. That
 * distinction is what keeps "The team confirmed the release: version 4 ships
 * Friday." in print while a release page's label list does not.
 */
export function providerFurniture(text: string): FurnitureKind | null {
  const clean = collapse(text);
  if (clean === "") return null;
  const opening = readFieldAt(clean, 0);
  const openingKind = opening ? (FURNITURE_LABELS.get(opening.label) ?? null) : null;
  if (openingKind) return openingKind;
  const buried = buriedFurniture(clean);
  if (buried) return buried;
  if (looksLikeCredit(clean)) return "photo_credit";
  return machineDataKind(clean);
}

/**
 * The family of the second furniture field in the text, or null.
 *
 * Counting to two, rather than returning on the first hit, is the whole point: a
 * field that leads the text is the provider labelling its own record, but the
 * same word appearing once inside a sentence is just a sentence. `Website:`
 * twice is a release page; `release:` once is English.
 */
function buriedFurniture(text: string): FurnitureKind | null {
  let seen: FurnitureKind | null = null;
  const limit = Math.min(text.length, SCAN_WINDOW);
  for (let index = 0; index <= limit; index++) {
    if (index > 0 && text[index - 1] !== " ") continue;
    const field = readFieldAt(text, index);
    if (!field) continue;
    const kind = FURNITURE_LABELS.get(field.label) ?? null;
    if (!kind) continue;
    if (seen) return seen;
    seen = kind;
  }
  return null;
}

/**
 * `Kin`, `Cheung/Getty`, `Alexandra Topping/The Guardian` -- a name, optionally
 * paired with the outlet that published it.
 */
const NAME_TOKEN = /^[A-Z][\p{L}'’.-]{1,}(?:\/[A-Z][\p{L}'’.-]{1,})?$/u;

/** Words that open a sentence rather than name a person. */
const CREDIT_FUNCTION_WORDS = new Set([
  "The",
  "A",
  "An",
  "In",
  "On",
  "At",
  "Of",
  "For",
  "And",
  "But",
  "By",
  "With",
  "From",
  "To",
  "It",
  "This",
  "That",
  "As",
  "Or",
  "Is",
  "Was",
  "More",
]);

/**
 * A credit with its label already stripped: a slash between names and almost no
 * other vocabulary. `Getty Images reported a rise in licensing revenue.` has no
 * slash at all, and `The report was filed by Mary Smith/The Times in Washington.`
 * spends most of its words on the sentence around the credit.
 *
 * "Almost no other vocabulary" is counted, not averaged. A share of name-shaped
 * tokens is the wrong ruler for a sentence: `Trump/Xi` is a name pair to this
 * pattern, and "According to NPR News, All Things Considered host Mary Louise
 * Kelly talks with White House correspondent Emily Feng about the Trump/Xi
 * summit." is 14 name-shaped tokens out of 22 -- past the 0.6 share this used to
 * require, so the deck was refused as a photo credit and the story published
 * nothing at all. It escaped only while the composer was lowercasing `All`,
 * which is one capital and no vocabulary. Two words that are not names is what
 * a credit looks like ("Kin Cheung/Getty Images; Tasos Katopodis/Getty" is zero
 * of them); a sentence that spends eight on its own grammar is a sentence.
 */
const CREDIT_OTHER_WORDS = 2;

function looksLikeCredit(text: string): boolean {
  if (text.includes(":")) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let names = 0;
  let slash = false;
  for (const token of tokens) {
    const bare = token.replace(/[.,;|]+$/, "");
    if (bare.includes("/")) slash = true;
    if (NAME_TOKEN.test(bare) && !CREDIT_FUNCTION_WORDS.has(bare)) names += 1;
  }
  return slash && names >= 2 && tokens.length - names <= CREDIT_OTHER_WORDS;
}

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.[\w-]+\.[a-z]{2,}\S*/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
/** A signature or blob: long, alphabet-plus-base64, no word breaks. */
const BLOB_RE = /\b[A-Za-z0-9+/]{32,}={0,2}\b/;
/** A commit id: hex, long enough to be one, and carrying at least one digit. */
const HASH_RE = /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)[0-9a-f]*[a-f][0-9a-f]*\b/i;

/**
 * Machine data dominating a short string. A single identifier inside an ordinary
 * sentence is not machine text -- a quarter of a short string is.
 */
function machineDataKind(text: string): FurnitureKind | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 24) return null;
  let urls = 0;
  let emails = 0;
  let blobs = 0;
  for (const token of tokens) {
    if (URL_RE.test(token)) urls += 1;
    else if (EMAIL_RE.test(token)) emails += 1;
    else if (BLOB_RE.test(token) || HASH_RE.test(token)) blobs += 1;
  }
  const machine = urls + emails + blobs;
  if (machine === 0) return null;
  if (machine / tokens.length < 0.25) return null;
  if (urls >= emails && urls >= blobs) return "url_heavy";
  return emails >= blobs ? "email_heavy" : "metadata_heavy";
}
