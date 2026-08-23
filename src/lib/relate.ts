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

/** Case- and punctuation-insensitive, so "Developer Tools" matches "developer tools". */
export function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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
