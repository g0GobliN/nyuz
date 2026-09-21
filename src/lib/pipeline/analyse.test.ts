import { describe, expect, it } from "vitest";
import { finalizeMetadata, publisherKey, type NewsArticle, type Publisher } from "./news-signals";
import { shouldAlert } from "./alerts";
const now = new Date("2026-09-14T12:00:00Z");
const sources = new Map<string, Publisher>([
  ["bbc", { id: "bbc", name: "BBC", homepage: "https://www.bbc.com", kind: "news" }],
  [
    "bbc-sport",
    { id: "bbc-sport", name: "BBC Sport", homepage: "https://bbc.co.uk", kind: "news" },
  ],
]);
const article = (id: string, source_id = "bbc"): NewsArticle => ({
  id,
  source_id,
  title: "New community library opens to local residents",
  excerpt: "The library opened today with extended hours and a new children's reading room.",
  published_at: now.toISOString(),
  url: "https://bbc.com/news/1",
});
describe("deterministic event metadata", () => {
  it("selects natural source wording and a useful short excerpt, without prose generation", () => {
    const a = article("1");
    const m = finalizeMetadata([a], sources, now.toISOString(), now);
    expect(m.title).toBe(a.title);
    expect(a.excerpt).toContain(m.what_happened);
    expect(m).not.toHaveProperty("understand");
    expect(m).not.toHaveProperty("article");
  });
  it("stores no summary rather than the headline when there is no evidence", () => {
    // The summary is what the briefing card, the digest and a story's fallback
    // deck all read. With nothing but a headline to go on, storing the headline
    // here is what made every such story print its own title twice -- so the
    // field stays empty and the surfaces show the headline and its sources.
    const a = { ...article("1"), excerpt: null };
    expect(finalizeMetadata([a], sources, now.toISOString(), now).what_happened).toBe("");
  });
  it.each([
    ["a photo credit", "Photograph: Alexandra Topping/The Guardian."],
    ["a composite credit", "Composite: Kin Cheung/Getty Images; Tasos Katopodis/Getty"],
    ["git trailers", "Signed-off-by: khluu khluu000@gmail.com"],
    ["release labels", "Website: https://llama.app Attestations: assets"],
  ])("refuses to store %s as the event summary", (_label, excerpt) => {
    // The summary is what the briefing card, the digest and a story's fallback
    // deck all read, so furniture has to be refused at the writer. Fixing only
    // the deck would still have shipped a credit line on the card.
    const a = { ...article("1"), excerpt };
    expect(finalizeMetadata([a], sources, now.toISOString(), now).what_happened).toBe("");
  });

  it("keeps a real description as the event summary", () => {
    const a = {
      ...article("1"),
      excerpt: "The council approved the library after a two-hour debate on Tuesday.",
    };
    expect(finalizeMetadata([a], sources, now.toISOString(), now).what_happened).toContain(
      "approved the library",
    );
  });

  it("counts five articles by one publisher as one publisher", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      article(String(i), i % 2 ? "bbc" : "bbc-sport"),
    );
    const m = finalizeMetadata(many, sources, now.toISOString(), now);
    expect(m.article_count).toBe(5);
    expect(m.publisher_count).toBe(1);
    expect(m.importance).toBe(
      finalizeMetadata([many[0]!], sources, now.toISOString(), now).importance,
    );
  });
  it("uses distinct publisher breadth, not feed count", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...article(String(i), null as never),
      url: `https://publisher${i}.com/story`,
    }));
    const m = finalizeMetadata(many, sources, now.toISOString(), now);
    expect(m.publisher_count).toBe(5);
    expect(m.importance).toBeGreaterThan(
      finalizeMetadata([article("1")], sources, now.toISOString(), now).importance,
    );
  });
  it("preserves meaningful breaking qualification without treating ordinary items as emergencies", () => {
    const ordinary = finalizeMetadata([article("1")], sources, now.toISOString(), now);
    const urgent = finalizeMetadata(
      [
        {
          ...article("2"),
          title: "Major earthquake: 400 people killed, emergency declared",
          excerpt:
            "Authorities report 400 people killed in a major earthquake. Rescue operations continue.",
        },
      ],
      sources,
      now.toISOString(),
      now,
    );
    expect(shouldAlert("important", urgent.importance)).toBe(true);
    expect(shouldAlert("important", ordinary.importance)).toBe(false);
  });
  it("does not rejuvenate novelty when metadata refreshes", () => {
    expect(finalizeMetadata([article("1")], sources, "2026-09-01T12:00:00Z", now).novelty).toBe(1);
    expect(finalizeMetadata([article("1")], sources, now.toISOString(), now).novelty).toBe(7);
  });
  it("normalizes known publisher aliases", () => {
    expect(publisherKey(article("1", "bbc"), sources)).toBe(
      publisherKey(article("2", "bbc-sport"), sources),
    );
  });
});
