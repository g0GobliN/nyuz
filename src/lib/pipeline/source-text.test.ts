import { describe, expect, it } from "vitest";

import {
  hasSourceMetadata,
  isRepositorySourceName,
  isSubjectCode,
  malformedAttribution,
  metadataOnlyEvidence,
  normalizeSourceMarkup,
  normalizeSourceText,
  providerFurniture,
  sourceFamily,
  sourceMarkupRemains,
} from "./source-text";

/** The production regression, verbatim: arXiv's cs.CR feed description. */
const ARXIV_DESCRIPTION =
  "ArXiv:2609.21081v1 Announce Type: new Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation.";

const ARXIV_ABSTRACT =
  "Human approval is often treated as the last security boundary before an agent executes a consequential operation.";

const ARXIV_SOURCE = { name: "arXiv cs.CR", url: "https://arxiv.org/abs/2609.21081v1" };

describe("normalizeSourceText", () => {
  it("reduces an arXiv description to its abstract", () => {
    const normalized = normalizeSourceText(ARXIV_SOURCE, ARXIV_DESCRIPTION);
    expect(normalized.text).toBe(ARXIV_ABSTRACT);
    expect(normalized.removedFields).toEqual(["arxiv", "announce type", "abstract"]);
    expect(normalized.metadataOnly).toBe(false);
    expect(normalized.family).toBe("arxiv");
  });

  it("reduces the announce-email header form with metadata-only fields", () => {
    const normalized = normalizeSourceText(
      ARXIV_SOURCE,
      [
        "Title: Loopjacking: Hijacking Human-in-the-Loop Approval",
        "Authors: A. Researcher, B. Researcher",
        "Subjects: Cryptography and Security (cs.CR)",
        "Comments: 14 pages, 2 figures",
        "Abstract: Human approval is often treated as the last security boundary before an agent executes a consequential operation.",
      ].join(" "),
    );
    expect(normalized.text).toBe(ARXIV_ABSTRACT);
    expect(normalized.removedFields).toContain("subjects");
    expect(normalized.removedFields).toContain("comments");
  });

  it("is independent of the order the fields arrived in", () => {
    const subjectFirst =
      "Subjects: cs.CR Announce Type: new ArXiv:2609.21081v1 Abstract: " + ARXIV_ABSTRACT;
    const idFirst =
      "ArXiv:2609.21081v1 Announce Type: new Subjects: cs.CR Abstract: " + ARXIV_ABSTRACT;
    expect(normalizeSourceText(ARXIV_SOURCE, subjectFirst).text).toBe(ARXIV_ABSTRACT);
    expect(normalizeSourceText(ARXIV_SOURCE, idFirst).text).toBe(ARXIV_ABSTRACT);
  });

  it("strips a leading subject code only for an arXiv source", () => {
    const text = "cs.LG Training runs on the new cluster completed in twelve hours.";
    expect(normalizeSourceText({ name: "arXiv cs.LG" }, text).text).toBe(
      "Training runs on the new cluster completed in twelve hours.",
    );
    // A non-repository source keeps its own words, because "cs.LG" there is text.
    expect(normalizeSourceText({ name: "The Register" }, text).text).toBe(text);
  });

  it("returns metadata-only text as empty and flags it", () => {
    for (const text of [
      "Subjects: Cryptography and Security (cs.CR) Published: 2026-09-20",
      "Authors: A. Researcher, B. Researcher",
      "Comments: 14 pages, 2 figures",
      "Title: Loopjacking",
    ]) {
      const normalized = normalizeSourceText(ARXIV_SOURCE, text);
      expect(normalized.text).toBe("");
      expect(normalized.metadataOnly).toBe(true);
    }
  });

  it.each([
    "The paper was posted to arXiv.",
    "The abstract describes three experiments.",
    "The study is classified under computer security.",
    "Researchers said the abstract: it was unclear in the released version.",
    "Authors of the study reported their results at the conference.",
    "In 30 years in this business, we've never seen so much backing.",
  ])("leaves genuine prose untouched: %s", (text) => {
    const normalized = normalizeSourceText(ARXIV_SOURCE, text);
    expect(normalized.text).toBe(text);
    expect(normalized.removedFields).toEqual([]);
    expect(normalized.metadataOnly).toBe(false);
  });

  it("keeps a metadata field's value when it is a sentence rather than a value", () => {
    const normalized = normalizeSourceText(
      { name: "A feed" },
      "Comments: the regulator said the deal needs a review.",
    );
    expect(normalized.text).toBe("the regulator said the deal needs a review.");
  });

  it("normalizes other structured feed shapes without touching normal feeds", () => {
    expect(
      normalizeSourceText(
        { name: "GitHub" },
        "Title: Release 2.0 Authors: octocat Abstract: The maintainers merged the OpenVINO backend update this week.",
      ).text,
    ).toBe("The maintainers merged the OpenVINO backend update this week.");
    expect(
      normalizeSourceText(
        { name: "A government feed" },
        "Published: 2026-09-20 Description: The agency opened the consultation on Tuesday.",
      ).text,
    ).toBe("The agency opened the consultation on Tuesday.");
    const ordinary = "Nvidia announced that it would ship its next accelerator in March 2027.";
    expect(normalizeSourceText({ name: "Reuters" }, ordinary).text).toBe(ordinary);
  });

  it("stays cheap and unchanged on long text with no leading field", () => {
    const long = `${"The company reported quarterly revenue growth in every region it operates. ".repeat(300)}`;
    const normalized = normalizeSourceText({ name: "Reuters" }, long);
    expect(normalized.text.startsWith("The company reported")).toBe(true);
    expect(normalized.removedFields).toEqual([]);
  });

  it("identifies the arXiv family from the name or the URL", () => {
    expect(sourceFamily({ name: "arXiv cs.CR" })).toBe("arxiv");
    expect(sourceFamily({ url: "https://arxiv.org/rss/cs.CR" })).toBe("arxiv");
    expect(sourceFamily({ name: "The Register" })).toBe("generic");
    expect(sourceFamily(undefined)).toBe("generic");
  });

  /**
   * A paper's "we" is the authors, and nyuz is not one of them.
   *
   * The evidence layer rejects first-person text outright as publisher voice,
   * which is right for a newsletter and wrong for an abstract: an entire paper
   * written in the first person plural used to disappear before composition ever
   * saw it. The actors are known, so the pronoun is resolved at this boundary --
   * where the sentence still exists to repair.
   */
  it("resolves a repository's own voice to the authors", () => {
    const normalized = normalizeSourceText(
      ARXIV_SOURCE,
      "We call failures of this binding Loopjacking. Our results show the attack works. We've reproduced it in seven releases.",
    );
    expect(normalized.text).toBe(
      "The authors call failures of this binding Loopjacking. The authors' results show the attack works. The authors have reproduced it in seven releases.",
    );
    expect(normalized.authorialVoiceRewrites).toBe(3);
  });

  it("leaves prose alone in a source that is not a repository", () => {
    const text = "We tested the update for a week. Our verdict is that it holds up.";
    const register = normalizeSourceText({ name: "The Register" }, text);
    expect(register.text).toBe(text);
    expect(register.authorialVoiceRewrites).toBe(0);
  });

  it("touches only a pronoun that opens a sentence", () => {
    const normalized = normalizeSourceText(
      ARXIV_SOURCE,
      "This lets us compare the two, and the approach we adopted is simple.",
    );
    expect(normalized.text).toBe(
      "This lets us compare the two, and the approach we adopted is simple.",
    );
    expect(normalized.authorialVoiceRewrites).toBe(0);
  });

  it("reports no rewrite when there is no first person to resolve", () => {
    const normalized = normalizeSourceText(ARXIV_SOURCE, ARXIV_DESCRIPTION);
    expect(normalized.text).toBe(ARXIV_ABSTRACT);
    expect(normalized.authorialVoiceRewrites).toBe(0);
  });
});

describe("evidence-level detectors", () => {
  it("flags a leaked provider field at the start of a sentence", () => {
    expect(
      hasSourceMetadata("Abstract: Human approval is often treated as the last boundary."),
    ).toBe(true);
    expect(hasSourceMetadata(ARXIV_DESCRIPTION)).toBe(true);
    expect(hasSourceMetadata(ARXIV_ABSTRACT)).toBe(false);
    expect(hasSourceMetadata("The abstract describes three experiments.")).toBe(false);
  });

  it("rejects identifiers and subject codes that are all a unit contains", () => {
    expect(metadataOnlyEvidence("cs.CR")).toBe(true);
    expect(metadataOnlyEvidence("stat.ML, cs.LG")).toBe(true);
    expect(metadataOnlyEvidence("2609.21081v1")).toBe(true);
    expect(metadataOnlyEvidence(ARXIV_ABSTRACT)).toBe(false);
    expect(metadataOnlyEvidence("Human approval is")).toBe(false);
    expect(metadataOnlyEvidence("")).toBe(true);
  });
});

describe("source semantics", () => {
  it("treats repositories and subject taxonomies as non-claimants", () => {
    for (const name of ["arXiv cs.CR", "arXiv", "cs.LG", "stat.ML", "bioRxiv", "SSRN"])
      expect(isRepositorySourceName(name)).toBe(true);
    for (const name of ["The Register", "Reuters", "Telecoms.com", "BleepingComputer", ""])
      expect(isRepositorySourceName(name)).toBe(false);
  });

  it("recognizes the general arXiv category shape, not one category", () => {
    expect(isSubjectCode("cs.CR")).toBe(true);
    expect(isSubjectCode("cs.AI")).toBe(true);
    expect(isSubjectCode("stat.ML")).toBe(true);
    expect(isSubjectCode("eess.AS")).toBe(true);
    // A domain is not an archive prefix, and neither is a random pair.
    expect(isSubjectCode("example.com")).toBe(false);
    expect(isSubjectCode("openai.com")).toBe(false);
    expect(isSubjectCode("news.ai")).toBe(false);
    // A bare archive name is caught by the repository rule instead.
    expect(isSubjectCode("hep-th")).toBe(false);
    expect(isRepositorySourceName("arXiv hep-th")).toBe(true);
  });

  it("flags attribution to a repository or a category as malformed", () => {
    expect(malformedAttribution("According to arXiv cs.CR, Human approval is often treated")).toBe(
      true,
    );
    expect(malformedAttribution("According to cs.LG, training runs completed")).toBe(true);
    expect(malformedAttribution("According to The Register, the flaw was fixed")).toBe(false);
    expect(malformedAttribution(ARXIV_ABSTRACT)).toBe(false);
  });
});

/**
 * The furniture class, from production. These strings were reaching readers as
 * the article deck -- the sentence under a headline -- because the one path that
 * never met the quality gate was the fallback deck, and a feed's `description`
 * field is where a provider keeps everything that is not the article.
 */
describe("provider furniture", () => {
  it.each([
    ["a photo credit", "Photograph: Alexandra Topping/The Guardian.", "photo_credit"],
    [
      "a composite credit",
      "Composite: Kin Cheung/Getty Images; Tasos Katopodis/Getty",
      "photo_credit",
    ],
    ["a credit without its label", "Alexandra Topping/The Guardian.", "photo_credit"],
    [
      "git trailers",
      "According to vLLM releases, Signed-off-by: khluu khluu000@gmail.com Co-authored-by: OpenAI Codex noreply@openai.com (cherry picked from commit eb87980).",
      "commit_trailer",
    ],
    ["a trailer on its own", "Signed-off-by: khluu khluu000@gmail.com", "commit_trailer"],
    [
      "release-page labels",
      "CUDA: tune FA for Gemma 4 on Ampere or newer (#29152) Website: https://llama.app Attestations: ...",
      "release_metadata",
    ],
    ["a release field", "Website: https://llama.app", "release_metadata"],
    ["a checksum list", "SHA256: 9f2b1c4d5e6a7b8c9d0e1f2a3b4c5d6e", "release_metadata"],
  ])("recognizes %s", (_label, text, kind) => {
    expect(providerFurniture(text)).toBe(kind);
  });

  it.each([
    "Getty Images reported a rise in licensing revenue.",
    "The photographer told Reuters that the image was taken on Monday.",
    "Developers signed off on the proposal after review.",
    "The project website says the release includes new CUDA optimizations.",
    "The team confirmed the release: version 4 ships Friday.",
    "The report was filed by Mary Smith/The Times in Washington.",
    "The attack was tracked as CVE-2024-3094 and patched within a day.",
    "She used the commit message as evidence of intent.",
    "Images from the satellite showed the burn scar by morning.",
  ])("leaves genuine prose alone: %s", (text) => {
    expect(providerFurniture(text)).toBeNull();
  });

  it("refuses a description that is nothing but a credit", () => {
    const normalization = normalizeSourceText(
      undefined,
      "Photograph: Alexandra Topping/The Guardian.",
    );
    expect(normalization.metadataOnly).toBe(true);
    expect(normalization.text).toBe("");
  });

  it("keeps a labelled field's value when the value is prose", () => {
    // Dropping the label is not the same as dropping the record: `Release:` is
    // furniture, but the sentence after it is a fact, and the existing
    // prose-value rescue keeps it.
    const normalization = normalizeSourceText(
      undefined,
      "Release: the new version is available on Friday with CUDA optimizations for Ampere.",
    );
    expect(normalization.text).toContain("new version is available on Friday");
    expect(normalization.text).not.toContain("Release:");
  });
});

/**
 * A paper's own typesetting, seen by a reader.
 *
 * On 2026-10-03, 12 of the 100 stories the briefing would publish carried raw
 * markup in their published prose — `\textbf{OpenSpace Lab}`, `$2^{128}$` — and
 * every one was a research abstract. A reader does not need to know LaTeX to
 * notice that something went wrong, so the boundary has two halves: unwrap a
 * typesetting command whose payload is prose, and refuse a unit whose markup
 * carries meaning.
 */
describe("source markup", () => {
  it("unwraps a typesetting command whose payload is ordinary prose", () => {
    const { text, unwrapped } = normalizeSourceMarkup(
      "This report presents the \\textbf{OpenSpace Lab}'s solution to the competition.",
    );
    expect(text).toBe("This report presents the OpenSpace Lab's solution to the competition.");
    expect(unwrapped).toBe(1);
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it("refuses to unwrap a wrapper whose payload is a formula", () => {
    // The same command, and the payload is what decides. Flattening this gives
    // "Parity-G games", which is no longer the authors' phrase.
    const input = "The authors introduce $\\textit{Parity-$G$ games}$ in the paper.";
    const { text, unwrapped } = normalizeSourceMarkup(input);
    expect(text).toBe(input);
    expect(unwrapped).toBe(0);
    expect(sourceMarkupRemains(text)).toBe(true);
  });

  it.each([
    "For a grid of $2^{128}$ protocol keys the bound holds.",
    "On a regular $(3,6)$ LDPC-coded link one key per codeword suffices.",
  ])("still finds mathematics after normalization: %s", (text) => {
    expect(normalizeSourceMarkup(text).text).toBe(text);
    expect(sourceMarkupRemains(text)).toBe(true);
  });

  it("renders an inline formula as the token it stands for", () => {
    // A briefing does not typeset. `$k$` is `k`, and `$98\%$` is `98%` -- the
    // value the authors reported, without the source's serialization in it.
    const { text, unwrapped } = normalizeSourceMarkup(
      "For a constellation whose $k$ tones share a phase, the bound is $98\\%$ and the rate is $1/5$.",
    );
    expect(text).toBe(
      "For a constellation whose k tones share a phase, the bound is 98% and the rate is 1/5.",
    );
    expect(unwrapped).toBe(3);
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it("unwraps a multi-word formula without losing the authors' phrase", () => {
    const { text } = normalizeSourceMarkup(
      "The extension preserves the values of $G$ in the $Parity Magic Square Game$ exactly.",
    );
    expect(text).toBe(
      "The extension preserves the values of G in the Parity Magic Square Game exactly.",
    );
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it("finds the formula that is not first", () => {
    // Seven blocks of arithmetic reached a reader because the check read only
    // the opening `$...$` pair. An abstract that opens with a bare number hid a
    // `%` behind it.
    const text = "Under E91 noise the win rate is $0.135$ against $98\\%$ for the baseline.";
    expect(normalizeSourceMarkup(text).text).toBe(
      "Under E91 noise the win rate is 0.135 against 98% for the baseline.",
    );
    expect(sourceMarkupRemains(normalizeSourceMarkup(text).text)).toBe(false);
    expect(sourceMarkupRemains(`The value is $0.135$ but $x^{2}$ decides it.`)).toBe(true);
  });

  it("does not mistake a price for mathematics", () => {
    // The first draft of this rule counted any `$...$` pair, and flagged six
    // real news sentences because a television range reads as one enormous
    // inline formula. A dollar run with no mathematical signal is money.
    const text = "Samsung's M-series TVs range from $300 to $2,300 depending on the size.";
    expect(normalizeSourceMarkup(text).text).toBe(text);
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it.each([
    "Samsung's M-series TVs range from $300 for a 43-inch model to $2,300 for a 100-inch one.",
    "Mandiant, which sold to Google for $5.4 billion in 2022, has raised $6.7 billion since.",
  ])("leaves a real amount alone: %s", (text) => {
    expect(normalizeSourceMarkup(text).text).toBe(text);
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it.each([
    [
      "Support shifts by only 0--2.5%, and corrupted rationales shift it by 10--22%.",
      "Support shifts by only 0–2.5%, and corrupted rationales shift it by 10–22%.",
    ],
    [
      "Applied to the Mermin--Peres Magic Square Game, it yields a new pseudo-telepathy game.",
      "Applied to the Mermin–Peres Magic Square Game, it yields a new pseudo-telepathy game.",
    ],
    [
      "The noise level follows an Ornstein--Uhlenbeck process and the budget closes the round.",
      "The noise level follows an Ornstein–Uhlenbeck process and the budget closes the round.",
    ],
    [
      "The study closes with a claim of value---and the value is not money.",
      "The study closes with a claim of value—and the value is not money.",
    ],
    [
      "Siemens ended -- and closed -- access to the OpenRadioss project.",
      "Siemens ended – and closed – access to the OpenRadioss project.",
    ],
    [
      "A trailing note exposes a ``price'' of algorithmic anarchy.",
      "A trailing note exposes a “price” of algorithmic anarchy.",
    ],
  ])("spells a source's dash and quote runs the way English does: %s", (input, expected) => {
    const { text } = normalizeSourceMarkup(input);
    expect(text).toBe(expected);
    expect(sourceMarkupRemains(text)).toBe(false);
  });

  it.each([
    [
      "The deadline miss ratio was 1.8\\% across the suite.",
      "The deadline miss ratio was 1.8% across the suite.",
    ],
    [
      "It reached 61.04\\% coverage on the public track.",
      "It reached 61.04% coverage on the public track.",
    ],
    [
      "R&D accounts for 40\\% of the total, and 3\\_4 of the rows agree.",
      "R&D accounts for 40% of the total, and 3_4 of the rows agree.",
    ],
  ])(
    "strips a bare escape, which the first pass only reached inside a formula: %s",
    (input, expected) => {
      // `$98\%$` was fixed and `1.8\%` was not, because the escape class was only
      // applied to a math span. Two abstracts published a backslash to the reader.
      expect(normalizeSourceMarkup(input).text).toBe(expected);
    },
  );

  it.each([
    ["The authors write \\alpha and \\frac{a}{b} in the same paragraph."],
    ["A double backslash \\\\ is LaTeX's own line break and is not one of ours."],
    ["Plain prose with no markup at all, and no escape either."],
  ])("leaves a command and a doubled backslash alone: %s", (input) => {
    expect(normalizeSourceMarkup(input).text).toBe(input);
  });

  it.each([
    "He called the price 'fair' for a farmer.",
    "rock 'n' roll sells records.",
    "The regulator approved the merger on Tuesday after a lengthy review.",
    "The reading sat at 0.135 and the noise floor at 0.348.",
  ])("leaves punctuation that is already prose alone: %s", (input) => {
    expect(normalizeSourceMarkup(input).text).toBe(input);
  });

  it("leaves ordinary prose and unescaped text alone", () => {
    for (const text of [
      "The regulator approved the merger on Tuesday after a lengthy review.",
      "Revenue rose to $4.2 billion, the company said in its filing.",
    ]) {
      const result = normalizeSourceMarkup(text);
      expect(result.text).toBe(text);
      expect(result.unwrapped).toBe(0);
      expect(sourceMarkupRemains(text)).toBe(false);
    }
  });
});
