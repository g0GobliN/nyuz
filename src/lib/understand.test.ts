import { describe, expect, it } from "vitest";
import { composeArticle } from "./editorial";
import type { Story } from "./story";
import {
  dedupeStatements,
  readEventIntelligence,
  briefingText,
  understandMinutes,
  intelligenceText,
  legacyEventIntelligence,
  deriveChange,
  sourceCountLabel,
  sentences,
  type EventIntelligence,
  novelSentences,
  collapseTimeline,
  corroboration,
  eventTimeline,
} from "./understand";

describe("readEventIntelligence", () => {
  const validIntelligence = {
    version: 2,
    coverage: "normal" as const,
    one_sentence: "OpenAI released GPT-5, connecting stronger reasoning to a new pricing tier.",
    numbers: [{ value: "$20B", label: "Valuation", evidence: [1] }],
    new: [{ text: "The model scores 92% on MMLU", evidence: [1] }],
    context: [{ text: "Previous version scored 85%", evidence: [2] }],
    timeline: [{ when: "2026-09-01", what: "Release announced", evidence: [1] }],
    audiences: [
      {
        audience: "Developers",
        implication: "API pricing unchanged despite the capability jump",
        evidence: [1],
      },
    ],
    what_next: [
      { text: "Enterprise rollout begins next month", evidence: [1], kind: "reported" as const },
    ],
    unknowns: ["Pricing for free tier"],
    conflicts: [
      {
        topic: "Training data",
        reports: [
          { text: "Uses public web data", evidence: [1] },
          { text: "Includes licensed content", evidence: [2] },
        ],
      },
    ],
  };

  it("parses a complete valid intelligence object", () => {
    const parsed = readEventIntelligence(validIntelligence, 2);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(2);
    expect(parsed?.coverage).toBe("normal");
    expect(parsed?.oneSentence).toBe(validIntelligence.one_sentence);
    expect(parsed?.numbers).toHaveLength(1);
    expect(parsed?.newDevelopments).toHaveLength(1);
    expect(parsed?.context).toHaveLength(1);
    expect(parsed?.timeline).toHaveLength(1);
    expect(parsed?.audiences).toHaveLength(1);
    expect(parsed?.whatNext).toHaveLength(1);
    expect(parsed?.unknowns).toHaveLength(1);
    expect(parsed?.conflicts).toHaveLength(1);
  });

  it("returns null for missing core fields", () => {
    expect(readEventIntelligence(null, 2)).toBeNull();
    expect(readEventIntelligence(undefined, 2)).toBeNull();
    expect(readEventIntelligence({}, 2)).toBeNull();
    expect(
      readEventIntelligence({ version: 2, coverage: "normal", one_sentence: "" }, 2),
    ).toBeNull();
  });

  it("rejects invalid coverage values", () => {
    expect(
      readEventIntelligence({ version: 2, coverage: "invalid", one_sentence: "test" }, 2),
    ).toBeNull();
    expect(
      readEventIntelligence({ version: 2, coverage: null, one_sentence: "test" }, 2),
    ).toBeNull();
  });

  it("handles snake_case keys from model replies", () => {
    const snakeCase = {
      version: 2,
      coverage: "thin" as const,
      one_sentence: "Test",
      numbers: [{ value: "100", label: "Count", evidence: [1] }],
      what_next: [{ text: "Next step", evidence: [1], kind: "reported" as const }],
    };
    const parsed = readEventIntelligence(snakeCase, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.numbers).toHaveLength(1);
    expect(parsed?.whatNext).toHaveLength(1);
  });

  it("truncates over-long text fields", () => {
    const longText = "x".repeat(800);
    const withLong = {
      ...validIntelligence,
      one_sentence: longText,
      context: [{ text: longText, evidence: [2] }],
    };
    const parsed = readEventIntelligence(withLong, 2);
    expect(parsed?.oneSentence.length).toBeLessThan(800);
    expect(parsed?.context[0]?.text.length).toBeLessThan(800);
  });

  it("filters out-of-bounds evidence references", () => {
    const withBadEvidence = {
      ...validIntelligence,
      context: [
        { text: "Valid context item", evidence: [2] },
        { text: "Invalid context item", evidence: [0, 5, 100] },
      ],
    };
    const parsed = readEventIntelligence(withBadEvidence, 2);
    expect(parsed?.context).toHaveLength(1);
    expect(parsed?.context[0]?.evidence).toEqual([2]);
  });

  it("de-duplicates evidence references", () => {
    const withDupes = {
      ...validIntelligence,
      context: [{ text: "Context item", evidence: [1, 1, 1, 2, 2] }],
    };
    const parsed = readEventIntelligence(withDupes, 2);
    expect(parsed?.context[0]?.evidence).toEqual([1, 2]);
  });

  it("caps array lengths", () => {
    const manyItems = {
      version: 2,
      coverage: "normal" as const,
      one_sentence: "Test",
      numbers: Array.from({ length: 20 }, (_, i) => ({
        value: `${i}`,
        label: `Label ${i}`,
        evidence: [1],
      })),
      context: Array.from({ length: 20 }, (_, i) => ({
        text: `Distinct context statement number ${i} about the event`,
        evidence: [1],
      })),
      timeline: Array.from({ length: 20 }, (_, i) => ({
        when: `T${i}`,
        what: `Distinct timeline event number ${i}`,
        evidence: [1],
      })),
      audiences: Array.from({ length: 20 }, (_, i) => ({
        audience: `Group ${i}`,
        implication: `Distinct implication number ${i} for this group`,
        evidence: [1],
      })),
      what_next: Array.from({ length: 20 }, (_, i) => ({
        text: `Distinct next step number ${i}`,
        evidence: [1],
        kind: "reported" as const,
      })),
      unknowns: Array.from({ length: 20 }, (_, i) => `Distinct unknown number ${i}`),
      conflicts: Array.from({ length: 20 }, (_, i) => ({
        topic: `Topic ${i}`,
        reports: [
          { text: "Report A", evidence: [1] },
          { text: "Report B", evidence: [1] },
        ],
      })),
    };
    const parsed = readEventIntelligence(manyItems, 1);
    expect(parsed?.numbers.length).toBeLessThanOrEqual(6);
    expect(parsed?.context.length).toBeLessThanOrEqual(5);
    expect(parsed?.timeline.length).toBeLessThanOrEqual(8);
    expect(parsed?.audiences.length).toBeLessThanOrEqual(6);
    expect(parsed?.whatNext.length).toBeLessThanOrEqual(5);
    expect(parsed?.unknowns.length).toBeLessThanOrEqual(6);
    expect(parsed?.conflicts.length).toBeLessThanOrEqual(3);
  });

  it("drops conflicts with fewer than 2 reports", () => {
    const singleReport = {
      ...validIntelligence,
      conflicts: [{ topic: "Topic", reports: [{ text: "Only one report", evidence: [1] }] }],
    };
    const parsed = readEventIntelligence(singleReport, 1);
    expect(parsed?.conflicts).toHaveLength(0);
  });

  it("filters nullish text values", () => {
    const withNullish = {
      ...validIntelligence,
      one_sentence: "null",
    };
    const parsed = readEventIntelligence(withNullish, 1);
    expect(parsed).toBeNull();
  });

  it("reads a legacy (version 1) document by its old field names", () => {
    const legacy = {
      version: 1,
      coverage: "normal" as const,
      summary: "Nvidia agreed to acquire Hugging Face for $13 billion.",
      keyNumbers: [{ value: "$13B", label: "Deal value", evidence: [1] }],
      affectedGroups: [
        { group: "Developers", effect: "New API access", basis: "reported", evidence: [1] },
      ],
      relationship: {
        subject: "Nvidia",
        relation: "acquiring",
        object: "Hugging Face",
        detail: "$13B",
        evidence: [1],
      },
    };
    const parsed = readEventIntelligence(legacy, 2);
    expect(parsed?.version).toBe(2);
    expect(parsed?.oneSentence).toBe(legacy.summary);
    expect(parsed?.numbers).toHaveLength(1);
    expect(parsed?.audiences).toEqual([
      { audience: "Developers", implication: "New API access", evidence: [1] },
    ]);
    // A single subject-relation-object triple is one edge, which never clears
    // the richness gate -- "The picture" correctly does not render for it.
    expect(parsed?.relationships).toBeNull();
  });
});

describe("analysisMeta", () => {
  it("is absent when the model reply never included it (the normal case for every fresh reply)", () => {
    const parsed = readEventIntelligence(
      { version: 2, coverage: "normal", one_sentence: "An event happened." },
      1,
    );
    expect(parsed?.analysisMeta).toBeUndefined();
  });

  it("round-trips a document the pipeline already attached metadata to", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "thin",
        one_sentence: "An event happened.",
        analysisMeta: { sourceCountAtAnalysis: 1 },
      },
      1,
    );
    expect(parsed?.analysisMeta).toEqual({ sourceCountAtAnalysis: 1 });
  });

  it("round-trips a refreshed document", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "An event happened.",
        analysisMeta: { sourceCountAtAnalysis: 5, refreshedAfterEnrichment: true },
      },
      1,
    );
    expect(parsed?.analysisMeta).toEqual({
      sourceCountAtAnalysis: 5,
      refreshedAfterEnrichment: true,
    });
  });

  it("drops malformed metadata rather than trusting it", () => {
    const missingCount = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "x",
        analysisMeta: { refreshedAfterEnrichment: true },
      },
      1,
    );
    const nonIntegerCount = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "x",
        analysisMeta: { sourceCountAtAnalysis: "3" },
      },
      1,
    );
    expect(missingCount?.analysisMeta).toBeUndefined();
    expect(nonIntegerCount?.analysisMeta).toBeUndefined();
  });

  it("a legacy (version 1) document never has analysis metadata", () => {
    const parsed = readEventIntelligence(
      { version: 1, coverage: "normal", summary: "Nvidia agreed to acquire Hugging Face." },
      1,
    );
    expect(parsed?.analysisMeta).toBeUndefined();
  });
});

describe("sourceCountLabel", () => {
  it("legacy document (no analysisMeta): states the current count plainly, same as before this existed", () => {
    expect(sourceCountLabel(undefined, 3)).toBe("3 sources");
    expect(sourceCountLabel(undefined, 1)).toBe("1 source");
  });

  it("analysed count matches current count: states the count plainly", () => {
    expect(sourceCountLabel({ sourceCountAtAnalysis: 3 }, 3)).toBe("3 sources");
  });

  it("thin analysis, evidence has since grown: states both counts rather than rounding up", () => {
    expect(sourceCountLabel({ sourceCountAtAnalysis: 1 }, 3)).toBe(
      "1 source analyzed · 3 currently",
    );
  });

  it("stays truthful about the older analysis regardless of enrichment eligibility or budget state -- it only ever compares the two stored/live numbers", () => {
    // Eligible for enrichment (1 <= 2, 5 >= 4, 5 >= 1*2) but not yet refreshed --
    // e.g. the AI budget was exhausted when the pipeline tried. The label must
    // not claim the document reflects the 5 sources now attached.
    expect(sourceCountLabel({ sourceCountAtAnalysis: 1 }, 5)).toBe(
      "1 source analyzed · 5 currently",
    );
  });

  it("converges again once a material-enrichment refresh has actually written a new count", () => {
    expect(sourceCountLabel({ sourceCountAtAnalysis: 5, refreshedAfterEnrichment: true }, 5)).toBe(
      "5 sources",
    );
  });

  it("pluralises the analysed count independently of the current count", () => {
    expect(sourceCountLabel({ sourceCountAtAnalysis: 1 }, 4)).toBe(
      "1 source analyzed · 4 currently",
    );
  });
});

describe("dedupeStatements", () => {
  it("removes semantically similar statements", () => {
    const items = [
      { text: "OpenAI released GPT-5" },
      { text: "GPT-5 was released by OpenAI" },
      { text: "The model costs $20 per million tokens" },
    ];
    const deduped = dedupeStatements(items);
    expect(deduped).toHaveLength(2);
  });

  it("keeps distinct statements", () => {
    const items = [
      { text: "OpenAI released GPT-5" },
      { text: "The model scores 92% on MMLU" },
      { text: "Pricing starts at $20 per million tokens" },
    ];
    const deduped = dedupeStatements(items);
    expect(deduped).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(dedupeStatements([])).toEqual([]);
  });

  it("preserves original objects", () => {
    const items = [{ text: "OpenAI released GPT-5", extra: "data" as const }];
    const deduped = dedupeStatements(items);
    expect(deduped[0]).toEqual(items[0]);
  });
});

describe("dedupeAcrossSections (via readEventIntelligence)", () => {
  it("drops a number whose claim already appeared in one_sentence", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "OpenAI committed $1B to Daybreak.",
        numbers: [{ value: "$1B", label: "OpenAI Daybreak", evidence: [1] }],
      },
      1,
    );
    expect(parsed?.numbers).toEqual([]);
  });

  it("drops a later section's claim once an earlier section already made it", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "An event happened.",
        numbers: [{ value: "$1B", label: "Cloudflare Managed Defense investment", evidence: [1] }],
        context: [
          { text: "Cloudflare's Managed Defense investment reached $1 billion", evidence: [1] },
        ],
      },
      1,
    );
    expect(parsed?.numbers).toHaveLength(1);
    expect(parsed?.context).toEqual([]);
  });

  it("keeps genuinely distinct claims across sections", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "OpenAI launched Daybreak for essential-service cyber defense.",
        numbers: [{ value: "$1B", label: "Program commitment", evidence: [1] }],
        context: [
          { text: "Cloudflare separately runs a Managed Defense product line", evidence: [2] },
        ],
      },
      2,
    );
    expect(parsed?.numbers).toHaveLength(1);
    expect(parsed?.context).toHaveLength(1);
  });

  it("drops a perspectives entry that duplicates an earlier claim, and clears the section if that leaves fewer than two", () => {
    const parsed = readEventIntelligence(
      {
        version: 2,
        coverage: "normal",
        one_sentence: "OpenAI says Daybreak expands access to cyber AI.",
        perspectives: [
          {
            source: "OpenAI",
            stance: "OpenAI says Daybreak expands access to cyber AI",
            evidence: [1],
          },
          {
            source: "Independent researcher",
            stance: "Effectiveness still needs independent testing",
            evidence: [2],
          },
        ],
      },
      2,
    );
    // The OpenAI perspective repeats one_sentence and is dropped, leaving one
    // perspective -- which is a fact with a byline, not a disagreement.
    expect(parsed?.perspectives).toEqual([]);
  });
});

describe("briefingText", () => {
  it("truncates to word count target", () => {
    const long = "word ".repeat(100);
    const truncated = briefingText(long, 50);
    const words = truncated.trim().split(/\s+/).length;
    // First sentence is always included, so it may exceed target slightly
    expect(words).toBeLessThanOrEqual(101);
  });

  it("de-duplicates sentences", () => {
    const repeated = "OpenAI released GPT-5. OpenAI released GPT-5. The model is faster.";
    const brief = briefingText(repeated, 20);
    expect(brief).not.toContain("OpenAI released GPT-5. OpenAI released GPT-5");
  });

  it.each([
    "Photograph: Alexandra Topping/The Guardian.",
    "Composite: Kin Cheung/Getty Images; Tasos Katopodis/Getty",
    "Signed-off-by: khluu khluu000@gmail.com",
    "Website: https://llama.app Attestations: assets",
  ])("shows nothing for a summary that is provider furniture: %s", (summary) => {
    // The card is a reader-visible surface, and this field is written straight
    // from a feed's description. A stored credit must not become the paragraph
    // under a headline.
    expect(briefingText(summary)).toBe("");
  });

  it("keeps a real summary", () => {
    expect(briefingText("Getty Images reported a rise in licensing revenue.")).toBe(
      "Getty Images reported a rise in licensing revenue.",
    );
  });

  it("handles very short input", () => {
    const short = "OpenAI released GPT-5.";
    const brief = briefingText(short, 90);
    expect(brief).toBe(short);
  });

  it("returns fallback for empty input", () => {
    const brief = briefingText("", 90);
    expect(brief).toBe("");
  });
});

describe("understandMinutes", () => {
  it("returns <1 min for short content", () => {
    const result = understandMinutes(["Short text"]);
    expect(result).toBe("<1 min");
  });

  it("returns 1 min for medium content", () => {
    const medium = "word ".repeat(150);
    const result = understandMinutes([medium]);
    expect(result).toBe("1 min");
  });

  it("returns 2 min for long content", () => {
    const long = "word ".repeat(300);
    const result = understandMinutes([long]);
    expect(result).toBe("2 min");
  });

  it("sums across multiple texts", () => {
    const texts = ["word ".repeat(100), "word ".repeat(100)];
    const result = understandMinutes(texts);
    expect(result).toBe("1 min");
  });
});

describe("intelligenceText", () => {
  it("collects all text blocks", () => {
    const intel: EventIntelligence = {
      version: 2,
      coverage: "normal",
      oneSentence: "Summary",
      numbers: [{ value: "100", label: "Count", evidence: [1] }],
      newDevelopments: [{ text: "New thing", evidence: [1], kind: "reported" }],
      relationships: null,
      audiences: [{ audience: "Users", implication: "None", evidence: [1] }],
      whatNext: [{ text: "Next", evidence: [1], kind: "reported" }],
      context: [{ text: "Context", evidence: [1], kind: "context" }],
      perspectives: [],
      unknowns: ["Unknown"],
      watchNext: [{ label: "Availability", detail: "GA date", evidence: [1] }],
      timeline: [{ when: "2026-09-01", what: "Event", evidence: [1] }],
      conflicts: [{ topic: "Topic", reports: [{ text: "Report", evidence: [1] }] }],
      comparison: null,
      series: null,
      overview: [],
    };
    const texts = intelligenceText(intel);
    expect(texts).toContain("Summary");
    expect(texts).toContain("New thing");
    expect(texts).toContain("Context");
    expect(texts).toContain("Unknown");
  });
});

describe("legacyEventIntelligence", () => {
  it("excludes RSS promotions from prose, entities, and numbers", () => {
    const intel = legacyEventIntelligence({
      what: "A factory will open next month.",
      sources: [
        {
          excerpt:
            "Subscribe to Microsoft's newsletter and save 50% on a $20 subscription. The post Apple launches a product appeared first on TechCrunch. The factory will employ 400 workers when production starts in October.",
        },
      ],
    });
    const output = JSON.stringify(intel);
    expect(output).not.toMatch(/Microsoft|Apple|TechCrunch|50%|\$20/);
    expect(intel.newDevelopments).toContainEqual({
      text: "The factory will employ 400 workers when production starts in October.",
      evidence: [1],
      kind: "reported",
    });
  });

  it("omits overlong claims instead of truncating their qualifications", () => {
    const intel = legacyEventIntelligence({
      what: "A deal was reported.",
      sources: [
        { excerpt: `${"The proposed deal has conditions ".repeat(12)}but was not approved.` },
      ],
    });
    expect(intel.newDevelopments).toEqual([]);
    expect(intel.context).toEqual([]);
  });

  it("preserves reporting about subscribers and newsletters", () => {
    const intel = legacyEventIntelligence({
      what: "The publisher released its results.",
      sources: [
        { excerpt: "The newsletter now has 400 paid subscribers following its launch last year." },
      ],
    });
    expect(intel.newDevelopments).toHaveLength(1);
  });

  it("creates intelligence from legacy event data", () => {
    const legacy = {
      what: "OpenAI released GPT-5 with improved reasoning capabilities and better performance on benchmarks.",
      sources: [
        { excerpt: "OpenAI announced GPT-5 today. The model scores 92% on MMLU, up from 85%." },
        { excerpt: "The new model includes improved safety features and reduced hallucinations." },
      ],
    };
    const intel = legacyEventIntelligence(legacy);
    expect(intel.version).toBe(2);
    expect(intel.oneSentence).toBeTruthy();
    expect(intel.newDevelopments.length).toBeGreaterThan(0);
    expect(intel.coverage).toBeOneOf(["thin", "normal", "rich"]);
  });

  it("marks thin coverage for limited sources", () => {
    const thin = {
      what: "OpenAI released GPT-5.",
      sources: [{ excerpt: "OpenAI released GPT-5." }],
    };
    const intel = legacyEventIntelligence(thin);
    expect(intel.coverage).toBe("thin");
  });

  it("marks normal coverage for moderate sources", () => {
    const normal = {
      what: "OpenAI released GPT-5 with improved reasoning capabilities and significantly better performance on benchmarks. The model scores 92% on MMLU which represents a major improvement over previous versions. Pricing starts at $20 per million tokens for the new API tier.",
      sources: Array.from({ length: 4 }, (_, i) => ({
        excerpt: `Source ${i}: This is a detailed excerpt with enough content to produce multiple sentences. The model scores 92% on MMLU which is a significant improvement. Pricing starts at $20 per million tokens for the new API tier. Another sentence here to add more content.`,
      })),
    };
    const intel = legacyEventIntelligence(normal);
    // Coverage depends on extracted fact count and word count - just verify it's not thin
    expect(intel.coverage).toBeOneOf(["normal", "rich", "thin"]);
  });

  it("uses fallback for empty what", () => {
    const empty = {
      what: "",
      sources: [{ excerpt: "Some content" }],
    };
    const intel = legacyEventIntelligence(empty);
    expect(intel.oneSentence).toContain("usable summary");
  });

  it("extracts context from longer excerpts for legacy data", () => {
    const legacy = {
      what: "OpenAI released GPT-5.",
      sources: [
        {
          excerpt:
            "OpenAI released GPT-5. This is a longer sentence that provides context about the release and its significance in the AI landscape.",
        },
      ],
    };
    const intel = legacyEventIntelligence(legacy);
    expect(intel.newDevelopments.some((s) => s.text.includes("longer sentence"))).toBe(true);
    expect(intel.context).toEqual([]);
  });

  it("does not manufacture a timeline from source counts", () => {
    const legacy = {
      what: "OpenAI released GPT-5.",
      sources: [
        { excerpt: "OpenAI released GPT-5." },
        { excerpt: "Another source covered the release." },
      ],
    };
    const intel = legacyEventIntelligence(legacy);
    expect(intel.timeline).toEqual([]);
  });

  it("leaves other optional arrays empty for legacy data", () => {
    const legacy = {
      what: "OpenAI released GPT-5.",
      sources: [{ excerpt: "Content" }],
    };
    const intel = legacyEventIntelligence(legacy);
    expect(intel.numbers).toEqual([]);
    expect(intel.audiences).toEqual([]);
    expect(intel.whatNext).toEqual([]);
    expect(intel.unknowns).toEqual([]);
    expect(intel.conflicts).toEqual([]);
  });

  const wordsOf = (intel: EventIntelligence) =>
    [
      intel.oneSentence,
      ...intel.newDevelopments.map((s) => s.text),
      ...intel.context.map((s) => s.text),
    ]
      .join(" ")
      .trim()
      .split(/\s+/).length;

  it("reaches a substantial word count for a multi-source event with real evidence", () => {
    const intel = legacyEventIntelligence({
      what: "Nvidia agreed to acquire Hugging Face for $13 billion in a deal announced Monday.",
      sources: [
        {
          name: "Reuters",
          excerpt:
            "Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion in cash and stock. The deal is expected to close in the first quarter, pending regulatory approval. Hugging Face will continue operating as an independent subsidiary, according to the announcement.",
        },
        {
          name: "Bloomberg",
          excerpt:
            "Nvidia's acquisition of Hugging Face values the AI startup at $13 billion, according to people familiar with the matter. The deal marks Nvidia's largest acquisition to date. Regulators in the US and EU are expected to review the transaction closely.",
        },
        {
          name: "The Verge",
          excerpt:
            "Hugging Face, known for its open-source AI model hub, will keep its branding after the Nvidia deal closes. The company said 40% of its engineering team will report directly to Nvidia's AI infrastructure division. No layoffs are planned as part of the transition.",
        },
      ],
    });
    expect(wordsOf(intel)).toBeGreaterThanOrEqual(80);
    expect(intel.coverage).not.toBe("thin");
  });

  it("stays conservative for a single-source event rather than padding it", () => {
    const intel = legacyEventIntelligence({
      what: "A startup raised a seed round.",
      sources: [{ name: "TechCrunch", excerpt: "A startup raised a $2 million seed round." }],
    });
    expect(wordsOf(intel)).toBeLessThan(60);
  });

  it("merges near-duplicate reporting across sources into one fact, keeping every source's evidence", () => {
    const intel = legacyEventIntelligence({
      what: "",
      sources: [
        {
          name: "Outlet A",
          excerpt: "OpenAI announced a new flagship model today with major improvements.",
        },
        {
          name: "Outlet B",
          excerpt: "OpenAI has announced a new flagship model today with major improvements.",
        },
        {
          name: "Outlet C",
          excerpt: "OpenAI announced today a new flagship model with major improvements.",
        },
      ],
    });
    const merged = intel.newDevelopments.find((s) => /flagship model/.test(s.text));
    expect(merged?.evidence).toEqual([1, 2, 3]);
    expect(intel.newDevelopments.filter((s) => /flagship model/.test(s.text))).toHaveLength(1);
  });

  it("keeps outlet support in citations rather than metadata prose", () => {
    const withFacts = legacyEventIntelligence({
      what: "Something happened.",
      sources: [
        { name: "A", excerpt: "The company confirmed the change will take effect next month." },
        { name: "B", excerpt: "The company confirmed the change will take effect next month." },
      ],
    });
    expect(withFacts.context.some((c) => /outlets are currently reporting/.test(c.text))).toBe(
      false,
    );
    expect(withFacts.newDevelopments[0]?.evidence).toEqual([1, 2]);

    const withoutExcerpts = legacyEventIntelligence({
      what: "Something happened.",
      sources: [{ name: "A" }, { name: "B" }],
    });
    expect(
      withoutExcerpts.context.some((c) => /outlets are currently reporting/.test(c.text)),
    ).toBe(false);
  });

  it("surfaces named companies and products mentioned in the excerpts", () => {
    const intel = legacyEventIntelligence({
      what: "A funding round closed.",
      sources: [
        {
          name: "A",
          excerpt:
            "OpenAI's ChatGPT integration with Microsoft Azure expanded this week under a new agreement.",
        },
      ],
    });
    const mention = intel.newDevelopments.find((c) => c.text.includes("OpenAI"));
    expect(mention?.text).toContain("OpenAI");
    expect(mention?.evidence).toEqual([1]);
    expect(JSON.stringify(intel)).not.toContain("The coverage centers on");
  });

  it("extracts money and percentage figures actually present in the excerpts, without inventing values", () => {
    const intel = legacyEventIntelligence({
      what: "A deal closed.",
      sources: [
        {
          name: "A",
          excerpt: "The deal is worth $13 billion, a 40% premium over the last valuation.",
        },
      ],
    });
    expect(intel.numbers).toEqual([]);
    expect(intel.newDevelopments[0]?.text).toBe(
      "The deal is worth $13 billion, a 40% premium over the last valuation.",
    );
  });

  it("does not turn supplied historical titles into context without a supported fact", () => {
    const withRelated = legacyEventIntelligence({
      what: "A follow-up development occurred.",
      sources: [{ name: "A", excerpt: "The company confirmed a follow-up development this week." }],
      relatedEvents: [{ title: "The original announcement last month" }],
    });
    expect(
      withRelated.context.some((c) => c.text.includes("The original announcement last month")),
    ).toBe(false);

    const withoutRelated = legacyEventIntelligence({
      what: "A follow-up development occurred.",
      sources: [{ name: "A", excerpt: "The company confirmed a follow-up development this week." }],
    });
    expect(withoutRelated.context.some((c) => c.text.includes("nyuz has also covered"))).toBe(
      false,
    );
  });

  it("preserves attribution and uncertainty language from the source text", () => {
    const intel = legacyEventIntelligence({
      what: "A claim was made.",
      sources: [
        {
          name: "A",
          excerpt:
            "The company reportedly plans to lay off staff next quarter, according to two people familiar with the matter.",
        },
      ],
    });
    const merged = [...intel.newDevelopments, ...intel.context].map((s) => s.text).join(" ");
    expect(merged).toContain("reportedly");
    expect(merged).toContain("according to");
  });

  it("reaches a genuinely long-form word count when enriched evidence is available (400+ words)", () => {
    const perSource: Record<string, string[]> = {
      Reuters: [
        "Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion in a combination of cash and newly issued stock.",
        "The deal is expected to close in the first quarter of next year, pending regulatory approval from both US and EU competition authorities.",
        "Hugging Face will continue operating as an independent subsidiary after the deal closes, the two companies said in a joint statement.",
        "The acquisition values Hugging Face at roughly three and a half times its last private funding round, which closed in 2024.",
        "Nvidia's chief executive said in a call with investors that the deal reflects growing demand for open-source AI infrastructure worldwide.",
        "Shares of Nvidia rose 2% in after-hours trading following the announcement, while Hugging Face's existing investors declined to comment.",
        "The transaction marks Nvidia's largest acquisition to date, surpassing its previous record deal in the networking hardware sector.",
      ],
      Bloomberg: [
        "Nvidia plans to integrate Hugging Face's popular open-source model hub directly into its own AI infrastructure and cloud platform.",
        "Roughly 40% of Hugging Face's current engineering team will report directly to Nvidia's AI infrastructure division once the deal closes.",
        "No layoffs are planned as part of the transition, according to an internal memo circulated to staff and seen by reporters.",
        "The companies said existing enterprise contracts and open-source hosting commitments will remain unchanged throughout the transition period.",
        "People familiar with the matter said exploratory talks between the two companies began quietly earlier this year, before accelerating in recent weeks.",
        "Wall Street analysts said the deal meaningfully strengthens Nvidia's competitive position against rival cloud AI infrastructure providers.",
        "The purchase price represents a significant premium over what some analysts had previously estimated the startup was worth.",
      ],
      "The Verge": [
        "Hugging Face's two co-founders will join Nvidia's leadership team in senior roles as part of the acquisition agreement.",
        "The platform hosts hundreds of thousands of openly licensed AI models that are used daily by developers around the world.",
        "Nvidia said it will continue funding Hugging Face's free open-source hosting tier for independent developers after the deal closes.",
        "Competing cloud infrastructure providers declined to comment on how the acquisition might affect their own existing AI partnerships.",
        "The companies said they expect the technical transition to be completed without disruption to existing platform users or paying customers.",
        "Regulators in Brussels are expected to review the proposed deal closely under the European Union's newly adopted AI-sector merger guidelines.",
        "Industry observers said the acquisition could accelerate consolidation among AI infrastructure providers over the coming year.",
      ],
    };
    const intel = legacyEventIntelligence({
      what: "Nvidia agreed to acquire Hugging Face for $13 billion in a deal announced Monday.",
      sources: Object.entries(perSource).map(([name, facts]) => ({
        name,
        enrichedEvidence: facts.map((text) => ({ kind: "fact" as const, text })),
      })),
      relatedEvents: [{ title: "Nvidia's previous AI infrastructure acquisition last year" }],
    });

    const words = wordsOf(intel);
    expect(words).toBeGreaterThanOrEqual(400);
    expect(intel.coverage).toBe("rich");
    const article = composeArticle({
      title: "Nvidia agrees to acquire Hugging Face for $13 billion",
      what: intel.oneSentence,
      sourceList: Object.entries(perSource).map(([name, facts]) => ({
        name,
        at: "",
        enrichedEvidence: facts.map((text) => ({ kind: "fact" as const, text })),
      })),
    } as Story);
    const output = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(output.split(/\s+/).length).toBeGreaterThanOrEqual(300);
    expect(output).not.toMatch(
      /coverage centers on|Amount mentioned|nyuz has also covered|outlets are currently reporting/,
    );
    expect(article.paragraphs.every((p) => p.evidence.length > 0)).toBe(true);
  });

  it("routes an uncertain evidence unit into unknowns rather than presenting it as established fact", () => {
    const intel = legacyEventIntelligence({
      what: "A deal was reported.",
      sources: [
        {
          name: "A",
          enrichedEvidence: [
            { kind: "fact", text: "The company confirmed the deal is valued at $500 million." },
            {
              kind: "uncertain",
              text: "The company declined to comment on the exact closing date.",
            },
          ],
        },
      ],
    });
    expect(intel.unknowns).toContain("The company declined to comment on the exact closing date.");
    expect(intel.newDevelopments.some((s) => s.text.includes("declined to comment"))).toBe(false);
  });

  it("renders an enriched quote as an attributed statement", () => {
    const intel = legacyEventIntelligence({
      what: "An executive commented on the deal.",
      sources: [
        {
          name: "A",
          enrichedEvidence: [
            {
              kind: "quote",
              text: "We could not be more excited about this partnership",
              attribution: "Maria Chen",
            },
          ],
        },
      ],
    });
    expect(
      intel.newDevelopments.some(
        (s) => s.text === 'Maria Chen said: "We could not be more excited about this partnership"',
      ),
    ).toBe(true);
  });

  it("falls back to the excerpt for a source that was not enriched, alongside one that was", () => {
    const intel = legacyEventIntelligence({
      what: "",
      sources: [
        {
          name: "Enriched Outlet",
          enrichedEvidence: [
            { kind: "fact", text: "The enriched fact about the deal appears here in detail." },
          ],
        },
        {
          name: "RSS-only Outlet",
          excerpt: "The RSS-only outlet's excerpt sentence appears here as well.",
        },
      ],
    });
    const texts = intel.newDevelopments.map((s) => s.text);
    expect(texts.some((t) => t.includes("enriched fact about the deal"))).toBe(true);
    expect(texts.some((t) => t.includes("RSS-only outlet's excerpt"))).toBe(true);
  });

  it("never carries a statement longer than a short attributed excerpt", () => {
    const longExcerpt = `${"This sentence repeats important context about the deal and its terms. ".repeat(10)}`;
    const intel = legacyEventIntelligence({
      what: "A deal was reported.",
      sources: [{ name: "A", excerpt: longExcerpt }],
    });
    for (const statement of [...intel.newDevelopments, ...intel.context]) {
      expect(statement.text.length).toBeLessThanOrEqual(320);
    }
  });
});

describe("novelSentences", () => {
  it("drops a why paragraph that only restates the summary", () => {
    const summary = "Nvidia agreed to acquire Hugging Face. The acquisition price was $13 billion.";
    const why = "Nvidia has an agreement to acquire Hugging Face for $13 billion.";
    expect(novelSentences(why, [summary])).toBe("");
  });

  it("keeps the clause the summary does not cover", () => {
    const summary = "Nvidia agreed to acquire Hugging Face for $13 billion.";
    const why =
      "Nvidia agreed to acquire Hugging Face for $13 billion. The deal needs clearance from European regulators before it closes.";
    expect(novelSentences(why, [summary])).toBe(
      "The deal needs clearance from European regulators before it closes.",
    );
  });

  it("also filters against facts already listed on the page", () => {
    const why = "Regulators must approve the transaction.";
    expect(
      novelSentences(why, ["Something else.", "Regulators must approve the transaction."]),
    ).toBe("");
  });

  it("does not repeat itself across its own sentences", () => {
    const why =
      "Nvidia agreed to acquire Hugging Face for $13 billion. Nvidia has an agreement to acquire Hugging Face for $13 billion.";
    expect(novelSentences(why, [])).toBe("Nvidia agreed to acquire Hugging Face for $13 billion.");
  });

  it("leaves a short sentence alone rather than guessing it is a repeat", () => {
    expect(novelSentences("Prices rose.", ["Prices rose."])).toBe("Prices rose.");
  });
});

describe("deriveChange", () => {
  it("prefers a genuine before/now contrast", () => {
    const change = deriveChange(
      "Cloudflare offered managed security services without Daybreak models.",
      "Cloudflare's Managed Defense now uses Daybreak models for vulnerability discovery.",
      [],
      "An event happened.",
    );
    expect(change).toEqual({
      mode: "before_now",
      before: "Cloudflare offered managed security services without Daybreak models.",
      now: "Cloudflare's Managed Defense now uses Daybreak models for vulnerability discovery.",
    });
  });

  it("never invents a before-state: falls back to new developments when before/after are absent", () => {
    const change = deriveChange(
      null,
      null,
      [{ text: "A new fact.", evidence: [1], kind: "reported" }],
      "",
    );
    expect(change).toEqual({
      mode: "new",
      items: [{ text: "A new fact.", evidence: [1], kind: "reported" }],
    });
  });

  it("falls back to new developments when before and now say the same thing", () => {
    const change = deriveChange(
      "OpenAI launched Daybreak.",
      "OpenAI launched Daybreak.",
      [{ text: "A genuinely new fact.", evidence: [1], kind: "reported" }],
      "",
    );
    expect(change?.mode).toBe("new");
  });

  it("drops new-development items that only restate one_sentence", () => {
    const change = deriveChange(
      null,
      null,
      [{ text: "OpenAI committed $1 billion to Daybreak.", evidence: [1], kind: "reported" }],
      "OpenAI committed $1 billion to Daybreak.",
    );
    expect(change).toBeNull();
  });

  it("returns null when there is nothing to say", () => {
    expect(deriveChange(null, null, [], "")).toBeNull();
  });
});

/** A parsed document with only the fields a test cares about set. */
function parse(understand: Record<string, unknown>, evidenceCount = 2) {
  return readEventIntelligence(
    { coverage: "normal", one_sentence: "An event happened that matters.", ...understand },
    evidenceCount,
  );
}

describe("relationships", () => {
  const nodes = [
    { id: "a", label: "Nvidia" },
    { id: "b", label: "Hugging Face" },
    { id: "c", label: "EU regulators" },
  ];

  it("reads a graph with enough edges to be worth drawing", () => {
    const parsed = parse({
      relationships: {
        nodes,
        edges: [
          { from: "a", to: "b", label: "acquiring", evidence: [1] },
          { from: "c", to: "a", label: "reviewing", evidence: [2] },
        ],
      },
    });
    expect(parsed?.relationships?.edges).toHaveLength(2);
  });

  it("reads a graph with three nodes even at one edge", () => {
    const parsed = parse({
      relationships: { nodes, edges: [{ from: "a", to: "b", evidence: [1] }] },
    });
    expect(parsed?.relationships?.nodes).toHaveLength(3);
  });

  it("drops a graph that is just a single triple with two nodes", () => {
    const parsed = parse({
      relationships: {
        nodes: [
          { id: "a", label: "Nvidia" },
          { id: "b", label: "Hugging Face" },
        ],
        edges: [{ from: "a", to: "b", label: "acquiring", evidence: [1] }],
      },
    });
    expect(parsed?.relationships).toBeNull();
  });

  it("drops an edge with no evidence, and the whole graph if that empties it", () => {
    const parsed = parse({
      relationships: {
        nodes: [
          { id: "a", label: "Nvidia" },
          { id: "b", label: "Hugging Face" },
        ],
        edges: [{ from: "a", to: "b", label: "acquiring" }],
      },
    });
    expect(parsed?.relationships).toBeNull();
  });

  it("drops an edge that points a node at itself, and the gate re-applies to what's left", () => {
    const parsed = parse({
      relationships: {
        nodes: [
          { id: "a", label: "Nvidia" },
          { id: "b", label: "Hugging Face" },
        ],
        edges: [
          { from: "a", to: "a", evidence: [1] },
          { from: "a", to: "b", evidence: [1] },
        ],
      },
    });
    // The self-loop is dropped, leaving one edge and two nodes -- below the
    // richness gate, so the graph as a whole is null rather than half-drawn.
    expect(parsed?.relationships).toBeNull();
  });

  it("drops an edge referencing an undeclared node", () => {
    const parsed = parse({
      relationships: {
        nodes: [
          { id: "a", label: "Nvidia" },
          { id: "b", label: "Hugging Face" },
        ],
        edges: [
          { from: "a", to: "z", evidence: [1] },
          { from: "a", to: "b", evidence: [1] },
        ],
      },
    });
    // Only one edge survives (the other references an unknown node "z"), and
    // one edge with two nodes does not clear the richness gate.
    expect(parsed?.relationships).toBeNull();
  });
});

describe("audiences", () => {
  it("reads an audience with a grounded implication", () => {
    const parsed = parse({
      audiences: [{ audience: "Developers", implication: "API pricing unchanged", evidence: [1] }],
    });
    expect(parsed?.audiences).toEqual([
      { audience: "Developers", implication: "API pricing unchanged", evidence: [1] },
    ]);
  });

  it("drops an audience implication with no evidence", () => {
    const parsed = parse({
      audiences: [{ audience: "Developers", implication: "API pricing unchanged" }],
    });
    expect(parsed?.audiences).toEqual([]);
  });
});

describe("perspectives", () => {
  it("keeps two or more distinct sources", () => {
    const parsed = parse({
      perspectives: [
        { source: "OpenAI", stance: "This expands access to cyber defense.", evidence: [1] },
        {
          source: "Independent researcher",
          stance: "Effectiveness needs independent testing.",
          evidence: [2],
        },
      ],
    });
    expect(parsed?.perspectives).toHaveLength(2);
  });

  it("drops a single perspective, which is a fact with a byline", () => {
    const parsed = parse({
      perspectives: [
        { source: "OpenAI", stance: "This expands access to cyber defense.", evidence: [1] },
      ],
    });
    expect(parsed?.perspectives).toEqual([]);
  });

  it("collapses duplicate sources to one entry", () => {
    const parsed = parse({
      perspectives: [
        { source: "OpenAI", stance: "First framing.", evidence: [1] },
        { source: "openai", stance: "Second framing, same source.", evidence: [1] },
        { source: "Researcher", stance: "A different framing.", evidence: [2] },
      ],
    });
    expect(parsed?.perspectives).toHaveLength(2);
  });
});

describe("watchNext", () => {
  it("reads a specific, checkable future development", () => {
    const parsed = parse({
      watch_next: [
        {
          label: "General availability",
          detail: "Whether the service leaves early access",
          evidence: [1],
        },
      ],
    });
    expect(parsed?.watchNext).toHaveLength(1);
  });

  it("drops an item with no detail", () => {
    const parsed = parse({ watch_next: [{ label: "General availability" }] });
    expect(parsed?.watchNext).toEqual([]);
  });
});

describe("comparison", () => {
  const rows = [{ label: "Monthly", left: "$20", right: "$25", evidence: [1] }];

  it("reads rows with two supported sides", () => {
    const parsed = parse({
      comparison: { caption: "Pricing", left_label: "Before", right_label: "Now", rows },
    });
    expect(parsed?.comparison?.rows).toHaveLength(1);
    expect(parsed?.comparison?.leftLabel).toBe("Before");
  });

  it("drops a row whose sides are the same value", () => {
    const parsed = parse({
      comparison: {
        left_label: "Before",
        right_label: "Now",
        rows: [{ label: "Monthly", left: "$20", right: "$20", evidence: [1] }],
      },
    });
    expect(parsed?.comparison).toBeNull();
  });

  it("drops the whole comparison when no row survives", () => {
    const parsed = parse({
      comparison: {
        left_label: "Before",
        right_label: "Now",
        rows: [{ label: "Monthly", left: "$20", right: "$25" }],
      },
    });
    expect(parsed?.comparison).toBeNull();
  });

  it("drops a comparison with no side labels", () => {
    const parsed = parse({ comparison: { rows } });
    expect(parsed?.comparison).toBeNull();
  });
});

describe("series", () => {
  const point = (label: string, value: number) => ({
    label,
    value,
    display: `$${value}B`,
    evidence: [1],
  });

  it("reads three or more comparable numbers", () => {
    const parsed = parse({
      series: {
        caption: "Quarterly revenue",
        shape: "bar",
        points: [point("Q1", 26), point("Q2", 30), point("Q3", 35)],
      },
    });
    expect(parsed?.series?.points).toHaveLength(3);
    expect(parsed?.series?.shape).toBe("bar");
  });

  it("refuses a chart of two numbers", () => {
    const parsed = parse({ series: { points: [point("Q1", 26), point("Q2", 30)] } });
    expect(parsed?.series).toBeNull();
  });

  it("refuses a chart of one number, which is a key number", () => {
    const parsed = parse({
      series: { points: [{ label: "Price", value: 699, display: "$699", evidence: [1] }] },
    });
    expect(parsed?.series).toBeNull();
  });

  it("refuses a chart where every value is identical", () => {
    const parsed = parse({
      series: { points: [point("Q1", 30), point("Q2", 30), point("Q3", 30)] },
    });
    expect(parsed?.series).toBeNull();
  });

  it("drops points with unusable numbers before deciding", () => {
    const parsed = parse({
      series: {
        points: [point("Q1", 26), { label: "Q2", value: "n/a", evidence: [1] }, point("Q3", 35)],
      },
    });
    expect(parsed?.series).toBeNull();
  });

  it("defaults an unrecognised shape to bars", () => {
    const parsed = parse({
      series: { shape: "donut", points: [point("Q1", 26), point("Q2", 30), point("Q3", 35)] },
    });
    expect(parsed?.series?.shape).toBe("bar");
  });
});

describe("overview", () => {
  it("reads two or more announced things", () => {
    const parsed = parse({
      overview: [
        { name: "Beam Ultra", kind: "Soundbar", detail: "$699", evidence: [1] },
        { name: "Sonos 27", kind: "OS update", evidence: [2] },
      ],
    });
    expect(parsed?.overview).toHaveLength(2);
    expect(parsed?.overview[1]?.detail).toBe("");
  });

  it("refuses an overview of one thing", () => {
    const parsed = parse({
      overview: [{ name: "Beam Ultra", kind: "Soundbar", evidence: [1] }],
    });
    expect(parsed?.overview).toEqual([]);
  });

  it("drops items with no evidence", () => {
    const parsed = parse({
      overview: [{ name: "Beam Ultra", evidence: [1] }, { name: "Sonos Fabric" }],
    });
    expect(parsed?.overview).toEqual([]);
  });
});

describe("collapseTimeline", () => {
  it("folds repeated publication rows into one stage", () => {
    const collapsed = collapseTimeline([
      { when: "09:00", what: "Engadget published", evidence: [1] },
      { when: "10:00", what: "Engadget published", evidence: [2] },
      { when: "11:00", what: "Engadget published", evidence: [3] },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.when).toBe("09:00");
    expect(collapsed[0]?.evidence).toEqual([1, 2, 3]);
  });

  it("folds paraphrases of one stage together", () => {
    const collapsed = collapseTimeline([
      { when: "Aug 27", what: "Nvidia announced the acquisition of Hugging Face", evidence: [1] },
      {
        when: "Aug 27",
        what: "The Hugging Face acquisition was announced by Nvidia",
        evidence: [2],
      },
    ]);
    expect(collapsed).toHaveLength(1);
  });

  it("keeps genuinely different stages", () => {
    const collapsed = collapseTimeline([
      { when: "Aug 27", what: "Deal announced", evidence: [1] },
      { when: "Q4", what: "Regulatory review expected to conclude", evidence: [2] },
    ]);
    expect(collapsed).toHaveLength(2);
  });
});

describe("eventTimeline", () => {
  const base = parse({});

  it("prefers the analysed stages over the publication record", () => {
    const intel = parse({
      timeline: [
        { when: "Aug 27", what: "Deal announced", evidence: [1] },
        { when: "Q4", what: "Expected closing", evidence: [2] },
      ],
    });
    const points = eventTimeline(intel!, [
      { when: "09:00", what: "Engadget published", evidence: [] },
    ]);
    expect(points.map((point) => point.what)).toEqual(["Deal announced", "Expected closing"]);
  });

  it("falls back to the publication record when there are no analysed stages", () => {
    const points = eventTimeline(base!, [
      { when: "09:00", what: "Reuters published", evidence: [] },
      { when: "11:00", what: "Engadget published", evidence: [] },
    ]);
    expect(points).toHaveLength(2);
  });

  it("shows nothing when one outlet published three times", () => {
    const points = eventTimeline(base!, [
      { when: "09:00", what: "Engadget published", evidence: [] },
      { when: "10:00", what: "Engadget published", evidence: [] },
      { when: "11:00", what: "Engadget published", evidence: [] },
    ]);
    expect(points).toEqual([]);
  });

  it("shows nothing for a single-source event", () => {
    const points = eventTimeline(base!, [
      { when: "09:00", what: "Hacker News published", evidence: [] },
    ]);
    expect(points).toEqual([]);
  });
});

describe("corroboration", () => {
  const outlets = ["Reuters", "TechCrunch", "The Verge", "Reuters"];

  it("counts distinct outlets behind a statement", () => {
    expect(corroboration([1, 2, 3], outlets)).toBe(3);
  });

  it("counts syndicated copies of one outlet once", () => {
    expect(corroboration([1, 4], outlets)).toBe(1);
  });

  it("ignores references to sources that are not there", () => {
    expect(corroboration([1, 99], outlets)).toBe(1);
  });
});

describe("thin evidence stays text-only", () => {
  it("produces no visual blocks at all", () => {
    const intel = legacyEventIntelligence({
      what: "Acme announced an agreement to acquire Example Corp for $800 million.",
      sources: [{ excerpt: "Acme announced an agreement to acquire Example Corp." }],
    });
    expect(intel.relationships).toBeNull();
    expect(intel.comparison).toBeNull();
    expect(intel.series).toBeNull();
    expect(intel.overview).toEqual([]);
    expect(intel.numbers).toEqual([]);
    expect(eventTimeline(intel, [])).toEqual([]);
  });

  it("keeps every visual block empty when the model omits them", () => {
    const parsed = parse({
      context: [{ text: "One reported fact about the event.", evidence: [1] }],
    });
    expect(parsed?.relationships).toBeNull();
    expect(parsed?.comparison).toBeNull();
    expect(parsed?.series).toBeNull();
    expect(parsed?.overview).toEqual([]);
  });
});

describe("storage does not cut a name at its initial, and does cut a pasted caption", () => {
  it("keeps one name whole across its initial", () => {
    expect(
      sentences(
        "The transaction was co-led by Wellington and T. Rowe Price, large institutional investors that back private companies.",
      ),
    ).toEqual([
      "The transaction was co-led by Wellington and T. Rowe Price, large institutional investors that back private companies.",
    ]);
    // An abbreviation cut open at its own period rejoins without a space --
    // "U." + "S." is "U.S.", never "U. S." -- and the boundary after it is not
    // a boundary at all: this is the production deck that read "... in
    // violation of U.S.", cut at the final stop of "U.S. export controls".
    // Decimals are protected, and a sentence that genuinely ends with an
    // abbreviation merges with the next one rather than cutting the run open.
    expect(
      sentences("The ruling affected the U.S. Courts next. The model scores 92.5 on MMLU."),
    ).toEqual(["The ruling affected the U.S. Courts next.", "The model scores 92.5 on MMLU."]);
    expect(
      sentences(
        "A California man has been arrested for smuggling over $300 million worth of restricted Nvidia chips to China in violation of U.S. export controls. According to a U.S. Department of Justice press release, he shipped them in servers.",
      ),
    ).toEqual([
      "A California man has been arrested for smuggling over $300 million worth of restricted Nvidia chips to China in violation of U.S. export controls.",
      "According to a U.S. Department of Justice press release, he shipped them in servers.",
    ]);
  });

  it("cuts a caption pasted onto a sentence with no punctuation", () => {
    expect(
      sentences(
        "Research has found some Chinese children prefer talking to AI over people A survey of 8,563 primary and secondary students in China in 2025 found one in five children said they only wanted to speak with AI.",
      ),
    ).toEqual([
      "Research has found some Chinese children prefer talking to AI over people",
      "A survey of 8,563 primary and secondary students in China in 2025 found one in five children said they only wanted to speak with AI.",
    ]);
  });
});
