import { describe, expect, it } from "vitest";
import { assessAlertFloor } from "./alert-floor";

/**
 * The alert shape floor — the narrow extension that refuses the five non-news
 * shape classes that still reached phones after the D8 gate.
 *
 * The samples are the recorded ones from `npm run audit:alerts` (2026-10-14
 * live window), quoted verbatim:
 *
 *   - a vendor roadmap advertorial ("Whose roadmap is your software estate
 *     running on?", The Register, importance 7)
 *   - a product newsletter ("Gremlin now uses AI to break distributed systems
 *     faster", The Register, 7)
 *   - a hobby hack ("PS5 hack delivers native PS2 disc support and 4K upscaling
 *     where Sony refused to", Tom's Hardware, 6)
 *   - a personal blog post ("2026.41: It's Not You, It's Me", Stratechery, 6)
 *   - a memory-kit price piece ("Customer sends two-stick $16,000 DDR5 memory
 *     kit to repair shop", Tom's Hardware, 6)
 *
 * Each test pins one class to a refusal. The guard cases are the important
 * developments the floor must keep passing — a test that only asserted the
 * refusals would pass on a floor that refused everything.
 */

describe("assessAlertFloor refuses the non-news shapes", () => {
  it("refuses a vendor roadmap advertorial", () => {
    expect(
      assessAlertFloor({
        title: "Whose roadmap is your software estate running on?",
      }),
    ).toEqual({
      ready: false,
      kind: "roadmap-advertorial",
      reason: "title is a vendor roadmap advertorial, not a development",
    });
  });

  it("refuses a product newsletter", () => {
    expect(
      assessAlertFloor({
        title: "Gremlin now uses AI to break distributed systems faster",
      }),
    ).toEqual({
      ready: false,
      kind: "product-newsletter",
      reason: "title announces a vendor's own product capability",
    });
  });

  it("refuses a hobby hack", () => {
    expect(
      assessAlertFloor({
        title: "PS5 hack delivers native PS2 disc support and 4K upscaling where Sony refused to",
      }),
    ).toEqual({
      ready: false,
      kind: "hobby-hack",
      reason: "title is an enthusiast hack delivering a feature, not a development",
    });
  });

  it("refuses a personal blog post", () => {
    expect(
      assessAlertFloor({
        title: "2026.41: It's Not You, It's Me",
      }),
    ).toEqual({
      ready: false,
      kind: "personal-blog",
      reason: "title is a numbered personal-newsletter edition",
    });
  });

  it("refuses a memory-kit price piece", () => {
    expect(
      assessAlertFloor({
        title: "Customer sends two-stick $16,000 DDR5 memory kit to repair shop",
      }),
    ).toEqual({
      ready: false,
      kind: "price-piece",
      reason: "title is a priced consumer object, not a development",
    });
  });

  /**
   * The two classes the arbiter added on 2026-10-17 (#5), from `npm run
   * audit:alerts` over all 218 alerts ever sent: a deals/shelf post alerted
   * 2026-10-16T18:14 and a commentary column alerted 2026-10-14T12:44, both of
   * which came through the gate the briefing uses. Each is one measured title,
   * so each rule is pinned to it and to nothing wider.
   */
  it("refuses a shelf/deal offer", () => {
    expect(
      assessAlertFloor({
        title: "This could be your last chance to grab an RTX 5090",
      }),
    ).toEqual({
      ready: false,
      kind: "shelf-deal",
      reason: "title is a shelf or deal offer, not a development",
    });
  });

  it("refuses a commentary column", () => {
    expect(
      assessAlertFloor({
        title: "It won't kill you, or humanity, to get off the AI upgrade treadmill",
      }),
    ).toEqual({
      ready: false,
      kind: "commentary",
      reason: "title argues a stance about the reader, not a development",
    });
  });
});

describe("assessAlertFloor keeps breaking developments", () => {
  const keep = [
    "KillSec ransomware group teen arrested as servers seized",
    "US disrupts Chinese hacking tools as 7 govts warn of PRC spies",
    "Nvidia guides to $108 billion quarter after $96.2 billion record",
    "Super Micro smuggling co-conspirator pleads guilty to sending AI chips to China",
    "FBI arrests founder of ransomware negotiation firm",
    "Intel suspends bug bounty program that paid up to $100,000 per flaw",
    "Nvidia agrees to acquire Hugging Face for $13B",
    "Cloudflare Impact reaches $100 million in donations",
    // The controls the 2026-10-17 ruling named for the two new classes: the
    // commercial-transaction titles that look deal-shaped without being an
    // offer to the reader, and the analysis piece that reports someone else's
    // conclusion in the third person.
    "DOJ opens antitrust probe into Nvidia's $20bn Groq deal",
    "New York rep announces game ownership bill that would require consumer ownership rather than sale of licenses",
    "Morgan Stanley/SCMP analysis links US export controls to China supply-chain gains",
  ];

  for (const title of keep) {
    it(`keeps a development: ${title}`, () => {
      expect(assessAlertFloor({ title })).toEqual({ ready: true });
    });
  }

  it("keeps a reported roadmap that is not aimed at the reader", () => {
    expect(assessAlertFloor({ title: "Nvidia unveils its 2027 chip roadmap" })).toEqual({
      ready: true,
    });
  });

  it("keeps a purchase that is part of a development, said in the third person", () => {
    // One half of the shelf rule at a time: an acquisition verb with no offer to
    // the reader, and an urgency frame with nothing to buy.
    for (const title of [
      "Microsoft buys 3.3 million Nvidia chips for its cloud build-out",
      "Last chance for UK to join the EU's research programme, ministers warn",
      "Sony orders production halt at its Japanese camera plant",
    ]) {
      expect(assessAlertFloor({ title }), title).toEqual({ ready: true });
    }
  });
});
