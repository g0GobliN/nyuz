import { describe, expect, it } from "vitest";
import { clipGraf, mailGrafs, mailWhy, storyGrafs, toGrafs } from "./article-body";
import { admissibleReaderSentence, readerSentences } from "./reader-evidence";

describe("toGrafs", () => {
  it("keeps blank-line paragraphs", () => {
    expect(toGrafs("One happened.\n\nThen another.\n\nThen a third.")).toEqual([
      "One happened.",
      "Then another.",
      "Then a third.",
    ]);
  });

  it("splits a blob into two-sentence grafs", () => {
    const grafs = toGrafs(
      "OpenAI sent a letter. The bill was SB 1047. The lab argued it would slow deployment. Industry had been quiet.",
    );
    expect(grafs.length).toBe(2);
    expect(grafs[0]).toContain("OpenAI sent a letter.");
  });
});

describe("clipGraf", () => {
  it("cuts on a sentence when the excerpt is long", () => {
    const clipped = clipGraf(
      "The lab sent a letter on Tuesday. Extra that should drop after the cap.",
      40,
    );
    expect(clipped).toBe("The lab sent a letter on Tuesday.");
  });
});

describe("storyGrafs", () => {
  it("fills a short summary with excerpts so Read has a column", () => {
    const grafs = storyGrafs({
      what: "OpenAI sent a letter to the governor opposing SB 1047.",
      before: "The bill was expected to pass without industry objection.",
      after: "The largest lab in the state is on record against it.",
      excerpts: [
        "OpenAI told lawmakers the safety bill would force the lab to pause some deployments while smaller rivals continued shipping. The letter was dated Tuesday.",
        "OpenAI told lawmakers the safety bill would force the lab to pause some deployments while smaller rivals continued shipping.",
      ],
    });
    expect(grafs.length).toBeGreaterThanOrEqual(3);
    expect(grafs.some((g) => /letter was dated Tuesday/i.test(g))).toBe(true);
  });

  it("drops near-duplicate excerpts", () => {
    const grafs = storyGrafs({
      what: "A thing happened.",
      before: "",
      after: "",
      excerpts: [
        "Same opening sentence continues here with more words about the event.",
        "Same opening sentence continues here with more words about the event.",
      ],
    });
    expect(grafs.filter((g) => /Same opening/.test(g))).toHaveLength(1);
  });
});

describe("mailGrafs", () => {
  it("keeps the first half of a long column for the inbox", () => {
    // Five genuinely different excerpts. The previous fixture reused one sentence
    // with the ordinal swapped, which only survived because this file compared
    // the first 80 characters of two strings; against the shared duplicate check
    // those five are the same sentence five times, and refusing four of them is
    // the correct answer rather than a regression.
    const excerpts = [
      "The regulator opened a consultation on the rule and asked for comments before March.",
      "Industry groups argued the timeline leaves vendors no room to test the change.",
      "Two large providers said they would pause rollout until the guidance is final.",
      "A trade body published a cost estimate that put the figure in the billions.",
      "Analysts expect the first enforcement notices to arrive late this year.",
    ];
    const all = storyGrafs({
      what: "A thing happened in two sentences here. Then another pair of sentences followed.",
      before: "Before this, the old rule still applied to everyone in the market.",
      after: "After this, the new rule is what shipping teams have to plan around.",
      excerpts,
    });
    const mail = mailGrafs({
      what: "A thing happened in two sentences here. Then another pair of sentences followed.",
      before: "Before this, the old rule still applied to everyone in the market.",
      after: "After this, the new rule is what shipping teams have to plan around.",
      excerpts,
    });
    expect(all.length).toBeGreaterThan(4);
    expect(mail).toEqual(all.slice(0, 4));
  });
});

describe("mailWhy", () => {
  it("drops a why that is the same paragraph already in the brief", () => {
    const graf = "OpenAI launched a realtime API that cuts round-trip latency.";
    expect(mailWhy(graf, [graf])).toBe("");
    expect(mailWhy("If you build voice features, the budget moved.", [graf])).toContain("voice");
  });
});

describe("the email asks the same question about a sentence as the Read page", () => {
  // The digest is a reader surface: a paying subscriber reads this in an inbox.
  // It used to assemble paragraphs from raw excerpts under its own rules -- a
  // blind pairing of sentences one and two, an 80-character prefix compare for
  // duplicates, and no furniture filter at all -- so publisher furniture and
  // the same fact three times reached the inbox while every Read-page counter
  // read zero. The email keeps its own shape; it no longer keeps its own idea of
  // what may be published.
  const WHAT =
    "OpenAI on Tuesday launched Atlas, a browser agent that completes tasks in the background. The company said Atlas can navigate pages and fill forms. The launch is limited to paying subscribers at first. Analysts say the risk is that a background agent is a different thing from a chatbot that only suggests. Reuters reported that the launch is limited to paying subscribers at first.";
  const EXCERPTS = [
    "OpenAI said Atlas will be available to paying subscribers from February 2026, and that it will not train on the pages it visits. Subscribe to The Verge for more. Principal author Jane Doe has written more than 400 articles for Reuters.",
    "Image credit: Reuters The company declined to say how much the agent costs to run. Send us your news tips at tips@example.com. Contact the editorial team at news@example.com.",
  ];

  const email = (): string[] =>
    mailGrafs({ what: WHAT, before: "", after: "", excerpts: EXCERPTS });
  const joined = (): string => email().join(" ");

  it("prints no publisher furniture", () => {
    for (const furniture of [
      "Subscribe to The Verge",
      "Principal author Jane Doe",
      "Contact the editorial team",
      "news@example.com",
      "Image credit",
    ])
      expect(joined(), furniture).not.toContain(furniture);
  });

  it("prints no bare outlet label welded to a sentence", () => {
    // "Image credit: Reuters The company declined ..." used to reach the reader
    // with the credit's payload still attached, as a byline with no verb.
    expect(joined()).not.toMatch(/\bReuters\s+The\b/);
  });

  it("prints only sentences the reader pipeline would admit", () => {
    // The invariant, rather than a list of the furniture that happens to be in
    // this fixture. An output check is a vocabulary of symptoms: today's
    // furniture is "Subscribe", tomorrow's is "Follow" or "Correction" or a paid
    // partnership. Asking the same question of every sentence the email prints
    // holds for the next publisher without anyone writing their name down.
    for (const paragraph of storyGrafs({ what: WHAT, before: "", after: "", excerpts: EXCERPTS }))
      for (const sentence of readerSentences(paragraph))
        expect(admissibleReaderSentence(sentence), sentence).toBe(true);
  });

  it("still ships the reporting, not just the refusals", () => {
    // The point of the gate is a cleaner briefing, not an empty one. A story
    // silently losing its prose would be worse than ugly prose. Asserted on the
    // full column rather than the inbox cut, because the inbox takes the first
    // four paragraphs whatever follows and that cap is its own presentation
    // choice.
    //
    // "The company declined to say how much the agent costs to run" is
    // deliberately NOT asserted. It reaches the reader welded to "Image credit:
    // Reuters", and the Read page refuses that unit too -- the email matching the
    // Read page on what to drop is the whole point, and a sentence recovered here
    // but not there would be the incoherence this change exists to remove.
    const column = storyGrafs({ what: WHAT, before: "", after: "", excerpts: EXCERPTS }).join(" ");
    expect(column).toContain("OpenAI said Atlas will be available to paying subscribers");
    expect(column.length).toBeGreaterThan(0);
  });

  it("takes at most the four paragraphs an inbox can carry", () => {
    // Presentation stays the email's own: the shape is not the shared part.
    expect(email().length).toBeLessThanOrEqual(4);
  });

  it("drops the why box only when it really repeats a paragraph", () => {
    // `mailWhy` used a 60-character substring compare, which called a
    // reworded sentence a repeat and a real repeat two different things.
    const grafs = ["The company declined to say how much the agent costs to run."];
    expect(mailWhy("The company declined to say how much the agent costs to run.", grafs)).toBe("");
    expect(
      mailWhy("Analysts say the risk is that a background agent acts on its own.", grafs),
    ).not.toBe("");
  });
});
