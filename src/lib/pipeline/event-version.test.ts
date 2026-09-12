import { describe, expect, it } from "vitest";
import { contentVersion, coverageTextOf, magnitudeBucket, materialState } from "./event-version";

const article = (title: string, excerpt: string) => ({ title, excerpt });

describe("magnitudeBucket", () => {
  it("puts a corrected figure in the same bucket as the original", () => {
    expect(magnitudeBucket(12)).toBe(magnitudeBucket(14));
    expect(magnitudeBucket(40_000_000)).toBe(magnitudeBucket(45_000_000));
  });

  it("separates figures an order of magnitude apart", () => {
    expect(magnitudeBucket(12)).not.toBe(magnitudeBucket(400));
    expect(magnitudeBucket(40_000_000)).not.toBe(magnitudeBucket(4_000_000_000));
  });

  it("does not throw on zero or nonsense", () => {
    expect(magnitudeBucket(0)).toBe(0);
    expect(magnitudeBucket(Number.NaN)).toBe(0);
  });
});

describe("the version ignores what is not a development", () => {
  it("is unchanged when another outlet publishes the same facts", async () => {
    const first = coverageTextOf([
      article("Acme in talks to buy Widget Co", "Acme is in talks to acquire Widget Co."),
    ]);
    const second = coverageTextOf([
      article("Acme in talks to buy Widget Co", "Acme is in talks to acquire Widget Co."),
      article("Report: Acme eyeing Widget Co", "Acme is in talks to acquire Widget Co."),
      article("Acme, Widget Co in discussions", "Acme is in talks to acquire Widget Co."),
    ]);
    expect(await contentVersion(second)).toBe(await contentVersion(first));
  });

  it("is unchanged when only the headline wording moves", async () => {
    const a = coverageTextOf([article("Acme buys Widget", "Acme is in talks with Widget Co.")]);
    const b = coverageTextOf([
      article("Acme said to be buying Widget Co", "Acme is in talks with Widget Co."),
    ]);
    expect(await contentVersion(b)).toBe(await contentVersion(a));
  });

  it("is unchanged when the article order changes", async () => {
    const one = article("Acme confirmed the deal", "Acme confirmed the $2 billion deal.");
    const two = article("Widget Co responds", "Widget Co said the sale was approved by its board.");
    expect(await contentVersion(coverageTextOf([one, two]))).toBe(
      await contentVersion(coverageTextOf([two, one])),
    );
  });

  it("is unchanged by a small correction to a casualty figure", async () => {
    const before = coverageTextOf([
      article("Building collapse", "At least 12 people were killed."),
    ]);
    const after = coverageTextOf([article("Building collapse", "At least 14 people were killed.")]);
    expect(await contentVersion(after)).toBe(await contentVersion(before));
  });
});

describe("the version changes on a real development", () => {
  it("separates talks from a confirmed deal", async () => {
    const talks = coverageTextOf([
      article("Acme in talks to buy Widget Co", "Acme is in talks to acquire Widget Co."),
    ]);
    const confirmed = coverageTextOf([
      article("Acme confirms Widget Co deal", "Acme has confirmed it will acquire Widget Co."),
    ]);
    expect(await contentVersion(confirmed)).not.toBe(await contentVersion(talks));
  });

  it("separates a filing from a ruling", async () => {
    const filing = coverageTextOf([
      article("Suit filed against Acme", "A complaint was filed in federal court."),
    ]);
    const ruling = coverageTextOf([
      article("Court rules against Acme", "The judge ruled against Acme on Tuesday."),
    ]);
    expect(await contentVersion(ruling)).not.toBe(await contentVersion(filing));
  });

  it("separates a leak from a launch", async () => {
    const leak = coverageTextOf([article("Widget 5 leaked", "Images of the unreleased Widget 5.")]);
    const launch = coverageTextOf([
      article("Widget 5 out today", "The Widget 5 is now available to buy."),
    ]);
    expect(await contentVersion(launch)).not.toBe(await contentVersion(leak));
  });

  it("separates an order-of-magnitude change in the death toll", async () => {
    const early = coverageTextOf([article("Quake", "At least 12 people were killed.")]);
    const later = coverageTextOf([article("Quake", "At least 4000 people were killed.")]);
    expect(await contentVersion(later)).not.toBe(await contentVersion(early));
  });

  it("does not read 'unconfirmed' as a confirmation", async () => {
    const rumour = coverageTextOf([
      article("Acme rumour", "Unconfirmed reports say Acme is in talks with Widget Co."),
    ]);
    const state = materialState(rumour);
    expect(state.markers).not.toContain("deal_confirmed");
  });
});

describe("materialState", () => {
  it("sorts and de-duplicates so coverage order cannot move the hash", () => {
    const state = materialState("Acme confirmed. Acme confirmed again. The court ruled.");
    expect(state.markers).toStrictEqual([...state.markers].sort());
    expect(new Set(state.markers).size).toBe(state.markers.length);
  });

  it("carries no source count", () => {
    const one = materialState("Acme has confirmed the acquisition.");
    const three = materialState(
      "Acme has confirmed the acquisition.\n---\nAcme has confirmed the acquisition.\n---\nAcme has confirmed the acquisition.",
    );
    expect(three).toStrictEqual(one);
  });
});
