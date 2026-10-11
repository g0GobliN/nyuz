/**
 * The quote-opening classifier, pinned by the cases that decide it.
 *
 * This ruler lives in `scripts/lib/defects.ts` rather than in `src` because it is
 * a *measurement* -- nothing the reader receives changes because of it -- and the
 * other rulers the audit and the before/after diff share live there too. It is
 * tested from `src` because that is where the suite runs; `coverage-floor.test.ts`
 * imports from `scripts/lib` for the same reason.
 *
 * The arbiter's ruling of 2026-10-11 (option (a) of the quote-opening queue) is
 * the specification: a quote opening is a defect when the page lacks the context
 * needed to read it, or when it genuinely repeats something already published --
 * never because it begins with quoted speech. So every test here is one of the
 * ruling's own rows, including the two the ruling singled out: a speaker named
 * elsewhere on the page is a valid lead, and a name *inside* the quotation is not
 * a speaker at all.
 */
import { describe, expect, it } from "vitest";
import {
  attributionSeam,
  quoteOpeningEvidence,
  withoutQuotedSpeech,
} from "../../scripts/lib/defects";

describe("a name inside a quotation is the speaker's words, not the page's", () => {
  it("removes quoted speech before any name is read", () => {
    expect(withoutQuotedSpeech('"I met Jane Smith in Osaka," the minister said.')).not.toContain(
      "Jane Smith",
    );
  });

  it("does not let a name inside the quotation stand for the speaker", () => {
    // The ruling's own distinction: the quote names somebody, and the page still
    // does not say who is talking. Reading the raw text would call this valid.
    const page = ['"I spoke to Jane Smith last week," the minister told reporters.'];
    const evidence = quoteOpeningEvidence({
      page,
      index: 0,
      names: ["Jane Smith"],
      unrendered: [],
    });
    expect(evidence.attribution).toBe("");
    expect(evidence.attributionSentence).toBe("");
    expect(evidence.where).toBe("none");
    expect(evidence.class).toBe("unresolved");
  });
});

describe("the page resolves the opening, or it does not", () => {
  it("is a valid lead when the block itself names the speaker", () => {
    const page = ['"We are not going to rush this," said Jane Smith.'];
    expect(
      quoteOpeningEvidence({ page, index: 0, names: ["Jane Smith"], unrendered: [] }),
    ).toMatchObject({ class: "valid", attribution: "Jane Smith", where: "block" });
  });

  it("is a valid lead when another block on the page names the speaker", () => {
    // The ruling, verbatim: a speaker does not have to be named in the same
    // sentence if the page already establishes who is speaking.
    const page = [
      "Jane Smith, who chairs the regulator, said the review would close this year.",
      '"Nothing has been decided yet," she added, without repeating her own name.',
    ];
    expect(
      quoteOpeningEvidence({ page, index: 1, names: ["Jane Smith"], unrendered: [] }),
    ).toMatchObject({ class: "valid", attribution: "Jane Smith", where: "page" });
  });

  it("reads a name handed to the verb in either direction, and only within one sentence", () => {
    expect(
      attributionSeam("The finding was described by Jane Smith last month.", ["Jane Smith"]),
    ).toBe("");
    expect(
      attributionSeam('"Not yet," the chair said. Jane Smith declined to comment.', ["Jane Smith"]),
    ).toBe("");
    expect(attributionSeam(", said Jane Smith, chair of the regulator.", ["Jane Smith"])).toBe(
      "Jane Smith",
    );
  });

  it("reports the sentence the name was found in, not just the name", () => {
    // The ruling asks for "where the attribution or necessary context appears",
    // and a name on its own does not answer it: the ruler reports *an* entity in
    // an attribution seam, which is sometimes an organisation standing beside the
    // verb and sometimes a name the entity extractor cut short. The sentence is the
    // evidence a reviewer checks the classification against.
    const page = [
      "The review would close this year, Jane Smith of the regulator said on Tuesday.",
      '"Nothing has been decided yet," she added.',
    ];
    const evidence = quoteOpeningEvidence({
      page,
      index: 1,
      names: ["Jane Smith"],
      unrendered: [],
    });
    expect(evidence.attribution).toBe("Jane Smith");
    expect(evidence.attributionSentence).toBe(
      "The review would close this year, Jane Smith of the regulator said on Tuesday.",
    );
  });

  it("leaves an opening nothing resolves as unresolved rather than calling it a defect", () => {
    // Not a confirmed defect: the page names nobody and the ledger shows the
    // composer had no attribution either, so this is a list to read by hand
    // before anyone spends a slice on it.
    const page = ['"We are still waiting for the paperwork," with no name attached.'];
    expect(
      quoteOpeningEvidence({ page, index: 0, names: ["Jane Smith"], unrendered: [] }).class,
    ).toBe("unresolved");
  });
});

describe("a repeat above it is a confirmed defect, whatever the speaker", () => {
  const sentence = "The commission withdrew its finding that the application was complete.";

  it("confirms the duplicate by sentence identity, not by similarity", () => {
    const page = [sentence, `"${sentence}" the filing added.`];
    const evidence = quoteOpeningEvidence({
      page,
      index: 1,
      names: [],
      unrendered: [],
    });
    expect(evidence.class).toBe("duplicate");
    expect(evidence.duplicateOf).toBe(sentence);
  });

  it("does not count a sentence the reader has not read yet", () => {
    // Below it is not above it. The block that did it first is where the defect
    // is reported, once.
    const page = [`"${sentence}" the filing added.`, sentence];
    expect(quoteOpeningEvidence({ page, index: 0, names: [], unrendered: [] }).class).not.toBe(
      "duplicate",
    );
  });

  it("reports a repeated opening as a duplicate even when the page names the speaker", () => {
    const page = [sentence, `"${sentence}" said Jane Smith.`];
    expect(
      quoteOpeningEvidence({ page, index: 1, names: ["Jane Smith"], unrendered: [] }).class,
    ).toBe("duplicate");
  });
});

describe("an attribution the composer had and charged is not silently dropped", () => {
  it("confirms the case where the only sentence naming the speaker was refused", () => {
    // The ruling's fifth row: the source carries an attribution, it was refused or
    // never published, and the quote is left standing without it. Do not invent an
    // attribution -- and do not lose one without recording it.
    const page = ['"The grid connection must still be approved before construction starts."'];
    const unrendered = [
      { text: "Jane Smith said the decision was expected this week.", rule: "unresolved_context" },
    ];
    expect(
      quoteOpeningEvidence({ page, index: 0, names: ["Jane Smith"], unrendered }),
    ).toMatchObject({
      class: "attribution-refused",
      refusedRule: "unresolved_context",
      where: "none",
    });
  });

  it("does not report a charged fact when the page already names the speaker", () => {
    const page = ['"The paperwork is not ready," said Jane Smith.'];
    const unrendered = [
      { text: "Jane Smith said the review would close in May.", rule: "short_block" },
    ];
    const evidence = quoteOpeningEvidence({ page, index: 0, names: ["Jane Smith"], unrendered });
    expect(evidence.class).toBe("valid");
    expect(evidence.refusedRule).toBe("");
  });
});
