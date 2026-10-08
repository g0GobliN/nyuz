import { describe, expect, it } from "vitest";
import { reasonFor } from "@/lib/pipeline/inclusion";

/**
 * The contract these lock down, after the 2026-10-08 arbiter ruling:
 *
 *   specific deterministic significance → useful provenance → nothing
 *
 * The bug that started it: a briefing of twenty-five stories showed a
 * near-identical line under unrelated cards —
 *
 *     So far only X has reported this, in AI and Startups.
 *     You follow AI.
 *
 * — twenty-five times over. Naming the outlet differentiated the lines without
 * differentiating the reasons; the follow line said nothing about any
 * particular story; and the subject line ("This is a funding story from The
 * Register.") was ruled filler even when true, because it looks like an
 * explanation while answering "why am I seeing this" for every card of its
 * kind. All three are gone. What remains states a fact about *this* story, and
 * when there is no such fact the line is empty — an empty line is honest, a
 * generic one is not.
 */

describe("reasonFor", () => {
  it("prefers the stored impact, which analysis already paid for", () => {
    const reason = reasonFor({
      storedImpact: "It moves the deadline the whole industry is working to.",
      afterState: "The rule now applies.",
      sourceCount: 1,
    });
    expect(reason.source).toBe("stored");
    expect(reason.text).toContain("deadline");
  });

  it("falls back to the after state when there is no stored impact", () => {
    const reason = reasonFor({
      storedImpact: null,
      afterState: "The company now owns the smaller rival outright.",
      sourceCount: 4,
    });
    expect(reason.source).toBe("after-state");
    expect(reason.text).toBe("The company now owns the smaller rival outright.");
  });

  it("counts publishers for a story several outlets carried", () => {
    // The provenance band, and the only rung that is not a fact about the
    // story itself. Multi-source only: "One publisher" is the absence of a
    // fact, and the count already sits on the card.
    const reason = reasonFor({ sourceCount: 3 });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("Three publishers reported this.");
  });

  it("stays silent on a bare single-source story with no facts to name", () => {
    // 2026-10-01: every one of these cards carried a line anyway — first
    // "So far only X has reported this", then "You follow X.". Both were
    // dropped, so the honest answer is nothing at all.
    expect(reasonFor({ sourceCount: 1 })).toEqual({ text: "", source: "none" });
    expect(reasonFor({ sourceCount: 1, title: "A story happens" })).toEqual({
      text: "",
      source: "none",
    });
  });

  it("says nothing when the coverage is unknown", () => {
    expect(reasonFor({ sourceCount: 0 })).toEqual({ text: "", source: "none" });
  });

  it("states a figure the story itself names instead of the follow line", () => {
    // The 2026-10-01 defect: every single-source card read "You follow X."
    // A number in the headline is a fact about *this* story.
    const reason = reasonFor({
      sourceCount: 1,
      title: "Anthropic valued at $180 billion in fresh funding round",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story carries a $180 billion figure.");
  });

  it("falls to the briefing paragraph when the headline names no figure", () => {
    const reason = reasonFor({
      sourceCount: 1,
      title: "Acme warns over exposed storage bucket",
      whatHappened: "The flaw affects roughly 50 million users and is tracked as CVE-2026-12345.",
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
      title: "Cloud provider cuts 1,200 jobs across sales",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story involves 1,200 jobs.");
  });

  it("refuses a bare per-share amount as a figure", () => {
    // "$13" with no unit is a price, not an amount — printing it as "a $13
    // figure" would be worse than saying nothing. With the retired follow rung
    // gone, the ladder ends in the honest empty line rather than a filler.
    const reason = reasonFor({
      sourceCount: 1,
      title: "Shares slip $13 after quarterly miss",
    });
    expect(reason.text).toBe("");
    expect(reason.source).toBe("none");
  });

  it("keeps the currency sign, which extract.ts strips", () => {
    const reason = reasonFor({
      sourceCount: 1,
      whatHappened: "The consortium paid €450 million for the unit.",
    });
    expect(reason.text).toBe("The story carries a €450 million figure.");
  });

  it("does not read an 'm' word after a bare amount as a magnitude", () => {
    // Real defect from the live dashboard: "$65 mechanical keyboard" produced
    // "The story carries a $65 m figure." because `[kmb]` consumed the "m" of
    // "mechanical". A bare amount under 1000 is not a usable figure anyway, so
    // the rung declines — and the line is empty rather than a filler.
    const reason = reasonFor({
      sourceCount: 1,
      title: "I bought this cheap $65 mechanical keyboard blind",
      whatHappened: "The Aula F75 Pro is feature packed.",
    });
    expect(reason.text).toBe("");
    expect(reason.source).toBe("none");
  });

  it("still reads a real magnitude abbreviation", () => {
    const reason = reasonFor({
      sourceCount: 1,
      whatHappened: "The watchdog fined the broker $50m for the breach.",
    });
    expect(reason.text).toBe("The story carries a $50m figure.");
  });

  it("puts a fact about the story above the publisher count", () => {
    // Band order, not rung order: a figure is significance, the count is
    // provenance, so a well-covered story with a real number prints the number.
    const reason = reasonFor({
      sourceCount: 4,
      title: "Regulator fines broker $50m over breach",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story carries a $50m figure.");
  });

  it("states the before/after pair as one development", () => {
    const reason = reasonFor({
      sourceCount: 1,
      beforeState: "The tool blocked known attack patterns.",
      afterState: "The tool now stops zero-day attacks automatically.",
      whatHappened: "A vendor released a new version of its security tool.",
    });
    expect(reason.source).toBe("change");
    expect(reason.text).toBe(
      "Was the tool blocked known attack patterns; now the tool now stops zero-day attacks automatically.",
    );
  });

  it("skips the change rung when before merely repeats after", () => {
    const reason = reasonFor({
      sourceCount: 1,
      beforeState: "The tool stops attacks.",
      afterState: "The tool stops attacks!",
      whatHappened: "THE TOOL STOPS ATTACKS???",
    });
    expect(reason.source).toBe("none");
  });

  it("blanks a why-line that restates the briefing paragraph", () => {
    const reason = reasonFor({
      sourceCount: 1,
      afterState: "Attackers hijacked top-level domains.",
      whatHappened: "attackers hijacked top-level domains!!",
    });
    expect(reason.text).toBe("");
    expect(reason.source).toBe("none");
  });

  it("falls to the next rung past a duplicated line, not to nothing", () => {
    const reason = reasonFor({
      sourceCount: 1,
      afterState: "The consortium paid \u20ac450 million for the unit.",
      whatHappened: "The consortium paid \u20ac450 million for the unit",
      title: "Group pays \u20ac450 million for unit",
    });
    expect(reason.source).toBe("figure");
  });

  it("counts a magnitude without shrinking it to its leading digits", () => {
    const reason = reasonFor({
      sourceCount: 1,
      title: "Social app loses 2 million users after breach",
    });
    expect(reason.source).toBe("figure");
    expect(reason.text).toBe("The story involves 2 million users.");
  });

  it("refuses a stored impact that is a label rather than a sentence", () => {
    // `sentence` exists for this: "AI · Startups" after a heading reads like a
    // bug, so the ladder drops to the next rung instead.
    const reason = reasonFor({ storedImpact: "AI · Startups", sourceCount: 2 });
    expect(reason.source).toBe("coverage");
    expect(reason.text).toBe("Two publishers reported this.");
  });

  it("never writes a line it cannot ground in the event's own fields", () => {
    // The retired rungs are the point of this test: with no impact, no
    // before/after, no figure and one publisher, there is nothing true to say
    // about *this* story, so the field stays empty for the template to omit.
    const reason = reasonFor({
      sourceCount: 1,
      title: "Acme hires a new chief financial officer",
      whatHappened: "The appointment takes effect next month.",
    });
    expect(reason).toEqual({ text: "", source: "none" });
  });
});
