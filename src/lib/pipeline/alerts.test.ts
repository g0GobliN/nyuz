import { describe, expect, it } from "vitest";
import { remainingImportantSlots, shouldAlert } from "./alerts";

describe("shouldAlert", () => {
  it("sends nothing when alerts are off", () => {
    expect(shouldAlert("off", 10)).toBe(false);
    expect(shouldAlert("off", 0)).toBe(false);
  });

  it("sends every matched event on everything", () => {
    expect(shouldAlert("everything", 0)).toBe(true);
    expect(shouldAlert("everything", 10)).toBe(true);
  });

  it("uses the Minimal density floor on important", () => {
    expect(shouldAlert("important", 5.9)).toBe(false);
    expect(shouldAlert("important", 6)).toBe(true);
    expect(shouldAlert("important", 10)).toBe(true);
  });
});

describe("remainingImportantSlots", () => {
  it("caps important alerts at three per rolling week", () => {
    expect(remainingImportantSlots(0)).toBe(3);
    expect(remainingImportantSlots(2)).toBe(1);
    expect(remainingImportantSlots(3)).toBe(0);
    expect(remainingImportantSlots(9)).toBe(0);
  });
});
