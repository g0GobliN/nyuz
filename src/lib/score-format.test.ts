import { describe, expect, it } from "vitest";
import { formatScore } from "./score-format";

describe("formatScore", () => {
  it("prints whole scores without a decimal point", () => {
    expect(formatScore(6)).toBe("6");
    expect(formatScore(10)).toBe("10");
    expect(formatScore(0)).toBe("0");
  });

  it("keeps one decimal when the score has one", () => {
    expect(formatScore(5.9)).toBe("5.9");
    expect(formatScore(9.6)).toBe("9.6");
    expect(formatScore(0.4)).toBe("0.4");
  });

  it("does not invent a decimal for values that arrive as 6.000000001", () => {
    // Scores are rounded to one decimal upstream, but a float that lands a hair
    // past the whole number must still read as that whole number.
    expect(formatScore(6.000000001)).toBe("6");
    expect(formatScore(9.999999999)).toBe("10");
  });

  it("rounds to one decimal before deciding, so 5.96 reads 6", () => {
    expect(formatScore(5.96)).toBe("6");
    expect(formatScore(5.94)).toBe("5.9");
  });
});
