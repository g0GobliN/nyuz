import { describe, expect, it } from "vitest";
import { extractQuotes, selectEvidenceUnits, MAX_EVIDENCE_UNITS } from "./evidence-extract";
import {
  cleanDeterministicSentence,
  deterministicFactType,
  normalizedNumericKey,
  validDeterministicSentence,
} from "@/lib/reader-evidence";

describe("extractQuotes", () => {
  it("extracts a trailing-attribution quote", () => {
    const quotes = extractQuotes('"We are thrilled about this partnership," said Jane Smith.');
    expect(quotes).toEqual([
      { quote: "We are thrilled about this partnership,", attribution: "Jane Smith" },
    ]);
  });

  it("extracts a leading-attribution quote", () => {
    const quotes = extractQuotes(
      'John Doe said, "The results exceeded our expectations this quarter."',
    );
    expect(quotes[0]?.quote).toBe("The results exceeded our expectations this quarter.");
    expect(quotes[0]?.attribution).toBe("John Doe");
  });

  it("ignores quotes shorter than the minimum length (likely not real quotes)", () => {
    expect(extractQuotes('"OK," said Sam.')).toEqual([]);
  });

  it("caps the number of quotes extracted from one article", () => {
    const many = Array.from(
      { length: 8 },
      (_, i) =>
        `"This is a distinct quoted sentence number ${i} about the story," said Person ${i}.`,
    ).join(" ");
    expect(extractQuotes(many).length).toBeLessThanOrEqual(4);
  });
});

describe("selectEvidenceUnits", () => {
  it("selects fact-dense sentences and classifies uncertain ones separately", () => {
    const text =
      "Nvidia announced Monday it will acquire Hugging Face for $13 billion. " +
      "The deal represents a 40% premium over the company's last private valuation. " +
      "A company spokesperson declined to comment on the exact closing timeline. " +
      "The weather in the region was mild that day.";

    const units = selectEvidenceUnits(text);
    const facts = units.filter((u) => u.kind === "fact");
    const uncertain = units.filter((u) => u.kind === "uncertain");

    expect(facts.some((u) => u.text.includes("$13 billion"))).toBe(true);
    expect(uncertain.some((u) => u.text.includes("declined to comment"))).toBe(true);
  });

  it("keeps quotes as separate units with attribution, excluded from the plain-text sentences", () => {
    const text =
      'The company confirmed the acquisition today. "We could not be more excited about this deal," said Maria Chen, the CEO.';
    const units = selectEvidenceUnits(text);
    const quote = units.find((u) => u.kind === "quote");
    expect(quote?.attribution).toBe("Maria Chen");
    expect(quote?.text).toContain("could not be more excited");
    expect(
      units.some((u) => u.kind !== "quote" && u.text.includes('"We could not be more excited')),
    ).toBe(false);
  });

  it("keeps factual newsletter reporting but excludes promotional quotes", () => {
    const units = selectEvidenceUnits(
      'The newsletter reached 400 paid subscribers during its first year of publication. "Subscribe to our newsletter for a 50% discount", said Alice Smith.',
    );
    expect(units.some((unit) => unit.text.includes("400 paid subscribers"))).toBe(true);
    expect(units.some((unit) => unit.text.includes("50%"))).toBe(false);
  });

  it("drops boilerplate sentences (subscribe prompts, cookie notices, share links)", () => {
    const text =
      "Sign up for our newsletter to get more stories like this delivered to your inbox every morning. " +
      "The company reported quarterly revenue of $500 million, up from the prior year.";
    const units = selectEvidenceUnits(text);
    expect(units.some((u) => /newsletter/i.test(u.text))).toBe(false);
    expect(units.some((u) => u.text.includes("$500 million"))).toBe(true);
  });

  it("attaches named entities found in a sentence", () => {
    const text =
      "OpenAI's ChatGPT integration with Microsoft Azure expanded significantly this week.";
    const units = selectEvidenceUnits(text);
    const withEntities = units.find((u) => u.entities?.includes("OpenAI"));
    expect(withEntities?.entities).toEqual(expect.arrayContaining(["OpenAI"]));
  });

  it("never exceeds the maximum evidence unit count for plain sentences", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `The company confirmed detail number ${i} about the ongoing expansion plan today.`,
    ).join(" ");
    const units = selectEvidenceUnits(sentences);
    expect(units.filter((u) => u.kind !== "quote").length).toBeLessThanOrEqual(MAX_EVIDENCE_UNITS);
  });

  it("deduplicates near-identical sentences rather than keeping every repetition", () => {
    const text =
      "The company announced a major new product launch today. " +
      "The company today announced a major new product launch. " +
      "Company announced today a major new product launch.";
    const units = selectEvidenceUnits(text);
    expect(units.filter((u) => u.kind !== "quote")).toHaveLength(1);
  });

  it("never keeps a unit longer than 320 characters (copyright-safety bound)", () => {
    const longSentence = `This sentence goes on and on with a lot of repeated words and clauses about the acquisition deal and its terms and conditions and structure and financing arrangement and closing timeline and regulatory approvals process, all of which matter enormously to shareholders and analysts and reporters covering it. ${"x"}`;
    const units = selectEvidenceUnits(longSentence);
    for (const unit of units) expect(unit.text.length).toBeLessThanOrEqual(320);
  });

  it("reorders by fact density rather than preserving strict source order (avoids mirroring phrasing/order)", () => {
    const text =
      "The company held its usual weekly meeting on Tuesday as it normally does every single week. " +
      "The company confirmed a $2.5 billion acquisition of a rival firm, its largest deal ever.";
    const units = selectEvidenceUnits(text).filter((u) => u.kind !== "quote");
    expect(units[0]?.text).toContain("$2.5 billion");
  });

  it("rejects malformed openings and cleans source-specific slang", () => {
    expect(validDeterministicSentence("No adds that the report changed direction.")).toBe(false);
    expect(validDeterministicSentence("According to The Register, Once the model starts.")).toBe(
      false,
    );
    expect(cleanDeterministicSentence("The AI bit barn uses monster racks.")).toBe(
      "The AI datacenter uses AI server racks.",
    );
  });

  it("classifies projections and normalizes equivalent numeric spellings for comparison", () => {
    expect(deterministicFactType("BAN's model projects 395 million tonnes by 2050.")).toBe(
      "projection",
    );
    expect(normalizedNumericKey("395 million tonnes")).toBe(normalizedNumericKey("395m tonnes"));
  });
});
