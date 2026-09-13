/**
 * What a reader's own words mean, deterministically.
 *
 * A custom interest is free text, so three questions have to be answered the
 * same way everywhere: is this a usable topic, what is its canonical identity,
 * and what does an event have to say for it to count as being about this. All
 * three are pure functions over a string, with no model anywhere near them —
 * that is the point. Stage 5 is the only stage whose work grows with the number
 * of readers, so the rule that decides whether "Nepal" reaches an event has to
 * be arithmetic, and it has to be the same arithmetic the selector, the save
 * path and the tests all use.
 *
 * Deliberately NOT clever. "China", "India vs China", "China economy" and
 * "US-China chips" are four different interests and stay four rows. Nothing
 * here tries to merge them to save space; the cost of wrongly merging two
 * subjects is a reader who quietly stops receiving something they asked for,
 * which is invisible, whereas the cost of a near-duplicate row is one row.
 *
 * No imports, for the reason `relate.ts` has none: the pipeline runs in a
 * Worker and in Node scripts, and neither has `import.meta.env`.
 */

/**
 * Characters after normalisation, not before.
 *
 * 60 is well past any real subject — "Manchester United transfers" is 27,
 * "US-China chip restrictions" is 26 — and short enough that a label always
 * renders on one line in a chip. The transport schema in
 * `src/lib/server/preferences.ts` allows 80, so a value between the two is
 * received and refused here rather than truncated: half a topic is a different
 * topic, and storing one would create a canonical row nobody asked for.
 */
import { isJunkSubject } from "./subject-input";

export const MAX_TOPIC_LABEL = 60;

/**
 * Two, because a single character is a subject in Han but never in Latin, and
 * the floor has to hold for the shortest real case rather than the average one.
 * `related`'s three-character rule handles the looseness that follows.
 */
export const MIN_TOPIC_LABEL = 2;

/** Match terms per topic. Past this a phrase is a sentence, not an interest. */
const MAX_TERMS = 6;

/**
 * Scripts written without spaces between words.
 *
 * For these, word-boundary matching is meaningless — "日本の地震" is one run of
 * characters — so containment is the only available test, and it is safe
 * precisely because the characters are dense: a two-character Han term carries
 * about as much information as an eight-letter Latin one.
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;

/**
 * Words that carry no subject on their own.
 *
 * Only function words, and only enough of them that "India vs China" reduces to
 * the two countries. A stoplist that reached for topical words would start
 * merging distinct interests, which is the one thing this module must not do.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "v",
  "vs",
  "versus",
  "with",
]);

/**
 * Characters a subject is made of: letters, digits, and combining marks.
 *
 * `\p{M}` is not optional and its absence was a real bug. Devanagari vowel
 * signs are marks, not letters — "नेपाल" is न + े + प + ा + ल — so a class of
 * only letters and numbers shreds it into "न-प-ल", a different word. The same
 * holds for Arabic, Thai and Hebrew pointing. Latin accents never reach here,
 * because `fold` has already removed them.
 */
const SUBJECT_CHARS = /[^\p{L}\p{N}\p{M}]+/gu;
const SUBJECT_BASE = /[\p{L}\p{N}]/u;

/**
 * Latin accents folded away, everything else left alone.
 *
 * Decompose, then drop only the combining diacritics block, so "Café" and
 * "Cafe" are one subject. That range is Latin-focused by construction:
 * Devanagari and Arabic marks live well outside it and survive, which is the
 * difference between folding an accent and destroying a word.
 *
 * Applied to BOTH sides of every comparison — the reader's terms and the
 * event's text — because folding one side and not the other is how a match
 * silently stops working.
 */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Lowercased, punctuation flattened to single spaces, script-agnostic.
 *
 * `relate.ts`'s `norm` cannot be reused here: it collapses everything outside
 * `[a-z0-9]`, which erases Japanese and Nepali entirely. This keeps any
 * Unicode letter, number or mark, so "नेपाल" and "日本" survive as themselves.
 */
export function normaliseText(value: string): string {
  return fold(value.toLowerCase()).replace(SUBJECT_CHARS, " ").trim();
}

/**
 * The label as it will be shown and stored: the reader's own spelling, with
 * only the whitespace tidied.
 *
 * Case is preserved on purpose. "OpenAI agents" is what they typed and is what
 * they should see; the case-insensitivity lives in the slug, which is the
 * identity, not in the display.
 */
export function normaliseTopicLabel(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * The terms an event must mention for this topic to select it. ALL of them.
 *
 * "India vs China" becomes {india, china}, so a story about either country
 * alone is not a story about the relationship, and a story about the border
 * talks is — without the literal phrase appearing anywhere. "Nepal floods"
 * becomes {nepal, floods}. "Nepal" becomes {nepal}, which is as wide as the
 * reader asked for.
 *
 * A label made entirely of stopwords falls back to itself as one term rather
 * than to nothing: an empty term list would select every event, and a rule that
 * fails open is worse than one that fails narrow.
 */
export function topicTerms(label: string): string[] {
  const normalised = normaliseText(label);
  if (normalised === "") return [];

  const words = normalised.split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    if (kept.includes(word)) continue;
    kept.push(word);
  }

  const terms = kept.length > 0 ? kept : [normalised];
  return terms.slice(0, MAX_TERMS);
}

/**
 * The stable identity of a topic, derived from whatever the reader typed.
 *
 * "Nepal", "nepal", " NEPAL " and "  Nepal  " are one canonical row, which is
 * what makes two strangers who follow the same subject share one row and
 * therefore one analysis. That property is the whole cost argument, so this is
 * the only place identity is decided.
 *
 * Unicode-aware. It used to collapse everything outside `[a-z0-9]`, which meant
 * "日本" and "नेपाल" slugified to the empty string and were refused — a product
 * that offers a Japanese reading language cannot refuse a Japanese subject.
 * Latin labels are unaffected: after `fold`, every character a pool label
 * contains is matched by `SUBJECT_CHARS` exactly as it was by `[a-z0-9]`, so
 * every slug seeded by 0006, 0009 and 0012 is unchanged. Verified by test
 * rather than assumed.
 */
export function topicSlug(label: string): string {
  const slug = fold(label.trim().toLowerCase())
    .replace(SUBJECT_CHARS, "-")
    .replace(/^-+|-+$/g, "");

  // Sliced by code point, not by code unit: `String.prototype.slice` cuts
  // surrogate pairs in half and would produce a lone surrogate as an identity.
  return [...slug].slice(0, 64).join("");
}

/** Rejects a topic with no letter or number — punctuation, emoji, bare marks. */
export function isUsableTopic(label: string): boolean {
  return SUBJECT_BASE.test(fold(label)) && topicSlug(label).length > 0;
}

export type TopicRejection = "empty" | "too-short" | "too-long" | "unusable";

export type ValidatedTopic = {
  /** What to store in `topics.label` and show the reader. */
  label: string;
  /** What to store in `topics.slug`. The canonical identity. */
  slug: string;
  /** What to store in `topics.terms`. */
  terms: string[];
};

/**
 * Whether free text can become a topic, and what it becomes.
 *
 * Returns a reason rather than a boolean so the selector can say which rule was
 * broken. Every rejection is deterministic and none of them consult the corpus:
 * a subject nyuz currently has no coverage for is a valid interest — it is a
 * statement about the future, and refusing it because today's database is empty
 * is the behaviour this whole change exists to remove.
 */
export function validateTopicLabel(raw: string): ValidatedTopic | { rejected: TopicRejection } {
  const label = normaliseTopicLabel(raw);
  if (label === "") return { rejected: "empty" };
  if ([...label].length > MAX_TOPIC_LABEL) return { rejected: "too-long" };
  if (isJunkSubject(raw)) return { rejected: "unusable" };

  if (!isUsableTopic(label)) return { rejected: "unusable" };
  const slug = topicSlug(label);

  const terms = topicTerms(label);
  if (terms.length === 0) return { rejected: "unusable" };

  // Measured on the normalised form, so " a " is too short and "日本" is not.
  if ([...normaliseText(label)].length < MIN_TOPIC_LABEL) return { rejected: "too-short" };

  return { label, slug, terms };
}

/** Narrowing helper, so callers do not repeat the `"rejected" in x` dance. */
export function isValidTopic(
  result: ValidatedTopic | { rejected: TopicRejection },
): result is ValidatedTopic {
  return !("rejected" in result);
}

/**
 * What the selector should offer to create, given what already exists.
 *
 * Separated from the server function so the rule is testable without a
 * database, and because it is the rule the whole feature turns on: typing
 * something new must offer to follow it, and typing something that already
 * exists must not offer to create a second one. Getting the second half wrong
 * presents one subject as two choices, and picking the wrong one silently does
 * nothing the reader can see.
 */
export function creatableFrom(
  query: string,
  existingSlugs: string[],
): { label: string; slug: string } | null {
  const validated = validateTopicLabel(query);
  if (!isValidTopic(validated)) return null;
  if (existingSlugs.includes(validated.slug)) return null;
  return { label: validated.label, slug: validated.slug };
}

/**
 * Whether one already-normalised body of text mentions one term.
 *
 * Word-prefix rather than substring, for spaced scripts: "flood" reaches
 * "floods" and "flooding" — which is what a reader following "Nepal floods"
 * means — while "ai" cannot reach "said", which substring containment would
 * allow and which is how a matcher quietly turns back into "show everything".
 *
 * Below three characters the prefix rule is dropped for a whole-word one, the
 * same length floor `related` uses and for the same reason.
 *
 * A term can still reach a longer unrelated word that starts with it — "chip"
 * reaches "chipotle". That is accepted rather than solved: every term of a
 * topic must match, so it only ever misfires for a single-word interest, and
 * the alternative is a stemmer, which is a dictionary per language.
 */
export function mentions(normalisedText: string, term: string): boolean {
  if (term === "" || normalisedText === "") return false;
  if (UNSPACED.test(term)) return normalisedText.includes(term);

  const padded = ` ${normalisedText} `;
  if ([...term].length < 3) return padded.includes(` ${term} `);
  if (padded.includes(` ${term}`)) return true;

  // Let a plural label reach another inflection of the same stem: a reader is
  // much more likely to type "Nepal floods" than "Nepal flood", while the
  // shared signal may naturally say "flooding". Keep this deliberately narrow
  // and Latin-only; suffix rules are not portable across writing systems.
  if (
    [...term].length >= 5 &&
    /\p{Script=Latin}/u.test(term) &&
    term.endsWith("s") &&
    !/(?:ss|us|is|as|ws)$/u.test(term)
  ) {
    return padded.includes(` ${term.slice(0, -1)}`);
  }

  return false;
}

/**
 * The closed-vocabulary counterpart to `mentions`: whole word, not word prefix.
 *
 * `mentions` is right for what a reader typed. "Nepal floods" reaching
 * "flooding" is the behaviour someone following that subject wants, and the
 * looseness is bounded because every term of their interest must match.
 *
 * It is wrong for a fixed editorial vocabulary, where a single generic keyword
 * decides a category label on its own. Measured against live events on
 * 2026-09-08, word-prefix matching over `TOPIC_KEYWORDS` read "pop" inside
 * "populist" and "tour" inside "tourist" (both -> Music), "ide" inside
 * "identify" (-> Developer tools), "intel" inside "intelligence" (-> Chips) and
 * "app" inside "appointed" (-> Consumer tech). A German election story came out
 * as Politics, Music, Next.js; a Tokyo rental story as Music, World.
 *
 * So terms here match a whole word, plus a small, deliberately English-only set
 * of regular inflections — enough that "flood" reaches "flooding" and "raise"
 * reaches "raised" without "tour" ever reaching "tourist". Inflection applies
 * only from `INFLECTION_MIN_LENGTH` characters up, because below it the added
 * forms are words in their own right: "ai" + "d" is "aid", which would put
 * every foreign-aid story under AI.
 *
 * This is not the stemmer `mentions` refuses to be. A stemmer generalises over
 * arbitrary reader input in any language; this expands a fixed list of English
 * category words whose forms are known when the list is written, and anything
 * irregular is spelled out in the list instead.
 */
export function mentionsWord(normalisedText: string, term: string): boolean {
  if (term === "" || normalisedText === "") return false;
  if (UNSPACED.test(term)) return normalisedText.includes(term);

  const padded = ` ${normalisedText} `;
  return wordForms(term).some((form) => padded.includes(` ${form} `));
}

/**
 * Shortest term that may be inflected. See `mentionsWord`.
 *
 * Four rather than three: "app" + "s" is "apps", which is fine, but "cli",
 * "ide" and "pop" gain nothing real from inflection while every added form is
 * another chance to collide with an ordinary word.
 */
const INFLECTION_MIN_LENGTH = 4;

/**
 * A term and its regular inflections, as whole words.
 *
 * Only the last word of a phrase is inflected: "clinical trial" should reach
 * "clinical trials" and never "clinicals trial".
 */
function wordForms(term: string): string[] {
  const words = term.split(" ");
  const last = words[words.length - 1] ?? "";
  const lead = words.slice(0, -1);
  if ([...last].length < INFLECTION_MIN_LENGTH) return [term];

  const forms = new Set([last, `${last}s`, `${last}es`, `${last}ing`, `${last}ed`]);
  if (last.endsWith("e")) {
    // "raise" -> "raised", "raising"; the bare +ed/+ing forms above would be
    // "raiseed" and "raiseing", which match nothing and cost nothing.
    const stem = last.slice(0, -1);
    forms.add(`${last}d`);
    forms.add(`${stem}ing`);
    forms.add(`${stem}ed`);
  }
  if (last.endsWith("y") && !/[aeiou]y$/u.test(last)) {
    forms.add(`${last.slice(0, -1)}ies`);
  }

  return [...forms].map((form) => [...lead, form].join(" "));
}

/**
 * Whether an event's shared signal carries every term of one interest.
 *
 * An empty term list matches nothing, not everything. See `topicTerms`.
 */
export function matchesTerms(normalisedText: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  return terms.every((term) => mentions(normalisedText, term));
}

/**
 * The tags the analysis pass produced, cleaned for storage.
 *
 * Normalised on write so `events.tags @> topics.terms` can use the GIN index in
 * 0049 instead of re-normalising every row at query time, and so the matcher
 * and the database agree on what a tag is. Bounded because the model is being
 * asked for concepts, and an unbounded list is a summary.
 */
export function cleanTags(raw: unknown, limit = 8): string[] {
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = normaliseText(entry);
    // A tag longer than a short phrase is a sentence the model has mislabelled.
    if (tag === "" || [...tag].length > 40) continue;
    if (out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}
