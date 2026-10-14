import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics } from "./editorial";
import { resolveNarrator, selectReaderEvidence } from "./reader-evidence";
import type { Story } from "./story";

/**
 * The object-only first-person class: the narrator forms `resolveNarrator` never
 * saw, and the boundary its ruling drew around them.
 *
 * The defect, read on the deployed origin (2026-10-14): "Two vulnerabilities
 * chained together gave us access to ChatGPT and Codex accounts belonging to
 * OpenAI employees." published with a first-person referent the page never
 * establishes, while the sentence beside it -- "We demonstrated ..." -- was
 * already rewritten to "The authors demonstrated ...".
 *
 * CAUSE, located in the shipped code rather than guessed: the guard that opens
 * `resolveNarrator` tested only the subject forms, so a unit whose only
 * first-person token was an object or possessive pronoun was never classified --
 * it fell through and published untouched. Five resolution steps already existed
 * behind that guard, and their last step has always been the refusal this class
 * needed.
 *
 * Every measurement below is from the live window (newest 1,000 articles,
 * 14 days, 7,816 reader units), with the probe named where it applies.
 */

/** The published sentence, verbatim, and its source's own attribution. */
const DEFECT =
  "Two vulnerabilities chained together gave us access to ChatGPT and Codex accounts belonging to OpenAI employees.";

describe("an object-only first person form reaches the narrator resolver", () => {
  it("classifies the published sentence instead of publishing it untouched", () => {
    // Before the guard was widened this returned null -- "not this function's
    // business" -- which is what let the sentence reach a reader as written. It
    // is withheld rather than rewritten: the actor noun is not established for
    // this sentence, and the resolver's last step is the refusal for that.
    expect(resolveNarrator(DEFECT, "authors")).toEqual({ text: "", kind: "ambiguous" });
  });

  it("withholds rather than inventing a pronoun with no antecedent", () => {
    // The tempting repair, and the reason the ruling refuses a default
    // replacement table: "gave them access" introduces a referent the page never
    // establishes. The existing `renameNarratorPronouns` produces exactly this
    // shape, and it runs only when the narrator's own subject clause is in the
    // same sentence -- which this sentence does not have.
    const resolved = resolveNarrator(DEFECT, "authors");
    expect(resolved?.text ?? "").not.toMatch(/\bthem\b/i);
    expect(resolved?.text ?? "").not.toBe(DEFECT);
  });

  it("classifies a possessive-only unit too", () => {
    // "mine", "ours" and the reflexive forms were never in the old guard either.
    expect(resolveNarrator("The remaining error term is ours to bound.", "authors")?.kind).toBe(
      "ambiguous",
    );
    expect(resolveNarrator("The higher bound in Figure 4 is mine.", "authors")?.kind).toBe(
      "ambiguous",
    );
  });

  it("reads an object pronoun inside a quotation as the speaker's, not the narrator's", () => {
    // The guard tests the unquoted text, so a quotation keeps its own voice. The
    // measured consequence of that gate is the whole reason the class is small:
    // the speaker in a quote is an established referent.
    expect(
      resolveNarrator(
        'Two vulnerabilities, the researchers wrote, were chained together and "gave us access to the accounts".',
        "authors",
      ),
    ).toBeNull();
  });

  it("does not read a pronoun out of a URL, a path or a hyphenated code token", () => {
    // Measured in the first draft of the live probe: three of the window's hits
    // were a token like this one, not prose.
    expect(
      resolveNarrator("Traffic shifted to us-west-2 within minutes of the failover.", "author"),
    ).toBeNull();
    expect(resolveNarrator("The mirror at /docs/us/install is stale.", "author")).toBeNull();
  });
});

describe("the country is not a first-person pronoun", () => {
  /**
   * The trap that cost this class its first measurement, twice: under
   * case-insensitive matching `us` matches `US`, and 40 of 57 hits in one draft
   * of the live probe were the country -- "the US", "US officials", "the US
   * Army". Each string below is verbatim from the window.
   */
  const country = [
    "US officials had been offering a reward of $10m (£7.5m) for information leading to Álvaro Pulido's arrest.",
    "The execution of Fort Hood gunman Nidal Hasan would be the first time the US Army had used a firing squad since 1945.",
    'Later that day, the US president claimed Russia and Ukraine had agreed to an "energy ceasefire" to halt attacks on each other\'s energy infrastructure.',
    "The US startup is part green cement company, part critical mineral producer.",
    "Today the OnePlus 16 launched in China, the company's first flagship phone since quitting both the US and European markets this summer.",
    "Zelensky was referring to a deal between Trump and Putin to release diesel from Russia to the US and the rest of the world.",
  ];

  it.each(country)("leaves a sentence about the country alone: %s", (text) => {
    expect(resolveNarrator(text, "author")).toBeNull();
  });

  it("still classifies the lowercase pronoun in the same window", () => {
    // The control that proves the test above is about case and not about the
    // sentence shape: same length, same source, one token different.
    expect(resolveNarrator("US officials gave us a copy of the letter.", "author")?.kind).toBe(
      "ambiguous",
    );
  });
});

describe("the source's own work is resolved to the actor its attribution establishes", () => {
  /**
   * Measured on the live window with the shipped predicate: six units, all of
   * them a paper's own narrative about its own method, all of them under a
   * repository source (`person === "authors"`). This is the one shape the ruling
   * allowed to be resolved rather than withheld, because the actor is the noun
   * the source's own attribution carries.
   */
  it("names the authors where the sentence's own work enables the pronoun", () => {
    expect(
      resolveNarrator(
        "This allows us to harness the accuracy of tree-based models like XGBoost; with cross-fitting, the method also produces unbiased estimates.",
        "authors",
      ),
    ).toEqual({
      kind: "claim",
      text: "This allows the authors to harness the accuracy of tree-based models like XGBoost; with cross-fitting, the method also produces unbiased estimates.",
    });
    expect(
      resolveNarrator(
        "Embedding it within a pairwise Lennard-Jones potential lets us examine its observability: the three-body term is recovered once its dynamical signature is known.",
        "authors",
      )?.text,
    ).toContain("lets the authors examine its observability");
    expect(
      resolveNarrator(
        "This factorization allows us to sample multiple object outcomes for a single robot plan, capturing the multi-modality of pushing.",
        "authors",
      )?.text,
    ).toContain("allows the authors to sample");
  });

  it("does not resolve when the source's identity for the actor noun is a single author", () => {
    // A repository source supplies "the authors". A blog or a news desk supplies
    // "the author", and naming one author for a sentence that says "us" would
    // have to guess the number -- so it is withheld instead. The measured live
    // unit is a company engineering blog, whose narrator is neither one author
    // nor a paper's authors.
    expect(
      resolveNarrator(
        "As a transport designed for both ingest and playback, MoQ gives us the foundation to build toward an architecture that is lower-latency and more resilient.",
        "author",
      ),
    ).toEqual({ text: "", kind: "ambiguous" });
    expect(
      resolveNarrator(
        "They can help describe what a student has done, but they do not always tell us how a student would respond to a particular explanation.",
        "author",
      )?.text,
    ).toBe("");
  });

  it("never resolves community voice to the authors of a paper", () => {
    // The live sentence, and the failure mode the ruling named: substituting
    // "the authors" here rewrites an audience into a paper's author list. The
    // simulated blind substitution produced "those of the authors who actively
    // wish to avoid it", which is a fact the source never wrote.
    const community =
      "The louder the noise about AI gets, the stronger grows the aversion of those of us who actively wish to avoid it.";
    const resolved = resolveNarrator(community, "authors");
    expect(resolved?.text ?? "").not.toMatch(/the authors/i);
    expect(resolved?.kind).toBe("ambiguous");
    // Even where the enabling verb is present, a group construction is not the
    // narrator being helped: "those of" is what stands between the two.
    expect(
      resolveNarrator(
        "That framing allows those of us who teach to reach students the lecture never did.",
        "authors",
      )?.text,
    ).toBe("");
  });

  it("never attributes a newsroom's received report to the authors", () => {
    // The live unit: "she told us during an interview". The referent is the
    // interviewing publication, not the paper's authors, and the ruling forbids
    // the substitution outright.
    expect(
      resolveNarrator(
        '"Those tend to be really driven by employees who are setting goals," she told us during an interview.',
        "authors",
      ),
    ).toEqual({ text: "", kind: "ambiguous" });
    expect(
      resolveNarrator(
        "u/cal93_'s latest Reddit update gave us more details about the transaction.",
        "authors",
      )?.text,
    ).toBe("");
  });

  it("keeps the community pronoun out of the resolved sentence entirely", () => {
    // Antecedent safety, stated as the invariant rather than the example: no
    // resolution may publish a bare third-person pronoun that the source never
    // wrote, and none may publish a first-person token.
    const probes = [
      DEFECT,
      "For us, the single most dominant theme in the talks, the materials, the stands, and even the T-shirts was AI.",
      "The aggregations on this dataset still gave us an approximate 80% reduction on the wire.",
      "Like the Renault 5 Turbo 3e from 2025, the E-T16 Concept shows us that hatchbacks still sell.",
    ];
    for (const text of probes) {
      const resolved = resolveNarrator(text, "authors");
      const out = resolved && resolved.kind !== "ambiguous" ? resolved.text : "";
      expect(out).not.toMatch(/\b(?:us|we|our|them|they)\b/i);
    }
  });
});

describe("the refusal reaches the reader through the existing path", () => {
  it("withholds the unit and counts it as an ambiguous narrator, with no new reason", () => {
    // The end-to-end control the ruling asked for: the refused unit cannot
    // re-enter through another path, and it is counted under the reason string
    // the taxonomy already carries -- no new counter, no new public failure
    // category.
    const selection = selectReaderEvidence("Severe vulnerabilities chained", [
      {
        name: "arXiv cs.CR",
        excerpt:
          "Two vulnerabilities chained together gave us access to ChatGPT and Codex accounts belonging to OpenAI employees.",
      },
    ]);
    expect(selection.facts).toEqual([]);
    expect(selection.rejectionReasons.narrator_ambiguous).toBe(1);
    expect(selection.rejectionReasons.invalid_sentence).toBe(0);
  });

  it("still publishes the same story's own work sentence once it is resolved", () => {
    // The slice is a widening of one guard plus one narrow resolution, not a
    // refusal of every first-person sentence: the paper's own method sentence
    // publishes, with the actor named.
    const selection = selectReaderEvidence("A bound on size-uniform approximation", [
      {
        name: "arXiv cs.LG",
        excerpt:
          "This reduction lets us transfer limitations on finite-color distinguishability to limitations on size-uniform approximation with continuous random features.",
      },
    ]);
    expect(selection.facts.map((fact) => fact.text)).toEqual([
      "This reduction lets the authors transfer limitations on finite-color distinguishability to limitations on size-uniform approximation with continuous random features.",
    ]);
  });

  it("publishes a sentence about the country unchanged", () => {
    const selection = selectReaderEvidence("A reward for information", [
      {
        name: "BBC World",
        excerpt:
          "US officials had been offering a reward of $10m (£7.5m) for information leading to Álvaro Pulido's arrest.",
      },
    ]);
    expect(selection.facts.map((fact) => fact.text)).toContain(
      "US officials had been offering a reward of $10m (£7.5m) for information leading to Álvaro Pulido's arrest.",
    );
  });
});

/**
 * A story whose source names an entity, which is the shape the second path is
 * reached through: the composer rebuilds a sentence straight out of the source
 * excerpt whenever that sentence names an entity the story carries.
 */
const storyNaming = (title: string, excerpt: string, name = "The Register"): Story => ({
  id: "narrator-object",
  org: name,
  title,
  what: "",
  why: "",
  importance: "Medium",
  score: { relevance: 50, importance: 50, novelty: 50 },
  sources: 1,
  topics: [],
  time: "",
  publishedAt: "2026-09-18T09:00:00Z",
  sourceList: [{ name, at: "", headline: title, excerpt }],
  before: "",
  after: "",
  timeline: [],
});

const composedText = (story: Story): string => {
  const { article } = composeArticleWithDiagnostics(story);
  return [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" ");
};

describe("a withheld unit cannot re-enter through the composer's entity path", () => {
  it("does not publish the community sentence the evidence pass refused", () => {
    // The live reader-facing survivor, verbatim: the evidence pass counted this
    // sentence as `narrator_ambiguous` and refused it, and the composer's entity
    // path published it anyway because it names NetBSD -- `publisherVoice` never
    // catches `us`, since under a case-insensitive test it is the country. The
    // path now asks the same resolver the evidence pass asks. Verified as a real
    // regression: with the path's narrator step removed, this test fails.
    //
    // The path's *resolution* branch -- publishing the named actor where the
    // resolver resolves -- is preventive rather than measured: no live unit in
    // the 2026-10-14 window reaches it, because the evidence pass carries every
    // own-work sentence and the path's `carriesSelected` test then skips it. It
    // is here so the raw first-person sentence cannot reappear with the resolved
    // copy already on the page, which the same sentence twice in two voices is.
    const story = storyNaming(
      "NetBSD may have found a new role",
      "For us, the single most dominant theme in the talks, the materials, the stands, and even the T-shirts was AI. NetBSD, on the other hand, bans AI-generated code.",
    );
    const text = composedText(story);
    expect(text).not.toMatch(/For us/);
    expect(text).not.toMatch(/the authors/i);
    // The neighbour still publishes: this is one rule on one unit, not a path
    // switched off.
    expect(text).toMatch(/NetBSD/);
  });
});
