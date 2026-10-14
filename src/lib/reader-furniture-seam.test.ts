import { describe, expect, it } from "vitest";
import {
  selectReaderEvidence,
  sourceFurnitureHead,
  sourceSeam,
  unitTextRejection,
} from "./reader-evidence";

/**
 * The furniture a source welds to the front of its own sentence.
 *
 * Read on the **live product** on 2026-10-14 (deployed origin), as a stranger
 * would read it, and handed back by `selectReaderEvidence` as publishable facts:
 *
 *   story 29ad32c2 (Hackers breach OpenAI)
 *     "The full chain:…September 18, 2026 Operating as hackers under OpenAI's
 *      bug bounty program, Hacktron researchers uncovered critical
 *      vulnerabilities …"
 *   story 7af726e6 (AI-powered fuzzing with the GitHub Security Lab Taskflow
 *   Agent)
 *     "Model selection Some frontier models impose security guardrails on their
 *      outputs, according to GitHub."
 *     "The architecture in one minute Before getting into the interesting
 *      parts, it helps to know how the pieces fit together."
 *
 * GOB-12's reader-quality contract names this class critical and never-ship
 * ("Source metadata / extraction furniture in reader prose"), and the T1 ruler
 * does not see it: `truncatedSentence` fires on a sentence that *ends* on a
 * month or a function word, and `RAW_URL_WITH_PATH` fires on a scheme, `www.` or
 * a path -- all four strings end on ordinary words and carry no address.
 *
 * The negative controls are not invented. Every one of them is a unit the first
 * draft of this rule refused on a scan of 7,926 live-window units, and each is
 * ordinary prose -- a publication named after "to" ("According to The Register"),
 * a first-person clause ("The other day I …"), a product name carrying a digit
 * ("with the A19 chip"). The tightened rule matches 1 of those 7,926 units, and
 * that one is a true positive: "A shelf of diminutive apps With TinyJS, …".
 */

const LIVE_FURNITURE = [
  {
    label: "a label and a dateline welded to the sentence under them",
    text:
      "The full chain:…September 18, 2026 Operating as hackers under OpenAI’s bug bounty program, " +
      "Hacktron researchers uncovered critical vulnerabilities that granted them access to internal " +
      "employee tools and the ability to compromise private software repositories.",
  },
  {
    label: "a sentence-cased subhead before a clause opening on Some",
    text: "Model selection Some frontier models impose security guardrails on their outputs, according to GitHub.",
  },
  {
    label: "a sentence-cased subhead before a clause opening on Before",
    text:
      "The architecture in one minute Before getting into the interesting parts, it helps to know how " +
      "the pieces fit together.",
  },
  {
    label: "the same weld found in the live-window scan",
    text:
      "A shelf of diminutive apps With TinyJS, Stroh-Spijer created an “app store” that can be run, " +
      "natch, from the desktop.",
  },
];

describe("sourceFurnitureHead refuses the live furniture welds", () => {
  for (const item of LIVE_FURNITURE) {
    it(`refuses ${item.label}`, () => {
      expect(sourceFurnitureHead(item.text)).not.toBeNull();
      // The seam family's verdict, so every existing caller is covered: the
      // evidence pass, the composer's entity path and the fallback deck.
      expect(sourceSeam(item.text)).not.toBeNull();
      expect(unitTextRejection(item.text, false)).toBe("invalid_sentence");
    });
  }

  it("keeps the sentence under the label, which is the fact worth keeping", () => {
    const text =
      "Hacktron researchers uncovered critical vulnerabilities that granted them access to internal " +
      "employee tools and the ability to compromise private software repositories.";
    expect(sourceSeam(text)).toBeNull();
    expect(unitTextRejection(text, false)).toBeNull();
  });
});

describe("sourceFurnitureHead keeps the prose its first draft refused", () => {
  const KEPT = [
    "According to The Register, Pays ApS, an IT and data services company, was the source of the hack.",
    "In an emailed statement to The Washington Post, the coroner's office said the cause was a cardiac event.",
    "The other day I whizzed past several people while running in the park, my playlist blasting.",
    "The number I keep coming back to, though, isn't a throughput record.",
    "Some of the researchers The Verge spoke to found nonsense explanations within the reports.",
    "It's powerful, with the A19 chip, and it features better wireless connectivity than its predecessor.",
    // A dateline at the start of a sentence is a date, not a welded label.
    "September 18, 2026 was the day the researchers reported it to OpenAI.",
    // A label whose head carries a verb is a clause, not furniture.
    "The company said: September 18, 2026 will be remembered for a long time.",
  ];

  for (const text of KEPT) {
    it(`keeps: ${text.slice(0, 62)}`, () => {
      expect(sourceFurnitureHead(text)).toBeNull();
      expect(sourceSeam(text)).toBeNull();
    });
  }
});

describe("the reader never receives the welded fact", () => {
  it("drops the furniture unit from the facts the composer publishes", () => {
    const welded =
      "The full chain:…September 18, 2026 Operating as hackers under OpenAI’s bug bounty program, " +
      "Hacktron researchers uncovered critical vulnerabilities that granted them access to internal " +
      "employee tools.";
    const clean =
      "The company reportedly fixed the issue within 14 hours of the report and paid the researchers a $6,500 bounty.";

    const selection = selectReaderEvidence("Hackers breach OpenAI using Claude tools", [
      {
        name: "Tom's Hardware",
        headline: "Hackers breach OpenAI using Claude tools",
        excerpt: `${welded} ${clean}`,
      },
    ]);
    const facts = (selection as { facts?: { text: string }[] }).facts ?? [];
    const texts = facts.map((fact) => fact.text);
    expect(texts.some((text) => text.includes("The full chain"))).toBe(false);
    expect(texts.some((text) => text.includes("$6,500 bounty"))).toBe(true);
  });
});
