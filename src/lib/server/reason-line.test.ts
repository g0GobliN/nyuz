import { describe, expect, it } from "vitest";
import { reasonExplanation } from "@/lib/server/briefing";

/**
 * Audit H-06 (docs/reader-clarity-audit-2026-10-22.md): 25 of 25 reason lines
 * named AI; 8 were exactly "You follow AI." — the line that exists to explain
 * why a story is here distinguished nothing. The rule measured at brief time:
 * the narrowest matched interest is the matched label the briefing's own
 * events mark as least common, because a label that sits on every delivered
 * card is the reader's whole feed, not an explanation.
 *
 * The fixtures carry the audited reader's real label shapes — pool labels
 * ("AI", "Cybersecurity") against entity labels ("NVIDIA", "OpenAI"), the way
 * card 04's own chips showed them ("AI · NVIDIA · Hardware").
 */

const FREQ = (entries: [string, number][]) => new Map(entries);

describe("reason line names the narrow interest (audit H-06)", () => {
  it("names the followed entity when one matched (audited card 04: 'You follow AI and NVIDIA')", () => {
    expect(
      reasonExplanation(
        ["AI", "NVIDIA"],
        ["AI", "NVIDIA", "Hardware"],
        FREQ([
          ["ai", 25],
          ["nvidia", 1],
          ["hardware", 2],
        ]),
        25,
      ),
    ).toBe("You follow NVIDIA.");
  });

  it("names the narrowest matched pool by measured frequency (audited shape: AI on 25 of 25)", () => {
    expect(
      reasonExplanation(
        ["AI", "Cybersecurity"],
        ["AI", "Cybersecurity"],
        FREQ([
          ["ai", 25],
          ["cybersecurity", 3],
        ]),
        25,
      ),
    ).toBe("You follow Cybersecurity.");
  });

  it("falls back to what the card is when the match spans the reader's whole feed", () => {
    expect(
      reasonExplanation(
        ["AI"],
        ["AI", "Cybersecurity", "NVIDIA"],
        FREQ([
          ["ai", 25],
          ["cybersecurity", 4],
          ["nvidia", 2],
        ]),
        25,
      ),
    ).toBe("You follow AI — this card is about Cybersecurity and NVIDIA.");
  });

  it("drops the line entirely when nothing narrows and nothing else labels the card", () => {
    expect(reasonExplanation(["AI"], ["AI"], FREQ([["ai", 25]]), 25)).toBe("");
  });

  it("prefers the specific match the audit did not quote", () => {
    expect(
      reasonExplanation(
        ["OpenAI"],
        ["OpenAI", "AI"],
        FREQ([
          ["openai", 2],
          ["ai", 25],
        ]),
        25,
      ),
    ).toBe("You follow OpenAI.");
  });

  it("joins two specific matched interests", () => {
    expect(
      reasonExplanation(
        ["OpenAI", "Claude"],
        ["OpenAI", "Claude", "AI"],
        FREQ([
          ["openai", 3],
          ["claude", 2],
          ["ai", 25],
        ]),
        25,
      ),
    ).toBe("You follow OpenAI and Claude.");
  });

  it("matches labels case-insensitively and prints the label as stored", () => {
    // Stored event_topics labels arrive cased ("AI", "NVIDIA"); the pool set is
    // not, so matching must not depend on the reader's own spelling — but the
    // line prints what the data carries, never a rewrite of it.
    expect(
      reasonExplanation(
        ["nvidia"],
        ["nvidia", "AI"],
        FREQ([
          ["nvidia", 1],
          ["ai", 25],
        ]),
        25,
      ),
    ).toBe("You follow nvidia.");
    expect(
      reasonExplanation(
        ["NVIDIA"],
        ["NVIDIA", "AI"],
        FREQ([
          ["nvidia", 1],
          ["ai", 25],
        ]),
        25,
      ),
    ).toBe("You follow NVIDIA.");
  });

  it("does not name a pool every card carries, even among several broad matches", () => {
    expect(
      reasonExplanation(
        ["AI", "Cybersecurity"],
        ["AI", "Cybersecurity", "OpenAI"],
        FREQ([
          ["ai", 25],
          ["cybersecurity", 25],
          ["openai", 1],
        ]),
        25,
      ),
    ).toBe("You follow AI and Cybersecurity — this card is about OpenAI.");
  });
});
