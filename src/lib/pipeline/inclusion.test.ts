import { describe, expect, it } from "vitest";
import { reasonFor } from "@/lib/pipeline/inclusion";

/**
 * The bug these lock down: a briefing of twenty-five stories showed a
 * near-identical "Why you're seeing this" line under unrelated cards —
 *
 *     So far only X has reported this, in AI and Startups.
 *     You follow AI.
 *
 * — twenty-five times over, once per outlet and then once per topic list.
 * Naming the outlet differentiated the lines without differentiating the
 * reasons, and the follow line said nothing about any particular story.
 * Single-source stories now take story-specific rungs first — a figure the
 * text names, then the subject `events.tags` carries, tied to what the reader
 * follows — and reach "You follow X." only when nothing story-specific
 * exists. The multi-source count stays where it was, because it varies story
 * to story; with no facts and no follows at all, the line is empty, because
 * an empty line is honest and a repeated one is not.
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

  it("stays silent on a bare single-source story with no facts to name", () => {
    // The outlet is on screen already; the sentence would only repeat it once
    // per card across the whole briefing. No title, no tags and no follow set
    // means no story-specific rung can fire either.
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

  it("states a figure the story itself names instead of the follow line", () => {
    // The 2026-10-01 defect: every single-source card read "You follow X."
    // A number in the headline is a fact about *this* story, so it outranks
    // the reader-generic fallback.
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI", "Funding"],
      title: "Anthropic valued at $180 billion in fresh funding round",
      tags: ["funding"],
      followed: new Set(["ai", "funding"]),
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story carries a $180 billion figure.");
  });

  it("falls to the briefing paragraph when the headline names no figure", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["Cybersecurity"],
      title: "Acme warns over exposed storage bucket",
      whatHappened: "The flaw affects roughly 50 million users and is tracked as CVE-2026-12345.",
      followed: new Set(["cybersecurity"]),
    });
    expect(reason.source).toBe("figure");
    // The identifier is the more specific fact, and it is found before the
    // count rung ever looks at "50 million users" — whose noun is not
    // adjacent to its number, so that pair can never be claimed at all.
    expect(reason.text).toBe("The story names CVE-2026-12345.");
  });

  it("counts a headcount the text states outright", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      title: "Cloud provider cuts 1,200 jobs across sales",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story involves 1,200 jobs.");
  });

  it("refuses a bare per-share amount as a figure", () => {
    // "$13" with no unit is a price, not an amount — printing it as "a $13
    // figure" would be worse than saying nothing. The ladder falls through.
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      title: "Shares slip $13 after quarterly miss",
      followed: new Set(["ai"]),
    });
    expect(reason.source).toBe("follow");
    expect(reason.text).toBe("You follow AI.");
  });

  it("keeps the currency sign, which extract.ts strips", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: [],
      whatHappened: "The consortium paid €450 million for the unit.",
    });
    expect(reason.text).toBe("The story carries a €450 million figure.");
  });

  it("names the subject from tags, tied to what the reader follows", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI", "Funding"],
      tags: ["acquisition", "funding"],
      followed: new Set(["ai"]),
    });
    expect(reason.source).toBe("subject");
    expect(reason.text).toBe("An acquisition and funding story in your AI topic.");
  });

  it("names the subject without the tie when the reader follows nothing in it", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      tags: ["layoffs"],
      followed: new Set(["chips"]),
    });
    expect(reason.source).toBe("subject");
    // "A layoff story", not "a layoffs story" — the gloss is per tag for
    // exactly this reason.
    expect(reason.text).toBe("This is a layoff story.");
  });

  it("uses a second tag to tell two stories in the same subject apart", () => {
    // Real pair from the 2026-10-01 corpus: "product launch" alone was
    // identical under three unrelated cards; the second kind differentiates
    // without leaving the stored vocabulary.
    const shared = {
      sourceCount: 1,
      topics: ["AI"],
      outlet: "The Verge",
      followed: new Set(["ai"]),
    };
    const one = reasonFor({ ...shared, tags: ["product launch"] });
    const two = reasonFor({ ...shared, tags: ["product launch", "research"] });
    expect(one.text).toBe("A product launch story from The Verge, in your AI topic.");
    expect(two.text).toBe("A product launch and research story from The Verge, in your AI topic.");
    expect(one.text).not.toBe(two.text);
  });

  it("credits the single outlet as a qualifier, never as the whole line", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      tags: ["acquisition"],
      outlet: "The Register",
      followed: new Set(["chips"]),
    });
    expect(reason.text).toBe("This is an acquisition story from The Register.");
  });

  it("counts a magnitude without shrinking it to its leading digits", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      title: "Social app loses 2 million users after breach",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story involves 2 million users.");
  });

  it("ignores tags outside the known vocabulary rather than guessing prose", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI"],
      tags: ["nepal", "monsoon flooding"],
      followed: new Set(["ai"]),
    });
    expect(reason.source).toBe("follow");
    expect(reason.text).toBe("You follow AI.");
  });

  it("keeps the follow line as the final rung, not the first", () => {
    const reason = reasonFor({
      sourceCount: 1,
      topics: ["AI", "Startups"],
      followed: new Set(["ai", "startups"]),
    });
    expect(reason.source).toBe("follow");
    expect(reason.text).toBe("You follow AI and Startups.");
    // No follow set passed → the rung is skipped, and the line is empty
    // rather than half a ladder.
    expect(reasonFor({ sourceCount: 1, topics: ["AI"] })).toEqual({ text: "", source: "none" });
  });

  it("refuses a stored impact that is a label rather than a sentence", () => {
    // `sentence` exists for this: "AI · Startups" after "Why it matters:" reads
    // like a bug, so the ladder drops to the next rung instead.
    const reason = reasonFor({ storedImpact: "AI · Startups", sourceCount: 2, topics: [] });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("Two publishers reported this.");
  });
});
