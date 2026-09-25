import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics, isShareStatistic } from "./editorial";
import {
  cleanDeterministicSentence,
  hasPredicate,
  normalizeRelativeTime,
  resolveNarrator,
  splitStandfirstGlue,
  stripFrontedFrame,
  stripUnanchorableTime,
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
const oneSource = (excerpt: string, name = "The Register"): Story => ({
  id: "prose-rule",
  org: name,
  title: "A story",
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

const composedText = (excerpt: string): string => {
  const { article } = composeArticleWithDiagnostics(oneSource(excerpt));
  return [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" ");
};

describe("a glued standfirst is cut only when it is unmistakably a headline", () => {
  it("refuses a label, because a label and a subject read alike in plain text", () => {
    // A no-predicate seam was tried and removed. Over the 200-event pass it made
    // fourteen cuts, and four of the six the audit printed had deleted a real
    // subject -- the first two sentences below are those cuts, the next three are
    // the labels that motivated the rule. A heading boundary is known at ingest
    // (`htmlToText` now ends one with a full stop) and unknowable in a plain-text
    // excerpt, which is where this rule runs.
    for (const text of [
      "Swedish police and the country's Post and Telecom Agency (PTS) started working more closely to combat telephone fraud in June.",
      "Extensive experiments on multiple public RSCC benchmark datasets demonstrate that the proposed method mitigates exposure bias.",
      "Pricing and availability Amazon CloudWatch Omni is now available.",
      "Engaging students with design One highlight for me was co-chairing a session.",
      "Supported frameworks and open standards The walkthrough above uses the sample project.",
    ]) {
      expect(splitStandfirstGlue(text)).toBeNull();
    }
  });

  it("leaves a subject, a clause and a quotation alone", () => {
    // Each of these is one sentence, and cutting at the capital inside it would
    // delete the subject, the verb or the speaker. The first four were real
    // corpus sentences before this rule had its guards; the fifth is the
    // production standfirst's own shape.
    for (const text of [
      "Regulators in the United States and the European Union are drafting rules next year.",
      "DeepSeek V4 and Kimi K3 achieve million-token context via completely different approaches.",
      "Only half could trace AI decisions back to the models and data that produced them.",
      "Bitcoin prices fell Bitcoin's share of the market dropped to 40 percent.",
      "When pressed if Australia would consider a US carve out, Mulino said the proposals would apply.",
      "Two years after the merger Acme closed the plant in Ohio.",
      '"But visibility into how many agents I have? How many models do I have?"',
      "Treasury committee rejects calls for fundamental reform of independent watchdog the Office for Budget Responsibility Attacks on the forecaster came from left and right.",
    ]) {
      expect(splitStandfirstGlue(text)).toBeNull();
    }
  });

  it("still cuts the wh-headline the production story opened with", () => {
    expect(
      splitStandfirstGlue(
        "Why identity built for humans breaks at agent speed Perhaps predictably for a company that built its success, DigiCert doesn't see it as a manual problem.",
      ),
    ).toBe(
      "Perhaps predictably for a company that built its success, DigiCert doesn't see it as a manual problem.",
    );
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

  it("does not hoist a subject out of its own sentence", () => {
    // "The first briefing, which Allan did not sign, warned that ..." is one
    // sentence whose first three words are its subject; hoisting them in front of
    // an attribution produced "The first briefing, The Register reports that
    // which Allan did not sign, warned ...".
    const text = composedText(
      "The first briefing, which Allan did not sign, warned that the environment had become highly challenging.",
    );
    // The attribution clause goes in front and the sentence keeps its subject,
    // lower-cased into the clause because "the" is a determiner.
    expect(text).toContain(
      "According to The Register, the first briefing, which Allan did not sign, warned",
    );
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
    expect(text).toContain("the servers still required a username and password");
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
