import { describe, expect, it } from "vitest";
import { isUnanalysable, readAnalysis, renderCoverage } from "./analyse";

/**
 * What the model says, and what is written down because of it.
 *
 * The rest of `analyse.ts` is a conversation with Postgres and a language model, and
 * is verified against the real database instead. These two functions are pinned here
 * because they are where being wrong is silent.
 *
 * `readAnalysis` decides what reaches a reader as a fact. Its rule is that a reply
 * missing something essential is **refused, not repaired**. That direction matters:
 * an importance quietly defaulted to 0 hides a real event from everybody whose
 * density threshold is above zero, and one defaulted to 5 is a score no model
 * produced sitting in a column the matcher trusts. Refusing costs one repeated
 * analysis of one event and says so in the output.
 *
 * `renderCoverage` decides what the model is told. Its failure mode is claiming the
 * twelve articles shown are all the coverage there was.
 */

const SLUGS = ["ai", "openai", "nvidia", "chips", "funding", "open-source"];

const reply = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "OpenAI opposes California's AI safety bill",
  what_happened: "OpenAI sent a letter to the governor opposing SB 1047.",
  before_state: "The bill was expected to pass without industry objection.",
  after_state: "The largest lab in the state is on record against it.",
  importance: 7,
  novelty: 5,
  topics: ["openai", "ai"],
  ...over,
});

describe("readAnalysis", () => {
  it("reads a well-formed reply", () => {
    const analysis = readAnalysis(reply(), SLUGS);

    expect(analysis).not.toBeNull();
    expect(analysis?.whatHappened).toBe("OpenAI sent a letter to the governor opposing SB 1047.");
    expect(analysis?.importance).toBe(7);
    expect(analysis?.novelty).toBe(5);
    expect(analysis?.topics).toEqual(["openai", "ai"]);
    expect(analysis?.unknownTopics).toEqual([]);
  });

  describe("refusing rather than repairing", () => {
    it("refuses a reply with no what_happened", () => {
      // The one field with no substitute. There is nothing to show a reader.
      expect(readAnalysis(reply({ what_happened: undefined }), SLUGS)).toBeNull();
      expect(readAnalysis(reply({ what_happened: "   " }), SLUGS)).toBeNull();
    });

    it("refuses a reply with a missing or unparseable score", () => {
      expect(readAnalysis(reply({ importance: undefined }), SLUGS)).toBeNull();
      expect(readAnalysis(reply({ novelty: null }), SLUGS)).toBeNull();
      expect(readAnalysis(reply({ importance: "high" }), SLUGS)).toBeNull();
      expect(readAnalysis(reply({ novelty: Number.NaN }), SLUGS)).toBeNull();
    });

    it("refuses anything that is not an object", () => {
      // What a model returns when it ignores the format: prose, a list, nothing.
      expect(readAnalysis("The event is about OpenAI.", SLUGS)).toBeNull();
      expect(readAnalysis([reply()], SLUGS)).toBeNull();
      expect(readAnalysis(null, SLUGS)).toBeNull();
      expect(readAnalysis(undefined, SLUGS)).toBeNull();
    });
  });

  describe("scores", () => {
    it("clamps to the range the column allows", () => {
      // `events.importance` has a `check (importance between 0 and 10)`, so an 11
      // is not a bad score, it is a failed write of an otherwise good analysis.
      expect(readAnalysis(reply({ importance: 11, novelty: -3 }), SLUGS)?.importance).toBe(10);
      expect(readAnalysis(reply({ importance: 11, novelty: -3 }), SLUGS)?.novelty).toBe(0);
    });

    it("accepts a score written as a string", () => {
      // A formatting slip by a model that got the judgement right. Paying for the
      // reasoning a second time to punish the quote marks would be absurd.
      expect(readAnalysis(reply({ importance: "8" }), SLUGS)?.importance).toBe(8);
    });

    it("keeps one decimal place and no more", () => {
      expect(readAnalysis(reply({ importance: 6.44 }), SLUGS)?.importance).toBe(6.4);
      expect(readAnalysis(reply({ importance: 6.46 }), SLUGS)?.importance).toBe(6.5);
    });

    it("keeps a genuine zero", () => {
      // Distinct from a missing score, and the two must not collapse: 0 is the
      // correct answer for a routine point release.
      expect(readAnalysis(reply({ importance: 0 }), SLUGS)?.importance).toBe(0);
    });
  });

  describe("topics", () => {
    it("drops slugs that do not exist and reports them", () => {
      // A topic nobody can subscribe to matches no reader, so inventing the row
      // would be spend with no effect. Reported because a slug the model keeps
      // reaching for is evidence the topic list is too narrow.
      const analysis = readAnalysis(reply({ topics: ["ai", "quantum", "biotech"] }), SLUGS);

      expect(analysis?.topics).toEqual(["ai"]);
      expect(analysis?.unknownTopics).toEqual(["quantum", "biotech"]);
    });

    it("normalises case and whitespace before matching", () => {
      expect(readAnalysis(reply({ topics: [" AI ", "OpenAI"] }), SLUGS)?.topics).toEqual([
        "ai",
        "openai",
      ]);
    });

    it("de-duplicates, in both lists", () => {
      // A repeat would be a duplicate row against a two-column primary key. The
      // upsert would survive it; the count of topics on the event would not.
      const analysis = readAnalysis(reply({ topics: ["ai", "ai", "nope", "nope"] }), SLUGS);

      expect(analysis?.topics).toEqual(["ai"]);
      expect(analysis?.unknownTopics).toEqual(["nope"]);
    });

    it("caps the list", () => {
      const analysis = readAnalysis(
        reply({ topics: ["ai", "openai", "nvidia", "chips", "funding", "open-source"] }),
        SLUGS,
      );

      expect(analysis?.topics).toHaveLength(5);
    });

    it("accepts objects with a slug, and ignores other shapes", () => {
      const analysis = readAnalysis(
        reply({ topics: [{ slug: "ai" }, { name: "openai" }, 7, null, ["chips"]] }),
        SLUGS,
      );

      // `{name: "openai"}` is dropped rather than guessed at: the key it used is
      // not the key it was asked for, and reading any string off any object would
      // eventually link a confidence score as a topic.
      expect(analysis?.topics).toEqual(["ai"]);
    });

    it("accepts an empty list as an answer", () => {
      // Deliberately not a failure. An event outside every topic is a real event
      // that nobody has subscribed to, and it is correct for it to reach no one.
      const analysis = readAnalysis(reply({ topics: [] }), SLUGS);

      expect(analysis).not.toBeNull();
      expect(analysis?.topics).toEqual([]);
    });

    it("survives topics that are not a list at all", () => {
      expect(readAnalysis(reply({ topics: "ai, openai" }), SLUGS)?.topics).toEqual([]);
      expect(readAnalysis(reply({ topics: undefined }), SLUGS)?.topics).toEqual([]);
    });
  });

  describe("the fields that are allowed to be absent", () => {
    it("keeps null for a before or after state the coverage did not give", () => {
      const analysis = readAnalysis(reply({ before_state: null, after_state: null }), SLUGS);

      expect(analysis?.beforeState).toBeNull();
      expect(analysis?.afterState).toBeNull();
    });

    it("reads a model's words for null as null", () => {
      // A model told to answer null in JSON routinely answers with the word
      // instead. Storing it would put "Unknown" on a story page in the position of
      // a finding, under a real headline, next to real sources.
      for (const evasion of ["null", "None", "unknown", "N/A", "Not stated", "not specified."]) {
        expect(readAnalysis(reply({ before_state: evasion }), SLUGS)?.beforeState).toBeNull();
      }
    });

    it("does not mistake real prose for an evasion", () => {
      const analysis = readAnalysis(
        { ...reply(), before_state: "No such rule existed in any US state." },
        SLUGS,
      );

      expect(analysis?.beforeState).toBe("No such rule existed in any US state.");
    });

    it("leaves the title null when the model did not give a usable one", () => {
      // Null means "keep the placeholder from clustering". An empty string would
      // replace a real headline with nothing at all.
      expect(readAnalysis(reply({ title: "" }), SLUGS)?.title).toBeNull();
      expect(readAnalysis(reply({ title: 12 }), SLUGS)?.title).toBeNull();
    });

    it("truncates an over-long title rather than refusing the analysis", () => {
      const analysis = readAnalysis(reply({ title: "x".repeat(400) }), SLUGS);

      expect(analysis?.title).toHaveLength(200);
    });
  });
});

const outlets = new Map([
  ["s1", "TechCrunch"],
  ["s2", "The Verge"],
]);

/** The shape `analyse.ts` reads out of `articles`, spelled out so the test is typed. */
type Row = {
  title: string;
  excerpt: string | null;
  published_at: string | null;
  source_id: string | null;
};

const article = (over: Partial<Row> = {}): Row => ({
  title: "OpenAI opposes SB 1047",
  excerpt: "The company wrote to the governor.",
  published_at: "2026-08-21T09:00:00.000Z",
  source_id: "s1",
  ...over,
});

describe("renderCoverage", () => {
  it("numbers the articles from one and names the outlet and date", () => {
    const rendered = renderCoverage([article(), article({ source_id: "s2" })], 2, outlets);

    expect(rendered).toContain("1. OpenAI opposes SB 1047 (TechCrunch, 2026-08-21)");
    expect(rendered).toContain("2. OpenAI opposes SB 1047 (The Verge, 2026-08-21)");
  });

  it("says how much coverage was withheld", () => {
    // The honest half of this function. Saying "12 articles" when there are 30
    // would have the model judge importance from a number that is really a cap.
    const twelve = Array.from({ length: 12 }, () => article());

    expect(renderCoverage(twelve, 30, outlets)).toContain(
      "30 articles about one event. The 12 earliest are below.",
    );
    expect(renderCoverage([article()], 1, outlets)).toContain("1 article about one event");
  });

  it("truncates a long excerpt and marks that it did", () => {
    const rendered = renderCoverage([article({ excerpt: "word ".repeat(200) })], 1, outlets);

    expect(rendered).toContain("...");
    expect(rendered.length).toBeLessThan(600);
  });

  it("collapses the whitespace feeds arrive with", () => {
    const rendered = renderCoverage([article({ excerpt: "  one\n\n  two\t three  " })], 1, outlets);

    expect(rendered).toContain("one two three");
  });

  it("omits an excerpt or a source rather than printing a gap", () => {
    const rendered = renderCoverage([article({ excerpt: null, source_id: null })], 1, outlets);

    expect(rendered).toContain("1. OpenAI opposes SB 1047 (2026-08-21)");
    expect(rendered).not.toContain("undefined");
    expect(rendered).not.toContain("null");
  });

  it("handles a source that is no longer in the list", () => {
    // A source row can be deleted while its articles remain. The prompt loses the
    // outlet name and nothing else.
    const rendered = renderCoverage([article({ source_id: "gone" })], 1, outlets);

    expect(rendered).toContain("1. OpenAI opposes SB 1047 (2026-08-21)");
  });
});

describe("isUnanalysable", () => {
  it("refuses a single-article CI ref", () => {
    expect(
      isUnanalysable(
        [{ title: "trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123: [vision hash]" }],
        1,
      ),
    ).toBe(true);
  });

  it("does not refuse a version tag, which is a real release", () => {
    expect(isUnanalysable([{ title: "v8.2.2" }], 1)).toBe(false);
  });

  it("does not refuse a real headline, or a cluster of more than one", () => {
    expect(isUnanalysable([{ title: "OpenAI opposes California's AI safety bill" }], 1)).toBe(
      false,
    );
    expect(
      isUnanalysable(
        [
          { title: "trunk/16ee93b8a9e7e2dd215a2f5d07eada25e31ec123: [vision hash]" },
          { title: "trunk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [other]" },
        ],
        2,
      ),
    ).toBe(false);
  });
});
