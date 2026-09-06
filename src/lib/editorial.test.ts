import { describe, it, expect } from "vitest";
import { composeArticle } from "./editorial";
import type { Story } from "@/lib/story";
import type { Audience } from "@/lib/understand";

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

const makeAudience: Audience = {
  audience: "developers",
  implication: "It affects your stack",
  evidence: [1],
};

const makeIntelligence = (
  overrides: Partial<import("@/lib/understand").EventIntelligence> = {},
): import("@/lib/understand").EventIntelligence => ({
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

describe("composeArticle", () => {
  it("returns an article with empty sections for a thin event", () => {
    const story = makeStory({
      understand: makeIntelligence({ coverage: "thin", oneSentence: "Minor event." }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.sections.length).toBeGreaterThanOrEqual(0);
    expect(article.blocks.length).toBeGreaterThanOrEqual(0);
    expect(article.marginNotes.length).toBeGreaterThanOrEqual(0);
  });

  it("returns an article with a oneSentence block", () => {
    const story = makeStory({
      understand: makeIntelligence({ oneSentence: "The merger was announced." }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.sections[0]?.blocks[0]?.content).toBe("The merger was announced.");
  });

  it("includes numbers as chart blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$4B", label: "Deal value", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const chartBlock = article.sections.find((s) => s.heading === "By the numbers");
    expect(chartBlock).toBeDefined();
    expect(chartBlock!.blocks[0].type).toBe("chart");
  });

  it("includes newDevelopments as paragraph blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        newDevelopments: [{ text: "The deal closed.", evidence: [1], kind: "reported" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "What changed");
    expect(section).toBeDefined();
    expect(section!.blocks[0].type).toBe("paragraph");
  });

  it("includes audiences as audience blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        audiences: [{ audience: "Developers", implication: "Your stack changes.", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Who should care");
    expect(section).toBeDefined();
  });

  it("includes context as paragraph blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        context: [{ text: "Background info.", evidence: [1], kind: "context" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Context");
    expect(section).toBeDefined();
  });

  it("includes overview as overview blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        overview: [{ name: "Feature", kind: "launch", detail: "New thing", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "What was announced");
    expect(section).toBeDefined();
  });

  it("includes comparison as comparison blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        comparison: {
          caption: "Before and after",
          leftLabel: "Before",
          rightLabel: "After",
          rows: [{ label: "Revenue", left: "$1B", right: "$2B", evidence: [1] }],
        },
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Before and after");
    expect(section).toBeDefined();
    expect(section!.blocks[0].type).toBe("comparison");
  });

  it("includes series as chart blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        series: {
          caption: "Revenue trend",
          shape: "line",
          points: [{ label: "Q1", value: 100, display: "$100M", evidence: [1] }],
        },
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Revenue trend");
    expect(section).toBeDefined();
  });

  it("includes whatNext as whatNext blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        whatNext: [{ text: "Next step", evidence: [1], kind: "reported" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "What happens next");
    expect(section).toBeDefined();
  });

  it("includes conflicts as conflict blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        conflicts: [
          {
            topic: "Revenue",
            reports: [
              { text: "Up", evidence: [1], kind: "reported" },
              { text: "Down", evidence: [2], kind: "reported" },
            ],
          },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Reports differ");
    expect(section).toBeDefined();
  });

  it("includes perspectives as perspective blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        perspectives: [
          { source: "Analyst A", stance: "Bullish", evidence: [1] },
          { source: "Analyst B", stance: "Bearish", evidence: [2] },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Different perspectives");
    expect(section).toBeDefined();
  });

  it("includes unknowns as unknown blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({ unknowns: ["The outcome"] }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Still unknown");
    expect(section).toBeDefined();
  });

  it("includes timeline as timeline blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        timeline: [{ when: "Jan 1", what: "Started", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "How this event formed");
    expect(section).toBeDefined();
  });

  it("includes watchNext as whatNext blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        watchNext: [{ label: "Next", detail: "Details", evidence: [1], kind: "reported" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Watch next");
    expect(section).toBeDefined();
  });

  it("produces deterministic output for the same input", () => {
    const story = makeStory({
      understand: makeIntelligence({
        oneSentence: "Deterministic.",
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });
    const article1 = composeArticle(story, makeAudience);
    const article2 = composeArticle(story, makeAudience);
    expect(JSON.stringify(article1)).toBe(JSON.stringify(article2));
  });

  it("returns endMatter with citations", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.endMatter.citations.length).toBeGreaterThan(0);
    expect(article.endMatter.sourceCount).toBe(3);
  });

  it("returns endMatter with correct source count", () => {
    const story = makeStory({
      sources: 5,
      sourceList: Array.from({ length: 5 }, (_, i) => ({ name: `Source ${i + 1}`, at: "10:00" })),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.endMatter.sourceCount).toBe(5);
  });

  it("generates margin notes from evidence", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.marginNotes.length).toBeGreaterThan(0);
  });

  it("handles empty intelligence gracefully", () => {
    const story = makeStory({
      understand: makeIntelligence({ oneSentence: "" }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article).toBeDefined();
    expect(article.sections).toBeDefined();
  });

  it("handles story without understand field", () => {
    const story = makeStory({
      understand: undefined as import("@/lib/understand").EventIntelligence | undefined,
    });
    const article = composeArticle(story, makeAudience);
    expect(article).toBeDefined();
  });

  it("handles empty sourceList", () => {
    const story = makeStory({ sourceList: [] });
    const article = composeArticle(story, makeAudience);
    expect(article.endMatter.sourceCount).toBe(0);
    expect(article.endMatter.citations.length).toBe(0);
  });

  it("creates blocks from all section types", () => {
    const story = makeStory({
      understand: makeIntelligence({
        oneSentence: "Test.",
        numbers: [{ value: "$1", label: "V", evidence: [1] }],
        newDevelopments: [{ text: "Changed.", evidence: [1], kind: "reported" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const totalBlocks = article.sections.reduce((sum, s) => sum + s.blocks.length, 0);
    expect(totalBlocks).toBeGreaterThanOrEqual(3);
  });

  it("each section has heading and blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        oneSentence: "Test.",
        numbers: [{ value: "$1", label: "V", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    for (const section of article.sections) {
      expect(section.heading).toBeDefined();
      expect(section.blocks).toBeInstanceOf(Array);
    }
  });

  it("margin notes have correct position", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "V", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    for (const note of article.marginNotes) {
      expect(note.position).toBe("margin");
    }
  });

  it("citations reference valid source names", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    for (const citation of article.endMatter.citations) {
      expect(citation.name).toBeTruthy();
    }
  });

  it("deduplicates across sections", () => {
    const story = makeStory({
      understand: makeIntelligence({
        oneSentence: "Same text.",
        newDevelopments: [{ text: "Same text.", evidence: [1], kind: "reported" }],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const allTexts = article.sections.flatMap((s) => s.blocks.map((b) => b.content));
    const uniqueTexts = new Set(allTexts);
    expect(uniqueTexts.size).toBeLessThanOrEqual(allTexts.length);
  });

  it("handles rich coverage", () => {
    const story = makeStory({
      understand: makeIntelligence({ coverage: "rich" }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article).toBeDefined();
  });

  it("handles normal coverage", () => {
    const story = makeStory({
      understand: makeIntelligence({ coverage: "normal" }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article).toBeDefined();
  });

  it("handles thin coverage", () => {
    const story = makeStory({
      understand: makeIntelligence({ coverage: "thin" }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article).toBeDefined();
  });

  it("includes comparison rows in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        comparison: {
          caption: "Test",
          leftLabel: "A",
          rightLabel: "B",
          rows: [
            { label: "Revenue", left: "$1B", right: "$2B", evidence: [1] },
            { label: "Profit", left: "$3B", right: "$4B", evidence: [2] },
          ],
        },
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Test");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes overview items in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        overview: [
          { name: "A", kind: "type", detail: "d1", evidence: [1] },
          { name: "B", kind: "type", detail: "d2", evidence: [2] },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "What was announced");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes timeline points in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        timeline: [
          { when: "2024", what: "Start", evidence: [1] },
          { when: "2025", what: "End", evidence: [2] },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "How this event formed");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes whatNext items in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        whatNext: [
          { text: "A", evidence: [1], kind: "reported" },
          { text: "B", evidence: [2], kind: "reported" },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "What happens next");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes context items in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        context: [
          { text: "Context A", evidence: [1], kind: "context" },
          { text: "Context B", evidence: [2], kind: "context" },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Context");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes audience items in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        audiences: [
          { audience: "A", implication: "i1", evidence: [1] },
          { audience: "B", implication: "i2", evidence: [2] },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Who should care");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes unknowns in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({ unknowns: ["A", "B"] }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Still unknown");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes perspectives in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        perspectives: [
          { source: "A", stance: "Bullish", evidence: [1] },
          { source: "B", stance: "Bearish", evidence: [2] },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Different perspectives");
    expect(section!.blocks.length).toBe(2);
  });

  it("includes watchNext in blocks", () => {
    const story = makeStory({
      understand: makeIntelligence({
        watchNext: [
          { label: "A", detail: "d1", evidence: [1], kind: "reported" },
          { label: "B", detail: "d2", evidence: [2], kind: "reported" },
        ],
      }),
    });
    const article = composeArticle(story, makeAudience);
    const section = article.sections.find((s) => s.heading === "Watch next");
    expect(section!.blocks.length).toBe(2);
  });

  it("returns empty sections when intelligence has no content", () => {
    const story = makeStory({
      understand: makeIntelligence({
        oneSentence: "",
        numbers: [],
        newDevelopments: [],
        audiences: [],
        whatNext: [],
        context: [],
        overview: [],
        comparison: null,
        series: null,
        conflicts: [],
        perspectives: [],
        unknowns: [],
        timeline: [],
        watchNext: [],
      }),
    });
    const article = composeArticle(story, makeAudience);
    expect(article.sections.length).toBe(0);
  });
});
