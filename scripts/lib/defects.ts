/**
 * The rulers that judge published prose, defined once.
 *
 * Three callers measure the same defects -- the audit over the live corpus, the
 * before/after diff over two snapshots, and the regression tests over the
 * production fixture. Two definitions of "malformed attribution" would let the
 * number and the fixture disagree, which is the one inconsistency a report like
 * this cannot afford.
 *
 * Every ruler reads the *published text*, never the composer's own counters: a
 * leak the composer does not know about is the leak worth counting.
 */

/** An HTML entity of any kind -- named, decimal or hex. */
export const ENTITY_LEAK = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i;

/**
 * Attribution glued to a clause it cannot introduce.
 *
 * `reports that Once they were out in the wild` and `reports that "But ...` are
 * the production shapes. Two families: a discourse or subordinating word that
 * the source capitalised ("Once", "Only", "Both"), and a fronted adverbial with
 * its own comma ("reports that Overall,", "reports that Ten days later,") --
 * a comma may not follow `that`, so the wrap is ungrammatical however the clause
 * is cased.
 *
 * Deliberately case-sensitive, and deliberately attached to a reporting verb. A
 * lower-cased subordinator after `that` is ordinary English -- "Tom's Hardware
 * reports that while $439 makes most of us shudder, it is one of the best deals"
 * was flagged by an earlier, case-insensitive version of this ruler -- and so is a
 * quotation that merely follows the word `that` in a sentence ("devices that
 * "support the latest generation of Photographic Styles""). Counting those as
 * defects is how a report starts disagreeing with its own samples.
 */
export const GLUED_ATTRIBUTION =
  /\b(?:reports?|said|says)\s+that\s+(?:[A-Z][\p{L}'-]+,\s|(?:Once|When|While|Because|Although|After|Before|If|Since|But|And|Or|So|Yet|Only|Both)\b|["“])/u;

/** A space where punctuation was meant to follow a word instead. */
export const SPACE_BEFORE_PUNCT = /\s+[,;.!?]/;

/** Two spaces, the seam a cleanup pass leaves behind. */
export const DOUBLE_SPACE = / {2}/;

/** Two disconnected quotations in one block. */
export const TWO_QUOTES = /["“][^"”]{10,}["”][^.!?]*["“][^"”]{10,}["”]/;

/**
 * A block opening on quote punctuation that is not an opening mark: the tail of a
 * quotation whose opening was cut, which is a fragment rather than a sentence.
 */
export const LEADING_QUOTE = /^\s*[”‘']/;
/** A block that opens on a quotation mark: a quotation in the lead slot. */
export const OPENS_ON_QUOTE = /^\s*["“]/;

/**
 * Words the composer lowercased that their source only ever capitalises.
 *
 * The ruler for the leading-word case rewrite this patch removed, and the reason
 * it has to compare two texts: the defect was invisible in the published prose.
 * "all Things Considered host Mary Louise Kelly talks with ..." is an ordinary
 * looking phrase until it is put next to the source, which is why a count over
 * output alone could not see it and why this takes the source with it.
 *
 * A word counts only when the source writes it capitalised *everywhere* and the
 * block writes it lowercase somewhere. `the`, `that` and `a` are therefore never
 * counted -- every source writes them both ways, so no ruler can say which
 * occurrence was a name. `all` in the sentence above is: NPR never writes it
 * lowercase, so publishing `all` is a rewrite, whoever made it.
 *
 * Scripts only: a snapshot carries published prose and no source text, so the
 * audit and the diff cannot share this one the way they share the rulers above.
 */
export function lowercasedSourceCapitals(published: string, source: string): string[] {
  const capitalisedOnly = new Set<string>();
  const everLowercase = new Set<string>();
  for (const [word] of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const key = word.toLowerCase();
    if (word === key) everLowercase.add(key);
    else capitalisedOnly.add(key);
  }
  const rewritten = new Set<string>();
  for (const [word] of published.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const key = word.toLowerCase();
    if (word !== key || everLowercase.has(key) || !capitalisedOnly.has(key)) continue;
    rewritten.add(word);
  }
  return [...rewritten].sort();
}
