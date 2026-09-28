import { describe, it, expect } from "vitest";
import {
  articleMinutes,
  judgeReaderArticle,
  readReaderArticle,
  validateReaderArticleStructure,
  type ReaderArticle,
} from "./reader-article";

const deck = { text: "The deck.", evidence: [1] };

describe("readReaderArticle", () => {
  it("reads a well-formed article", () => {
    const article = readReaderArticle(
      { deck, paragraphs: [{ text: "A paragraph.", evidence: [1, 2] }] },
      2,
    );

    expect(article).toEqual({
      deck: { text: "The deck.", evidence: [1] },
      paragraphs: [{ text: "A paragraph.", evidence: [1, 2] }],
    });
  });

  it("keeps a paragraph's heading when the model wrote one", () => {
    const article = readReaderArticle(
      { deck, paragraphs: [{ text: "A turn.", evidence: [], heading: "After the vote" }] },
      1,
    );

    expect(article?.paragraphs[0]?.heading).toBe("After the vote");
  });

  it("omits heading rather than carrying the model's null through", () => {
    const article = readReaderArticle(
      { deck, paragraphs: [{ text: "A paragraph.", evidence: [], heading: null }] },
      1,
    );

    expect(article?.paragraphs[0]).not.toHaveProperty("heading");
  });

  it("collapses the whitespace a model leaves in wrapped prose", () => {
    const article = readReaderArticle(
      { deck, paragraphs: [{ text: "  One  line\n  and another. ", evidence: [] }] },
      1,
    );

    expect(article?.paragraphs[0]?.text).toBe("One line and another.");
  });

  it("accepts an article with no paragraphs beyond the deck", () => {
    expect(readReaderArticle({ deck, paragraphs: [] }, 1)).toEqual({ deck, paragraphs: [] });
  });

  it("drops citations pointing past the evidence it was given", () => {
    const article = readReaderArticle(
      { deck: { text: "The deck.", evidence: [1, 9] }, paragraphs: [] },
      2,
    );

    expect(article?.deck.evidence).toEqual([1]);
  });

  it("drops citations that are not positive integers", () => {
    const article = readReaderArticle(
      { deck: { text: "The deck.", evidence: [0, -1, 1.5, "2", null, 2] }, paragraphs: [] },
      3,
    );

    expect(article?.deck.evidence).toEqual([2]);
  });

  it("deduplicates a repeated citation", () => {
    const article = readReaderArticle(
      { deck: { text: "The deck.", evidence: [1, 1, 2] }, paragraphs: [] },
      2,
    );

    expect(article?.deck.evidence).toEqual([1, 2]);
  });

  it.each([
    ["a non-object", "article"],
    ["null", null],
    ["an array", []],
    ["a missing deck", { paragraphs: [] }],
    ["a missing paragraph list", { deck }],
    ["a paragraph list that is not an array", { deck, paragraphs: {} }],
    ["a deck with no evidence field", { deck: { text: "The deck." }, paragraphs: [] }],
    ["an empty deck", { deck: { text: "  ", evidence: [] }, paragraphs: [] }],
    ["a paragraph with no text", { deck, paragraphs: [{ evidence: [] }] }],
    ["a paragraph with no evidence field", { deck, paragraphs: [{ text: "A paragraph." }] }],
  ])("rejects %s", (_label, value) => {
    expect(readReaderArticle(value, 2)).toBeNull();
  });

  it("rejects the whole article when one paragraph is malformed", () => {
    const value = {
      deck,
      paragraphs: [{ text: "Good.", evidence: [] }, { text: "" }],
    };

    expect(readReaderArticle(value, 2)).toBeNull();
  });
});

describe("judgeReaderArticle", () => {
  const evidence = [
    {
      title: "Council approves public library",
      excerpt:
        "The council approved a new public library on Monday. The project includes a reading room and extended opening hours. Funding will come from the existing community development budget, according to the council's announcement.",
    },
  ];
  const article = (deck: string, paragraph: string): ReaderArticle => ({
    deck: { text: deck, evidence: [1] },
    paragraphs: [{ text: paragraph, evidence: [1] }],
  });

  it("accepts structurally valid legacy prose without source excerpts", () => {
    expect(
      validateReaderArticleStructure(
        article(
          "The council approved a new public library.",
          "The project includes a reading room and extended opening hours.",
        ),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects malformed legacy prose even without source excerpts", () => {
    expect(
      validateReaderArticleStructure(
        article(
          "The council approved a new public library.",
          "The Register reports that In an internal memo, the company announced a new plan.",
        ),
      ),
    ).toEqual({ ok: false, reason: "malformed_attribution" });
  });

  it("accepts readable prose grounded in its cited source", () => {
    expect(
      judgeReaderArticle(
        article(
          "The council approved a new public library on Monday.",
          "The project includes a reading room and extended opening hours.",
        ),
        "Council approves public library",
        evidence,
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    [
      "a glued attribution",
      "The Register reports that In an internal memo, the company announced a new plan.",
    ],
    ["a source-heading seam", "Navy and the British Royal Navy launched the torpedo yesterday."],
    [
      "an unresolved fragment",
      "According to the report, the was also revealed that the inquiry found failures.",
    ],
  ])("rejects %s before it can be stored", (_label, paragraphText) => {
    const result = judgeReaderArticle(
      article("The council approved a new public library.", paragraphText),
      "Council approves public library",
      evidence,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unrelated paragraph even when it cites a valid source number", () => {
    expect(
      judgeReaderArticle(
        article(
          "The council approved a new public library on Monday.",
          "Nvidia released a new graphics card for professional gaming customers worldwide.",
        ),
        "Council approves public library",
        evidence,
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
  });

  it("rejects a figure missing from the source", () => {
    expect(
      judgeReaderArticle(
        article(
          "The council approved a new public library on Monday.",
          "The project includes a reading room and cost $42 million to build.",
        ),
        "Council approves public library",
        evidence,
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
  });

  it("requires each sentence in a paragraph to cite overlapping evidence", () => {
    const result = judgeReaderArticle(
      article(
        "The council approved a new public library on Monday.",
        "The project includes a reading room and extended opening hours. Nvidia released a new graphics card for professional gaming customers worldwide.",
      ),
      "Council approves public library",
      evidence,
    );
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("articleMinutes", () => {
  it("never reports less than a minute", () => {
    expect(articleMinutes({ deck: { text: "Short.", evidence: [] }, paragraphs: [] })).toBe(1);
  });

  it("rounds a reading time up from the deck and body together", () => {
    const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");
    const article = {
      deck: { text: words(220), evidence: [] },
      paragraphs: [{ text: words(221), evidence: [] }],
    };

    expect(articleMinutes(article)).toBe(3);
  });
});
