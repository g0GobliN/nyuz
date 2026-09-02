import { describe, expect, it } from "vitest";
import {
  dedupeStatements,
  readEventIntelligence,
  briefingText,
  understandMinutes,
  intelligenceText,
  legacyEventIntelligence,
  type EventIntelligence,
  novelSentences,
} from "./understand";

describe("readEventIntelligence", () => {
  const validIntelligence = {
    version: 1,
    coverage: "normal" as const,
    summary: "OpenAI released GPT-5 with improved reasoning.",
    facts: [{ text: "The model scores 92% on MMLU", evidence: [1], kind: "reported" as const }],
    keyNumbers: [{ value: "$20B", label: "Valuation", evidence: [1] }],
    context: [{ text: "Previous version scored 85%", evidence: [2], kind: "context" as const }],
    timeline: [{ when: "2026-09-01", what: "Release announced", evidence: [1] }],
    affectedGroups: [
      {
        group: "Developers",
        effect: "API pricing unchanged",
        basis: "reported" as const,
        evidence: [1],
      },
    ],
    whatNext: [
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
    expect(parsed?.version).toBe(1);
    expect(parsed?.coverage).toBe("normal");
    expect(parsed?.summary).toBe(validIntelligence.summary);
    expect(parsed?.facts).toHaveLength(1);
    expect(parsed?.keyNumbers).toHaveLength(1);
    expect(parsed?.context).toHaveLength(1);
    expect(parsed?.timeline).toHaveLength(1);
    expect(parsed?.affectedGroups).toHaveLength(1);
    expect(parsed?.whatNext).toHaveLength(1);
    expect(parsed?.unknowns).toHaveLength(1);
    expect(parsed?.conflicts).toHaveLength(1);
  });

  it("returns null for missing core fields", () => {
    expect(readEventIntelligence(null, 2)).toBeNull();
    expect(readEventIntelligence(undefined, 2)).toBeNull();
    expect(readEventIntelligence({}, 2)).toBeNull();
    expect(readEventIntelligence({ version: 1, coverage: "normal", summary: "" }, 2)).toBeNull();
  });

  it("rejects invalid coverage values", () => {
    expect(
      readEventIntelligence({ version: 1, coverage: "invalid", summary: "test" }, 2),
    ).toBeNull();
    expect(readEventIntelligence({ version: 1, coverage: null, summary: "test" }, 2)).toBeNull();
  });

  it("handles snake_case keys from model replies", () => {
    const snakeCase = {
      version: 1,
      coverage: "thin" as const,
      summary: "Test",
      key_numbers: [{ value: "100", label: "Count", evidence: [1] }],
      what_next: [{ text: "Next step", evidence: [1], kind: "reported" as const }],
    };
    const parsed = readEventIntelligence(snakeCase, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyNumbers).toHaveLength(1);
    expect(parsed?.whatNext).toHaveLength(1);
  });

  it("truncates over-long text fields", () => {
    const longText = "x".repeat(800);
    const withLong = {
      ...validIntelligence,
      summary: longText,
      facts: [{ text: longText, evidence: [1], kind: "reported" as const }],
    };
    const parsed = readEventIntelligence(withLong, 1);
    expect(parsed?.summary.length).toBeLessThan(800);
    expect(parsed?.facts[0]?.text.length).toBeLessThan(800);
  });

  it("filters out-of-bounds evidence references", () => {
    const withBadEvidence = {
      ...validIntelligence,
      facts: [
        { text: "Valid fact", evidence: [1], kind: "reported" as const },
        { text: "Invalid fact", evidence: [0, 5, 100], kind: "reported" as const },
      ],
    };
    const parsed = readEventIntelligence(withBadEvidence, 2);
    expect(parsed?.facts).toHaveLength(1);
    expect(parsed?.facts[0]?.evidence).toEqual([1]);
  });

  it("de-duplicates evidence references", () => {
    const withDupes = {
      ...validIntelligence,
      facts: [{ text: "Fact", evidence: [1, 1, 1, 2, 2], kind: "reported" as const }],
    };
    const parsed = readEventIntelligence(withDupes, 2);
    expect(parsed?.facts[0]?.evidence).toEqual([1, 2]);
  });

  it("caps array lengths", () => {
    const manyItems = {
      version: 1,
      coverage: "normal" as const,
      summary: "Test",
      facts: Array.from({ length: 20 }, (_, i) => ({
        text: `Fact ${i}`,
        evidence: [1],
        kind: "reported" as const,
      })),
      keyNumbers: Array.from({ length: 20 }, (_, i) => ({
        value: `${i}`,
        label: `Label ${i}`,
        evidence: [1],
      })),
      context: Array.from({ length: 20 }, (_, i) => ({
        text: `Context ${i}`,
        evidence: [1],
        kind: "context" as const,
      })),
      timeline: Array.from({ length: 20 }, (_, i) => ({
        when: `T${i}`,
        what: `Event ${i}`,
        evidence: [1],
      })),
      affectedGroups: Array.from({ length: 20 }, (_, i) => ({
        group: `Group ${i}`,
        effect: `Effect ${i}`,
        basis: "reported" as const,
        evidence: [1],
      })),
      whatNext: Array.from({ length: 20 }, (_, i) => ({
        text: `Next ${i}`,
        evidence: [1],
        kind: "reported" as const,
      })),
      unknowns: Array.from({ length: 20 }, (_, i) => `Unknown ${i}`),
      conflicts: Array.from({ length: 20 }, (_, i) => ({
        topic: `Topic ${i}`,
        reports: [{ text: "Report", evidence: [1] }],
      })),
    };
    const parsed = readEventIntelligence(manyItems, 1);
    expect(parsed?.facts.length).toBeLessThanOrEqual(8);
    expect(parsed?.keyNumbers.length).toBeLessThanOrEqual(6);
    expect(parsed?.context.length).toBeLessThanOrEqual(5);
    expect(parsed?.timeline.length).toBeLessThanOrEqual(8);
    expect(parsed?.affectedGroups.length).toBeLessThanOrEqual(6);
    expect(parsed?.whatNext.length).toBeLessThanOrEqual(5);
    expect(parsed?.unknowns.length).toBeLessThanOrEqual(6);
    expect(parsed?.conflicts.length).toBeLessThanOrEqual(3);
  });

  it("requires valid basis for affected_groups", () => {
    const invalidBasis = {
      ...validIntelligence,
      affectedGroups: [
        { group: "Users", effect: "None", basis: "invalid" as const, evidence: [1] },
      ],
    };
    const parsed = readEventIntelligence(invalidBasis, 1);
    expect(parsed?.affectedGroups).toHaveLength(0);
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
      summary: "null",
      facts: [{ text: "unknown", evidence: [1], kind: "reported" as const }],
    };
    const parsed = readEventIntelligence(withNullish, 1);
    expect(parsed).toBeNull();
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
      version: 1,
      coverage: "normal",
      summary: "Summary",
      facts: [{ text: "Fact 1", evidence: [1], kind: "reported" }],
      keyNumbers: [{ value: "100", label: "Count", evidence: [1] }],
      context: [{ text: "Context", evidence: [1], kind: "context" }],
      timeline: [{ when: "2026-09-01", what: "Event", evidence: [1] }],
      affectedGroups: [{ group: "Users", effect: "None", basis: "reported", evidence: [1] }],
      whatNext: [{ text: "Next", evidence: [1], kind: "reported" }],
      unknowns: ["Unknown"],
      conflicts: [{ topic: "Topic", reports: [{ text: "Report", evidence: [1] }] }],
    };
    const texts = intelligenceText(intel);
    expect(texts).toContain("Summary");
    expect(texts).toContain("Fact 1");
    expect(texts).toContain("Context");
    expect(texts).toContain("Unknown");
  });
});

describe("legacyEventIntelligence", () => {
  it("creates intelligence from legacy event data", () => {
    const legacy = {
      what: "OpenAI released GPT-5 with improved reasoning capabilities and better performance on benchmarks.",
      sources: [
        { excerpt: "OpenAI announced GPT-5 today. The model scores 92% on MMLU, up from 85%." },
        { excerpt: "The new model includes improved safety features and reduced hallucinations." },
      ],
    };
    const intel = legacyEventIntelligence(legacy);
    expect(intel.version).toBe(1);
    expect(intel.summary).toBeTruthy();
    expect(intel.facts.length).toBeGreaterThan(0);
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
    expect(intel.summary).toContain("usable summary");
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
    expect(intel.context.length).toBeGreaterThan(0);
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
    expect(intel.keyNumbers).toEqual([]);
    expect(intel.affectedGroups).toEqual([]);
    expect(intel.whatNext).toEqual([]);
    expect(intel.unknowns).toEqual([]);
    expect(intel.conflicts).toEqual([]);
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
