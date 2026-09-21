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
 * Nothing here is destructive to the underlying data: this is a pure function
 * over text that has already been fetched and sanitized, and the stored
 * `articles.excerpt` is never rewritten.
 */

/** The source a piece of text came from, as far as normalization needs to know. */
export type SourceContext = { name?: string | undefined; url?: string | undefined };

export type SourceFamily = "arxiv" | "generic";

export type SourceNormalization = {
  /** The text with any leading provider/feed metadata fields removed. */
  text: string;
  /** Lowercased labels of the fields that were removed, for diagnostics. */
  removedFields: string[];
  /** True when the text was metadata and nothing else survived. */
  metadataOnly: boolean;
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
  const unchanged: SourceNormalization = {
    text: clean,
    removedFields: [],
    metadataOnly: false,
    family,
  };
  if (clean === "") return unchanged;

  const removed: string[] = [];
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
  if (!opening) return removed.length ? finish(rest, removed, family) : unchanged;

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

  return removed.length ? finish(rest, removed, family) : unchanged;
}

function finish(rest: string, removedFields: string[], family: SourceFamily): SourceNormalization {
  const text = collapse(rest);
  return { text, removedFields, metadataOnly: text === "", family };
}

/**
 * A label from the closed set, lowercased. Anything else -- including a real
 * sentence that happens to contain a colon -- is not a field.
 */
function knownLabel(raw: string): string | null {
  const label = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (label === "" || label.length > MAX_LABEL_LENGTH) return null;
  if (PROSE_LABELS.has(label) || METADATA_LABELS.has(label)) return label;
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

function collapse(text: string): string {
  return text
    .replace(/\uFEFF/g, "")
    .replace(/[ \t\u00a0\u2007\u202f]+/g, " ")
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
 * Detects openings like `According to arXiv cs.CR, ...` -- a category presented
 * as a claimant. The composer is fixed to never build one; this is the gate's
 * backstop for any path that still does.
 */
export function malformedAttribution(text: string): boolean {
  const match = ATTRIBUTION_OPENING.exec(collapse(text));
  return !!match && isRepositorySourceName(match[1]);
}
