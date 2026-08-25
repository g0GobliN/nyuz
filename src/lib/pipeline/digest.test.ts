import { describe, expect, it } from "vitest";
import { capFor } from "@/lib/density";
import { queuedChannels, readWhys, selectItems, type MatchRow } from "./digest";

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

  it("leaves a story scored zero out, however much room the cap has left", () => {
    const picked = selectItems([match("a", 4), match("b", 0), match("c", 0.5)], new Set(), 18);
    expect(picked.map((p) => p.eventId)).toEqual(["a", "c"]);
  });

  it("would rather send a short briefing than one the model tells you to skip", () => {
    expect(selectItems([match("a", 0), match("b", 0)], new Set(), 18)).toEqual([]);
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

describe("queuedChannels", () => {
  it("queues email whenever it is selected", () => {
    expect(queuedChannels(["email"], { telegram: false, push: false })).toEqual(["email"]);
  });

  it("queues telegram only when a chat is linked", () => {
    expect(queuedChannels(["telegram"], { telegram: false, push: false })).toEqual([]);
    expect(queuedChannels(["telegram"], { telegram: true, push: false })).toEqual(["telegram"]);
  });

  it("queues push only when a device is subscribed", () => {
    expect(queuedChannels(["push"], { telegram: false, push: false })).toEqual([]);
    expect(queuedChannels(["push"], { telegram: false, push: true })).toEqual(["push"]);
  });

  it("never queues whatsapp", () => {
    expect(
      queuedChannels(["email", "telegram", "whatsapp", "push"], { telegram: true, push: true }),
    ).toEqual(["email", "telegram", "push"]);
  });
});
