/**
 * Two rules that were rewritten for cost, and the verdicts they must not move.
 *
 * Both of these were the reason a reader with a large pool got nothing for six
 * nights: the readiness gate is 87% of a briefing build's CPU, and two functions in
 * it were doing avoidable work — `contains` rebuilt its regular expression on every
 * call, and `repetitionBomb` compared every phrase window against every other one.
 * Measured on the 22:30Z reader's live pool (2026-10-16): `repetitionBomb` was 22.2%
 * of a CPU profile of the gate, `contains` 16.5%, and together with the two inline
 * patterns in `rankEntities` they were 3.2 s of compiling alone.
 *
 * The repair is only allowed to be a repair. What these tests pin is that the fast
 * paths *cannot* disagree with the tests they replace:
 *
 *   - `contains` answers with `indexOf` plus a boundary check when the name and the
 *     text are both ASCII, and with the `iu`-flag regex otherwise, and the last test
 *     in this file checks the two against each other on a table of pairs rather than
 *     trusting the argument.
 *   - the guard is load-bearing, not decorative: `ſ` (U+017F, long s) case-folds to
 *     `s` under the `iu` flag but survives `toLowerCase()`, so a general fast path
 *     would decide that case wrongly and the ASCII guard is what stops it.
 *   - `repetitionBomb`'s boundary — five to eight words, three occurrences — is
 *     pinned from both sides, because a counting rewrite is exactly where an
 *     off-by-one in a phrase length or an occurrence count would hide.
 */

import { describe, expect, it } from "vitest";

import { contains, validDeterministicSentence } from "./reader-evidence";

/** The test `contains` falls back to, spelled out, as the reference. */
function referenceContains(text: string, name: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

describe("the whole-word name test", () => {
  it("matches a name only as a whole run of word characters", () => {
    expect(contains("the AI model shipped", "AI")).toBe(true);
    expect(contains("RAI systems shipped", "AI")).toBe(false);
    expect(contains("the AIs shipped", "AI")).toBe(false);
    expect(contains("AI", "AI")).toBe(true);
  });

  it("ignores case, on both paths", () => {
    expect(contains("the ai act passed", "AI")).toBe(true);
    expect(contains("the AI act passed", "ai")).toBe(true);
  });

  it("keeps a name's own punctuation as part of the match", () => {
    expect(contains("in the U.S. today", "U.S.")).toBe(true);
    expect(contains("in the US today", "U.S.")).toBe(false);
    expect(contains("it is AT&T's network", "AT&T")).toBe(true);
  });

  it("does not accept a match whose boundary is a word character", () => {
    expect(contains("aXa", "X")).toBe(false);
    expect(contains("aa", "aa")).toBe(true);
    expect(contains("aab", "aa")).toBe(false);
  });

  it("takes the regex path where the case fold is not one-to-one", () => {
    // U+017F folds to `s` under the `iu` flag; `toLowerCase` leaves it alone. The
    // ASCII guard is the only reason this is not decided the wrong way.
    expect(contains("the ſervice is up", "service")).toBe(true);
    expect("the ſervice is up".toLowerCase().includes("service")).toBe(false);
  });

  it("agrees with the reference regex on every pair, path for path", () => {
    const texts = [
      "the AI model shipped",
      "RAI systems shipped",
      "in the U.S. today",
      "the ſervice is up",
      "",
      "   ",
      "OpenAI",
      "openai's",
      "the O.P.E.C. meeting",
      "Straße frei",
      "x",
    ];
    const names = ["AI", "ai", "U.S.", "AT&T", "service", "OpenAI", "O.P.E.C.", "x", "", "AI "];
    for (const text of texts) {
      for (const name of names) {
        expect(
          contains(text, name),
          `contains(${JSON.stringify(text)}, ${JSON.stringify(name)})`,
        ).toBe(referenceContains(text, name));
      }
    }
  });
});

describe("the repetition-bomb boundary", () => {
  const phrase = (times: number, length: number): string => {
    const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const run = words.slice(0, length).join(" ");
    return `The report said ${Array.from({ length: times }, () => run).join(" and then ")}.`;
  };

  it("refuses a five-word phrase that appears three times", () => {
    expect(validDeterministicSentence(phrase(3, 5))).toBe(false);
  });

  it("refuses an eight-word phrase that appears three times", () => {
    expect(validDeterministicSentence(phrase(3, 8))).toBe(false);
  });

  it("accepts a five-word phrase that appears twice", () => {
    expect(validDeterministicSentence(phrase(2, 5))).toBe(true);
  });

  it("accepts a four-word phrase that appears three times, which is not the shape", () => {
    expect(validDeterministicSentence(phrase(3, 4))).toBe(true);
  });

  it("finds the third occurrence wherever it sits, not only beside the others", () => {
    const text =
      "Analysts said the quarterly review of the network held, while the desk noted " +
      "an unrelated filing and the seasonal adjustment that follows it, and then the " +
      "quarterly review of the network returned again when the quarterly review of the " +
      "network closed.";
    expect(validDeterministicSentence(text)).toBe(false);
  });
});
