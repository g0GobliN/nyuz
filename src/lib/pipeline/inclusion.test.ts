import { describe, expect, it } from "vitest";
import { reasonFor } from "@/lib/pipeline/inclusion";

/**
 * The bug these lock down: a briefing of twenty-five stories showed the same
 * "Why you're seeing this" line under unrelated cards —
 *
 *     An early single-source report in AI and Startups.
 *
 * — because the single-source line was built from the reader's own topic labels
 * and nothing else. Every story that landed in those topics produced the
 * identical sentence, which is a statement about the reader's settings wearing
 * the shape of a statement about the story. It now names the outlet that has
 * the story, and says nothing when it cannot.
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

  it("names the one outlet that has a single-source story", () => {
    const reason = reasonFor({ sourceCount: 1, topics: ["AI", "Startups"], outlet: "Sifted" });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("So far only Sifted has reported this, in AI and Startups.");
  });

  it("gives two single-source stories in the same topics different lines", () => {
    // The regression: same topics, different stories, and the line has to be
    // about the story — the topics are already on screen as what the reader
    // follows, so repeating them describes the reader, not the news.
    const first = reasonFor({ sourceCount: 1, topics: ["AI"], outlet: "The Register" });
    const second = reasonFor({ sourceCount: 1, topics: ["AI"], outlet: "Tom's Hardware" });
    expect(first.text).not.toBe(second.text);
    for (const reason of [first, second]) {
      expect(reason.text).not.toContain("An early single-source report");
    }
  });

  it("drops the line for a single-source story it cannot name", () => {
    // Rung 4, and deliberately not the topic template: a line that fits every
    // story is not a reason to read this one.
    const reason = reasonFor({ sourceCount: 1, topics: ["AI", "Startups"] });
    expect(reason).toEqual({ text: "", source: "none" });
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
