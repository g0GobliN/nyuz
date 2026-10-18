import { describe, expect, it } from "vitest";
import {
  composedSummaryArtifact,
  deliveredLine,
  deliveredSummary,
  deliveredTranslatedLine,
} from "./reader-summary";

/**
 * Coverage the composer can publish a real opening from. One outlet, dated, with
 * two ordinary sentences -- what a briefing item's own coverage looks like.
 */
const SOURCES = [
  {
    name: "The Verge",
    headline: "OpenAI ships a reasoning model",
    excerpt:
      "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page. The lab said the model is available to existing customers today.",
  },
];

/** A delivered line a boundary refuses, verbatim from the measured set. */
const REFUSED_RAW =
  "Explore more than 20 announcements from OpenAI DevDay 2026 and see what we are building next.";

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

/**
 * The composed half of the same ruling: where the stored line is refused, the
 * item's own composed artifact is what the reader receives.
 *
 * `composedSummaryArtifact` is what the briefing build calls per shipped item
 * (digest.ts), and `deliveredLine` is what every reader surface resolves through
 * (briefing.ts, the email path, the audit). Both are pinned here so the build and
 * the read cannot drift into two standards -- the defect the ruling names.
 */
describe("the composed summary artifact", () => {
  it("is composed from the item's own coverage when its stored line is refused", () => {
    expect(deliveredSummary(REFUSED_RAW)).toBeNull();
    const artifact = composedSummaryArtifact({
      title: "OpenAI ships a reasoning model",
      sources: SOURCES,
      publishedAt: "2026-10-15T06:00:00Z",
      whatHappened: REFUSED_RAW,
    });
    // Measured, not asserted loosely: this is the sentence the composer
    // publishes for this coverage, with its own attribution.
    expect(artifact).toBe(
      "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page, according to The Verge.",
    );
    expect(deliveredSummary(artifact)).toBe(artifact);
    expect(artifact).not.toBe(REFUSED_RAW);
  });

  it("composes nothing at all when the coverage publishes nothing -- and then stores nothing", () => {
    // The other half of the ruling's trade: a composition that publishes nothing
    // acceptable leaves the item with no line. It is never the raw description.
    expect(
      composedSummaryArtifact({
        title: "OpenAI ships a reasoning model",
        sources: [],
        publishedAt: null,
        whatHappened: REFUSED_RAW,
      }),
    ).toBeNull();
  });

  it("resolves the item's own line when the composer published no deck", () => {
    // No opening -- a caller that never composed, or a compatibility record from
    // a build that predates ruling #11. `null` means the read path resolves the
    // stored line, guarded exactly as before.
    const line = "Anthropic released its first frontier model, Muse Wonder, on Monday.";
    expect(
      composedSummaryArtifact({
        title: "OpenAI ships a reasoning model",
        sources: SOURCES,
        publishedAt: "2026-10-15T06:00:00Z",
        whatHappened: line,
        opening: "",
      }),
    ).toBeNull();
  });

  it("stores the composer's own sentence even when the stored line was admissible (ruling #11)", () => {
    // The reversal, in the arbiter's words: "Do not substitute the producer's
    // stored line merely because it is non-empty or differs from the composed
    // opening." The opening is returned verbatim -- the frame the composer chose
    // is part of the sentence, never stripped or regenerated here.
    const admissible = "Anthropic released its first frontier model, Muse Wonder, on Monday.";
    const opening = "The Verge reports that OpenAI released a reasoning model this morning.";
    expect(deliveredSummary(admissible)).toBe(admissible);
    expect(
      composedSummaryArtifact({
        title: "OpenAI ships a reasoning model",
        sources: SOURCES,
        publishedAt: "2026-10-15T06:00:00Z",
        whatHappened: admissible,
        opening,
      }),
    ).toBe(opening);
  });

  it("delivers the composer's sentence over a quote-first stored line", () => {
    // The live 2026-10-18 case, in both halves. The stored line is the Freeman
    // quotation, written before ruling #10a; the composer opens the same story on
    // the report, so that report is the card's line (ruling #11) even though the
    // stored line is non-empty and admissible. What a reader reads on the card is
    // therefore what the page opens with, whatever order the two producers
    // changed in.
    const stored =
      "“The primary thing that we see with any attack on building management systems: It’s a great place for the threat actor to hide,” Michael Freeman, ServiceNow’s senior director of threat research, told The Register.";
    const opening =
      "Late Sunday night, a still-unknown cybercriminal or group hacked thousands of remote-controlled refrigeration systems across hundreds of French grocery stores, spiking temperatures, spoiling food, and sparking fires.";
    expect(deliveredSummary(stored)).toBe(stored);
    const artifact = composedSummaryArtifact({
      title: "Cybercrims attack physical building systems",
      sources: SOURCES,
      whatHappened: stored,
      opening,
    });
    expect(artifact).toBe(opening);
    expect(deliveredLine({ summary: artifact }, stored)).toBe(opening);
  });
});

describe("the line an item is delivered with", () => {
  it("prefers the item's own artifact over the event's stored line", () => {
    const artifact = "The lab said the model is available to existing customers today.";
    const raw = "Anthropic shipped a model on Monday, the company said.";
    expect(deliveredLine({ summary: artifact }, raw)).toBe(artifact);
  });

  it("falls back to the stored line when there is no artifact", () => {
    const raw = "Anthropic shipped a model on Monday, the company said.";
    expect(deliveredLine({ summary: null }, raw)).toBe(raw);
    expect(deliveredLine(null, raw)).toBe(raw);
  });

  it("withholds a refused stored line even with no artifact, and never substitutes the raw text", () => {
    // The raw fallback this ruling exists to keep at zero: no artifact, a refused
    // stored line, and the result is no line -- not the refused text.
    expect(deliveredLine({ summary: null }, REFUSED_RAW)).toBe("");
    expect(deliveredLine({ summary: null }, "")).toBe("");
    expect(deliveredLine({ summary: null }, null)).toBe("");
  });

  it("ignores a stored artifact that is itself refused", () => {
    // Defence in depth: a row written by an older or broken writer cannot put a
    // refused line on a reader's screen through the artifact column. What is left
    // is the item's own line, resolved exactly as it was before this slice --
    // printed when a boundary accepts it, withheld when one refuses it.
    expect(deliveredLine({ summary: REFUSED_RAW }, "Anthropic shipped a model.")).toBe(
      "Anthropic shipped a model.",
    );
    expect(deliveredLine({ summary: REFUSED_RAW }, REFUSED_RAW)).toBe("");
  });
});

/**
 * The translated email path, which is the one join the boundaries cannot reach
 * themselves: they ask English grammar, so a translated copy of a refused line
 * passes them. Measured before the rule was written (2026-10-15, 60 days): 694
 * delivered items, 106 carrying a refused English line, **0 of them on a digest
 * whose reader is not on English**, and `event_translations` holding 0 rows -- so
 * nothing has reached a reader this way, and the rule closes it by construction.
 */
describe("the line an item is delivered with on a translated digest", () => {
  const TRANSLATION = "これは、配信された拒否された行の翻訳です。";

  it("prints the composed artifact rather than the translation of a refused line", () => {
    const artifact = "The lab said the model is available to existing customers today.";
    expect(deliveredTranslatedLine({ summary: artifact }, REFUSED_RAW, TRANSLATION)).toBe(artifact);
  });

  it("withholds a translation of a refused line, in every language", () => {
    // The defect this closes: the English column is refused, while the translated
    // copy of it -- which no boundary can judge -- was printed in its place.
    expect(deliveredTranslatedLine({ summary: null }, REFUSED_RAW, TRANSLATION)).toBe("");
    expect(deliveredTranslatedLine(null, REFUSED_RAW, TRANSLATION)).toBe("");
  });

  it("still prefers the cached translation of a line a reader may read", () => {
    const raw = "Anthropic shipped a model on Monday, the company said.";
    expect(deliveredTranslatedLine({ summary: null }, raw, TRANSLATION)).toBe(TRANSLATION);
    expect(deliveredTranslatedLine({ summary: null }, raw, "")).toBe(raw);
    expect(deliveredTranslatedLine({ summary: null }, raw, null)).toBe(raw);
  });

  it("withholds an item whose stored line is empty even when a translation exists", () => {
    expect(deliveredTranslatedLine({ summary: null }, "", TRANSLATION)).toBe("");
  });
});
