import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import {
  corpusSourcesFor,
  EVIDENCE_CONFIDENCE,
  linkExistingCoverage,
  mentionFilter,
  registryMentions,
} from "./seeds";

const TERMS = ["rust", "programming"];

/** Inside the corpus window. `linkExistingCoverage` measures on `fetched_at`. */
const NOW_ISO = new Date().toISOString();

function source(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    name: "Rust Programming Weekly",
    homepage: "https://rust-programming.example",
    feed_url: "https://rust-programming.example/feed",
    active: true,
    ...extra,
  };
}

describe("registryMentions", () => {
  it("accepts a source whose own name carries every term", () => {
    expect(registryMentions(source(), TERMS)).toBe(true);
    expect(registryMentions(source({ name: "Weekly Rust Programming Digest" }), TERMS)).toBe(true);
  });

  it("refuses a source that names only part of the subject", () => {
    // "Rust" alone is a language, a fungus and a game, and "Rust Blog" is a
    // perfectly good source for a one-word subject. The rule is every term, the
    // same one `classify.ts` and `match.ts` apply to an event, because a link
    // written here is a claim that this source covers *this* subject.
    expect(registryMentions(source({ name: "Rust Blog", homepage: null }), TERMS)).toBe(false);
    expect(registryMentions(source({ name: "Rust Blog", homepage: null }), ["rust"])).toBe(true);
  });

  it("reads the domain too, so a feed URL is evidence", () => {
    expect(
      registryMentions(source({ name: "Example News", homepage: "https://rust.example.org" }), [
        "rust",
      ]),
    ).toBe(true);
  });

  it("refuses when there is nothing to read", () => {
    expect(registryMentions(source({ name: "Example", homepage: null }), [])).toBe(false);
    expect(registryMentions(source({ name: "Example", homepage: null }), TERMS)).toBe(false);
  });
});

describe("corpusSourcesFor", () => {
  const articles = [
    { source_id: "s1", title: "Rust programming in 2026", excerpt: null },
    { source_id: "s1", title: "Another one", excerpt: "Rust programming again" },
    { source_id: "s2", title: "Gossip", excerpt: "Celebrities" },
    { source_id: null, title: "Rust programming somewhere", excerpt: null },
  ];

  it("returns one id per source, in first-seen order", () => {
    expect(corpusSourcesFor(articles, TERMS)).toEqual(["s1"]);
  });

  it("requires every term and reads the excerpt as well as the title", () => {
    expect(corpusSourcesFor([articles[1]!], TERMS)).toEqual(["s1"]);
    expect(corpusSourcesFor([articles[2]!], TERMS)).toEqual([]);
  });

  it("ignores articles with no source and caps what one job may link", () => {
    expect(corpusSourcesFor([articles[3]!], TERMS)).toEqual([]);

    const many = Array.from({ length: 40 }, (_, index) => ({
      source_id: `s${index}`,
      title: "Rust programming",
      excerpt: null,
    }));
    expect(corpusSourcesFor(many, TERMS, 5)).toHaveLength(5);
  });
});

describe("mentionFilter", () => {
  it("asks for any term in any column, which is a superset of the decision", () => {
    expect(mentionFilter(["title", "excerpt"], ["rust"])).toBe(
      "title.ilike.*rust*,excerpt.ilike.*rust*",
    );
  });

  it("refuses anything that could change the shape of the query", () => {
    // PostgREST parses this string itself. A comma, bracket, percent or period
    // in a term would be a filter injection rather than a search value.
    expect(mentionFilter(["title"], ["ru,st"])).toBe("");
    expect(mentionFilter(["title"], ["ru(st"])).toBe("");
    expect(mentionFilter(["title"], ["ru%st"])).toBe("");
    expect(mentionFilter(["title"], ["ru.st"])).toBe("");
    expect(mentionFilter(["title"], [])).toBe("");
    expect(mentionFilter([], ["rust"])).toBe("");
  });

  it("keeps the terms that are safe next to the ones that are not", () => {
    expect(mentionFilter(["title"], ["ru,st", "rust"])).toBe("title.ilike.*rust*");
  });
});

describe("linkExistingCoverage", () => {
  function fakeDb(seed: Record<string, unknown[]> = {}) {
    return new FakeDb({
      sources: (seed["sources"] ?? []) as Record<string, unknown>[],
      articles: (seed["articles"] ?? []) as Record<string, unknown>[],
      source_topics: (seed["source_topics"] ?? []) as Record<string, unknown>[],
    });
  }

  const topic = { id: "t1", label: "Rust programming", terms: TERMS };

  it("links a registry match without reading the corpus at all", async () => {
    const db = fakeDb({ sources: [source()], articles: [] });

    const result = await linkExistingCoverage(asDb(db), topic);

    expect(result.method).toBe("registry");
    expect(result.linked).toBe(1);
    expect(result.attempts).toEqual([{ method: "registry", considered: 1, matched: 1, linked: 1 }]);
    expect(db.rows("source_topics")).toMatchObject([
      { source_id: "s1", topic_id: "t1", confidence: EVIDENCE_CONFIDENCE },
    ]);
  });

  it("falls back to the corpus, and reports both attempts", async () => {
    const db = fakeDb({
      sources: [source({ name: "Example News", homepage: "https://example.com" })],
      articles: [
        { source_id: "s1", title: "Rust programming", excerpt: null, fetched_at: NOW_ISO },
      ],
    });

    const result = await linkExistingCoverage(asDb(db), topic);

    expect(result.method).toBe("corpus");
    expect(result.linked).toBe(1);
    expect(result.attempts.map((attempt) => attempt.method)).toEqual(["registry", "corpus"]);
  });

  it("says so, rather than guessing, when neither method matches", async () => {
    const db = fakeDb({ sources: [source({ name: "Example News", homepage: null })] });

    const result = await linkExistingCoverage(asDb(db), topic);

    expect(result.method).toBe("none");
    expect(result.linked).toBe(0);
    expect(db.rows("source_topics")).toHaveLength(0);
  });

  it("does not count or overwrite a link that already exists", async () => {
    const db = fakeDb({
      sources: [source()],
      source_topics: [{ source_id: "s1", topic_id: "t1", confidence: 1 }],
    });

    const result = await linkExistingCoverage(asDb(db), topic);

    expect(result.linked).toBe(0);
    expect(db.rows("source_topics")).toHaveLength(1);
    expect(db.rows("source_topics")[0]?.["confidence"]).toBe(1);
  });

  it("refuses an empty term list instead of matching everything", async () => {
    const db = fakeDb({ sources: [source()] });

    const result = await linkExistingCoverage(asDb(db), { ...topic, terms: [] });

    expect(result.method).toBe("none");
    expect(db.rows("source_topics")).toHaveLength(0);
  });

  it("treats a failed read as a zero, not a thrown error", async () => {
    const exploding = {
      from() {
        throw new Error("database on fire");
      },
    };

    const result = await linkExistingCoverage(exploding as never, topic);

    expect(result.linked).toBe(0);
    expect(result.method).toBe("none");
  });
});
