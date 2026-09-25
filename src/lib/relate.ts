/**
 * The one text-matching predicate in the product, and nothing else.
 *
 * This module exists because two callers need to agree exactly. `src/lib/matching.ts`
 * matches fixtures for the dashboard; `src/lib/pipeline/match.ts` matches real events
 * for real readers. The tests in `matching.test.ts` are the specification for both,
 * and a second copy of the rule would pass its own tests while quietly meaning
 * something else.
 *
 * It has no imports on purpose. Sharing the predicate through `matching.ts` was the
 * obvious first move and was wrong: that module's types come from the prefs store and
 * the sample data, so the pipeline picked up a dependency on the browser Supabase
 * client, and `tsc` said so — `import.meta.env` does not exist in a Worker or in a
 * script. A rule this small should be reachable from both sides without dragging
 * either side's world along with it.
 */

/**
 * Scripts that are not written with the Latin alphabet, and not separated by
 * spaces either. Kept as a local constant rather than imported because this
 * module deliberately has no imports: the browser matcher and the pipeline
 * matcher must share one rule without sharing a dependency graph.
 */
const NON_LATIN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}]/u;

/**
 * Case- and punctuation-insensitive, so "Developer Tools" matches "developer tools".
 *
 * Latin input is normalised exactly as it always was -- everything outside
 * `[a-z0-9]` becomes a space -- so no existing comparison changes. Text in a
 * script that is not Latin takes a preserving path instead, because the old rule
 * deleted it: `norm("日本の音楽")` was the empty string, which made
 * `related(a, b)` return false for every CJK term unconditionally. Accents fold
 * in both paths; marks are kept in the preserving path because Devanagari vowel
 * signs are marks and dropping them changes the word.
 */
export function norm(value: string): string {
  const lower = value.toLowerCase();
  if (!NON_LATIN_SCRIPT.test(lower)) {
    return lower.replace(/[^a-z0-9]+/g, " ").trim();
  }
  return lower
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/**
 * Loose containment either way round, so "AI" matches "AI infrastructure" and
 * "chips" matches "Chips". Guarded by a length floor: without it a two-letter
 * topic would match nearly everything, which is how a matcher quietly turns
 * back into "show all".
 *
 * The floor lets an exact match through first, so a real two-letter term still
 * works where it is genuinely the whole field — "AI" against the topic "AI" — and
 * only loose containment is refused.
 */
export function related(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}
