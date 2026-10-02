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
import type { EventIntelligence } from "@/lib/understand";

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
  it("ignores stored authored prose and composes from current source evidence", () => {
    const article = {
      deck: { text: "The council approved the library on Monday.", evidence: [1] },
      paragraphs: [
        { text: "The project includes a reading room and longer opening hours.", evidence: [1] },
        {
          text: "Funding will come from the community development budget.",
          evidence: [1],
          heading: "Funding",
        },
      ],
    };
    const story = makeStory({
      title: "Council approves public library",
      sourceList: [
        {
          name: "Source One",
          at: "10:00",
          headline: "Council approves public library",
          excerpt:
            "The council approved the library on Monday. The project includes a reading room and longer opening hours. Funding will come from the community development budget.",
        },
      ],
      understand: makeIntelligence({ article }),
    });

    const rendered = composeArticle(story);
    const text = [rendered.deck.text, ...rendered.paragraphs.map((part) => part.text)].join(" ");

    expect(rendered).not.toEqual(article);
    expect(text).toContain("reading room");
    expect(text).toContain("community development budget");
    expect(rendered.paragraphs.every((part) => part.heading === undefined)).toBe(true);
  });

  it("ignores every legacy analysis field when composing a story", () => {
    const sourceOnly = makeStory({
      title: "Council approves public library",
      what: "",
      sourceList: [
        {
          name: "Source One",
          at: "10:00",
          headline: "Council approves public library",
          excerpt:
            "The council approved the library on Monday. The project includes a reading room and longer opening hours.",
        },
      ],
    });
    const withAnalysis = makeStory({
      ...sourceOnly,
      understand: makeIntelligence({
        oneSentence: "Analysis says a bridge collapsed.",
        context: [
          {
            text: "The company raised $900 million for a new factory.",
            evidence: [1],
            kind: "context",
          },
        ],
      }),
    });

    expect(composeArticle(withAnalysis)).toEqual(composeArticle(sourceOnly));
  });

  it("falls back to the source composer instead of showing malformed or unrelated cached prose", () => {
    const story = makeStory({
      title: "Council approves public library",
      what: "The council approved a new public library on Monday.",
      sourceList: [
        {
          name: "The Register",
          at: "10:00",
          headline: "Council approves public library",
          excerpt:
            "The council approved a new public library on Monday. The project includes a reading room and longer opening hours.",
        },
      ],
      understand: makeIntelligence({
        article: {
          deck: { text: "The council approved a new public library.", evidence: [1] },
          paragraphs: [
            {
              text: "The Register reports that In an internal memo, the company announced a new plan.",
              evidence: [1],
            },
          ],
        },
      }),
    });

    const text = [
      composeArticle(story).deck.text,
      ...composeArticle(story).paragraphs.map((p) => p.text),
    ].join(" ");
    expect(text).not.toContain("The Register reports that In an internal memo");
    expect(text).toContain("reading room");
  });

  it("never glues a leading capital or a fronted adverbial after `reports that`", () => {
    // Production, 2026-09-30, AMD/World Labs: five of seven paragraphs opened
    // with the outlet's name, and three of those could not follow `that` at all
    // -- a participle ("Founded in early 2024, ..."), a fronted adverbial
    // ("As part of the deal, ...") and a plain subject ("The acquisition ...").
    // The citation carries provenance for a sentence that cannot take a
    // leading attribution, so nothing is lost by not inventing one.
    const story = makeStory({
      title: "AMD bets that worlds matter more than words in AI",
      what: "AMD agreed to acquire World Labs in a deal valued at $8.2 billion.",
      sourceList: [
        {
          name: "The Register",
          at: "07:01",
          headline: "AMD bets",
          excerpt:
            "AMD dove deeper into AI model development with an agreement to acquire Fei-Fei Li's World Labs. " +
            "The House of Zen claims the all-stock deal is expected to close by year's end pending approval. " +
            "Founded in early 2024, San Francisco-based World Labs has focused its efforts on developing spatial-intelligence models. " +
            "As part of the deal, World Labs will continue its work on advanced AI models while Li joins AMD as chief scientist. " +
            "The acquisition is also a hedge that LLMs, which have fueled the AI bubble up to this point, might be a dead end.",
        },
      ],
    });

    const body = bodyOf(story);
    expect(body).not.toMatch(/reports that [A-Z]/);
    expect(body).not.toContain("reports that Founded");
    expect(body).not.toContain("reports that As part");
    expect(body).not.toContain("reports that The acquisition");
    // The claim the wrap cannot carry still keeps its provenance, moved behind
    // the fact rather than dropped with the invented clause.
    expect(body).toMatch(/according to The Register\.$/m);
    expect(body).toContain("spatial-intelligence models");
  });

  it("falls back to deterministic source prose when a cached article has no support", () => {
    const story = makeStory({
      title: "Council approves public library",
      what: "The council approved a new public library on Monday.",
      sourceList: [
        {
          name: "The Register",
          at: "10:00",
          headline: "Council approves public library",
          excerpt:
            "The council approved a new public library on Monday. The project includes a reading room and longer opening hours.",
        },
      ],
      understand: makeIntelligence({
        article: {
          deck: { text: "The council approved a new public library.", evidence: [] },
          paragraphs: [
            {
              text: "Nvidia released a new graphics card for professional gaming customers worldwide.",
              evidence: [],
            },
          ],
        },
        numbers: [{ value: "$1", label: "Value", evidence: [1] }],
      }),
    });

    expect(bodyOf(story)).toContain("reading room");
    expect(bodyOf(story)).not.toContain("Nvidia");
  });

  it("falls back to the story summary as the deck", () => {
    // The summary is a *candidate*, not a conclusion: it is judged as a
    // sentence before it may render. This one is a clause, so it publishes.
    const story = makeStory({ what: "The council approved a new library" });

    expect(composeArticle(story).deck.text).toBe("The council approved a new library.");
  });

  it("strips a backwards-referencing connector from the deck", () => {
    // Production, 2026-10-01: the story page opened "Meanwhile, The Register
    // reports that advanced chip packaging ..." -- a connector that refers to
    // discourse the page does not contain, hoisted in front of the attribution
    // by the adverbial branch. A page's first line may not point backwards.
    const story = makeStory({
      sources: 1,
      sourceList: [{ name: "The Register", at: "10:00", url: "https://theregister.com" }],
      what: "Meanwhile, advanced chip packaging is emerging as another constraint on how quickly AI capacity can come online.",
    });

    const deck = composeArticle(story).deck.text;
    expect(deck).not.toMatch(/^meanwhile\b/i);
    expect(deck.toLowerCase()).toContain("advanced chip packaging");
  });

  it("does not use the one-sentence analysis when the story has no source summary", () => {
    const story = makeStory({
      what: "   ",
      understand: makeIntelligence({ oneSentence: "The analysed sentence." }),
    });

    expect(composeArticle(story).deck.text).toBe("");
  });

  it("does not return model-authored prose even when source evidence is missing", () => {
    const story = makeStory({
      sourceList: [],
      what: "",
      understand: makeIntelligence({
        article: {
          deck: { text: "A generated deck about an unrelated event.", evidence: [1] },
          paragraphs: [{ text: "Generated prose that has no source support.", evidence: [1] }],
        },
      }),
    });

    expect(composeArticle(story)).toEqual({
      deck: { text: "", evidence: [] },
      paragraphs: [],
    });
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

    it("names the facts behind `lost`, because the number has to be readable", () => {
      // `lost` means "selected, and no rule refused it by *name*". A block-level
      // refusal charges the sentence, not the fact behind it, so those facts land
      // here -- and a number nobody can read is not a bug report. The refused
      // fact is excluded by name, which is what keeps the two classes apart.
      // Two sources, so the composer ranks rather than reading one document
      // forwards: a lone short fact is then a block under the paragraph floor,
      // which is the refusal that charges a sentence and loses a fact.
      const story = makeStory({
        title: "Oracle's Wisconsin build slips",
        understand: undefined as never,
        what: "",
        sources: 2,
        sourceList: [
          {
            name: "The Register",
            at: "10:00",
            excerpt:
              "Oracle says the development remains on schedule. Regulators must still approve the grid connection before construction can start.",
          },
          {
            name: "Reuters",
            at: "11:00",
            excerpt: "Implementation is delayed. They also delayed the substation work.",
          },
        ],
      });
      const { diagnostics } = composeArticleWithDiagnostics(story);
      expect(diagnostics.facts.lostFacts).toEqual(["Implementation is delayed."]);
      expect(diagnostics.facts.lost).toBe(diagnostics.facts.lostFacts.length);
      expect(diagnostics.sentences.reasons["short_block"]).toBe(1);
      // The context-dependent fact was refused by name, so it is explained and
      // not listed: `lost` keeps meaning "nothing refused it".
      expect(diagnostics.facts.refused).toBe(1);
      expect(diagnostics.facts.lostFacts).not.toContain("They also delayed the substation work.");
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

    it("reads a paper forwards", () => {
      const excerpt =
        "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation.";
      const paper = makeStory({
        title: "Loopjacking",
        what: "",
        sourceList: [{ name: "arXiv cs.CR", at: "10:00", excerpt }],
      });
      expect(composeArticle(paper).deck.text).toContain("Human approval");
    });
  });
});

describe("a preview of something that has already happened", () => {
  const previewStory = (excerpt: string) =>
    makeStory({
      title: "OpenAI DevDay 2026: the biggest news and announcements",
      publishedAt: "2026-09-30T01:00:00Z",
      sourceList: [
        {
          name: "The Verge",
          at: "16:00",
          headline: "OpenAI DevDay 2026",
          excerpt,
        },
      ],
    });

  it("refuses the sentence that announces a date the reader has lived through", () => {
    const story = previewStory(
      "The company is hosting its annual DevDay on September 29th in San Francisco, starting with a live keynote featuring CEO Sam Altman. Tickets sold out within an hour of going on sale.",
    );
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    const text = [article.deck.text, ...article.paragraphs.map((part) => part.text)].join(" ");

    expect(text).not.toContain("is hosting its annual DevDay");
    expect(text).toContain("Tickets sold out");
    expect(diagnostics.qualityGate.stalePreviewRefusals).toBe(1);
    expect(diagnostics.sentences.reasons["stale_preview"]).toBe(1);
  });

  it("keeps the same framing for a date still ahead", () => {
    const story = previewStory(
      "The company is hosting its annual DevDay on October 15th in San Francisco, with a live keynote from CEO Sam Altman. Tickets went on sale this morning.",
    );
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    const text = [article.deck.text, ...article.paragraphs.map((part) => part.text)].join(" ");

    expect(text).toContain("is hosting its annual DevDay on October 15th");
    expect(diagnostics.qualityGate.stalePreviewRefusals).toBe(0);
  });

  it("keeps a past date that is reporting rather than promising", () => {
    const story = previewStory(
      "The company met analysts on September 29 and raised its outlook for the quarter. Shares rose four percent in after-hours trading.",
    );
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    const text = [article.deck.text, ...article.paragraphs.map((part) => part.text)].join(" ");

    expect(text).toContain("on September 29");
    expect(diagnostics.qualityGate.stalePreviewRefusals).toBe(0);
  });
});
