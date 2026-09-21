import { describe, expect, it } from "vitest";
import {
  hasSourceMetadata,
  isRepositorySourceName,
  isSubjectCode,
  malformedAttribution,
  metadataOnlyEvidence,
  normalizeSourceText,
  sourceFamily,
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
