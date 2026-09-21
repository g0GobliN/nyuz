import { describe, expect, it } from "vitest";
import fixtures from "./test-support/reader-production.json";
import { composeArticle } from "./editorial";
import {
  editorialNoise,
  evidenceScore,
  numericKeys,
  publisherVoice,
  rankEntities,
  readerSentences,
  selectReaderEvidence,
} from "./reader-evidence";
import { relatedContext, scoreRelatedEvent } from "./related-events";
import { rankEventTopics, assignTopics } from "./pipeline/topic-assign";
import { readerQuality } from "./understand";
import type { Story } from "./story";

const story = (index: number): Story => {
  const f = fixtures[index]!;
  return {
    id: f.id,
    title: f.title,
    what: f.what_happened,
    why: "",
    org: "The Register",
    sources: 1,
    topics: [],
    importance: "Medium",
    score: { relevance: 50, importance: 50, novelty: 50 },
    time: "",
    publishedAt: f.first_seen_at,
    sourceList: f.sources.map((s) => ({ ...s, at: "" })),
    before: "",
    after: "",
    timeline: [],
  };
};
const textOf = (s: Story) => {
  const a = composeArticle(s);
  return [a.deck.text, ...a.paragraphs.map((p) => p.text)].join(" ");
};

describe("production deterministic Read quality", () => {
  it.each([
    "PWNED",
    "Welcome back to our weekly column on security.",
    "In 30 years in this business, we've never seen so much backing.",
    "As we write, our previous story is three weeks old.",
  ])("rejects publisher setup: %s", (text) => {
    expect(selectReaderEvidence("Customer data exposure", [{ excerpt: text }]).facts).toEqual([]);
  });
  it("penalizes first-person voice but preserves attributed quotations", () => {
    expect(publisherVoice("We've never seen this happen before.")).toBe(true);
    expect(evidenceScore("We've never seen this happen before.", "News")).toBeLessThan(0);
    expect(editorialNoise('Maria Chen said: "We raised the money to build a new factory."')).toBe(
      false,
    );
    expect(
      readerSentences(
        'Maria said: "We raised $2.5 million. Our factory opens next year." The company hired engineers.',
      ),
    ).toHaveLength(2);
  });
  it("leads with the exposed environment, identifies Schut, and preserves attribution", () => {
    const s = story(0);
    const a = composeArticle(s);
    expect(a.deck.text).toMatch(/According to The Register, Richard Schut/);
    expect(a.deck.text).toMatch(/accessible outside the network.*live customer information/);
    expect(a.deck.evidence).toEqual([1]);
    expect(textOf(s)).not.toMatch(
      /PWNED|Welcome back|Hopefully|coverage centers on|nyuz has also covered/,
    );
    expect(textOf(s)).toContain("restricted access");
  });
  it("leads with the headline amount and keeps the pledge qualifications", () => {
    const s = story(1);
    const a = composeArticle(s);
    const text = textOf(s);
    expect(a.deck.text).toMatch(/\$18\.5 million.*multiyear commitments and AI tokens/);
    expect(text).toContain("Omarchy");
    expect(text).not.toMatch(/bit barn|AI gold rush|monster racks/i);
    expect(text.split(/\s+/).length).toBeLessThan(320);
    expect(text).not.toMatch(
      /Amount mentioned|coverage centers on|nyuz has also covered|we've never seen|As we write/,
    );
  });
  it("ranks central entities above incidental company mentions", () => {
    const s = story(1);
    const entities = rankEntities(s.title, s.sourceList);
    expect(entities.find((e) => e.name === "Omarchy")?.role).toBe("PRIMARY");
    expect(entities.find((e) => e.name === "David Heinemeier Hansson")?.aliases).toContain("DHH");
    for (const name of ["Apple", "Intel", "Meta", "Anthropic"])
      expect(entities.find((e) => e.name === name)?.role).not.toBe("PRIMARY");
  });
  it("distinguishes reporting outlets from subjects", () => {
    const sources = [
      {
        name: "Reuters",
        excerpt: "Reuters reported that Acme raised $20 million for its factory.",
      },
    ];
    expect(
      rankEntities("Acme raises funding", sources).find((e) => e.name === "Reuters")?.role,
    ).toBe("REPORTING_SOURCE");
    expect(
      rankEntities("Reuters launches a subscription", sources).find((e) => e.name === "Reuters")
        ?.role,
    ).toBe("PRIMARY");
  });
  it("canonicalizes case without merging distinct organizations", () => {
    const entities = rankEntities("SK hynix expands production", [
      { excerpt: "SK Hynix announced an expansion. Samsung reported a separate investment." },
    ]);
    expect(entities.filter((e) => e.name.toLowerCase() === "sk hynix")).toHaveLength(1);
    expect(entities.find((e) => e.name === "Samsung")).toBeDefined();
  });
  it("retains contextual numbers and rejects orphan numbers", () => {
    const selected = selectReaderEvidence("Acme raises $18.5M", [
      {
        excerpt:
          "Amount mentioned: 8 million. $18.5 million. Acme raised $18.5 million to build its first factory in Osaka.",
      },
    ]);
    expect(selected.facts).toHaveLength(1);
    expect(selected.lead?.text).toContain("to build its first factory");
    expect(numericKeys("$18.5M")).toEqual(numericKeys("$18.5 million"));
    expect(numericKeys("€18.5 million")).not.toEqual(numericKeys("$18.5M"));
  });
  it("prioritizes headline numbers above earlier unrelated amounts", () => {
    const selected = selectReaderEvidence("Acme gains $18.5M backing", [
      {
        excerpt:
          "Acme reported $2 million in operating costs during the previous year. Acme secured $18.5 million in backing to expand its operations.",
      },
    ]);
    expect(selected.lead?.text).toContain("secured $18.5 million");
  });
  it.each([
    [0, "llama.cpp merged OpenVINO 2026.3.1 backend update"],
    [0, "a16z launches $1.1B Machine Age fund for AI hardware"],
    [1, "Epstein survivors urge billionaire Leon Black to cooperate with House panel"],
    [1, "Australia sends drones to Nepal; Chalmers flags housing softness"],
  ] as const)("rejects production false positive %s: %s", (index, title) => {
    const score = scoreRelatedEvent(story(index), { title }, 1);
    expect(score.accepted).toBe(false);
    expect(score.primaryEntityOverlap).toEqual([]);
    expect(score.productOverlap).toEqual([]);
    expect(score.reason).toContain("No strong semantic anchor");
    const s = story(index);
    s.relatedEvents = [{ id: "unrelated", title, summary: `${title}.` }];
    expect(textOf(s)).not.toContain(title);
  });
  it("generic topics and recency cannot admit unrelated events", () => {
    const score = scoreRelatedEvent(
      { title: "New software changes developer workflows", publishedAt: "2026-09-18" },
      { title: "Government announces new business investment", publishedAt: "2026-09-17" },
      5,
    );
    expect(score.accepted).toBe(false);
    expect(score.topicOverlap).toBe(5);
    expect(score.recency).toBeGreaterThan(0);
  });
  it("accepts a shared central entity and composes a supported historical fact", () => {
    const current = { title: "Acme secures funding for a factory" };
    const prior = {
      title: "Acme announced its factory",
      summary: "Acme announced plans for the factory in June.",
    };
    expect(scoreRelatedEvent(current, prior).accepted).toBe(true);
    expect(relatedContext(current, prior)).toBe(
      "Previously, Acme announced plans for the factory in June.",
    );
    expect(relatedContext(current, { title: prior.title })).toBeNull();
  });
  it("weights central event categories over incidental controversy and industry", () => {
    const a = story(0),
      b = story(1);
    expect(rankEventTopics(a.title, composeArticle(a).deck.text, ["AI", "Cybersecurity"])[0]).toBe(
      "Cybersecurity",
    );
    expect(
      rankEventTopics(b.title, composeArticle(b).deck.text, ["Politics", "Linux", "AI"])[0],
    ).toBe("Funding");
    expect(assignTopics(b.sourceList[0]!.excerpt!, b.title)).toContain("Funding");
    expect(
      rankEventTopics("Parliament approves open-source procurement legislation", "", [
        "Open source",
        "Politics",
      ])[0],
    ).toBe("Politics");
  });
  it("does not classify long boilerplate or repeated facts as rich", () => {
    const statement = {
      text: "Welcome back to our weekly column where we review the latest developments in software and the business of technology.",
      evidence: [1],
      kind: "reported" as const,
    };
    expect(readerQuality({ newDevelopments: Array(20).fill(statement), context: [] }, 3, 2)).toBe(
      "thin",
    );
    const fact = {
      ...statement,
      text: "Acme announced plans for its first factory in Osaka, with production scheduled to start next year.",
    };
    expect(readerQuality({ newDevelopments: Array(20).fill(fact), context: [] }, 3)).toBe("thin");
    const other = story(1);
    const unrelated = selectReaderEvidence(other.title, other.sourceList).facts.map((f) => ({
      ...f,
      kind: "context" as const,
    }));
    expect(readerQuality({ newDevelopments: [fact], context: unrelated }, 3)).toBe("thin");
  });
  it("preserves conflicting values and subject/object direction while deduplicating", () => {
    const selected = selectReaderEvidence("Acme acquisition", [
      {
        excerpt:
          "Acme announced it acquired Beta for $20 million on Monday. Acme announced it acquired Beta for $21 million on Monday. Beta announced it acquired Acme for $20 million on Monday.",
      },
    ]);
    expect(selected.facts).toHaveLength(3);
  });
  it("allows thin evidence without padding", () => {
    const s = story(0);
    s.sourceList = [
      { name: "Reuters", at: "", excerpt: "Acme raised $2 million to develop a new factory." },
    ];
    s.title = "Acme raises funding";
    expect(textOf(s).split(/\s+/).length).toBeLessThan(60);
    expect(composeArticle(s).paragraphs).toEqual([]);
  });
  it("neutralizes NOR/SLC publisher rhetoric while preserving numeric context and attribution", () => {
    const s = story(1);
    s.title = "NOR flash and SLC NAND prices rise as supply tightens";
    s.what = "NOR flash and SLC NAND prices are rising as manufacturers shift capacity.";
    s.sourceList = [
      {
        name: "TrendForce",
        at: "",
        excerpt:
          "Contract prices for NOR flash and SLC NAND rose by 100% in the first half of 2026. TrendForce expects SLC NAND contract prices to rise another 120% to 170% in the second half of 2026 compared with the first half. The memory chip that makes a router remember how to be a router is a world away from the sleek GPUs used for artificial intelligence. Manufacturers are reducing wafer capacity devoted to SLC NAND in favor of higher-margin NAND products. Equipment lead times remain 12 to 15 months.",
      },
      {
        name: "Morgan Stanley",
        at: "",
        excerpt:
          "Morgan Stanley expects NOR flash supply to remain tight through 2026. JPMorgan also expects supply pressure to continue. Bryan Ao described the market as severe undersupply.",
      },
    ];
    const article = composeArticle(s);
    const output = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(output).toContain("100%");
    expect(output).toContain("120% to 170%");
    expect(output).toContain("12 to 15 months");
    expect(output).toContain("Morgan Stanley");
    expect(output).not.toMatch(/router remember how to be a router|world away from|sleek GPUs/i);
    expect(output).not.toMatch(
      /eye[- ]popping|alarming valuations?|all[- ]encompassing|older, less attractive/i,
    );
    expect(output).not.toMatch(/(?:^|\s)the figure is closer to \$6,000 to \$8,000/i);
    expect(output.split(/\s+/).length).toBeGreaterThan(70);
  });

  it("keeps a dependent comparison with its local antecedent and drops an orphan comparison", () => {
    const selected = selectReaderEvidence("Wafer capacity shifts to SLC NAND", [
      {
        excerpt:
          "The same wafer capacity used for SLC NAND yields about $6,000 to $8,000 in value. Using the same space to produce SLC and the figure is closer to $6,000 to $8,000. The figure is closer to $6,000 to $8,000.",
      },
    ]);
    expect(selected.facts.some((fact) => /same wafer capacity/i.test(fact.text))).toBe(true);
    expect(selected.facts.some((fact) => /^The figure/i.test(fact.text))).toBe(false);
  });

  it("re-filters stored enriched facts and retains a unique RSS fact", () => {
    const selected = selectReaderEvidence("Acme raises funding", [
      {
        excerpt: "Acme will use the proceeds to build a factory in Osaka.",
        enrichedEvidence: [
          { kind: "fact", text: "Welcome back to our weekly column about funding announcements." },
          {
            kind: "fact",
            text: "Acme raised $18.5 million to expand its manufacturing operations.",
          },
        ],
      },
    ]);
    expect(selected.rejectedCount).toBe(1);
    expect(selected.facts.map((f) => f.origin)).toEqual(["enriched", "rss"]);
  });
  it("drops legacy metadata templates and orphan numbers from structured fallback", () => {
    const s = story(0);
    s.understand = {
      version: 2,
      coverage: "thin",
      oneSentence: "A company reported a funding round.",
      numbers: [{ value: "18.5 million", label: "Amount mentioned", evidence: [1] }],
      newDevelopments: [],
      context: [
        {
          text: "The coverage centers on Apple, Intel, Meta, and Anthropic.",
          evidence: [1],
          kind: "context",
        },
      ],
      relationships: null,
      audiences: [],
      whatNext: [],
      perspectives: [],
      unknowns: [],
      watchNext: [],
      timeline: [],
      conflicts: [],
      comparison: null,
      series: null,
      overview: [],
    };
    s.what = "A company reported a funding round.";
    expect(textOf(s)).not.toMatch(/Amount mentioned|coverage centers on|18.5/);
  });
});
