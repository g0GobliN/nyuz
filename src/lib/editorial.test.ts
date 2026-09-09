import { describe, it, expect } from "vitest";
import { composeArticle } from "./editorial";
import type { Story } from "@/lib/story";
import type { EventIntelligence } from "@/lib/understand";

const makeStory = (overrides: Partial<Story> = {}): Story => ({
  id: "test-1",
  org: "Test Org",
  title: "Test Event",
  what: "Something happened",
  why: "It matters",
  importance: "High",
  score: { relevance: 8, importance: 9, novelty: 7 },
  sources: 3,
  topics: ["tech"],
  time: "10:00",
  publishedAt: "2026-01-01T00:00:00Z",
  sourceList: [
    { name: "Source One", at: "10:00", url: "https://one.com" },
    { name: "Source Two", at: "11:00", url: "https://two.com" },
    { name: "Source Three", at: "12:00", url: "https://three.com" },
  ],
  before: "",
  after: "",
  timeline: [],
  ...overrides,
});

const makeIntelligence = (overrides: Partial<EventIntelligence> = {}): EventIntelligence => ({
  version: 2,
  coverage: "normal",
  oneSentence: "A significant event occurred.",
  numbers: [],
  newDevelopments: [],
  relationships: null,
  audiences: [],
  whatNext: [],
  context: [],
  perspectives: [],
  unknowns: [],
  watchNext: [],
  timeline: [],
  conflicts: [],
  comparison: null,
  series: null,
  overview: [],
  ...overrides,
});

const bodyOf = (story: Story) =>
  composeArticle(story)
    .paragraphs.map((paragraph) => paragraph.text)
    .join("\n\n");

describe("composeArticle", () => {
  it("returns the authored article untouched when the analysis wrote one", () => {
    const article = {
      deck: { text: "The deck.", evidence: [1] },
      paragraphs: [
        { text: "The opening paragraph.", evidence: [1] },
        { text: "A later turn in the story.", evidence: [2], heading: "After the vote" },
      ],
    };
    const story = makeStory({ understand: makeIntelligence({ article }) });

    expect(composeArticle(story)).toEqual(article);
  });

  it("prefers authored prose over the extracted statements", () => {
    const story = makeStory({
      understand: makeIntelligence({
        article: {
          deck: { text: "Authored deck.", evidence: [] },
          paragraphs: [{ text: "Authored body.", evidence: [] }],
        },
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });

    expect(bodyOf(story)).toBe("Authored body.");
  });

  it("falls back to the story summary as the deck", () => {
    const story = makeStory({ what: "A summary of the event" });

    expect(composeArticle(story).deck.text).toBe("A summary of the event");
  });

  it("falls back to the one-sentence analysis when the story has no summary", () => {
    const story = makeStory({
      what: "   ",
      understand: makeIntelligence({ oneSentence: "The analysed sentence." }),
    });

    expect(composeArticle(story).deck.text).toBe("The analysed sentence.");
  });

  it("never emits analytical headings in the fallback article", () => {
    const story = makeStory({
      before: "It used to be one way",
      after: "Now it is another",
      understand: makeIntelligence({
        numbers: [{ value: "$1B", label: "Funding", evidence: [1] }],
        audiences: [{ audience: "developers", implication: "Your stack changes", evidence: [1] }],
        watchNext: [{ label: "The vote", detail: "Scheduled for March", evidence: [2] }],
      }),
    });

    for (const paragraph of composeArticle(story).paragraphs) {
      expect(paragraph.heading).toBeUndefined();
    }
  });

  it("groups related statements into paragraphs rather than one block each", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [
          { value: "$1B", label: "Funding", evidence: [1] },
          { value: "40%", label: "Growth", evidence: [2] },
        ],
      }),
    });
    const numbers = composeArticle(story).paragraphs.filter((p) => p.text.includes("Funding"));

    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.text).toContain("Growth");
  });

  it("carries the evidence of every statement it merges into a paragraph", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [
          { value: "$1B", label: "Funding", evidence: [1] },
          { value: "40%", label: "Growth", evidence: [3] },
        ],
      }),
    });
    const numbers = composeArticle(story).paragraphs.find((p) => p.text.includes("Funding"));

    expect(numbers?.evidence).toEqual([1, 3]);
  });

  it("drops statements the deck already made, and keeps their evidence on it", () => {
    const story = makeStory({
      what: "",
      understand: makeIntelligence({
        oneSentence: "The company raised money.",
        newDevelopments: [{ text: "The company raised money.", evidence: [2], kind: "reported" }],
        context: [{ text: "The company raised money.", evidence: [3], kind: "context" }],
      }),
    });
    const article = composeArticle(story);
    const mentions = article.paragraphs.filter((p) => p.text.includes("The company raised money"));

    expect(article.deck.text).toBe("The company raised money.");
    expect(article.deck.evidence).toEqual([2, 3]);
    expect(mentions).toHaveLength(0);
  });

  it("does not repeat the deck sentence in the body", () => {
    const story = makeStory({
      what: "The company raised money.",
      understand: makeIntelligence({
        oneSentence: "The company raised money.",
        context: [{ text: "Investors had waited two years.", evidence: [1], kind: "context" }],
      }),
    });

    expect(bodyOf(story)).not.toContain("The company raised money.");
    expect(bodyOf(story)).toContain("Investors had waited two years.");
  });

  it("terminates statements that arrive without punctuation", () => {
    const story = makeStory({
      what: "",
      understand: makeIntelligence({
        oneSentence: "",
        unknowns: ["Nobody has said who pays"],
      }),
    });

    expect(bodyOf(story)).toContain("Nobody has said who pays.");
  });

  it("reads a relationship map as prose rather than a diagram", () => {
    const story = makeStory({
      understand: makeIntelligence({
        relationships: {
          nodes: [
            { id: "a", label: "Meta", type: "org" },
            { id: "b", label: "Muse", type: "product" },
          ],
          edges: [{ from: "a", to: "b", label: "releases", evidence: [1] }],
        },
      }),
    });

    expect(bodyOf(story)).toContain("Meta releases Muse.");
  });

  it("keeps a conflict's competing reports together under its topic", () => {
    const story = makeStory({
      understand: makeIntelligence({
        conflicts: [
          {
            topic: "The price",
            reports: [
              { text: "One outlet reported $10", evidence: [1] },
              { text: "Another reported $12", evidence: [2] },
            ],
          },
        ],
      }),
    });
    const conflict = composeArticle(story).paragraphs.find((p) => p.text.includes("The price"));

    expect(conflict?.text).toContain("One outlet reported $10");
    expect(conflict?.text).toContain("Another reported $12");
    expect(conflict?.evidence).toEqual([1, 2]);
  });

  it("keeps an event with no analysis readable", () => {
    const article = composeArticle(makeStory({ understand: undefined as never }));

    expect(article.deck.text).toBe("Something happened");
    expect(article.paragraphs).toEqual([]);
  });

  it("returns an empty article rather than blank paragraphs for an empty event", () => {
    const article = composeArticle(
      makeStory({ what: "", understand: makeIntelligence({ oneSentence: "" }) }),
    );

    expect(article.deck.text).toBe("");
    expect(article.paragraphs).toEqual([]);
  });

  it("produces deterministic output for the same event", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });

    expect(composeArticle(story)).toEqual(composeArticle(story));
  });
});
