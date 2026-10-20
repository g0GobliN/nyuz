import { describe, expect, it } from "vitest";
import { briefingPush, partOfDay, storyPush } from "./payload";

describe("storyPush", () => {
  it("keeps each story addressable by its event id", () => {
    const n = storyPush({
      title: "Talks resume",
      why: "This is the event the rest of the day will orbit.",
      href: "https://nyuz.app/dashboard/story/1",
      eventId: "1",
    });
    expect(n.tag).toBe("1");
    expect(n.url).toContain("/dashboard/story/1");
    expect(n.title).toBe("Talks resume");
  });

  it("marks a breaking alert without folding it into a briefing", () => {
    expect(
      storyPush({
        title: "Vote passes",
        why: "The text that became law is not the leak.",
        href: "https://nyuz.app/dashboard/story/x",
        eventId: "x",
        breaking: true,
      }).title,
    ).toMatch(/^Breaking · /);
  });
});

describe("briefingPush", () => {
  const base = { href: "https://nyuz.app/dashboard", tag: "digest-1" };

  it("is one notification for the whole briefing", () => {
    // The bug: `sendStoryPushes` raises a notice per story it is handed, and
    // delivery handed it all fifty. A briefing is one interruption.
    const n = briefingPush({
      titles: Array.from({ length: 50 }, (_, i) => `Story ${i}`),
      total: 50,
      ...base,
      when: "morning",
    });
    expect(n.title).toBe("Your morning nyuz is ready");
    expect(n.body).toBe("Story 0, Story 1, and 48 more stories.");
  });

  it("opens the feed rather than any one story", () => {
    const n = briefingPush({ titles: ["A"], total: 12, ...base });
    expect(n.url).toBe("https://nyuz.app/dashboard");
  });

  it("is tagged by digest so a retry replaces rather than stacks", () => {
    expect(briefingPush({ titles: ["A"], total: 2, ...base }).tag).toBe("digest-1");
  });

  it("drops the time of day rather than guessing it", () => {
    expect(briefingPush({ titles: ["A"], total: 1, ...base, when: null }).title).toBe(
      "Your nyuz is ready",
    );
  });

  it("counts only what the briefing actually carried", () => {
    // `total` is the loaded items, not `item_count`: promising eighteen more
    // when twelve arrived is a small lie that costs the notification.
    expect(briefingPush({ titles: ["A", "B"], total: 3, ...base }).body).toBe(
      "A, B, and 1 more story.",
    );
  });

  it("reads as a sentence when nothing is left over", () => {
    expect(briefingPush({ titles: ["A", "B"], total: 2, ...base }).body).toBe("A and B.");
    expect(briefingPush({ titles: ["A"], total: 1, ...base }).body).toBe("A.");
  });

  it("survives a briefing whose titles are all empty", () => {
    expect(briefingPush({ titles: ["", "  "], total: 4, ...base }).body).toBe("4 more stories.");
    expect(briefingPush({ titles: [], total: 0, ...base }).body).toBe("Open to read it.");
  });

  it("clips a headline that would fill the notification on its own", () => {
    const long = "A".repeat(200);
    const body = briefingPush({ titles: [long], total: 5, ...base }).body;
    expect(body).toMatch(/…, and 4 more stories\.$/);
    expect(body.length).toBeLessThan(100);
  });

  it("clips a long headline between words, never inside one", () => {
    // The delivered 2026-10-19 briefing reached a reader with "…services to
    // probe securi…" — the clamp cutting through the source's own word (ruling
    // #19, 2026-10-20). The stored title is complete; the cut is the fault.
    const title =
      "ConnectWise turns off its SaaS-y backup, security, and management services to probe security SNAFU";
    const body = briefingPush({ titles: [title], total: 1, ...base }).body;
    expect(body.endsWith("….")).toBe(true);
    const clipped = body.slice(0, -2); // drop the ellipsis and the trailing period
    expect(title.startsWith(clipped)).toBe(true);
    // The cut fell on a space, so every word it kept is whole.
    expect(title[clipped.length]).toBe(" ");
    expect(clipped.endsWith("securi")).toBe(false);
  });
});

describe("partOfDay", () => {
  it("uses the same bands as the dashboard greeting", () => {
    expect(partOfDay(7)).toBe("morning");
    expect(partOfDay(11)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(17)).toBe("afternoon");
    expect(partOfDay(18)).toBe("evening");
    expect(partOfDay(23)).toBe("evening");
  });

  it("says nothing when the zone could not be read", () => {
    expect(partOfDay(null)).toBeNull();
  });
});
