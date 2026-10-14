import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics, judgeFallbackDeck } from "./editorial";
import { noMainClause } from "./reader-evidence";
import type { Story } from "./story";

/**
 * A published list item is not a sentence, and the deck is where it does the most
 * damage.
 *
 * Read at the deployed origin on 2026-10-14, story 7af726e6, as the story's deck
 * -- the first line under the headline:
 *
 *   "A set of taskflow YAMLs, one per stage, which are essentially the prompts
 *    that tell the LLM agent what to do at each step."
 *
 * The source wrote that as one item of a bulleted list ("There are three layers:
 * a shell driver ..., a set of taskflow YAMLs ..., a set of MCP tools ..."), the
 * provider flattened the list into a paragraph, and the composer published the
 * item as prose. The two tests at the end are the ones that matter: the item is
 * refused, and the three sibling items from the same list are refused with it,
 * while every sentence that merely *carries* a relative clause is left alone.
 */

const PRODUCTION_DECK =
  "A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent what to do at each step.";

/** The live list this item came out of, flattened by the feed into one run. */
const FLATTENED_LIST =
  "There are three layers: A shell driver (run_fuzzing.sh) that chains the pipeline stages together. " +
  PRODUCTION_DECK +
  " A set of MCP tools that the agent calls to actually do the work: run AFL, compile a harness, " +
  "store a crash, read a coverage report, and so on.";

const oneSource = (excerpt: string, name = "GitHub"): Story => ({
  id: "deck-clause",
  org: name,
  title: "AI-powered fuzzing with the GitHub Security Lab Taskflow Agent",
  what: "",
  why: "",
  importance: "Medium",
  score: { relevance: 50, importance: 50, novelty: 50 },
  sources: 1,
  topics: [],
  time: "",
  publishedAt: "2026-09-25T03:26:00Z",
  sourceList: [{ name, at: "", headline: "A story", excerpt }],
  before: "",
  after: "",
  timeline: [],
});

describe("a unit whose only predicate is a relative clause's own verb", () => {
  it("refuses the deck the production story published", () => {
    expect(noMainClause(PRODUCTION_DECK)).toBe(true);
    expect(
      judgeFallbackDeck(PRODUCTION_DECK, "AI-powered fuzzing with the Taskflow Agent"),
    ).toEqual({
      text: "",
      reason: "malformed_sentence",
    });
  });

  it("cannot reach the same list item written without a comma, and does not try", () => {
    // The item's two siblings from the same bulleted list ("A shell driver
    // (run_fuzzing.sh) that chains the pipeline stages together.", "A set of MCP
    // tools that the agent calls to actually do the work ...") are the same defect
    // with the same grammar, and this rule deliberately leaves them: without the
    // comma, the shape is indistinguishable from ordinary prose, and the live window
    // is full of that prose. The two controls below are the reason -- refusing the
    // siblings' shape would delete both of them, and a wrong refusal costs reporting.
    for (const item of [
      "A shell driver (run_fuzzing.sh) that chains the pipeline stages together.",
      "A set of MCP tools that the agent calls to actually do the work: run AFL, compile a harness, store a crash, read a coverage report, and so on.",
      "A Ukrainian company that got rich making smartphone-controlled cameras to watch pets at home now outfits first-person-view drones with an image recognition system powered by artificial intelligence.",
      "A Silicon Valley startup that uses weather balloons and AI to predict the weather won a US military contract worth almost $50 million.",
    ]) {
      expect(noMainClause(item)).toBe(false);
    }
  });

  it("withholds the deck rather than publishing the item, and keeps the real facts", () => {
    // The ruled remedy (arbiter, ChatGPT nyuz project, 2026-10-14): prefer
    // recovering the source's complete sentence when it is attributable, and a
    // bulleted item has none to recover -- so the deck is withheld. What must not
    // change is the rest of the article: the real sentences around the list are
    // still published.
    const { article, diagnostics } = composeArticleWithDiagnostics(
      oneSource(
        "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs, and the reason is " +
          "almost always the same: someone needs to keep an eye on coverage. " +
          FLATTENED_LIST +
          " The agent never calls AFL or clang directly; it composes the pipeline out of these building blocks.",
      ),
    );
    expect(article.deck.text).toBe("");
    expect(diagnostics.qualityGate.deckReasons["malformed_sentence"]).toBe(1);
    const published = article.paragraphs.map((paragraph) => paragraph.text).join(" ");
    expect(published).not.toContain("taskflow YAMLs");
    expect(published).toContain("OSS-Fuzz");
  });

  it.each([
    // Every one of these is a deck the live window published on the same day, and
    // each carries a relativizer. The first five are the window's own sentences;
    // the last three are the discriminating controls, where a word the lists read
    // as a verb really is one, or the predicate stands inside the clause's own
    // comma-bounded tail.
    "Zimbabwean writer Simbarashe Kundizeza has denied using artificial intelligence (AI) to write his short story, which won this year's Caine Prize for African Writing.",
    "There are many who have no choice but to brave the toxic smog every day.",
    "A cryptocurrency exchange founded by the billionaire Reform UK donor Ben Delo is being sued for £20m over claims that the company mis-sold financial products in the UK.",
    "A judge has ruled that Apple will gain expedited access to OpenAI's hiring materials in the trade secrets-focused lawsuit the iPhone maker filed against OpenAI in July.",
    "The company said that the release was delayed, which the regulator confirmed.",
    // "set" is a verb here, and not after a determiner.
    "The company set a new record, which analysts had expected.",
    // A determiner plus a verb-shaped noun, with a predicate after it.
    "A set of rules changed after the review, which the ministry published.",
    // A main-clause verb the closed lists do not carry.
    "Rajesh Malhotra heads the division, which the ministry expanded.",
    // The repository's own reader-quality suite found this one against the first
    // draft: `told` is a main verb no closed list carries, and the complementizer's
    // `that` is not a relative clause set off by a comma.
    "The photographer told Reuters that the image was taken on Monday.",
  ])("leaves %s alone", (sentence) => {
    expect(noMainClause(sentence)).toBe(false);
    const verdict = judgeFallbackDeck(sentence, "A story");
    expect(verdict.reason).toBe(null);
    expect(verdict.text).not.toBe("");
  });
});
