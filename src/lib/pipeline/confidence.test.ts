import { describe, expect, it } from "vitest";
import { pairVerdict, verdictFor } from "./confidence";

describe("pairVerdict", () => {
  it("calls two headlines the same when they share almost all distinctive tokens", () => {
    expect(
      pairVerdict(
        "OpenAI calls for California to strengthen its AI safety laws",
        "OpenAI says California should strengthen its AI safety bill",
      ),
    ).toBe("same");
  });

  it("calls two headlines different when they share no distinctive tokens", () => {
    expect(
      pairVerdict(
        "OpenAI says California should strengthen its AI safety bill",
        "Polygon reviews the latest handheld console",
      ),
    ).toBe("different");
  });

  it("is ambiguous on partial overlap", () => {
    // Both mention Nvidia and Cloverleaf, but one is otherwise about a war chest
    // and the other about a data-centre partnership — real overlap, not enough
    // of it to call confidently either way.
    expect(
      pairVerdict(
        "Cloverleaf deal is latest example of Nvidia using its war chest",
        "Nvidia partners with data center developer Cloverleaf",
      ),
    ).toBe("ambiguous");
  });

  it("refuses to call a verdict on a thin headline", () => {
    // titleTokens returns nothing for a bare version tag, so there is no evidence
    // to compare against at all.
    expect(pairVerdict("v8.2.2", "OpenAI launches a new model today")).toBe("ambiguous");
  });
});

describe("verdictFor", () => {
  const article = "OpenAI says California should strengthen its AI safety bill";

  it("is same, pointing at the one confident match, when only one candidate qualifies", () => {
    const result = verdictFor(article, [
      { id: "a", title: "OpenAI calls for California to strengthen its AI safety laws" },
      { id: "b", title: "Polygon reviews the latest handheld console" },
    ]);
    expect(result).toEqual({ verdict: "same", matchedId: "a" });
  });

  it("is different when every candidate is confidently different", () => {
    const result = verdictFor(article, [
      { id: "a", title: "Polygon reviews the latest handheld console" },
      { id: "b", title: "Eurogamer previews an upcoming indie platformer" },
    ]);
    expect(result).toEqual({ verdict: "different", matchedId: null });
  });

  it("is ambiguous when any candidate is ambiguous", () => {
    const result = verdictFor("Cloverleaf deal is latest example of Nvidia using its war chest", [
      { id: "a", title: "Nvidia partners with data center developer Cloverleaf" },
      { id: "b", title: "Floating 10 MW nuclear reactor proposed for California" },
    ]);
    expect(result).toEqual({ verdict: "ambiguous", matchedId: null });
  });

  it("is ambiguous rather than picking when two candidates both look like confident matches", () => {
    const result = verdictFor(article, [
      { id: "a", title: "OpenAI calls for California to strengthen its AI safety laws" },
      { id: "b", title: "OpenAI urges California to strengthen its AI safety rules" },
    ]);
    expect(result.verdict).toBe("ambiguous");
    expect(result.matchedId).toBeNull();
  });

  it("is ambiguous on an empty shortlist rather than claiming difference from nothing", () => {
    expect(verdictFor("Anything", [])).toEqual({ verdict: "ambiguous", matchedId: null });
  });
});
