import { describe, expect, it } from "vitest";
import { acceptWhy, evidenceUser } from "./impacts";

/**
 * The validation contract is the safety story of the impact writer: a stored
 * line is printed under a headline in every reader's briefing, so everything
 * that would read as a fragment, an echo or an invention must be refused here.
 * These tests hold the refusals.
 */
const EVIDENCE = [
  {
    title: "Regulator fines Acme $800M over data practices",
    excerpt:
      "The watchdog said Acme transferred user data without a lawful basis and announced an enforcement sweep covering three more firms.",
  },
  {
    title: "Acme shares fall after the announcement",
    excerpt:
      "Shares in Acme dropped 4% in afternoon trading as investors weighed the size of the penalty against its cash reserves.",
  },
];

describe("acceptWhy", () => {
  it("accepts a grounded, complete sentence", () => {
    const line =
      "The regulator has issued its largest penalty and announced an enforcement sweep covering three more firms.";
    expect(acceptWhy(line, "Regulator fines Acme over data practices", EVIDENCE)).toBe(line);
  });

  it("refuses a line that echoes three consecutive title words", () => {
    const line =
      "The fines over data practices will reshape how the company handles user information going forward.";
    expect(acceptWhy(line, "Regulator fines Acme over data practices", EVIDENCE)).toBeNull();
  });

  it("refuses fragments and undated labels", () => {
    expect(acceptWhy("Penalty. Sweep. Compliance risk.", "Any headline", EVIDENCE)).toBeNull();
  });

  it("refuses lines shorter than the card can hold", () => {
    expect(acceptWhy("The fine is large.", "Any headline", EVIDENCE)).toBeNull();
  });

  it("refuses lines without terminal punctuation", () => {
    const line =
      "The penalty is the largest the regulator has issued and lands during a wider enforcement sweep across the sector";
    expect(acceptWhy(line, "Any headline", EVIDENCE)).toBeNull();
  });

  it("refuses fronted connectors", () => {
    const line =
      "Meanwhile, the penalty is the largest the regulator has issued and lands during a wider enforcement sweep.";
    expect(acceptWhy(line, "Any headline", EVIDENCE)).toBeNull();
  });

  it("refuses a restatement of the headline", () => {
    const line =
      "Acme was fined over data practices by the regulator in an enforcement action announced today.";
    expect(acceptWhy(line, "Regulator fines Acme over data practices", EVIDENCE)).toBeNull();
  });

  it("refuses a sentence using words the evidence never contained", () => {
    const line =
      "The ruling forces Acme to divest its semiconductor fabrication plants within eighteen months.";
    expect(acceptWhy(line, "Any headline", EVIDENCE)).toBeNull();
  });

  it("refuses null and empty input", () => {
    expect(acceptWhy(null, "Any headline", EVIDENCE)).toBeNull();
    expect(acceptWhy(undefined, "Any headline", EVIDENCE)).toBeNull();
    expect(acceptWhy("", "Any headline", EVIDENCE)).toBeNull();
  });
});

describe("evidenceUser", () => {
  it("returns null when the coverage is too thin to support the contract", () => {
    const thin = [{ title: "A headline", excerpt: "Short one." }];
    expect(evidenceUser({ id: "e1", title: "A headline" }, thin)).toBeNull();
  });

  it("returns null when every excerpt echoes its own headline", () => {
    const echoes = [
      {
        title: "Regulator fines Acme over data practices",
        excerpt:
          "Regulator fines Acme over data practices, saying the transfers had no lawful basis whatsoever.",
      },
    ];
    expect(evidenceUser({ id: "e1", title: "Regulator fines Acme" }, echoes)).toBeNull();
  });

  it("builds a bulleted evidence block from usable coverage", () => {
    const user = evidenceUser({ id: "e1", title: "Regulator fines Acme" }, EVIDENCE);
    expect(user).not.toBeNull();
    expect(user).toContain("Event: Regulator fines Acme");
    expect(user).toContain("— The watchdog said Acme");
    expect(user).toContain("— Shares in Acme dropped");
  });
});
