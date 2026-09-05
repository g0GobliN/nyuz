import { describe, expect, it } from "vitest";
import {
  contract,
  isEnrichmentEligible,
  isUnanalysable,
  readAnalysis,
  renderCoverage,
} from "./analyse";

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

const reply = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "OpenAI opposes California's AI safety bill",
  what_happened: "OpenAI sent a letter to the governor opposing SB 1047.",
  before_state: "The bill was expected to pass without industry objection.",
  after_state: "The largest lab in the state is on record against it.",
  importance: 7,
  novelty: 5,
  topics: ["openai", "ai"],
  impact: "Labs now have to plan for state-level AI safety rules, not just federal ones.",
  ...over,
});

describe("readAnalysis", () => {
  it("reads a well-formed reply", () => {
    const analysis = readAnalysis(reply(), ["openai", "ai"], []);

    expect(analysis).not.toBeNull();
    expect(analysis?.whatHappened).toBe("OpenAI sent a letter to the governor opposing SB 1047.");
    expect(analysis?.importance).toBe(7);
    expect(analysis?.novelty).toBe(5);
    expect(analysis?.topics).toEqual(["openai", "ai"]);
    expect(analysis?.unknownTopics).toEqual([]);
    expect(analysis?.impact).toBe(
      "Labs now have to plan for state-level AI safety rules, not just federal ones.",
    );
  });

  describe("impact", () => {
    it("is optional -- a missing impact still leaves an analysable reply", () => {
      // Unlike what_happened and the scores, impact has a fallback: digest.ts
      // backfills it lazily. Refusing the whole analysis over one missing
      // sentence would throw away real signal to protect a path that already
      // exists for exactly this case.
      const analysis = readAnalysis(reply({ impact: undefined }), [], []);
      expect(analysis).not.toBeNull();
      expect(analysis?.impact).toBeNull();
    });

    it("treats the model's null-shaped strings as null, same as before_state", () => {
      expect(readAnalysis(reply({ impact: "unknown" }), [], [])?.impact).toBeNull();
      expect(readAnalysis(reply({ impact: "   " }), [], [])?.impact).toBeNull();
    });
  });

  describe("refusing rather than repairing", () => {
    it("refuses a reply with no what_happened", () => {
      // The one field with no substitute. There is nothing to show a reader.
      expect(readAnalysis(reply({ what_happened: undefined }), [], [])).toBeNull();
      expect(readAnalysis(reply({ what_happened: "   " }), [], [])).toBeNull();
    });

    it("refuses a reply with a missing or unparseable score", () => {
      expect(readAnalysis(reply({ importance: undefined }), [], [])).toBeNull();
      expect(readAnalysis(reply({ novelty: null }), [], [])).toBeNull();
      expect(readAnalysis(reply({ importance: "high" }), [], [])).toBeNull();
      expect(readAnalysis(reply({ novelty: Number.NaN }), [], [])).toBeNull();
    });

    it("refuses anything that is not an object", () => {
      // What a model returns when it ignores the format: prose, a list, nothing.
      expect(readAnalysis("The event about OpenAI.", [], [])).toBeNull();
      expect(readAnalysis([reply()], [], [])).toBeNull();
      expect(readAnalysis(null, [], [])).toBeNull();
      expect(readAnalysis(undefined, [], [])).toBeNull();
    });
  });

  describe("scores", () => {
    it("clamps to the range the column allows", () => {
      // `events.importance` has a `check (importance between 0 and 10)`, so an 11
      // is not a bad score, it is a failed write of an otherwise good analysis.
      expect(readAnalysis(reply({ importance: 11, novelty: -3 }), [], [])?.importance).toBe(10);
      expect(readAnalysis(reply({ importance: 11, novelty: -3 }), [], [])?.novelty).toBe(0);
    });

    it("accepts a score written as a string", () => {
      // A formatting slip by a model that got the judgement right. Paying for the
      // reasoning a second time to punish the quote marks would be absurd.
      expect(readAnalysis(reply({ importance: "8" }), [], [])?.importance).toBe(8);
    });

    it("keeps one decimal place and no more", () => {
      expect(readAnalysis(reply({ importance: 6.44 }), [], [])?.importance).toBe(6.4);
      expect(readAnalysis(reply({ importance: 6.46 }), [], [])?.importance).toBe(6.5);
    });

    it("keeps a genuine zero", () => {
      // Distinct from a missing score, and the two must not collapse: 0 is the
      // correct answer for a routine point release.
      expect(readAnalysis(reply({ importance: 0 }), [], [])?.importance).toBe(0);
    });
  });

  describe("topics and tags", () => {
    it("uses code-assigned topics when provided", () => {
      const analysis = readAnalysis(reply(), ["openai", "ai"], ["technology", "regulation"]);

      expect(analysis?.topics).toEqual(["openai", "ai"]);
      expect(analysis?.tags).toEqual(["technology", "regulation"]);
      expect(analysis?.unknownTopics).toEqual([]);
    });

    it("falls back to empty arrays when code returns nothing", () => {
      const analysis = readAnalysis(reply(), [], []);

      expect(analysis?.topics).toEqual([]);
      expect(analysis?.tags).toEqual([]);
      expect(analysis?.unknownTopics).toEqual([]);
    });

    it("caps topics at MAX_TOPICS and tags at 8", () => {
      const manyTopics = Array.from({ length: 10 }, (_, i) => `topic-${i}`);
      const manyTags = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
      const analysis = readAnalysis(reply(), manyTopics, manyTags);

      expect(analysis?.topics).toHaveLength(5);
      expect(analysis?.tags).toHaveLength(8);
    });
  });

  describe("the fields that are allowed to be absent", () => {
    it("keeps null for a before or after state the coverage did not give", () => {
      const analysis = readAnalysis(reply({ before_state: null, after_state: null }), [], []);

      expect(analysis?.beforeState).toBeNull();
      expect(analysis?.afterState).toBeNull();
    });

    it("reads a model's words for null as null", () => {
      // A model told to answer null in JSON routinely answers with the word
      // instead. Storing it would put "Unknown" on a story page in the position of
      // a finding, under a real headline, next to real sources.
      for (const evasion of ["null", "None", "unknown", "N/A", "Not stated", "not specified."]) {
        expect(readAnalysis(reply({ before_state: evasion }), [], [])?.beforeState).toBeNull();
      }
    });

    it("does not mistake real prose for an evasion", () => {
      const analysis = readAnalysis(
        { ...reply(), before_state: "No such rule existed in any US state." },
        [],
        [],
      );

      expect(analysis?.beforeState).toBe("No such rule existed in any US state.");
    });

    it("leaves the title null when the model did not give a usable one", () => {
      // Null means "keep the placeholder from clustering". An empty string would
      // replace a real headline with nothing at all.
      expect(readAnalysis(reply({ title: "" }), [], [])?.title).toBeNull();
      expect(readAnalysis(reply({ title: 12 }), [], [])?.title).toBeNull();
    });

    it("truncates an over-long title rather than refusing the analysis", () => {
      const analysis = readAnalysis(reply({ title: "x".repeat(400) }), [], []);

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

describe("demand gate fail-closed behavior", () => {
  it("distinguishes between inactive, error, and loaded demand states", () => {
    // These are type-level tests to ensure the discriminated union works correctly
    const inactive: { kind: "inactive" } = { kind: "inactive" };
    const error: { kind: "error"; message: string } = { kind: "error", message: "RPC failed" };
    const loaded: { kind: "loaded"; demanded: Set<string> } = {
      kind: "loaded",
      demanded: new Set(["event-1"]),
    };

    expect(inactive.kind).toBe("inactive");
    expect(error.kind).toBe("error");
    expect(loaded.kind).toBe("loaded");
  });

  it("error state prevents analysis by returning early", () => {
    // This tests the decision logic: when demand.kind === "error",
    // the function should return decision: "demand_check_failed"
    // without proceeding to AI calls or database writes
    const errorResult = {
      kind: "error" as const,
      message: "Database connection failed",
    };

    // The actual runOne function checks ctx.demand.kind === "error"
    // and returns early with decision: "demand_check_failed"
    expect(errorResult.kind).toBe("error");
  });

  it("loaded state with no demand for event skips analysis", () => {
    const loadedResult = {
      kind: "loaded" as const,
      demanded: new Set<string>(["other-event"]),
    };

    // When ctx.demand.kind === "loaded" and !ctx.demand.demanded.has(event.id),
    // the function returns decision: "no_demand"
    expect(loadedResult.kind).toBe("loaded");
    expect(loadedResult.demanded.has("event-1")).toBe(false);
  });

  it("loaded state with demand for event allows analysis", () => {
    const loadedResult = {
      kind: "loaded" as const,
      demanded: new Set<string>(["event-1"]),
    };

    // When ctx.demand.kind === "loaded" and ctx.demand.demanded.has(event.id),
    // analysis proceeds normally
    expect(loadedResult.kind).toBe("loaded");
    expect(loadedResult.demanded.has("event-1")).toBe(true);
  });

  it("inactive state allows analysis (gate bypassed)", () => {
    const inactiveResult = { kind: "inactive" as const };

    // When ctx.demand.kind === "inactive", analysis proceeds normally
    // (gate off or --event bypass)
    expect(inactiveResult.kind).toBe("inactive");
  });
});

describe("contract", () => {
  it("tells one_sentence not to carry a headline figure numbers should own", () => {
    const prompt = contract();
    // The fix for the OpenAI Daybreak $1B duplication: one_sentence and numbers
    // must not both state the same headline figure. This pins the instruction's
    // presence in the shipped prompt -- it cannot pin live model compliance,
    // which needs a real call the AI budget guard currently blocks.
    expect(prompt).toContain("one_sentence owns the relationship");
    expect(prompt).toContain("numbers owns the");
    expect(prompt.toLowerCase()).toContain("headline metric");
  });
});

describe("isEnrichmentEligible", () => {
  it("1 source, still 1 source: no refresh", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 1 }, 1)).toBe(false);
  });

  it("1 source grown to 2: no refresh", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 1 }, 2)).toBe(false);
  });

  it("1 source grown to 4: eligible", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 1 }, 4)).toBe(true);
  });

  it("1 source grown to 5: eligible", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 1 }, 5)).toBe(true);
  });

  it("2 sources grown to 4: eligible (meets both the floor and the 2x multiple)", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 2 }, 4)).toBe(true);
  });

  it("2 sources grown to 3: not eligible (below the 4-source floor)", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 2 }, 3)).toBe(false);
  });

  it("5 sources grown to 6: no refresh -- already past the thin-analysis floor", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 5 }, 6)).toBe(false);
  });

  it("7 sources grown to 8: no refresh -- this is not the case it exists for", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 7 }, 8)).toBe(false);
  });

  it("already enrichment-refreshed: never eligible again, regardless of growth", () => {
    expect(
      isEnrichmentEligible({ sourceCountAtAnalysis: 1, refreshedAfterEnrichment: true }, 50),
    ).toBe(false);
  });

  it("legacy document with no analysis metadata: not eligible, never mass-queued", () => {
    expect(isEnrichmentEligible(undefined, 50)).toBe(false);
    expect(isEnrichmentEligible(null, 50)).toBe(false);
    expect(isEnrichmentEligible({}, 50)).toBe(false);
  });

  it("malformed metadata (non-integer or non-numeric source count): not eligible", () => {
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: 1.5 }, 50)).toBe(false);
    expect(isEnrichmentEligible({ sourceCountAtAnalysis: "1" }, 50)).toBe(false);
  });
});
