import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics, isShareStatistic, judgeFallbackDeck } from "./editorial";
import { htmlToText } from "./pipeline/feed";
import {
  alreadyAttributed,
  cleanDeterministicSentence,
  editorialNoise,
  hasPredicate,
  headingUnit,
  normalizeRelativeTime,
  normalizeReportFraming,
  resolveNarrator,
  sourceSeam,
  stripEditorialVoice,
  stripFrontedFrame,
  stripUnanchorableTime,
  unitTextRejection,
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

const composedText = (excerpt: string, name = "The Register"): string => {
  const { article } = composeArticleWithDiagnostics(oneSource(excerpt, name));
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
    expect(composedText(sentence)).toContain(sentence);
  });

  it("still lowers the conjunction the reported clause matched", () => {
    // What remains of the rule, and only because the branch matched the word: a
    // clause subordinate to a reporting verb cannot open with a capital, so
    // "reports that Once they were out in the wild" is ungrammatical however the
    // clause is punctuated.
    const text = composedText("Once the outage began, customers could not reach the service.");
    expect(text).toContain("reports that once the outage began");
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
    // The attribution clause goes in front and the sentence keeps its subject.
    // Its capital is kept too: `The first briefing` and `The Register` are the
    // same shape to a reader, and a rule that lowercases one lowercases the other
    // -- which is how the corpus published "all Things Considered host ...".
    expect(text).toContain(
      "According to The Register, The first briefing, which Allan did not sign, warned",
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
