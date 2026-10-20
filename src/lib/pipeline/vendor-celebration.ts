/**
 * The first-party celebration class — ruling #9's fourth dashboard class.
 *
 * A vendor's own blog announcing its own news with celebration framing: the product (or the vendor's
 * community) is the subject of a ceremony, not of a change a reader can act on. The measured case is the
 * live dashboard card of 2026-10-19, *"RTX Spark Ignites Global Celebration as New Windows PCs Arrive"*,
 * carried by NVIDIA's own blog on a dashboard otherwise reporting developments.
 *
 * Why this is not a title rule. The celebration lexeme on its own is catastrophic in a mixed corpus:
 * measured over all 23,539 stored titles it matches 29, and 26 of them are real news —
 * *"Grace Hopper Celebration canceled two weeks out as AnitaB.org runs short of funds"*, *"Pope Leo
 * celebrates open-air mass before 700,000 people in Paris"*, *"In pictures: Dussehra celebrated across
 * India"*, *"Israel marks third anniversary of 7 October Hamas attacks"*. A title-only rule would refuse
 * the conference cancellation — a development by any reading — so the frame alone is not the class.
 *
 * Why this is not "the source is a vendor blog" either. Twenty `company_blog` sources carry 354 stored
 * events, and the population holds research, engineering, changelog and roundup posts beside the
 * celebration: *"Open and Emergent Problems in Agentic Privacy and Security"*, *"AWS Weekly Roundup: Prime
 * Day 2026 by the numbers"*, *"Introducing GPT-6 Sol and Luna"*. A source rule refuses those.
 *
 * So both halves are required, and each is measured:
 *
 *   - the *celebration frame* (a closed set of lexemes vendor copy uses and reportage almost never does);
 *   - the *first-party carriage* — every source carrying the event is `company_blog`, which is the
 *     pipeline's existing definition of a publisher speaking for itself
 *     (`FIRST_PARTY_SOURCE_KINDS` in `readiness.ts`, the arbiter's ruling of 2026-10-11, D5).
 *
 * Together they match 3 of 354 first-party events and **0** of the 46 engineering and 49 launch titles in
 * that population, and they leave all 26 celebration-shaped news titles eligible. The numbers, the
 * options and the acceptance are in `docs/decisions/vendor-celebration-class.md`.
 *
 * No model, no dictionary, no sentiment: a string test on the title and a set test on stored source kinds.
 */

/** The kinds that mean the publisher is the story's own subject. `company_blog` only — see readiness. */
const FIRST_PARTY_SOURCE_KINDS: ReadonlySet<string> = new Set(["company_blog"]);

/**
 * Every source carrying the event is a first-party one.
 *
 * Unknown, missing and empty all mean *no*: a caller that has not loaded coverage must not be read as
 * having found a company blog. This is the same rule `assessReadiness` applies to its marketing rungs,
 * restated here because that module's helper is private — at wiring time the two should share one
 * definition (named in the decision doc) rather than stay two copies.
 */
export function isFirstPartyCarriage(sourceKinds: readonly string[] | undefined): boolean {
  if (sourceKinds === undefined || sourceKinds.length === 0) return false;
  return sourceKinds.every((kind) => FIRST_PARTY_SOURCE_KINDS.has(kind));
}

/**
 * The celebration frame: the vendor's own ceremony, anniversary or party.
 *
 * `celebrat*` is the stem every form shares (`celebrates`, `celebrating`, `celebration`), and it already
 * covers the community-recognition shape the briefing gate has refused since 2026-10-02
 * (`CELEBRATION_TITLE` in `readiness.ts`, *"Celebrating Our Newest AWS Heroes"*) while adding the two
 * product-ceremony titles that pattern cannot see. The other lexemes are what a milestone post wears when
 * it avoids that stem.
 *
 * Deliberately absent: `ignites` on its own (a fire, a market move and a chip launch all ignite
 * something), `unveils`, `launches`, `announces`, `birthday`, `congratulations` — the first four are news
 * verbs, and the last two are unmeasured. A clause with no measured class can only refuse news it was
 * never shown to refuse.
 *
 * Exported as arms so the census can count each one separately; the predicate is the union, and a rule
 * nobody can attribute a number to is a rule nobody can re-measure.
 */
export const VENDOR_CELEBRATION_ARMS: readonly { name: string; test: RegExp }[] = [
  { name: "celebrat*", test: /\bcelebrat(?:e|es|ed|ing|ion|ions|ory)\b/i },
  { name: "anniversary", test: /\banniversary\b/i },
  { name: "jubilee", test: /\bjubilee\b/i },
  { name: "festivities", test: /\bfestivit(?:y|ies)\b/i },
];

/**
 * The class: a celebration frame on a first-party blog.
 *
 * Returns a label rather than a boolean so a caller (and an audit) can name the arm that fired, mirroring
 * `marketingShape` in `readiness.ts`. `null` means eligible.
 */
export function vendorCelebrationShape(
  title: string,
  sourceKinds: readonly string[] | undefined,
): string | null {
  if (!isFirstPartyCarriage(sourceKinds)) return null;
  const arm = VENDOR_CELEBRATION_ARMS.find((candidate) => candidate.test.test(title));
  if (!arm) return null;
  return `title celebrates the vendor's own news on a first-party blog (${arm.name})`;
}

/** Convenience for gates that only ask whether the class is refused. */
export function isVendorCelebrationTitle(
  title: string,
  sourceKinds: readonly string[] | undefined,
): boolean {
  return vendorCelebrationShape(title, sourceKinds) !== null;
}
