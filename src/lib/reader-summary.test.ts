import { describe, expect, it } from "vitest";
import { deliveredSummary } from "./reader-summary";

/**
 * Every string below was measured, not assumed: the first scratch measurement of the delivered
 * surface did not record which boundary refused each line, and the guard built from that count
 * refused less than it (2026-10-15). `scripts/reader-delivered-summary-audit.ts` now names the
 * predicate for every refusal it reports, and the two "true negative" cases at the end are kept so
 * the gap is visible in the suite rather than rediscovered later.
 */
describe("the summary a reader may be shown", () => {
  it("passes ordinary reporting through untouched", () => {
    const line = "Anthropic released its first frontier model, Muse Wonder, on Monday.";
    expect(deliveredSummary(line)).toBe(line);
  });

  it("trims the stored text rather than printing its whitespace", () => {
    expect(deliveredSummary("  OpenAI shipped a new agent tool.  ")).toBe(
      "OpenAI shipped a new agent tool.",
    );
  });

  it("withholds nothing-to-say instead of returning an empty line", () => {
    for (const empty of [null, undefined, "", "   ", "\n"]) {
      expect(deliveredSummary(empty)).toBeNull();
    }
  });

  it("withholds a development record that reached a reader as a summary", () => {
    expect(deliveredSummary("Assisted-by: Codex.")).toBeNull();
    expect(
      deliveredSummary(
        "v16.4.0-canary.59 :: Followup from #99249 remove some redundant tests (#99251)",
      ),
    ).toBeNull();
  });

  it("withholds the publisher's own pitch", () => {
    expect(
      deliveredSummary(
        "Explore more than 20 announcements from OpenAI DevDay 2026 and see what we are building next.",
      ),
    ).toBeNull();
  });

  it("withholds a line whose first reference the reader cannot resolve on its own", () => {
    // Delivered verbatim: the card boundary's context rule, now asked at the join as well.
    expect(
      deliveredSummary(
        "This conversational AI assistant is intended to provide personalized feedback to creators, rather than generic advice.",
      ),
    ).toBeNull();
  });

  it("withholds a cut sentence rather than a half sentence", () => {
    expect(
      deliveredSummary("The $300 million employee tender was co-led by Wellington and T."),
    ).toBeNull();
    expect(
      deliveredSummary(
        "A California man has been arrested for smuggling over $300 million worth of restricted Nvidia chips to China in violation of U.S.",
      ),
    ).toBeNull();
  });

  describe("the controls that keep the rule narrow", () => {
    it("keeps reporting that mentions a development tag rather than being one", () => {
      const line =
        "Currently there is a policy requirement for Linux kernel patches where AI tools contributed, they should be documented with an Assisted-by: tag, the maintainers said.";
      expect(deliveredSummary(line)).toBe(line);
    });

    it("keeps a sentence that cites one pull request", () => {
      const line = "The regression was fixed in pull request #30119, the maintainer said.";
      expect(deliveredSummary(line)).toBe(line);
    });
  });

  /**
   * True negatives, recorded on purpose. Both reached readers as summary lines and both are outside
   * the shared sentence boundary: the first carries a single pull-request reference, which the
   * anchored development-record rule deliberately does not treat as a record (a sentence may cite
   * one); the second is a flattened list item, and the arbiter scoped that rule to the **deck
   * boundary** only, on the measurement that the wider grammar match was 11-of-12 ordinary prose.
   * Widening either is a decision for the arbiter, taken on a fresh measurement -- not a silent
   * change here.
   */
  it("does not (yet) withhold a single-reference commit line", () => {
    const line =
      "[b11207] Hexagon: support tiled Q4_0 and Q8_0 GET_ROWS (#29511) hexagon: support tiled Q4_0 and Q8_0 GET_ROWS";
    expect(deliveredSummary(line)).toBe(line);
  });

  it("does not (yet) withhold a list item flattened into a paragraph", () => {
    const line =
      "A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent what to do at each step.";
    expect(deliveredSummary(line)).toBe(line);
  });
});
