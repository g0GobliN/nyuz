import { describe, expect, it } from "vitest";
import { sameHeadline, distinctNews } from "./news-signals";
describe("conservative full-headline identity", () => {
  it("accepts normalized identical reporting", () => {
    expect(
      sameHeadline("OpenAI launches NEW model today!", "OpenAI launches new model today"),
    ).toBe(true);
  });
  it.each([
    ["Apple acquires startup for $40 million", "Apple acquires startup for $400 million"],
    [
      "Apple buys startup after extended negotiations",
      "Google buys startup after extended negotiations",
    ],
    [
      "Company confirms takeover agreement after negotiations",
      "Company denies takeover agreement after negotiations",
    ],
    [
      "Flood hits northern city as thousands flee homes",
      "Flood hits southern city as thousands flee homes",
    ],
    ["Police arrest mayor after council meeting", "Mayor arrests police after council meeting"],
    [
      "New study investigates cancer treatment effects",
      "Study examines a promising cancer therapy",
    ],
  ])("separates conflicting or ambiguous reporting: %s", (a, b) => {
    expect(sameHeadline(a, b)).toBe(false);
  });
  it("suppresses only near-identical briefing candidates", () => {
    const list = [
      "Apple buys startup for 40 million dollars",
      "Apple buys startup for 40 million dollars!",
      "Apple buys startup for 50 million dollars",
    ];
    expect(distinctNews(list, (x) => x)).toHaveLength(2);
  });
});
