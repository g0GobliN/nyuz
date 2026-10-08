import { describe, expect, it } from "vitest";
import { assessReadiness } from "./readiness";

/**
 * The 2026-09-30 briefing carried 25 stories; 6 were not news for a reader.
 * Each bad shape below is one of them, quoted or near-quoted. Each good shape
 * is a real story from the same day that must keep shipping — most importantly
 * the thin ones, because a gate that drops short real news trades visible junk
 * for invisible misses.
 */
describe("assessReadiness", () => {
  it("refuses a vendor benefit pitch from a company blog", () => {
    // Cloudflare blog, 2026-10-02. A feature advert aimed at the reader's own
    // spend; the "your X" possessive is what no third-party report carries.
    const verdict = assessReadiness({
      title: "Cut your AI spend with AI Gateway's Auto Router",
      whatHappened:
        "The router picks the cheapest model that can serve each request automatically.",
      sourceCount: 1,
    });
    expect(verdict.ready).toBe(false);
    if (!verdict.ready) expect(verdict.kind).toBe("marketing");
  });

  it("refuses a first-party post that addresses the reader's own work or data", () => {
    // Cloudflare's Pay Per Use launch and an AWS product update. Both are the
    // vendor talking to the reader about the reader's material, which a
    // third-party report of the same change would not do.
    for (const title of [
      "Pay Per Use: when AI uses your work, you should get paid",
      "Amazon Aurora PostgreSQL now supports direct querying of Apache Iceberg data in your data lake",
    ]) {
      const verdict = assessReadiness({
        title,
        whatHappened: "The feature is available in public beta for existing customers today.",
        sourceCount: 1,
      });
      expect(verdict.ready, title).toBe(false);
      if (!verdict.ready) expect(verdict.kind, title).toBe("marketing");
    }
  });

  it("still allows third-party reporting that mentions a reader benefit", () => {
    const verdict = assessReadiness({
      title: "Cloudflare says Auto Router cuts AI costs for enterprise customers",
      whatHappened: "Early adopters reported double-digit reductions in inference spend.",
      sourceCount: 1,
    });
    expect(verdict.ready).toBe(true);
  });
  it("drops the empty Google Research item", () => {
    expect(
      assessReadiness({
        title: "How Diffusion Controller unifies and simplifies AI image generation",
        whatHappened: "",
      }),
    ).toEqual({ ready: false, kind: "empty", reason: expect.any(String) });
  });

  it("drops the llama.cpp build number and its commit-message summary", () => {
    expect(assessReadiness({ title: "b11243", whatHappened: "Some body text here." }).ready).toBe(
      false,
    );
    expect(
      assessReadiness({
        title: "llama.cpp release",
        whatHappened:
          "Ci: update the oneAPI toolkit to 2026.1 (#29273) oneDNN is removed from Intel Deep Learning Essentials.",
      }),
    ).toEqual({ ready: false, kind: "commit-message", reason: expect.any(String) });
  });

  it("drops a single-source preprint or code release from the briefing", () => {
    // Operator decision, 2026-10-08: six of the day's twenty-five shippable
    // items were single-source arXiv preprints and one was a GitHub release.
    // They stay in the feed and in history; they stop being briefing items.
    for (const item of [
      {
        title: "RAISED: Self-Distillation for Robustness to Prompt Injection in LLM Agents",
        whatHappened:
          "Prompt injection defenses degrade when an agent is fine-tuned on its own outputs.",
        sourceKinds: ["research"],
      },
      {
        title: "b11488: model : add LiquidAI/d1-omni-600M decision model (#30114)",
        whatHappened: "Adds a new omni model entry to the supported model list.",
        sourceKinds: ["github"],
      },
    ]) {
      const verdict = assessReadiness({ ...item, sourceCount: 1 });
      expect(verdict.ready, item.title).toBe(false);
      if (!verdict.ready) expect(verdict.kind, item.title).toBe("primary-source");
    }
  });

  it("keeps primary-source material once a second outlet corroborates it", () => {
    // The same rules as every other shape: the class is not a veto on the
    // subject, only on the lone document. And a news feed is never the class,
    // whatever the title looks like.
    expect(
      assessReadiness({
        title: "RAISED: Self-Distillation for Robustness to Prompt Injection in LLM Agents",
        whatHappened:
          "Prompt injection defenses degrade when an agent is fine-tuned on its own outputs.",
        sourceCount: 2,
        sourceKinds: ["research"],
      }).ready,
    ).toBe(true);
    expect(
      assessReadiness({
        title: "arXiv preprint on prompt-injection defenses draws scrutiny",
        whatHappened: "Researchers questioned the benchmark after the paper circulated this week.",
        sourceCount: 1,
        sourceKinds: ["news", "research"],
      }).ready,
    ).toBe(true);
    expect(
      assessReadiness({
        title: "Hugging Face ships a smaller vision encoder for on-device use",
        whatHappened: "The model runs inside a browser tab without a server round trip.",
        sourceCount: 1,
        sourceKinds: ["company_blog"],
      }).ready,
    ).toBe(true);
  });

  it("skips the primary-source rung when the caller has not loaded feeds", () => {
    // Same contract as the briefability rung: absent input skips the rung
    // rather than guessing at it.
    expect(
      assessReadiness({
        title: "Training Advisors for LLM Agents from Task Outcomes",
        whatHappened: "The method trains a smaller advisor model against task outcomes.",
        sourceCount: 1,
      }).ready,
    ).toBe(true);
  });

  it("drops the byline standing in for a summary", () => {
    expect(
      assessReadiness({
        title: "Driving growth on Google Play: The next era of subscriptions",
        whatHappened: "Posted by Sheenam Mittal, Senior Product Manager, Google Play.",
      }),
    ).toEqual({ ready: false, kind: "byline", reason: expect.any(String) });
  });

  it("drops newsletter containers and coming-soon announcements", () => {
    expect(
      assessReadiness({
        title: "The Download: climate tech companies to watch and AI's discovery problem",
        whatHappened: "With the planet nearing 1.5 °C of warming, doom and defeatism tempt.",
      }).ready,
    ).toBe(false);
    expect(
      assessReadiness({
        title: "Coming soon: Our 2026 list of Climate Tech Companies to Watch",
        whatHappened: "Big Tech is backpedaling on its climate ambitions as data centers grow.",
      }),
    ).toEqual({ ready: false, kind: "newsletter", reason: expect.any(String) });
  });

  it("drops the Newegg price promotion", () => {
    expect(
      assessReadiness({
        title:
          "Grab this 4K-ready gaming PC with a 7800X3D and RTX 5070 for under $2,000 right now, saving you $170",
        whatHappened: "Specs like this are rare to find in a PC for under $2,000 in this market.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("keeps thin-but-real launch news", () => {
    // 71 characters. The biggest story of the day; thinness is handled
    // downstream by depth widening, never by dropping.
    expect(
      assessReadiness({
        title: "OpenAI launches Dots, its Muse competitor",
        whatHappened: "Like Muse, OpenAI's Dots are represented by cute, customizable avatars.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "OpenAI DevDay 2026: The biggest news and announcements",
        whatHappened: "OpenAI's DevDay 2026 has a date.",
      }),
    ).toEqual({ ready: true });
  });

  it("keeps money stories that merely mention a dollar amount", () => {
    expect(
      assessReadiness({
        title: "AMD bets $8.2B that worlds matter more than words in AI",
        whatHappened:
          "AMD dove deeper into AI model development with an agreement to acquire World Labs.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "HMRC bets up to £2.4B on Salesforce for taxpayer CRM overhaul",
        whatHappened: "Salesforce has won a contract worth up to £2.4 billion including VAT.",
      }),
    ).toEqual({ ready: true });
  });

  it("keeps ordinary reporting", () => {
    expect(
      assessReadiness({
        title: "Intel patent embeds MicroLEDs in chip packaging",
        whatHappened: "At ECTC in May, Intel showcased a 24-layer glass-core panel.",
      }),
    ).toEqual({ ready: true });
  });

  it("drops a sale that forgot its price tag", () => {
    expect(
      assessReadiness({
        title: "The best early October Prime Day deals happening now",
        whatHappened: "Discounts on laptops, headphones and smart home gear are live for October.",
      }),
    ).toEqual({ ready: false, kind: "commerce", reason: expect.any(String) });
  });

  it("drops a title that announces a quotation instead of an event", () => {
    expect(
      assessReadiness({
        title: "Quoting Anthropic Frontier Red Team",
        whatHappened: "A single sentence lifted from a post by the team's own account.",
      }),
    ).toEqual({ ready: false, kind: "quote", reason: expect.any(String) });
  });

  it.each([
    ["Introducing Threat Signals: agentic skills for open-source threat intelligence"],
    ["Enforce positive security with Cloudflare Application Profiles"],
    ["Adaptive application security for the AI era: how Cloudflare connects controls"],
    ["We tested our own WAF with frontier AI models. Here's what we found"],
  ])("drops the vendor promotion %s", (title) => {
    expect(
      assessReadiness({
        title,
        whatHappened:
          "The vendor describes its own product in the first person and links to a trial.",
      }),
    ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
  });

  it("keeps a product announcement other outlets also reported", () => {
    expect(
      assessReadiness({
        title: "Introducing Threat Signals: agentic skills for threat intelligence",
        whatHappened: "The vendor released a new capability, and two outlets covered it.",
        sourceCount: 3,
      }),
    ).toEqual({ ready: true });
  });

  it("keeps a headline that merely starts with a verb a promo would use", () => {
    expect(
      assessReadiness({
        title: "Scale AI raises $200M as demand for evaluation grows",
        whatHappened: "The funding round values the company at $5 billion, investors said.",
      }),
    ).toEqual({ ready: true });
    expect(
      assessReadiness({
        title: "OpenAI DevDay 2026: The biggest news and announcements",
        whatHappened: "Explore more than 20 announcements from OpenAI DevDay 2026.",
      }),
    ).toEqual({ ready: true });
  });
});

/**
 * The briefability contract, measured over 200 live events on 2026-10-03.
 *
 * The audit counted 76 of 200 stories composing no paragraph at all, which read
 * as a 39% product failure. Re-running the same corpus *through the existing
 * readiness gate first* moved the number to 35 of the 134 that would actually
 * ship — the other 41 were already refused, mostly live-blog entries whose only
 * coverage is a photo credit. So the defect is real but a quarter the size the
 * raw count suggests, and the fix belongs at selection rather than in the
 * composer.
 *
 * The predicate is a count of facts the evidence pass accepts, and the count
 * that matters is two: the lead fact is spent on the deck, so a story with one
 * accepted fact has a deck and nothing else. Every case below is quoted from the
 * corpus, including the four that were the closest calls.
 */
describe("assessReadiness — briefability", () => {
  it("refuses a story whose evidence yields one fact, which is only a deck", () => {
    // Reuters, via the 2026-10-03 corpus. A single-sentence excerpt: real news,
    // correctly summarised, and enough for the deck. There is no second fact,
    // so the Read page would render a title, a deck and no article.
    const verdict = assessReadiness({
      title: "DoorDash launches an AI agent you can text to order food",
      whatHappened: "DoorDash launched an AI agent you can text to order food.",
      sourceCount: 1,
      sources: [
        {
          name: "Reuters",
          excerpt: "DoorDash launched an AI agent you can text to order food.",
        },
      ],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("keeps a story with two accepted facts, however short each one is", () => {
    // The same shape, one sentence longer. Nothing about the second sentence is
    // better prose than the first; there is simply something for the body to
    // be made of, which is the whole contract.
    const verdict = assessReadiness({
      title: "UK-France 'one in, one out' migrant scheme scrapped",
      whatHappened: "The government has scrapped the one-in, one-out migrant scheme.",
      sourceCount: 1,
      sources: [
        {
          name: "Reuters",
          excerpt:
            "The government has scrapped the one-in, one-out migrant scheme. Ministers said the pilot had cost too much and returned too few results.",
        },
      ],
    });
    expect(verdict).toEqual({ ready: true });
  });

  it("refuses a story whose only coverage is a photo credit", () => {
    // 18 of the 35 empty stories were live-blog entries carrying exactly this:
    // a Guardian or BBC photo caption as the entire excerpt, and an empty
    // summary. The 20-character summary rung cannot see them, because there is
    // no summary -- the gap this closes.
    const verdict = assessReadiness({
      title: "Eastern Spain braces for torrential rain and flooding",
      whatHappened: "Heavy rain is forecast to bring flooding across eastern Spain this week.",
      sourceCount: 1,
      sources: [{ name: "The Guardian", excerpt: "Photograph: Josep Lago/AFP/Getty Images" }],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("counts accepted facts, not sentences the composer would go on to refuse", () => {
    // The 16 stories with several sentences and one accepted fact. The extra
    // sentences are a publisher solicitation and a newsletter sign-off, so a
    // rule that counted sentences would admit this and the composer would
    // still publish no body. Counting what survived is the only version of this
    // that cannot be wrong.
    const verdict = assessReadiness({
      title: "The ugly economics of consumer AI",
      whatHappened: "Consumer AI services cost more to run than the subscriptions charge.",
      sourceCount: 1,
      sources: [
        {
          name: "The Verge",
          excerpt:
            "Consumer AI services cost more to run than the subscriptions charge. Subscribe to The Verge for more.",
        },
      ],
    });
    expect(verdict).toEqual({
      ready: false,
      kind: "unbriefable",
      reason: expect.any(String),
    });
  });

  it("leaves a caller that has not loaded coverage to the other rungs", () => {
    // `briefing-preview.ts` and the digest tests call the gate without
    // coverage. Skipping the rung is the honest answer there; refusing every
    // story for material the caller never fetched would be a gate that
    // measures the caller's laziness.
    expect(
      assessReadiness({
        title: "Intel patent embeds MicroLEDs in chip packaging",
        whatHappened: "At ECTC in May, Intel showcased a 24-layer glass-core panel.",
      }),
    ).toEqual({ ready: true });
  });

  it("reports the more specific reason when a story fails both rungs", () => {
    // The marketing rungs run first, so a vendor advert that also has no body
    // is withheld as marketing. An operator reading the withheld note learns
    // what to fix about the source, not merely that it was thin.
    expect(
      assessReadiness({
        title: "Cut your AI spend with AI Gateway's Auto Router",
        whatHappened: "The router picks the cheapest model for each request.",
        sourceCount: 1,
        sources: [{ name: "Cloudflare", excerpt: "The router picks the cheapest model." }],
      }),
    ).toEqual({ ready: false, kind: "marketing", reason: expect.any(String) });
  });
});
