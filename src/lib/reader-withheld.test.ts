/**
 * The reader-cost ruler for withheld stories, pinned on the gate's own reasons.
 *
 * The audit prints 19 readable stories withheld, and that number is not one
 * quantity: a llama.cpp build number and a BBC news headline refused by a
 * marketing shape are both "readable stories withheld", and only one of them is a
 * loss. The family is read off the gate's `reason` string -- the rule's own
 * self-report of which shape it matched -- so nothing here re-implements a rule.
 *
 * The tests are the strings the live corpus actually produced (2026-10-11, the
 * frozen 200), which is the point: if the gate's wording changes, this fails
 * rather than silently filing a withheld headline as a justified refusal.
 */
import { describe, expect, it } from "vitest";
import { withheldFamily } from "../../scripts/lib/defects";

describe("a withheld story is filed by the shape the gate says it matched", () => {
  it("files machine identifiers as not-a-headline, which is not a loss", () => {
    expect(withheldFamily("headline is an identifier: b11535")).toBe("not-a-headline");
    expect(withheldFamily("summary reads as a commit message")).toBe("not-a-headline");
    expect(withheldFamily("summary is a byline, not news")).toBe("not-a-headline");
    expect(withheldFamily("title announces a quotation, not an event")).toBe("not-a-headline");
  });

  it("files a shop's own offer as a promotion, not a withheld story", () => {
    expect(withheldFamily("title is a price promotion")).toBe("promotion");
    expect(withheldFamily("title is a sale with a clock on it")).toBe("promotion");
    expect(withheldFamily("title is a shopping-event listing")).toBe("promotion");
    expect(withheldFamily("title is an event promotion with a deadline on it")).toBe("promotion");
  });

  it("keeps the vendor-shape family separate, because it is the one guessed from the title", () => {
    // The two live cases: a BBC news headline refused for opening with `Meet`,
    // and a news analysis piece refused for a `: how` trailer. Neither is a
    // vendor, and the family exists so that they are not counted with the
    // Cloudflare launch announcements the same rules legitimately drop.
    expect(withheldFamily("title is an imperative promotion")).toBe("first-party-shape");
    expect(withheldFamily("title is a vendor how-to")).toBe("first-party-shape");
    expect(withheldFamily("title pitches a benefit to the reader")).toBe("first-party-shape");
    expect(withheldFamily("title celebrates the vendor's own community")).toBe("first-party-shape");
  });

  it("files an evidence or coverage refusal as its own thing, never as a title shape", () => {
    expect(withheldFamily("3 accepted fact(s); the composer refused the body (2 fact(s))")).toBe(
      "evidence",
    );
    expect(withheldFamily("single-source research item")).toBe("evidence");
    expect(withheldFamily("summary below 20 characters")).toBe("evidence");
    expect(withheldFamily("2 accepted fact(s); a body needs 2")).toBe("evidence");
  });

  it("fails safe: an unrecognised reason is not filed as a title shape", () => {
    // A new rung's wording must not be silently counted as a vendor promotion, so
    // the fallback is the family that sends the number to a reviewer rather than
    // the one that dismisses it.
    expect(withheldFamily("some rung added later")).toBe("evidence");
  });
});
