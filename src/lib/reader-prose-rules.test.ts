import { describe, expect, it } from "vitest";
import {
  capAttributionRepetition,
  composeArticleWithDiagnostics,
  isShareStatistic,
  judgeFallbackDeck,
} from "./editorial";
import { htmlToText } from "./pipeline/feed";
import {
  alreadyAttributed,
  captionSeamSplit,
  cleanDeterministicSentence,
  contextDependent,
  digestSource,
  documentOpening,
  editorialNoise,
  hasPredicate,
  headingUnit,
  isCutSentence,
  isOwnSource,
  normalizeReaderSources,
  normalizeRelativeTime,
  normalizeReportFraming,
  openingEstablishedOnPage,
  pageReferentKind,
  publisherFurniture,
  readerSentences,
  resolveNarrator,
  selectReaderEvidence,
  sourcingNote,
  sourceSeam,
  storyPosition,
  storyPositionRank,
  stripEditorialVoice,
  unresolvedContextOpening,
  stripFrontedFrame,
  stripHeadingLabel,
  stripProviderNavigation,
  sourceTypo,
  stripSourceFurniture,
  stripUnanchorableTime,
  unitTextRejection,
  validDeterministicSentence,
} from "./reader-evidence";
import type { Story } from "./story";

/**
 * Three rules that exist because of one production story, each with the decoys
 * that make it a rule rather than a word filter.
 *
 * The story's deck reached readers as:
 *
 *   "According to The Register, for a company that built its success on
 *    automated verification, DigiCert doesn't see agent management as a manual
 *    problem."
 *
 * and one of its sentences credited The Register with a survey it did not run
 * ("The Register reports that only half could trace AI decisions..."), and
 * another carried a date that only meant something on the day it was written
 * ("... published its AI Trust Pulse survey this month"). Each rule below is the
 * smallest thing that fixes one of those, and the decoys are the sentences that
 * must survive it untouched.
 */

describe("one outlet does not close every sentence", () => {
  it("caps repeated attribution at three mentions and keeps the fact", () => {
    const blocks = [
      {
        text:
          "Teams see usage, according to Cloudflare. Spending rose, according to Cloudflare. " +
          "Models are overkill, according to Cloudflare. Costs fell, according to Cloudflare.",
      },
    ];
    const removed = capAttributionRepetition(blocks);
    expect(removed).toBe(1);
    expect((blocks[0]!.text.match(/according to Cloudflare/g) ?? []).length).toBe(3);
    expect(blocks[0]!.text).toContain("Costs fell.");
    expect(blocks[0]!.text).not.toContain("Costs fell, according to");
  });
});

/**
 * The 2026-10-02 briefing's own failures. Every string below reached a reader
 * on that briefing; each rule is the smallest thing that refuses it, and each
 * decoy is a real sentence that must survive.
 */
describe("publisher furniture never becomes an article sentence", () => {
  it("refuses a masthead bio, an arXiv solicitation and a vendor ad unit", () => {
    for (const text of [
      "Michael Larabel is the principal author of Phoronix.",
      "Michael has written more than 20,000 articles covering the state of Linux hardware support.",
      "Com and founded the site in 2004 with a focus on enriching the Linux hardware experience.",
      "Have an idea for a project that will add value for arXiv's community?",
      "ArXiv is committed to these values and only works with partners that adhere to them.",
      "Attackers are using AI to accelerate reconnaissance, compromise identities and escalate access.",
      "Get 50% off a second pass The Disrupt experience is meant to be shared.",
      "Cover more ground by making connections, building momentum, and discovering what's next in the startup ecosystem.",
      "Go deeper with TH Premium: Chipmaking.",
      "Clay Co-founder and CEO Kareem Amin joins the AI Stage to discuss the rise of GTM engineer at TechCrunch Disrupt 2026.",
      "Stop calling it safe. Stop pretending it's human.",
      "He can be followed via Twitter, LinkedIn, or contacted via MichaelLarabel.",
    ]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
      expect(editorialNoise(text), text).toBe(true);
    }
  });

  it("refuses a promo blurb and a beat-list byline", () => {
    // The 2026-10-08 read: a keyboard review carried the outlet's own pitch
    // ("Go beyond the headlines ... Unlock exclusive tools and insights for
    // enthusiasts who want more.") and the analyst's masthead line, whose beat
    // is a comma-separated list ("As the Senior Analyst, Graphics at Tom's
    // Hardware, Jeff Kampman covers everything that has to do with graphics
    // cards, gaming performance, and more."). Both are sentences; neither is
    // about the story.
    for (const text of [
      "Go beyond the headlines with expert reporting on the hardware industry.",
      "Unlock exclusive tools and insights for enthusiasts who want more.",
      "As the Senior Analyst, Graphics at Tom's Hardware, Jeff Kampman covers everything that has to do with graphics cards, gaming performance, and more.",
    ]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
      expect(editorialNoise(text), text).toBe(true);
    }
    // Decoys: the same story's own reporting keeps every sentence, including
    // the one that names the reviewer, because a name is not a bio.
    for (const text of [
      "A stack of noise-shaping and noise-reducing materials inside, including a cotton layer and a hefty silicone foundation.",
      "Jeff Kampman said the outer plastic shell feels a bit cut-rate.",
      "The update unlocks exclusive features for existing subscribers.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
      expect(editorialNoise(text), text).toBe(false);
    }
  });

  it("refuses the publication pointing the reader at itself", () => {
    // The feed appends this after its own truncation ellipsis, so the reader was
    // told to go and buy the article. The outlet is the variable tail, so the
    // phrase is the rule and no list of mastheads can go stale.
    for (const text of [
      "The Keurig Alta is now available for preorder for $499.99 with shipping. Read the full story at The Verge.",
      "Paramount must release a minimum number of titles. Read the full story at The Verge.",
      "Revenue rose 20%. Read the full article at Reuters.",
    ]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
  });

  it("keeps reporting that happens to describe reading", () => {
    for (const text of [
      "The full story at the hearing lasted nine hours.",
      "She read the article aloud to the committee before answering.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
    }
  });

  it("refuses the outlet's own deck, in either voice", () => {
    // The sentence only reached a reader once the narrator clause began matching
    // a sentence-initial `We`: the NPR deck became `The authors examine the
    // evidence`, which is the article describing itself. Measured on the frozen
    // 200-event corpus: with the case fix alone this is the one fact that
    // appears, and with this rule the published page is identical to before the
    // fix, so the rule buys nothing and costs the reader nothing.
    const deck =
      "examine the evidence — and whether the city can keep its high-tech dragnet " +
      "without sacrificing civil liberties.";
    for (const text of [`We ${deck}`, `The authors ${deck}`]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
  });

  it("leaves a paper's own claim alone when it uses the same verbs", () => {
    // The boundary of the deck rule, pinned so it is a decision rather than a
    // surprise: the phrase list is the three deck verbs and not a first-person
    // rule, so a research claim keeps its attribution. Where a paper really does
    // open "we examine X", the cost is that the unit is refused as furniture;
    // the frozen corpus measured zero of those.
    for (const text of [
      "We propose ElectrolyteFM, a unified multi-property prediction model.",
      "The authors propose ElectrolyteFM, a unified multi-property prediction model.",
      "We show that uniformity creates hard limits for evolutionary search.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
    }
  });

  it("keeps ordinary reporting that merely mentions a publisher word", () => {
    for (const text of [
      "The purchase price represents a significant premium over what analysts estimated.",
      "Regulators will review the subscription terms before the deal closes.",
      "The company said the report is available to existing customers.",
      "A researcher at NYU said the game has a massive amount of hidden information.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
      expect(unitTextRejection(text, false), text).toBeNull();
    }
  });

  it("refuses a masthead byline that is a grammatical sentence", () => {
    // Read on the deployed origin, 2026-10-14: the story page for `7a1a7f98`
    // opened on "Sayem Ahmed is the Subscription Editor at Tom's Hardware." as
    // its *deck*. Every author-bio entry above is verbless, so a byline with a
    // copula passed every predicate -- measured on that exact string,
    // `editorialNoise`, `publisherVoice` and `sourceSeam` were all negative --
    // and it entered at extraction as `article_evidence` unit 1. The arbiter
    // ruled the copular shape into the existing furniture rule (2026-10-14,
    // option A) after this measurement: 1,000 live articles / 3,997 units gave
    // 3 matches, all three TechCrunch masthead lines, 0 reporting sentences.
    for (const text of [
      "Sayem Ahmed is the Subscription Editor at Tom's Hardware.",
      "Zack Whittaker is the security editor at TechCrunch.",
      "Tim De Chant is a senior climate reporter at TechCrunch.",
      "Jane Doe is a senior writer at Wired.",
      "Kenji Ito was the editor at Nikkei.",
    ]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(editorialNoise(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
  });

  it("keeps reporting that identifies someone by role", () => {
    // The arbiter's controls, verbatim, plus the shape it warned about: a name
    // plus a job title is not furniture. A masthead line stops after the outlet;
    // these continue, or put the role in an appositive with no copula.
    for (const text of [
      "The editor at Tom's Hardware said the company would respond.",
      "Sayem Ahmed, the Subscription Editor at Tom's Hardware, said the feature would launch next month.",
      "Maya Chen is the reporter who broke the story, and she said the filing came on Friday.",
      "Maya Chen is the reporter at The Verge who broke the story on Friday.",
      "Sayem Ahmed is the Subscription Editor at Tom's Hardware and he also writes about GPUs.",
      "Maria Santos is the director of research at Stanford and led the study.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
      expect(editorialNoise(text), text).toBe(false);
      expect(unitTextRejection(text, false), text).toBeNull();
    }
  });

  it("records what the byline shape costs and where it stops", () => {
    // Both are deliberate, and both are pinned so a later widening is a decision
    // rather than a surprise. The shape matches on capitalisation -- a masthead
    // line is sentence-cased -- so a lowercased sentence cannot open with a name
    // and match; and a byline followed by more text in the same unit is not
    // refused, because the pattern is the line that *ends* after the outlet. The
    // measured window held no such unit: all 3 matches were the whole unit.
    expect(publisherFurniture("she is the editor at Wired.")).toBe(false);
    expect(
      publisherFurniture(
        "Sayem Ahmed is the Subscription Editor at Tom's Hardware. He also writes about GPUs.",
      ),
    ).toBe(false);
    // An organisation subject with a publication role is the shape's known cost:
    // measured at 0 occurrences in 3,997 live units, and refused rather than
    // exempted so the exception cannot hide a real byline.
    expect(publisherFurniture("Acme Corp is the publisher at Scale.")).toBe(true);
  });

  it("refuses a note about how the story was sourced, and keeps a fact that carries one", () => {
    // Read on the deployed story page, 2026-10-17: the Diddy Combs story closed a
    // paragraph with "The person was not authorized to speak publicly and did so
    // on condition of anonymity." -- a sentence about how the article was
    // obtained, with no antecedent for `The person` anywhere on the page.
    // Measured the same day over 3,856 stored and 2,208 published sentences: 3
    // anonymity notes, one with no fact in it (this one) and two facts that keep
    // the clause ("One person familiar, who asked not to be named, said the
    // partnership was still in place.", "... according to a White House official
    // not authorized to speak publicly"). Only the factless one is refused.
    for (const text of [
      "The person was not authorized to speak publicly and did so on condition of anonymity.",
      "The source spoke on condition of anonymity because the talks were private.",
    ]) {
      expect(sourcingNote(text), text).toBe(true);
      expect(editorialNoise(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
    for (const text of [
      "One person familiar, who asked not to be named, said the partnership was still in place.",
      "Katie Zacharia was fired as the press secretary, according to an official not authorized to speak publicly.",
      "The official said the deal would close in May.",
      "The evidence was not made public.",
    ]) {
      expect(sourcingNote(text), text).toBe(false);
      expect(unitTextRejection(text, false), text).toBeNull();
    }
  });

  it("keeps a sentence unless the page it is published on carries its reference", () => {
    // The arbiter's ruling #7 (2026-10-17, Q2): a body block may open on a
    // reference only when the deck and the paragraphs above it establish it. The
    // measured NTT block is the case that produced the rule; the rest are the
    // controls the ruling asked for.
    const report =
      "The report models three growth trajectories through 2030 and stress-tests each against the constraints operators hit.";
    expect(documentOpening(report)).toBe("report");
    expect(openingEstablishedOnPage(report, "Global data centers weigh the price tag.")).toBe(
      false,
    );
    expect(
      openingEstablishedOnPage(
        report,
        "NTT published a report on its European build-out this week.",
      ),
    ).toBe(true);
    expect(
      openingEstablishedOnPage(
        "The document, titled Analysis of Ukraine's Energy, Housing and Utilities Sectors, does not specify which agency wrote it.",
        "Power plant attacks reflect a Russian blueprint.",
      ),
    ).toBe(true);

    const demonstratives = [
      "This follows an investigation the regulator started back in May.",
      "These constitute non-delivery scams, according to the complaint centre.",
      "Those in need get financial aid for their care.",
      "This largely fizzled out with the watchdog securing undertakings from Microsoft.",
    ];
    for (const opening of demonstratives) {
      expect(
        openingEstablishedOnPage(opening, "A page about something else entirely."),
        opening,
      ).toBe(false);
    }
    // Established forms: the group or the noun is on the page above, which is the
    // only evidence this rule accepts.
    expect(
      openingEstablishedOnPage(
        "Those manufacturers now employ 40,000 people across the state.",
        "Major Taiwanese manufacturers announced three plants in Ohio this year.",
      ),
    ).toBe(true);
    expect(
      openingEstablishedOnPage(
        "That maneuver needed specialized hardware along with a glitch chip.",
        "The console's nine-year journey began with a maneuver nobody had tried.",
      ),
    ).toBe(true);
    expect(openingEstablishedOnPage("They also rely on smaller suppliers.", "")).toBe(false);
  });

  it("does not take a fact for a reference it cannot judge", () => {
    // The first measured run of the page rule (250 events, 2026-10-17) refused
    // five readable openings, all of them singular pronouns the page test had no
    // way to answer for -- *"He created celld as an implementation that could be
    // hosted anywhere ..."*, *"However, it also stated, 'Our long-term objective
    // is a Windows platform that doesn't need NTLM at all.'"*, *"He was also at
    // pains to point out that the reverts were not down to 'vibe coding' ..."*.
    // A rule that cannot answer the question must not answer it anyway, so these
    // are outside the judged kinds and the composer never asks about them.
    for (const opening of [
      "He created celld as an implementation that could be hosted anywhere.",
      'However, it also stated, "Our long-term objective is a platform without NTLM."',
      "He was also at pains to point out that the reverts were not down to vibe coding.",
      "It also said the update would ship in October.",
      "Ramp to the accelerated case and the figure climbs to $5.7 trillion.",
    ]) {
      expect(pageReferentKind(opening), opening).toBeNull();
      expect(
        openingEstablishedOnPage(opening, "A page about something else entirely."),
        opening,
      ).toBe(true);
    }
    // The judged kinds are unchanged, so the rule still refuses the measured defect.
    expect(pageReferentKind("Those in need get financial aid.")).toEqual({
      kind: "demonstrative",
      noun: "in",
    });
  });

  it("refuses a sentence-cased subhead whose only verb is inside a relative clause", () => {
    // The measured unit of 2026-10-17 (the NTT story's third paragraph), and the
    // ruling #7 answer to it: the seam rule already refuses this class, and the
    // guard that reads a noun as a verb ("selection" off `select`) was passing a
    // head whose only verb sits inside a relative clause.
    const welded =
      "The misconceptions that stall projects Two objections come up in almost every community consultation, according to Berti: data centers waste water, and they steal power from the grid.";
    expect(sourceSeam(welded)).not.toBeNull();
    expect(unitTextRejection(welded, false)).toBe("invalid_sentence");
    // Controls: a real sentence that contains a relative clause, and the two
    // seams the rule was built for, which keep being refused.
    expect(
      sourceSeam("The law that Congress passed last year takes effect in January."),
    ).toBeNull();
    expect(
      sourceSeam(
        "Model selection Some frontier models impose security guardrails on their outputs, according to GitHub.",
      ),
    ).not.toBeNull();
    expect(
      sourceSeam(
        "The architecture in one minute Before getting into the interesting parts, it helps to know how the pieces fit together.",
      ),
    ).not.toBeNull();
  });

  it("refuses a source's own typo that puts a pronoun-noun in a verb slot", () => {
    // The live sentence of 2026-10-17, read on the product as the reader receives
    // it: Tom's Hardware's page says `nothing` where `noting` belongs, and the
    // composer published the source's words verbatim. The arbiter's ruling #6
    // (option 1) refuses the sentence rather than repairing it. Measured on the
    // frozen live corpus, 250 events through the production composer: 3,871 stored
    // sentences -> 2 matches (that one, twice), 2,219 published -> 1.
    const target =
      "Nvidia CEO Jensen Huang has even recognized some of these companies in a keynote in Taipei earlier in 2026, nothing the crucial part that these smaller companies play in the global AI supply chain.";
    expect(sourceTypo(target), target).toBe(true);
    expect(editorialNoise(target), target).toBe(true);
    expect(unitTextRejection(target, false), target).toBe("editorial_noise");
    // The controls the ruling named. The first is why the pattern carries its
    // `... that` tail: `nothing` plus a determiner alone matches grammatical
    // English, so the narrower form was rejected by its own control.
    for (const text of [
      "There is nothing the company can do about the export controls.",
      "Using anything that might attract copyright lawyers is also out.",
      "The report said nothing about the delay.",
    ]) {
      expect(sourceTypo(text), text).toBe(false);
      expect(editorialNoise(text), text).toBe(false);
      expect(unitTextRejection(text, false), text).toBeNull();
    }
  });

  it("refuses the longer role phrase and a programme's own episode intro", () => {
    // The two measured shapes the ruled rules missed. Read while measuring the
    // next class: "Stewart Bendle is a deals and coupon writer at Tom's Hardware"
    // is the same masthead line as "a senior writer at TechCrunch" and was three
    // words wide, not two; "Theresa Loconsolo is an audio producer at TechCrunch"
    // named a role the closed set had simply not collected; and "On this episode
    // of The Vergecast, David and Nilay try to make sense of ..." was published as
    // the *deck* of a story whose only paragraph was the hosts' banter. Measured
    // on 2,108 stored units from 250 live events: 2 programme intros, both a
    // podcast's own episode page, and 2 byline units, both the same masthead.
    for (const text of [
      "Stewart Bendle is a deals and coupon writer at Tom's Hardware.",
      "Theresa Loconsolo is an audio producer at TechCrunch.",
      "On this episode of The Vergecast, David and Nilay try to make sense of the HomeView's app situation.",
      "On this episode of TechCrunch's Equity podcast, Dominic-Madori Davis caught up with Vishwanath.",
      "In today's edition of the newsletter, we explain the price change.",
      // The 2026-10-17 ruling's continuations: the masthead line that keeps going
      // with a *beat* (a role description, which is publisher material) and the two
      // sentences that follow it on the same programme page. "... who broke the
      // story on Friday" is still not here, because that one carries a claim.
      "Theresa Loconsolo is an audio producer at TechCrunch focusing on Equity, the network's flagship podcast.",
      "Theresa is based in New Jersey and holds a bachelors degree in Communication from Monmouth University.",
      "Before joining TechCrunch in 2022, she was one of 2 producers at a four-station conglomerate.",
    ]) {
      expect(publisherFurniture(text), text).toBe(true);
      expect(editorialNoise(text), text).toBe(true);
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
    // Controls: reporting about a programme, and a byline that keeps going, both
    // have to survive the widened shapes. A beat continuation is *not* a control
    // any more: "who also covers GPUs" says what the person covers, not what
    // happened, so the ruling counts it as publisher material -- while "who broke
    // the story on Friday" and "and he also writes about" (a claim, not a shape)
    // stay eligible.
    for (const text of [
      "The episode of The Vergecast published on Friday discussed the device.",
      "The company said its new podcast would launch in May.",
      "Maya Chen is the reporter at The Verge who broke the story on Friday.",
      "Sayem Ahmed is the Subscription Editor at Tom's Hardware and he also writes about GPUs.",
      "Theresa Loconsolo said the episode would run next week.",
    ]) {
      expect(publisherFurniture(text), text).toBe(false);
      expect(editorialNoise(text), text).toBe(false);
    }
  });
});

describe("a cut-off extraction seam is not a sentence", () => {
  it("refuses a trailing initial, an unclosed bracket and a tight splice", () => {
    expect(
      validDeterministicSentence(
        "The $300 million employee tender was co-led by Wellington and T.",
      ),
    ).toBe(false);
    expect(
      validDeterministicSentence(
        'Py") that is designed to establish a reverse shell to "45.141.21[.',
      ),
    ).toBe(false);
    expect(
      validDeterministicSentence(
        "However, When Reddit said that there's no replacement for the use of RSS feeds that were being used.",
      ),
    ).toBe(false);
  });

  it("keeps a name whole across its initial and splits a caption pasted onto a sentence", () => {
    expect(
      readerSentences(
        "The tender was co-led by Wellington and T. Rowe Price, large institutional investors.",
      ),
    ).toEqual([
      "The tender was co-led by Wellington and T. Rowe Price, large institutional investors.",
    ]);
    expect(
      readerSentences(
        "On 30 September 2026 the group asked the court for an injunction.Stop calling it safe.",
      ),
    ).toEqual([
      "On 30 September 2026 the group asked the court for an injunction.",
      "Stop calling it safe.",
    ]);
  });

  it("does not cut a sentence open at a dotted abbreviation", () => {
    // The production deck read "... in violation of U.S." -- the splitter took
    // the final stop of "U.S. export controls" for a sentence end. A dotted
    // abbreviation is held back the way a single initial is; a sentence that
    // genuinely ends with one merges with the next rather than cutting open.
    expect(
      readerSentences(
        "The chips were shipped to China in violation of U.S. export controls. The department said so.",
      ),
    ).toEqual([
      "The chips were shipped to China in violation of U.S. export controls.",
      "The department said so.",
    ]);
    expect(readerSentences("The company is based in the U.S. It employs 500 people.")).toEqual([
      "The company is based in the U.S. It employs 500 people.",
    ]);
  });
});

describe("a subheading glued to its prose is stripped, not published", () => {
  it("removes the label and keeps the sentence under it", () => {
    expect(
      stripHeadingLabel("Advance warning: The pipeline detected nearly 80% of major events."),
    ).toBe("The pipeline detected nearly 80% of major events.");
    expect(
      stripHeadingLabel("End-to-end forecasting: A machine learning pipeline uses solar wind."),
    ).toBe("A machine learning pipeline uses solar wind.");
  });

  it("leaves a speaker and a lowercase clause alone", () => {
    expect(stripHeadingLabel("He said: The company will grow this year.")).toBe(
      "He said: The company will grow this year.",
    );
    expect(stripHeadingLabel("Pay Per Use: when AI uses your work you should get paid.")).toBe(
      "Pay Per Use: when AI uses your work you should get paid.",
    );
  });
});

describe("a fronted frame is commentary, not the fact", () => {
  it("keeps the fact and drops the frame around it", () => {
    expect(
      stripFrontedFrame(
        "For a company that built its success on automated verification, DigiCert doesn't see agent management as a manual problem.",
      ),
    ).toBe("DigiCert doesn't see agent management as a manual problem.");
  });

  it("leaves a date, a filing and a named company alone", () => {
    // Every one of these opens the same way and carries something the sentence
    // would otherwise lose -- so all three are published as written.
    for (const text of [
      "In July, an autonomous swarm of OpenAI agents broke out of its sandbox.",
      "In a filing that revealed the deal, the company said it would close in March.",
      "For a company like DigiCert that runs agents, the problem is real.",
      "For a company that must hold 30 agents, the problem is real.",
    ]) {
      expect(stripFrontedFrame(text)).toBe(text);
    }
  });

  it("refuses to leave a fragment behind", () => {
    // The remainder has to be a sentence in its own right, or the frame stays.
    expect(stripFrontedFrame("For a company that runs agents at scale, every one.")).toBe(
      "For a company that runs agents at scale, every one.",
    );
  });
});

describe("a relative date is anchored to the story's own date", () => {
  const at = new Date("2026-09-18T09:00:00Z");

  it("replaces the month with the month it meant", () => {
    expect(normalizeRelativeTime("DigiCert published its survey this month.", at)).toEqual({
      text: "DigiCert published its survey in September 2026.",
      changed: true,
    });
  });

  it("does not stack a preposition on one that is already there", () => {
    // "the first quarter of in 2027" is what a rewrite without this rule looks
    // like -- the phrase is the object of "of" and takes the bare date.
    expect(
      normalizeRelativeTime("First quarter of next year.", new Date("2026-01-01T00:00:00Z")),
    ).toEqual({ text: "First quarter of 2027.", changed: true });
    expect(normalizeRelativeTime("Revenue grew 20% last year.", at)).toEqual({
      text: "Revenue grew 20% in 2025.",
      changed: true,
    });
    expect(normalizeRelativeTime("Revenue grew 20% compared with last year.", at)?.text).toBe(
      "Revenue grew 20% compared with 2025.",
    );
  });

  it.each([
    [
      "Here's why today's AI doesn't really reason.",
      "Here's why today's AI doesn't really reason.",
    ],
    ["These are powers that today’s AI lacks.", "These are powers that today’s AI lacks."],
    ["Tomorrow's release slips again.", "Tomorrow's release slips again."],
    ["Yesterday's announcement was the last one.", "Yesterday's announcement was the last one."],
    ["This year's revenue fell by half.", "This year's revenue fell by half."],
    ["Last month's figure was revised.", "Last month's figure was revised."],
  ])(
    "leaves a possessive alone rather than splitting the noun from its head: %s",
    (input, expected) => {
      // `on 2 October 2026's AI` is what anchoring produced, and it reads as
      // somebody's ownership. The reader keeps a grammatical sentence instead.
      expect(normalizeRelativeTime(input, at)).toEqual({ text: expected, changed: false });
    },
  );

  it("still anchors the bare phrase beside a possessive one", () => {
    expect(
      normalizeRelativeTime("Yesterday it closed; today's AI still misses it.", at)?.text,
    ).toBe("on 17 September 2026 it closed; today's AI still misses it.");
  });

  it.each([
    ["Yesterday the plant closed.", "on 17 September 2026 the plant closed."],
    ["Tomorrow the plant closes.", "on 19 September 2026 the plant closes."],
    ["Yesterday, the plant closed.", "on 17 September 2026, the plant closed."],
    ["TODAY the plant reopens.", "on 18 September 2026 the plant reopens."],
  ])("reads a capitalised day word the same as a lower-case one: %s", (input, expected) => {
    // The pattern is case-insensitive and hands the callback the source's own
    // capitalisation. Compared raw, a sentence-initial "Yesterday" matched
    // neither shift and published the story's own date -- one day late, next
    // to dates the reader has no reason to doubt.
    expect(normalizeRelativeTime(input, at)?.text).toBe(expected);
  });

  it("refuses what cannot be made absolute", () => {
    // A week has no name, and "the last month" is a window rather than a
    // calendar month: both are refused, which is counted upstream.
    expect(normalizeRelativeTime("The pattern turned up this week.", at)).toBeNull();
    expect(normalizeRelativeTime("Sales rose over the last month.", at)).toBeNull();
    // No anchor at all is the same answer as no safe rewrite.
    expect(normalizeRelativeTime("Sales rose this month.", null)).toBeNull();
  });

  it("leaves absolute dates and everyday prose untouched", () => {
    for (const text of [
      "In July, an autonomous swarm of OpenAI agents broke out of its sandbox.",
      "The survey was published on 12 September.",
      "The figure is a third higher than last time.",
    ]) {
      expect(normalizeRelativeTime(text, at)).toEqual({ text, changed: false });
    }
  });
});

describe("a contraction is a predicate", () => {
  it("accepts the sentences a stem list cannot see", () => {
    for (const text of [
      "DigiCert doesn't see agent management as a manual problem.",
      "The agents aren't under anyone's control.",
      "It isn't a manual problem.",
      "They won't say how many agents are running.",
      "The vendor hasn’t published a fix.", // The typographic apostrophe.
    ]) {
      expect(hasPredicate(text)).toBe(true);
    }
  });

  it("still refuses a label with no clause in it", () => {
    for (const text of ["Photo: Jane Doe", "Agent management", "Osaka, Japan"]) {
      expect(hasPredicate(text)).toBe(false);
    }
  });
});

/**
 * One source, one excerpt -- the shape every rule below was found in.
 *
 * The corpus is where these five came from: a 200-event pass over the live
 * composer published a section label glued to its own prose ("Pricing and
 * availability Amazon CloudWatch Omni is now available."), two ungrammatical
 * attributions ("reports that Overall, ...", "reports that Ten days later, ..."),
 * a pronoun repaired with a determiner ("the was also revealed that the inquiry
 * ..."), a sentence starting on a closing quote ("” Thomas shouted ..."), and a
 * page with no paragraphs at all because every sentence in it said "this week".
 */
const oneSource = (excerpt: string, name = "The Register", title = "A story"): Story => ({
  id: "prose-rule",
  org: name,
  title,
  what: "",
  why: "",
  importance: "Medium",
  score: { relevance: 50, importance: 50, novelty: 50 },
  sources: 1,
  topics: [],
  time: "",
  publishedAt: "2026-09-18T09:00:00Z",
  sourceList: [{ name, at: "", headline: "A story", excerpt }],
  before: "",
  after: "",
  timeline: [],
});

const composedText = (excerpt: string, name = "The Register", title = "A story"): string => {
  const { article } = composeArticleWithDiagnostics(oneSource(excerpt, name, title));
  return [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" ");
};

describe("a heading seam belongs to the markup, never to a cut into a sentence", () => {
  it("publishes the MariaDB sentence whole, with its opening clause", () => {
    // The one cut the removed splitter made in the frozen 200-event corpus that
    // reached a reader: "When asked to compare ..." read as a heading, and the
    // sentence lost its opening clause. It is published intact now, and neither
    // half of the corruption -- the cut, or a refusal for opening on a wh-word --
    // may come back.
    const sentence =
      "When asked to compare MariaDB with PostgreSQL for the same task, however, it had plenty to say.";
    const text = composedText(sentence);
    // Whole: the opening clause is still in front of the fact. The capital is the
    // composer's own construction rule -- a clause reported after `that` may not
    // keep the sentence capital its source gave it -- not a cut.
    expect(text).toMatch(/when asked to compare MariaDB with PostgreSQL/i);
    expect(text).toContain(
      "MariaDB with PostgreSQL for the same task, however, it had plenty to say.",
    );
    expect(text).not.toBe("");
  });

  it("is not a rule the composer has any more", async () => {
    // Removed rather than narrowed. It made five cuts in the frozen corpus, four
    // were refused downstream, and the fifth deleted a real subject -- and the
    // seam it was reconstructing is known where the markup is, not in plain text.
    const evidence = await import("./reader-evidence");
    expect(Object.keys(evidence)).not.toContain("splitStandfirstGlue");
  });

  it("refuses a heading by its shape, not by its first word", () => {
    // The rule this replaced was `WH_HEADLINE + no question mark`: any unit
    // opening on Why/How/What/When/Where/Who/Which/Here. Over the frozen
    // 200-event corpus it refused 19 units, of which 16 were ordinary sentences
    // and none was the source's own headline, and deleting it outright published
    // this standfirst as the production fixture's deck. What is left is the shape
    // a sentence cannot imitate: a wh-opening with no question mark, no clause
    // boundary inside it and no cleft.
    expect(headingUnit("Why identity built for humans breaks at agent speed.")).toBe(true);
    expect(unitTextRejection("Why identity built for humans breaks at agent speed.", false)).toBe(
      "headline_fragment",
    );
    const text = composedText(
      "Why identity built for humans breaks at agent speed. DigiCert doesn't see agent management as a manual problem.",
    );
    expect(text).not.toContain("Why identity built for humans");
  });

  it.each([
    // Each of these was refused by the deleted word list, and each is admitted by
    // the shape test: an opening clause with a boundary, or a cleft.
    "When F-Droid first appeared, there wasn't much to see, but now it has thousands of open source apps.",
    "When benchmarked against the latest GeForce RTX 5060, the LX 7G100 delivers only about a third of the performance.",
    "When these steps do not resolve a case, the system falls back to a structured repair loop.",
    "What has been missing so far is a finite-size method for evaluating the guessing-moment separation.",
  ])("admits %s", (sentence) => {
    expect(headingUnit(sentence)).toBe(false);
    expect(unitTextRejection(sentence, false)).toBeNull();
  });

  it("still refuses the glued 'How to run it' unit, as an invalid sentence", () => {
    const glued =
      "How to run it The simplest way to run it's just to go to https://github.com/GitHubSecurityLab/seclab-taskflows-fuzzing and start a codespace.";
    expect(unitTextRejection(glued, false)).toBe("invalid_sentence");
  });

  it("still refuses the schedule row, which is publisher voice rather than a fact", () => {
    // The other glued furniture shape in the corpus: a session title with its
    // speakers, a time and a room code. The gate that refuses it is the publisher
    // -voice one, so it stays refused even with the heading rule narrowed.
    const row =
      "What You Cannot Profile, You Cannot Optimize: Learning to Read PyTorch Traces Aritra Roy Gosthipaty, Suvaditya Mukherjee, 2:50 PM PDT, Room LL20AB Modern profiling tools generate complex traces.";
    expect(editorialNoise(row)).toBe(true);
    expect(composedText(`${row} Azure added a managed Redis tier in three regions.`)).not.toContain(
      "Room LL20AB",
    );
  });

  it("ends a heading where the markup does, so the prose is never glued to it", () => {
    // The structural boundary: `htmlToText` closes a heading element, so a
    // heading and the prose after it arrive as two units -- the heading is then
    // refused as its own unit (it opens on a wh-word and asks nothing) and the
    // prose is published intact.
    const html = "<h2>Pricing and availability</h2><p>Amazon CloudWatch Omni is now available.</p>";
    expect(htmlToText(html)).toBe(
      "Pricing and availability. Amazon CloudWatch Omni is now available.",
    );
  });
});

/**
 * The other half of the same defect, and the shape `headingUnit` structurally
 * cannot see: two source *blocks* published as one sentence, because a provider
 * joined them with a space instead of the full stop that should separate them.
 *
 *   "What to Expect from the Introduction Track All attendees, from students, ..."
 *
 * `headingUnit` asks whether a unit is *nothing but* a heading, and this unit is
 * not: it has commas and a predicate, both supplied by the prose the heading was
 * glued to. The seam is made at ingest -- which is why the ingest boundary now
 * ends a heading element -- and a row stored before that still carries it, so the
 * gate refuses the unit where the seam is. Nothing is cut: with no way to prove
 * where the seam sits, the second half is not a sentence either.
 */
describe("a source block seam is refused, not cut into a sentence", () => {
  const headingAndProse =
    "What to Expect from the Introduction Track All attendees, from students, first time attendees all the way to seasoned AI engineers that want to learn about new areas are invited to check out the brand new Introduction Track at PyTorch Conference NA 2026.";

  it("refuses the heading the provider glued to its own prose", () => {
    expect(sourceSeam(headingAndProse)).toBe("from the Introduction Track All attendees,");
    expect(unitTextRejection(headingAndProse, false)).toBe("invalid_sentence");
  });

  it("keeps refused material off the page without refusing the story", () => {
    const text = composedText(
      `${headingAndProse} Azure added a managed Redis tier in three regions.`,
    );
    expect(text).toContain("managed Redis tier");
    expect(text).not.toContain("What to Expect from the Introduction Track");
    expect(text).not.toContain("All attendees");
    // Refused as a whole rather than cut at a guessed seam, so the half that reads
    // like prose is not published as a sentence either.
    const alone = composedText(headingAndProse);
    expect(alone).not.toContain("All attendees");
  });

  it("refuses a session credit line, alone or glued to its title and description", () => {
    // The same seam, three more times, from one crawl: the speakers line on its
    // own, the title that follows it, and the label a session list is written
    // under. None of them carries a clause -- `Mark` and the `AM` in a clock time
    // are what a verb scan sees -- and none is a sentence.
    const shapes = [
      "Aritra Roy Gosthipaty, Suvaditya Mukherjee, 2:50 PM PDT, Room LL20AB.",
      "Understanding Modern Vision Language Models Aastha Jhunjhunwala, Mark Moyou, 12:20 PM PDT, Room LL20AB Vision-language models present unique challenges.",
      "Sessions include: From Math Panic to PyTorch Confidence Yashasvi Misra, 3:25 PM PDT, Room LL20AB Designed for Python developers, students, and educators new to machine learning.",
    ];
    for (const shape of shapes) {
      expect(sourceSeam(shape)).not.toBeNull();
      expect(unitTextRejection(shape, false)).toBe("invalid_sentence");
    }
  });

  it("leaves a sentence that merely contains a time and a place alone", () => {
    // What the inventory test is made of: a segment of a schedule carries names,
    // codes and grammatical words, while a sentence's segments carry lowercase
    // *content* words. These all survive, and so does the name that needs its two
    // capitals.
    for (const text of [
      "The keynote runs 9:00 AM to 10:00 AM in Room 4.",
      "He spoke at 9:00 AM, Wednesday, Room B12, about safety.",
      "Sessions begin at 9:00 AM, Room 4, and end before noon.",
      "The flight leaves at 9:00 AM, Gate B12, Terminal 3, nonstop to Osaka.",
      "In New York, he said the deal was dead.",
      "The Wall Street Journal reported the deal was dead.",
      "Apple, Google and Meta declined to comment.",
    ]) {
      expect(sourceSeam(text)).toBeNull();
      expect(unitTextRejection(text, false)).toBeNull();
    }
  });

  it("leaves every comma-containing When sentence alone", () => {
    for (const text of [
      "When asked to compare MariaDB with PostgreSQL for the same task, however, it had plenty to say.",
      "When Meta first launched smart glasses in 2021, the company called them a new kind of computer.",
      "When the Jacobian spectrum is too spread out, the method fails.",
    ]) {
      expect(sourceSeam(text)).toBeNull();
      expect(unitTextRejection(text, false)).toBeNull();
    }
  });

  it("refuses it at the deck boundary too, where a stored summary is judged", () => {
    // The deck is the one published unit that is not derived from a selected fact,
    // so a stored summary carries the seam on its own route to the page.
    expect(judgeFallbackDeck(headingAndProse, "A story")).toEqual({
      text: "",
      reason: "malformed_sentence",
    });
  });

  it("still refuses the standfirst, and does it as a heading rather than a seam", () => {
    const standfirst = "Why identity built for humans breaks at agent speed.";
    expect(unitTextRejection(standfirst, false)).toBe("headline_fragment");
    expect(sourceSeam(standfirst)).toBeNull();
  });
});

/** A sentence that names what the cases below open on, so the page carries it. */
const PAGE_CONTEXT =
  "The company shipped the release on Tuesday, and its systems updated the same day.";

describe("a source's capitalisation is kept unless its construction proves the word", () => {
  it("keeps the capital of a name that opens on a function word", () => {
    // The frozen corpus published NPR's "All Things Considered host Mary Louise
    // Kelly" as "all Things Considered host ...": `all` is a quantifier, and a
    // quantifier is also how a title can start.
    const text = composedText(
      "All Things Considered host Mary Louise Kelly talks with White House correspondent Emily Feng about the Trump/Xi summit.",
    );
    expect(text).toContain("All Things Considered host Mary Louise Kelly");
    expect(text).not.toContain("all Things Considered");
  });

  it.each([
    "This release adds vector indexes to the query planner.",
    "These systems share one credentials store across every region.",
    "Amazon is rolling the feature out across its retail regions.",
    "OpenAI said the model would be available to every customer.",
    "European regulators opened a consultation on the rule.",
    "The Register published the analysis on its own site.",
  ])("leaves %s as the source wrote it", (sentence) => {
    // The page context is part of the fixture now, and for a reason that is not
    // about capitalisation: two of these sentences open on `This release` and
    // `These systems`, and since 2026-10-17 (arbiter ruling #7, Q2) a body block
    // may only open on a reference the page above it carries. A single sentence
    // on its own page is exactly the case that rule refuses, so the fixture
    // carries the sentence in front of it -- what this test is about, the
    // source's own capital, is unchanged.
    expect(composedText(`${PAGE_CONTEXT} ${sentence}`)).toContain(sentence);
  });

  it("still lowers the conjunction the reported clause matched", () => {
    // What remains of the rule, and only because the branch matched the word: a
    // clause subordinate to a reporting verb cannot open with a capital, so
    // "reports that Once they were out in the wild" is ungrammatical however the
    // clause is punctuated.
    const text = composedText("Once the outage began, customers could not reach the service.");
    expect(text).toContain("reports that once the outage began");
  });

  it("keeps a title the headline prints, and invents no frame around it", () => {
    // Production, 2026-10-17, read on the deployed composer: the deck of the
    // Wu-Tang story published "The Verge reports that once Upon A Time in Shaolin
    // has a long history ..." -- the album's first word lowered because `once` is
    // one of the function words this pass lowers. The headline prints the title,
    // so the clause belongs to it and cannot follow `that`.
    const { article } = composeArticleWithDiagnostics(
      oneSource(
        "Once Upon A Time in Shaolin has a long history, which Pablo Torre Finds Out goes into in detail.",
        "The Verge",
        "We can finally hear some of Wu-Tang Clan’s Once Upon A Time in Shaolin album",
      ),
    );
    const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(text).toContain("Once Upon A Time in Shaolin");
    expect(text).not.toContain("once Upon A Time");
    // No invented frame either: `Once ...` cannot follow `that` while keeping the
    // capital a title needs, so the attribution is not built at all and the
    // citation carries the provenance.
    expect(text).not.toContain("reports that");
  });

  it("lowers a clause of capitalised words that is not the headline's title", () => {
    // The decoy the guard has to survive: two capitals in a row are not a title on
    // their own. `When Credential Guard is not enabled ...` is an ordinary clause,
    // and leaving its capital in place is the defect this lowering exists to stop.
    const text = composedText(
      "When Credential Guard is not enabled and BlockNtlmSSO is not set to Audit mode, the use of NTLMv1-derived credentials will be blocked.",
      "The Register",
      "Networking problems after the October 2026 Windows update? NTLM might be to blame",
    );
    expect(text).toContain("reports that when Credential Guard is not enabled");
    expect(text).not.toContain("reports that When Credential Guard");
  });

  it("is the headline that makes it a title, not the capital letters", () => {
    // Same sentence, no headline naming it: the guard does not fire, and the
    // clause is lowered exactly as it was before. This is what keeps the rule from
    // being a shape test that would also catch `When Credential Guard ...`.
    const text = composedText(
      "Once Upon A Time in Shaolin has a long history, which Pablo Torre Finds Out goes into in detail.",
    );
    expect(text).toContain("reports that once Upon A Time in Shaolin");
  });

  it("lowers a clause that merely names the headline's subject", () => {
    // The headline names the laptop; the clause opens on `When`, which is not part
    // of any phrase the headline prints, so nothing about the title applies.
    const text = composedText(
      "When Nvidia's RTX Spark shipped, reviewers found the battery lasted a full working day.",
      "The Register",
      "Benchmarked: Nvidia's RTX Spark is a laptop that lasts",
    );
    expect(text).toContain("reports that when Nvidia's RTX Spark shipped");
  });
});

describe("a time phrase that cannot be made absolute is dropped, not the sentence", () => {
  it("keeps the fact and removes the phrase", () => {
    expect(stripUnanchorableTime("The pattern turned up this week.")).toBe(
      "The pattern turned up.",
    );
    expect(
      stripUnanchorableTime(
        "Most leaders stick to the pitch, but when I interviewed the prime minister this week, he admitted that no government is ready.",
      ),
    ).toBe(
      "Most leaders stick to the pitch, but when I interviewed the prime minister, he admitted that no government is ready.",
    );
  });

  it("refuses when nothing safe is left, and leaves an anchorable phrase alone", () => {
    // A sentence that *is* the phrase has nothing to publish once it goes, and a
    // phrase `normalizeRelativeTime` can anchor is not this function's business.
    expect(stripUnanchorableTime("This week.")).toBeNull();
    expect(stripUnanchorableTime("Sales rose this month.")).toBeNull();
  });

  it("keeps a possessive, which names a thing rather than a date", () => {
    // The clitic owns the noun after it, so there is no date in the phrase to
    // drop -- and removing the head anyway produced
    // `’s Stratechery video is on Frontier Overhangs.` in the 2026-10-03 corpus
    // audit. The sentence keeps its phrase, exactly as `today's AI` and `last
    // year's models` always have.
    expect(
      stripUnanchorableTime("This week's Stratechery video is on Frontier Overhangs."),
    ).toBeNull();
    expect(
      normalizeRelativeTime(
        "This week's Stratechery video is on Frontier Overhangs.",
        new Date("2026-10-03"),
      ),
    ).toEqual({ text: "This week's Stratechery video is on Frontier Overhangs.", changed: false });
    // A real week reference in the same sentence is still removed: the rule
    // reads each phrase, not each sentence.
    expect(
      stripUnanchorableTime("This week's episode is out, as the company said this week."),
    ).toBe("This week's episode is out, as the company said.");
  });

  it("does not leave the phrase's punctuation where the phrase was", () => {
    // The corpus case, after the narrator rule made it publishable again:
    // "Last week, the author reported" lost "Last week" and kept its comma, and
    // the composer pasted it after an attribution -- "According to Phoronix, ,
    // the author reported running some benchmarks ...".
    const out = stripUnanchorableTime(
      'Last week, the author reported running some benchmarks showing performance gains for AMD Ryzen AI Max+ "Strix Halo".',
    );
    expect(out).toBe(
      'The author reported running some benchmarks showing performance gains for AMD Ryzen AI Max+ "Strix Halo".',
    );
  });

  it("turns a page with no paragraphs back into a story", () => {
    // Before: every sentence said "this week", every sentence was refused, and
    // the reader got an empty page. Now the phrase goes and the fact stays.
    const text = composedText(
      "Most leaders on a trade mission stick to the pitch, but the prime minister admitted this week that no government is ready for what AI is about to do. The minister also said the government will publish a strategy this week.",
    );
    expect(text).not.toMatch(/this week/i);
    expect(text).toContain("no government is ready");
    expect(text).toContain("publish a strategy");
  });
});

describe("a feed's footer belongs to the feed", () => {
  it("cuts the whole footer, not the fragment the splitter made of it", () => {
    // The footer's own copy of the headline contains a full stop, so the sentence
    // splitter cut the footer into three pieces and published the first as the
    // story's *deck* on the frozen corpus: "The post AI is changing developer
    // work." The cut belongs at the source boundary, before the splitter runs.
    const excerpt =
      "AI is changing how developers work and apply their skills. Put these ideas in practice > . The post AI is changing developer work. Here are three skills to strengthen. appeared first on The GitHub Blog.";
    const { text, strippedFooter } = stripSourceFurniture(
      excerpt,
      "AI is changing developer work. Here are three skills to strengthen.",
    );
    expect(strippedFooter).toBe(true);
    expect(text).toBe(
      "AI is changing how developers work and apply their skills. Put these ideas in practice > .",
    );
    // A sentence *about* a post is not a footer: the cut is bounded and anchored
    // to the end of the text.
    const prose =
      "The post appeared first on the company's own blog, the report says, and it was removed within the hour.";
    expect(stripSourceFurniture(prose, undefined)).toEqual({
      text: prose,
      strippedHeadline: false,
      strippedFooter: false,
    });
  });

  it("leaves the prose that follows a mid-text footer phrase alone", () => {
    // `appeared first on` is not confined to the end of a feed item, and the cut
    // is anchored to the phrase's *start*, so a tail bound loose enough to cover
    // a long outlet name also covers the sentences after it. This excerpt is the
    // production shape: two furniture sentences and one fact, with the phrase in
    // the middle. Under the old bound the fact was deleted before it was ever a
    // unit, and the story published with nothing in it.
    const excerpt =
      "Subscribe to our newsletter and save 50%. The post on the new plant appeared first on TechCrunch. The factory will employ 400 workers when production starts in October.";
    expect(stripSourceFurniture(excerpt, undefined)).toEqual({
      text: excerpt,
      strippedHeadline: false,
      strippedFooter: false,
    });
    // And the same excerpt with the footer genuinely last is still cut, so the
    // bound is what changed and not the rule's intent.
    const trailing =
      "The factory will employ 400 workers. The post appeared first on The GitHub Blog.";
    expect(stripSourceFurniture(trailing, undefined)).toEqual({
      text: "The factory will employ 400 workers.",
      strippedHeadline: false,
      strippedFooter: true,
    });
  });

  it("refuses the fragments a footer leaves behind when it arrives already cut", () => {
    // The unit-level closed set, for a feed whose footer is split before any
    // source-level rule can see it.
    expect(editorialNoise("Appeared first on The GitHub Blog.")).toBe(true);
    expect(editorialNoise("Apply now to host a Side Event → Founder Summit brings founders.")).toBe(
      true,
    );
    expect(editorialNoise("Put these ideas in practice >.")).toBe(true);
    // Decoys: the same vocabulary in text that is reporting.
    expect(editorialNoise("The post was advertised on Monday.")).toBe(false);
    expect(editorialNoise("Applications close tonight at midnight PT.")).toBe(false);
  });

  it("closes a doubled full stop and leaves an ellipsis and a range alone", () => {
    expect(cleanDeterministicSentence("Tip #1: Learn to direct AI, not just use it..")).toBe(
      "Tip #1: Learn to direct AI, not just use it.",
    );
    expect(cleanDeterministicSentence("Wait... what happened next?")).toBe(
      "Wait... what happened next?",
    );
    expect(cleanDeterministicSentence("The range is 1..5 in the new notation.")).toBe(
      "The range is 1..5 in the new notation.",
    );
  });

  it("publishes the item, not the wrapper, when the footer is in the feed", () => {
    const excerpt = [
      "AI is changing how developers work and apply their skills.",
      "Writing code is still essential, but developers increasingly need to know how to direct AI.",
      "Put these ideas in practice > .",
      "The post AI is changing developer work. Here are three skills to strengthen. appeared first on The GitHub Blog.",
    ].join(" ");
    const text = composedText(excerpt, "GitHub");
    expect(text).toContain("AI is changing how developers work and apply their skills.");
    expect(text).not.toContain("appeared first on");
    expect(text).not.toContain("Put these ideas in practice");
    expect(text).not.toContain("The post AI is changing developer work.");
  });
});

describe("the ruler and the deck rule mean the same thing by unresolved context", () => {
  it("exempts a demonstrative whose head is the document the reader is holding", () => {
    // Negative controls from the arbiter's D2 closure ruling, 2026-10-11. Both were
    // counted as context-dependent openings by the ruler while the deck rule (which
    // has always exempted them) published them, so the diagnostic read two more
    // defects than the rule could produce. `This report` and `This paper` name the
    // page the reader has open; its subject is in the sentence.
    expect(
      unresolvedContextOpening(
        "This report presents the OpenSpace Lab's solution to the competition.",
      ),
    ).toBe(false);
    expect(
      unresolvedContextOpening(
        "This paper investigates the feasibility of deploying quadruped walking robots in a warehouse.",
      ),
    ).toBe(false);
  });

  it("still detects a demonstrative the page never establishes", () => {
    // The positive control the ruling names by hand: the PC-shipments opening, whose
    // referent is the price increases the page never mentions. D3 stopped it reaching
    // the reader through the entity-context splice; the ruler must still be able to
    // see it, or the fix would be invisible to the measurement that proved it.
    expect(
      unresolvedContextOpening(
        "These price increases have been directly caused by the boom in AI data centers, with hyperscalers pouring money into HBM.",
      ),
    ).toBe(true);
    expect(unresolvedContextOpening("This was announced on Tuesday.")).toBe(true);
    expect(
      unresolvedContextOpening("The study found a similar effect in every market it examined."),
    ).toBe(false);
  });
});

describe("a demonstrative that heads a possessive is a determiner, not a pronoun", () => {
  it("does not ask for a subject the sentence already has", () => {
    // `This week's video is on ...` has its subject in the sentence, and the
    // clitic is the structural mark. Read as a bare pronoun the sentence was
    // refused as context-dependent, which is how the corpus lost a grammatical
    // fact rather than publishing it.
    expect(contextDependent("This week's Stratechery video is on Frontier Overhangs.")).toBe(false);
    expect(contextDependent("These companies' filings show the same pattern.")).toBe(false);
    expect(contextDependent("That regulator's decision was expected this week.")).toBe(false);
  });

  it("still refuses the demonstrative that stands for a sentence the reader may not have", () => {
    // No clitic, no subject: the class the rule exists for, in the singular,
    // the plural and the past tense.
    expect(contextDependent("This was announced on Tuesday.")).toBe(true);
    expect(contextDependent("These results show the trend.")).toBe(true);
    expect(contextDependent("Those were also delayed.")).toBe(true);
    expect(contextDependent("This is the second time the regulator has intervened.")).toBe(true);
  });

  it("publishes the fact instead of refusing it for a missing subject", () => {
    // The shape the corpus produced, on the path that refused it: two sources,
    // so the composer ranks rather than reading one document forwards, and the
    // fact's own evidence is the second source -- it belongs in the body.
    const story: Story = {
      ...oneSource(
        "Regulators must still approve the grid connection before construction can start. The commission withdrew its finding that the application was complete. A refiling in September restarted the process.",
      ),
      sources: 2,
      sourceList: [
        {
          name: "The Register",
          at: "",
          headline: "A story",
          excerpt:
            "Regulators must still approve the grid connection before construction can start. The commission withdrew its finding that the application was complete. A refiling in September restarted the process.",
        },
        {
          name: "Stratechery",
          at: "",
          headline: "A story",
          excerpt: "This week's Stratechery video is on Frontier Overhangs.",
        },
      ],
    };
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    expect(diagnostics.ordering).toBe("relevance");
    expect(diagnostics.facts.refused).toBe(0);
    expect(
      article.paragraphs.some((paragraph) =>
        paragraph.text.includes("This week's Stratechery video is on Frontier Overhangs."),
      ),
    ).toBe(true);
  });
});

describe("a closing quote does not open a sentence", () => {
  it("drops the residue and keeps the sentence", () => {
    expect(cleanDeterministicSentence("” Thomas shouted to his colleagues: “Let’s go lads.")).toBe(
      "Thomas shouted to his colleagues: “Let’s go lads.",
    );
    // A real opening quotation is not residue: the sentence is speech, and the
    // speaker is at the end of it.
    expect(cleanDeterministicSentence('"We treat our agents as team members," Man wrote.')).toBe(
      '"We treat our agents as team members," Man wrote.',
    );
  });

  it("closes the space that pasting two fragments leaves before punctuation", () => {
    expect(cleanDeterministicSentence("According to RNLI , the rescued were in the water.")).toBe(
      "According to RNLI, the rescued were in the water.",
    );
    expect(cleanDeterministicSentence("visit the pricing page .")).toBe("Visit the pricing page.");
  });
});

describe("attribution follows the adverbial that cannot sit after `that`", () => {
  it("leads with the adverbial rather than gluing it to the source", () => {
    const text = composedText(
      "Ten days later, Anthropic will release the next version of its model. Overall, the cadence of releases will accelerate from quarterly to monthly.",
    );
    expect(text).toContain("Ten days later, The Register reports that Anthropic will release");
    expect(text).toContain("Overall, the cadence of releases will accelerate");
    // The two shapes the corpus published, both ungrammatical: a comma may not
    // follow `that`, and `Ten`/`Overall` are not clauses.
    expect(text).not.toMatch(/reports that \w+\w*,/i);
    expect(text).not.toMatch(/reports? that (?:Overall|Ten|However|Meanwhile)\b/);
  });

  it("drops a redundant source wrapper without hoisting the subject", () => {
    // "The first briefing, which Allan did not sign, warned that ..." is one
    // sentence whose first three words are its subject; hoisting them in front of
    // an attribution produced "The first briefing, The Register reports that
    // which Allan did not sign, warned ...".
    const text = composedText(
      "The first briefing, which Allan did not sign, warned that the environment had become highly challenging.",
    );
    // The story itself came from The Register, so its citation already carries
    // that provenance. Dropping the wrapper leaves the source's subject intact.
    expect(text).toContain("The first briefing, which Allan did not sign, warned");
    expect(text).not.toContain("According to The Register");
    expect(text).not.toMatch(/reports that which/i);
  });

  it("drops an affirmation the source was answering a question with", () => {
    // The corpus published "The Register reports that Yes, the servers still
    // required a username and password for access ...": a reported clause may not
    // open on an affirmation, and the question the tipster was answering is not on
    // the page. The marker goes; the fact stays.
    const text = composedText(
      "Yes, the servers still required a username and password for access, but an enterprising hacker could have tried guessing the credentials.",
    );
    expect(text).not.toMatch(/reports that Yes\b/);
    expect(text).toContain("The servers still required a username and password");
    // The comma is what makes the marker an answer: "No more than half could trace
    // ..." keeps its `No`, because that one is part of the measure. A quantity is
    // not an answer, and only an answer may not follow `that`.
  });

  it("drops an orphan rather than repairing it with a determiner", () => {
    // The corpus deck read "According to The Guardian World, the was also
    // revealed that the inquiry ..." -- the word before the pronoun was "The",
    // and a determiner is not an antecedent.
    const text = composedText(
      "The first briefing, which Allan did not sign, warned that the environment had become highly challenging. It was also revealed that the inquiry held several closed hearings.",
    );
    expect(text).not.toMatch(/the was also revealed/i);
    expect(text).not.toMatch(/\bIt was also revealed\b/);
  });
});

describe("a first-person sentence is classified, not deleted", () => {
  it("resolves a reporting wrapper to the actor it names", () => {
    // The narrator says who was asked; the clause says who answered. The actor is
    // named in the sentence, so the pronoun can be resolved to it with nothing
    // guessed -- this is the sentence whose loss left the Greek prime minister's
    // story publishing nothing at all.
    expect(
      resolveNarrator(
        "Most leaders on a trade mission stick to the pitch, but when I interviewed Greek Prime Minister Kyriakos Mitsotakis this week, he also admitted that no government is ready for what AI is about to do.",
        "author",
      ),
    ).toEqual({
      kind: "wrapper",
      text: "Greek Prime Minister Kyriakos Mitsotakis also admitted that no government is ready for what AI is about to do.",
    });
    expect(
      resolveNarrator(
        "When I spoke to Anthropic's Dario Amodei last month, he said the company would publish a safety framework.",
        "author",
      )?.text,
    ).toBe("Anthropic's Dario Amodei said the company would publish a safety framework.");
  });

  it("attributes an observation to the author rather than asserting it", () => {
    // "The author reports" is the source's own words about itself: nyuz is not
    // claiming the finding, and it is not pretending the writer did nothing.
    expect(resolveNarrator("I found that version 6.2 reduced latency by 18%.", "author")).toEqual({
      kind: "author",
      text: "The author reports that version 6.2 reduced latency by 18%.",
    });
    // A paper's authors are plural and a news desk's narrator is one person.
    expect(
      resolveNarrator("We found that the patch reduced latency by 18%.", "authors")?.text,
    ).toBe("The authors report that the patch reduced latency by 18%.");
  });

  it("keeps the method in an experiment by making it the report", () => {
    expect(
      resolveNarrator(
        'Last week I ran some benchmarks showing performance gains for AMD Ryzen AI Max+ "Strix Halo" on Ubuntu 26.10.',
        "author",
      )?.text,
    ).toBe(
      'Last week, the author reported running some benchmarks showing performance gains for AMD Ryzen AI Max+ "Strix Halo" on Ubuntu 26.10.',
    );
    expect(
      resolveNarrator("We tested the patch on three systems and saw improvements.", "authors")
        ?.text,
    ).toBe("The authors report testing the patch on three systems and saw improvements.");
  });

  it("names the source as the actor of its own work", () => {
    // The class whose loss was largest: a paper's own sentence keeps its verb, its
    // tense and its object, and only the narrator is named. Nothing is invented,
    // because nothing but the actor changes -- and 46 arXiv abstracts per 200 events
    // used to go unpublished without it.
    expect(
      resolveNarrator(
        "To address this gap, we propose MolDesignBench, a scenario-grounded benchmark that more closely reflects real-world molecular design.",
        "authors",
      ),
    ).toEqual({
      kind: "claim",
      text: "To address this gap, the authors propose MolDesignBench, a scenario-grounded benchmark that more closely reflects real-world molecular design.",
    });
    // A plural narrator's other pronouns follow it, because the number is the
    // source's own: "the authors ... their" is what the sentence already said.
    expect(
      resolveNarrator(
        "Furthermore, we show the near-minimax optimality of our theory for regression problems with ReLU activations.",
        "authors",
      )?.text,
    ).toBe(
      "Furthermore, the authors show the near-minimax optimality of their theory for regression problems with ReLU activations.",
    );
    // An auxiliary carries the agreement, an adverb between the narrator and its
    // verb changes nothing about the actor, and a past tense needs no re-conjugation.
    expect(
      resolveNarrator(
        "Today, we are announcing an enhanced custom event bus in Amazon EventBridge.",
        "author",
      )?.text,
    ).toBe("Today, the authors are announcing an enhanced custom event bus in Amazon EventBridge.");
    expect(
      resolveNarrator(
        "To address this challenge, we first reproduce baseline models on the WebArena benchmark and identify the failure modes.",
        "authors",
      )?.text,
    ).toBe(
      "To address this challenge, the authors first reproduce baseline models on the WebArena benchmark and identify the failure modes.",
    );
    expect(
      resolveNarrator("I selected Custom event bus, the recommended option labeled New.", "author")
        ?.text,
    ).toBe("The author selected Custom event bus, the recommended option labeled New.");
  });

  it("hands over a named answer as it was written", () => {
    // The same wrapper with the actor named rather than referred to. The sentence
    // already says who spoke and by what verb, so both are kept as written.
    expect(
      resolveNarrator(
        'When we asked why, HSBC said: "For security reasons, our mobile banking app cannot be used within certain protected private space."',
        "author",
      ),
    ).toEqual({
      kind: "wrapper",
      text: 'HSBC said: "For security reasons, our mobile banking app cannot be used within certain protected private space."',
    });
  });

  it("still drops what would have to be guessed", () => {
    // Slogan and opinion, not work: the modal is the whole difference between a
    // fact and a campaign line, so it is refused rather than re-pointed.
    expect(resolveNarrator("We must protect our planet.", "authors")?.kind).toBe("ambiguous");
    expect(
      resolveNarrator("But I would like to propose to you that chat is the wrong UI.", "author")
        ?.kind,
    ).toBe("ambiguous");
    // A metaphor with no verb in it is not the authors' assertion.
    expect(resolveNarrator("We're 176 years into this AI experiment.", "author")?.kind).toBe(
      "ambiguous",
    );
    // A single narrator's leftover "myself" would have to become a pronoun the
    // source never used.
    expect(
      resolveNarrator(
        "Sharing uses AWS Resource Access Manager (AWS RAM), so I did not have to set up cross-account permissions or bus-to-bus routing myself.",
        "author",
      )?.kind,
    ).toBe("ambiguous");
    // A third-person plural competes for the antecedent: "they told us we would
    // have to wait" is not the authors waiting.
    expect(
      resolveNarrator(
        "We asked the ministry for comment and they told us we would have to wait.",
        "authors",
      )?.kind,
    ).toBe("ambiguous");
  });

  it("publishes a claim the corpus lost, attributed to its authors", () => {
    const text = composedText(
      "To address this gap, we propose MolDesignBench, a scenario-grounded benchmark that reflects real-world molecular design.",
    );
    expect(text).toContain("the authors propose MolDesignBench");
    expect(text).not.toMatch(/\bwe propose\b/);
  });

  it("resolves the sentence-initial We, which is how every paper opens", () => {
    // The clause regex was case-sensitive, so `we propose X` resolved and
    // `We propose X` did not: the shape every arXiv abstract opens with fell
    // through to the ambiguous branch and was dropped. Measured on the frozen
    // 200-event corpus, the fix flips exactly one sentence, so this is a
    // correctness test rather than a volume one.
    expect(resolveNarrator("We propose ElectrolyteFM.", "authors")).toEqual({
      kind: "claim",
      text: "The authors propose ElectrolyteFM.",
    });
    // A news desk writes "we" too, and the capital does not make it singular.
    expect(resolveNarrator("We use the same detector.", "author")?.text).toBe(
      "The authors use the same detector.",
    );
    // The guards that shape the class are untouched by the case: an opinion is
    // still not a claim, in either case.
    expect(resolveNarrator("We think this is fantastic.", "author")?.kind).not.toBe("claim");
  });

  it("leaves commentary to the voice refusal", () => {
    // Null, not a resolution: `publisherVoice` already refuses these and counts
    // them, and "The author reports loving this release" is not a fact.
    expect(resolveNarrator("I have to admit, I really love this release.", "author")).toBeNull();
    expect(resolveNarrator("I think this is fantastic.", "author")).toBeNull();
  });

  it("drops an ambiguous narrator instead of guessing", () => {
    // A pronoun in the reported clause points at the narrator's own sentence, and
    // a narrator clause in the middle of somebody else's sentence cannot be
    // lifted out. Both are counted drops, not silent ones.
    expect(resolveNarrator("I found that it reduced latency.", "author")).toEqual({
      kind: "ambiguous",
      text: "",
    });
    expect(resolveNarrator("We agreed a plan with the partners in Berlin.", "author")?.kind).toBe(
      "ambiguous",
    );
  });

  it("leaves third-person prose and a quotation's `I` alone", () => {
    expect(
      resolveNarrator("DigiCert doesn't see agent management as a manual problem.", "author"),
    ).toBeNull();
    // The first person is inside the quotation, so the sentence is already a
    // third-person report and rewriting it would put words in the speaker's mouth.
    expect(
      resolveNarrator(
        '"I think the whole thing is a mess," he said, describing the rollout to reporters.',
        "author",
      ),
    ).toBeNull();
  });

  it("publishes the fact the Greek prime minister story lost", () => {
    const text = composedText(
      "Most leaders on a trade mission stick to the pitch, but when I interviewed Greek Prime Minister Kyriakos Mitsotakis this week, he also admitted that no government is ready for what AI is about to do.",
    );
    expect(text).toContain("Kyriakos Mitsotakis");
    expect(text).toContain("no government is ready");
    expect(text).not.toMatch(/\bI interviewed\b/);
  });
});

describe("an editorial adverb is a wrapper only when a clause follows it", () => {
  /**
   * The rule kept a `(?=[A-Z])` lookahead under the `i` flag, and under `i` a
   * `[A-Z]` character class matches a lowercase letter too -- so "only when a
   * capitalised clause follows" was really "followed by any word", and every
   * sentence below lost its first word. The two the frozen 200-event corpus
   * actually published were "Perhaps this proposal will change that?", whose
   * `Perhaps` is the whole difference between a speculation and an assertion, and
   * "Notably, our upper bound exhibits ...".
   */
  it("keeps a hedge, because the sentence's meaning rests on it", () => {
    expect(stripEditorialVoice("Perhaps this proposal will change that?")).toEqual({
      text: "Perhaps this proposal will change that?",
      removed: false,
    });
  });

  it("keeps a single adverb in front of a lowercase continuation", () => {
    for (const sentence of [
      "Predictably irrational pricing is a problem.",
      "Notably absent was the regulator.",
      "Sadly the server died.",
      "Notably, our upper bound exhibits the famous double descent phenomenon.",
    ]) {
      expect(stripEditorialVoice(sentence)).toEqual({ text: sentence, removed: false });
    }
  });

  it("still removes one when a capitalised clause follows it", () => {
    expect(stripEditorialVoice("Perhaps This changes everything.")).toEqual({
      text: "This changes everything.",
      removed: true,
    });
  });

  it("still removes a stacked pair, which is never a fact statement", () => {
    // The production deck's sentence, and the shape the rule was written for.
    expect(
      stripEditorialVoice(
        "Perhaps predictably for a company that built its success on automated verification, DigiCert doesn't see agent management as a manual problem.",
      ),
    ).toEqual({
      text: "For a company that built its success on automated verification, DigiCert doesn't see agent management as a manual problem.",
      removed: true,
    });
  });

  it("counts a capitalised fragment as a repair, not a removal", () => {
    // 32 of the corpus's 34 counted strips were this, which is why the audit's
    // source-voice line could not be read as a count of removals.
    expect(stripEditorialVoice("v16.4.0-canary.45")).toEqual({
      text: "V16.4.0-canary.45",
      removed: false,
    });
  });

  it("hands back a sentence that was nothing but its wrapper", () => {
    expect(stripEditorialVoice("Perhaps predictably")).toEqual({
      text: "Perhaps predictably",
      removed: false,
    });
    expect(stripEditorialVoice("")).toEqual({ text: "", removed: false });
  });
});

/**
 * A document's own label, and the two rewrites it may get.
 *
 * The class this exists for is the abstract read aloud: "The paper projects:",
 * "A new paper reports:", "The authors present:" -- a colon label announcing a
 * fact, which is how a paper writes a section and how a briefing must not write
 * a sentence. Each case below is one of those, with the decoys that make the rule
 * structural rather than a word filter: a colon that introduces a list, a colon
 * with no verb in front of it, and the comma form of an attribution, which is
 * ordinary English.
 */
describe("a document's colon label is published as prose", () => {
  it("moves a clause behind the fact it was announcing", () => {
    expect(
      normalizeReportFraming(
        "The paper projects: Most of the activity consisted of automated discovery, fingerprinting, and model enumeration.",
      ),
    ).toEqual({
      text: "Most of the activity consisted of automated discovery, fingerprinting, and model enumeration, the paper projects.",
      moved: 1,
      dropped: 0,
    });
  });

  it("moves the label with the adjective in it, which is not a word filter", () => {
    expect(normalizeReportFraming("A new paper reports: 40 endpoints were exposed.")).toEqual({
      text: "40 endpoints were exposed, a new paper reports.",
      moved: 1,
      dropped: 0,
    });
    expect(
      normalizeReportFraming("The latest study estimates: revenue will double by 2027."),
    ).toEqual({
      text: "Revenue will double by 2027, the latest study estimates.",
      moved: 1,
      dropped: 0,
    });
  });

  it("takes the colon out when the verb takes an object", () => {
    // "The authors present: the first systematic study" is one sentence with a
    // colon in the middle; nothing moves and no attribution changes hands.
    expect(
      normalizeReportFraming("The authors present: the first systematic study of it."),
    ).toEqual({
      text: "The authors present the first systematic study of it.",
      moved: 0,
      dropped: 0,
    });
  });

  it("drops the frame when the fact already names its claimant", () => {
    // One attribution in front of another: "A new paper reports: The authors
    // call this loopjacking" was the deck this rule exists for.
    expect(
      normalizeReportFraming("The paper reports: the authors found 40 exposed endpoints."),
    ).toEqual({ text: "the authors found 40 exposed endpoints.", moved: 0, dropped: 1 });
  });

  it("rewrites a label that follows another sentence", () => {
    expect(
      normalizeReportFraming("The deal closed on Friday. The paper projects: revenue will double."),
    ).toEqual({
      text: "The deal closed on Friday. Revenue will double, the paper projects.",
      moved: 1,
      dropped: 0,
    });
  });

  it("leaves a colon that is not a label alone", () => {
    for (const text of [
      // A list the sentence introduces: the colon is inside the sentence, not a
      // frame in front of one.
      "The paper describes three failure modes: ordering, latency and cost.",
      // No verb, so no frame: a title and a subtitle, and a field label.
      "The study: a randomized trial of 200 patients.",
      "Results: 14 pages, 3 figures.",
      // A party to the story, not a document: this colon introduces segments.
      "The company reports three segments: cloud, devices and ads.",
      // The comma form is ordinary English and is left exactly as written.
      "According to the paper, the attack works by exploiting exposed credentials.",
    ]) {
      expect(normalizeReportFraming(text)).toEqual({ text, moved: 0, dropped: 0 });
    }
  });

  it("recognises the attribution a sentence already carries", () => {
    for (const text of [
      "Researchers also observed model management abuse against the infrastructure.",
      "The study found that the bulk of the traffic was automated.",
      "The authors present the first systematic study of it.",
      "According to the report, the market doubled.",
      "The Register reports that DigiCert doesn't see it as a manual problem.",
      // A trailing attribution counts: the composer's own moved frames.
      "Most of the activity was automated, the paper projects.",
    ])
      expect(alreadyAttributed(text), text).toBe(true);

    for (const text of [
      // A subject, not an attribution.
      "The company's servers were breached in July.",
      "The researchers were not available for comment.",
      "Most of the activity consisted of automated discovery.",
      // A named party, but nothing is reported.
      "The authors' names were removed before publication.",
    ])
      expect(alreadyAttributed(text), text).toBe(false);
  });

  it("publishes the finding, with the attribution after it", () => {
    const text = composedText(
      "The paper projects: Most of the activity consisted of automated discovery.",
    );
    expect(text).toContain("Most of the activity consisted of automated discovery");
    expect(text).toMatch(/, the paper projects\.$/);
    // The projection is still the paper's, and no label survives.
    expect(text).not.toMatch(/\b(?:paper|study|authors|researchers)\b[^.]{0,40}:\s/);
  });

  it("does not stack a second attribution on a sentence that has one", () => {
    // The deck read "According to Nature, Researchers also observed model
    // management abuse ...": two attributions on one fact, and a capital after a
    // comma. The sentence already said whose finding it was.
    const text = composedText(
      "Researchers also observed model management abuse, path traversal and prompt injection.",
      "Nature",
    );
    expect(text).not.toContain("According to Nature, Researchers");
    expect(text).toContain("Researchers also observed");
  });
});

describe("generic according-to source frames", () => {
  it.each([
    [
      "According to Krebs on Security, Army soldier was sentenced for hacking multiple companies.",
      "Krebs on Security",
    ],
    ["According to Reuters, The company expects revenue to double by 2027.", "Reuters"],
    [
      "According to The New York Times, The agency released its findings on Tuesday.",
      "The New York Times",
    ],
    ["According to the BBC, The agency opened an inquiry on Tuesday.", "BBC"],
    ["According to the paper, The attack exploits exposed credentials.", "The paper"],
    ["According to the report, The market grew by 12 percent last year.", "The report"],
    ["According to researchers, The method reduced errors in every trial.", "Researchers"],
  ])("recognizes and resolves a redundant frame for %s", (input, ownSource) => {
    const result = normalizeReportFraming(input, [ownSource]);
    expect(result.text).not.toMatch(/^According to /i);
    expect(result.dropped + result.moved).toBe(1);
    if (ownSource === "Reuters") expect(result.text).toMatch(/according to Reuters\.$/i);
  });

  it("keeps police attribution when police are not the story's source", () => {
    const input = "According to police, The suspect was arrested on Tuesday.";
    expect(normalizeReportFraming(input, ["Reuters"])).toEqual({
      text: input,
      moved: 0,
      dropped: 0,
    });
  });

  it("matches source names structurally, without treating unrelated claimants as aliases", () => {
    expect(isOwnSource("the BBC", ["BBC"])).toBe(true);
    expect(isOwnSource("Krebs on Security", ["Reuters"])).toBe(false);
    expect(isOwnSource("police", ["Police Scotland"])).toBe(false);
  });

  it("normalizes the final briefing and preserves a third-party police claim", () => {
    const redundant = composedText(
      "According to Krebs on Security, Army soldier pleaded guilty to hacking multiple telecommunications companies.",
      "Krebs on Security",
    );
    expect(redundant).not.toMatch(/According to Krebs on Security/i);
    expect(redundant).toContain("Army soldier pleaded guilty to hacking");

    const material = composedText(
      "According to police, The suspect was arrested after investigators recovered the stolen equipment.",
      "Reuters",
    );
    expect(material).toMatch(/According to police, The suspect was arrested/);
  });

  it("does not wrap an existing reporting construction a second time", () => {
    const text = composedText(
      "Krebs on Security reports that the company exposed customer records.",
      "Krebs on Security",
    );
    expect(text).toContain("Krebs on Security reports that");
    expect(text).not.toContain("Krebs on Security reports that Krebs on Security reports");
  });
});

describe("a share of respondents is a statistic", () => {
  it("recognises the shape, and only the shape", () => {
    expect(isShareStatistic("Only half could trace AI decisions back to the models.")).toBe(true);
    expect(
      isShareStatistic(
        "Three quarters of the 1,001 decision-makers said they had deployed agents.",
      ),
    ).toBe(true);
    expect(isShareStatistic("About 40 per cent reported an incident.")).toBe(true);
    expect(isShareStatistic("The company deployed four agents.")).toBe(false);
    // A count of named people is not a finding about a population.
    expect(isShareStatistic("Only three customers complained.")).toBe(false);
    expect(isShareStatistic("The company deployed four agents.")).toBe(false);
  });
});

describe("a caption pasted onto a sentence with no punctuation is cut back apart", () => {
  // The 2026-10-02 briefing's China read, stored with its image caption and a
  // subhead glued to the prose they illustrate -- no period, no comma, nothing
  // for a splitter to find.
  const surveyJoin =
    "Research has found some Chinese children prefer talking to AI over people A survey of 8,563 primary and secondary students in China in 2025, which has been widely quoted in Chinese state media, found that one in five children said they only wanted to speak with AI and not real people.";
  const quoteJoin =
    "China is trying to tackle its low birth rate \"It's plausible that when they're drafting it, the government might have in mind China's looming population crisis,\" says Qian.";

  it("splits a survey caption off the sentence it was pasted onto", () => {
    expect(captionSeamSplit(surveyJoin)).toEqual([
      "Research has found some Chinese children prefer talking to AI over people",
      "A survey of 8,563 primary and secondary students in China in 2025, which has been widely quoted in Chinese state media, found that one in five children said they only wanted to speak with AI and not real people.",
    ]);
    expect(readerSentences(surveyJoin)).toHaveLength(2);
  });

  it("splits a subhead off the quotation pasted under it", () => {
    const parts = readerSentences(quoteJoin);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("China is trying to tackle its low birth rate");
    expect(parts[1]).toMatch(/^"It's plausible/);
  });

  it("keeps speech, epithets, titles and lowercase prose whole", () => {
    // A quote handed to its verb: the verb is the speaker.
    expect(
      captionSeamSplit(
        'The audit found "It is plausible that when they are drafting it, the government might have in mind a looming crisis," says Qian.',
      ),
    ).toHaveLength(1);
    // An epithet is not reported speech, whatever follows it.
    expect(
      captionSeamSplit('The company called the report "deeply flawed," says the CEO.'),
    ).toHaveLength(1);
    // A quote after a preposition is a title, not speech.
    expect(
      captionSeamSplit(
        'The minister described the plan as "the biggest reform in the agency\'s history," says the ministry.',
      ),
    ).toHaveLength(1);
    // Lowercase prose, and a capitalised title that is no caption opener.
    expect(
      captionSeamSplit("Gartner found in a survey of 1,000 adults that spending rose."),
    ).toHaveLength(1);
    expect(
      captionSeamSplit("Ministers pointed to The Report of the Commission into banking conduct."),
    ).toHaveLength(1);
    // Nothing is cut inside a quotation.
    expect(
      captionSeamSplit('She said "the plan A survey of voters backed was never real."'),
    ).toHaveLength(1);
  });

  it("publishes both halves of a pasted caption as facts", () => {
    const { facts } = selectReaderEvidence("China restricts AI companions", [
      {
        excerpt: "Beijing has cracked down on AI chatbots that can replicate human relationships.",
        enrichedEvidence: [{ kind: "fact", text: surveyJoin }],
      },
    ]);
    expect(
      facts.some((fact) => fact.text.startsWith("Research has found some Chinese children")),
    ).toBe(true);
    expect(
      facts.some((fact) =>
        fact.text.startsWith("A survey of 8,563 primary and secondary students"),
      ),
    ).toBe(true);
  });
});

describe("`It's` is a contraction, never a possessive", () => {
  /**
   * The Epic story, 2026-10-03. The source said "It's rare for a company to pause
   * development to fix security bugs"; the gate published "Epic's rare for a
   * company to pause development", which asserts Epic is rare and drops the
   * source's actual claim. Flock and Clef were corrupted the same way.
   */
  it.each([
    [
      "Epic",
      "Epic pauses development to fix security bugs",
      "Epic says it does not have access to customers' medical data.",
      "It's rare for a company to pause development to fix security bugs.",
    ],
    [
      "Flock",
      "Flock drones deployed as first responders",
      "Flock initially gained this capability when it purchased drone firm Aerodome.",
      "It's also not the only company advertising similar services.",
    ],
    [
      "Clef",
      "Cloudflare tries to outplay Jev with open-weight Clef models",
      "Clef is still fast, and scores choices in parallel after that pass.",
      "It’s not clear what Jev’s underlying architecture is, as TypeSafe kept it secret.",
    ],
  ])(
    "leaves %s's contraction alone rather than rewriting it as a possessive",
    (name: string, title: string, first: string, second: string) => {
      const { facts } = selectReaderEvidence(title, [
        { name: "The Register", excerpt: `${first} ${second}` },
      ]);
      for (const fact of facts) {
        expect(fact.text).not.toContain(`${name}’s rare`);
        expect(fact.text).not.toContain(`${name}’s also not`);
        expect(fact.text).not.toContain(`${name}’s not clear`);
        expect(fact.text).not.toContain(`${name}'s rare`);
        expect(fact.text).not.toContain(`${name}'s also not`);
        expect(fact.text).not.toContain(`${name}'s not clear`);
      }
    },
  );

  it("still substitutes the possessive, which is what the antecedent is for", () => {
    const { facts } = selectReaderEvidence("Acme reports record revenue", [
      {
        name: "Reuters",
        excerpt:
          "Acme said the delay cost it the quarter. Its revenue still rose to $18.5 million, " +
          "the company reported to regulators. Analysts expect Acme's margins to hold.",
      },
    ]);
    expect(facts.some((fact) => fact.text.startsWith("Acme's revenue still rose"))).toBe(true);
  });
});

describe("a pronoun is only given a subject the source uses as a name", () => {
  /**
   * The corpus published `While then decides whether to retain or replace the
   * token`, `Move wasn't.`, `Read supports any AI agent or tool in building more
   * efficiently for Android`, `Key requires connecting people, processes, and
   * data in real time` and `For was used heavily by Democratic candidates`.
   * Every one of those subjects came from the *first word of the sentence
   * before*, and a sentence's first word is capitalised whether or not it names
   * anybody. The extracted entity list holds `Move` and `Read` as readily as it
   * holds `Amazon`, so membership is not a test; the source's own usage is. Each
   * of these fixtures reproduces one production shape.
   */
  it.each([
    [
      "a conjunction opening the sentence before",
      "While a causal selector combines candidate-level information extracted from both passes. " +
        "It then decides whether to retain or replace the token, thereby repairing early errors.",
      "decides whether to retain or replace the token",
    ],
    [
      "a noun the sentence before happened to start with",
      "Move 37 in game two of the five-game match looked so absurd that some called it a gift. " +
        "It was so unexpected that commentators replayed it for years, though they could not " +
        "explain how it worked.",
      "commentators replayed it for years",
    ],
    [
      "an imperative opening the sentence before",
      "Read the documentation to learn more about how the build works. " +
        "It supports any AI agent or tool in building more efficiently for Android.",
      "supports any AI agent or tool in building more efficiently",
    ],
  ])("drops the fact when the subject came from %s", (_shape, excerpt, substituted) => {
    const { facts } = selectReaderEvidence("A token repair pass ships", [
      { name: "Kabel Wire", excerpt },
    ]);
    // The pronoun's own sentence, which had no antecedent worth naming: dropped,
    // not published under whatever word happened to open the sentence before it.
    expect(facts.some((fact) => fact.text.includes(substituted))).toBe(false);
  });

  it("keeps the substitution when the source names the actor inside a sentence", () => {
    const { facts } = selectReaderEvidence("Flock wins a Fort Worth drone contract", [
      {
        name: "Kabel Wire",
        excerpt:
          "Officials said the drones arrive in Fort Worth within minutes. Fort Worth said that " +
          "the drone was the first unit to arrive during the pilot. It was also the first unit " +
          "to arrive in 76 of these calls and even allowed the automation to take over.",
      },
    ]);
    expect(facts.some((fact) => fact.text.startsWith("Fort Worth was also the first unit"))).toBe(
      true,
    );
  });
});

describe("a unit that opens inside a name is refused against its source's own text", () => {
  // TechCrunch stored "... co-led by Wellington and T. Rowe Price." as two units,
  // cut at the initial's full stop; the tail passed every local test it faced.
  const tender = "The $300 million employee tender was co-led by Wellington and T. Rowe Price.";
  const orphan =
    "Rowe Price, large institutional investors that back private companies with the intention of retaining the stock after the company goes public.";

  it("refuses the tail when the head lives in another unit", () => {
    expect(unitTextRejection(orphan, false, `Reuters reported the news. ${tender}`)).toBe(
      "invalid_sentence",
    );
  });

  it("keeps a sentence that opens with a whole name, or without the source to compare", () => {
    expect(unitTextRejection(orphan, false)).toBeNull();
    expect(
      unitTextRejection(
        "T. Rowe Price, large institutional investors, backed the tender.",
        false,
        tender,
      ),
    ).toBeNull();
  });

  it("keeps a bare surname opening a sentence", () => {
    expect(
      unitTextRejection(
        "Smith expects earnings to rise this year.",
        false,
        "The analysis came from J. Smith expects rates to fall.",
      ),
    ).toBeNull();
    expect(
      unitTextRejection(
        "Rowe Price, large institutional investors, backed the tender.",
        false,
        "Rowe Price was founded in 1937.",
      ),
    ).toBeNull();
  });
});

describe("a claim resting on nobody in particular is refused", () => {
  // "Analysts say the risk is ..." is the shape of a sourced claim with none of
  // the content: no name, nothing to check, and no source the sentence can be
  // attributed to. The composer already counts a collective noun as an
  // attribution, so without this the sentence is published believing it carries
  // provenance -- and it is the sentence a reader most often reads as a machine
  // assembling rather than a newsroom reporting.
  for (const vague of [
    "Analysts say the risk is that a background agent acts on its own spending limit.",
    "Experts warn that the rollout will be harder than it looks.",
    "Observers have called the pricing aggressive.",
    "Critics argue the change arrives too late to matter.",
    "Commentators welcomed the decision on the whole.",
    "Pundits expect the shares to move sharply.",
  ])
    expect(unitTextRejection(vague, false), vague).toBe("unverifiable_attribution");

  it("keeps an attribution that identifies who is speaking", () => {
    for (const identified of [
      "Analysts at Forrester said the market will consolidate around two vendors.",
      "Researchers at Stanford said the trial did not hold up.",
      "Three analysts at Goldman Sachs said the valuation is defensible.",
      "OpenAI said Atlas will be available to paying subscribers from February 2026.",
      "The FTC said the merger would be approved without conditions.",
      "People familiar with the matter said talks began earlier this year.",
      "Analysts covering the sector expect revenue of about $2.4 billion next year.",
    ])
      expect(unitTextRejection(identified, false), identified).not.toBe("unverifiable_attribution");
  });

  it("leaves a sentence that merely mentions the word alone", () => {
    // The rule is about who is speaking, not about a vocabulary. An article can
    // discuss analysts as a subject and still be attributable.
    for (const fine of [
      "The report surveys how analysts at three banks valued the company.",
      "Analyst coverage of the launch was thin, with only two houses publishing notes.",
    ])
      expect(unitTextRejection(fine, false), fine).not.toBe("unverifiable_attribution");
  });
});

describe("the body opens with what the thing does, not what it costs", () => {
  // Every gate in the pipeline asks "may this be published". None of them asked
  // "where does this belong", which is how a briefing could pass all of them and
  // still read as assembled: the deck said what happened, the next line gave the
  // reader subscription terms, and the sentence explaining what the product
  // actually does did not arrive until fourth. Nothing was individually broken.
  it("ranks a capability before availability, reaction and commercial detail", () => {
    const capability = "The company said Atlas can navigate pages and complete purchases.";
    const availability = "OpenAI said Atlas will be available to paying subscribers.";
    const impact = "Analysts say the risk is that a background agent acts on its own.";
    const commercial = "The company declined to say how much the agent costs to run.";

    expect(storyPosition(capability)).toBe("capability");
    expect(storyPosition(availability)).toBe("availability");
    expect(storyPosition(impact)).toBe("impact");
    expect(storyPosition(commercial)).toBe("commercial");

    expect(storyPositionRank(capability)).toBeLessThan(storyPositionRank(availability));
    expect(storyPositionRank(availability)).toBeLessThan(storyPositionRank(impact));
    expect(storyPositionRank(impact)).toBeLessThan(storyPositionRank(commercial));
  });
});

describe("the composed article opens with what the thing does", () => {
  // The unit classifier on its own proves nothing about what the reader sees.
  // This is the end-to-end version: the same story that used to render as
  // "what happened, then billing terms, then a stranger's opinion, then what it
  // does, then a cost non-answer" must now open with the capability and carry no
  // unattributed evaluation at all.
  const story = {
    id: "order",
    org: "Kabel Wire",
    title: "OpenAI launches Atlas, a browser agent that runs tasks in the background",
    what: "OpenAI on Tuesday launched Atlas, a browser agent that completes tasks in the background.",
    why: "",
    importance: "High",
    score: { relevance: 8, importance: 9, novelty: 7 },
    sources: 4,
    topics: ["tech"],
    time: "10:00",
    publishedAt: "2026-01-01T00:00:00Z",
    sourceList: [
      {
        name: "Kabel Wire",
        at: "10:00",
        headline: "OpenAI launches Atlas",
        excerpt:
          "OpenAI on Tuesday launched Atlas, a browser agent that completes tasks in the background. The company said Atlas can navigate pages, fill forms and complete purchases within a set spending limit.",
      },
      {
        name: "The Verge",
        at: "10:30",
        headline: "Atlas is for subscribers first",
        excerpt:
          "OpenAI said Atlas will be available to paying subscribers from February 2026, and that it will not train on the pages it visits.",
      },
      {
        name: "Reuters",
        at: "11:00",
        headline: "Atlas launch priced for subscribers",
        excerpt:
          "Analysts say the risk is that a background agent acting on a spending limit is a different thing from a chatbot that only suggests.",
      },
      {
        name: "Wired",
        at: "11:30",
        headline: "What Atlas costs to run",
        excerpt: "The company declined to say how much the agent costs to run.",
      },
    ],
    before: "",
    after: "",
    timeline: [],
  } as unknown as Parameters<typeof composeArticleWithDiagnostics>[0];

  const published = (): string => {
    const { article } = composeArticleWithDiagnostics(story);
    return [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
  };

  it("leads the body with the capability, not the commercial terms", () => {
    const body = composeArticleWithDiagnostics(story).article.paragraphs[0]?.text ?? "";
    expect(body).toMatch(/can navigate pages/);
  });

  it("carries no claim attributed to nobody in particular", () => {
    expect(published()).not.toMatch(/^(?:Analysts|Experts|Observers|Critics)\b/);
    expect(published()).not.toContain("Analysts say the risk");
  });

  it("keeps the reporting it did refuse to refuse", () => {
    // A rule that empties the article is not a fix, it is a different bug. The
    // capability, the availability and the cost line are all real and all stay.
    const text = published();
    expect(text).toContain("can navigate pages");
    expect(text).toContain("available to paying subscribers");
    expect(text).toContain("declined to say how much the agent costs to run");
  });
});

/**
 * A paper's own typesetting must never reach the reader.
 *
 * Measured over the 2026-10-03 corpus: 12 of the 100 stories the briefing
 * would publish carried raw markup in their published prose, every one a
 * research abstract. The rule is unit-level on purpose — a paper whose abstract
 * is four facts keeps the ones that read as prose, and the briefability floor
 * then decides whether the story still ships.
 */
describe("source markup never reaches a published block", () => {
  const story = (excerpt: string): Story => ({
    id: "s",
    org: "arXiv cs.CR",
    title: "A paper about a bound nobody outside the field will read",
    what: "The authors establish a bound on the iteration complexity of the method.",
    why: "",
    importance: "Medium",
    score: { relevance: 50, importance: 50, novelty: 50 },
    sources: 1,
    topics: [],
    time: "",
    publishedAt: "2026-10-01T00:00:00.000Z",
    sourceList: [{ name: "arXiv cs.CR", at: "", excerpt }],
    before: "",
    after: "",
    timeline: [],
  });

  it("unwraps a formatting command and publishes the sentence", () => {
    const { article } = composeArticleWithDiagnostics(
      story(
        "This report presents the \\textbf{OpenSpace Lab}'s solution to the competition. The team evaluated the approach on three separate robot platforms.",
      ),
    );
    const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(published).toContain("OpenSpace Lab's solution");
    expect(published).not.toContain("\\textbf");
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it("refuses a unit whose markup carries meaning, and keeps the story's prose", () => {
    const excerpt =
      "The authors prove the bound holds for every grid of $2^{128}$ protocol keys. A second experiment measured the same effect on real hardware last year.";
    const { article } = composeArticleWithDiagnostics(story(excerpt));
    const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)];
    expect(published.join(" ")).not.toContain("$2^{128}$");
    // The refusal is the unit's, not the story's: the prose fact still ships.
    expect(published.join(" ")).toContain("real hardware");
    // Counted where the unit is judged, which is the evidence pass rather than
    // the composer: `unitTextRejection` refuses a sentence that never becomes a
    // paragraph, so it never reaches a composer-level counter.
    const selection = selectReaderEvidence("A paper about a bound", [
      { name: "arXiv cs.CR", excerpt },
    ]);
    expect(selection.rejectionReasons.source_markup).toBe(1);
    expect(selection.facts.some((fact) => fact.text.includes("real hardware"))).toBe(true);
  });

  it("leaves a price alone", () => {
    const { article } = composeArticleWithDiagnostics(
      story(
        "Samsung's M-series televisions range from $300 to $2,300 depending on the panel size. The company said pricing would hold through the quarter.",
      ),
    );
    const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(published).toContain("$300");
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });
});

/**
 * A digest of other publications' stories is not one story.
 *
 * Measured on the frozen corpus before the rule existed: one source in 205 had
 * this shape -- MIT Technology Review's `The Download` -- and it published ten
 * unrelated stories under one title: 19 of the story's 33 published sentences
 * carried the provider's `(Outlet)` markers, 9 carried the `+` that joined
 * them, 6 of 7 paragraphs mixed items, and one sentence was stitched across a
 * headline and its elaboration. The refusal is whole because the unit is wrong,
 * not the sentences; the counterfactual measured the alternative -- the same
 * story with the source removed rendered 0 facts instead of 35, which is the
 * page the reader gets either way. The decoys are the corpus's own false
 * positives for a looser screen: acronym parentheses and prose that cites
 * outlets without the digest's separators.
 */
describe("a digest of other publications is not one story", () => {
  const digest = [
    "This is today’s edition of The Download, our weekday newsletter.",
    "1 OpenAI says rogue agents may have affected more than 100 organizations. The company is searching 50 petabytes of data for incidents. (Reuters $) + It says none of the incidents matched the Hugging Face attack. (Gizmodo) 2 A US man allegedly smuggled $300 million of Nvidia chips to China. He’s been arrested in California on federal charges. (BBC) + The chip smuggling cases expose Nvidia’s blind spots. (Bloomberg $)",
  ].join(" ");

  const story = (excerpt: string): Story => ({
    id: "digest",
    org: "MIT Technology Review",
    title: "The Download: a biological de-aging contest and why LLMs don’t reason",
    what: "Don’t be fooled—LLMs don’t reason.",
    why: "",
    importance: "High",
    score: { relevance: 8, importance: 9, novelty: 7 },
    sources: 1,
    topics: ["tech"],
    time: "10:00",
    publishedAt: "2026-10-03T00:00:00.000Z",
    sourceList: [{ name: "MIT Technology Review", at: "", headline: "The Download", excerpt }],
    before: "",
    after: "",
    timeline: [],
  });

  it("refuses the source whole, both stores, and counts the refusal", () => {
    const { sources, normalization } = normalizeReaderSources([
      {
        name: "MIT Technology Review",
        headline: "The Download",
        excerpt: digest,
        enrichedEvidence: [
          { kind: "fact", text: "(Reuters $) + It says none of the incidents matched the attack." },
        ],
      },
    ]);
    expect(normalization.refusedDigests).toBe(1);
    expect(sources[0]?.excerpt).toBeUndefined();
    expect(sources[0]?.enrichedEvidence).toBeUndefined();
  });

  it("publishes nothing of it, markers included", () => {
    const { article, diagnostics } = composeArticleWithDiagnostics(story(digest));
    expect(article.paragraphs).toEqual([]);
    expect(diagnostics.facts.rendered).toBe(0);
    expect(diagnostics.sourceNormalization.refusedDigests).toBe(1);
    const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(published).not.toMatch(/\(\s*(?:Reuters|Gizmodo|BBC)/);
  });

  it("keeps an article whose parentheses are acronyms", () => {
    const articleText =
      "Nvidia's new accelerator pairs (HBM) memory with (CPO) optics and (LTI) interconnects. The company said the part ships in 2027 and declined to give a price.";
    expect(digestSource(articleText)).toBe(false);
    const { sources, normalization } = normalizeReaderSources([
      { name: "Tom's Hardware", at: "", excerpt: articleText },
    ]);
    expect(normalization.refusedDigests).toBe(0);
    expect(sources[0]?.excerpt).toBe(articleText);
  });

  it("keeps prose that cites outlets without the digest's separators", () => {
    // Three outlet markers, no `+` runs: the markers alone are not the signature.
    const cited =
      "The report cites (Reuters), (Gizmodo) and (BBC) on the pricing question. The company declined to comment.";
    expect(digestSource(cited)).toBe(false);
    // One marker with separators is an article with arithmetic in it.
    const joined = "Two outlets (Gizmodo) and (BBC) ran the story, and the math is 2 + 2 = 4.";
    expect(digestSource(joined)).toBe(false);
  });
});

/**
 * A provider's own navigation, pasted into the middle of its article text, is
 * cut at the source boundary -- not judged headline by headline.
 *
 * Measured on the frozen corpus: two Tom's Hardware stories published six of
 * the paste's other articles' headlines ("CPU scaling with DLSS." inside a
 * story about a leaked SKU table), with zero cross-representation, and the
 * prose after the paste resumed mid-thought, which the composer then refused
 * as unresolved context. The cut costs every rendered paste sentence and no
 * other claim: Toshiba 18 rendered facts to 16, Nova Lake 21 to 16.
 */
describe("a provider's navigation paste is cut whole, not published", () => {
  const toshiba = [
    "Toshiba has spent approximately ¥60 billion ($380 million) to expand its hard drive assembly capacity in the Philippines, doubling its production capacity for nearline HDDs in fiscal 2027 compared to fiscal 2025, reports Nikkei.",
    "Tom's Hardware Premium Roadmaps    (Image credit: Future) Leading-edge foundry roadmaps.",
    "Nvidia Enterprise GPU and CPU roadmap.",
    "AMD's Enterprise GPU and CPU roadmap.",
    "Intel's roadmaps examined — 14A, Nova Lake, Diamond Rapids & AI accelerator push.",
    "Co-Packaged Optics (CPO) foundry roadmaps   .",
    "As part of the expansion, Toshiba has installed additional manufacturing lines at its Philippine Laguna Technopark facility to build nearline hard drives and prepare it to produce next-generation HDDs that increase storage capacity per drive by as much as 40%.",
  ].join(" ");

  it("cuts the labeled region and keeps the reporting on both sides of it", () => {
    const { text, strippedNavigation } = stripProviderNavigation(toshiba);
    expect(strippedNavigation).toBe(true);
    expect(text).toContain("reports Nikkei");
    expect(text).toContain("As part of the expansion");
    expect(text).not.toContain("Premium Roadmaps");
    expect(text).not.toContain("Nvidia Enterprise GPU and CPU roadmap");
    expect(text).not.toContain("foundry roadmaps");
  });

  it("cuts a paste whose first headline is glued to the label", () => {
    const novaLake = [
      "A rumored SKU table for Intel's upcoming Nova Lake desktop CPUs has surfaced, showcasing seven models that will make up Intel's initial NVL-S lineup.",
      "Go deeper with TH Premium: CPU    (Image credit: Tom's Hardware) Intel VP Robert Hallock sets Nova Lake expectations, teases return to Raptor Lake for DDR4 platforms.",
      "CPU scaling with DLSS.",
      "Intel's one-two punch plan in desktop CPUs is taking shape.",
      "Benchmarking AMD's BC-250, offering Steam Machine-like performance at half the price.",
      "As previously rumored, the table tops out at the flagship Core Ultra 9 4970K BFC, which the spec list suggests is a 28-core chip with 8 P-cores, 16 E-cores, and 4 LPE-cores.",
    ].join(" ");
    const { text, strippedNavigation } = stripProviderNavigation(novaLake);
    expect(strippedNavigation).toBe(true);
    expect(text).toContain("initial NVL-S lineup");
    expect(text).toContain("As previously rumored");
    expect(text).not.toContain("Go deeper with TH Premium");
    expect(text).not.toContain("CPU scaling with DLSS");
  });

  it("leaves prose that merely mentions navigation", () => {
    const prose =
      "The guide says Read more about the launch on its blog, and the company said the rollout begins in October with a capacity of 40% more drives.";
    expect(stripProviderNavigation(prose)).toEqual({ text: prose, strippedNavigation: false });
  });

  it("publishes neither the paste nor a fragment of it", () => {
    const story: Story = {
      id: "paste",
      org: "Tom's Hardware",
      title: "Toshiba to double HDD production capacity amid devastating shortages",
      what: "Toshiba will double its hard drive assembly capacity in the Philippines.",
      why: "",
      importance: "High",
      score: { relevance: 8, importance: 9, novelty: 7 },
      sources: 1,
      topics: ["tech"],
      time: "10:00",
      publishedAt: "2026-10-03T00:00:00.000Z",
      sourceList: [{ name: "Tom's Hardware", at: "", excerpt: toshiba }],
      before: "",
      after: "",
      timeline: [],
    } as unknown as Story;
    const { article } = composeArticleWithDiagnostics(story);
    const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(published).toContain("reports Nikkei");
    expect(published).toContain("As part of the expansion");
    expect(published).not.toContain("Nvidia Enterprise GPU and CPU roadmap");
    expect(published).not.toContain("Intel's roadmaps examined");
  });
});

/**
 * A newsletter's index of its own previous articles is not evidence.
 *
 * The provenance decides, not the typography: the rule fires only inside a
 * source whose text identifies it as a newsletter, so an ordinary article's
 * dashes and lists are untouched, and the same newsletter's essay prose --
 * sentences with subjects and verbs -- is untouched too. Measured on the
 * frozen corpus: 6 index entries refused, the whole measured population, and
 * the story keeps 8 of its 14 facts.
 */
describe("a newsletter's index of itself is not evidence", () => {
  const context =
    "Welcome back to This Week in Stratechery! Each week we send this overview of content in the bundle.";

  it("refuses the title—blurb pairs, the title list and the promo lines", () => {
    expect(
      unitTextRejection(
        "Apps, Agents, and Aggregation — Agents are the ultimate Aggregators; they reveal apps as a means, not an ends, and providing them is tech's biggest prize.",
        false,
        context,
      ),
    ).toBe("newsletter_index");
    expect(
      unitTextRejection(
        "The Strategic Stalemate Era for the US and China; Xi Welcomes American Young People; Domestic Crackdowns and Economic Concerns.",
        false,
        context,
      ),
    ).toBe("newsletter_index");
    expect(
      unitTextRejection("This week's Stratechery video is on Frontier Overhangs.", false, context),
    ).toBe("newsletter_index");
  });

  it("keeps the same shapes outside a newsletter, and the newsletter's prose", () => {
    // The identical pair, in a source that is not a newsletter: ordinary prose.
    expect(
      unitTextRejection(
        "Apps, Agents, and Aggregation — Agents are the ultimate Aggregators; they reveal apps as a means, not an ends, and providing them is tech's biggest prize.",
        false,
        "The company said the deal closes in October, and analysts agreed the price is fair.",
      ),
    ).toBeNull();
    // The front-matter essay blurb: a sentence with a subject and a verb.
    expect(
      unitTextRejection(
        "Can Meta Focus? It's risky, both as a technical person enthralled with new technology, and as an analyst in the midst of AI fervor, to claim that the next computing paradigm is truly here, but I do think that everyone will use agents, eventually. — Ben Thompson .",
        false,
        context,
      ),
    ).toBeNull();
    // Paired dashes with a lowercase head, in the same newsletter: prose.
    expect(
      unitTextRejection(
        "The company — which has three offices — said the plant will employ 400 workers.",
        false,
        context,
      ),
    ).toBeNull();
  });
});

/**
 * A subjectless instruction is addressed to the reader, not about the world.
 *
 * Measured on the frozen corpus: 19 published sentences opened on a base verb
 * with no actor, 17 of them genuine instructions published as facts ("according
 * to Android Developers"). The rule refuses them wherever they come from --
 * including a release feed's changelog, whose imperative bullets the ruling
 * judged cheaper to lose than to keep: Next.js renders 8 facts to 3, llama.cpp
 * 5 to 3, and both stories stay alive. The two prose casualties (a caption, a
 * "Put differently ..." opener) are the measured cost and are being watched.
 */
describe("an instruction is not a claim", () => {
  it("refuses documentation instructions and changelog bullets", () => {
    expect(
      unitTextRejection(
        "Implement re-authentication across device setup and cloud restores using Jetpack Credential Manager.",
        false,
        undefined,
      ),
    ).toBe("imperative_instruction");
    expect(
      unitTextRejection(
        "Use BF16 compute type for quantized models if HW allows.",
        false,
        undefined,
      ),
    ).toBe("imperative_instruction");
    expect(
      unitTextRejection(
        "Add unstable parameter matching APIs: #97393 docs: point next package security disclosure to HackerOne: #99459.",
        false,
        undefined,
      ),
    ).toBe("imperative_instruction");
  });

  it("reads the verb through the publisher's label", () => {
    // A short label pushed the imperative off position 0 and the unit published:
    // Android docs bullets ("CameraX: Replace ..."), llama.cpp changelog lines
    // ("Model: support ..."), the GitHub post's numbered tips, and the lead-in
    // forms the entity path rebuilt after the clean variants were refused
    // ("Here's where to focus: Tip #1: ..."). Measured before landing on the
    // 2026-10-03 fresh corpus: 13 units newly refused, 10 of them published or
    // selected, zero false positives on the 21 colon-labelled candidates.
    for (const text of [
      "CameraX: Replace legacy Camera1/Camera2 code with lifecycle-aware CameraX.",
      "Tip #2: Don't trust AI's first answer.",
      "Here's where to focus: Tip #1: Learn to direct AI, not just use it.",
      "For example: Issue #4821 Title: Add dark mode AI \u2713 Build implementation \u2713 Generate tests \u2713.",
    ])
      expect(unitTextRejection(text, false, undefined)).toBe("imperative_instruction");
    // The llama.cpp bullet carries a raw URL, and since the URL rule landed the
    // refusal is charged to that instead. The unit is still refused; the reason
    // names the first rule that saw it.
    expect(
      unitTextRejection(
        "Model: support nimble decision model (#29844) Website: https://llama.app.",
        false,
        undefined,
      ),
    ).toBe("invalid_sentence");
  });

  it("keeps a colon label that introduces a claim", () => {
    // The counterexample census: 17 of the 21 label-shaped candidates are real
    // claims, and a blanket "label: refuse" rule would kill them.
    for (const text of [
      "They're more like coworkers: business software that can use other software.",
      'He added: "We do not have line of sight to when supply and demand will return to balance."',
      "Here's what's launching: One place to explore logs from across Cloudflare.",
      "Investigate traces in Cloudflare: View request timelines and span details directly in the Cloudflare dashboard.",
    ])
      expect(unitTextRejection(text, false, undefined)).toBeNull();
  });

  it("cannot be evaded by the entity path's re-read of the raw excerpt", () => {
    const story = oneSource(
      "GitHub is changing how developers work. Here's where to focus: Tip #1: Learn to direct AI with GitHub, not just use it. " +
        "GitHub Copilot autocompletes code in the editor.",
      "The Verge",
    );
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    const all = [
      article.deck.text,
      ...article.paragraphs.map((paragraph) => paragraph.text),
      ...diagnostics.facts.lostFacts,
    ].join(" ");
    expect(all).not.toContain("Tip #1");
  });

  it("keeps past-tense reporting and quoted speech", () => {
    expect(
      unitTextRejection(
        "The release added unstable parameter matching APIs for the App Router.",
        false,
        undefined,
      ),
    ).toBeNull();
    expect(
      unitTextRejection('"Add salt to the pipeline," the engineer said.', false, undefined),
    ).toBeNull();
  });

  it("publishes neither the instructions nor the missing claim", () => {
    const androidDocs = [
      "Google said Android Device Streaming lets an agent drive a real device from the command line during app testing.",
      "Implement Restore Credentials: Implement re-authentication across device setup and cloud restores using Jetpack Credential Manager.",
      "Set up testing strategy: Configure unit test suites, Compose UI testing rules, and screenshot testing infrastructure.",
    ].join(" ");
    const selection = selectReaderEvidence("Device Streaming and Android skills", [
      { name: "Android Developers", excerpt: androidDocs },
    ]);
    expect(selection.rejectionReasons.imperative_instruction).toBe(2);
    expect(selection.facts.some((fact) => fact.text.includes("Device Streaming"))).toBe(true);
  });

  describe("a block cut rather than written", () => {
    it("refuses a stop-less block and one cut at a dotted abbreviation", () => {
      expect(isCutSentence("now only $199.99 at Amazon")).toBe(true);
      expect(isCutSentence("the rule was applied in violation of U.S.")).toBe(true);
    });

    it("accepts a complete sentence, a quotation, and the empty string", () => {
      expect(isCutSentence("The council approved the plan.")).toBe(false);
      expect(isCutSentence('He said "we are leaving"')).toBe(false);
      expect(isCutSentence("   ")).toBe(false);
    });

    it("Refuses a sentence a provider truncated with a terminal ellipsis", () => {
      // The arbiter's ruling of 2026-10-15. Ten of the 24 card lines the shared
      // sentence boundary refused were this shape, and it refuses them as
      // `trailing_ellipsis` while this helper -- whose contract is to drop cut
      // content -- read the final `.` of the ellipsis as a full stop. The live
      // card line is the first fixture below.
      expect(
        isCutSentence(
          "FreeType 2.15 is now available for this widely-used font rendering library used across many different operating systems and software applications...",
        ),
      ).toBe(true);
      expect(
        isCutSentence(
          "With Firefox 158 released, Firefox 159 is now in beta ahead of its official release in two weeks...",
        ),
      ).toBe(true);
      // The typographic ellipsis, which is the same truncation in a different
      // code point.
      expect(
        isCutSentence(
          "Many x86 platform driver improvements have been queuing ahead of the upcoming Linux 7.4 merge window…",
        ),
      ).toBe(true);
    });

    it("leaves a terminal full stop, exclamation and question mark alone", () => {
      expect(isCutSentence("The council approved the plan.")).toBe(false);
      expect(isCutSentence("The council approved the plan!")).toBe(false);
      expect(isCutSentence("Did the council approve the plan?")).toBe(false);
    });

    it("does not call a complete sentence cut because it contains an ellipsis", () => {
      // The ruling's own boundary: terminal only. An ellipsis the author wrote
      // inside a finished sentence is punctuation, not truncation, and the
      // sentence is published.
      expect(
        isCutSentence(
          "He paused... then finished the sentence, and the council approved the plan.",
        ),
      ).toBe(false);
      expect(
        isCutSentence("The report said the work was ongoing… and the council approved it anyway."),
      ).toBe(false);
    });
  });
});

/**
 * The development-record boundary now covers the story page too.
 *
 * `developmentRecord` was ruled for the card and the email on 2026-10-15, and the
 * composer never asked it. Measured on the frozen 200-event corpus on 2026-10-17:
 * **7 published sentences in one release story** were commit trailers or changelog
 * dumps (`Assisted-by: pi:llama.cpp/...`, `Tests: catch vanished rows in the fusion
 * baseline (#30618) ...`), three blocks of an article a reader could open. The
 * predicate moved into `unitTextRejection`, which is the boundary every surface
 * asks, so the page and the card agree by construction rather than by memory.
 */
describe("a development record is not prose, on any surface", () => {
  it("refuses commit trailers and changelog dumps", () => {
    for (const text of [
      "Assisted-by: pi:llama.cpp/ggml-org/Qwen3.8-Flash-Next-GGUF (MacBook, M5 Max, 128GB) pi: use emoji in the AI stats disclosure.",
      "Tests: catch vanished rows in the fusion baseline (#30618) tests: update the Metal fusion baseline.",
      "Signed-off-by: Jane Doe <jane@example.com>",
    ]) {
      expect(unitTextRejection(text, false), text).toBe("editorial_noise");
    }
  });

  it("keeps reporting that cites a pull request, a commit or a changelog", () => {
    // The ruling's own controls, which are what keeps the rule from eating news
    // that merely mentions code. One reference is a citation; a dump needs two.
    for (const text of [
      "The regression was fixed in pull request #30119, the maintainer said.",
      "Google released Chrome 141 on Tuesday, and its changelog lists 42 security fixes.",
      "The fix landed in commit 4f2a1b9 and ships in version 2.4 next month, the maintainer said.",
      "Currently there is a policy requirement for Linux kernel patches where AI tools contributed, they should be documented with an Assisted-by: tag, the maintainers said.",
    ]) {
      expect(unitTextRejection(text, false), text).toBeNull();
    }
  });
});

/**
 * The arbiter's 2026-10-17 ruling on dangling document references (option 4):
 * repair-first, preservation-first.
 *
 * The reader's problem is order, not vocabulary — a paragraph asks them to trust
 * "The document" one clause before saying what it is. Where the block itself names
 * the document, the name is moved in front of the reference that relies on it,
 * using the source's own words. Where nothing names it, the block is **preserved
 * and recorded**, never deleted and never withheld: the NTT story's figures are not
 * sacrificed to make a check pass.
 */
describe("a document named after the reference that relies on it", () => {
  it("moves the title in front of the definite reference", () => {
    const text = composedText(
      "The document does not specify which Russian agency developed the assessment, which is titled Analysis of Ukraine’s Energy, Housing and Utilities Sectors, includes vulnerable energy grid targets.",
    );
    expect(text).toContain(
      "The document, titled Analysis of Ukraine’s Energy, Housing and Utilities Sectors, does not specify which Russian agency developed the assessment",
    );
    // No content is dropped to achieve it: the claim after the moved clause is still there.
    expect(text).toContain("includes vulnerable energy grid targets");
  });

  it("leaves a document nothing names exactly as it is, and keeps its figures", () => {
    // The NTT case: no title anywhere in the block or the coverage, so there is
    // nothing to move. The ruling is explicit that its numbers must survive.
    const text = composedText(
      "The report models three growth trajectories through 2030 and stress-tests each against the constraints operators hit, such as land availability and water consumption.",
    );
    expect(text).toContain("The report models three growth trajectories through 2030");
    expect(text).toContain("land availability and water consumption");
  });

  it("does nothing when the page already names the document", () => {
    const text = composedText(
      "The report models three growth trajectories through 2030.",
      "The Register",
      "NTT report models three growth trajectories for data centres",
    );
    expect(text).toContain("The report models three growth trajectories");
  });

  it("is idempotent: a title already in front stays where it is", () => {
    const text = composedText(
      "The assessment, titled Analysis of Ukraine’s Energy, does not specify which agency developed it.",
    );
    expect(text).toContain("The assessment, titled Analysis of Ukraine’s Energy, does not specify");
    expect(text).not.toContain("titled titled");
  });
});
