import { describe, expect, it } from "vitest";
import type { Prefs } from "@/lib/prefs";
import { DEFAULT_PREFS } from "@/lib/prefs";
import {
  addExclusion,
  exclusionKey,
  isValidExclusion,
  keepUsableExclusions,
  MAX_EXCLUSION_LABEL,
  normaliseExclusionLabel,
  removeExclusion,
  toggleExclusion,
  validateExclusionLabel,
} from "./exclusions";

describe("exclusion labels", () => {
  it("still accepts a built-in exclusion", () => {
    expect(addExclusion([], "Crypto")).toEqual(["Crypto"]);
  });

  it("accepts an arbitrary global exclusion", () => {
    expect(addExclusion([], "Football")).toEqual(["Football"]);
  });

  it("fits the existing preference model as plain strings", () => {
    const prefs: Prefs = { ...DEFAULT_PREFS, exclusions: addExclusion([], "Elon Musk") };
    expect(prefs.exclusions).toEqual(["Elon Musk"]);
  });

  it("removes an exclusion case-insensitively", () => {
    expect(removeExclusion(["Football"], " football ")).toEqual([]);
  });

  it("prevents duplicates", () => {
    expect(addExclusion(["Football"], "FOOTBALL")).toEqual(["Football"]);
    expect(toggleExclusion(["Football"], "football")).toEqual([]);
  });

  it("normalises whitespace and dedupes by a stable key", () => {
    expect(normaliseExclusionLabel("  Bitcoin   price   news  ")).toBe("Bitcoin price news");
    expect(exclusionKey("Football")).toBe(exclusionKey(" football "));
    expect(keepUsableExclusions(["Football", " football ", "FOOTBALL"]).kept).toEqual(["Football"]);
  });

  it("refuses an empty exclusion", () => {
    expect(validateExclusionLabel("   ")).toEqual({ rejected: "empty" });
    expect(addExclusion([], "   ")).toEqual([]);
  });

  it("refuses an over-long exclusion", () => {
    const long = "x".repeat(MAX_EXCLUSION_LABEL + 1);
    expect(validateExclusionLabel(long)).toEqual({ rejected: "too-long" });
    expect(keepUsableExclusions([long]).kept).toEqual([]);
  });

  it("accepts meaningful variants without over-merging them", () => {
    const kept = keepUsableExclusions(["Bitcoin", "Bitcoin price news", "Crypto"]).kept;
    expect(kept).toEqual(["Bitcoin", "Bitcoin price news", "Crypto"]);
  });

  it("returns a validated label when the input is usable", () => {
    const result = validateExclusionLabel("  K-pop  ");
    expect(isValidExclusion(result) && result.label).toBe("K-pop");
  });
});
