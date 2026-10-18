import { describe, expect, it } from "vitest";
import { assessAlertFloor, isReaderDealTitle, isReaderModTitle } from "./alert-floor";

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

/**
 * The dashboard's first class (arbiter ruling #9, 2026-10-18, option 1).
 *
 * The rule is two halves, both required, and the discount frame is explicit
 * because the naive version was measured and rejected: "acquisition verb + a
 * price" matched 47 stored titles including three real news stories.
 */
describe("isReaderDealTitle", () => {
  it("refuses the live dashboard card that produced the ruling", () => {
    for (const title of [
      "Grab an RTX 5090 for a discounted $5,300 as part of an MSI Infinite ZS prebuilt gaming PC — price includes other components worth about $2,300 on their own",
      "Snag an Apple MacBook or Mac Mini with these Amazon Prime Big Deal Days deals that can save you up to $600",
      "Grab this 10-port gigabit PoE+ switch with up to 60W of power for under $38, a new record low",
      "Snag the least expensive 32GB DDR5-6000 memory kit available for only $429 — $40 off promo code",
      "Get a Wi-Fi 7 mesh network for a discounted $149.99 — TP-Link Deco 7 BE25 offers 5,012 Mbps speeds",
    ]) {
      expect(isReaderDealTitle(title), title).toBe(true);
    }
  });

  it("keeps the real news the naive rule would have swept up", () => {
    // Measured, not imagined: these are the three false positives of the
    // "acquisition verb + a price" draft, over all 22,018 stored titles.
    for (const title of [
      "Nvidia to buy developer platform Hugging Face in $12.9bn deal",
      "Lambda raises $1B in debt to buy Nvidia chips for Microsoft lease",
      "ShinyHunters claim CyrusOne breach, demand $13m ransom",
      "BT to buy broadband supplier TalkTalk in £400m rescue deal, saving 900 jobs",
      "‘Time for Ukraine to get new president,’ says Trump after Zelensky condemns diesel deal",
    ]) {
      expect(isReaderDealTitle(title), title).toBe(false);
    }
  });

  it("keeps a plain price with no discount frame, which is a price, not an offer", () => {
    // "Get an RTX 5070 Ti gaming laptop for just $1,449" was in the first draft's
    // match list and is *not* in the landed rule's: an acquisition verb and a
    // number is how reported prices read too, and the frame has to be explicit.
    // The draft the ruling asked for is the one measured, not the widest one.
    for (const title of [
      "Get an RTX 5070 Ti gaming laptop for just $1,449",
      "The iPhone Duo is now available to preorder at $1,999",
    ]) {
      expect(isReaderDealTitle(title), title).toBe(false);
    }
  });

  it("does not touch reviews or enthusiast mods, which are measured separately", () => {
    // The ruling is explicit: one class at a time, each measured on its own.
    for (const title of [
      "MOZA AY210 Force Feedback Base and MFY Yoke review: Taking flight sim immersion to the next level",
      "Modder finishes nine-year Xbox 360 voltage glitch mod with a $4 microcontroller, cracks the console open",
      "ASML's employee-only High-NA EUV Lego kit gets an open 810-piece fan replica",
    ]) {
      expect(isReaderDealTitle(title), title).toBe(false);
    }
  });
});

/**
 * The dashboard's second class (arbiter ruling #9, 2026-10-18) — landed on its
 * own measurement, after the deal class, as the ruling requires.
 */
describe("isReaderModTitle", () => {
  it("refuses the live dashboard card that produced the class", () => {
    for (const title of [
      "Modder finishes nine-year Xbox 360 voltage glitch mod with a $4 microcontroller, cracks the console open",
      "Mod enables DLSS Multi Frame Generation on RTX 40-series GPUs",
      "Crazed modder straps 360mm AIO radiator to laptop, cuts temps to below 40 degrees",
      "Modder brings original Xbox emulation to jailbroken PS5",
    ]) {
      expect(isReaderModTitle(title), title).toBe(true);
    }
  });

  it("keeps real news that merely contains the letters", () => {
    // `mod` is a substring of words this must not touch, and a noun in real
    // reporting: the lookahead is what separates them, and these are the
    // measured controls.
    for (const title of [
      "Google releases Gemini 3 with a new model tier for enterprises",
      "Moderna cuts its vaccine forecast after a regulatory setback",
      "The modern web is getting faster, a new report says",
      "Amazon moderates listings under a new EU rule",
      "Judge reviews the mod ruling in the console repair case",
    ]) {
      expect(isReaderModTitle(title), title).toBe(false);
    }
  });
});
