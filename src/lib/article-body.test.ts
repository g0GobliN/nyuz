import { describe, expect, it } from "vitest";
import { clipGraf, mailGrafs, mailWhy, storyGrafs, toGrafs } from "./article-body";

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
    const excerpts = [
      "First excerpt continues with enough words to survive the length floor here.",
      "Second excerpt continues with enough words to survive the length floor here.",
      "Third excerpt continues with enough words to survive the length floor here.",
      "Fourth excerpt continues with enough words to survive the length floor here.",
      "Fifth excerpt continues with enough words to survive the length floor here.",
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
