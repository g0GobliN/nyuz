import { describe, expect, it } from "vitest";
import { capFor } from "@/lib/density";
import { readWhys, selectItems, type MatchRow } from "./digest";

function match(id: string, relevance: number, at = "2026-08-25T06:00:00Z"): MatchRow {
  return { eventId: id, relevance, matchedAt: at };
}

describe("selectItems", () => {
  it("keeps the most relevant stories up to the density cap", () => {
    const picked = selectItems(
      [match("a", 4), match("b", 9), match("c", 6)],
      new Set(),
      capFor(35),
    );
    expect(picked.map((p) => p.eventId)).toEqual(["b", "c", "a"]);
    expect(picked).toHaveLength(3);
  });

  it("drops events already in a previous briefing", () => {
    const picked = selectItems([match("a", 9), match("b", 8)], new Set(["a"]), 6);
    expect(picked.map((p) => p.eventId)).toEqual(["b"]);
  });

  it("returns nothing rather than padding", () => {
    expect(selectItems([], new Set(), 6)).toEqual([]);
    expect(selectItems([match("a", 1)], new Set(["a"]), 6)).toEqual([]);
  });
});

describe("readWhys", () => {
  const ids = ["e1", "e2"];

  it("reads one paragraph per requested event", () => {
    const items = readWhys(
      {
        items: [
          { event_id: "e1", why_it_matters: "Your Next.js cache model just changed." },
          { event_id: "e2", why_it_matters: "The chip allocation affects your GPU budget." },
        ],
      },
      ids,
    );
    expect(items).toEqual([
      { eventId: "e1", why: "Your Next.js cache model just changed." },
      { eventId: "e2", why: "The chip allocation affects your GPU budget." },
    ]);
  });

  it("refuses a reply that silently drops a story", () => {
    expect(readWhys({ items: [{ event_id: "e1", why_it_matters: "Only one." }] }, ids)).toBeNull();
  });

  it("refuses an empty paragraph rather than inventing one", () => {
    expect(
      readWhys(
        {
          items: [
            { event_id: "e1", why_it_matters: "Real." },
            { event_id: "e2", why_it_matters: "  " },
          ],
        },
        ids,
      ),
    ).toBeNull();
  });
});
