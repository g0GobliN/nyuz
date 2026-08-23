import { describe, expect, it } from "vitest";
import { type Email } from "@/lib/email/shell";
import {
  briefingsPausedEmail,
  dormantEmail,
  formatEmailDate,
  paymentFailedEmail,
  subscriptionCancelledEmail,
  subscriptionStartedEmail,
  welcomeEmail,
} from "@/lib/email/templates";

/**
 * These go to somebody else's inbox and cannot be recalled, so the cases below
 * are the ones where a mistake is unrecoverable rather than merely ugly:
 * injected markup, a relative link that resolves to nothing, a missing text
 * part, a date that reads as a different day.
 */

const BASE = "https://nyuz.app";

const ALL: Email[] = [
  welcomeEmail({ name: "Sam", baseUrl: BASE }),
  subscriptionStartedEmail({
    name: "Sam",
    baseUrl: BASE,
    plan: "Personal",
    priceLabel: "$7 / month",
    renewsOn: new Date("2026-09-03T00:00:00Z"),
  }),
  subscriptionCancelledEmail({
    name: "Sam",
    baseUrl: BASE,
    plan: "Pro",
    accessUntil: new Date("2026-09-03T00:00:00Z"),
  }),
  paymentFailedEmail({
    name: "Sam",
    baseUrl: BASE,
    plan: "Personal",
    retryOn: new Date("2026-09-03T00:00:00Z"),
  }),
  briefingsPausedEmail({ name: "Sam", baseUrl: BASE }),
  dormantEmail({ name: "Sam", baseUrl: BASE, days: 7, unsubscribeUrl: `${BASE}/u/abc` }),
];

describe("every template", () => {
  it("has a subject, an HTML part and a real text part", () => {
    for (const email of ALL) {
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain("<!doctype html>");
      // Not stripped from the HTML — a message whose text part is empty or is
      // markup is the one that lands in the promotions tab.
      expect(email.text.length).toBeGreaterThan(80);
      expect(email.text).not.toContain("<");
    }
  });

  it("links absolutely, because email has no base URL", () => {
    for (const email of ALL) {
      expect(email.html).not.toMatch(/href="\/(?!\/)/);
      expect(email.html).toContain(BASE);
    }
  });

  it("always offers a way back to the settings that stop the mail", () => {
    for (const email of ALL) {
      expect(email.html).toContain(`${BASE}/dashboard/settings`);
    }
  });

  it("sets a preheader so the inbox preview is not scraped from the footer", () => {
    for (const email of ALL) {
      expect(email.html).toMatch(/display:none;max-height:0/);
    }
  });
});

describe("escaping", () => {
  it("neutralises markup in a display name", () => {
    const email = welcomeEmail({
      name: "<script>alert(1)</script>",
      baseUrl: BASE,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("survives an apostrophe in a name without mangling the document", () => {
    const email = welcomeEmail({ name: "O'Brien", baseUrl: BASE });
    expect(email.html).toContain("O&#39;Brien");
    expect(email.text).toContain("O'Brien");
  });
});

describe("greeting", () => {
  it("drops the name rather than inventing one", () => {
    const email = welcomeEmail({ baseUrl: BASE });
    expect(email.html).toContain("Hello,");
    expect(email.text.startsWith("Hello,")).toBe(true);
  });
});

describe("formatEmailDate", () => {
  it("writes an unambiguous long date", () => {
    expect(formatEmailDate(new Date("2026-09-03T00:00:00Z"))).toBe("3 September 2026");
  });

  it("reads the same on both sides of the Atlantic", () => {
    // 03/09 is two different days depending on where it is opened; the month
    // name is why this is spelled out.
    expect(formatEmailDate(new Date("2026-01-11T00:00:00Z"))).toBe("11 January 2026");
  });
});

describe("unsubscribe", () => {
  it("is present on the dormant nudge, which is not transactional", () => {
    const email = dormantEmail({
      baseUrl: BASE,
      days: 7,
      unsubscribeUrl: `${BASE}/u/abc`,
    });
    expect(email.html).toContain(`${BASE}/u/abc`);
    expect(email.html).toContain("Unsubscribe");
    expect(email.text).toContain(`${BASE}/u/abc`);
  });

  it("is absent from a receipt, which the reader cannot opt out of", () => {
    const email = subscriptionStartedEmail({
      baseUrl: BASE,
      plan: "Personal",
      priceLabel: "$7 / month",
      renewsOn: new Date("2026-09-03T00:00:00Z"),
    });
    expect(email.html).not.toContain("Unsubscribe");
  });
});

describe("billing copy", () => {
  it("states the renewal date and the price it will charge", () => {
    const email = subscriptionStartedEmail({
      baseUrl: BASE,
      plan: "Pro",
      priceLabel: "$150 / year",
      renewsOn: new Date("2027-08-23T00:00:00Z"),
    });
    expect(email.html).toContain("$150 / year");
    expect(email.html).toContain("23 August 2027");
    expect(email.subject).toContain("Pro");
  });

  it("tells a cancelling reader when access actually ends", () => {
    const email = subscriptionCancelledEmail({
      baseUrl: BASE,
      plan: "Personal",
      accessUntil: new Date("2026-09-03T00:00:00Z"),
    });
    expect(email.html).toContain("3 September 2026");
    // Cancelling is not deletion, and the mail has to say so.
    expect(email.text).toContain("Free");
  });
});
