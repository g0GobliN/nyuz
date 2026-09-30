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
});
