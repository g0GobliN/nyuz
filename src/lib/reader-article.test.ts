import { describe, it, expect } from "vitest";
import { articleMinutes, readReaderArticle } from "./reader-article";

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
