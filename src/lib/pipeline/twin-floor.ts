/**
 * The acceptance floor ruling #18 put on the widening, as a module.
 *
 * The ruling widened the delivery twin pass's vocabulary (`hack`, `hacker`,
 * `hacking`, `break in`, `break into`, `broke into`) and put a bar under what
 * the widening may suppress: **a suppressed pair must also share a capitalised
 * entity and three content words**. `scripts/twin-corpus-census.ts` is the
 * instrument that reads that bar over the stored corpus, and this module is the
 * bar itself, so the census and the suite's fixtures cannot disagree about what
 * "clearing the floor" means.
 *
 * Both legs were too lenient to prove anything. Measured on the 30-day window
 * rather than guessed, on the pair the acceptance instrument singled out
 * (`Plex2Shell` against `BeyondTrust`, two stories with no shared actor, product
 * or incident — see `docs/decisions/delivered-twin-floor.md`):
 *
 *   **The entity leg counted a capitalisation that carries no information.**
 *   A headline capitalises its first word whatever it is, and a Title Case
 *   headline capitalises everything, so `Hackers Exploit Plex2Shell Flaws…`
 *   offered `hackers` as if it were a name and a Title Case counterpart offered
 *   the same word back. A capitalisation is evidence of a name only where it
 *   discriminates: mid-title, in a headline that is not Title Case. One side
 *   proving the name is enough — the other side's capitalisation, wherever it
 *   sits, is corroboration — which is what keeps `Australia` counting when one
 *   headline opens on it and the other names it mid-sentence.
 *
 *   **The content-word leg counted function words.** Its stop set was the
 *   shortlist's `STOPWORDS`, which is tuned to be *useful as a search filter*
 *   rather than to be a grammar: `and`, `the`, `for`, `but` and their siblings
 *   were absent and counted as content, so a conjunction could supply the third
 *   shared word (`Hackers hit AI coding tool OpenCode…` against `A hacker broke
 *   into John Deere…` shares exactly `hacker`, `agent` and `and`). The floor now
 *   carries its own `FUNCTION_WORDS` on top of that set. It is deliberately not
 *   added to `STOPWORDS`: that set is also read by `duplicates.ts`
 *   (`contentWords`, `namePairs`) and by `titleTokens`, so extending it would
 *   quietly narrow the delivery pass, which ruling #18 does not permit. The
 *   floor tightens; the pass is untouched.
 *
 * This module is read-only instrument code. Nothing in the delivery path imports
 * it, and it must never become a second implementation of the twin rule — it
 * answers one question only: *does this pair clear the bar the ruling set?*
 */

import { cleanText } from "./news-signals";
import { STOPWORDS, TITLE_CASE_RATIO } from "./shortlist";

/** What the floor needs from one side of a pair. */
export type FloorSubject = { title: string; whatHappened: string | null };

/**
 * The sentence's furniture: articles, conjunctions, prepositions, pronouns,
 * auxiliaries and determiners.
 *
 * Written as prose for the same reason `STOPWORDS` is: a list formatted one
 * word to a line is a list nobody maintains. Words shorter than the floor's
 * three-character minimum (`a`, `an`, `of`, `on`, `to`, `in`, `as`, `or`, `is`,
 * `it`, `by`, `at`, `we`, `no`, `so`, `do`, `be`) are kept in the list anyway —
 * the length filter already drops them, and the list should state the rule
 * rather than rely on a second one for it.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  `
  a about above across after against all along alongside also always amid amidst
  among an and another any anybody anyone anything are around as at be because
  been before behind being below beneath beside besides between beyond both but
  by can could did do does doing down during each either else enough even ever
  every except few for former from had has have having he her here hers him his
  how i if in inside into is it its itself just less like many may me might mine
  more most much must my near neither no nobody none nor not nothing of off on
  once one only onto or other our ours out outside over own past per plus rather
  several shall she should since so some somebody something such than that the
  their theirs them themselves then there these they this those though through
  throughout till to together too toward towards under until up upon us very via
  was we were what whatever when whenever where wherever whether which while who
  whoever whom whose why will with within without would yet you your yours
`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/**
 * The floor's stop set: the shortlist's filler vocabulary plus the sentence's
 * furniture.
 *
 * The shortlist set stays in because it is the half a general-purpose stoplist
 * would miss — `announces`, `launches`, `report`, `team` are meaningful English
 * and say nothing about which story a headline is. Keeping it also means the
 * tightening only ever removes evidence: no word that failed the bar before can
 * clear it now.
 */
const FLOOR_STOPWORDS: ReadonlySet<string> = new Set([...STOPWORDS, ...FUNCTION_WORDS]);

/** The shortest token the floor counts, matching the delivery pass. */
const MIN_WORD = 3;

/** At least this many shared content words, on top of a shared name. */
const MIN_SHARED_WORDS = 3;

/**
 * Crude, comparison-only stemming — the same rule `duplicates.ts` compares words
 * with, copied rather than imported because the pass is ruling-frozen and its
 * helper is private. If that stem changes, this one has to change with it or the
 * floor stops measuring what the pass measures; the Plex2Shell fixture, where
 * `exploit` has to meet `exploited`, is what fails first.
 */
const stem = (word: string): string => {
  if (word.length <= 4) return word;
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ed")) return word.slice(0, -2);
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
};

/**
 * The content words in a piece of text, stemmed.
 *
 * Same tokenisation as the delivery pass: anything that is not a letter or a
 * digit separates words, three characters is the minimum, and stopwords do not
 * count. Figures count, because "100" is an anchor two tellings of one incident
 * keep — that is a different leg of a different rule and this one does not
 * pretend to judge it.
 */
export function floorContentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= MIN_WORD && !FLOOR_STOPWORDS.has(word))
      .map(stem),
  );
}

/** Every capitalised token in a title, lowercased — the pass's own tokenisation. */
const capitals = (title: string): Set<string> =>
  new Set(
    (
      cleanText(title)
        .normalize("NFKC")
        .match(/[\p{Lu}][\p{L}\p{N}]+/gu) ?? []
    ).map((word) => word.toLowerCase()),
  );

/**
 * The capitalised words in a title that are evidence of a name.
 *
 * Two capitalisations say nothing and are therefore dropped. A **Title Case
 * headline** capitalises every word, so its capitalisation does not select
 * anything — the same signal `TITLE_CASE_RATIO` already switches off for the
 * delivery pass's name rule. And the **first word is capitalised whatever it
 * is**, so it says nothing either; a name that opens a headline is still
 * available to the other side of the pair, which is why dropping it here does
 * not drop the pair.
 *
 * Function words go too: `Why` after a colon is a sentence furniture word
 * capitalised mid-title, and without this a pair of unrelated headlines could
 * be said to share the "entity" *why*.
 *
 * The cost of the rule is deliberate and one-directional: two headlines that
 * both open on the same name, and never write it again, cannot prove it. That
 * refuses evidence rather than inventing it, which is the direction a floor has
 * to be wrong in — a pair it refuses is reported for a ruling, and a pair it
 * blesses is a suppression nobody looks at again.
 */
export function floorNames(title: string): Set<string> {
  const tokens = cleanText(title)
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
  const proper = tokens.filter((token) => /^\p{Lu}/u.test(token)).length;
  if (tokens.length === 0 || proper / tokens.length > TITLE_CASE_RATIO) return new Set();
  const first = (tokens[0] ?? "").toLowerCase();
  return new Set(
    [...capitals(title)].filter((name) => name !== first && !FUNCTION_WORDS.has(name)),
  );
}

/** What one pair shares, and whether that clears the ruling's bar. */
export type FloorVerdict = {
  /** Capitalised names that are evidence on one side and capitalised on both. */
  entities: string[];
  /** Content words shared by title and stored summary on both sides. */
  words: string[];
  /** Both legs met: a shared name *and* at least three shared content words. */
  clears: boolean;
};

/**
 * Whether one pair clears the ruling's floor, and what it shares.
 *
 * The anchors are returned rather than only the verdict, because a pair that
 * fails has to be reported with the reason it thought it qualified: an
 * instrument that says "violation" without saying "on what" cannot be argued
 * with, and the count of such pairs is an arbiter question, not a number to tune
 * away.
 */
export function twinFloor(a: FloorSubject, b: FloorSubject): FloorVerdict {
  const capA = capitals(a.title);
  const capB = capitals(b.title);
  const shared = new Set<string>();
  for (const name of floorNames(a.title)) if (capB.has(name)) shared.add(name);
  for (const name of floorNames(b.title)) if (capA.has(name)) shared.add(name);

  const other = floorContentWords(`${b.title} ${b.whatHappened ?? ""}`);
  const words = [...floorContentWords(`${a.title} ${a.whatHappened ?? ""}`)]
    .filter((word) => other.has(word))
    .sort();

  const entities = [...shared].sort();
  return {
    entities,
    words,
    clears: entities.length > 0 && words.length >= MIN_SHARED_WORDS,
  };
}
