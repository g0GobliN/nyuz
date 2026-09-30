import { describe, expect, it } from "vitest";
import { reasonFor } from "@/lib/pipeline/inclusion";

/**
 * The bug these lock down: a briefing of twenty-five stories showed a
 * near-identical "Why you're seeing this" line under unrelated cards —
 *
 *     So far only X has reported this, in AI and Startups.
 *
 * — twenty-five times over, once per outlet. Naming the outlet differentiated
 * the lines without differentiating the reasons, and the outlet is already on
 * screen (card header, source count, source rail). Single-source stories
 * without a stored impact or after state now ship with no line at all; the
 * multi-source count stays, because it varies story to story.
 */

describe("reasonFor", () => {
  it("prefers the stored impact, which analysis already paid for", () => {
    const reason = reasonFor({
      storedImpact: "It moves the deadline the whole industry is working to.",
      afterState: "The rule now applies.",
      sourceCount: 1,
      topics: ["AI"],
      outlet: "The Register",
    });
    expect(reason.source).toBe("stored");
    expect(reason.text).toContain("deadline");
  });

  it("falls back to the after state when there is no stored impact", () => {
    const reason = reasonFor({
      storedImpact: null,
      afterState: "The company now owns the smaller rival outright.",
      sourceCount: 4,
      topics: ["Funding"],
    });
    expect(reason.source).toBe("after-state");
    expect(reason.text).toBe("The company now owns the smaller rival outright.");
  });

  it("counts publishers for a story several outlets carried", () => {
    const reason = reasonFor({ sourceCount: 3, topics: ["AI", "Chips"] });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("Three publishers reported this, in AI and Chips.");
  });

  it("stays silent on a single-source story, named outlet or not", () => {
    // Rung 4. The outlet is on screen already; the sentence would only repeat
    // it once per card across the whole briefing.
    expect(reasonFor({ sourceCount: 1, topics: ["AI", "Startups"], outlet: "Sifted" })).toEqual({
      text: "",
      source: "none",
    });
    expect(reasonFor({ sourceCount: 1, topics: ["AI"], outlet: "The Register" })).toEqual({
      text: "",
      source: "none",
    });
    expect(reasonFor({ sourceCount: 1, topics: ["AI", "Startups"] })).toEqual({
      text: "",
      source: "none",
    });
  });

  it("says nothing when the coverage is unknown", () => {
    expect(reasonFor({ sourceCount: 0, topics: [] })).toEqual({ text: "", source: "none" });
  });

  it("refuses a stored impact that is a label rather than a sentence", () => {
    // `sentence` exists for this: "AI · Startups" after "Why it matters:" reads
    // like a bug, so the ladder drops to the next rung instead.
    const reason = reasonFor({ storedImpact: "AI · Startups", sourceCount: 2, topics: [] });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("Two publishers reported this.");
  });
});
