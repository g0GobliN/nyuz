import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatTelegramAlert,
  formatTelegramBriefing,
  parseStartCommand,
  TELEGRAM_MAX,
} from "./format";

describe("parseStartCommand", () => {
  it("reads the deep-link payload", () => {
    expect(parseStartCommand("/start abcdef")).toBe("abcdef");
    expect(parseStartCommand("/start@nyuzbot abcdef")).toBe("abcdef");
  });

  it("returns null when the reader opened the bot with no payload", () => {
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("hello")).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the three characters Telegram HTML treats as markup", () => {
    expect(escapeHtml("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
  });
});

describe("formatTelegramBriefing", () => {
  const at = new Date("2026-08-25T07:30:00Z");

  it("says so on a quiet morning rather than sending an empty list", () => {
    const text = formatTelegramBriefing({
      scheduledFor: at,
      items: [],
      briefingHref: "https://nyuz.app/dashboard/briefing",
    });
    expect(text).toContain("quiet");
    expect(text).toContain("Nothing crossed the threshold");
  });

  it("numbers stories and keeps a read link", () => {
    const text = formatTelegramBriefing({
      scheduledFor: at,
      items: [
        {
          title: "Talks resume",
          why: "This is the event the rest of the day will orbit.",
          href: "https://nyuz.app/dashboard/story/1",
        },
      ],
      briefingHref: "https://nyuz.app/dashboard/briefing",
    });
    expect(text).toContain("01. Talks resume");
    expect(text).toContain("https://nyuz.app/dashboard/story/1");
  });

  it("stays inside Telegram's character cap", () => {
    const text = formatTelegramBriefing({
      scheduledFor: at,
      items: Array.from({ length: 40 }, (_, i) => ({
        title: `Story ${i} with a long title that keeps going`,
        why: "x".repeat(200),
        href: `https://nyuz.app/dashboard/story/${i}`,
      })),
      briefingHref: "https://nyuz.app/dashboard/briefing",
    });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
  });
});

describe("formatTelegramAlert", () => {
  it("marks the message as breaking", () => {
    expect(
      formatTelegramAlert({
        title: "Vote passes",
        why: "The text that became law is not the leak.",
        href: "https://nyuz.app/dashboard/story/x",
      }),
    ).toContain("Breaking");
  });
});
