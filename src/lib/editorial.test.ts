import { describe, it, expect } from "vitest";
import {
  auditDeterministicArticle,
  composeArticle,
  composeArticleWithDiagnostics,
  contextSplice,
} from "./editorial";
import {
  antecedentSupplied,
  contextDependent,
  deterministicFactType,
  readerSentences,
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

/** The deck and the body as one string, the way a reader reads the page. */
const publishedTextOf = (story: Story) =>
  [composeArticle(story).deck.text, ...bodyOf(story).split("\n\n")].join("\n\n");

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

  it("refuses a summary that is the source's own markup", () => {
    // Production, 2026-10-03: this event's whole deck was the tail of a feed's
    // image tag -- attribute assignments, a closing residue and a URL, with no
    // tag name anywhere -- because the terse branch only asked for a clause.
    const story = makeStory({
      what: ' data-portal-copyright="Image: Nabu Casa " /> src="https://news.home-assistant.io/post" Home Assistant is renaming its cloud service Home Assistant Link and',
    });

    const deck = composeArticle(story).deck.text;
    expect(deck).not.toContain("data-portal-copyright");
    expect(deck).not.toContain("home-assistant.io");
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

  it("gives the deck to the next fact when the best-ranked one needs an antecedent", () => {
    // Production fixture, 2026-10-10: the story's own opening sentence was the
    // one the source wrote second, so the deck read "Those were among the
    // descriptions more than three dozen mathematicians reached for ..." and no
    // page the reader has contains a single description. A paragraph resolves
    // this by adjacency; a deck has nothing before it, so the rule is absolute.
    const story = makeStory({
      sources: 1,
      what: "",
      sourceList: [
        {
          name: "The Verge",
          at: "10:00",
          url: "https://theverge.com",
          excerpt:
            "Those were among the descriptions mathematicians reached for in conversations this week. The lab published forty pages of results on Tuesday.",
        },
      ],
    });

    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    expect(article.deck.text).not.toMatch(/^those\b/i);
    expect(article.deck.text).toContain("forty pages of results");
    // The displaced fact is not charged as a defect: it is still a fact, and the
    // body path decides its sentence-level fate on its own terms.
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("prefers a fact that reports the event over one that opens on a quotation", () => {
    // Card 01 of the delivered 2026-10-18 briefing opened on an attributed quote
    // that said nothing about what happened (*"The primary thing that we see with
    // any attack on building management systems … It's a great place for the
    // threat actor to hide,"*). The arbiter ruled (#10a) that a reporting fact
    // outranks a quote, with the quote kept as the fallback. Ranking within each
    // group is untouched: this takes the first non-quote candidate.
    const story = makeStory({
      sources: 1,
      what: "",
      sourceList: [
        {
          name: "The Guardian World",
          at: "10:00",
          url: "https://theguardian.com",
          excerpt:
            "“That’s important because, of course, it means that the wild pollinators are facing a challenge from both those types of competition from honeybees,” Jane Doe, a researcher at Example University, said. A study published on Monday found honeybees are barging aside wild pollinators in 300 recorded interactions.",
        },
      ],
    });

    const { article } = composeArticleWithDiagnostics(story);
    expect(article.deck.text).not.toMatch(/^["“]/u);
    expect(article.deck.text).toContain("300 recorded interactions");
  });

  it("keeps the quotation as the deck when it is the only fact that stands alone", () => {
    // The fallback half of the same ruling: a quote is a legitimate opening when
    // nothing else composes, so the preference may not turn into a ban.
    const story = makeStory({
      sources: 1,
      what: "",
      sourceList: [
        {
          name: "The Register",
          at: "10:00",
          url: "https://theregister.com",
          excerpt:
            "“The npm package imgdecode hides a malicious loader in a compiled Node.js addon,” SafeDep said.",
        },
      ],
    });

    const { article } = composeArticleWithDiagnostics(story);
    expect(article.deck.text).toMatch(/^["“]/u);
  });

  describe("a body block may not open on a reference the page never establishes", () => {
    /** The measured NTT block: nothing above it on the page names a report. */
    const NTT_BLOCK =
      "The report models three growth trajectories through 2030 and stress-tests each against the constraints operators hit, such as land availability, water consumption and specialized labor.";

    it("refuses a document opening the page never names", () => {
      const story = makeStory({
        title: "Global data centers weigh the price tag of not building fast enough",
        what: "",
        sources: 1,
        sourceList: [
          {
            name: "The Register",
            at: "10:00",
            url: "https://theregister.com",
            excerpt: `${NTT_BLOCK} Operators said the middle scenario projects about 23 percent annual demand growth across the sector.`,
          },
        ],
      });

      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      expect(article.deck.text).not.toMatch(/^the report\b/i);
      expect(article.paragraphs.some((p) => /^the report\b/i.test(p.text))).toBe(false);
      expect(diagnostics.qualityGate.pageOpenings.refused).toBeGreaterThan(0);
      expect(diagnostics.qualityGate.pageOpenings.asked).toBeGreaterThan(0);
    });

    it("keeps the same sentence when the page itself names the report", () => {
      const story = makeStory({
        title: "NTT's report puts a price on moving too slowly",
        what: "",
        sources: 1,
        sourceList: [
          {
            name: "The Register",
            at: "10:00",
            url: "https://theregister.com",
            excerpt: `NTT Global Data Centers published a report on its own build-out plans in Europe this week, and the numbers are large. ${NTT_BLOCK} Operators said the middle scenario projects about 23 percent annual demand growth across the sector.`,
          },
        ],
      });

      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
      expect(published).toContain("three growth trajectories");
      expect(diagnostics.qualityGate.pageOpenings.refused).toBe(0);
    });

    it("keeps a demonstrative opening the page already carries", () => {
      // The control for the same rule: "Those manufacturers ..." is readable
      // because the page names them above it, so the sentence keeps its place and
      // the pass records that it was asked and answered.
      const story = makeStory({
        title: "Manufacturers announce three plants in Ohio",
        what: "",
        sources: 2,
        sourceList: [
          {
            name: "Source One",
            at: "10:00",
            url: "https://one.com",
            excerpt:
              "Major Taiwanese manufacturers announced three plants in Ohio this year, according to the state's development office.",
          },
          {
            name: "Source Two",
            at: "11:00",
            url: "https://two.com",
            excerpt:
              "Those manufacturers now employ 40,000 people across the state, the office said in its annual filing.",
          },
        ],
      });

      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
      expect(published).toContain("manufacturers");
      expect(diagnostics.qualityGate.pageOpenings.refused).toBe(0);
    });
  });

  it("publishes no deck at all when every fact needs an antecedent", () => {
    // The withheld branch of the same rule. Withholding is the composer's half:
    // it refuses the deck and charges the facts to the rule, and the gate reads
    // the empty deck and withholds the story (see readiness.test.ts).
    const story = makeStory({
      sources: 1,
      what: "",
      sourceList: [
        {
          name: "The Verge",
          at: "10:00",
          url: "https://theverge.com",
          excerpt:
            "Those were among the descriptions mathematicians reached for in conversations this week. This changes how the field reads every result.",
        },
      ],
    });

    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    expect(article.deck.text).toBe("");
    // Nothing is unexplained: every fact that could not open the story is charged
    // to the rule that refused it. The body may still assemble a block from a fact
    // the narrative path judged adjacent to the sentence before it, which is the
    // composer's business -- no delivered story is in this state, because a page
    // whose first block is not a deck is withheld (readiness.test.ts).
    expect(diagnostics.facts.lost).toBe(0);
    expect(diagnostics.sentences.reasons["deck_refused"] ?? 0).toBeGreaterThan(0);
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
        title: "Acme confirms the second phase of its $40 million plan",
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt:
              "The company confirmed the second phase of its $40 million plan will begin next month.",
          },
        ],
        relatedEvents: [
          {
            id: "prior-1",
            title: "Acme announced phase one of its $40 million plan",
            summary: "Acme announced phase one of its $40 million plan last quarter.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).toContain(
        "Previously, Acme announced phase one of its $40 million plan last quarter.",
      );
      expect(body).not.toContain("nyuz has also covered");
    });

    it("refuses background that shares an actor but not the story's figure", () => {
      // The unrelated class Audit 24 measured: a different event that merely
      // names the same company or person. Nothing about it is falsifiable by the
      // sentence alone, so the rule refuses it instead of explaining it.
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
            title: "Acme announces quarterly dividend",
            summary: "Acme announces quarterly dividend for shareholders.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).not.toContain("Previously,");
    });

    it("refuses background that restates the story's own incident", () => {
      // The composer must not print the story's deck back as history: a
      // "Previously," that is the same arrest is not context, it is a stutter.
      const story = makeStory({
        title: "California tech CEO arrested for smuggling $300 million in Nvidia chips to China",
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt: "A California man was arrested for smuggling $300 million in Nvidia chips.",
          },
        ],
        relatedEvents: [
          {
            id: "same-1",
            title: "Californian accused of shipping $300M in Nvidia chips to China",
            summary: "The man is accused of exporting $300 million worth of Nvidia chips.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).not.toContain("Previously,");
    });

    it("refuses background when the story itself names no actor", () => {
      const story = makeStory({
        title: "The decision lands this week",
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt: "The decision lands this week after the council vote.",
          },
        ],
        relatedEvents: [
          {
            id: "prior-1",
            title: "Acme announced phase one of its $40 million plan",
            summary: "Acme announced phase one of its $40 million plan last quarter.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).not.toContain("Previously,");
    });

    it("refuses background whose actor is a different one", () => {
      const story = makeStory({
        title: "Acme confirms the second phase of its $40 million plan",
        understand: undefined as never,
        sourceList: [
          {
            name: "Reuters",
            at: "10:00",
            excerpt:
              "The company confirmed the second phase of its $40 million plan will begin next month.",
          },
        ],
        relatedEvents: [
          {
            id: "prior-1",
            title: "Globex announced its $40 million plan",
            summary: "Globex announced its $40 million plan last quarter.",
          },
        ],
      });

      const body = composeArticle(story)
        .paragraphs.map((p) => p.text)
        .join(" ");
      expect(body).not.toContain("Previously,");
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

    it("names the rule behind every unrendered fact, and leaves `lost` for the rest", () => {
      // `lost` means "selected, no prose carries it, and no rule accounts for it".
      // A block-level drop used to charge only the sentence, which left the fact
      // behind it unexplained -- the class this test used to pin. Now the rule
      // that dropped the block is recorded against the fact itself, so the
      // partition holds per fact and `lost` is the residue a reader could not
      // have explained any other way.
      // Two sources, so the composer ranks rather than reading one document
      // forwards: a lone short fact is then a block under the paragraph floor.
      const story = makeStory({
        title: "Oracle's Wisconsin build slips",
        understand: undefined as never,
        what: "",
        sources: 2,
        sourceList: [
          {
            name: "The Register",
            at: "10:00",
            // A change, not a state, since ruling #19 (2026-10-20): the fixture
            // used to open on "Oracle says the development remains on schedule.",
            // which `thinStateOpening` now withholds — a card has to carry a
            // change — and that would empty the composition this test is about
            // (the `short_block` / `unresolved_context` partition). The sentence
            // moved; the subject of the test did not.
            excerpt:
              "Oracle has delayed the Wisconsin development again. Regulators must still approve the grid connection before construction can start.",
          },
          {
            name: "Reuters",
            at: "11:00",
            excerpt: "Implementation is delayed. They also delayed the substation work.",
          },
        ],
      });
      const { diagnostics } = composeArticleWithDiagnostics(story);
      // The dropped block is charged to the rule that dropped it, by fact.
      expect(diagnostics.facts.dispositions["short_block"]).toBe(1);
      expect(diagnostics.sentences.reasons["short_block"]).toBe(1);
      // The context-dependent fact was refused by name, and the block-level drop
      // is a named rule too, so both are explained and neither is `lost`.
      expect(diagnostics.facts.dispositions["unresolved_context"]).toBe(1);
      expect(diagnostics.facts.refused).toBe(2);
      expect(diagnostics.facts.lostFacts).toEqual([]);
      expect(diagnostics.facts.lost).toBe(0);
      // Rendered, refused and lost partition the selected set: one fact added
      // three ways is how the old counters reported 84 refused beside 49 lost
      // under a selected total neither could reconcile against.
      expect(diagnostics.facts.rendered + diagnostics.facts.refused + diagnostics.facts.lost).toBe(
        diagnostics.facts.selected,
      );
      // Refusal *events* stay visible beside the final outcomes: one fact-level
      // refusal happened, while the partition counts two explained absences (the
      // block-level drop is charged to the rule that dropped the block, and is
      // not a fact-level refusal event).
      expect(diagnostics.facts.refusalEvents).toBe(1);
      expect(diagnostics.facts.renderedAfterRefusal).toBe(0);
      // And the facts themselves are listed with their rule, because a count of
      // explained absences is not an explanation an operator can check.
      expect(diagnostics.facts.unrendered).toEqual([
        { text: "Implementation is delayed.", rule: "short_block" },
        { text: "They also delayed the substation work.", rule: "unresolved_context" },
      ]);
      expect(diagnostics.facts.renderedAfterRefusalFacts).toEqual([]);
    });

    it("does not splice a refused fact back in as context for an unborn entity", () => {
      // Refusal-finality, ruled 2026-10-11. The entity-context pass inserts a
      // source sentence naming an entity the article has not introduced -- and the
      // usual reason the entity has not been introduced is that the sentence naming
      // it was *refused*. On the frozen 200-story corpus that was four of the seven
      // facts the ledger reported as refused and published by another path,
      // including the PC-shipments opening whose referent the page never
      // establishes. A refused sentence stays refused: the splice looks for another
      // way to introduce the entity, and where there is none the article simply does
      // not mention it.
      const story = makeStory({
        title: "PC shipments tumble as chip shortages bite",
        understand: undefined as never,
        what: "",
        sources: 2,
        sourceList: [
          {
            name: "Tom's Hardware",
            at: "10:00",
            excerpt:
              "PC shipments fell 20.1% in the third quarter. These price increases have been caused by the boom in AI data centers, Counterpoint Research said. Analysts expect the shortage to last until 2027.",
          },
          {
            name: "Reuters",
            at: "11:00",
            excerpt:
              "Memory prices climbed by as much as 500%, according to the report. The decline marks a steeper drop than the 3.8% recorded last quarter.",
          },
        ],
      });
      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
      expect(published).not.toContain("These price increases");
      // Refused by name, so its absence is explicable rather than lost, and the
      // counter that has to mean "a path republished a refused fact" stays zero.
      expect(
        diagnostics.facts.unrendered.some((entry) =>
          entry.text.startsWith("These price increases"),
        ),
      ).toBe(true);
      expect(diagnostics.facts.renderedAfterRefusal).toBe(0);
      expect(diagnostics.facts.renderedAfterRefusalFacts).toEqual([]);
      expect(diagnostics.facts.lost).toBe(0);
    });

    it("publishes the deck alone when the story has one usable fact", () => {
      // The classification the empty-story census turns on: a body needs a second
      // fact, so a story with one is not a story a rule emptied -- the deck is the
      // whole story. 27 of the frozen corpus's 44 stories with no paragraphs are
      // this shape, and this pins that it is the shape rather than a drop.
      const story = makeStory({
        title: "Valve's Proton 11.0-2e released to fix EA App issues",
        understand: undefined as never,
        what: "",
        sources: 1,
        sourceList: [
          {
            name: "GamingOnLinux",
            at: "10:00",
            excerpt: "Valve released Proton 11.0-2e with a fix for the EA App on Linux.",
          },
        ],
      });
      const { article, diagnostics } = composeArticleWithDiagnostics(story);
      expect(diagnostics.facts.selected).toBe(1);
      expect(article.paragraphs).toEqual([]);
      expect(article.deck.text).not.toBe("");
      expect(diagnostics.facts.rendered).toBe(1);
      expect(diagnostics.facts.unrendered).toEqual([]);
      expect(diagnostics.facts.lost).toBe(0);
    });

    it("publishes a one-fact story as its deck, with no duplicate block behind it", () => {
      // The live window carried this shape on 2026-10-18: two sources, one usable
      // fact, so the deck is the whole story. The entity-context pass then repeated
      // that sentence as paragraphs -- one per entity the deck already names -- and
      // the thin-evidence cap dropped the repeats, charging the deck's own fact for
      // a block that repeated prose the reader already had. The cap not charging a
      // published fact stays true, and the entity-context pass now emits nothing
      // here at all, so the cap has nothing to drop rather than duplicates to
      // excuse. Both halves are asserted: the page, and the ledger's partition.
      const fact =
        "Canada fight back to beat England 24-21 in Toronto in the WXV Global Series, with Shoshanah Seumanutafa's 77th-minute try ending the Red Roses' unbeaten run, stretching back to the 2022 Rugby World Cup final.";
      const story = makeStory({
        title: "Red Roses' unbeaten streak ends in a thriller as Canada claim win with late try",
        understand: undefined as never,
        what: "",
        sources: 2,
        sourceList: [
          {
            name: "The Guardian Sport",
            at: "10:00",
            excerpt: "Photograph: Canadian Press/Shutterstock",
          },
          { name: "BBC Sport", at: "11:00", excerpt: fact },
        ],
      });
      const { article, diagnostics } = composeArticleWithDiagnostics(story);

      // The reader gets the sentence once, in the deck, and no paragraph repeats it.
      expect(article.deck.text).toBe(fact);
      expect(article.paragraphs).toEqual([]);
      expect(diagnostics.facts.selected).toBe(1);
      expect(diagnostics.facts.rendered).toBe(1);
      // Nothing was withheld, so nothing may be charged: the partition still adds
      // up, the fact is not reported as lost, and no path published a refused fact.
      expect(diagnostics.facts.unrendered).toEqual([]);
      expect(diagnostics.facts.lost).toBe(0);
      expect(diagnostics.facts.refused).toBe(0);
      expect(diagnostics.facts.renderedAfterRefusal).toBe(0);
      expect(diagnostics.facts.renderedAfterRefusalFacts).toEqual([]);
      expect(diagnostics.facts.rendered + diagnostics.facts.refused + diagnostics.facts.lost).toBe(
        diagnostics.facts.selected,
      );
      // The producer handed the gate nothing, so the cap had nothing to drop: no
      // block repeated the deck for the cap to refuse, and no fact was charged for
      // prose the reader already had.
      expect(diagnostics.paragraphs.assembled).toBe(0);
      expect(diagnostics.sentences.reasons["thin_evidence_cap"]).toBeUndefined();
      // And nothing the page carries appears twice.
      const blocks = [article.deck.text, ...article.paragraphs.map((part) => part.text)];
      expect(new Set(blocks.map((block) => block.trim())).size).toBe(blocks.length);
    });

    it("never splices the deck, and never the same sentence twice for two entities", () => {
      // The two producer rules the live story needs, asked of the pass directly:
      // prose the page already carries is not context, and one source sentence
      // introducing two entities introduces both of them once. The second cannot
      // be reached through composeArticle -- a sentence naming an entity the page
      // lacks is exactly what the pass exists to add -- so it is asked here.
      const ledger = {
        sentences: new Map<string, string>(),
        unrendered: new Map<string, string>(),
      };
      const shared =
        "Acme Corp and Globex Ltd said the plant in Osaka will close at the end of March, cutting 240 jobs.";
      const entities = [
        { name: "Acme Corp", role: "PRIMARY" },
        { name: "Globex Ltd", role: "PRIMARY" },
      ];
      const sources = [{ name: "Source One", excerpt: shared }];

      const twice = contextSplice({
        page: ["Shares in the two firms rose 4% on Monday."],
        entities,
        sources,
        ledger,
        existing: 1,
      });
      expect(twice).toHaveLength(1);
      expect(twice[0]?.text).toBe(shared);

      const carried = contextSplice({
        page: [shared],
        entities,
        sources,
        ledger,
        existing: 1,
      });
      expect(carried).toEqual([]);
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

describe("T1 — truncated-sentence and raw-URL prose is never published", () => {
  const bodyText = (article: { paragraphs: { text: string }[] }) =>
    article.paragraphs.map((p) => p.text).join(" ");

  it("refuses a sentence cut at a month boundary", () => {
    const story = makeStory({
      title: "FBI arrests founder of ransomware negotiation firm",
      what: "The FBI arrested the founder of a ransomware negotiation firm.",
      sourceList: [
        {
          name: "Krebs on Security",
          at: "10:00",
          excerpt:
            "The FBI arrested the founder in Philadelphia. Investigators found the meeting at the Loews Philadelphia Hotel between Oct.",
        },
      ],
    });
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyText(article)).not.toContain("between Oct.");
    expect(diagnostics.sentences.reasons["truncated_sentence"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("refuses a sentence cut at a binding preposition", () => {
    const story = makeStory({
      title: "Super Micro co-conspirator pleads guilty",
      what: "A co-conspirator pleaded guilty in the Super Micro smuggling case.",
      sourceList: [
        {
          name: "The Register",
          at: "10:00",
          excerpt:
            "A co-conspirator pleaded guilty in the Super Micro smuggling case. Sun is also expected to be sentenced on Sept.",
        },
      ],
    });
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyText(article)).not.toContain("sentenced on Sept.");
    expect(diagnostics.sentences.reasons["truncated_sentence"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("refuses a raw URL with a path published as reporting", () => {
    const story = makeStory({
      title: "Boeing to sell subsidiary for $10.55 billion",
      what: "Boeing agreed to sell part of its business.",
      sourceList: [
        {
          name: "Krebs on Security",
          at: "10:00",
          excerpt:
            "Boeing agreed to sell part of its business for $10.55 billion. Investors.boeing.com/investors/news/press-release-details/2025/Boeing/default.aspx Am wondering what ransomware negotiations he was involved in.",
        },
      ],
    });
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyText(article)).not.toContain("Investors.boeing.com");
    expect(diagnostics.sentences.reasons["raw_url"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("keeps an install-script URL inside a code block when it carries the story", () => {
    // This is the other recorded defect shape: a shell snippet whose URL has a
    // path. It should still be refused as raw-URL leakage, not treated as code.
    const story = makeStory({
      title: "Bun releases Windows installer",
      what: "Bun shipped a Windows installer.",
      sourceList: [
        {
          name: "Bun Blog",
          at: "10:00",
          excerpt:
            'Bun shipped a Windows installer. Windows: powershell -c "irm bun.sh/install.ps1|iex".',
        },
      ],
    });
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyText(article)).not.toContain("bun.sh/install.ps1");
    expect(diagnostics.sentences.reasons["raw_url"] ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("source adjacency in the ranked path", () => {
  // Arbiter ruling #4 (2026-10-17). Ranking decides what is worth publishing; it
  // does not get to put a sentence ahead of the one it needs to be read. The
  // fixture is the live Taiwan story of that day -- the only story that reader's
  // briefing carried, whose fourth paragraph opened "However, they also rely on
  // several smaller manufacturers ..." with nothing above it saying who "they"
  // was, while the source's own naming sentence was published after it.
  const bodyOf = (article: { paragraphs: { text: string }[] }) =>
    article.paragraphs.map((p) => p.text);

  const storyWith = (sentences: string[]) =>
    makeStory({
      title: "Taiwan raising $4 billion to build industrial park in Texas",
      understand: undefined as never,
      what: "",
      sources: 2,
      sourceList: [
        { name: "Tom's Hardware", at: "10:00", excerpt: sentences.join(" ") },
        {
          name: "Reuters",
          at: "11:00",
          excerpt:
            "The ministry said the park is expected to open in 2027, with construction starting next year.",
        },
      ],
    });

  const NAMES_THE_GROUP =
    "Major Taiwanese companies are more than capable of spending the billions of dollars needed to set up manufacturing sites in America.";
  const NEEDS_THE_GROUP =
    "However, they also rely on TSMC and several smaller manufacturers that do not have the financial capability to expand operations into the U.S. independently.";

  it("publishes the sentence that names the group directly before the one that leans on it", () => {
    const story = storyWith([
      "Taiwan is raising at least $4 billion to build an industrial park in Texas.",
      NAMES_THE_GROUP,
      NEEDS_THE_GROUP,
    ]);
    const { article, diagnostics } = composeArticleWithDiagnostics(story);
    const block = bodyOf(article).find((text) => text.includes(NEEDS_THE_GROUP));

    expect(block).toBeDefined();
    expect(block).toContain(NAMES_THE_GROUP);
    expect((block ?? "").indexOf(NAMES_THE_GROUP)).toBeLessThan(
      (block ?? "").indexOf(NEEDS_THE_GROUP),
    );
    expect(diagnostics.qualityGate.adjacencyRepairs.count).toBe(1);
    expect(
      diagnostics.facts.unrendered.some((entry) => entry.text.startsWith("However, they also")),
    ).toBe(false);
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("refuses the sentence when the one it needs was not selected, and says so", () => {
    // "Read more about the deal on our site." is an instruction, refused in the
    // evidence pass -- so the fact that needs it has no predecessor to sit behind.
    const story = storyWith([
      "Taiwan is raising at least $4 billion to build an industrial park in Texas.",
      "Read more about the deal on our site.",
      NEEDS_THE_GROUP,
    ]);
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyOf(article).join(" ")).not.toContain("However, they also rely");
    expect(
      diagnostics.facts.unrendered.some(
        (entry) =>
          entry.text.startsWith("However, they also") && entry.rule === "unresolved_context",
      ),
    ).toBe(true);
    // No path republished what a rule refused, and nothing vanished unaccounted.
    expect(diagnostics.facts.renderedAfterRefusal).toBe(0);
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("refuses it when the sentence before it cannot supply the reference", () => {
    // The ruling's condition: proximity is not proof. A sentence with no group in
    // it cannot be where a "they" comes from.
    const story = storyWith([
      "Taiwan announced the deal on Monday.",
      "However, they also rely on several smaller manufacturers that cannot expand alone.",
    ]);
    const { article, diagnostics } = composeArticleWithDiagnostics(story);

    expect(bodyOf(article).join(" ")).not.toContain("However, they also rely");
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("keeps the pair in one block when the paragraph budget would split them", () => {
    // The budget is a length rule and the reference is a reading rule; where they
    // disagree the reader wins. Two long sentences overflow the 75-word budget,
    // and splitting there would put the dependent sentence at the top of the next
    // block -- exactly the dangling opening the repair exists to prevent.
    const long =
      "Major Taiwanese companies are more than capable of spending the billions of dollars that setting up a manufacturing site in America now costs, and several of them have already committed to do exactly that over the coming decade, according to the ministry.";
    const story = storyWith([
      "Taiwan is raising at least $4 billion to build an industrial park in Texas.",
      long,
      NEEDS_THE_GROUP,
    ]);
    const { article } = composeArticleWithDiagnostics(story);
    const block = bodyOf(article).find((text) => text.includes(NEEDS_THE_GROUP));

    expect(block).toBeDefined();
    expect(block).toContain("Major Taiwanese companies are more than capable");
  });

  it("does not treat proximity as proof that the reference resolves", () => {
    // The guard the ruling asked for in as many words: adjacency is necessary,
    // not sufficient. These four pairs are the measured failures and controls.
    expect(
      antecedentSupplied(
        "However, they also rely on several smaller manufacturers that cannot expand alone.",
        "Major Taiwanese companies are more than capable of spending the billions of dollars needed.",
      ),
    ).toBe(true);
    expect(
      antecedentSupplied(
        "She is married to film producer Tyler Zacharia.",
        "The organization is headed up by Trump ally and diplomat Ric Grenell.",
      ),
    ).toBe(false);
    expect(
      antecedentSupplied(
        "These price increases have been caused by the boom in AI data centers.",
        "PC shipments fell 20.1% in the third quarter.",
      ),
    ).toBe(false);
    expect(
      antecedentSupplied(
        "He argued that the Nord Stream pipelines had untied Russia's hands to go to war.",
        "There were two further explosions targeting both Nord Stream 2 and the original Nord Stream 1.",
      ),
    ).toBe(false);
  });

  it("keeps a plural anywhere in the sentence from standing in for its subject", () => {
    // Both pairs were published on the live corpus by the first guard, which
    // accepted any word ending in `s`: the verb `gives` in a two-word question,
    // and `points`/`reviews`/`users` in a sentence whose subject is one body.
    // Each read as a dangling reference, which is the defect the repair exists
    // to remove, so the group has to be named in the predecessor's own subject.
    expect(
      antecedentSupplied("They then debate the merits of returning to X.", "What gives here?"),
    ).toBe(false);
    expect(
      antecedentSupplied(
        "Their listing for the WhatsApp impostor has the same icon and screenshots.",
        "Android Authority points out that the WhatsApp clone may be using Early Access, which could have helped users warn people.",
      ),
    ).toBe(false);
    // The controls: the subject named the group, and a sentence that opens on the
    // pronoun continues the one before it without inferring anything.
    expect(
      antecedentSupplied(
        "However, they also rely on several smaller manufacturers.",
        "Major Taiwanese companies are more than capable of spending the billions needed.",
      ),
    ).toBe(true);
    expect(
      antecedentSupplied(
        "They then broke into the network of AI tool provider Hugging Face.",
        "They come after the company revealed in July that internal test agents exploited a zero-day flaw.",
      ),
    ).toBe(true);
  });

  it("sees a pronoun behind a connector, which is how the live defect was missed", () => {
    expect(contextDependent("However, they also rely on several smaller manufacturers.")).toBe(
      true,
    );
    expect(contextDependent("But it also said the deal would hold.")).toBe(true);
    // The connector alone is not the defect: a named subject after it still reads.
    expect(contextDependent("However, Taiwan's ministry said the deal would hold.")).toBe(false);
  });
});

/**
 * The reader-clarity audit's three chronology blockers, on the story it read.
 *
 * Card 06 of the delivered 2026-10-21 briefing (findings I-09, I-10, I-11): the
 * page opened on a date six weeks into its own timeline, the paragraph below it
 * referred to "the leak" and to "Calif" before either had been introduced, and a
 * third paragraph printed `August 20, 2026` after `October 21st`.
 *
 * The fixture is the stored story rebuilt as a `Story`: the same post, the same
 * six enriched units (in the order the evidence store held them), and the PHP
 * Foundation's own disclosure timeline as a second source. The composer reads it
 * through the same relevance path the live card took -- two sources, one of them
 * enriched, so `oneDocument` is false and the body is ranked rather than read.
 */
const phpSecurityStory = (): Story => ({
  id: "php-security-release",
  org: "Simon Willison",
  title: "Today's PHP Security Release, and How We're Strengthening PHP Security",
  what: "August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.",
  why: "",
  importance: "High",
  score: { relevance: 80, importance: 80, novelty: 60 },
  sources: 2,
  topics: ["Security"],
  time: "",
  publishedAt: "2026-10-21T18:41:53Z",
  sourceList: [
    {
      name: "Simon Willison",
      at: "2026-10-21",
      url: "https://simonwillison.net/2026/Oct/21/php-security-release",
      excerpt:
        "Today's PHP Security Release, and How We're Strengthening PHP Security. If you're running anything on PHP it's vital you upgrade - today's updates (across the entire PHP 8.x line) address two remote code execution holes, and there have been exploits circulating since last night, thanks to a leak in the coordinated disclosure process. This post from the PHP Foundation explain what went so wrong: On Tuesday, October 20th, at around 15:00 UTC, the two CVE IDs began circulating on online forums and social media. They came with a wrong release time and a wrong CVSS score of 10.0 (the actual score is 9.2). No technical details leaked. In response, the PHP project brought its pre-announcement forward and published it at 19:30 UTC. It also moved the release from October 22nd, 14:00 UTC, to October 21st, 14:00 UTC. As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video. It showed their proof of concept working against a number of targets and revealed a few additional, though limited, details about the vulnerabilities. Copies of the deleted video started circulating on social media soon after. The video contributed to accelerated development of various PoCs (exploitation proof of concepts), which then increased circulation on October 21st.",
      enrichedEvidence: [
        {
          kind: "fact",
          text: "In response, the PHP project brought its pre-announcement forward and published it at 19:30 UTC.",
        },
        {
          kind: "fact",
          text: "As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video.",
        },
        {
          kind: "fact",
          text: "They came with a wrong release time and a wrong CVSS score of 10.0 (the actual score is 9.2).",
        },
        {
          kind: "fact",
          text: "Copies of the deleted video started circulating on social media soon after.",
        },
        {
          kind: "fact",
          text: "On Tuesday, October 20th, at around 15:00 UTC, the two CVE IDs began circulating on online forums and social media.",
        },
        {
          kind: "fact",
          text: "The video contributed to accelerated development of various PoCs (exploitation proof of concepts), which then increased circulation on October 21st.",
        },
      ],
    },
    {
      name: "The PHP Foundation",
      at: "2026-10-21",
      url: "https://thephp.foundation/blog/2026/10/21/php-security-release",
      excerpt:
        "This article from the team that discovered the original vulnerability includes a more detailed timeline of the original intended responsible disclosure: August 19, 2026: Wiz Research discovers the first PHP vulnerability using Wiz Atlas, Gemini 4 Argon, and GPT-5.6 Sol. August 20, 2026: Unauthenticated RCE is confirmed against Drupal. August 21, 2026: Unauthenticated RCE is confirmed against WordPress. August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team. September 21, 2026: PHP acknowledges the reports and begins developing a coordinated fix. October 21, 2026: Patched PHP releases become available.",
    },
  ],
  before: "",
  after: "",
  timeline: [],
});

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Every calendar day the page states, in the order the reader meets them. */
const pageDates = (deck: string, paragraphs: string[]): number[] => {
  const text = [deck, ...paragraphs].join(" ");
  const found: number[] = [];
  for (const match of text.matchAll(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/gi,
  )) {
    const month = MONTHS.indexOf((match[1] ?? "").toLowerCase());
    const day = Number(match[2]);
    if (month >= 0 && Number.isInteger(day)) found.push(month * 31 + day);
  }
  return found;
};

describe("a story that carries its own timeline", () => {
  const { article, diagnostics } = composeArticleWithDiagnostics(phpSecurityStory());
  const body = article.paragraphs.map((paragraph) => paragraph.text);
  const sentences = [article.deck.text, ...body.flatMap((text) => readerSentences(text))];

  it("opens on the first step of the timeline, spoken into a sentence", () => {
    // I-09. The ranked lead was the 24 August report, so the page named a date six
    // weeks into the story and then went back to 20 August below it. The decay
    // the audit measured was the shape: a bare `date: sentence` fragment is not
    // a sentence with a subject and a verb. The fallback speaks the date into
    // the sentence, and the page's first use of the acronym carries the
    // expansion the source's own words spell (rule B, audit I-11).
    expect(article.deck.text).toBe(
      "On August 20, 2026, Unauthenticated remote code execution (RCE) is confirmed against Drupal.",
    );
    expect(diagnostics.chronology.deckMovedToTimelineStart).toBe(1);
  });

  it("runs every date on the page forwards", () => {
    const dates = pageDates(article.deck.text, body);
    expect(dates.length).toBeGreaterThanOrEqual(5);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("introduces the leak before the sentence that is a consequence of it", () => {
    // I-10. `As a result of the leak` used to open the second paragraph, with the
    // sentence that makes the leak readable three sentences below it -- and, the
    // re-measure found, the consequence sentence never introduces `the leak` or
    // `Calif` at all. The demotion rule now moves the cause behind the action:
    // the reader meets the two CVE IDs circulating before the sentence that
    // leans on them, meets the actor first with its own words of introduction,
    // and no sentence on the page opens on the unexplained cause.
    const leakage = sentences.findIndex((line) =>
      line.includes("the two CVE IDs began circulating"),
    );
    const consequence = sentences.findIndex((line) =>
      line.startsWith("Calif, one of the security firms"),
    );
    const response = sentences.findIndex((line) => line.startsWith("In response, the PHP project"));
    expect(leakage).toBeGreaterThanOrEqual(0);
    expect(consequence).toBeGreaterThan(leakage);
    expect(response).toBeGreaterThan(leakage);
    for (const line of sentences) {
      expect(line.startsWith("As a result of")).toBe(false);
    }
  });

  it("quotes its opening three sentences in the order the audit asked for", () => {
    // The acceptance for the card: the three sentences a stranger reads first.
    expect(sentences.slice(0, 3)).toEqual([
      "On August 20, 2026, Unauthenticated remote code execution (RCE) is confirmed against Drupal.",
      "August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.",
      "September 21, 2026: PHP acknowledges the reports and begins developing a coordinated fix.",
    ]);
  });

  it("keeps the timeline in one block instead of scattering it through the body", () => {
    // I-11. The dates are a document; a paragraph that holds `August 20` and
    // `October 21st` together is the defect the audit read.
    expect(body[0]).toContain("August 24, 2026");
    expect(body[0]).toContain("September 21, 2026");
    expect(body[0]).not.toContain("October 20th");
    expect(diagnostics.chronology.timelineFacts).toBeGreaterThanOrEqual(4);
  });
});

/**

/**
 * N-01 — the template artefact the live page published (audit v2,
 * `st-8766cb0f`). The composer read The Register's own quoted subhead
 * `Chainguard CEO: 'We made the call'.` and rewrote the quote's first person as
 * the source's narrator, keeping the furniture around the quote:
 * `Chainguard CEO: ', the author reported making the call'.` — a dangling
 * apostrophe-comma, no verb, published as prose the sentence
 * `CEO Dan Lorenc spoke with The Register on Wednesday…` then says properly.
 */
describe("N-01 — a quotation's first person is never rewritten as the narrator's", () => {
  const excerpt = `“Mitigation advice we started providing to a few critical infrastructure providers around Oct 20th 23:00 UTC, may have leaked as well,” the PHP blog says, but it does not name these providers. Chainguard CEO: 'We made the call'. CEO Dan Lorenc spoke with The Register on Wednesday, and while he doesn’t dispute the timeline, said his company "didn't leak." “These things are messy,” Lorenc said.`;

  const story = makeStory({
    org: "The Register",
    title:
      "PHP blames supply chain security biz Chainguard for putting huge chunks of the web at risk",
    sourceList: [
      {
        name: "The Register",
        at: "10:00",
        headline: "PHP blames supply chain security biz Chainguard",
        excerpt,
      },
    ],
  });

  it("publishes none of the artefact the rewrite produced on the live page", () => {
    // Exactly the string the audit captured, quoted as its fixture.
    expect(publishedTextOf(story)).not.toContain(
      "Chainguard CEO: ', the author reported making the call'.",
    );
    expect(publishedTextOf(story)).not.toContain("', the author reported making the call'");
  });

  it("keeps the sentence that actually says it", () => {
    expect(publishedTextOf(story)).toContain("CEO Dan Lorenc spoke with The Register on Wednesday");
  });

  it("spends no fragment on the quoted subhead's furniture either", () => {
    // The subhead is dropped whole: a reader never meets `Chainguard CEO: '` as
    // the head of a sentence, with or without a rewrite behind it.
    for (const paragraph of publishedTextOf(story).split("\n\n")) {
      expect(paragraph.trim().startsWith("Chainguard CEO:")).toBe(false);
    }
  });
});

/**
 * The opening states the event, or falls back to the timeline's first step
 * spoken as a sentence (audit I-09's rule, settled 2026-10-23).
 *
 * The rule is written against shapes, not the audit's own words: a different
 * publisher, different dates and a different subject must produce the same
 * composition. Nothing in these tests quotes the PHP fixture's strings beyond
 * the rule's output.
 */
/**
 * A story whose only other sentences are the two shapes the composer already
 * refuses as an opening (second-person advice, an unanchored `They`), so the
 * walk reaches the timeline's first step through the fallback. Shared by the
 * spoken-date rules and the consequence-demotion rule below.
 */
const outageWithoutEventFact = (): Story => ({
  id: "acme-pipeline-outage",
  org: "ACME Status Page",
  title: "ACME's pipeline outage, and the fix that shipped same-day",
  what: "March 3, 2026: The ACME platform team confirms the outage in a status post.",
  why: "",
  importance: "Medium",
  score: { relevance: 60, importance: 60, novelty: 40 },
  sources: 1,
  topics: ["Outages"],
  time: "",
  publishedAt: "2026-03-03T20:00:00Z",
  sourceList: [
    {
      name: "ACME Status Page",
      at: "2026-03-03",
      url: "https://status.acme.example/mar-3",
      excerpt:
        "You should always follow the ACME status page for live updates. They announced the fix in the same window. March 3, 2026: The ACME platform team confirms the outage in a status post. March 4, 2026: The pipeline restores service after the fix deploys.",
      enrichedEvidence: [],
    },
  ],
  before: "",
  after: "",
  timeline: [],
});

/** The same story, plus one sentence that states the event in its own words. */
const outageWithEventFact = (): Story => {
  const story = outageWithoutEventFact();
  return {
    ...story,
    sourceList: [
      {
        ...story.sourceList[0]!,
        excerpt:
          "You should always follow the ACME status page for live updates. They announced the fix in the same window. The ACME pipeline team restored service at 18:04 UTC after a three-hour outage. March 3, 2026: The ACME platform team confirms the outage in a status post. March 4, 2026: The pipeline restores service after the fix deploys.",
      },
    ],
  };
};

describe("the opening speaks the event, or the timeline's first step spoken into a sentence", () => {
  it("prefers a sentence that states the event over the timeline's first step", () => {
    const { article } = composeArticleWithDiagnostics(outageWithEventFact());
    expect(article.deck.text).toBe(
      "The ACME pipeline team restored service at 18:04 UTC after a three-hour outage.",
    );
  });

  it("falls back to the timeline's first step with its date spoken into the sentence", () => {
    // I-09. Before the rule the opening was the raw fragment below -- a date,
    // a colon, and a sentence no reader can parse as one thought.
    const { article } = composeArticleWithDiagnostics(outageWithoutEventFact());
    expect(article.deck.text).not.toBe(
      "August 20, 2026: Unauthenticated RCE is confirmed against Drupal.",
    );
    // The join lowers a step-head capital the story's own rows show lowercase:
    // "the" is lowercase in the rows everywhere but their row heads.
    expect(article.deck.text).toBe(
      "On March 3, 2026, the ACME platform team confirms the outage in a status post.",
    );
  });

  it("lowers a step-head capital only when the story's own rows show the word lowercase", () => {
    // Card 06 re-measured 2026-10-26: the spoken join kept the step's sentence
    // capital -- `On August 20, 2026, Unauthenticated remote code execution
    // (RCE) is confirmed against Drupal.` -- a capital the rows themselves
    // show lowercase (`... for "unauthenticated remote code execution," the
    // group said`). A word the rows never show lowercase may be a name
    // (`Drupal`), so the fold needs the rows' own lowercase form to fire.
    const story = outageWithoutEventFact();
    const witnessed = {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt:
            "They announced the fix in the same window. The group warned of unauthenticated access to the gateway. March 3, 2026: Unauthenticated access is confirmed against the gateway. March 4, 2026: The pipeline restores service after the fix deploys.",
        },
      ],
    };
    const { article } = composeArticleWithDiagnostics(witnessed);
    expect(article.deck.text).toBe(
      "On March 3, 2026, unauthenticated access is confirmed against the gateway.",
    );
  });

  it("keeps a capital the story's rows never show lowercase", () => {
    const story = outageWithoutEventFact();
    const namelessWitness = {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt:
            "They announced the fix in the same window. The group named the gateway Vendor. March 3, 2026: Vendor access is confirmed against the gateway. March 4, 2026: The pipeline restores service after the fix deploys.",
        },
      ],
    };
    const { article } = composeArticleWithDiagnostics(namelessWitness);
    expect(article.deck.text).toBe(
      "On March 3, 2026, Vendor access is confirmed against the gateway.",
    );
  });

  it("keeps an opening that is not a fragment and not about the event when no timeline exists", () => {
    // The walk's own ranked choice survives the new rules where no timeline
    // competes: the demote and the fallback both need the timeline.
    const story = outageWithEventFact();
    const withoutTimeline = {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt: (story.sourceList[0]!.excerpt ?? "").replace(/March [34], 2026: /g, ""),
        },
      ],
    };
    const { article } = composeArticleWithDiagnostics(withoutTimeline);
    expect(article.deck.text).toBe(
      "The ACME pipeline team restored service at 18:04 UTC after a three-hour outage.",
    );
  });
});

/**
 * Rule B: the page's first use of an acronym carries the expansion the source's
 * own words spell, whether or not the source printed it in brackets.
 *
 * Measured on the audit's I-11: the PHP-security story opens on RCE while its
 * source spells `remote code execution` in prose, and the old helper only read
 * bracketed expansions (`operational technology (OT)`), so the acronym shipped
 * unexplained.
 */
describe("a source that spells its acronym out in prose gets it expanded at first use", () => {
  const studyStory = (): Story => ({
    id: "driver-defect-study",
    org: "Driver Safety Reviewer",
    title: "What a defect study found in the driver",
    what: "A defect study finds an unauthenticated defect in the driver during the test run.",
    why: "",
    importance: "Medium",
    score: { relevance: 40, importance: 40, novelty: 30 },
    sources: 1,
    topics: ["Software"],
    time: "",
    publishedAt: "2026-09-02T10:00:00Z",
    sourceList: [
      {
        name: "Driver Safety Reviewer",
        at: "2026-09-02",
        url: "https://example.com/driver-study",
        excerpt: "",
        enrichedEvidence: [
          { kind: "fact", text: "The study found RCE in the driver during the test run." },
          {
            kind: "fact",
            text: "Remote code execution in the kernel module was a separate finding.",
          },
        ],
      },
    ],
    before: "",
    after: "",
    timeline: [],
  });

  it("expands the first use from the source's own words", () => {
    const { article } = composeArticleWithDiagnostics(studyStory());
    expect(article.deck.text).toContain("remote code execution (RCE)");
  });

  it("expands nothing when the source never spells the term", () => {
    const story = studyStory();
    const question = story.sourceList[0]!;
    const unexplained = {
      ...story,
      sourceList: [
        {
          ...question,
          enrichedEvidence: [(question.enrichedEvidence ?? [])[0]!],
        },
      ],
    };
    const { article } = composeArticleWithDiagnostics(unexplained);
    expect(article.deck.text).not.toContain("remote code execution");
  });

  it("leaves an unbracketed two-letter abbreviation alone", () => {
    // The delivered corpus measured the unbarred scan mangling three pages
    // (2026-10-26): `Musk's 1 TW Terafab ambition` became `Musk's 1 texas
    // with (TW) Terafab ambition`, `RTX Spark PC` became `RTX Spark power
    // connectivity (PC)`, and `90 million CI jobs` became `90 million code
    // is (CI) jobs` -- each a two-letter abbreviation re-glossed from two
    // unrelated words whose initials happened to match. Two letters are the
    // class where an initials match is noise, so the scan refuses them.
    const story = studyStory();
    const listed = story.sourceList[0]!;
    const twoLetters = {
      ...story,
      sourceList: [
        {
          ...listed,
          enrichedEvidence: [
            {
              kind: "fact" as const,
              text: "The fab plan targets 1 TW of capacity, Musk's Terafab ambition.",
            },
            {
              kind: "fact" as const,
              text: "The team toured a plant in Texas with the governor last spring.",
            },
          ],
        },
      ],
    };
    const { article } = composeArticleWithDiagnostics(twoLetters);
    const joined = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(joined).not.toContain("texas with (TW)");
    expect(joined).not.toContain("Texas with (TW)");
    expect(joined).toContain("1 TW");
  });
});

/**
 * Rule: a sentence that opens on the consequence of something the page never
 * said leads with its action instead (audit I-10, re-measured 2026-10-26).
 *
 * Before the rule the page published the audit's sentence verbatim: `As a
 * result of the leak and pre-announcement around 20:00 UTC, Calif, one of the
 * security firms that had reported the issues mistakenly published a video.`
 * The reader meets `the leak` before anything names it, and the thing that
 * happened waits behind the cause. The rule moves the adjunct to the tail;
 * every word stays the source's own.
 */
describe("a sentence that opens on an unexplained consequence leads with its action", () => {
  const califStory = (): Story => {
    const story = outageWithoutEventFact();
    return {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt:
            "They announced the fix in the same window. As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video. March 3, 2026: The ACME platform team confirms the outage in a status post. March 4, 2026: The pipeline restores service after the fix deploys.",
        },
      ],
    };
  };

  it("demotes the fronted consequence to the tail", () => {
    const { article, diagnostics } = composeArticleWithDiagnostics(califStory());
    expect(diagnostics.qualityGate.consequenceDemotions.count).toBe(1);
    const joined = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(joined).toContain(
      "Calif, one of the security firms that had reported the issues mistakenly published a video, as a result of the leak and pre-announcement around 20:00 UTC.",
    );
    expect(joined).not.toContain("As a result of the leak");
  });

  it("leaves a connective consequence alone", () => {
    // `As a result, ...` is a connective, not a fronted cause: nothing to move.
    const story = outageWithoutEventFact();
    const connective = {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt:
            "As a result, the platform team confirms the outage in a status post. March 3, 2026: The ACME platform team confirms the outage in a status post. March 4, 2026: The pipeline restores service after the fix deploys.",
        },
      ],
    };
    const { diagnostics } = composeArticleWithDiagnostics(connective);
    expect(diagnostics.qualityGate.consequenceDemotions.count).toBe(0);
  });
});

/**
 * The event tier counts a sentence's own words only.
 *
 * Measured 2026-10-27 on the reader-production fixture ("Omarchy gains
 * $18.5M...): the event deck went to "There's now also a Stop Omarchy
 * campaign, with a banner: \"Omarchy is a political movement disguised as a
 * Linux distro.\"" because every token it shared with the story's summary sat
 * inside the banner quotation it was merely reporting. The sentence the page
 * had always opened on -- the one stating the event in the source's own voice
 * -- lost its deck to reported speech.
 */
describe("a quotation inside a sentence cannot state the event", () => {
  const bannerStory = (): Story => {
    const story = outageWithoutEventFact();
    return {
      ...story,
      sourceList: [
        {
          ...story.sourceList[0]!,
          excerpt:
            'Service was restored at 18:04 UTC after three hours. The ACME platform team restored service at 18:04 UTC after three hours. There\'s now also a campaign, with a banner: "ACME platform team confirms the outage in a status post."',
        },
      ],
    };
  };

  it("gives the event deck to the sentence whose own words state it", () => {
    const { article } = composeArticleWithDiagnostics(bannerStory());
    // The deck goes to the restoration sentence whose OWN tokens share the
    // story's summary (`The ACME platform team restored service ...`), never to
    // the campaign sentence whose only shared tokens sat inside its banner
    // quotation. The restoration's passive near-duplicate earlier in the
    // excerpt shares no summary token, so it cannot state the event under the
    // rule this panel is written for.
    expect(article.deck.text).toMatch(/The ACME platform team restored service at 18:04 UTC/);
    expect(article.deck.text).not.toContain("campaign");
  });
  });
