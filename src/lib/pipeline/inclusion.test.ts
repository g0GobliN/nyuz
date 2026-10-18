import { describe, expect, it } from "vitest";
import { GATED_KIND } from "@/lib/pipeline/digest";
import { hasStorySpecificLine, reasonFor } from "@/lib/pipeline/inclusion";

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

  it("refuses a price tag as a figure", () => {
    // The 2026-10-08 ruling: money is claimed only when the sentence says what
    // the money is doing. All three titles below were live in the pool that
    // day, and a price is not significance.
    for (const reason of [
      reasonFor({
        sourceCount: 1,
        title: "The first Nvidia RTX Spark laptops cost up to $7,000",
        whatHappened:
          "They are designed to compete with high-end MacBook Pros — and they have prices to match.",
      }),
      reasonFor({
        sourceCount: 1,
        title:
          "Pre-orders are live on Nvidia RTX Spark devices, secure the Surface Laptop Ultra here — starting at $2,599",
        whatHappened:
          "Best Buy has a limited lineup, ranging from the Asus ProArt P14 with 24GB of memory for $2,599 up to the Surface Laptop Ultra with 48GB of memory for $3,999.",
      }),
      reasonFor({
        sourceCount: 1,
        title: "The Pixel Watch 5 is a better value at $65 off",
        whatHappened:
          "The watch is discounted by $60 during the October sale, with the 41mm on sale for $334.99.",
      }),
    ]) {
      expect(reason).toEqual({ text: "", source: "none" });
    }
  });

  it("claims money at stake, and reads purpose in the same sentence only", () => {
    // Three live shapes that must survive the narrowing, plus the scoping rule:
    // a raise elsewhere in the paragraph does not make a title's price tag
    // claimable, and the paragraph's own purpose-bearing money is then used.
    expect(
      reasonFor({
        sourceCount: 1,
        title: "Robot data startup Mecka AI nabs $60M from Sequoia",
      }).text,
    ).toBe("The story carries a $60M figure.");
    expect(
      reasonFor({
        sourceCount: 1,
        title: "Mecka AI nears $500M valuation in Sequoia-led deal",
      }).text,
    ).toBe("The story carries a $500M figure.");
    expect(
      reasonFor({
        sourceCount: 1,
        title: "AI could upend food delivery",
        whatHappened:
          "DoorDash processed 970 million orders this quarter and generated $4.5 billion in revenue.",
      }).text,
    ).toBe("The story carries a $4.5 billion figure.");
    const scoped = reasonFor({
      sourceCount: 1,
      title: "The first RTX Spark laptops cost up to $7,000",
      whatHappened: "The chipmaker raised $1.2 billion to build them.",
    });
    expect(scoped.text).toBe("The story carries a $1.2 billion figure.");
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

  /**
   * The money-consequence rung, 2026-10-09: the story's own stored evidence
   * (0090) is the only source left that is free and story-specific, and it is
   * read narrowly. A looser rule was measured that day and rejected — it bought
   * coverage with heritage, speculation and vendor truisms.
   */
  it("prints a money consequence the story's own evidence states", () => {
    const reason = reasonFor({
      sourceCount: 1,
      title: "USA Today becomes the latest publisher to sue OpenAI",
      evidence: [
        "In a filing on Thursday, the publisher asks for damages of more than $250 million, alleging OpenAI's unauthorized use of its content.",
      ],
    });
    expect(reason.source).toBe("consequence");
    expect(reason.text).toBe("The publisher asks for damages of more than $250 million.");
  });

  it("refuses evidence that is not about money at stake", () => {
    // A date, an outcome verb or a count is not enough on its own; the loose
    // rule printed these and every one of them was filler.
    const reason = reasonFor({
      sourceCount: 1,
      title: "Sydney festival 2027: 11 international dance works to headline",
      evidence: [
        "Launched by the Sydney Opera House in 2009, it ran for four years and featured superstars such as Akram Khan.",
        "Tickets for the 2027 programme go on sale in February.",
      ],
    });
    expect(reason).toEqual({ text: "", source: "none" });
  });

  it("refuses a money clause that the split left as a fragment", () => {
    // "And the publisher asks ..." and a bare "Damages of more than $250
    // million" both read as debris under a heading that promises a reason.
    const fragment = reasonFor({
      sourceCount: 1,
      title: "Publisher sues over training data",
      evidence: ["and the publisher asks for damages of more than $250 million in the filing."],
    });
    expect(fragment.text).toBe("");

    const bare = reasonFor({
      sourceCount: 1,
      title: "Publisher sues over training data",
      evidence: ["Damages of $250 million. The filing was made on Thursday in New York."],
    });
    expect(bare.text).toBe("");
  });

  it("prints what a change binds, and when it starts", () => {
    // The live card this rung exists for (2026-10-18): a Meta terms change whose
    // stored evidence says what it does and when it starts. The apostrophe in
    // "won’t allow" is the document's own, and the first draft of the rule missed
    // exactly this sentence because it wrote a straight one.
    const reason = reasonFor({
      sourceCount: 1,
      title: "Meta may use sweeping new commercial TOS to avoid millions in AI licensing fees",
      whatHappened:
        "As Nieman Lab reported Thursday, this will affect all business accounts but is particularly shocking for news publishers who could perhaps charge Meta millions in licensing fees to continually access their articles for AI training.",
      evidence: [
        "Kicking in on October 30, the TOS update won’t allow businesses to opt out, instead suggesting that businesses stop using Meta services if they won’t agree to let Meta bots freely crawl their linked content.",
      ],
    });
    expect(reason.source).toBe("binding");
    expect(reason.text).toContain("won’t allow businesses to opt out");
  });

  it("prints the duty the story's own instrument imposes", () => {
    // The CERT-In card: the advisory's own directions state a deadline the reader
    // can act on, and the paragraph never says it. Nothing is inferred — the
    // sentence is the story's own evidence, printed as it stands.
    const reason = reasonFor({
      sourceCount: 1,
      title:
        "CERT-In Warns AI Agents Accessed Sensitive Data at Indian Organizations During Testing",
      whatHappened:
        "AI agents being tested online reached the live systems of Indian organizations and read business records, including personal data and confidential material, CERT-In said in an advisory on October 15.",
      evidence: [
        "CERT-In did not name the AI companies, their models, or the organizations and sectors involved.",
        "CERT-In's directions also require organizations to report cyber incidents to the agency within 6 hours.",
      ],
    });
    expect(reason.source).toBe("binding");
    expect(reason.text).toBe(
      "CERT-In's directions also require organizations to report cyber incidents to the agency within 6 hours.",
    );
  });

  it("stays silent when the evidence carries a spec sheet, a price and a party", () => {
    // The two RTX Spark cards, verbatim from the live corpus: every stored unit is
    // a specification, a price, a launch event or a review opinion, and none of
    // them answers "why does this matter". Silence is the honest line here, and
    // this is the case that must keep shipping unlined.
    const reason = reasonFor({
      sourceCount: 1,
      title: "RTX Spark Ignites Global Celebration as New Windows PCs Arrive",
      whatHappened:
        "NVIDIA RTX Spark laptops are now available, bringing NVIDIA Blackwell RTX graphics, up to 128GB of unified memory and the full NVIDIA AI platform to slim, premium Windows PCs.",
      evidence: [
        "Developers and AI enthusiasts can explore NVIDIA-tested recipes, playbooks and resources for running local AI on RTX Spark.",
        "Berlin held one of six RTX Spark retail launch celebrations worldwide.",
        "The arrival of RTX Spark brought fans, creators and PC enthusiasts together in Berlin during the Festival of Lights.",
        "Starting at $2,399, laptops from ASUS, Dell, HP, Lenovo, Microsoft and MSI bring powerful local AI, content creation and gaming capabilities to a portable device.",
      ],
    });
    expect(reason).toEqual({ text: "", source: "none" });
    expect(hasStorySpecificLine(reason.text)).toBe(false);
  });

  it("refuses a change that defines a class, a reporting date, and a launch date", () => {
    // Three live near-misses, each one printed by a looser draft of this rule and
    // each one filler: a mandate inside a relative clause, a date in a reporting
    // frame, and availability dressed as a change.
    const clause = reasonFor({
      sourceCount: 1,
      title: "English councils warn of ‘catastrophic’ Send debts forecast to hit £10bn by 2028",
      evidence: [
        "Education, health and care plans (EHCPs), which mandate support for conditions such as speech and learning difficulties, autism or ADHD, are rising.",
      ],
    });
    expect(clause.text).toBe("");

    const frame = reasonFor({
      sourceCount: 1,
      title: "Ivanti patches Connect Secure zero-day after researchers confirm in-the-wild attacks",
      evidence: ["Ivanti said on October 13 that it is aware of limited exploitation in the wild."],
    });
    expect(frame.text).toBe("");

    const launch = reasonFor({
      sourceCount: 1,
      title: "Meta Connect 2026: The 7 biggest announcements",
      evidence: [
        "The Ray-Ban Meta Audio will launch on October 13th starting at $349 with 23 different color and lens combinations.",
      ],
    });
    expect(launch.text).toBe("");
  });

  it("never lets a binding change outrank money the outcome turns on", () => {
    const money = reasonFor({
      sourceCount: 1,
      title: "Publisher sues over training data",
      whatHappened: "The publisher argues its articles were used without a licence.",
      evidence: [
        "Starting on October 30, the new terms will require business accounts to allow training.",
        "In a filing on Thursday, the publisher asks for damages of more than $250 million.",
      ],
    });
    expect(money.source).toBe("consequence");
  });

  it("never lets a consequence outrank the stored impact, and still gates what", () => {
    const stored = reasonFor({
      storedImpact: "It sets the price every model builder now has to pay for news.",
      sourceCount: 1,
      title: "Publisher sues over training data",
      evidence: ["The publisher asks for damages of more than $250 million."],
    });
    expect(stored.source).toBe("stored");

    // The why-vs-what gate applies here exactly as it does to every other rung:
    // a clause that restates the briefing paragraph is dropped. What follows is
    // the figure rung's own line about the same number — a different claim said
    // a different way, which the gate admits by design (it refuses copies, not
    // subjects; deeper restatement is what manual sampling is for).
    const restated = reasonFor({
      sourceCount: 1,
      title: "Publisher sues over training data",
      whatHappened: "The publisher asks for damages of more than $250 million.",
      evidence: ["The publisher asks for damages of more than $250 million."],
    });
    expect(restated.source).toBe("figure");
    expect(restated.text).toBe("The story carries a $250 million figure.");
  });
});

/**
 * The Q4 shipping decision, shared rather than re-derived.
 *
 * `hasStorySpecificLine` exists because the build and the read-only instruments
 * all have to answer "would this item ship?". They answered it by each comparing
 * the ladder's text against `""`, and every instrument answered it *before* the
 * Q4 gate existed: on 2026-10-17 the composition diagnostic read the reader's
 * pool as 13 shipping and the briefing preview as 5, while the build shipped
 * **1** and the preview's next briefing would ship **0**. Those numbers were
 * read as evidence about the reader; they were evidence about the instruments.
 */
describe("hasStorySpecificLine", () => {
  it("is false exactly when the ladder reaches its final rung", () => {
    // Nothing stored, nothing changed, one outlet, no figure, no consequence:
    // the ladder's own answer to "why this story" is silence, and Q4 withholds
    // it. These inputs are the reader's real pool shape, measured 2026-10-17.
    const silent = reasonFor({
      sourceCount: 1,
      title: "A week with RTX Spark: everything we've learned",
      whatHappened: "The laptop runs cooler than expected under load.",
    });
    expect(silent.source).toBe("none");
    expect(silent.text).toBe("");
    expect(hasStorySpecificLine(silent.text)).toBe(false);
    expect(GATED_KIND).toBe("missing_story_specific_why_it_matters");
  });

  it("is true for any rung that states something about the story", () => {
    const coverage = reasonFor({
      sourceCount: 3,
      title: "Regulator opens an inquiry",
      whatHappened: "The inquiry covers the last two years.",
    });
    expect(coverage.source).toBe("coverage");
    expect(hasStorySpecificLine(coverage.text)).toBe(true);

    // Whitespace is not a line: the digest row stores the ladder's text verbatim,
    // so a blank that survived to the column must withhold exactly like silence.
    expect(hasStorySpecificLine("   ")).toBe(false);
    expect(hasStorySpecificLine(null)).toBe(false);
    expect(hasStorySpecificLine(undefined)).toBe(false);
  });
});
