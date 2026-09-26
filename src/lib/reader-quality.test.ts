import { describe, expect, it } from "vitest";
import fixtures from "./test-support/reader-production.json";
import { composeArticle, composeArticleWithDiagnostics } from "./editorial";
import {
  editorialNoise,
  evidenceScore,
  hasPredicate,
  nearDuplicate,
  numericKeys,
  publisherVoice,
  rankEntities,
  readerSentences,
  selectReaderEvidence,
  validDeterministicParagraph,
  validDeterministicSentence,
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
  it("leads with the exposed environment and identifies Schut without repeating its source", () => {
    const s = story(0);
    const a = composeArticle(s);
    expect(a.deck.text).toMatch(/Richard Schut and his team discovered/);
    expect(a.deck.text).not.toMatch(/According to The Register/);
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
    // The gate used to refuse any block over the *sentence* ceiling, so this
    // fixture published 273 words with two paragraphs silently missing. Nothing
    // is dropped to reach a length now, so the bound is the composer's own
    // budget -- at most eight blocks of at most a paragraph each -- and every
    // published block has to pass the paragraph validator.
    for (const paragraph of a.paragraphs) {
      expect(validDeterministicParagraph(paragraph.text)).toBe(true);
    }
    expect(text.split(/\s+/).length).toBeLessThan(520);
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
  /**
   * Dotted numbers are not sentence boundaries.
   *
   * The splitter only ends a sentence at punctuation followed by a space, which
   * is what keeps a version, a decimal and a dotted package name in one piece.
   * An abstract that reports "ending at 3.0.9 and in 12 tested versions" would
   * otherwise arrive as "ending at 3.", "0.", "9 and in 12 tested versions".
   */
  it.each([
    ["We reproduced the issue through version 3.0.9 and in 12 tested releases.", 1],
    ["The fix landed in v2.4.1 of the client and shipped last week.", 1],
    ["The score is CVSS 9.8 and the patch is mandatory.", 1],
    ["Python 3.13.5 is out. It runs on v2.4.1 of the API. The rate is 1.5 percent.", 3],
    ["Node.js 22.4.0 was released on Tuesday. Prerelease users saw it first.", 2],
  ])("segments %s into %i sentence(s)", (text, count) => {
    expect(readerSentences(text)).toHaveLength(count);
  });

  it("accepts research prose without weakening the fragment and metadata checks", () => {
    // The verbs a paper uses, which a newsroom word list does not carry.
    for (const text of [
      "The authors propose a method for binding an approval to the operation it authorizes.",
      "The authors distinguish two variants of the attack and measure both.",
      "The study evaluates a purposive set of released agent products.",
      "The authors reproduce the substitution in seven tested releases.",
      "The researchers characterize the failure as a state-substitution attack.",
    ]) {
      expect(hasPredicate(text)).toBe(true);
      expect(validDeterministicSentence(text)).toBe(true);
    }

    // Supporting a domain must not mean accepting everything.
    expect(validDeterministicSentence("No adds that the report changed direction.")).toBe(false);
    expect(validDeterministicSentence("ArXiv:2609.21081v1 Announce Type: new Abstract:")).toBe(
      false,
    );
    expect(validDeterministicSentence("Title: Loopjacking Authors: A. B. Subjects: cs.CR")).toBe(
      false,
    );
    expect(validDeterministicSentence("PWNED")).toBe(false);
    expect(validDeterministicSentence("Read more")).toBe(false);
  });

  it("still rejects publisher first person, which is not research prose", () => {
    expect(
      evidenceScore("We've never seen anything like it in this business.", "News"),
    ).toBeLessThan(0);
    const selected = selectReaderEvidence("Customer data exposure", [
      {
        name: "The Register",
        excerpt:
          "Welcome back to our weekly column on security. We've never seen so much backing for a product.",
      },
    ]);
    expect(selected.facts).toEqual([]);
    expect(selected.rejectionReasons.editorial_noise).toBeGreaterThan(0);
  });

  it("compares variants by containment, never by token count alone", () => {
    const clean =
      "Human approval is often treated as the last security boundary before an agent executes a consequential operation.";
    const decorated = `ArXiv:2609.21081v1 Announce Type: new Abstract: ${clean}`;
    expect(nearDuplicate(decorated, clean)).toBe(true);
    // A swapped subject and object is a different claim, not a rewording.
    expect(
      nearDuplicate(
        "Acme acquired Beta for $20 million on Monday.",
        "Beta acquired Acme for $20 million on Monday.",
      ),
    ).toBe(false);
    // Different figures are different claims however similar the wording.
    expect(
      nearDuplicate("Acme acquired Beta for $20 million.", "Acme acquired Beta for $21 million."),
    ).toBe(false);
  });

  /**
   * Real pairs taken from a 150-story sample of production output, quoted as
   * the composer published them. Containment alone called every one of these two
   * different claims, so a reader saw the same fact twice in different words.
   */
  it("merges restatements that differ inside the shared text", () => {
    const pairs: [string, string][] = [
      // One variant expands an acronym the other abbreviated.
      [
        "The paper projects: It improves on matched passive inference by 9.25 percentage points and reduces Multimodal Large Language Model-side latency by 61.8%, while also improving on RGB-only accuracy.",
        "The paper projects: On improves on matched passive inference by 9.25 percentage points and reduces model-side latency by 61.8%, while also improving on RGB-only accuracy.",
      ],
      // One names the product, the other calls it "the air duster".
      [
        "The air duster can be fully recharged via USB Type-C in about 3.5 hours.",
        "The air MF60 Compressed Air Duster can be fully recharged via USB Type-C in about 3.5 hours.",
      ],
      // Same quotation, one across two spellings of the speaker's name.
      [
        "According to The Verge, In an interview with IGN, Hideo Kojima said that, considering the broader state of the industry, which has seen a number of studios close, he was worried about the future of Kojima Productions: I know there's a lot of news in the game industry that many studios are closing down, … Read the full story at The Verge.",
        "In an interview with IGN, Kojima said that, considering the broader state of the industry, which has seen a number of studios close, he was worried about the future of Kojima Productions: I know there's a lot of news in the game industry that many studios are closing down, … Read the full story at The Verge.",
      ],
      // The deck's attribution prefix, on the identical sentence below it.
      [
        "According to The Verge, In the next episode of Version History, David Pierce is joined by The Verge's Nilay Patel and Victoria Song to tell the story of TI graphing calculators and how one company managed to take over the market and never let it go.",
        "In the next episode of Version History, David Pierce is joined by The Verge's Nilay Patel and Victoria Song to tell the story of TI graphing calculators and how one company managed to take over the market and never let it go.",
      ],
      // Short claims, one token apart: the run rule has to carry these two.
      [
        "Proposed polynomial-time hard-label extraction of ReLU-based MLPs.",
        "Proposed polynomial-time hard-label extraction of ReLU-based ReLU MLPs.",
      ],
      [
        "The authors also give an explicit strongest-link Transport Layer Security bound.",
        "The authors also give an explicit strongest-link security bound.",
      ],
      // The pair that started this: the source sentence, and the same clause
      // rewritten around the name the entity pass resolved.
      [
        "Much of Omarchy's success is due to the visibility of Hansson – better known as DHH – the man behind both the distro and the Ruby on Rails web framework.",
        "David Heinemeier Hansson, better known as DHH, is the man behind both the distro and the Ruby on Rails web framework.",
      ],
    ];
    for (const [left, right] of pairs) {
      expect(nearDuplicate(left, right), left).toBe(true);
      // Merging is symmetric, so neither direction may depend on arrival order.
      expect(nearDuplicate(right, left), right).toBe(true);
    }
  });

  /**
   * The other side of the same measurement: pairs from that sample that share
   * vocabulary without saying the same thing. Two different facts reported under
   * one opening share a preamble, and a preamble is not a claim.
   */
  it("keeps two different facts that share only an opening", () => {
    const pairs: [string, string][] = [
      [
        "This paper solves this problem by making use of the orbits of entries described by the autoparatopism group of the Latin square under consideration.",
        "These critical sets depend only on the conjugacy class of the autoparatopism and the main class of the Latin square under consideration.",
      ],
      [
        "These results show that pose-stamped experience can serve directly as the environment representation for a learned planner, and that making attention depend on pose differences, rather than on temporal order, speeds up training and improves long-horizon navigation.",
        "With camera poses as positional encoding, attention depends on the pose differences between keyframes rather than on their temporal order.",
      ],
      [
        "Existing techniques mostly focus on detecting such attacks but respond by terminating or halting execution upon attack detection, which is not acceptable in CPSs as interrupted tasks can have catastrophic consequences.",
        "Other techniques replace compromised CPS components with simplified defaults that degrade system behavior, or reboot the system upon attack detection, which are not suitable for CPS deployed in safety-critical domains.",
      ],
      [
        "The resulting environment connects robot commands to changes in the coupled liquid and solid state.",
        "The paper projects: These improvements show that modelling the coupled liquid and solid state helps the robot predict how its actions affect both the porous object and the liquid held inside.",
      ],
      [
        "A new paper reports: The performance improvement of high-power flat BLDC motors has accelerated the development of dynamic robots.",
        "In this study, a motor driver for high-power flat BLDC motors using GaN FETs is developed.",
      ],
      [
        "The unnamed man was in serious but stable condition at a hospital after being shot once in the torso on the city's north side, Austin's police chief, Lisa Davis, said at a news conference with the mayor and other city officials.",
        "According to The Guardian World, Anti-ICE protests break out in push for transparency as unnamed man is in serious but stable condition at hospital A US Immigration and Customs Enforcement ( ICE ) officer shot and wounded a man on Sunday afternoon in Texas's capital of Austin, local authorities said, and anti-ICE protesters quickly gathered at the s.",
      ],
      [
        "Dialogue for the original GTA V option A ending has leaked! They were originally going to have Trevor crash into a tank of liquid nitrogen instead of an oil tanker.",
        "Here, it hints that Trevor crashed into a tank of liquid nitrogen, after which he freezes and breaks into pieces, which is quite the opposite of what actually happened to him in the final game.",
      ],
    ];
    for (const [left, right] of pairs) {
      expect(nearDuplicate(left, right), left).toBe(false);
      expect(nearDuplicate(right, left), right).toBe(false);
    }
  });

  it("leaves a shared preamble alone when the second clause is new", () => {
    // Two statements built as <same opening> + <different clause>, with nothing
    // but the opening in common: a shared clause is not a restated claim, and
    // merging these would delete the second fact rather than the duplicate.
    expect(
      nearDuplicate(
        "Construction on Trump said the updated plans were at the request of the US military and for national security purposes.",
        "In a Sunday morning post, Construction on Trump said he is updating the plans at the request of the US military and for national security purposes.",
      ),
    ).toBe(false);
    expect(
      nearDuplicate(
        "The company said it will cut 10% of staff and close the Berlin office.",
        "The company said it will cut 10% of staff and expand in Munich.",
      ),
    ).toBe(false);
  });

  it("normalizes provider metadata before evidence and rejects metadata-only units", () => {
    const selected = selectReaderEvidence("Loopjacking: Hijacking Human-in-the-Loop Approval", [
      {
        name: "arXiv cs.CR",
        excerpt:
          "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation.",
      },
    ]);
    expect(selected.facts.map((fact) => fact.text)).toEqual([
      "Human approval is often treated as the last security boundary before an agent executes a consequential operation.",
    ]);
    expect(selected.sourceNormalization.removedMetadataFields).toBe(3);
    expect(selected.sourceNormalization.cleanedEvidence).toBe(1);

    const listing = selectReaderEvidence("Paper listing", [
      {
        name: "arXiv cs.LG",
        excerpt: "Subjects: Cryptography and Security (cs.CR) Published: 2026-09-20",
      },
    ]);
    expect(listing.facts).toEqual([]);
    expect(listing.sourceNormalization.rejectedMetadataOnly).toBe(1);
  });

  it("deduplicates a clean and a decorated variant in either arrival order", () => {
    const clean =
      "Human approval is often treated as the last security boundary before an agent executes a consequential operation.";
    const decorated = `ArXiv:2609.21081v1 Announce Type: new Abstract: ${clean}`;
    const forward = selectReaderEvidence("Loopjacking", [
      {
        name: "arXiv cs.CR",
        excerpt: decorated,
        enrichedEvidence: [{ kind: "fact", text: clean }],
      },
    ]);
    const reverse = selectReaderEvidence("Loopjacking", [
      {
        name: "arXiv cs.CR",
        excerpt: clean,
        enrichedEvidence: [{ kind: "fact", text: decorated }],
      },
    ]);
    expect(forward.facts.map((fact) => fact.text)).toEqual([clean]);
    expect(reverse.facts.map((fact) => fact.text)).toEqual([clean]);
    expect(forward.facts[0]?.evidence).toEqual([1]);
    expect(reverse.facts[0]?.evidence).toEqual([1]);
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

/**
 * The no-evidence path, from production.
 *
 * 29 of 150 sampled stories had no extractable evidence at all. With nothing to
 * compose from, the composer published the stored event summary verbatim -- and
 * that summary is written from a feed's `description` field, so media credits,
 * `git` trailers and release-page labels shipped as the sentence under a
 * headline. Nothing validated it, because the quality gate only ever *indexed* a
 * deck that already passed; it never asked.
 */
describe("fallback deck safety", () => {
  const bare = (what: string, title = "Australia news live"): Story => ({
    id: "bare",
    title,
    what,
    why: "",
    org: "The Guardian",
    sources: 1,
    topics: [],
    importance: "Notable",
    score: { relevance: 50, importance: 50, novelty: 50 },
    time: "",
    publishedAt: "2026-09-14T12:00:00Z",
    sourceList: [{ name: "The Guardian", at: "", url: "https://example.com/1" }],
    before: "",
    after: "",
    timeline: [],
  });

  it.each([
    ["a photo credit", "Photograph: Alexandra Topping/The Guardian."],
    ["a composite credit", "Composite: Kin Cheung/Getty Images; Tasos Katopodis/Getty"],
    [
      "git trailers",
      "According to vLLM releases, Signed-off-by: khluu khluu000@gmail.com Co-authored-by: OpenAI Codex noreply@openai.com (cherry picked from commit eb87980).",
    ],
    [
      "release-page labels",
      "CUDA: tune FA for Gemma 4 on Ampere or newer (#29152) Website: https://llama.app Attestations: ...",
    ],
    ["a bare URL", "Website: https://llama.app"],
    ["an address list", "Signed-off-by: khluu khluu000@gmail.com"],
  ])("publishes no deck for %s", (_label, what) => {
    const article = composeArticle(bare(what));

    expect(article.deck.text).toBe("");
    expect(article.deck.evidence).toEqual([]);
    expect(article.paragraphs).toEqual([]);
  });

  it("does not print the headline as a second copy of itself", () => {
    const title = "Australia news live: Taylor says fuel price policy would be funded";
    const article = composeArticle(bare(title, title));

    expect(article.deck.text).toBe("");
  });

  it("does not print a headline with one clause appended", () => {
    const title = "Australia news live: Taylor says fuel price policy would be funded";
    const article = composeArticle(bare(`${title} cut`, title));

    expect(article.deck.text).toBe("");
  });

  it("renders headline and sources when the summary is empty", () => {
    const article = composeArticle(bare(""));

    expect(article).toEqual({ deck: { text: "", evidence: [] }, paragraphs: [] });
  });

  it.each([
    "OpenAI sent a letter to the governor opposing the bill.",
    "Getty Images reported a rise in licensing revenue.",
    "The photographer told Reuters that the image was taken on Monday.",
    "Developers signed off on the proposal after review.",
    "The project website says the release includes new CUDA optimizations.",
    "Talks collapsed.",
  ])("still publishes a real summary: %s", (what) => {
    expect(composeArticle(bare(what)).deck.text).toBe(what);
  });

  it("keeps provenance honest: a fallback deck cites no source sentence", () => {
    // The summary belongs to the event, not to a numbered source paragraph, so
    // the deck carries no citation rather than borrowing one it cannot support.
    const article = composeArticle(bare("OpenAI sent a letter to the governor."));

    expect(article.deck.evidence).toEqual([]);
  });

  it("records why every fallback candidate was refused", () => {
    const { article, diagnostics } = composeArticleWithDiagnostics(
      bare("Photograph: Alexandra Topping/The Guardian."),
    );

    expect(article.deck.text).toBe("");
    expect(diagnostics.fallback.attempted).toBe(1);
    expect(diagnostics.fallback.candidates).toBe(1);
    expect(diagnostics.fallback.accepted).toBe(0);
    expect(diagnostics.fallback.furnitureRejected).toBe(1);
    expect(diagnostics.fallback.empty).toBe(1);
    expect(diagnostics.fallback.reasons["photo_credit"]).toBe(1);
  });

  it("counts a title duplicate separately from furniture", () => {
    const title = "Australia news live: Taylor says fuel price policy would be funded";
    const { diagnostics } = composeArticleWithDiagnostics(bare(title, title));

    expect(diagnostics.fallback.titleDuplicate).toBe(1);
    expect(diagnostics.fallback.furnitureRejected).toBe(0);
    expect(diagnostics.fallback.reasons["title_duplicate"]).toBe(1);
  });

  it("counts an accepted fallback as published, not refused", () => {
    const { diagnostics } = composeArticleWithDiagnostics(
      bare("OpenAI sent a letter to the governor."),
    );

    expect(diagnostics.fallback.accepted).toBe(1);
    expect(diagnostics.fallback.rejected).toBe(0);
    expect(diagnostics.fallback.empty).toBe(0);
  });
});
