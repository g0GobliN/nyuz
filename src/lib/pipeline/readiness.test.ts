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
