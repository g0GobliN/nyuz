import { describe, it, expect } from "vitest";
import {
  auditDeterministicArticle,
  composeArticle,
  composeArticleWithDiagnostics,
} from "./editorial";
import {
  deterministicFactType,
  validDeterministicParagraph,
  validDeterministicSentence,
} from "./reader-evidence";
import type { Story } from "@/lib/story";
import type { EventIntelligence, EvidenceUnit } from "@/lib/understand";

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

const makeIntelligence = (overrides: Partial<EventIntelligence> = {}): EventIntelligence => ({
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

const bodyOf = (story: Story) =>
  composeArticle(story)
    .paragraphs.map((paragraph) => paragraph.text)
    .join("\n\n");

describe("composeArticle", () => {
  it("returns the authored article untouched when the analysis wrote one", () => {
    const article = {
      deck: { text: "The deck.", evidence: [1] },
      paragraphs: [
        { text: "The opening paragraph.", evidence: [1] },
        { text: "A later turn in the story.", evidence: [2], heading: "After the vote" },
      ],
    };
    const story = makeStory({ understand: makeIntelligence({ article }) });

    expect(composeArticle(story)).toEqual(article);
  });

  it("prefers authored prose over the extracted statements", () => {
    const story = makeStory({
      understand: makeIntelligence({
        article: {
          deck: { text: "Authored deck.", evidence: [] },
          paragraphs: [{ text: "Authored body.", evidence: [] }],
        },
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });

    expect(bodyOf(story)).toBe("Authored body.");
  });

  it("falls back to the story summary as the deck", () => {
    // The summary is a *candidate*, not a conclusion: it is judged as a
    // sentence before it may render. This one is a clause, so it publishes.
    const story = makeStory({ what: "The council approved a new library" });

    expect(composeArticle(story).deck.text).toBe("The council approved a new library.");
  });

  it("falls back to the one-sentence analysis when the story has no summary", () => {
    const story = makeStory({
      what: "   ",
      understand: makeIntelligence({ oneSentence: "The analysed sentence." }),
    });

    expect(composeArticle(story).deck.text).toBe("The analysed sentence.");
  });

  it("never emits analytical headings in the fallback article", () => {
    const story = makeStory({
      before: "It used to be one way",
      after: "Now it is another",
      understand: makeIntelligence({
        numbers: [{ value: "$1B", label: "Funding", evidence: [1] }],
        audiences: [{ audience: "developers", implication: "Your stack changes", evidence: [1] }],
        watchNext: [{ label: "The vote", detail: "Scheduled for March", evidence: [2] }],
      }),
    });

    for (const paragraph of composeArticle(story).paragraphs) {
      expect(paragraph.heading).toBeUndefined();
    }
  });

  it("groups related statements into paragraphs rather than one block each", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [
          {
            value: "$1B",
            label: "The company raised $1B in funding for its new factory.",
            evidence: [1],
          },
          {
            value: "40%",
            label: "Revenue growth reached 40% during the last financial year.",
            evidence: [2],
          },
        ],
      }),
    });
    const numbers = composeArticle(story).paragraphs.filter((p) => p.text.includes("funding"));

    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.text).toContain("growth reached 40%");
  });

  it("carries the evidence of every statement it merges into a paragraph", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [
          {
            value: "$1B",
            label: "The company raised $1B in funding for its new factory.",
            evidence: [1],
          },
          {
            value: "40%",
            label: "Revenue growth reached 40% during the last financial year.",
            evidence: [3],
          },
        ],
      }),
    });
    const numbers = composeArticle(story).paragraphs.find((p) => p.text.includes("funding"));

    expect(numbers?.evidence).toEqual([1, 3]);
  });

  it("drops statements the deck already made, and keeps their evidence on it", () => {
    const story = makeStory({
      what: "",
      understand: makeIntelligence({
        oneSentence: "The company raised money.",
        newDevelopments: [{ text: "The company raised money.", evidence: [2], kind: "reported" }],
        context: [{ text: "The company raised money.", evidence: [3], kind: "context" }],
      }),
    });
    const article = composeArticle(story);
    const mentions = article.paragraphs.filter((p) => p.text.includes("The company raised money"));

    expect(article.deck.text).toBe("The company raised money.");
    expect(article.deck.evidence).toEqual([2, 3]);
    expect(mentions).toHaveLength(0);
  });

  it("does not repeat the deck sentence in the body", () => {
    const story = makeStory({
      what: "The company raised money.",
      understand: makeIntelligence({
        oneSentence: "The company raised money.",
        context: [{ text: "Investors had waited two years.", evidence: [1], kind: "context" }],
      }),
    });

    expect(bodyOf(story)).not.toContain("The company raised money.");
    expect(bodyOf(story)).toContain("Investors had waited two years.");
  });

  it("terminates statements that arrive without punctuation", () => {
    const story = makeStory({
      what: "",
      understand: makeIntelligence({
        oneSentence: "",
        unknowns: ["Nobody has said who pays"],
      }),
    });

    expect(bodyOf(story)).toContain("Nobody has said who pays.");
  });

  it("reads a relationship map as prose rather than a diagram", () => {
    const story = makeStory({
      understand: makeIntelligence({
        relationships: {
          nodes: [
            { id: "a", label: "Meta", type: "org" },
            { id: "b", label: "Muse", type: "product" },
          ],
          edges: [{ from: "a", to: "b", label: "releases", evidence: [1] }],
        },
      }),
    });

    expect(bodyOf(story)).toContain("Meta releases Muse.");
  });

  it("keeps a conflict's competing reports together under its topic", () => {
    const story = makeStory({
      understand: makeIntelligence({
        conflicts: [
          {
            topic: "The price",
            reports: [
              { text: "One outlet reported $10", evidence: [1] },
              { text: "Another reported $12", evidence: [2] },
            ],
          },
        ],
      }),
    });
    const conflict = composeArticle(story).paragraphs.find((p) => p.text.includes("The price"));

    expect(conflict?.text).toContain("One outlet reported $10");
    expect(conflict?.text).toContain("Another reported $12");
    expect(conflict?.evidence).toEqual([1, 2]);
  });

  it("keeps an event with no analysis readable", () => {
    const article = composeArticle(makeStory({ understand: undefined as never }));

    // The summary reaches the deck through the same judge a fallback does, so it
    // arrives cleaned and terminated rather than as the raw stored string.
    expect(article.deck.text).toBe("Something happened.");
    expect(article.paragraphs).toEqual([]);
  });

  it("returns an empty article rather than blank paragraphs for an empty event", () => {
    const article = composeArticle(
      makeStory({ what: "", understand: makeIntelligence({ oneSentence: "" }) }),
    );

    expect(article.deck.text).toBe("");
    expect(article.paragraphs).toEqual([]);
  });

  it("produces deterministic output for the same event", () => {
    const story = makeStory({
      understand: makeIntelligence({
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });

    expect(composeArticle(story)).toEqual(composeArticle(story));
  });

  it("preserves projection attribution and exposes deterministic quality diagnostics", () => {
    expect(deterministicFactType("The report projects 395 million tonnes by 2050.")).toBe(
      "projection",
    );
    const article = composeArticle(
      makeStory({
        understand: undefined as never,
        sourceList: [
          {
            name: "BAN",
            at: "",
            excerpt: "BAN's model projects 395 million tonnes of waste by 2050.",
          },
        ],
        what: "",
      }),
    );
    expect(
      [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" "),
    ).toMatch(/BAN.*projects|BAN.*reports/i);
    expect(auditDeterministicArticle(article).malformedParagraphs).toBe(0);
  });

  describe("without any analysis (AI never ran or is unavailable)", () => {
    it("builds a substantial article from the source excerpts alone", () => {
      const story = makeStory({
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt:
              "Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion in cash and stock. The deal is expected to close in the first quarter, pending regulatory approval.",
          },
          {
            name: "Bloomberg",
            at: "11:00",
            excerpt:
              "Nvidia's acquisition of Hugging Face values the AI startup at $13 billion, according to people familiar with the matter. Regulators in the US and EU are expected to review the deal.",
          },
          {
            name: "The Verge",
            at: "12:00",
            excerpt:
              "Hugging Face will keep operating under its own brand after the deal closes. The company said 40% of its engineering team will report to Nvidia's AI division.",
          },
        ],
      });

      const article = composeArticle(story);
      const words = [article.deck.text, ...article.paragraphs.map((p) => p.text)]
        .join(" ")
        .trim()
        .split(/\s+/).length;

      expect(article.paragraphs.length).toBeGreaterThan(1);
      expect(words).toBeGreaterThanOrEqual(60);
      expect(article.paragraphs.every((p) => p.evidence.length > 0 || p.text.length > 0)).toBe(
        true,
      );
    });

    it("stays thin for a single unhelpful source rather than inventing content", () => {
      const story = makeStory({
        understand: undefined as never,
        what: "",
        sourceList: [{ name: "Source One", at: "10:00" }],
      });

      const article = composeArticle(story);

      expect(article.paragraphs).toEqual([]);
    });

    it("adds a background paragraph from related nyuz coverage when supplied", () => {
      const story = makeStory({
        title: "Acme confirms the second phase of its plan",
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt: "The company confirmed the second phase of its plan will begin next month.",
          },
        ],
        relatedEvents: [
          {
            id: "prior-1",
            title: "Acme announced phase one",
            summary: "Acme announced phase one last quarter.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).toContain("Previously, Acme announced phase one last quarter.");
      expect(body).not.toContain("nyuz has also covered");
    });

    it("never fabricates related coverage when none is supplied", () => {
      const story = makeStory({
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt: "The company confirmed the second phase of its plan will begin next month.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).not.toContain("nyuz has also covered");
    });
  });

  /**
   * The paragraph-loss regression, found by composing a real event.
   *
   * Three facts that each passed `validDeterministicSentence` were grouped into
   * one paragraph of 516 characters. The gate then handed that paragraph to the
   * sentence validator, which refuses anything over 420 characters, and the whole
   * block went -- two publishable facts with it. The two units have different
   * limits for a reason: 420 characters describes a sentence, not a paragraph.
   */
  describe("a paragraph is not a sentence", () => {
    const SENTENCES = [
      "Regulators in the United States and the European Union are expected to review the proposed transaction during the first quarter of next year, according to two people familiar with the filing.",
      "The company said the deal would give it access to a larger customer base and a research team of about four hundred engineers working on model training and inference infrastructure.",
      "Analysts covering the sector expect the combined business to report revenue of about $2.4 billion in its first full year of operation, with margins improving as the integration proceeds.",
    ];

    const longStory = () =>
      makeStory({
        title: "Acme acquires Beta",
        understand: undefined as never,
        what: "",
        sources: 1,
        sourceList: [{ name: "Reuters", at: "10:00", excerpt: SENTENCES.join(" ") }],
      });

    it("fits the preconditions: each sentence valid, the block over the sentence limit", () => {
      for (const text of SENTENCES) expect(validDeterministicSentence(text)).toBe(true);
      const block = SENTENCES.join(" ");
      expect(block.length).toBeGreaterThan(420);
      expect(block.split(/\s+/).length).toBeLessThan(140);
    });

    it("publishes every valid fact in an over-long paragraph instead of dropping the block", () => {
      const story = longStory();
      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
      // The assertion is about publishing the facts, not about one phrase inside
      // them: the story is dated 2026-01-01 and the composer anchors "next year"
      // to the year it referred to (2027). A relative date is unusable in a story
      // read later, so the anchored form is what the reader gets.
      for (const sentence of SENTENCES) {
        const published = sentence.replace("next year", "2027");
        expect(validDeterministicSentence(published)).toBe(true);
        expect(text).toContain(published.replace(/\.$/, ""));
      }
      expect(article.paragraphs.length).toBeGreaterThan(0);
      expect(diagnostics.paragraphs.rejected).toBe(0);
      expect(diagnostics.fallbackLevel).toBe(1);
    });

    it("keeps every selected fact visible: rendered plus lost is selected", () => {
      const { diagnostics } = composeArticleWithDiagnostics(longStory());
      expect(diagnostics.facts.selected).toBeGreaterThan(0);
      expect(diagnostics.facts.rendered + diagnostics.facts.lost).toBe(diagnostics.facts.selected);
      expect(diagnostics.facts.lost).toBe(0);
    });

    it("validates a paragraph as a paragraph", () => {
      expect(validDeterministicParagraph(SENTENCES.join(" "))).toBe(true);
      // The same sentence twice is a composition error, not a paragraph.
      expect(validDeterministicParagraph(`${SENTENCES[0]} ${SENTENCES[0]}`)).toBe(false);
      // A provider field inside a block is a leak however the block was built.
      expect(
        validDeterministicParagraph(
          `ArXiv:2609.21081v1 Announce Type: new Abstract: ${SENTENCES[0]}`,
        ),
      ).toBe(false);
      // A single sentence is a paragraph too, but an empty block is not.
      expect(validDeterministicParagraph(SENTENCES[0]!)).toBe(true);
      expect(validDeterministicParagraph("   ")).toBe(false);
    });
  });

  /**
   * Reading a paper forwards is right for a paper. It must not become how the
   * rest of the product composes: a news event wants its most relevant fact
   * first, and that is a scoring decision, not a positional one.
   */
  describe("single-paper ordering is scoped to a single paper", () => {
    const DULL = "The company said the filing was routine and contained nothing unusual.";
    const STRONG = "Acme reported quarterly revenue of $18.5 million in the period.";
    const excerpt = `${DULL} ${STRONG}`;

    const composed = (sourceList: Story["sourceList"]) =>
      composeArticle(
        makeStory({
          title: "Acme reports $18.5 million",
          understand: undefined as never,
          what: "",
          sources: sourceList.length,
          sourceList,
        }),
      );

    it("leads a single paper with the paper's own first sentence", () => {
      const article = composed([{ name: "arXiv cs.CR", at: "10:00", excerpt }]);
      expect(article.deck.text).toContain("filing was routine");
    });

    it("keeps relevance scoring for a single news source", () => {
      const article = composed([{ name: "The Register", at: "10:00", excerpt }]);
      expect(article.deck.text).not.toContain("filing was routine");
      expect(article.deck.text).toContain("18.5 million");
    });

    it("keeps relevance scoring when a repository supplied more than one document", () => {
      const article = composed([
        { name: "arXiv cs.CR", at: "10:00", excerpt },
        {
          name: "arXiv cs.AI",
          at: "11:00",
          excerpt: "A second paper describes a different result.",
        },
      ]);
      expect(article.deck.text).not.toContain("filing was routine");
    });
  });

  describe("provider metadata in a feed description", () => {
    /**
     * The production regression, verbatim: arXiv's cs.CR feed serves its
     * description as `ArXiv:<id> Announce Type: <type> Abstract: <abstract>`,
     * which shipped as the deck *and* as a paragraph, attributed to the
     * repository and its subject category.
     */
    const DESCRIPTION =
      "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation.";
    const ABSTRACT =
      "Human approval is often treated as the last security boundary before an agent executes a consequential operation.";
    const TITLE = "Loopjacking: Hijacking Human-in-the-Loop Approval";

    const arxivStory = (evidence: EvidenceUnit[]) =>
      makeStory({
        title: TITLE,
        understand: undefined as never,
        what: "",
        sources: 1,
        sourceList: [
          { name: "arXiv cs.CR", at: "10:00", excerpt: DESCRIPTION, enrichedEvidence: evidence },
        ],
      });

    const wholeText = (story: Story) => {
      const article = composeArticle(story);
      return [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    };

    it("never publishes the feed header, and never as two copies of one fact", () => {
      const article = composeArticle(arxivStory([]));
      const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");

      expect(text).not.toMatch(/ArXiv:2609\.21081v1/i);
      expect(text).not.toMatch(/Announce Type:/i);
      expect(text).not.toMatch(/\bAbstract:/);
      expect(text).not.toMatch(/cs\.CR/);
      expect(text).not.toMatch(/According to arXiv/i);
      expect(text).toContain("Human approval is often treated as the last security boundary");
      // Exactly once: the same sentence must not be the deck and a paragraph.
      expect(text.match(/Human approval is often treated/g)).toHaveLength(1);
      // One fact is one paragraph -- the deck carries it and nothing repeats it.
      expect(article.paragraphs).toEqual([]);
      expect(article.deck.evidence).toEqual([1]);
    });

    it("uses neutral paper attribution instead of crediting the repository", () => {
      const deck = composeArticle(arxivStory([])).deck.text;
      // The attribution follows the fact. A leading label has to be lower-cased
      // to become a clause, and whether the word after it is a proper noun is not
      // something the composer can know -- which is why the label existed. The
      // paper is still the actor, and arXiv is still not.
      expect(deck).toMatch(/, a new paper reports\.$/);
      expect(deck).not.toMatch(/arXiv/i);
      expect(deck).not.toMatch(/^[^:]{0,40}: /);
    });

    it("composes the same text whichever order the dirty and clean variants arrive", () => {
      const dirtyFirst = wholeText(
        arxivStory([
          { kind: "fact", text: DESCRIPTION },
          { kind: "fact", text: ABSTRACT },
        ]),
      );
      const cleanFirst = wholeText(
        arxivStory([
          { kind: "fact", text: ABSTRACT },
          { kind: "fact", text: DESCRIPTION },
        ]),
      );
      expect(dirtyFirst).toBe(cleanFirst);
      expect(dirtyFirst).toContain("Human approval is often treated");
      expect(dirtyFirst.match(/Human approval is often treated/g)).toHaveLength(1);
    });

    it("keeps provenance when a clean and a decorated variant merge", () => {
      const story = makeStory({
        title: TITLE,
        understand: undefined as never,
        what: "",
        sources: 2,
        sourceList: [
          { name: "arXiv cs.CR", at: "10:00", excerpt: DESCRIPTION },
          { name: "The Register", at: "11:00", excerpt: ABSTRACT },
        ],
      });
      const article = composeArticle(story);
      expect(article.deck.evidence).toEqual([1, 2]);
      expect(wholeText(story)).not.toMatch(/ArXiv:|Announce Type:|According to arXiv/i);
    });

    it("reports what normalization removed and what the gate refused", () => {
      const { article, diagnostics } = composeArticleWithDiagnostics(arxivStory([]));
      expect(diagnostics.sourceNormalization.removedMetadataFields).toBeGreaterThanOrEqual(3);
      expect(diagnostics.sourceNormalization.cleanedEvidence).toBeGreaterThanOrEqual(1);
      expect(diagnostics.qualityGate.metadataLeakWarnings).toBe(0);
      expect(diagnostics.qualityGate.malformedAttributionWarnings).toBe(0);
      expect(article.deck.text).toContain("Human approval");
    });

    it("flags leakage and repository attribution in the quality audit", () => {
      const report = auditDeterministicArticle({
        deck: {
          text: "According to arXiv cs.CR, Human approval is often treated as the last security boundary before an agent executes a consequential operation.",
          evidence: [1],
        },
        paragraphs: [
          {
            text: "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary.",
            evidence: [1],
          },
        ],
      });
      expect(report.metadataLeakWarnings).toBe(1);
      expect(report.malformedAttributionWarnings).toBe(1);
    });

    /**
     * The same production event, with the excerpt the feed actually stored --
     * the full 1,605-character abstract, first person and all -- rather than
     * the single sentence the earlier fixture reduced it to.
     */
    describe("the real abstract", () => {
      const EXCERPT =
        "arXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation. That boundary is only meaningful if the operation presented for review is the operation later authorized or released. We call failures of this binding Loopjacking: a human approves what they understand as operation A, while the implementation uses that decision for a materially different operation B. We distinguish two variants. In a representation-based attack, B is already encoded but omitted or misrepresented at approval time; in a post-approval state-substitution attack, the human sees the correct A and mutable workflow state later replaces it with B. We evaluate a purposive set of released agent products. We reproduce post-approval substitution in seven tested Agno AgentOS releases ending at 3.0.9 and in 12 tested versions of a conditional in-memory LangGraph Agent Server composition ending at 0.14.0. We reproduce representation mismatch in OpenClaw 2026.2.23 and its rejection in 2026.2.24. OpenAI Agents SDK 0.22.0 and 0.22.2 provide a negative control: serialized continuation preserves exact per-call binding and rejects mutated B. These results do not estimate ecosystem prevalence. They show that complete canonical approval rendering and exact use-time comparison, or preventing unauthorized pending-state mutation, block the tested attacks while preserving legitimate execution. We separate this contribution from established work on misleading dialogs, session smuggling, action binding, and authorization continuity.";

      const wholeStory = () =>
        makeStory({
          title: TITLE,
          understand: undefined as never,
          what: "",
          sources: 1,
          sourceList: [{ name: "arXiv cs.CR", at: "10:00", excerpt: EXCERPT }],
        });

      const composed = () => {
        const { article, diagnostics } = composeArticleWithDiagnostics(wholeStory());
        return {
          article,
          diagnostics,
          text: [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" "),
        };
      };

      it("keeps the metadata out and publishes more than one sentence", () => {
        const { article, text } = composed();
        expect(text).not.toMatch(/ArXiv:|arXiv:|Announce Type:/i);
        expect(text).not.toMatch(/\bAbstract:/);
        expect(text).not.toMatch(/cs\.CR/);
        // The abstract is 11 sentences; only one of them used to survive.
        expect(article.paragraphs.length).toBeGreaterThan(1);
        expect(text.split(/\s+/).length).toBeGreaterThan(80);
      });

      it("resolves the paper's first person to its authors rather than dropping it", () => {
        const { text } = composed();
        expect(text).not.toMatch(/\bWe\b|\bOur\b/);
        expect(text).toContain("The authors call failures of this binding Loopjacking");
        expect(text).toContain("The authors distinguish two variants");
      });

      it("reads the paper in the order it was written", () => {
        const { article, text } = composed();
        // The abstract's own first sentence is the lead, so nothing is published
        // ahead of the sentence it depends on.
        expect(article.deck.text).toContain(
          "Human approval is often treated as the last security boundary",
        );
        // An abstract is read forwards and says so: "That boundary", "These
        // results", "They show" all refer to a sentence some distance back. Every
        // sentence that survives has to appear in its own document's order.
        const order = [
          "Human approval is often treated",
          "That boundary is only meaningful",
          "The authors call failures of this binding",
          "The authors distinguish two variants",
          "In a representation-based attack",
          "The authors evaluate a purposive",
          "The authors reproduce post-approval substitution",
          "The authors reproduce representation mismatch",
          "OpenAI Agents SDK 0.22.0",
          "These results do not estimate",
          "They show that complete canonical approval rendering",
          "The authors separate this contribution",
        ];
        const positions = order.map((needle) => text.indexOf(needle));
        for (const [index, position] of positions.entries()) {
          expect(position, `sentence ${index} is published`).toBeGreaterThanOrEqual(0);
        }
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      });

      it("does not stack one attribution on another", () => {
        // The deck used to be prefixed regardless, which with a resolved author
        // subject read "A new paper reports: The authors call ...". A label is
        // gone from the article entirely now, so the assertion is about the fact
        // rather than about one spelling of the frame.
        const { article } = composed();
        expect(article.deck.text).not.toMatch(
          /\b(?:paper|study|authors|researchers)\b[^.]{0,40}:\s/,
        );
        expect(article.deck.text).not.toMatch(/reports?\s+that\s+The authors\b/);
      });

      it("keeps provenance on every block it publishes", () => {
        const { article } = composed();
        expect(article.deck.evidence).toEqual([1]);
        for (const paragraph of article.paragraphs) expect(paragraph.evidence).toEqual([1]);
      });

      it("accounts for every selected fact", () => {
        const { diagnostics } = composed();
        expect(diagnostics.facts.selected).toBeGreaterThan(1);
        expect(diagnostics.facts.rendered).toBe(diagnostics.facts.selected);
        expect(diagnostics.facts.lost).toBe(0);
        expect(diagnostics.sourceNormalization.authorialVoiceRewrites).toBeGreaterThan(0);
        expect(diagnostics.sentences.refused).toBe(0);
        expect(diagnostics.paragraphs.rejected).toBe(0);
        expect(diagnostics.fallbackLevel).toBe(1);
      });

      it("publishes the version numbers without splitting them into fake sentences", () => {
        const { text } = composed();
        expect(text).toContain("ending at 3.0.9");
        expect(text).toContain("0.22.2");
      });
    });

    it("leaves an authored article untouched", () => {
      const authored = {
        deck: { text: "Authored deck about the paper.", evidence: [1] },
        paragraphs: [{ text: "Authored body about loopjacking.", evidence: [1] }],
      };
      const story = arxivStory([]);
      story.understand = makeIntelligence({ article: authored });
      expect(composeArticle(story)).toEqual(authored);
    });
  });
});
